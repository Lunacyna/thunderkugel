/* ==========================================================================
   Käsekästchen (Dots and Boxes) – Lunacynas Spielezimmer
   Datenstruktur bei n×n Punkten (b = n−1 Kästchen pro Seite):
     h: Array(n*b)   waagrechte Kanten, Index zeile*b + spalte  (−1 frei / Sitz)
     v: Array(b*n)   senkrechte Kanten, Index zeile*n + spalte
     box: Array(b*b) Besitzer je Kästchen (−1 offen)
   Ablauf: act('line', {k:'h'|'v', i}) setzt eine Kante; schließt sie ein
           Kästchen, gibt es den Punkt und derselbe Sitz ist nochmal dran.
   Bot (Heuristik):  1. Kästchen schließen (Ketten weiterverfolgen)
                     2. sichere Kante (macht kein Kästchen zur "dritten Seite")
                     3. sonst die Kante, die dem Gegner die kürzeste Kette schenkt
   Solo "Blitz": 60 Sekunden gegen einen flotten Bot, volle Bretter werden
           sofort neu aufgebaut – gezählt werden deine Kästchen.
   ========================================================================== */
(function () {
  'use strict';
  const SOLO_MS = 60000;
  function fresh(n) { const b = n - 1; return { n, b, h: new Array(n * b).fill(-1), v: new Array(b * n).fill(-1), box: new Array(b * b).fill(-1) }; }
  function sides(g, r, c) { const { n, b } = g; return [g.h[r * b + c], g.h[(r + 1) * b + c], g.v[r * n + c], g.v[r * n + c + 1]]; }
  const filled = (g, r, c) => sides(g, r, c).filter(x => x >= 0).length;
  function boxesOf(g, k, i) {          // Kästchen neben einer Kante
    const { n, b } = g, out = [];
    if (k === 'h') { const r = Math.floor(i / b), c = i % b; if (r > 0) out.push([r - 1, c]); if (r < b) out.push([r, c]); }
    else { const r = Math.floor(i / n), c = i % n; if (c > 0) out.push([r, c - 1]); if (c < b) out.push([r, c]); }
    return out;
  }
  function place(g, k, i, seat) {      // setzt Kante in-place, gibt Zahl geschlossener Kästchen zurück
    g[k][i] = seat; let closed = 0;
    for (const [r, c] of boxesOf(g, k, i)) if (g.box[r * g.b + c] < 0 && filled(g, r, c) === 4) { g.box[r * g.b + c] = seat; closed++; }
    return closed;
  }
  const freeMoves = g => { const m = []; g.h.forEach((x, i) => { if (x < 0) m.push(['h', i]); }); g.v.forEach((x, i) => { if (x < 0) m.push(['v', i]); }); return m; };
  const copyG = g => ({ n: g.n, b: g.b, h: g.h.slice(), v: g.v.slice(), box: g.box.slice() });

  const logic = {
    init(cfg) {
      const n = +(cfg.opt && cfg.opt.size) || 5;
      const s = { mode: cfg.mode, ...fresh(n), turn: cfg.rematch ? (Math.random() < 0.5 ? 0 : 1) : 0, score: [0, 0], last: null, moves: 0 };
      if (cfg.mode === 'solo') { s.blitz = true; s.endAt = Date.now() + SOLO_MS; s.boards = 1; }
      return s;
    },
    act(s, seat, type, arg, now) {
      if (type !== 'line' || seat !== s.turn || logic.done(s)) return null;
      const k = arg && arg.k === 'v' ? 'v' : 'h', i = arg && arg.i | 0;
      if (!(i >= 0 && i < s[k].length) || s[k][i] >= 0) return null;
      const g = copyG(s), closed = place(g, k, i, seat);
      const n = { ...s, ...g, last: { k, i, seat, closed, t: now }, moves: s.moves + 1, score: s.score.slice() };
      n.score[seat] += closed;
      if (!closed) n.turn = 1 - seat;
      if (n.blitz && n.box.every(x => x >= 0)) { Object.assign(n, fresh(n.n)); n.boards = s.boards + 1; n.turn = 0; n.newBoard = now; }
      return n;
    },
    tick(s, dt, now) { if (s.blitz && !s.timeUp && now >= s.endAt) return { ...s, timeUp: true }; return null; },
    done: s => s.blitz ? !!s.timeUp : s.box.every(x => x >= 0),
    turn: s => logic.done(s) ? -1 : s.turn,
    over(s) {
      if (!logic.done(s)) return null;
      if (s.blitz) return { title: 'Zeit um!', text: `Du hast <b>${s.score[0]}</b> ${s.score[0] === 1 ? 'Kästchen' : 'Kästchen'} geschlossen (der Bot ${s.score[1]}).`, best: { key: 'blitz' + s.n, value: s.score[0], fmt: v => v + ' Kästchen' } };
      const [a, b] = s.score;
      return a === b ? { winner: -1, title: 'Unentschieden', text: `${a} : ${b}` } : { winner: a > b ? 0 : 1, text: `${a} : ${b} Kästchen` };
    }
  };

  // ---- Bot-Heuristik ----
  function analyse(g, k, i) {           // was passiert, wenn diese Kante gesetzt wird?
    let closes = 0, gives = 0;
    for (const [r, c] of boxesOf(g, k, i)) { if (g.box[r * g.b + c] >= 0) continue; const f = filled(g, r, c) + 1; if (f === 4) closes++; else if (f === 3) gives++; }
    return { closes, gives };
  }
  function greedyGain(g, seat) {        // wie viele Kästchen holt der Gegner, wenn er gierig alles einsammelt?
    g = copyG(g); let total = 0, again = true;
    while (again) { again = false; for (const [k, i] of freeMoves(g)) { if (analyse(g, k, i).closes) { total += place(g, k, i, seat); again = true; break; } } }
    return total;
  }
  const bot = {
    delay: (s, level) => s.blitz ? 170 + Math.random() * 120 : 420 + Math.random() * 380 - level * 60,
    think(s, seat, level) {
      const moves = freeMoves(s); if (!moves.length) return null;
      const info = moves.map(([k, i]) => ({ k, i, ...analyse(s, k, i) }));
      const pick = arr => arr[Math.floor(Math.random() * arr.length)];
      const go = m => ({ type: 'line', arg: { k: m.k, i: m.i } });
      const closing = info.filter(m => m.closes);
      const safe = info.filter(m => !m.closes && !m.gives);
      if (level === 1) {
        if (closing.length && Math.random() < 0.7) return go(pick(closing));
        if (safe.length && Math.random() < 0.6) return go(pick(safe));
        return go(pick(info));
      }
      if (closing.length) {
        // Ketten verfolgen: bevorzugt Kästchen, nach denen sofort das nächste schließbar wird
        if (level === 3) {
          const follow = closing.filter(m => { const g = copyG(s); place(g, m.k, m.i, seat); return freeMoves(g).some(([k, i]) => analyse(g, k, i).closes); });
          if (follow.length) return go(pick(follow));
        }
        return go(pick(closing));
      }
      if (safe.length) return go(pick(safe));
      // Keine sichere Kante mehr: die Kante, die am wenigsten verschenkt
      let best = null, bestGift = Infinity;
      const cand = level === 3 ? info : info.slice().sort(() => Math.random() - 0.5).slice(0, Math.max(4, Math.ceil(info.length / 2)));
      for (const m of cand) { const g = copyG(s); place(g, m.k, m.i, seat); const gift = greedyGain(g, 1 - seat); if (gift < bestGift) { bestGift = gift; best = m; } }
      return go(best || pick(info));
    }
  };

  // ---- View: CSS-Raster aus Punkten, Kanten-Knöpfen und Kästchen ----
  let el, seen = { moves: -1 };
  const view = {
    mount(root, ctx) { el = root; root.innerHTML = '<div class="db-wrap"><div class="ar-timer" id="dbTimer" hidden><i></i></div><div class="db-grid" id="dbGrid"></div></div>'; seen = { moves: -1, n: 0, boards: 0 };
      root.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b && !b.disabled) ctx.act('line', { k: b.dataset.k, i: +b.dataset.i }); });
    },
    render(s, ctx) {
      const grid = el.querySelector('#dbGrid'), n = s.n, b = s.b, size = 2 * n - 1;
      if (seen.n !== n || seen.boards !== s.boards) {
        seen.n = n; seen.boards = s.boards;
        const tpl = Array(n - 1).fill('var(--dot) 1fr').join(' ') + ' var(--dot)';
        grid.style.gridTemplateColumns = tpl; grid.style.gridTemplateRows = tpl;
        let h = '';
        for (let R = 0; R < size; R++) for (let Cc = 0; Cc < size; Cc++) {
          const er = R % 2 === 0, ec = Cc % 2 === 0;
          if (er && ec) h += '<span class="db-dot" aria-hidden="true"></span>';
          else if (er) { const r = R / 2, c = (Cc - 1) / 2, i = r * b + c; h += `<button class="db-edge db-h" type="button" data-k="h" data-i="${i}" aria-label="Waagrechte Linie, Reihe ${r + 1}, zwischen Punkt ${c + 1} und ${c + 2}"></button>`; }
          else if (ec) { const r = (R - 1) / 2, c = Cc / 2, i = r * n + c; h += `<button class="db-edge db-v" type="button" data-k="v" data-i="${i}" aria-label="Senkrechte Linie, Spalte ${c + 1}, zwischen Punkt ${r + 1} und ${r + 2}"></button>`; }
          else { const r = (R - 1) / 2, c = (Cc - 1) / 2; h += `<span class="db-box" data-b="${r * b + c}"></span>`; }
        }
        grid.innerHTML = h;
      }
      const mine = logic.turn(s) >= 0 && ctx.canAct(s.turn);
      grid.classList.toggle('active', mine); grid.dataset.turn = s.turn;
      grid.querySelectorAll('.db-edge').forEach(e => {
        const o = s[e.dataset.k][+e.dataset.i];
        e.disabled = o >= 0 || !mine;
        e.className = 'db-edge db-' + e.dataset.k + (o >= 0 ? ' set p' + o : '') + (s.last && s.last.k === e.dataset.k && s.last.i === +e.dataset.i ? ' last' : '');
      });
      grid.querySelectorAll('.db-box').forEach(x => { const o = s.box[+x.dataset.b]; x.className = 'db-box' + (o >= 0 ? ' own p' + o : ''); x.textContent = o >= 0 ? (ctx.names[o] || '?').slice(0, 1).toUpperCase() : ''; });
      if (s.moves !== seen.moves) {
        if (seen.moves >= 0 && s.last) { ctx.sound(s.last.closed ? 'correct' : 'click'); if (s.last.closed && !s.blitz) ctx.say(`${ctx.names[s.last.seat]} schließt ${s.last.closed === 1 ? 'ein Kästchen' : s.last.closed + ' Kästchen'} und ist nochmal dran.`); }
        seen.moves = s.moves;
      }
      const tm = el.querySelector('#dbTimer'); tm.hidden = !s.blitz;
    },
    frame(s) {
      if (!s.blitz) return;
      const left = Math.max(0, s.endAt - Date.now()), tm = el.querySelector('#dbTimer');
      tm.querySelector('i').style.transform = `scaleX(${left / SOLO_MS})`; tm.classList.toggle('hot', left < 10000);
    }
  };

  LZArcade.define({
    id: 'dots', title: 'Käsekästchen', sub: 'Kanten ziehen, Kästchen schließen',
    modes: {
      solo: { desc: 'Blitz: 60 Sekunden gegen einen flinken Bot – wie viele Kästchen schnappst du dir?' },
      local: { desc: 'Abwechselnd Linien ziehen an einem Gerät.' },
      bot: { desc: 'Der Bot schließt freie Kästchen sofort und meidet riskante dritte Kanten. Schwer verfolgt Ketten und rechnet Geschenke nach.' },
      online: { desc: 'Jede Person am eigenen Gerät.' }
    },
    soloBot: { level: 2, name: 'Blitz-Bot' },
    options: [{ key: 'size', label: 'Brettgröße', values: [[4, '4 × 4 Punkte'], [5, '5 × 5 Punkte']], def: 5 }],
    rules: ['Abwechselnd verbindet ihr zwei benachbarte Punkte mit einer Linie.', 'Wer die vierte Seite eines Kästchens zieht, bekommt es – und ist gleich nochmal dran.', 'Vorsicht mit der dritten Seite: Die schenkt dem Gegner das Kästchen. Am Ende zählen die Kästchen.'],
    keys: '<b>Tastatur:</b> <kbd class="lz-kbd">Tab</kbd> oder <kbd class="lz-kbd">Pfeile</kbd> wandern über die Linien · <kbd class="lz-kbd">Enter</kbd> zieht sie',
    logic, bot, view,
    scores(s, ctx) {
      return [0, 1].map(i => ({ name: ctx.names[i] + (s.blitz && i === 0 ? '' : ''), vb: ctx.vb && ctx.vb[i], value: s.score[i], sub: s.blitz ? (i ? 'Gegner' : 'Brett ' + s.boards) : 'Kästchen', on: logic.turn(s) === i }));
    },
    status(s, ctx) {
      if (logic.done(s)) return 'Vorbei!';
      const t = s.turn, nm = ctx.esc(ctx.names[t]);
      if (s.blitz) return t === 0 ? 'Du bist dran – schnell!' : `<span class="dots">${nm}</span>`;
      if (ctx.isBot(t)) return `<span class="dots">${nm} überlegt</span>`;
      if (ctx.canAct(t) && ctx.mode !== 'local') return 'Du bist dran';
      return `<em>${nm}</em> ist dran`;
    }
  });
  // Pfeiltasten im Raster: Kanten sind Knöpfe in einem CSS-Grid -> geometrische Navigation von cozy.js
  if (window.LZCozy && LZCozy.arrowGroups) LZCozy.arrowGroups.push('.db-grid');
})();
