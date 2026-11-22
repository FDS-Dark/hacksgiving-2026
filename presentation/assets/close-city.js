/* Close slide: one family, then the whole city.
   Opens tight on a single warm dot at N 27th St & W Center St (her, 3:01 AM),
   with Devon's green dot arriving. Then the camera pulls back to all of
   Milwaukee: the real street map draws in, and dots light up across the city
   as they come into view. Amber dots are people asking for help, green ones
   are staff and partners answering. The dots are illustrative, not data. The
   cluster around 27th & Center brightens last, which is the pattern.
   Standalone: it watches the slide's classes, so deck.js needs no hook.
   Street geometry: assets/mke-map.js (OpenStreetMap, ODbL). */
(function () {
  var slide = document.querySelector('.s-close');
  var MAP = window.MKE_MAP;
  if (!slide || !MAP) return;
  var STATIC = document.documentElement.classList.contains('static');

  var W = 1920, H = 1080, DPR = Math.min(2, window.devicePixelRatio || 1);
  var canvas = document.createElement('canvas');
  canvas.className = 'city-canvas';
  canvas.width = W * DPR; canvas.height = H * DPR;
  slide.insertBefore(canvas, slide.firstChild);
  var ctx = canvas.getContext('2d');

  /* ---- Decode the streets into one Path2D per class, and keep vertices to seat dots on ---- */
  var paths = [], verts = [], minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  MAP.lines.forEach(function (lines, cls) {
    var p = new Path2D();
    lines.forEach(function (d) {
      var x = 0, y = 0;
      for (var k = 0; k < d.length; k += 2) {
        x += d[k]; y += d[k + 1];
        if (k === 0) p.moveTo(x, y); else p.lineTo(x, y);
        if (cls < 4) {
          if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
          if (cls >= 2) verts.push(x, y);
        }
      }
    });
    paths.push(p);
  });

  /* ---- Seeded random, so every run (and the PDF) looks the same ---- */
  var seed = 20261122;
  function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
  function gauss() { return Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd()); }
  function pickVert() { var k = (rnd() * verts.length / 2 | 0) * 2; return [verts[k], verts[k + 1]]; }
  function nearVert(x, y, r) { // a street vertex near (x, y), so cluster dots sit on streets too
    var best = null, bd = 1e18;
    for (var n = 0; n < 60; n++) { var v = pickVert(); var d = (v[0] - x) * (v[0] - x) + (v[1] - y) * (v[1] - y); if (d < bd) { bd = d; best = v; } }
    return bd < r * r * 9 ? best : [x, y];
  }

  // The dots: people across the city, helpers among them, and the 27th & Center cluster.
  var dots = [];
  for (var i = 0; i < 620; i++) { var v = pickVert(); dots.push({ x: v[0], y: v[1], kind: rnd() < 0.68 ? 'ask' : 'help' }); }
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
    var drift = t > T_ZOOM1 ? 1 + (t - T_ZOOM1) * 0.004 : 1; // a slow breath after it settles
    s *= drift;
    // Her screen position slides from the start spot to the end framing; it settles faster than the zoom.
    var m = ease((t - T_ZOOM0 - 1.5) / (T_ZOOM1 - T_ZOOM0 - 1.5));
    return { s: s, hx: HX0 + (HXF - HX0) * m, hy: HY0 + (HYF - HY0) * m };
  }

  var DEVON0 = [-150, 95]; // Devon starts a few blocks south-west and arrives at her
  function draw(t) {
    var c = cam(t), s = c.s;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Streets: fade in over the first second and a half; local streets thin out as we pull back.
    var inA = Math.min(1, Math.max(0, (t - 0.2) / 1.3));
    var zoomedOut = Math.max(0, Math.min(1, (Math.log(S0) - Math.log(s)) / (Math.log(S0) - Math.log(SF))));
    ctx.save();
    ctx.setTransform(DPR * s, 0, 0, DPR * s, DPR * c.hx, DPR * c.hy);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var styles = [ // [px width, alpha close, alpha far]
      [2.6, 0.55, 0.40], [2.0, 0.50, 0.26], [1.6, 0.42, 0.15], [1.4, 0.36, 0.075], [2.2, 0.36, 0.34]
    ];
    for (var cl = 3; cl >= 0; cl--) {
      var st = styles[cl], a = (st[1] + (st[2] - st[1]) * zoomedOut) * inA;
      ctx.strokeStyle = 'rgba(150,196,176,' + a.toFixed(3) + ')';
      ctx.lineWidth = st[0] * (0.55 + 0.45 * (1 - zoomedOut)) / s;
      ctx.stroke(paths[cl]);
    }
    ctx.strokeStyle = 'rgba(90,160,220,' + (styles[4][1] * inA).toFixed(3) + ')';
    ctx.lineWidth = styles[4][0] / s;
    ctx.stroke(paths[4]);
    ctx.restore();

    function sx(x) { return c.hx + x * s; }
    function sy(y) { return c.hy + y * s; }
    var R = 1250 / s; // world radius currently on screen around her

    // When each dot lights: as the pull-back brings it into view (cluster dots a touch early).
    function litAt(d) {
      if (d.lit !== undefined) return d.lit;
      // Find the moment R(t) passes the dot's distance: invert numerically once and cache it.
      var lo = T_ZOOM0, hi = T_ZOOM1 + 0.5;
      if (d.dist * cam(lo).s < 600) return (d.lit = 1.0 + d.jit * 2);
      for (var it = 0; it < 24; it++) { var mid = (lo + hi) / 2; if (d.dist < 1250 / cam(mid).s * 0.85) hi = mid; else lo = mid; }
      return (d.lit = hi + d.jit - (d.cluster ? 0.4 : 0));
    }

    // Links first, under the dots.
    ctx.lineWidth = 1.2;
    dots.forEach(function (d) {
      if (!d.link) return;
      var t0 = Math.max(litAt(d), litAt(d.link), T_ZOOM0 + 4.5) + 0.3, u = Math.min(1, Math.max(0, (t - t0) / 0.9));
      if (u <= 0) return;
      var x0 = sx(d.link.x), y0 = sy(d.link.y), x1 = sx(d.x), y1 = sy(d.y);
      ctx.strokeStyle = 'rgba(43,212,125,' + (0.28 * (d.cluster ? 1.3 : 1)).toFixed(3) + ')';
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u); ctx.stroke();
    });

    // The pattern: a warm halo that grows around 27th & Center once the city is in view.
    var pu = Math.min(1, Math.max(0, (t - T_PATTERN) / 1.6));
    if (pu > 0) {
      var hr = 520 * s * (0.6 + 0.4 * pu) + 40, g = ctx.createRadialGradient(c.hx, c.hy, 0, c.hx, c.hy, hr);
      g.addColorStop(0, 'rgba(255,170,70,' + (0.34 * pu).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(255,170,70,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.hx, c.hy, hr, 0, 6.2832); ctx.fill();
    }

    // Dots.
    dots.forEach(function (d) {
      var a = Math.min(1, Math.max(0, (t - litAt(d)) / 0.6));
      if (a <= 0) return;
      var x = sx(d.x), y = sy(d.y);
      if (x < -20 || x > W + 20 || y < -20 || y > H + 20) return;
      var tw = 0.75 + 0.25 * Math.sin(t * 1.7 + d.ph), boost = d.cluster && pu > 0 ? 1 + 0.6 * pu : 1;
      var r = (zoomedOut > 0.5 ? 3.4 : 4.6) * d.size * (d.cluster && pu > 0 ? 1 + 0.25 * pu : 1);
      var col = d.kind === 'ask' ? '255,176,84' : '43,212,125';
      var gg = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
      gg.addColorStop(0, 'rgba(' + col + ',' + (0.42 * a * tw * boost).toFixed(3) + ')');
      gg.addColorStop(1, 'rgba(' + col + ',0)');
      ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x, y, r * 3.2, 0, 6.2832); ctx.fill();
      ctx.fillStyle = 'rgba(' + col + ',' + Math.min(1, 0.95 * a * tw * boost).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, 6.2832); ctx.fill();
    });

    // Devon: a green dot travelling to her, leaving a short trail, in the opening seconds.
    var du = ease((t - 0.8) / 2.2), dvA = Math.min(1, Math.max(0, (t - 0.6) / 0.5));
    if (dvA > 0) {
      var dx = DEVON0[0] * (1 - du) + 6 * du, dy = DEVON0[1] * (1 - du) + 6 * du;
      ctx.strokeStyle = 'rgba(43,212,125,' + (0.55 * dvA * Math.max(0, 1 - Math.max(0, t - T_ZOOM0) / 1.5)).toFixed(3) + ')'; ctx.lineWidth = 2.5; // the trail fades as we pull back
      ctx.beginPath(); ctx.moveTo(sx(DEVON0[0]), sy(DEVON0[1])); ctx.lineTo(sx(dx), sy(dy)); ctx.stroke();
      var dr = Math.max(4, Math.min(11, 0.9 * s + 3));
      var g2 = ctx.createRadialGradient(sx(dx), sy(dy), 0, sx(dx), sy(dy), dr * 3.5);
      g2.addColorStop(0, 'rgba(43,212,125,' + (0.5 * dvA).toFixed(3) + ')'); g2.addColorStop(1, 'rgba(43,212,125,0)');
      ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(sx(dx), sy(dy), dr * 3.5, 0, 6.2832); ctx.fill();
      ctx.fillStyle = 'rgba(160,255,200,' + dvA.toFixed(3) + ')'; ctx.beginPath(); ctx.arc(sx(dx), sy(dy), dr * 0.6, 0, 6.2832); ctx.fill();
    }

    // Her: the warm dot everything starts from, with a slow pulse ring.
    var hA = Math.min(1, Math.max(0, t / 0.4)), hr2 = Math.max(6, Math.min(16, 1.6 * s + 4));
    var pulse = (t * 0.55) % 1;
    ctx.strokeStyle = 'rgba(255,214,150,' + (0.55 * (1 - pulse) * hA).toFixed(3) + ')'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(c.hx, c.hy, hr2 + pulse * hr2 * 4, 0, 6.2832); ctx.stroke();
    var g3 = ctx.createRadialGradient(c.hx, c.hy, 0, c.hx, c.hy, hr2 * 4);
    g3.addColorStop(0, 'rgba(255,200,120,' + (0.6 * hA).toFixed(3) + ')'); g3.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = g3; ctx.beginPath(); ctx.arc(c.hx, c.hy, hr2 * 4, 0, 6.2832); ctx.fill();
    ctx.fillStyle = 'rgba(255,240,215,' + hA.toFixed(3) + ')'; ctx.beginPath(); ctx.arc(c.hx, c.hy, hr2 * 0.62, 0, 6.2832); ctx.fill();

    // The label under her, only while we're close.
    var lA = hA * Math.max(0, 1 - Math.max(0, t - T_ZOOM0) / 1.6);
    if (lA > 0) {
      ctx.font = '600 30px ' + (getComputedStyle(slide).getPropertyValue('--text') || 'system-ui');
      ctx.fillStyle = 'rgba(255,240,215,' + (0.85 * lA).toFixed(3) + ')'; ctx.textAlign = 'center';
      ctx.fillText('27th & Center · 3:01 AM', c.hx, c.hy + hr2 + 52);
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
      if (STATIC) { draw(14); }
      else { t0 = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); }
    } else if (!active && wasActive) {
      // keep drawing through the crossfade out, then stop
      setTimeout(function () { if (!slide.classList.contains('active')) cancelAnimationFrame(raf); }, 1200);
    }
    wasActive = active;
  }
  new MutationObserver(sync).observe(slide, { attributes: true, attributeFilter: ['class'] });
  sync();
  if (STATIC) draw(14);
  window.closeCity = { draw: draw, t: function () { return (performance.now() - t0) / 1000; } };
})();
