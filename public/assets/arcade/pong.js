/* ==========================================================================
   Curve-Ball (Pixel-Pong) – Lunacynas Spielezimmer
   Datenstruktur (Feld 160 × 100 Einheiten):
     ball: {x, y, vx, vy, spin}       spin krümmt die Flugbahn (Curve-Ball)
     pads: [{y, v, dir, aim, max}]    dir = Tastatur (-1/0/1), aim = Ziel-y (Touch/Bot)
     score, lives (Solo), hits, serveAt
   Game-Loop:  tick(dt): Schläger bewegen -> Ball + Schnitt integrieren ->
               Wände/Schläger prüfen -> Punkt/Aufschlag.
   Abprallwinkel hängt vom Trefferpunkt ab (Rand = steil), die Schläger-
   bewegung im Moment des Treffers gibt Schnitt mit.
   Bot:        sieht den Ball nur alle "Reaktionszeit" Sekunden neu, sagt den
               Auftreffpunkt voraus (Wände eingerechnet, Schnitt nur auf Schwer),
               zielt mit Streuung und gelegentlichen Stellungsfehlern und ist
               auf eine Höchstgeschwindigkeit begrenzt.
   ========================================================================== */
(function () {
  'use strict';
  const FW = 160, FH = 100, PH = 18, PW = 3, R = 1.8, PX = [6, FW - 6], WIN_PTS = 7, HUMAN_MAX = 120;
  const BOT = { 1: { react: 0.34, max: 58, err: 9, slip: 0.25, spin: false }, 2: { react: 0.19, max: 84, err: 5, slip: 0.12, spin: false }, 3: { react: 0.09, max: 112, err: 2.4, slip: 0.04, spin: true } };

  function serve(s, toward, now) {
    s.ball = { x: FW / 2, y: FH / 2, vx: 0, vy: 0, spin: 0 };
    s.serveAt = now + 900; s.serveDir = toward; s.rally = 0;
  }
  const logic = {
    init(cfg) {
      const solo = cfg.mode === 'solo', lv = cfg.level || 2;
      const s = { solo, pads: [{ y: FH / 2, v: 0, dir: 0, aim: null, max: HUMAN_MAX }, { y: FH / 2, v: 0, dir: 0, aim: null, max: cfg.mode === 'bot' ? BOT[lv].max : HUMAN_MAX }],
        score: [0, 0], lives: 3, hits: 0, best: 0, win: -1, done: false, ev: 0, flash: null };
      serve(s, Math.random() < 0.5 ? 0 : 1, Date.now());
      if (solo) s.serveDir = 0;
      return s;
    },
    act(s, seat, type, arg) {
      const p = s.pads[seat]; if (!p || s.done || (s.solo && seat !== 0)) return null;
      if (type === 'move') { p.dir = Math.max(-1, Math.min(1, arg && arg.d | 0)); p.aim = null; return s; }
      if (type === 'aim') { p.aim = arg == null || arg.y == null ? null : Math.max(PH / 2, Math.min(FH - PH / 2, +arg.y)); if (p.aim != null) p.dir = 0; return s; }
      return null;
    },
    tick(s, dt, now) {
      if (s.done) return null;
      let event = false;
      for (const p of s.pads) {                           // Schläger
        const y0 = p.y;
        if (p.aim != null) { const d = p.aim - p.y, st = p.max * dt; p.y += Math.abs(d) <= st ? d : Math.sign(d) * st; }
        else p.y += p.dir * p.max * dt;
        p.y = Math.max(PH / 2, Math.min(FH - PH / 2, p.y)); p.v = (p.y - y0) / Math.max(dt, 1e-3);
      }
      const b = s.ball;
      if (s.serveAt) {
        if (now < s.serveAt) return null;
        const sp = 62, ang = (Math.random() - 0.5) * 0.7, dir = s.serveDir === 0 ? -1 : 1;
        b.vx = dir * sp * Math.cos(ang); b.vy = sp * Math.sin(ang); s.serveAt = 0;
        if (s.solo) b.vx = -Math.abs(b.vx);
      }
      // Schnitt krümmt die Bahn und klingt ab
      b.vy += b.spin * dt * 2.2; b.spin *= Math.max(0, 1 - 1.6 * dt);
      const steps = Math.ceil(Math.hypot(b.vx, b.vy) * dt / 1.5);    // feine Schritte: kein Tunneln bei hohem Tempo
      for (let i = 0; i < steps; i++) {
        const h = dt / steps; b.x += b.vx * h; b.y += b.vy * h;
        if (b.y < R) { b.y = R; b.vy = Math.abs(b.vy); b.spin *= -0.5; s.ev++; }
        if (b.y > FH - R) { b.y = FH - R; b.vy = -Math.abs(b.vy); b.spin *= -0.5; s.ev++; }
        if (s.solo && b.x > FW - R) { b.x = FW - R; b.vx = -Math.abs(b.vx); s.ev++; }   // Squash: rechte Wand
        for (let k = 0; k < (s.solo ? 1 : 2); k++) {
          const p = s.pads[k], px = PX[k], toward = k === 0 ? b.vx < 0 : b.vx > 0;
          const edge = k === 0 ? px + PW / 2 + R : px - PW / 2 - R;
          if (!toward || (k === 0 ? b.x > edge || b.x < px - PW : b.x < edge || b.x > px + PW)) continue;
          if (Math.abs(b.y - p.y) > PH / 2 + R) continue;
          const rel = Math.max(-1, Math.min(1, (b.y - p.y) / (PH / 2)));
          const sp = Math.min(175, Math.hypot(b.vx, b.vy) * 1.055 + 2), ang = rel * 1.0;   // bis ~57°
          b.vx = (k === 0 ? 1 : -1) * sp * Math.cos(ang); b.vy = sp * Math.sin(ang);
          b.spin = Math.max(-90, Math.min(90, p.v * 0.75));
          b.x = edge; s.rally++; s.hits += (k === 0 || !s.solo) ? 1 : 0; s.lastHit = { k, t: now, curve: Math.abs(b.spin) > 25 };
          event = true;
        }
      }
      // Punkt?
      if (b.x < -4 || b.x > FW + 4) {
        const scorer = b.x < 0 ? 1 : 0;
        if (s.solo) { s.lives--; s.flash = { t: now, k: 'miss' }; if (s.lives <= 0) { s.done = true; return true; } serve(s, 0, now); return true; }
        s.score[scorer]++; s.flash = { t: now, k: scorer };
        if (s.score[scorer] >= WIN_PTS) { s.done = true; s.win = scorer; return true; }
        serve(s, 1 - scorer, now); return true;
      }
      return event;
    },
    turn: () => -1,
    over(s) {
      if (!s.done) return null;
      if (s.solo) return { title: 'Ball verloren', text: `<b>${s.hits}</b> Treffer an der Wand.`, best: { key: 'squash', value: s.hits, fmt: v => v + ' Treffer' }, record: s.hits };
      return { winner: s.win, text: `${s.score[0]} : ${s.score[1]}` };
    }
  };

  // ---- Bot ----
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  function intercept(b, x, withSpin) {         // y, an dem der Ball die Linie x erreicht (Wände reflektiert)
    let px = b.x, py = b.y, vx = b.vx, vy = b.vy, sp = b.spin, n = 0;
    if (!vx) return FH / 2;
    while ((vx > 0 ? px < x : px > x) && n++ < 2000) {
      const h = 1 / 120; if (withSpin) { vy += sp * h * 2.2; sp *= 1 - 1.6 * h; }
      px += vx * h; py += vy * h;
      if (py < R) { py = R; vy = Math.abs(vy); sp *= -0.5; } if (py > FH - R) { py = FH - R; vy = -Math.abs(vy); sp *= -0.5; }
    }
    return py;
  }
  const bot = {
    control(s, seat, level, mem, dt) {
      if (s.done) return [];
      const L = BOT[level], b = s.ball, p = s.pads[seat];
      mem.t = (mem.t || 0) + dt;
      if (mem.rally !== s.rally + ':' + s.score.join()) {       // pro Ballwechsel neuer Fehler
        mem.rally = s.rally + ':' + s.score.join();
        mem.err = gauss() * L.err + (Math.random() < L.slip ? (Math.random() < 0.5 ? -1 : 1) * PH * (0.75 + Math.random() * 0.4) : 0);
      }
      if (mem.t < L.react) return [];
      mem.t = 0;
      const coming = seat === 1 ? b.vx > 0 : b.vx < 0;
      let y;
      if (s.serveAt || !coming) y = level === 1 ? p.y + (b.y - p.y) * 0.3 : FH / 2 + (b.y - FH / 2) * 0.25;
      else y = intercept(b, PX[seat], L.spin) + mem.err;
      return [['aim', { y }]];
    }
  };

  // ---- View ----
  const LW = 640, LH = 400, K = LW / FW;
  let C = null, sent = [null, null], trail = [], last = { ev: 0, hits: 0, flash: null }, touchSeat = {};
  function seatsByKeys(ctx) {
    const k = ctx.keys, two = false;              // nur ein Mensch pro Gerät: beide Tastenpaare steuern deinen Schläger
    const d0 = (k.has('s') ? 1 : 0) - (k.has('w') ? 1 : 0), dA = (k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0);
    return two ? [d0, dA] : [Math.max(-1, Math.min(1, d0 + dA)), null];
  }
  const view = {
    mount(root, ctx) {
      root.innerHTML = '<div class="pg-wrap"></div>';
      C = LZArcade.canvas(root.querySelector('.pg-wrap'), LW, LH, 'Pong-Spielfeld');
      sent = [null, null]; trail = []; last = { ev: 0, hits: 0, flash: null }; touchSeat = {};
      const seatFor = () => 0;
      const move = e => { const q = C.toLogic(e), seat = touchSeat[e.pointerId]; if (seat == null) return; ctx.act('aim', { y: q.y * FH / LH }, seat); };
      C.cv.addEventListener('pointerdown', e => { e.preventDefault(); C.cv.setPointerCapture(e.pointerId); const q = C.toLogic(e); touchSeat[e.pointerId] = seatFor(q.x * FW / LW); move(e); });
      C.cv.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && !e.buttons) return; move(e); });
      const up = e => { const seat = touchSeat[e.pointerId]; delete touchSeat[e.pointerId]; if (seat != null) ctx.act('aim', { y: null }, seat); };
      C.cv.addEventListener('pointerup', up); C.cv.addEventListener('pointercancel', up);
    },
    render(s, ctx) {
      if (s.flash && s.flash !== last.flash) {
        last.flash = s.flash;
        if (s.solo) { ctx.sound('wrong'); ctx.say(s.lives > 0 ? `Daneben. Noch ${s.lives} ${s.lives === 1 ? 'Ball' : 'Bälle'}.` : 'Vorbei.'); }
        else { ctx.sound(ctx.canAct(s.flash.k) && ctx.mode !== 'local' ? 'correct' : 'tick'); ctx.say(`Punkt für ${ctx.names[s.flash.k]}. ${s.score[0]} zu ${s.score[1]}.`); }
      }
    },
    frame(s, ctx, dt) {
      if (!C) return;
      // Tastatur -> dieselbe Aktion wie Touch und Bot
      const d = seatsByKeys(ctx);
      [0, 1].forEach(i => { if (d[i] == null || !ctx.canAct(i) || touchSeat && Object.values(touchSeat).includes(i)) return; if (sent[i] !== d[i]) { sent[i] = d[i]; ctx.act('move', { d: d[i] }, i); } });
      if (s.ev !== last.ev) { last.ev = s.ev; ctx.sound('tick'); }
      if (s.hits !== last.hits || (s.lastHit && s.lastHit.t !== last.hitT)) { if (s.lastHit) last.hitT = s.lastHit.t; last.hits = s.hits; ctx.sound(s.lastHit && s.lastHit.curve ? 'join' : 'pop'); }
      const g = C.g, c = C.colors, now = Date.now(), b = s.ball;
      g.fillStyle = c.night; g.fillRect(0, 0, LW, LH);
      g.fillStyle = c['panel-b']; g.fillRect(4, 4, LW - 8, LH - 8);
      // Mittellinie / Squash-Wand
      g.fillStyle = 'rgba(255,255,255,.14)';
      if (!s.solo) for (let y = 8; y < LH; y += 22) g.fillRect(LW / 2 - 2, y, 4, 12);
      else { g.fillStyle = c.frame; g.fillRect(LW - 10, 0, 10, LH); }
      // Punkte
      g.textAlign = 'center'; g.font = '700 64px ' + c.font; g.fillStyle = 'rgba(255,255,255,.16)';
      if (s.solo) g.fillText(String(s.hits), LW / 2, 90);
      else { g.fillText(String(s.score[0]), LW / 2 - 80, 90); g.fillText(String(s.score[1]), LW / 2 + 80, 90); }
      if (s.solo) { g.font = '700 16px ' + c.font; g.fillStyle = c.muted; g.fillText('♥ '.repeat(Math.max(0, s.lives)).trim(), LW / 2, 118); }
      // Schläger
      for (let k = 0; k < (s.solo ? 1 : 2); k++) {
        const p = s.pads[k]; g.fillStyle = k ? c.p2 : c.p1;
        g.fillRect((PX[k] - PW / 2) * K, (p.y - PH / 2) * K, PW * K, PH * K);
      }
      // Ball mit Spur (leuchtet bei Schnitt)
      trail.push([b.x, b.y]); if (trail.length > 10) trail.shift();
      trail.forEach(([x, y], i) => { g.globalAlpha = i / trail.length * 0.35; g.fillStyle = Math.abs(b.spin) > 25 ? c.glow : c.neon; g.fillRect((x - R) * K, (y - R) * K, R * 2 * K, R * 2 * K); });
      g.globalAlpha = 1; g.fillStyle = c.neon;
      if (!(s.serveAt && Math.floor(now / 160) % 2)) g.fillRect((b.x - R) * K, (b.y - R) * K, R * 2 * K, R * 2 * K);
      if (s.flash && now - s.flash.t < 500) { g.fillStyle = 'rgba(255,255,255,' + (0.18 * (1 - (now - s.flash.t) / 500)) + ')'; g.fillRect(0, 0, LW, LH); }
    },
    unmount() { C = null; }
  };

  LZArcade.define({
    id: 'pong', title: 'Curve-Ball', sub: 'Pixel-Pong mit Schnitt',
    modes: {
      solo: { desc: 'Squash an der Wand: Jeder Treffer zählt, drei Bälle darfst du verlieren.' },
      bot: { desc: 'Der Bot reagiert mit Verzögerung, ist begrenzt schnell und verschätzt sich manchmal.' }
    },
    rules: ['Triffst du den Ball mit der Schlägerkante, fliegt er steiler zurück.', 'Bewegst du den Schläger beim Treffer, bekommt der Ball Schnitt und fliegt eine Kurve.', 'Jeder Treffer macht den Ball etwas schneller. Gegen den Bot gewinnt, wer zuerst 7 Punkte hat. Deine meisten Squash-Treffer kommen in die Bestenliste.'],
    keys: '<b>Tastatur:</b> <kbd class="lz-kbd">W</kbd>/<kbd class="lz-kbd">S</kbd> oder <kbd class="lz-kbd">↑</kbd>/<kbd class="lz-kbd">↓</kbd> · Maus/Finger: auf dem Feld ziehen',
    logic, bot, view, announceStatus: false,
    scores(s, ctx) {
      if (s.solo) return [{ name: ctx.names[0], value: s.hits, sub: 'Treffer · ' + s.lives + ' ' + (s.lives === 1 ? 'Ball' : 'Bälle') + ' übrig', on: true }];
      return [0, 1].map(i => ({ name: ctx.names[i], value: s.score[i], sub: i ? 'rechts' : 'links', on: false }));
    },
    status(s, ctx) {
      if (s.done) return s.solo ? 'Vorbei!' : `<em>${ctx.esc(ctx.names[s.win])}</em> gewinnt!`;
      if (s.serveAt) return s.solo ? 'Aufschlag …' : `Aufschlag zu <em>${ctx.esc(ctx.names[s.serveDir])}</em>`;
      return s.solo ? `<em>${s.hits}</em> Treffer` : `${s.score[0]} : ${s.score[1]} · bis 7`;
    }
  });
})();
