/* ==========================================================================
   Turmbau zu Babel (Block-Stacker) – Lunacynas Spielezimmer · nur Solo
   Datenstruktur:
     tower: [{x, w}]          Breite 100 Einheiten, Index = Höhe (0 = Fundament)
     cur:   {x, w, dir, v}    gleitender Block (v = Einheiten/s)
     cut    abgeschnittenes Stück fürs Fall-Bild, perfect/streak für Boni
   Game-Loop:  tick(dt) bewegt den Block hin und her (prallt an den Rändern ab);
               act('drop') legt ihn ab: Überlappung bleibt, der Rest fällt.
               Drei perfekte Blöcke in Folge lassen die Plattform wieder wachsen.
   ========================================================================== */
(function () {
  'use strict';
  const FIELD = 100, BASE_W = 60, PERFECT = 1.6;
  const speedFor = h => 42 + Math.min(h, 40) * 2.6;

  // Der Block gleitet so weit, dass er den Turm ganz verfehlen kann (bis knapp über beide Kanten hinaus)
  function spawn(w, h, dir, top) {
    const lo = Math.max(-w * 0.9, top.x - w - 4), hi = Math.min(FIELD - w * 0.1, top.x + top.w + 4);
    return { x: dir > 0 ? lo : hi, w, dir, v: speedFor(h), lo, hi };
  }
  const logic = {
    init(cfg) {
      return { tower: [{ x: (FIELD - BASE_W) / 2, w: BASE_W }], cur: spawn(BASE_W, 0, 1, { x: (FIELD - BASE_W) / 2, w: BASE_W }), cut: null, perfect: 0, streak: 0, done: false };
    },
    tick(s, dt) {
      const c = s.cur; if (!c || s.done) return null;
      c.x += c.dir * c.v * dt;
      if (c.x <= c.lo) { c.x = c.lo; c.dir = 1; } else if (c.x >= c.hi) { c.x = c.hi; c.dir = -1; }
      return null;                         // kontinuierlich: kein neues Rendern nötig, das Canvas zeichnet jeden Frame
    },
    act(s, seat, type, arg, now) {
      if (type !== 'drop' || s.done || !s.cur) return null;
      const top = s.tower[s.tower.length - 1], c = s.cur, h = s.tower.length;
      const n = { ...s, tower: s.tower.slice() };
      let x = c.x, w = c.w, perfect = false;
      if (Math.abs(c.x - top.x) <= PERFECT) { x = top.x; perfect = true; }
      const left = Math.max(x, top.x), right = Math.min(x + w, top.x + top.w), ov = right - left;
      if (ov <= 0) {                       // komplett daneben
        n.cut = { x: c.x, w: c.w, h, t: now, side: 0 }; n.cur = null; n.done = true; n.miss = true;
        return n;
      }
      if (!perfect) n.cut = { x: x < top.x ? x : right, w: w - ov, h, t: now };
      else n.cut = null;
      const nw = perfect ? top.w : ov;
      n.tower.push({ x: left, w: nw });
      n.streak = perfect ? s.streak + 1 : 0; n.perfect = s.perfect + (perfect ? 1 : 0); n.lastPerfect = perfect ? now : s.lastPerfect;
      // Belohnung: drei perfekte in Folge lassen die Plattform wieder etwas wachsen
      let grow = 0; if (perfect && n.streak % 3 === 0) grow = Math.min(6, BASE_W - nw);
      if (grow > 0) { const t = n.tower[n.tower.length - 1]; t.w += grow; t.x = Math.max(0, t.x - grow / 2); }
      const t = n.tower[n.tower.length - 1];
      n.cur = spawn(t.w, n.tower.length - 1, h % 2 ? -1 : 1, t);
      return n;
    },
    turn: s => s.done ? -1 : 0,
    over(s) {
      if (!s.done) return null;
      const height = s.tower.length - 1;
      return { title: s.miss ? 'Daneben!' : 'Turm fertig', text: `Dein Turm ist <b>${height}</b> ${height === 1 ? 'Block' : 'Blöcke'} hoch${s.perfect ? ` – ${s.perfect}× perfekt gesetzt` : ''}.`, best: { key: 'solo', value: height, fmt: v => v + ' Blöcke' }, record: height };
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
    id: 'stack', title: 'Turmbau zu Babel', sub: 'Block-Stacker · Rekordjagd',
    modes: {
      solo: { desc: 'Rekordjagd: Wie hoch wird dein Turm? Drei perfekte Blöcke in Folge lassen die Plattform wieder wachsen.' }
    },
    rules: ['Der Block gleitet hin und her – Klick, Tippen oder Leertaste legt ihn ab.', 'Was über den Block darunter hinausragt, wird abgeschnitten. Der Turm wird schmaler.', 'Drei perfekte Blöcke in Folge lassen die Plattform wieder etwas wachsen. Dein höchster Turm kommt in die Bestenliste.'],
    keys: '<b>Tastatur:</b> <kbd class="lz-kbd">Leertaste</kbd> oder <kbd class="lz-kbd">Enter</kbd> legt ab',
    logic, view, announceStatus: false,
    scores(s, ctx) {
      const h = s.tower.length - 1;
      return [{ name: ctx.names[0], value: h, sub: s.perfect ? s.perfect + '× perfekt' : 'Höhe', on: true }];
    },
    status(s, ctx) {
      if (s.done) return 'Daneben!';
      return `Höhe <em>${s.tower.length - 1}</em> – leg den Block ab!`;
    }
  });
})();
