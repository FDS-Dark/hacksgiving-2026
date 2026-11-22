/* Close slide: one family, then the whole city.
   Opens tight on a single warm dot at N 27th St & W Center St (her, 3:01 AM),
   with Devon's green dot arriving. Then the camera pulls back to all of
   Milwaukee: the real street map draws in, and dots light up across the city
   as they come into view. Amber dots are people asking for help, green ones
   are staff and partners answering. The dots are illustrative, not data. The
   cluster around 27th & Center brightens last, which is the pattern.
   Standalone: it watches the slide's classes, so deck.js needs no hook.
   Street geometry: assets/mke-map.js (OpenStreetMap, ODbL).

   Kept cheap for laptops: the canvas is 1920x1080 at 1x (the stage is scaled
   to the screen anyway); close views stroke only the street cells on screen;
   once zoomed out it draws a pre-rendered image of the whole city; dots are
   stamped from pre-drawn sprites; links go out in two batched strokes. */
(function () {
  var slide = document.querySelector('.s-close');
  var MAP = window.MKE_MAP;
  if (!slide || !MAP) return;
  var STATIC = document.documentElement.classList.contains('static');

  var W = 1920, H = 1080;
  var canvas = document.createElement('canvas');
  canvas.className = 'city-canvas';
  canvas.width = W; canvas.height = H;
  slide.insertBefore(canvas, slide.firstChild);
  var ctx = canvas.getContext('2d');

  /* ---- Streets, bucketed into 1000-unit (4 km) cells: one Path2D per cell and class ---- */
  var CELL = 1000, cells = {}, verts = [], minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  MAP.lines.forEach(function (lines, cls) {
    lines.forEach(function (d) {
      var x = 0, y = 0, pts = [], bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9, k;
      for (k = 0; k < d.length; k += 2) {
        x += d[k]; y += d[k + 1]; pts.push(x, y);
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
        if (cls < 4) {
          if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
          if (cls >= 2) verts.push(x, y);
        }
      }
      var key = Math.floor((bx0 + bx1) / 2 / CELL) + ',' + Math.floor((by0 + by1) / 2 / CELL);
      var c = cells[key] || (cells[key] = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9, p: [new Path2D(), new Path2D(), new Path2D(), new Path2D(), new Path2D()] });
      if (bx0 < c.x0) c.x0 = bx0; if (bx1 > c.x1) c.x1 = bx1; if (by0 < c.y0) c.y0 = by0; if (by1 > c.y1) c.y1 = by1;
      var p = c.p[cls]; p.moveTo(pts[0], pts[1]);
      for (k = 2; k < pts.length; k += 2) p.lineTo(pts[k], pts[k + 1]);
    });
  });
  var cellList = Object.keys(cells).map(function (k) { return cells[k]; });

  /* ---- Seeded random, so every run (and the PDF) looks the same ---- */
  var seed = 20261122;
  function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
  function gauss() { return Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd()); }
  function pickVert() { var k = (rnd() * verts.length / 2 | 0) * 2; return [verts[k], verts[k + 1]]; }

  // The dots: people across the city, helpers among them, and the 27th & Center cluster.
  var dots = [], i;
  for (i = 0; i < 620; i++) { var v = pickVert(); dots.push({ x: v[0], y: v[1], kind: rnd() < 0.68 ? 'ask' : 'help' }); }
  // Local cluster near her: snap gaussian points to the closest of many sampled local vertices.
  var local = [];
  for (var j = 0; j < verts.length; j += 2) if (Math.abs(verts[j]) < 450 && Math.abs(verts[j + 1]) < 450) local.push(verts[j], verts[j + 1]);
  for (i = 0; i < 70; i++) {
    var gx = gauss() * 130, gy = gauss() * 130, best = null, bd = 1e18;
    for (var n = 0; n < 40; n++) { var k = (rnd() * local.length / 2 | 0) * 2; var d = (local[k] - gx) * (local[k] - gx) + (local[k + 1] - gy) * (local[k + 1] - gy); if (d < bd) { bd = d; best = [local[k], local[k + 1]]; } }
    if (best) dots.push({ x: best[0], y: best[1], kind: rnd() < 0.85 ? 'ask' : 'help', cluster: true });
  }
  dots.forEach(function (d) {
    d.dist = Math.sqrt(d.x * d.x + d.y * d.y);
    d.jit = rnd() * 0.6; d.ph = rnd() * 6.28; d.size = 0.75 + rnd() * 0.5;
  });
  // Links: some asks to the nearest helper, drawn once both are lit.
  var helpers = dots.filter(function (d) { return d.kind === 'help'; });
  dots.forEach(function (d) {
    if (d.kind !== 'ask' || rnd() > 0.55) return;
    var best = null, bd = 1e18;
    helpers.forEach(function (h) { var q = (h.x - d.x) * (h.x - d.x) + (h.y - d.y) * (h.y - d.y); if (q < bd) { bd = q; best = h; } });
    if (best && bd < 900 * 900) d.link = best;
  });

  /* ---- Camera ----
     Start: tight on her (6 px per 4 m unit, about eight blocks across), her dot at (1290, 600).
     End: the whole city fitted into the right side of the stage. */
  var T_ZOOM0 = 3.0, T_ZOOM1 = 11.5, T_PATTERN = 10.6;
  var S0 = 6, HX0 = 1290, HY0 = 600;
  var SF = 990 / (maxY - minY), CXF = (minX + maxX) / 2, CYF = (minY + maxY) / 2, XF = 1360, YF = 545;
  var HXF = XF + (0 - CXF) * SF, HYF = YF + (0 - CYF) * SF; // where she ends up on screen
  function ease(u) { u = Math.max(0, Math.min(1, u)); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }
  function cam(t) {
    var u = ease((t - T_ZOOM0) / (T_ZOOM1 - T_ZOOM0));
    var s = Math.exp(Math.log(S0) + (Math.log(SF) - Math.log(S0)) * u);
    if (t > T_ZOOM1) s *= 1 + (t - T_ZOOM1) * 0.004; // a slow breath after it settles
    // Her screen position slides from the start spot to the end framing; it settles faster than the zoom.
    var m = ease((t - T_ZOOM0 - 1.5) / (T_ZOOM1 - T_ZOOM0 - 1.5));
    return { s: s, hx: HX0 + (HXF - HX0) * m, hy: HY0 + (HYF - HY0) * m };
  }

  /* ---- Street styles and drawing ---- */
  var STYLES = [ // [px width, alpha close, alpha far]: freeway, arterial, collector, local, river
    [2.6, 0.55, 0.40], [2.0, 0.50, 0.26], [1.6, 0.42, 0.15], [1.4, 0.36, 0.075], [2.2, 0.36, 0.34]
  ];
  function zoomOf(s) { return Math.max(0, Math.min(1, (Math.log(S0) - Math.log(s)) / (Math.log(S0) - Math.log(SF)))); }
  function strokeStreets(g, list, s, zo, alpha) {
    g.lineCap = 'butt'; g.lineJoin = 'bevel'; // round caps and joins are costly over tens of thousands of segments
    for (var cl = 4; cl >= 0; cl--) {
      var st = STYLES[cl], a = (cl === 4 ? st[1] : st[1] + (st[2] - st[1]) * zo) * alpha;
      g.strokeStyle = (cl === 4 ? 'rgba(90,160,220,' : 'rgba(150,196,176,') + a.toFixed(3) + ')';
      g.lineWidth = (cl === 4 ? st[0] : st[0] * (0.55 + 0.45 * (1 - zo))) / s;
      for (var q = 0; q < list.length; q++) g.stroke(list[q].p[cl]);
    }
  }
  // The far image: the whole city drawn once at SB (1.6x the final scale). Whenever we're zoomed
  // out past SB it's drawn scaled down; at SB it matches the vector drawing exactly. It's built
  // while the deck is idle, so the slide never waits on it.
  var SB = SF * 1.6, IMG_PAD = 8, cityImg = null;
  function buildCity() {
    if (cityImg) return;
    var cv = document.createElement('canvas');
    cv.width = Math.ceil((maxX - minX) * SB + IMG_PAD * 2); cv.height = Math.ceil((maxY - minY) * SB + IMG_PAD * 2);
    var g = cv.getContext('2d');
    g.setTransform(SB, 0, 0, SB, IMG_PAD - minX * SB, IMG_PAD - minY * SB);
    strokeStreets(g, cellList, SB, zoomOf(SB), 1);
    cityImg = cv;
  }
  (window.requestIdleCallback || function (f) { setTimeout(f, 300); })(buildCity);

  // Dot sprites: each glow is drawn once, then stamped, instead of a new gradient per dot per frame.
  function sprite(rgb) {
    var cv = document.createElement('canvas'), R = 32; cv.width = cv.height = R * 2;
    var g = cv.getContext('2d'), gr = g.createRadialGradient(R, R, 0, R, R, R);
    gr.addColorStop(0, 'rgba(' + rgb + ',0.42)'); gr.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = gr; g.fillRect(0, 0, R * 2, R * 2);
    g.fillStyle = 'rgba(' + rgb + ',0.95)'; g.beginPath(); g.arc(R, R, R / 3.2 * 0.55, 0, 6.2832); g.fill();
    return cv;
  }
  var SPRITE = { ask: sprite('255,176,84'), help: sprite('43,212,125') };

  // When each dot lights: as the pull-back brings it into view (cluster dots a touch early).
  // Solved once per dot by bisection on the camera and cached.
  dots.forEach(function (d) {
    var lo = T_ZOOM0, hi = T_ZOOM1 + 0.5;
    if (d.dist * cam(lo).s < 600) { d.lit = 1.0 + d.jit * 2; return; }
    for (var it = 0; it < 24; it++) { var mid = (lo + hi) / 2; if (d.dist < 1250 / cam(mid).s * 0.85) hi = mid; else lo = mid; }
    d.lit = hi + d.jit - (d.cluster ? 0.4 : 0);
  });
  dots.forEach(function (d) { if (d.link) d.linkAt = Math.max(d.lit, d.link.lit, T_ZOOM0 + 4.5) + 0.3; });

  var DEVON0 = [-150, 95]; // Devon starts a few blocks south-west and arrives at her
  var LABEL_FONT = '600 30px ' + (getComputedStyle(slide).getPropertyValue('--text').trim() || 'system-ui');

  function draw(t) {
    var c = cam(t), s = c.s, hx = c.hx, hy = c.hy;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Streets: fade in over the first second and a half; local streets thin out as we pull back.
    var inA = Math.min(1, Math.max(0, (t - 0.2) / 1.3));
    if (s <= SB && cityImg) {
      var k2 = s / SB;
      ctx.globalAlpha = inA;
      ctx.drawImage(cityImg, hx + minX * s - IMG_PAD * k2, hy + minY * s - IMG_PAD * k2, cityImg.width * k2, cityImg.height * k2);
      ctx.globalAlpha = 1;
    } else {
      var vx0 = -hx / s, vx1 = (W - hx) / s, vy0 = -hy / s, vy1 = (H - hy) / s, vis = [];
      for (var q = 0; q < cellList.length; q++) { var ce = cellList[q]; if (ce.x1 >= vx0 && ce.x0 <= vx1 && ce.y1 >= vy0 && ce.y0 <= vy1) vis.push(ce); }
      ctx.setTransform(s, 0, 0, s, hx, hy);
      strokeStreets(ctx, vis, s, zoomOf(s), inA);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // Links first, under the dots: two batched strokes.
    var lp0 = new Path2D(), lp1 = new Path2D(), any = false;
    for (i = 0; i < dots.length; i++) {
      var d = dots[i];
      if (!d.link) continue;
      var u = (t - d.linkAt) / 0.9;
      if (u <= 0) continue;
      if (u > 1) u = 1;
      var x0 = hx + d.link.x * s, y0 = hy + d.link.y * s, x1 = hx + d.x * s, y1 = hy + d.y * s, P = d.cluster ? lp1 : lp0;
      P.moveTo(x0, y0); P.lineTo(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u); any = true;
    }
    if (any) {
      ctx.lineWidth = 1.2; ctx.lineCap = 'butt';
      ctx.strokeStyle = 'rgba(43,212,125,0.28)'; ctx.stroke(lp0);
      ctx.strokeStyle = 'rgba(43,212,125,0.364)'; ctx.stroke(lp1);
    }

    // The pattern: a warm halo that grows around 27th & Center once the city is in view.
    var pu = Math.min(1, Math.max(0, (t - T_PATTERN) / 1.6));
    if (pu > 0) {
      var hr = 520 * s * (0.6 + 0.4 * pu) + 40, g = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr);
      g.addColorStop(0, 'rgba(255,170,70,' + (0.34 * pu).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(255,170,70,0)');
      ctx.fillStyle = g; ctx.fillRect(hx - hr, hy - hr, hr * 2, hr * 2);
    }

    // Dots, stamped from the sprites.
    var rBase = zoomOf(s) > 0.5 ? 3.4 : 4.6;
    for (i = 0; i < dots.length; i++) {
      d = dots[i];
      var a = (t - d.lit) / 0.6;
      if (a <= 0) continue;
      var x = hx + d.x * s, y = hy + d.y * s;
      if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
      var tw = 0.75 + 0.25 * Math.sin(t * 1.7 + d.ph), boost = d.cluster && pu > 0 ? 1 + 0.6 * pu : 1;
      var R2 = rBase * d.size * (d.cluster && pu > 0 ? 1 + 0.25 * pu : 1) * 3.2;
      ctx.globalAlpha = Math.min(1, Math.min(1, a) * tw * boost);
      ctx.drawImage(SPRITE[d.kind], x - R2, y - R2, R2 * 2, R2 * 2);
    }
    ctx.globalAlpha = 1;

    // Devon: a green dot travelling to her in the opening seconds; the trail fades as we pull back.
    var du = ease((t - 0.8) / 2.2), dvA = Math.min(1, Math.max(0, (t - 0.6) / 0.5));
    if (dvA > 0) {
      var dx = hx + (DEVON0[0] * (1 - du) + 6 * du) * s, dy = hy + (DEVON0[1] * (1 - du) + 6 * du) * s;
      var trail = 0.55 * dvA * Math.max(0, 1 - Math.max(0, t - T_ZOOM0) / 1.5);
      if (trail > 0) {
        ctx.strokeStyle = 'rgba(43,212,125,' + trail.toFixed(3) + ')'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(hx + DEVON0[0] * s, hy + DEVON0[1] * s); ctx.lineTo(dx, dy); ctx.stroke();
      }
      var dr = Math.max(4, Math.min(11, 0.9 * s + 3));
      ctx.globalAlpha = dvA;
      ctx.drawImage(SPRITE.help, dx - dr * 3.5, dy - dr * 3.5, dr * 7, dr * 7);
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(160,255,200,' + dvA.toFixed(3) + ')'; ctx.beginPath(); ctx.arc(dx, dy, dr * 0.6, 0, 6.2832); ctx.fill();
    }

    // Her: the warm dot everything starts from, with a slow pulse ring.
    var hA = Math.min(1, Math.max(0, t / 0.4)), hr2 = Math.max(6, Math.min(16, 1.6 * s + 4));
    var pulse = (t * 0.55) % 1;
    ctx.strokeStyle = 'rgba(255,214,150,' + (0.55 * (1 - pulse) * hA).toFixed(3) + ')'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(hx, hy, hr2 + pulse * hr2 * 4, 0, 6.2832); ctx.stroke();
    var g3 = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr2 * 4);
    g3.addColorStop(0, 'rgba(255,200,120,' + (0.6 * hA).toFixed(3) + ')'); g3.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = g3; ctx.fillRect(hx - hr2 * 4, hy - hr2 * 4, hr2 * 8, hr2 * 8);
    ctx.fillStyle = 'rgba(255,240,215,' + hA.toFixed(3) + ')'; ctx.beginPath(); ctx.arc(hx, hy, hr2 * 0.62, 0, 6.2832); ctx.fill();

    // The label under her, only while we're close.
    var lA = hA * Math.max(0, 1 - Math.max(0, t - T_ZOOM0) / 1.6);
    if (lA > 0) {
      ctx.font = LABEL_FONT; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,240,215,' + (0.85 * lA).toFixed(3) + ')';
      ctx.fillText('27th & Center · 3:01 AM', hx, hy + hr2 + 52);
    }
  }

  /* ---- Run it while the slide is up ---- */
  var t0 = 0, raf = 0, wasActive = false;
  function loop(now) {
    draw((now - t0) / 1000);
    raf = requestAnimationFrame(loop);
  }
  function sync() {
    var active = slide.classList.contains('active');
    if (active && !wasActive) {
      buildCity(); // normally already built while idle; a no-op then
      if (STATIC) draw(14);
      else { t0 = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); }
    } else if (!active && wasActive) {
      // keep drawing through the crossfade out, then stop
      setTimeout(function () { if (!slide.classList.contains('active')) cancelAnimationFrame(raf); }, 1200);
    }
    wasActive = active;
  }
  new MutationObserver(sync).observe(slide, { attributes: true, attributeFilter: ['class'] });
  sync();
  if (STATIC) { buildCity(); draw(14); }
  window.closeCity = { draw: draw, t: function () { return (performance.now() - t0) / 1000; } };
})();
