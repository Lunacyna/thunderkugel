/* ==========================================================================
   Lunacynas Spielezimmer – interaktiver Hintergrund (Startseite)
   Zeichnet auf <canvas id="sky" aria-hidden="true">:
     · Himmel passend zum Theme (Sternennacht: Sterne + Sternschnuppen,
       Kaminabend: warmes Glimmen + aufsteigende Funken)
     · Klick/Tap auf eine freie Fläche -> Pfotenabdruck + Funkel-Partikel,
       die nach ~1,6 s sanft ausfaden
   Einbinden: <script src="/assets/cozy/sky.js?v=1" defer></script>
   Performance:
     · Hintergrund-Verlauf wird nur bei Resize/Theme-Wechsel in einen
       Offscreen-Canvas gerendert, pro Frame nur noch drawImage
     · Partikel liegen in einem Array mit fester Obergrenze; tote werden
       in jedem Frame entfernt (swap-remove, keine neuen Arrays)
     · Resize ist entprellt; Sterne haben relative Koordinaten und
       springen beim Ein-/Ausblenden der Handy-Adressleiste nicht
     · Bei prefers-reduced-motion steht der Himmel still; Pfoten erscheinen
       trotzdem, aber ohne Flug-Partikel, und der Loop läuft nur solange
       etwas ausfadet
   ========================================================================== */
(function () {
  'use strict';
  var cv = document.getElementById('sky');
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext('2d');
  var bgCv = document.createElement('canvas'), bgCtx = bgCv.getContext('2d');
  var rmq = matchMedia('(prefers-reduced-motion: reduce)');
  var reduce = rmq.matches;

  var PAL = {
    nacht: { sky: ['#120F2E', '#1D1842', '#3B2E66', '#6E4A78'], glow: 'rgba(253,213,187,.16)', haze: 'rgba(242,167,168,.28)',
             star: '246,230,255', paw: '246,230,255', pawGlow: 'rgba(199,125,255,.85)', spark: ['246,230,255', '199,125,255', '253,213,187'] },
    kamin: { sky: ['#1A1714', '#221E1A', '#342A23', '#5A3826'], glow: 'rgba(255,201,156,.10)', haze: 'rgba(245,120,70,.32)',
             star: '255,214,170', paw: '255,233,207', pawGlow: 'rgba(255,169,77,.9)', spark: ['255,214,170', '255,169,77', '245,130,80'] }
  };
  function themeName() { return document.documentElement.getAttribute('data-theme') === 'kamin' ? 'kamin' : 'nacht'; }
  var theme = themeName(), pal = PAL[theme];

  var W = 0, H = 0, dpr = 1, stars = [];
  var MAX_PARTS = 140, MAX_PAWS = 14;
  var parts = [];   // Funkel-Partikel & Glut
  var paws = [];    // Pfotenabdrücke
  var shoots = [];

  function makeStars() {
    var n = Math.min(420, Math.round(W * H / 5200));
    stars = [];
    for (var i = 0; i < n; i++) stars.push({ fx: Math.random(), fy: Math.random() * 0.85, r: Math.random() * 1.3 + 0.3, p: Math.random() * 6.283, s: 0.6 + Math.random() * 1.6 });
  }
  function paintBg() {
    bgCv.width = cv.width; bgCv.height = cv.height;
    bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var g = bgCtx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, pal.sky[0]); g.addColorStop(0.55, pal.sky[1]); g.addColorStop(0.85, pal.sky[2]); g.addColorStop(1, pal.sky[3]);
    bgCtx.fillStyle = g; bgCtx.fillRect(0, 0, W, H);
    var m = bgCtx.createRadialGradient(W * 0.86, H * 0.12, 0, W * 0.86, H * 0.12, Math.max(W, H) * 0.45);
    m.addColorStop(0, pal.glow); m.addColorStop(1, 'rgba(0,0,0,0)');
    bgCtx.fillStyle = m; bgCtx.fillRect(0, 0, W, H);
    var h = bgCtx.createRadialGradient(W * 0.5, H * 1.15, 0, W * 0.5, H * 1.15, W * 0.8);
    h.addColorStop(0, pal.haze); h.addColorStop(1, 'rgba(0,0,0,0)');
    bgCtx.fillStyle = h; bgCtx.fillRect(0, 0, W, H);
  }
  var lastArea = 0;
  function size() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var area = W * H;
    // Sterne nur neu würfeln, wenn sich die Fläche deutlich ändert (nicht bei der Adressleiste)
    if (!stars.length || Math.abs(area - lastArea) / (lastArea || 1) > 0.25) { makeStars(); lastArea = area; }
    paintBg();
    if (!running) drawFrame(performance.now());
  }
  var rT = 0;
  window.addEventListener('resize', function () { clearTimeout(rT); rT = setTimeout(size, 120); });

  /* ---- Pfoten & Partikel ------------------------------------------------ */
  function addPaw(x, y) {
    if (paws.length >= MAX_PAWS) paws.shift();
    // leicht zufällig gedreht, wie ein Kätzchen, das vorbeitapst
    paws.push({ x: x, y: y, rot: (Math.random() - 0.5) * 0.9, size: 13 + Math.random() * 4, born: performance.now(), life: 1600 });
    if (reduce) return;
    var n = 9;
    for (var i = 0; i < n; i++) {
      if (parts.length >= MAX_PARTS) break;
      var a = (i / n) * Math.PI * 2 + Math.random() * 0.5, sp = 0.6 + Math.random() * 1.6;
      parts.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.4, r: 1 + Math.random() * 1.8,
                   life: 1, decay: 0.012 + Math.random() * 0.012, c: pal.spark[i % pal.spark.length], star: Math.random() < 0.35, g: theme === 'kamin' ? -0.02 : 0.012 });
    }
  }
  function drawPaw(p, now) {
    var t = (now - p.born) / p.life;
    if (t >= 1) return false;
    // schnell rein (pop), sanft raus
    var inT = Math.min(1, t / 0.12), alpha = t < 0.12 ? inT : 1 - (t - 0.12) / 0.88;
    alpha = alpha * alpha * (3 - 2 * alpha); // smoothstep
    var sc = p.size * (reduce ? 1 : 0.7 + 0.3 * (1 - Math.pow(1 - inT, 3)));
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(sc / 10, sc / 10);
    ctx.globalAlpha = alpha * 0.92;
    ctx.fillStyle = 'rgb(' + pal.paw + ')';
    ctx.shadowColor = pal.pawGlow; ctx.shadowBlur = 14;
    // Ballen
    ctx.beginPath();
    ctx.moveTo(0, 2); ctx.bezierCurveTo(5.5, 2, 8, 7, 7, 10); ctx.bezierCurveTo(6, 13, 2.5, 12.2, 0, 12.2);
    ctx.bezierCurveTo(-2.5, 12.2, -6, 13, -7, 10); ctx.bezierCurveTo(-8, 7, -5.5, 2, 0, 2); ctx.fill();
    // vier Zehen
    oval(-7.6, -2.2, 2.3, 3.1, -0.35); oval(-2.7, -6.6, 2.4, 3.3, -0.1); oval(2.7, -6.6, 2.4, 3.3, 0.1); oval(7.6, -2.2, 2.3, 3.1, 0.35);
    ctx.restore();
    return true;
  }
  function oval(x, y, rx, ry, r) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, r, 0, 6.283); ctx.fill(); }
  function drawStar4(x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y - r * 2.4); ctx.quadraticCurveTo(x, y, x + r * 2.4, y); ctx.quadraticCurveTo(x, y, x, y + r * 2.4);
    ctx.quadraticCurveTo(x, y, x - r * 2.4, y); ctx.quadraticCurveTo(x, y, x, y - r * 2.4); ctx.fill();
  }
  function stepParts() {
    for (var i = parts.length - 1; i >= 0; i--) {
      var q = parts[i];
      q.x += q.vx; q.y += q.vy; q.vx *= 0.97; q.vy = q.vy * 0.97 + q.g; q.life -= q.decay;
      if (q.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }   // Cleanup ohne neue Arrays
      ctx.globalAlpha = q.life;
      ctx.fillStyle = 'rgb(' + q.c + ')';
      if (q.star) drawStar4(q.x, q.y, q.r * 0.9);
      else { ctx.beginPath(); ctx.arc(q.x, q.y, q.r * (0.5 + q.life * 0.5), 0, 6.283); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }

  /* ---- Ambient: Sternschnuppen bzw. aufsteigende Funken ----------------- */
  var nextShoot = 1500, nextEmber = 0;
  function ambient(t) {
    if (theme === 'nacht') {
      if (t > nextShoot) {
        nextShoot = t + 3500 + Math.random() * 5000;
        var ang = Math.PI * (0.78 + Math.random() * 0.1);
        shoots.push({ x: W * (0.3 + Math.random() * 0.7), y: H * Math.random() * 0.35, vx: Math.cos(ang) * 9, vy: Math.sin(ang) * 3.2, life: 1 });
      }
      for (var i = shoots.length - 1; i >= 0; i--) {
        var s = shoots[i]; s.x += s.vx; s.y += s.vy; s.life -= 0.012;
        if (s.life <= 0) { shoots.splice(i, 1); continue; }
        var tx = s.x - s.vx * 14, ty = s.y - s.vy * 14, lg = ctx.createLinearGradient(s.x, s.y, tx, ty);
        lg.addColorStop(0, 'rgba(255,240,220,' + s.life + ')'); lg.addColorStop(1, 'rgba(255,240,220,0)');
        ctx.strokeStyle = lg; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(tx, ty); ctx.stroke();
      }
    } else if (t > nextEmber && parts.length < MAX_PARTS - 20) {
      // gelegentlich ein Glutfunke, der vom unteren Rand aufsteigt
      nextEmber = t + 260 + Math.random() * 420;
      parts.push({ x: Math.random() * W, y: H + 6, vx: (Math.random() - 0.5) * 0.4, vy: -0.6 - Math.random() * 0.9, r: 0.8 + Math.random() * 1.4,
                   life: 1, decay: 0.0035 + Math.random() * 0.003, c: pal.spark[1 + (Math.random() * 2 | 0)], star: false, g: -0.004 });
    }
  }

  /* ---- Loop -------------------------------------------------------------- */
  var running = false;
  function drawFrame(t) {
    ctx.drawImage(bgCv, 0, 0, W, H);
    var c = 'rgb(' + pal.star + ')';
    ctx.fillStyle = c;
    var dim = theme === 'kamin' ? 0.55 : 1;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      ctx.globalAlpha = dim * (reduce ? 0.7 : 0.45 + 0.55 * Math.abs(Math.sin(s.p + t / 1000 * s.s * 0.5)));
      ctx.beginPath(); ctx.arc(s.fx * W, s.fy * H, s.r, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (!reduce) ambient(t);
    stepParts();
    for (var j = paws.length - 1; j >= 0; j--) { if (!drawPaw(paws[j], t)) paws.splice(j, 1); }
  }
  function loop(t) {
    drawFrame(t);
    // Bei reduzierter Bewegung nur weiterlaufen, solange noch etwas ausfadet
    if (!reduce || paws.length || parts.length) requestAnimationFrame(loop);
    else running = false;
  }
  function ensureLoop() { if (!running) { running = true; requestAnimationFrame(loop); } }

  /* ---- Klicks auf freie Flächen -------------------------------------------- */
  // Alles, was Inhalt oder bedienbar ist, zählt nicht als "frei"
  var BLOCK = 'a,button,input,select,textarea,label,summary,dialog,[role=button],[tabindex]:not([tabindex="-1"]),[contenteditable],' +
              '.game,.wall .chips,.filters,.lb,.lbwrap,table,h1,h2,h3,p,li,.sign,.topbar,.lz-fb-open,footer a';
  document.addEventListener('pointerdown', function (e) {
    if (e.button > 0 || !e.isPrimary) return;
    var el = e.target;
    if (el && el.closest && el.closest(BLOCK)) return;
    if (window.getSelection && String(window.getSelection())) return;
    addPaw(e.clientX, e.clientY);
    ensureLoop();
  }, { passive: true });

  /* ---- Theme & Motion live nachführen ------------------------------------ */
  function onTheme() {
    var t = themeName(); if (t === theme) return;
    theme = t; pal = PAL[t]; shoots.length = 0; paintBg();
    if (!running) drawFrame(performance.now());
  }
  if (window.LZCozy) LZCozy.theme.onChange(onTheme);
  else new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  var onMotion = function () { reduce = rmq.matches; if (!reduce) ensureLoop(); };
  rmq.addEventListener ? rmq.addEventListener('change', onMotion) : rmq.addListener(onMotion);

  size();
  if (reduce) drawFrame(performance.now()); else ensureLoop();
  // Für Tests / eigene Effekte
  window.LZSky = { paw: function (x, y) { addPaw(x, y); ensureLoop(); }, stats: function () { return { paws: paws.length, parts: parts.length, running: running }; } };
})();
