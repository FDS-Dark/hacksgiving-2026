/* ComForce MKE keynote engine. Vanilla JS, classic script, works from file://.
 *
 * Modes (query string):
 *   (none)       the show
 *   ?presenter   presenter view (notes, next preview, timer and pace, media status)
 *   ?preview     a silent render used inside the presenter's thumbnails
 *   ?print       final states, posters instead of video, no motion (PDF)
 *   ?static      the show without motion (QA)
 *   ?pushsrc=missing   pretend push-notification.mp4 is missing (tests the synthetic fallback)
 * Hash: #7 is slide 7; #7.2 is slide 7 at build step 2.
 */
(function () {
  'use strict';

  var P = new URLSearchParams(location.search);
  var MODE = P.has('presenter') ? 'presenter' : P.has('preview') ? 'preview' : P.has('print') ? 'print' : 'show';
  var STATIC = MODE === 'preview' || MODE === 'print' || P.has('static');
  var POSTERS = MODE === 'preview' || MODE === 'print' || P.has('posters');
  var REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var root = document.documentElement;
  root.classList.add('mode-' + MODE);
  if (STATIC) root.classList.add('static');

  var A = window.DECK_ASSETS || {};
  var C = window.DECK_CONFIG || {};
  var CH = 'comforce-keynote';
  var BASE = location.href.split('#')[0].split('?')[0];

  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  /* ---------- Glyphs (hand-drawn 24px line icons) ---------- */
  var ICONS = {
    'user-x': '<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 3 .8"/><path d="M16.5 15.5l5 5M21.5 15.5l-5 5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7v1"/>',
    mic: '<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3.5"/>',
    'eye-off': '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c5.2 0 9 4.6 10 7a13.6 13.6 0 0 1-2.9 4"/><path d="M6.4 6.5A13.4 13.4 0 0 0 2 12c1 2.4 4.8 7 10 7a10 10 0 0 0 5.5-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    sparkle: '<path d="M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9z"/><path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
    'user-check': '<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h2.5"/><path d="M15 18l2.2 2.2L22 15.5"/>',
    list: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/>',
    shield: '<path d="M12 2.8l8 3v6.1c0 5-3.4 8.3-8 9.4-4.6-1.1-8-4.4-8-9.4V5.8z"/><path d="M8.5 12.2l2.4 2.4 4.6-4.8"/>',
    pin: '<path d="M12 21.5s7-6.4 7-12a7 7 0 0 0-14 0c0 5.6 7 12 7 12z"/><circle cx="12" cy="9.5" r="2.6"/>',
    chart: '<path d="M3.5 3.5v17h17"/><path d="M7.5 15l4-4.5 3 3 5-6"/>',
    package: '<path d="M21 7.5L12 3 3 7.5v9L12 21l9-4.5z"/><path d="M3 7.5l9 4.5 9-4.5"/><path d="M12 12v9"/>',
    export: '<path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M4.5 14.5V19a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4.5"/>',
    book: '<path d="M4 19.5V5a2 2 0 0 1 2-2h14v14H6a2 2 0 0 0-2 2.5z"/><path d="M4 19.5A2 2 0 0 0 6 21.5h14V17"/><path d="M9 7.5h7"/>',
    trash: '<path d="M4 6.5h16"/><path d="M9.5 6.5V4h5v2.5"/><path d="M6 6.5l1 13.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5l1-13.5"/><path d="M10 11v6M14 11v6"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.6 3.8 5.6 3.8 9S14.6 18.4 12 21c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z"/>',
    users: '<circle cx="9" cy="8" r="3.6"/><path d="M2.5 20.5a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.6 3.6 0 0 1 0 6.8"/><path d="M18.5 14.2a6.5 6.5 0 0 1 3.5 6.3"/>',
    device: '<rect x="6" y="2" width="12" height="20" rx="2.8"/><path d="M10.5 18.5h3"/>',
    check: '<path d="M4.5 12.5l5 5L20 7"/>',
    circle: '<circle cx="12" cy="12" r="8.5"/>',
    bed: '<path d="M3 19V6"/><path d="M3 15h18v4"/><path d="M21 15v-3a3 3 0 0 0-3-3h-7v6"/><circle cx="7" cy="11" r="2"/>',
    bus: '<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16"/><path d="M7 21v-3M17 21v-3"/><circle cx="8" cy="14.5" r=".8"/><circle cx="16" cy="14.5" r=".8"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    chev: '<path d="M9 5l7 7-7 7"/>',
    home: '<path d="M3 11l9-7.5 9 7.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    badge: '<path d="M12 2.5l2.4 2 3.1-.3.7 3 2.6 1.7-1.2 2.9 1.2 2.9-2.6 1.7-.7 3-3.1-.3-2.4 2-2.4-2-3.1.3-.7-3L3.2 14.7l1.2-2.9-1.2-2.9 2.6-1.7.7-3 3.1.3z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
    siren: '<path d="M6 18v-6a6 6 0 0 1 12 0v6"/><path d="M4 18h16v3H4z"/><path d="M12 2v2M3.5 6l1.5 1.2M20.5 6L19 7.2"/>',
    snow: '<path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="M9.5 4l2.5 2 2.5-2M9.5 20l2.5-2 2.5 2"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5l5 5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    phone: '<path d="M5 3.5h3.2l1.6 4.2-2.1 1.4a11 11 0 0 0 5.2 5.2l1.4-2.1 4.2 1.6V17a2.5 2.5 0 0 1-2.5 2.5A15.5 15.5 0 0 1 2.5 6 2.5 2.5 0 0 1 5 3.5z"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.6L4 8"/><path d="M4 3.5V8h4.5"/><path d="M4 13a8 8 0 0 0 14.3 4.6L20 16"/><path d="M20 20.5V16h-4.5"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    server: '<rect x="3.5" y="4" width="17" height="7" rx="2"/><rect x="3.5" y="13" width="17" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>'
  };
  function icons(scope) {
    $$('i[data-icon]', scope).forEach(function (e) {
      e.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[e.getAttribute('data-icon')] || '') + '</svg>';
    });
  }
  icons();
  $$('[data-config]').forEach(function (e) { var v = C[e.getAttribute('data-config')]; if (v) e.textContent = v; });

  /* ---------- Phones ---------- */
  function posterImg(src, fallbackSrc) {
    var img = new Image(); img.alt = ''; img.src = src || '';
    if (fallbackSrc) img.onerror = function () { img.onerror = null; img.src = fallbackSrc; };
    return img;
  }
  function placeholder(a) {
    var d = el('div', 'ph-empty');
    d.innerHTML = '<i data-icon="device"></i><b>' + ((a && a.label) || 'Clip') + '</b><span>capture coming</span>';
    icons(d); return d;
  }
  function swapMedia(scr, node) {
    var old = scr.querySelector(':scope > video, :scope > img, :scope > .ph-empty');
    if (old) scr.replaceChild(node, old); else scr.insertBefore(node, scr.firstChild);
  }
  function stillOrPlaceholder(scr, a, src) { // image (then a.fallbackImage), and a placeholder if those are missing too
    if (!src) { swapMedia(scr, placeholder(a)); return; }
    var img = new Image(); img.alt = '';
    img.onerror = function () { if (a && a.fallbackImage && img.src.indexOf(a.fallbackImage) < 0) { img.src = a.fallbackImage; return; } img.onerror = null; swapMedia(scr, placeholder(a)); };
    img.src = src; swapMedia(scr, img);
  }
  function makeVideo(a, src) {
    var v = document.createElement('video');
    v.muted = true; v.loop = a.loop !== false; v.playsInline = true; v.preload = 'auto';
    v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
    if (a.end) v.setAttribute('data-end', a.end);
    if (a.sound) { v.muted = false; v.removeAttribute('muted'); v.loop = false; v.setAttribute('data-sound', ''); }
    if (a.start != null) v.setAttribute('data-start', a.start);
    if (a.stop != null) { v.setAttribute('data-stop', a.stop); v.loop = false; }
    v.src = src; return v;
  }
  function watchFor(scr, a, src) { // keep checking for a missing clip; swap it in when it appears
    if (MODE !== 'show' || scr._watch) return;
    scr._watch = setInterval(function () {
      var probe = document.createElement('video'); probe.preload = 'metadata'; probe.muted = true;
      probe.onloadedmetadata = function () {
        clearInterval(scr._watch); scr._watch = 0;
        var v = makeVideo(a, src + '?t=' + Date.now()); swapMedia(scr, v);
        var sl = scr.closest('.slide');
        if (sl && sl.classList.contains('active')) { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); }
      };
      probe.src = src + '?probe=' + Date.now();
    }, 6000);
  }
  function mountVideo(scr, key, a) {
    var src = a.video;
    if (key === 'push' && P.get('pushsrc') === 'missing') src = 'assets/video/__missing__.mp4';
    var v = makeVideo(a, src), triedFallback = false;
    if (a.poster && key !== 'push') v.poster = a.poster;
    v.addEventListener('error', function onErr() {
      if (key === 'push') { pushFallback(scr, v); return; }
      watchFor(scr, a, src);
      if (a.fallbackVideo && !triedFallback) { triedFallback = true; v.removeAttribute('poster'); v.src = a.fallbackVideo; scr.classList.add('using-fallback'); return; }
      stillOrPlaceholder(scr, a, a.poster);
    });
    swapMedia(scr, v);
    return v;
  }
  $$('.phone[data-asset]').forEach(function (ph) {
    var key = ph.getAttribute('data-asset'), a = A[key];
    var body = el('div', 'body'), scr = el('div', 'screen');
    ph.innerHTML = ''; body.appendChild(scr); ph.appendChild(body);
    if (a && typeof a === 'object' && a.dark) ph.classList.add('dark');
    if (a && typeof a === 'object' && a.video && !POSTERS) mountVideo(scr, key, a);
    else if (key === 'push' && a) {
      var img = new Image(); img.alt = ''; img.onerror = function () { img.onerror = null; img.src = a.fallback ? a.fallback.appPoster : ''; };
      img.src = a.poster || ''; swapMedia(scr, img);
    } else stillOrPlaceholder(scr, typeof a === 'object' ? a : {}, typeof a === 'string' ? a : (a && (a.poster || a.image)) || '');
    if (key === 'push') { var tap = el('div', 'tap'); scr.appendChild(tap); }
  });

  /* ---------- Slides, builds ---------- */
  var slides = $$('.slide');
  var N = slides.length;
  var steps = slides.map(function (s) {
    return $$('[data-build]', s).reduce(function (m, e) { return Math.max(m, +e.getAttribute('data-build')); }, 0);
  });
  var titles = slides.map(function (s, k) { return s.getAttribute('data-title') || ('Slide ' + (k + 1)); });
  var notes = slides.map(function (s) { var n = $('.notes', s); return n ? n.innerHTML.trim() : ''; });
  function parseT(s) { var m = String(s).split(':'); return (+m[0]) * 60 + (+m[1] || 0); }
  var targets = slides.map(function (s) {
    var t = s.getAttribute('data-target'); if (!t) return null;
    if (t === 'pre-show') return { pre: true, label: 'Pre-show' };
    if (t === 'appendix') return { appendix: true, label: 'Appendix' };
    var p = t.split('-'); return { a: parseT(p[0]), b: parseT(p[1]), label: t.replace('-', '–') };
  });
  var cur = -1, step = 0;
  // The talk ends at the last slide that isn't appendix; the appendix (for Q&A) is untimed.
  var TALK_END = targets.reduce(function (m, t, k) { return t && t.appendix ? m : k; }, 0);
  function isAppx(k) { return !!(targets[k] && targets[k].appendix); }
  var CALL_IDX = slides.indexOf($('.s-call'));

  var stage = $('#stage'), progress = $('#progress'), black = $('#black'), jump = $('#jump'), notesOv = $('#notes-overlay');

  function fit() {
    if (!stage) return;
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.transform = 'translate(-50%, -50%) scale(' + s + ')';
  }
  window.addEventListener('resize', fit); fit();

  function parseHash() {
    var m = location.hash.match(/^#(\d+)(?:\.(\d+))?/);
    if (!m) return null;
    var i = clamp(+m[1] - 1, 0, N - 1);
    return { i: i, step: clamp(m[2] ? +m[2] : 0, 0, steps[i]) };
  }

  function playVideos(changed, prevIdx) {
    if (MODE === 'presenter') return;
    slides.forEach(function (sl, k) {
      $$('video', sl).forEach(function (v) {
        if (v.hasAttribute('data-manual')) return; // driven by a hook
        if (k === cur) {
          clearTimeout(v._t);
          if (!changed && (v.ended || !v.paused)) return; // a build step must not restart a clip that played once
          if (changed) { v._held = false; try { v.currentTime = +(v.getAttribute('data-start') || 0); } catch (e) {} }
          if (v._held) return; // reached its stop point: hold the frame
          if (v.hasAttribute('data-sound')) v.muted = false;
          var p = v.play();
          // Sound blocked (no keypress in this window yet): play muted rather than not at all.
          if (p && p.catch) p.catch(function () { if (v.hasAttribute('data-sound')) { v.muted = true; var p2 = v.play(); if (p2 && p2.catch) p2.catch(function () {}); } });
        } else if (k === prevIdx || !v.paused) {
          clearTimeout(v._t);
          v._t = setTimeout(function () { v.pause(); }, STATIC ? 0 : 900);
        }
      });
    });
  }

  /* ---------- Corner timestamp ---------- */
  var clockEl = $('#clock'), clockA = clockEl && $('.a', clockEl), clockB = clockEl && $('.b', clockEl), clockText = null;
  function setClock(txt) {
    if (!clockEl || txt === clockText) return;
    clockText = txt;
    clockEl.classList.toggle('hidden', !txt);
    if (!txt) return;
    var incoming = clockA.classList.contains('out') || !clockA.textContent ? clockA : clockB;
    var outgoing = incoming === clockA ? clockB : clockA;
    incoming.textContent = txt;
    if (STATIC) { incoming.className = incoming === clockA ? 'a' : 'b'; outgoing.className = (outgoing === clockA ? 'a' : 'b') + ' out'; return; }
    incoming.classList.add('pre'); incoming.classList.remove('out');
    void incoming.offsetWidth;
    incoming.classList.remove('pre');
    if (outgoing.textContent) outgoing.classList.add('out');
  }

  /* ---------- Slide hooks ---------- */
  var HOOKS = {};
  function hookOf(k) { return k >= 0 && HOOKS[slides[k].getAttribute('data-hook')]; }

  function render(changed, prevIdx, prevStep, opts) {
    slides.forEach(function (sl, k) {
      var on = k === cur;
      sl.classList.toggle('active', on);
      sl.setAttribute('aria-hidden', on ? 'false' : 'true');
    });
    var s = slides[cur];
    s.setAttribute('data-step', step);
    $$('[data-build]', s).forEach(function (e) { e.classList.toggle('built', +e.getAttribute('data-build') <= step); });
    if (changed) { var hp = hookOf(prevIdx); if (hp && hp.leave) hp.leave(opts || {}); }
    var h = hookOf(cur);
    if (h) { if (changed && h.enter) h.enter(step); else if (!changed && h.step) h.step(step, prevStep); }
    playVideos(changed, prevIdx);
    setClock(s.getAttribute('data-time') || '');
    if (progress) progress.style.width = (TALK_END > 0 ? Math.min(1, cur / TALK_END) * 100 : 100) + '%';
    if (notesOv) notesOv.innerHTML = '<b>' + (cur + 1) + ' · ' + titles[cur] + '</b>' + notes[cur];
    if (MODE === 'presenter') renderPresenter();
  }

  var timerStarted = false;
  function go(i, s, opts) {
    opts = opts || {};
    i = clamp(i | 0, 0, N - 1);
    s = clamp(s | 0, 0, steps[i]);
    var prevIdx = cur, prevStep = step, changed = i !== cur;
    if (!changed && s === step && !opts.force) return;
    cur = i; step = s;
    if (MODE === 'presenter' && i === CALL_IDX && s === 1 && !timerStarted) { timerStarted = true; t0 = Date.now(); }
    render(changed, prevIdx, prevStep, opts);
    if (MODE === 'show' || MODE === 'presenter') {
      var hh = '#' + (i + 1) + (MODE === 'presenter' ? '.' + s : '');
      if (location.hash !== hh) history.replaceState(null, '', hh);
    }
    if (!opts.silent) send({ type: 'state', i: cur, step: step });
  }
  function hardCut(i, s) { // instant cut, no crossfade
    root.classList.add('hard-cut');
    go(i, s, { cut: true });
    void stage.offsetWidth;
    requestAnimationFrame(function () { requestAnimationFrame(function () { root.classList.remove('hard-cut'); }); });
  }
  function next() {
    var h = hookOf(cur); if (h && h.intercept && h.intercept()) return;
    if (step < steps[cur]) go(cur, step + 1); else if (cur < N - 1) go(cur + 1, 0);
  }
  function prev() { if (step > 0) go(cur, step - 1); else if (cur > 0) go(cur - 1, steps[cur - 1]); }

  /* ---------- 01 · The call ---------- */
  (function () {
    var slide = $('.s-call'); if (!slide) return;
    var CD = window.CALL_DATA || null;
    var canvas = $('.call-canvas', slide), ctx = canvas.getContext('2d'), track = $('.cap-track', slide);
    var phrases = [], words = [], segs = [];
    if (CD) {
      // Build caption phrases from the word timings: split at sentence ends, split long
      // sentences at a comma near the middle, then fold very short phrases into the next.
      CD.timeline.segments.forEach(function (sg) {
        segs.push({ who: sg.speaker, a: sg.offset, b: sg.offset + sg.duration });
        var cur = [], out = [];
        sg.words.forEach(function (w, k) {
          cur.push({ w: w.w, s: sg.offset + w.start, e: sg.offset + w.end });
          if (/[.?!]["”]?$/.test(w.w) || k === sg.words.length - 1) { out.push(cur); cur = []; }
        });
        var split = [];
        out.forEach(function (p) {
          var txt = p.map(function (x) { return x.w; }).join(' ');
          if (txt.length <= 64) { split.push(p); return; }
          var best = -1, bestD = 1e9, pos = 0;
          p.forEach(function (x, k) { pos += x.w.length + 1; if (/,$/.test(x.w) && k >= 2 && k <= p.length - 4) { var d = Math.abs(pos - txt.length / 2); if (d < bestD) { bestD = d; best = k; } } });
          if (best < 0) split.push(p); else { split.push(p.slice(0, best + 1)); split.push(p.slice(best + 1)); }
        });
        for (var k = 0; k < split.length; k++) {
          if (split[k].length < 3 && k + 1 < split.length) { split[k + 1] = split[k].concat(split[k + 1]); continue; }
          phrases.push({ who: sg.speaker, words: split[k] });
        }
      });
      phrases.forEach(function (p) {
        p.a = p.words[0].s; p.b = p.words[p.words.length - 1].e;
        p.el = el('div', 'ph ' + p.who);
        p.el.appendChild(el('span', 'who', p.who === 'navigator' ? 'Community Response Navigator' : 'Caller'));
        var line = el('div', 'line');
        p.words.forEach(function (w, k) { w.el = el('span', 'w', w.w); line.appendChild(w.el); if (k < p.words.length - 1) line.appendChild(document.createTextNode(' ')); words.push(w); });
        p.el.appendChild(line); track.appendChild(p.el);
      });
    }
    var cue = CD ? CD.timeline.cue.at : 38.4;
    var env = CD ? CD.env : { hop: 0.02, values: [] };
    var audio = null, state = 'idle', cueFired = false, curPh = -2, lv = { navigator: 0, caller: 0 };

    if (MODE === 'show') {
      audio = new Audio(); audio.preload = 'auto'; audio.src = C.callAudio || 'assets/audio/call/call-full.mp3';
      audio.addEventListener('ended', function () { if (state === 'playing') state = 'done'; });
    }
    function loud(t) { var v = env.values[Math.floor(t / env.hop)]; return v || 0; }
    function speakerAt(t) { for (var k = 0; k < segs.length; k++) if (t >= segs[k].a - 0.05 && t <= segs[k].b + 0.08) return segs[k].who; return null; }

    function caption(t) {
      var idx = -1;
      for (var k = 0; k < phrases.length; k++) if (phrases[k].a <= t + 0.04) idx = k;
      if (idx !== curPh) {
        curPh = idx;
        phrases.forEach(function (p, k) { p.el.classList.toggle('cur', k === idx); p.el.classList.toggle('prev', k === idx - 1); });
        track.style.transform = idx >= 0 ? 'translateY(' + (-phrases[idx].el.offsetTop) + 'px)' : 'none';
      }
      words.forEach(function (w) { var on = w.s <= t + 0.04; if (on !== w.on) { w.on = on; w.el.classList.toggle('on', on); } });
    }

    // Visual: the Navigator is a glowing green orb, the caller a warm white waveform.
    var NAV = { x: 700, y: 300, r: 104 }, CAL = { x: 1230, y: 300, w: 380 };
    function draw(t, clockT, live) {
      var who = live ? speakerAt(t) : null, amp = live ? loud(t) : 0;
      ['navigator', 'caller'].forEach(function (k) {
        var target = who === k ? Math.min(1, amp * 1.15) : 0;
        lv[k] += (target - lv[k]) * (target > lv[k] ? 0.45 : 0.14);
      });
      if (!live && arguments[3]) { lv.navigator = arguments[3].navigator; lv.caller = arguments[3].caller; }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var started = state !== 'idle' || arguments[3];
      var navOn = who === 'navigator' || (arguments[3] && arguments[3].navigator > 0.1);
      var calOn = who === 'caller' || (arguments[3] && arguments[3].caller > 0.1);
      // orb
      var L = lv.navigator, br = 0.5 + 0.5 * Math.sin(clockT * 1.3), base = started ? (navOn ? 1 : 0.55) : 0.32 + 0.08 * br;
      var R = NAV.r * (1 + 0.16 * L);
      var g = ctx.createRadialGradient(NAV.x, NAV.y, R * 0.4, NAV.x, NAV.y, R * 3.4);
      g.addColorStop(0, 'rgba(43,212,125,' + (0.30 * base + 0.25 * L) + ')'); g.addColorStop(0.45, 'rgba(15,107,58,' + (0.14 * base + 0.1 * L) + ')'); g.addColorStop(1, 'rgba(15,107,58,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(NAV.x, NAV.y, R * 3.4, 0, 6.2832); ctx.fill();
      var bars = 84;
      ctx.lineCap = 'round';
      for (var i = 0; i < bars; i++) {
        var ang = i / bars * 6.2832, n = 0.55 + 0.45 * Math.sin(i * 1.71 + clockT * 7.3) * Math.sin(i * 0.37 - clockT * 4.1);
        var len = 4 + L * 70 * n * (REDUCED ? 0.5 : 1);
        var r0 = R * 1.22;
        ctx.strokeStyle = 'rgba(43,212,125,' + (0.18 + 0.6 * L) * base + ')'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(NAV.x + Math.cos(ang) * r0, NAV.y + Math.sin(ang) * r0);
        ctx.lineTo(NAV.x + Math.cos(ang) * (r0 + len), NAV.y + Math.sin(ang) * (r0 + len)); ctx.stroke();
      }
      var core = ctx.createRadialGradient(NAV.x - R * 0.3, NAV.y - R * 0.35, R * 0.05, NAV.x, NAV.y, R);
      core.addColorStop(0, 'rgba(235,255,244,' + (0.55 + 0.45 * base) + ')'); core.addColorStop(0.35, 'rgba(43,212,125,' + (0.5 + 0.5 * base) + ')');
      core.addColorStop(1, 'rgba(15,107,58,' + (0.6 * base) + ')');
      ctx.fillStyle = core; ctx.beginPath(); ctx.arc(NAV.x, NAV.y, R, 0, 6.2832); ctx.fill();
      // caller waveform
      var Lc = lv.caller, cb = started ? (calOn ? 1 : 0.4) : 0.22, nb = 38, bw = 6, gap = (CAL.w - nb * bw) / (nb - 1);
      for (var j = 0; j < nb; j++) {
        var x = CAL.x - CAL.w / 2 + j * (bw + gap), shape = Math.sin((j + 0.5) / nb * Math.PI);
        var nz = 0.5 + 0.5 * Math.abs(Math.sin(j * 2.13 + clockT * 9.1) * Math.cos(j * 0.71 - clockT * 5.7));
        var h = 6 + Lc * 230 * shape * nz * (REDUCED ? 0.6 : 1);
        ctx.fillStyle = 'rgba(255,241,226,' + (0.25 + 0.75 * cb) + ')';
        if (Lc > 0.05) { ctx.shadowColor = 'rgba(255,241,226,.6)'; ctx.shadowBlur = 16 * Lc; } else ctx.shadowBlur = 0;
        roundRect(x, CAL.y - h / 2, bw, h, 3);
      }
      ctx.shadowBlur = 0;
    }
    function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.fill(); }

    function reset() {
      state = 'idle'; cueFired = false; slide.classList.remove('call-blocked');
      if (audio) { audio.pause(); try { audio.currentTime = 0; } catch (e) {} }
      caption(-1);
    }
    function start() {
      if (MODE !== 'show') { // presenter and previews never play sound
        if (STATIC) staticFrame(); return;
      }
      if (STATIC) { staticFrame(); return; }
      reset();
      audio.volume = 1;
      var p = audio.play();
      state = 'starting';
      if (p && p.then) p.then(function () { state = 'playing'; slide.classList.remove('call-blocked'); },
        function () { state = 'blocked'; slide.classList.add('call-blocked'); });
      else state = 'playing';
    }
    function staticFrame() { // print, previews, ?static: a representative moment, caller mid-line
      var T = 10.75; caption(T); draw(T, 2.0, false, { navigator: 0, caller: 0.75 });
    }
    function duckAndFinish() {
      if (!audio) return;
      var v0 = audio.volume, target = C.callDuckVolume != null ? C.callDuckVolume : 0.35, t0 = performance.now();
      (function fade() { var k = Math.min(1, (performance.now() - t0) / 250); audio.volume = v0 + (target - v0) * k; if (k < 1) requestAnimationFrame(fade); })();
    }
    function fadeOut() {
      if (!audio || audio.paused) { state = 'idle'; return; }
      var v0 = audio.volume, t0 = performance.now();
      (function fade() { var k = Math.min(1, (performance.now() - t0) / 400); audio.volume = v0 * (1 - k); if (k < 1) requestAnimationFrame(fade); else audio.pause(); })();
      state = 'idle';
    }

    HOOKS.call = {
      enter: function (s) {
        root.classList.add('on-call');
        if (STATIC) { if (s >= 1) staticFrame(); else { caption(-1); draw(0, 0, false); } return; }
        // Arriving at step 1 from another slide (e.g. going back): show the finished transcript, no audio.
        reset();
        if (s >= 1) { caption(99); state = 'shown'; }
      },
      step: function (s, ps) { if (s === 1 && ps === 0) start(); else if (s === 0) reset(); },
      leave: function (o) { root.classList.remove('on-call'); if (o.cut) { state = 'tail'; duckAndFinish(); } else fadeOut(); slide.classList.remove('call-blocked'); },
      intercept: function () { // a click while the browser blocked the audio retries it instead of advancing
        if (state === 'blocked') { start(); return true; }
        return false;
      },
      frame: function (now) {
        if (STATIC) return;
        var playing = audio && (state === 'playing' || state === 'starting') && !audio.paused;
        var t = playing ? audio.currentTime : (state === 'shown' ? 99 : -1);
        if (playing || state === 'shown') caption(t);
        draw(t, now / 1000, playing);
        if (playing && !cueFired && t >= cue && cur === CALL_IDX) { cueFired = true; hardCut(CALL_IDX + 1, 0); }
      },
      debug: function () { return { state: state, t: audio ? audio.currentTime : null, revealed: words.filter(function (w) { return w.on; }).length, phrase: curPh, words: words.length }; },
      words: function () { return words.map(function (w) { return { w: w.w, s: w.s }; }); }
    };
  })();

  /* ---------- 02 · Push: camera choreography over the real clip or the synthetic fallback ---------- */
  var push = { synth: null, synthT0: 0 };
  function pushFallback(scr, video) {
    var f = (A.push && A.push.fallback) || {};
    push.failed = true;
    var s = el('div', 'synth');
    s.innerHTML = '<div class="wall"></div><div class="date">' + (f.lockDate || '') + '</div><div class="time">' + (f.lockTime || '4:09') + '</div>' +
      '<div class="notif"><span class="ic"><i data-icon="shield"></i></span><span class="app">ComForce MKE</span><span class="when">now</span>' +
      '<span class="ttl">Urgent request</span><span class="bd">Someone needs help today. Open the app to respond.</span></div><div class="bar"></div>' +
      '<div class="app-layer"></div>';
    icons(s);
    var layer = $('.app-layer', s), av = null;
    if (f.appVideo && !POSTERS) {
      av = document.createElement('video'); av.muted = true; av.playsInline = true; av.preload = 'auto'; av.setAttribute('data-manual', '');
      av.src = f.appVideo; if (f.appPoster) av.poster = f.appPoster; layer.appendChild(av);
      av.addEventListener('error', function () { layer.innerHTML = ''; layer.appendChild(posterImg(f.appPoster)); av = null; push.av = null; });
    } else layer.appendChild(posterImg(f.appPoster));
    if (video && video.parentNode) video.parentNode.replaceChild(s, video); else scr.insertBefore(s, scr.firstChild);
    push.synth = s; push.av = av; push.video = null;
    if (cur >= 0 && slides[cur].getAttribute('data-hook') === 'push') { push.synthT0 = performance.now(); }
    if (STATIC) pushStatic();
    if (MODE === 'presenter') reportMedia();
  }
  function pushStatic() { // final state for print and previews
    if (!push.synth) return;
    $('.notif', push.synth).classList.add('in'); $('.app-layer', push.synth).classList.add('in');
  }
  (function () {
    var slide = $('.s-push'); if (!slide) return;
    var ph = $('.push-phone', slide), tap = ph && $('.tap', ph), cfg = A.push || {};
    push.video = ph && $('video', ph);
    if (push.video) push.video.addEventListener('ended', function () {}); // holds the last frame (loop is off)
    var kf = cfg.camera || [[0, 1, .5, .5]];
    function ease(x) { return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
    function camAt(t) {
      if (t <= kf[0][0]) return kf[0];
      for (var k = 1; k < kf.length; k++) if (t < kf[k][0]) {
        var a = kf[k - 1], b = kf[k], u = ease((t - a[0]) / (b[0] - a[0]));
        return [t, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u, (a[4] || 0) + ((b[4] || 0) - (a[4] || 0)) * u];
      }
      return kf[kf.length - 1];
    }
    function clipTime() {
      if (push.synth) return (performance.now() - push.synthT0) / 1000;
      return push.video ? push.video.currentTime : 0;
    }
    function apply(t) {
      var c = REDUCED ? [t, 1, .5, .5, 0] : camAt(t), W = ph.offsetWidth, H = ph.offsetHeight;
      var s = c[1], dx = -s * (c[2] - .5) * W + (c[4] || 0), dy = -s * (c[3] - .5) * H;
      ph.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) scale(' + s.toFixed(4) + ')';
      if (tap && cfg.tap) {
        var on = t >= cfg.tap.t && t < cfg.tap.t + 1;
        if (on && !tap.classList.contains('go')) { tap.style.left = (cfg.tap.x * 100) + '%'; tap.style.top = (cfg.tap.y * 100) + '%'; tap.classList.add('go'); }
        if (t < cfg.tap.t) tap.classList.remove('go');
      }
      if (push.synth) {
        var f = cfg.fallback || {};
        $('.notif', push.synth).classList.toggle('in', t >= 2.0);
        var appOn = t >= (f.appAt || 5.8);
        $('.app-layer', push.synth).classList.toggle('in', appOn);
        if (push.av) {
          if (appOn && push.av.paused && !push.av._started) { push.av._started = true; try { push.av.currentTime = 0; } catch (e) {} var p = push.av.play(); if (p && p.catch) p.catch(function () {}); }
          if (!appOn && push.av._started) { push.av._started = false; push.av.pause(); try { push.av.currentTime = 0; } catch (e) {} }
        }
      }
    }
    HOOKS.push = {
      enter: function () {
        if (STATIC) { ph.style.transform = 'none'; pushStatic(); return; }
        push.synthT0 = performance.now();
        if (push.av) { push.av._started = false; push.av.pause(); }
        apply(0);
      },
      leave: function () { if (push.av) setTimeout(function () { if (push.av) push.av.pause(); }, 900); },
      frame: function () { if (!STATIC) apply(clipTime()); },
      debug: function () { return { synth: !!push.synth, t: clipTime(), transform: ph.style.transform, failed: !!push.failed }; }
    };
  })();

  /* ---------- One animation loop for hooks and clip end points ---------- */
  function loop(now) {
    if (cur >= 0) {
      var h = hookOf(cur); if (h && h.frame) h.frame(now);
      $$('video[data-end]', slides[cur]).forEach(function (v) { if (v.currentTime >= +v.getAttribute('data-end')) { try { v.currentTime = 0; } catch (e) {} } });
      $$('video[data-stop]', slides[cur]).forEach(function (v) { if (!v._held && v.currentTime >= +v.getAttribute('data-stop')) { v._held = true; v.pause(); } });
    }
    requestAnimationFrame(loop);
  }
  if (MODE === 'show' || P.has('static')) requestAnimationFrame(loop);

  /* ---------- Black screen, notes, hairline ---------- */
  var isBlack = false;
  function setBlack(on, silent) {
    isBlack = !!on;
    if (black) black.classList.toggle('on', isBlack);
    if (MODE === 'presenter') renderPresenter();
    if (!silent) send({ type: 'black', on: isBlack });
  }
  function toggleNotes() { if (notesOv) notesOv.classList.toggle('on'); }
  function setHairline(on) { root.classList.toggle('no-hairline', !on); store(CH + ':hairline', on ? '1' : '0'); }
  setHairline(store(CH + ':hairline') !== '0');
  function toggleFS() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {});
  }

  /* ---------- Sync between the deck and presenter windows ---------- */
  var ME = Math.random().toString(36).slice(2), seq = 0, seen = {}, presenterWin = null, bc = null;
  try { bc = new BroadcastChannel(CH); } catch (e) {}
  function send(msg) {
    if (MODE === 'preview' || MODE === 'print') return;
    msg.from = ME; msg.seq = ++seq;
    var wrapped = {}; wrapped[CH] = msg;
    try { if (bc) bc.postMessage(msg); } catch (e) {}
    try { localStorage.setItem(CH, JSON.stringify(msg)); } catch (e) {}
    try { if (window.opener && !window.opener.closed) window.opener.postMessage(wrapped, '*'); } catch (e) {}
    try { if (presenterWin && !presenterWin.closed) presenterWin.postMessage(wrapped, '*'); } catch (e) {}
  }
  var lastPeer = 0;
  function receive(msg) {
    if (!msg || msg.from === ME || MODE === 'preview' || MODE === 'print') return;
    if (seen[msg.from] >= msg.seq) return;
    seen[msg.from] = msg.seq;
    lastPeer = Date.now();
    if (msg.type === 'state') {
      // the deck window owns the call: a presenter click on the call slide is treated like a local click
      if (MODE === 'show' && msg.i === cur && msg.step === step + 1) { next(); return; }
      go(msg.i, msg.step, { silent: true });
    }
    else if (msg.type === 'black') setBlack(msg.on, true);
    else if (msg.type === 'hello' && MODE === 'show') {
      send({ type: 'state', i: cur, step: step });
      if (isBlack) send({ type: 'black', on: true });
    }
  }
  if (bc) bc.onmessage = function (e) { receive(e.data); };
  window.addEventListener('storage', function (e) {
    if (e.key === CH && e.newValue) { try { receive(JSON.parse(e.newValue)); } catch (err) {} }
  });
  window.addEventListener('message', function (e) { if (e.data && e.data[CH]) receive(e.data[CH]); });

  function openPresenter() {
    if (MODE !== 'show') return;
    presenterWin = window.open(BASE + '?presenter#' + (cur + 1) + '.' + step, 'comforce-presenter', 'popup,width=1400,height=860');
  }

  /* ---------- Keys and clicks ---------- */
  var buf = '', bufT = 0;
  function showBuf() {
    if (jump) { jump.textContent = 'Go to ' + buf + ' ⏎'; jump.classList.add('on'); }
    clearTimeout(bufT); bufT = setTimeout(clearBuf, 3000);
    if (MODE === 'presenter') renderPresenter();
  }
  function clearBuf() { buf = ''; if (jump) jump.classList.remove('on'); if (MODE === 'presenter') renderPresenter(); }

  var NEXT = ['ArrowRight', 'ArrowDown', ' ', 'Spacebar', 'PageDown', 'Enter'];
  var PREV = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'];
  if (MODE === 'show' || MODE === 'presenter') {
    window.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var k = e.key;
      if (/^[0-9]$/.test(k)) { buf = (buf + k).slice(-3); showBuf(); e.preventDefault(); return; }
      if (k === 'Enter' && buf) { e.preventDefault(); var n = +buf; clearBuf(); if (n >= 1) go(n - 1, 0); return; }
      if (k === 'Escape') { if (buf) clearBuf(); else if (isBlack) setBlack(false); return; }
      if (k === 'F5') { e.preventDefault(); if (MODE === 'show') toggleFS(); return; } // clickers send F5: never reload
      if (NEXT.indexOf(k) >= 0 || PREV.indexOf(k) >= 0) {
        e.preventDefault();
        if (isBlack) { setBlack(false); return; }
        if (NEXT.indexOf(k) >= 0) next(); else prev();
        return;
      }
      if (k === 'Home') { e.preventDefault(); go(0, 0); return; }
      if (k === 'End') { e.preventDefault(); go(TALK_END, steps[TALK_END]); return; } // the close, not the appendix
      switch (k.toLowerCase()) {
        case 'f': if (MODE === 'show') toggleFS(); break;
        case 'b': case '.': case 'w': setBlack(!isBlack); break;
        case 'n': toggleNotes(); break;
        case 'p': openPresenter(); break;
        case 'h': setHairline(root.classList.contains('no-hairline')); break;
        case 'r': if (MODE === 'presenter') { t0 = Date.now(); tAppx = 0; timerStarted = true; } break;
        default: return;
      }
      e.preventDefault();
    });
  }
  var vp = $('#viewport');
  if (MODE === 'show' && vp) {
    vp.addEventListener('click', function (e) {
      if (notesOv && notesOv.contains(e.target)) return;
      if (isBlack) { setBlack(false); return; }
      if (e.clientX < window.innerWidth / 2) prev(); else next();
    });
    vp.addEventListener('contextmenu', function (e) { e.preventDefault(); prev(); });
    var idle = 0;
    window.addEventListener('mousemove', function () {
      vp.classList.remove('hide-cursor'); clearTimeout(idle);
      idle = setTimeout(function () { vp.classList.add('hide-cursor'); }, 2200);
    });
  }
  if (MODE === 'preview') window.addEventListener('hashchange', function () { var h = parseHash(); if (h) go(h.i, h.step, { silent: true }); });
  if (MODE === 'show') window.addEventListener('hashchange', function () { var h = parseHash(); if (h && h.i !== cur) go(h.i, h.step); });

  /* ---------- Presenter view ---------- */
  var t0 = Date.now(), tAppx = 0, pv = null, media = [];
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function mmss(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + pad(s % 60); }
  function renderPresenter() {
    if (!pv) return;
    pv.count.innerHTML = (cur + 1) + ' / ' + N + (steps[cur] ? '<small>build ' + step + ' of ' + steps[cur] + '</small>' : '') +
      (isBlack ? '<small style="color:#ff6b6b">BLACK</small>' : '') + (buf ? '<small>go to ' + buf + ' ⏎</small>' : '');
    pv.curFrame.src = BASE + '?preview#' + (cur + 1) + '.' + step;
    var ni, ns, label;
    if (step < steps[cur]) { ni = cur; ns = step + 1; label = 'Next build: ' + titles[cur]; }
    else if (cur < N - 1) { ni = cur + 1; ns = 0; label = 'Next: ' + (ni + 1) + ' · ' + titles[ni]; }
    else { ni = -1; label = 'End of deck'; }
    pv.nextTitle.textContent = label;
    if (ni >= 0) { pv.nextFrame.style.visibility = 'visible'; pv.nextFrame.src = BASE + '?preview#' + (ni + 1) + '.' + ns; }
    else pv.nextFrame.style.visibility = 'hidden';
    pv.notes.innerHTML = notes[cur] || '<span style="opacity:.6">No notes.</span>';
    fitNotes(); tick();
  }
  function fitNotes() { // shrink the notes until they fit: nobody can scroll while holding a clicker
    var box = pv.notes, size = 30;
    box.style.fontSize = size + 'px';
    while (size > 14 && box.scrollHeight > box.clientHeight + 1) { size -= 1; box.style.fontSize = size + 'px'; }
  }
  window.addEventListener('resize', function () { if (pv) fitNotes(); });
  function tick() {
    if (!pv) return;
    // In the appendix the talk timer holds where the talk ended.
    if (isAppx(cur)) { if (!tAppx) tAppx = Date.now(); } else tAppx = 0;
    var s = Math.floor(((tAppx || Date.now()) - t0) / 1000);
    pv.timer.textContent = pad(Math.floor(s / 60)) + ':' + pad(s % 60);
    var tg = targets[cur];
    if (tg) {
      var txt, cls;
      if (tg.pre) { txt = 'Pre-show · not timed · the timer starts with the call'; cls = ''; }
      else if (tg.appendix) { txt = 'Appendix · not timed' + (timerStarted ? ' · talk ran ' + mmss(s) : ''); cls = ''; }
      else if (!timerStarted) { txt = 'Target ' + tg.label + ' · timer starts with the call'; cls = ''; }
      else if (s > tg.b) { txt = 'Target ' + tg.label + ' · ' + mmss(s - tg.b) + ' over'; cls = 'over'; }
      else if (s < tg.a) { txt = 'Target ' + tg.label + ' · ' + mmss(tg.a - s) + ' ahead'; cls = 'ok'; }
      else { txt = 'Target ' + tg.label + ' · on pace, ' + mmss(tg.b - s) + ' left'; cls = 'ok'; }
      pv.pace.textContent = txt; pv.pace.className = 'pace ' + cls;
    }
    var d = new Date(), h = d.getHours() % 12 || 12;
    pv.clock.textContent = h + ':' + pad(d.getMinutes()) + (d.getHours() < 12 ? ' AM' : ' PM');
    pv.sync.textContent = lastPeer ? 'synced with deck' : 'waiting for the deck window (press P there, or open both)';
  }
  function reportMedia() {
    if (!pv) return;
    pv.media.innerHTML = media.map(function (m) {
      var cls = m.st === 'ok' ? 'ok' : m.st === 'fb' ? 'fb' : m.st === 'bad' ? 'bad' : '';
      var mark = m.st === 'ok' ? '✓' : m.st === 'fb' ? '○' : m.st === 'bad' ? '✗' : '…';
      var tail = m.st === 'ok' ? 'found' : m.st === 'fb' ? 'fallback' : m.st === 'bad' ? 'missing' : 'checking';
      return '<div class="' + cls + '">' + mark + ' ' + m.name + ' · ' + tail + '</div>';
    }).join('');
  }
  function probeMedia() {
    var list = [{ name: (C.callAudio || 'assets/audio/call/call-full.mp3').split('/').pop(), src: C.callAudio || 'assets/audio/call/call-full.mp3', audio: true, miss: 'bad' }];
    list.push({ name: 'call-data.js (captions)', st: window.CALL_DATA ? 'ok' : 'bad' });
    Object.keys(A).forEach(function (k) {
      var a = A[k]; if (!a || typeof a !== 'object' || !a.video) return;
      list.push({ name: a.video.split('/').pop(), src: a.video, miss: k === 'push' ? 'fb' : 'bad' });
    });
    media = list;
    list.forEach(function (m) {
      if (!m.src) return;
      var v = document.createElement(m.audio ? 'audio' : 'video'); v.preload = 'metadata'; v.muted = true;
      v.onloadedmetadata = function () { m.st = 'ok'; reportMedia(); v.removeAttribute('src'); v.load(); };
      v.onerror = function () { m.st = m.miss; reportMedia(); };
      v.src = m.src;
    });
    reportMedia();
  }
  if (MODE === 'presenter') {
    document.title = 'Presenter · ' + document.title;
    var pe = $('#presenter');
    pe.innerHTML =
      '<div class="bar"><div class="count"></div><div class="timer" title="Click (or R) to reset">00:00</div><div class="pace"></div><div class="clock"></div>' +
      '<div class="grow"></div><div class="sync"></div><button data-a="prev">◀ Prev</button><button data-a="next">Next ▶</button><button data-a="black">B</button></div>' +
      '<div class="main"><div class="top"><div class="col"><div class="lbl">Now</div><div class="frame"><iframe class="cur" title="Current slide"></iframe></div></div>' +
      '<div class="col"><div class="lbl">Up next</div><div class="frame"><iframe class="next" title="Next slide"></iframe></div><div class="next-title"></div></div>' +
      '<div class="side"><div class="lbl">Media</div><div class="media"></div>' +
      '<div class="help">→ Space PageDown: next · ← PageUp: back · number + Enter: jump · B: black · R: reset timer · Home/End. ' +
      'The timer starts when you start the call. Press F in the deck window once before the call so Chrome lets it play sound.</div></div></div>' +
      '<div class="notes-col"><div class="lbl">Notes</div><div class="notes-box"></div></div></div>';
    pv = {
      count: $('.count', pe), timer: $('.timer', pe), pace: $('.pace', pe), clock: $('.clock', pe), sync: $('.sync', pe), media: $('.media', pe),
      curFrame: $('iframe.cur', pe), nextFrame: $('iframe.next', pe), nextTitle: $('.next-title', pe), notes: $('.notes-box', pe)
    };
    pv.timer.addEventListener('click', function () { t0 = Date.now(); tAppx = 0; timerStarted = true; tick(); });
    pe.addEventListener('click', function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-a');
      if (a === 'prev') prev(); else if (a === 'next') next(); else if (a === 'black') setBlack(!isBlack);
    });
    setInterval(tick, 500);
    probeMedia();
  }

  /* ---------- Start ---------- */
  var start = parseHash() || { i: 0, step: 0 };
  go(start.i, start.step, { silent: true, force: true });
  if (MODE === 'presenter') send({ type: 'hello' });
  if (MODE === 'show') send({ type: 'state', i: cur, step: step });

  window.deck = {
    count: N, steps: steps, titles: titles, mode: MODE, targets: targets,
    go: function (i, s) { go(i, s); }, next: next, prev: prev,
    state: function () { return { i: cur, step: step, black: isBlack }; },
    call: function () { return HOOKS.call && HOOKS.call.debug(); },
    callWords: function () { return HOOKS.call && HOOKS.call.words(); },
    push: function () { return HOOKS.push && HOOKS.push.debug(); },
    media: function () { return media; }
  };
})();
