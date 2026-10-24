/* ==========================================================================
   Vier gewinnt – Lunacynas Spielezimmer
   Datenstruktur:  b = Array(42), Index = spalte*6 + zeile (zeile 0 = unten),
                   Werte 0 leer / 1 Sitz 0 / 2 Sitz 1
   Ablauf:        rundenbasiert, act('drop', {c}) -> Chip fällt, Sieg/Remis prüfen
   Bot:           Negamax mit Alpha-Beta, Zugsortierung Mitte zuerst,
                  Bewertung über alle 69 Viererfenster. Tiefe 1 / 4 / 7.
   Solo:          Puzzle – vorgegebene Stellung, Sieg in N eigenen Zügen gegen
                  einen perfekt verteidigenden Bot.
   ========================================================================== */
(function (root) {
  'use strict';
  const W = 7, H = 6, N = W * H;
  const idx = (c, r) => c * H + r;

  // ---------------- Kernregeln (rein, ohne DOM) ----------------
  function height(b, c) { let r = 0; while (r < H && b[idx(c, r)]) r++; return r; }
  function canDrop(b, c) { return c >= 0 && c < W && !b[idx(c, H - 1)]; }
  const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
  function winLine(b, c, r) {
    const v = b[idx(c, r)]; if (!v) return null;
    for (const [dc, dr] of DIRS) {
      const line = [[c, r]];
      for (const s of [1, -1]) { let x = c + dc * s, y = r + dr * s; while (x >= 0 && x < W && y >= 0 && y < H && b[idx(x, y)] === v) { line.push([x, y]); x += dc * s; y += dr * s; } }
      if (line.length >= 4) return line;
    }
    return null;
  }

  // ---------------- Bot: Negamax + Alpha-Beta ----------------
  const ORDER = [3, 2, 4, 1, 5, 0, 6];
  const WINDOWS = [];
  for (let c = 0; c < W; c++) for (let r = 0; r < H; r++) for (const [dc, dr] of DIRS) {
    const cells = []; for (let k = 0; k < 4; k++) { const x = c + dc * k, y = r + dr * k; if (x < 0 || x >= W || y < 0 || y >= H) break; cells.push(idx(x, y)); }
    if (cells.length === 4) WINDOWS.push(cells);
  }
  function evaluate(b, me) {        // aus Sicht von "me" (1 oder 2)
    const op = 3 - me; let s = 0;
    for (let r = 0; r < H; r++) { if (b[idx(3, r)] === me) s += 3; else if (b[idx(3, r)] === op) s -= 3; }
    for (const w of WINDOWS) {
      let m = 0, o = 0; for (const i of w) { if (b[i] === me) m++; else if (b[i] === op) o++; }
      if (m && o) continue;
      if (m === 3) s += 5; else if (m === 2) s += 2;
      if (o === 3) s -= 4; else if (o === 2) s -= 1;
    }
    return s;
  }
  const WIN = 100000;
  let nodes = 0;
  function negamax(b, depth, alpha, beta, me, ply) {
    nodes++;
    let any = false;
    for (const c of ORDER) {                 // sofortiger Sieg?
      if (!canDrop(b, c)) continue; any = true;
      const r = height(b, c); b[idx(c, r)] = me; const w = winLine(b, c, r); b[idx(c, r)] = 0;
      if (w) return WIN - ply;
    }
    if (!any) return 0;                      // Remis
    if (depth === 0) return evaluate(b, me);
    let best = -Infinity;
    for (const c of ORDER) {
      if (!canDrop(b, c)) continue;
      const r = height(b, c); b[idx(c, r)] = me;
      const v = -negamax(b, depth - 1, -beta, -alpha, 3 - me, ply + 1);
      b[idx(c, r)] = 0;
      if (v > best) best = v; if (v > alpha) alpha = v; if (alpha >= beta) break;
    }
    return best;
  }
  function bestMove(board, me, depth, rnd) {
    const b = board.slice(); nodes = 0;
    let best = -Infinity, moves = [];
    for (const c of ORDER) {
      if (!canDrop(b, c)) continue;
      const r = height(b, c); b[idx(c, r)] = me;
      const v = winLine(b, c, r) ? WIN : -negamax(b, depth - 1, -Infinity, Infinity, 3 - me, 1);
      b[idx(c, r)] = 0;
      if (v > best + 1e-9) { best = v; moves = [c]; } else if (Math.abs(v - best) < 1e-9) moves.push(c);
    }
    // Gleich gute Züge: Mitte bevorzugen, aber nicht immer (wirkt menschlicher)
    const pick = moves.length > 1 && rnd && rnd() < 0.35 ? moves[Math.floor(rnd() * moves.length)] : moves[0];
    return { c: pick, score: best, nodes };
  }
  const DEPTH = { 1: 1, 2: 4, 3: 7 };

  // ---------------- Puzzles (Solo) ----------------
  // Erzeugt und geprüft mit dem Solver oben: Sitz 0 (gelb) ist am Zug und kann
  // gegen jede Verteidigung in genau n eigenen Zügen gewinnen.
  // Format: Spalten von links, je Spalte die Chips von unten (1 = Gelb, 2 = Blau)
  const PUZZLES = [{"n":1,"b":"/12/11/12/2/22/12112"},{"n":1,"b":"22/1/1//1/122/"},{"n":2,"b":"12/2121/12/122/21/2121/1"},{"n":2,"b":"121/212/2/1/112/2121/2"},{"n":2,"b":"2/1/1/122/2/121212/211"},{"n":2,"b":"112/2/2122/1/1/112/2"},{"n":3,"b":"1112/221/122/11/2/1/2212"},{"n":3,"b":"/11/21/221/21/122/"},{"n":3,"b":"2212/1//21/11/212/1221"}];
  const PKEY = 'lz_c4_puzzle';
  const progress = () => { try { return +(localStorage.getItem(PKEY) || 0); } catch (e) { return 0; } };
  const setProgress = n => { try { if (n > progress()) localStorage.setItem(PKEY, String(n)); } catch (e) {} };
  function decode(str) { const b = new Array(N).fill(0); for (let c = 0; c < W; c++) { const col = str.split('/')[c] || ''; for (let r = 0; r < col.length; r++) b[idx(c, r)] = +col[r]; } return b; }

  // ---------------- Logic ----------------
  const logic = {
    init(cfg) {
      const s = { b: new Array(N).fill(0), turn: 0, win: -1, line: null, last: null, moves: 0, draw: false, mode: cfg.mode };
      if (cfg.mode === 'solo' && PUZZLES.length) {
        const p = PUZZLES[Math.min(progress(), PUZZLES.length - 1)];
        s.b = decode(p.b); s.puzzle = PUZZLES.indexOf(p); s.need = p.n; s.used = 0;
      } else if (cfg.rematch) s.turn = Math.random() < 0.5 ? 0 : 1;
      return s;
    },
    act(s, seat, type, arg) {
      if (type !== 'drop' || s.win >= 0 || s.draw || seat !== s.turn) return null;
      const c = arg && arg.c | 0; if (!canDrop(s.b, c)) return null;
      const b = s.b.slice(), r = height(b, c); b[idx(c, r)] = seat + 1;
      const line = winLine(b, c, r), full = b.every(Boolean);
      const n = { ...s, b, last: { c, r }, moves: s.moves + 1, turn: 1 - seat, win: line ? seat : -1, line, draw: !line && full };
      if (s.puzzle != null && seat === 0) { n.used = s.used + 1; if (!line && n.used >= s.need) n.failed = true; }
      return n;
    },
    turn: s => (s.win >= 0 || s.draw || s.failed) ? -1 : s.turn,
    over(s) {
      if (s.puzzle != null) {
        if (s.win === 0) { setProgress(s.puzzle + 1); return { winner: 0, title: 'Gelöst!', text: `Puzzle ${s.puzzle + 1} von ${PUZZLES.length} in ${s.used} ${s.used === 1 ? 'Zug' : 'Zügen'}.${s.puzzle + 1 >= PUZZLES.length ? ' Du hast alle geschafft!' : ' Weiter geht\'s mit dem nächsten.'}`, best: { key: 'puzzles', value: s.puzzle + 1, fmt: v => v + ' gelöst' } }; }
        if (s.win === 1 || s.failed || s.draw) return { winner: 1, title: 'Knapp daneben', text: `Den Sieg in ${s.need} ${s.need === 1 ? 'Zug' : 'Zügen'} gibt es – versuch es nochmal.` };
        return null;
      }
      if (s.win >= 0) return { winner: s.win, text: 'Vier in einer Reihe!' };
      if (s.draw) return { winner: -1, title: 'Unentschieden', text: 'Das Brett ist voll.' };
      return null;
    }
  };

  // ---------------- Bot ----------------
  const bot = {
    delay: (s, level) => s.puzzle != null ? 450 : 350 + level * 150,
    think(s, seat, level) {
      const legal = [0, 1, 2, 3, 4, 5, 6].filter(c => canDrop(s.b, c));
      if (!legal.length) return null;
      if (level === 1 && Math.random() < 0.25) return { type: 'drop', arg: { c: legal[Math.floor(Math.random() * legal.length)] } };
      const m = bestMove(s.b, seat + 1, s.puzzle != null ? 8 : DEPTH[level] || 4, Math.random);
      return { type: 'drop', arg: { c: m.c } };
    }
  };

  // ---------------- View ----------------
  let el, cursor = 3, lastKey = '';
  const view = {
    mount(root, ctx) {
      el = root;
      root.innerHTML = `<div class="c4-wrap"><div class="c4-board" role="grid" aria-label="Spielbrett, 7 Spalten">${
        Array.from({ length: W }, (_, c) => `<button class="c4-col" type="button" data-col="${c}" role="gridcell"><span class="c4-hover" aria-hidden="true"></span>${Array.from({ length: H }, (_, r) => `<span class="c4-cell" data-r="${H - 1 - r}"><i></i></span>`).join('')}</button>`).join('')
      }</div><p class="hint c4-hint" id="c4Hint"></p></div>`;
      root.querySelector('.c4-board').addEventListener('click', e => { const b = e.target.closest('[data-col]'); if (b) { cursor = +b.dataset.col; ctx.act('drop', { c: cursor }); } });
      root.querySelector('.c4-board').addEventListener('mouseover', e => { const b = e.target.closest('[data-col]'); if (b) { cursor = +b.dataset.col; paintCursor(); } });
      lastKey = '';
    },
    render(s, ctx) {
      const cols = el.querySelectorAll('.c4-col');
      const mine = ctx.canAct(s.turn) && logic.turn(s) >= 0;
      el.querySelector('.c4-board').classList.toggle('active', mine);
      el.querySelector('.c4-board').dataset.turn = s.turn;
      cols.forEach((col, c) => {
        const h = height(s.b, c);
        col.disabled = !mine || !canDrop(s.b, c);
        col.setAttribute('aria-label', `Spalte ${c + 1}, ${H - h} frei`);
        col.querySelectorAll('.c4-cell').forEach(cell => {
          const r = +cell.dataset.r, v = s.b[idx(c, r)];
          cell.className = 'c4-cell' + (v ? ' p' + v : '') + (s.line && s.line.some(([x, y]) => x === c && y === r) ? ' win' : '');
          const isLast = s.last && s.last.c === c && s.last.r === r;
          if (isLast && cell.dataset.k !== String(s.moves)) { cell.dataset.k = s.moves; cell.style.setProperty('--fall', (H - r) + ''); cell.classList.add('drop'); }
        });
      });
      // Ton + Ansage für den letzten Zug (einmal pro Zug)
      const key = s.moves + ':' + s.win;
      if (key !== lastKey) {
        if (s.moves && lastKey) { ctx.sound(s.win >= 0 ? 'correct' : 'pop'); ctx.say(`${ctx.names[1 - s.turn] || ''} setzt in Spalte ${s.last.c + 1}.`); }
        lastKey = key;
      }
      const hint = el.querySelector('#c4Hint');
      hint.textContent = s.puzzle != null ? `Puzzle ${s.puzzle + 1}/${PUZZLES.length} · Gelb gewinnt in ${s.need} ${s.need === 1 ? 'Zug' : 'Zügen'} – noch ${Math.max(0, s.need - s.used)}.` : '';
      paintCursor();
    },
    key(e, s, ctx) {
      if (/^[1-7]$/.test(e.key)) { cursor = +e.key - 1; ctx.act('drop', { c: cursor }); e.preventDefault(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.c4-board')) return;   // Pfeile im Brett übernimmt die Fokus-Navigation
        cursor = (cursor + (e.key === 'ArrowLeft' ? W - 1 : 1)) % W; paintCursor(); e.preventDefault();
      }
      if ((e.key === 'Enter' || e.key === ' ') && !(document.activeElement && document.activeElement.matches('button,a'))) { ctx.act('drop', { c: cursor }); e.preventDefault(); }
    }
  };
  function paintCursor() { if (!el) return; el.querySelectorAll('.c4-col').forEach((c, i) => c.classList.toggle('cur', i === cursor)); }

  const def = {
    id: 'c4', title: 'Vier gewinnt', sub: 'Zwei Farben, ein Brett, vier in einer Reihe',
    modes: {
      solo: { desc: 'Puzzle: Finde den Siegeszug gegen einen Bot, der perfekt verteidigt. Von „Sieg in 1“ bis „Sieg in 3“.' },
      bot: { desc: 'Der Bot rechnet voraus: Leicht 1 Zug, Mittel 4, Schwer 7 Züge tief.' },
      online: { desc: 'Jede Person am eigenen Gerät, abwechselnd.' }
    },
    soloBot: { level: 3, name: 'Verteidiger' },
    rules: ['Wer dran ist, wirft einen Chip in eine Spalte – er fällt nach ganz unten.', 'Vier eigene Chips in einer Reihe gewinnen: waagrecht, senkrecht oder schräg.', 'Ist das Brett voll ohne Viererreihe, endet es unentschieden.'],
    keys: '<b>Tastatur:</b> <kbd class="lz-kbd">1</kbd>–<kbd class="lz-kbd">7</kbd> wirft in die Spalte · <kbd class="lz-kbd">←</kbd><kbd class="lz-kbd">→</kbd> wählen · <kbd class="lz-kbd">Enter</kbd> einwerfen',
    logic, bot, view,
    scores(s, ctx) {
      const cnt = v => s.b.filter(x => x === v).length;
      return ctx.names.slice(0, 2).map((n, i) => ({ name: n + (ctx.canAct(i) && ctx.mode !== 'local' ? ' (du)' : ''), vb: ctx.vb && ctx.vb[i], value: cnt(i + 1), sub: i === 0 ? 'Gelb' : 'Blau', on: logic.turn(s) === i }));
    },
    status(s, ctx) {
      if (s.win >= 0) return `<em>${ctx.esc(ctx.names[s.win])}</em> gewinnt!`;
      if (s.draw) return 'Unentschieden.';
      if (s.failed) return 'Die Züge sind aufgebraucht.';
      const t = s.turn, nm = ctx.esc(ctx.names[t]);
      if (ctx.canAct(t) && ctx.mode !== 'local') return `Du bist dran <em>(${t ? 'Blau' : 'Gelb'})</em>`;
      if (ctx.isBot(t)) return `<span class="dots">${nm} denkt nach</span>`;
      return `<em>${nm}</em> ist dran (${t ? 'Blau' : 'Gelb'})`;
    }
  };
  if (root.LZArcade) root.LZArcade.define(def);
  root.C4 = { bestMove, canDrop, height, winLine, idx, W, H, decode, negamax };   // für Tests & Puzzle-Generator
})(typeof window !== 'undefined' ? window : globalThis);
