/* ==========================================================================
   Turmbau zu Babel (Block-Stacker) – Lunacynas Spielezimmer
   Datenstruktur:
     tower: [{x, w}]          Breite 100 Einheiten, Index = Höhe (0 = Fundament)
     cur:   {x, w, dir, v}    gleitender Block (v = Einheiten/s)
     turn, loser, cut (abgeschnittenes Stück fürs Fall-Bild)
   Game-Loop:  tick(dt) bewegt den Block hin und her (prallt an den Rändern ab);
               act('drop') legt ihn ab: Überlappung bleibt, der Rest fällt.
   Bot:        wählt pro Block einen Zielfehler (Normalverteilung, σ je Stufe)
               und drückt, wenn seine Vorhersage den Zielpunkt trifft.
   ========================================================================== */
(function () {
  'use strict';
  const FIELD = 100, BASE_W = 60, MIN_W_DUO = 7, PERFECT = 1.6;
  const speedFor = h => 42 + Math.min(h, 40) * 2.6;

  function spawn(w, h, dir) {
    const lo = -12, hi = FIELD + 12 - w;
    return { x: dir > 0 ? lo : hi, w, dir, v: speedFor(h), lo, hi };
  }
  const logic = {
    init(cfg) {
      return { mode: cfg.mode, duo: cfg.mode !== 'solo', tower: [{ x: (FIELD - BASE_W) / 2, w: BASE_W }], cur: spawn(BASE_W, 0, 1), turn: 0, loser: -1, cut: null, perfect: 0, streak: 0, placedBy: [-1], done: false };
    },
    tick(s, dt) {
      const c = s.cur; if (!c || s.done) return null;
      c.x += c.dir * c.v * dt;
      if (c.x <= c.lo) { c.x = c.lo; c.dir = 1; } else if (c.x >= c.hi) { c.x = c.hi; c.dir = -1; }
      return null;                         // kontinuierlich: kein neues Rendern nötig, das Canvas zeichnet jeden Frame
    },
    act(s, seat, type, arg, now) {
      if (type !== 'drop' || s.done || !s.cur) return null;
      if (s.duo && seat !== s.turn) return null;
      const top = s.tower[s.tower.length - 1], c = s.cur, h = s.tower.length;
      const n = { ...s, tower: s.tower.slice(), placedBy: s.placedBy.slice() };
      let x = c.x, w = c.w, perfect = false;
      if (Math.abs(c.x - top.x) <= PERFECT) { x = top.x; perfect = true; }
      const left = Math.max(x, top.x), right = Math.min(x + w, top.x + top.w), ov = right - left;
      if (ov <= 0) {                       // komplett daneben
        n.cut = { x: c.x, w: c.w, h, t: now, side: 0 }; n.cur = null; n.done = true; n.loser = seat; n.miss = true;
        return n;
      }
      if (!perfect) n.cut = { x: x < top.x ? x : right, w: w - ov, h, t: now };
      else n.cut = null;
      const nw = perfect ? top.w : ov;
      n.tower.push({ x: left, w: nw }); n.placedBy.push(seat);
      n.streak = perfect ? s.streak + 1 : 0; n.perfect = s.perfect + (perfect ? 1 : 0); n.lastPerfect = perfect ? now : s.lastPerfect;
      // Solo-Belohnung: drei perfekte in Folge lassen die Plattform wieder etwas wachsen
      let grow = 0; if (!s.duo && perfect && n.streak % 3 === 0) grow = Math.min(6, BASE_W - nw);
      if (grow > 0) { const t = n.tower[n.tower.length - 1]; t.w += grow; t.x = Math.max(0, t.x - grow / 2); }
      if (s.duo && nw < MIN_W_DUO) { n.cur = null; n.done = true; n.loser = seat; n.thin = true; return n; }
      const t = n.tower[n.tower.length - 1];
      n.cur = spawn(t.w, n.tower.length - 1, h % 2 ? -1 : 1);
      if (s.duo) n.turn = 1 - seat;
      return n;
    },
    turn: s => s.done ? -1 : (s.duo ? s.turn : 0),
    over(s) {
      if (!s.done) return null;
      const height = s.tower.length - 1;
      if (!s.duo) return { title: s.miss ? 'Daneben!' : 'Turm fertig', text: `Dein Turm ist <b>${height}</b> ${height === 1 ? 'Block' : 'Blöcke'} hoch${s.perfect ? ` – ${s.perfect}× perfekt gesetzt` : ''}.`, best: { key: 'solo', value: height, fmt: v => v + ' Blöcke' } };
      return { winner: 1 - s.loser, text: s.thin ? 'Der Block war schmaler als die Mindestbreite.' : `Daneben gesetzt bei Höhe ${height + 1}.` };
    }
  };

  // ---- Bot: Zielfehler + Vorhersage ----
  const SIGMA = { 1: 6.5, 2: 3.2, 3: 1.1 }, BLACKOUT = { 1: 0.1, 2: 0.04, 3: 0.01 };
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  function predict(c, t) {           // Position in t Sekunden, inkl. Abprallen
    let x = c.x, d = c.dir, rest = c.v * t, span = c.hi - c.lo;
    rest %= 2 * span;
    while (rest > 0) { const lim = d > 0 ? c.hi - x : x - c.lo; if (rest <= lim) { x += d * rest; rest = 0; } else { x += d * lim; rest -= lim; d = -d; } }
    return x;
  }
  const bot = {
    control(s, seat, level, mem, dt) {
      if (s.done || !s.cur || logic.turn(s) !== seat) return [];
      const k = s.tower.length;
      if (mem.k !== k) {                 // neuer Block: Fehler und Wartezeit auswürfeln
        mem.k = k; mem.since = 0;
        mem.err = Math.random() < BLACKOUT[level] ? (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 8) : gauss() * SIGMA[level];
        mem.wait = 0.35 + Math.random() * (level === 1 ? 1.2 : level === 2 ? 0.7 : 0.35);
      }
      mem.since += dt; if (mem.since < mem.wait) return [];
      const top = s.tower[k - 1], target = top.x + mem.err, next = predict(s.cur, dt);
      const x = s.cur.x;
      if ((x - target) * (next - target) <= 0 || Math.abs(x - target) < 0.25) return [['drop']];
      return [];
    }
  };

  // ---- View: Canvas ----
  const LW = 360, LH = 480, BH = 22;    // logische Pixel; Blockhöhe
  let C = null, camY = 0, shown = { k: 0 };
  const hue = (i, c) => { const p = [c.moon, c.peach, c.lavender, c.glow, c.neon]; return p[i % p.length]; };
  const view = {
    mount(root, ctx) {
      root.innerHTML = '<div class="st-wrap"></div><div class="ar-touch"><button class="btn big" type="button" data-st="drop">Ablegen</button></div>';
      C = LZArcade.canvas(root.querySelector('.st-wrap'), LW, LH, 'Turm aus gestapelten Blöcken');
      C.cv.addEventListener('pointerdown', e => { e.preventDefault(); ctx.act('drop'); });
      root.querySelector('[data-st=drop]').addEventListener('click', () => ctx.act('drop'));
      camY = 0; shown = { k: 1 };
    },
    render(s, ctx) {
      const k = s.tower.length;
      if (k !== shown.k) { ctx.sound(s.lastPerfect && s.streak ? 'magic' : 'pop'); if (s.streak >= 2) ctx.toast(s.streak + '× perfekt!'); shown.k = k; }
      if (s.done && !shown.end) { shown.end = true; ctx.sound('wrong'); }
      if (!s.done) shown.end = false;
      const t = logic.turn(s);
      const btn = document.querySelector('[data-st=drop]'); if (btn) btn.disabled = t < 0 || !ctx.canAct(t);
    },
    key(e, s, ctx) { if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown') { if (document.activeElement && document.activeElement.matches('button:not(.ar-canvas),a')) return; e.preventDefault(); ctx.act('drop'); } },
    frame(s, ctx, dt) {
      if (!C) return; const g = C.g, c = C.colors, now = Date.now();
      const h = s.tower.length;
      const want = Math.max(0, (h + 1) * BH - LH * 0.55);
      camY += (want - camY) * Math.min(1, dt * 6);
      const sx = LW / FIELD, baseY = LH - 30;
      const Y = i => baseY - (i + 1) * BH + camY;
      // Himmel
      const gr = g.createLinearGradient(0, 0, 0, LH); gr.addColorStop(0, c.night); gr.addColorStop(1, c['panel-a']);
      g.fillStyle = gr; g.fillRect(0, 0, LW, LH);
      g.fillStyle = c.neon; g.globalAlpha = 0.5;
      for (let i = 0; i < 26; i++) { const x = (i * 97) % LW, y = ((i * 53 + camY * 0.3) % LH); g.fillRect(x, y, 2, 2); }
      g.globalAlpha = 1;
      // Boden
      g.fillStyle = c.frame; g.fillRect(0, baseY + camY, LW, LH);
      // Turm
      s.tower.forEach((b, i) => {
        const y = Y(i); if (y > LH || y < -BH) return;
        g.fillStyle = i === 0 ? c['frame-hi'] : hue(i, c);
        g.fillRect(b.x * sx, y, b.w * sx, BH - 2);
        g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(b.x * sx, y, b.w * sx, 4);
        if (s.duo && i > 0) { g.fillStyle = s.placedBy[i] ? c.p2 : c.p1; g.fillRect(b.x * sx, y + BH - 5, b.w * sx, 3); }
      });
      // abgeschnittenes Stück fällt
      if (s.cut) {
        const a = (now - s.cut.t) / 1000;
        if (a < 1.4) { const y = Y(s.cut.h) + 300 * a * a; g.globalAlpha = Math.max(0, 1 - a / 1.4); g.fillStyle = hue(s.cut.h, c); g.fillRect(s.cut.x * sx, y, s.cut.w * sx, BH - 2); g.globalAlpha = 1; }
      }
      // gleitender Block
      if (s.cur) {
        const y = Y(h);
        g.fillStyle = hue(h, c); g.fillRect(s.cur.x * sx, y, s.cur.w * sx, BH - 2);
        g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(s.cur.x * sx, y, s.cur.w * sx, 4);
        if (s.duo) { g.fillStyle = s.turn ? c.p2 : c.p1; g.fillRect(s.cur.x * sx, y + BH - 5, s.cur.w * sx, 3); }
        // Hilfslinie zur Kante darunter
        const top = s.tower[h - 1]; g.strokeStyle = 'rgba(255,255,255,.18)'; g.setLineDash([3, 4]);
        g.beginPath(); g.moveTo(top.x * sx, y); g.lineTo(top.x * sx, y + BH); g.moveTo((top.x + top.w) * sx, y); g.lineTo((top.x + top.w) * sx, y + BH); g.stroke(); g.setLineDash([]);
      }
      // Höhe
      g.fillStyle = c.neon; g.textAlign = 'center'; g.font = '700 54px ' + c.font; g.globalAlpha = 0.9;
      g.fillText(String(h - 1), LW / 2, 70); g.globalAlpha = 1;
      if (s.lastPerfect && now - s.lastPerfect < 700) { g.font = '700 22px ' + c.font; g.fillStyle = c.moon; g.fillText('Perfekt!', LW / 2, 100); }
    }
  };

  LZArcade.define({
    id: 'stack', title: 'Turmbau zu Babel', sub: 'Block-Stacker',
    modes: {
      solo: { desc: 'Rekordjagd: Wie hoch wird dein Turm? Drei perfekte Blöcke in Folge lassen die Plattform wieder wachsen.' },
      local: { desc: 'Abwechselnd ablegen. Wer daneben setzt oder unter die Mindestbreite fällt, verliert.' },
      bot: { desc: 'Der Bot zielt mit Streuung: Leicht wackelt kräftig, Schwer trifft fast immer.' }
    },
    rules: ['Der Block gleitet hin und her – Klick, Tippen oder Leertaste legt ihn ab.', 'Was über den Block darunter hinausragt, wird abgeschnitten. Der Turm wird schmaler.', 'Zu zweit: Wer danebenliegt oder schmaler als die Mindestbreite baut, verliert.'],
    keys: '<b>Tastatur:</b> <kbd class="lz-kbd">Leertaste</kbd> oder <kbd class="lz-kbd">Enter</kbd> legt ab',
    logic, bot, view, announceStatus: false,
    scores(s, ctx) {
      const h = s.tower.length - 1;
      if (!s.duo) return [{ name: ctx.names[0], value: h, sub: s.perfect ? s.perfect + '× perfekt' : 'Höhe', on: true }];
      return [0, 1].map(i => ({ name: ctx.names[i], value: s.placedBy.filter(p => p === i).length, sub: 'Blöcke gesetzt', on: logic.turn(s) === i }));
    },
    status(s, ctx) {
      if (s.done) return s.duo ? `<em>${ctx.esc(ctx.names[1 - s.loser])}</em> gewinnt!` : 'Daneben!';
      if (!s.duo) return `Höhe <em>${s.tower.length - 1}</em> – leg den Block ab!`;
      const t = s.turn;
      if (ctx.isBot(t)) return `<em>${ctx.esc(ctx.names[t])}</em> zielt …`;
      return ctx.mode === 'local' ? `<em>${ctx.esc(ctx.names[t])}</em> ist dran` : 'Du bist dran – leg den Block ab!';
    }
  });
})();
