/* ==========================================================================
   Sternenfall – Regeln, Bots und Spieleransicht (gemeinsam für Server und Browser)
   Läuft im Cloudflare Worker (Online-Tische, Server verteilt die Karten) und im
   Browser (Spiel gegen Bots). Kein DOM, keine Abhängigkeiten.

   Karte: {id, c, v}
     c  Farbe/Sorte  0 Mond · 1 Stern · 2 Herz · 3 Pfote · 4 schwarz (Sternschnuppe)
     v  0–9 Zahl · 10 Aussetzen · 11 Richtungswechsel · 12 +2 · 13 Farbwahl · 14 Farbwahl +4
   Spielzustand g:
     deck, disc (Ablage, letzte = oben), hands[seat][], turn, dir, color (aktuelle Farbe),
     pend/pendV (aufgestaute Ziehkarten durch +2/+4), drawn (gerade gezogene, noch
     spielbare Karte), catchWin ({seat, until}: "Letzte Karte!" vergessen),
     called[seat], winner, last (letzte Aktion fürs Anzeigen), moves, opts {stack, until}
     (until = Hausregel "Ziehen bis es passt")
   Die Ansicht viewFor(g, seat) enthält NUR die eigene Hand – fremde Hände
   und der Stapel verlassen den Server nie.
   ========================================================================== */
(function (root) {
  'use strict';
  const SKIP = 10, REV = 11, DRAW2 = 12, WILD = 13, WILD4 = 14, HAND = 7, CATCH_MS = 3500;
  const COLORS = ['Mond', 'Stern', 'Herz', 'Pfote'];
  const NAME = v => v <= 9 ? String(v) : { 10: 'Aussetzen', 11: 'Richtungswechsel', 12: '+2', 13: 'Sternschnuppe', 14: 'Sternschnuppe +4' }[v];
  const cardName = c => c.c === 4 ? NAME(c.v) : COLORS[c.c] + ' ' + NAME(c.v);

  function rng(seed) { let a = seed >>> 0 || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function shuffle(a, rnd) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function makeDeck() {
    const d = []; let id = 1;
    for (let c = 0; c < 4; c++) {
      d.push({ id: id++, c, v: 0 });
      for (let v = 1; v <= 12; v++) { d.push({ id: id++, c, v }); d.push({ id: id++, c, v }); }
    }
    for (let k = 0; k < 4; k++) { d.push({ id: id++, c: 4, v: WILD }); d.push({ id: id++, c: 4, v: WILD4 }); }
    return d;                                            // 108 Karten
  }
  const top = g => g.disc[g.disc.length - 1];
  const next = (g, from, steps) => { let t = from; for (let i = 0; i < (steps || 1); i++) t = (t + g.dir + g.n) % g.n; return t; };
  function clone(g) { return { ...g, deck: g.deck.slice(), disc: g.disc.slice(), hands: g.hands.map(h => h.slice()), called: g.called.slice() }; }

  function newGame(n, opts, seed) {
    const rnd = rng(seed || (Math.random() * 2 ** 31) | 0);
    const deck = shuffle(makeDeck(), rnd), hands = [];
    for (let s = 0; s < n; s++) hands.push(deck.splice(0, HAND));
    let first; while (true) { first = deck.shift(); if (first.v <= 9) break; deck.splice(Math.floor(rnd() * deck.length), 0, first); }
    return { n, deck, disc: [first], hands, turn: Math.floor(rnd() * n), dir: 1, color: first.c, pend: 0, pendV: 0, drawn: null,
      catchWin: null, called: new Array(n).fill(false), winner: -1, last: { k: 'start', card: first }, moves: 0, opts: { stack: !(opts && opts.stack === false), until: !!(opts && opts.until) }, seed: (rnd() * 2 ** 31) | 0 };
  }
  function drawCards(g, seat, k) {                       // zieht k Karten (mischt die Ablage bei Bedarf neu)
    const got = [];
    for (let i = 0; i < k; i++) {
      if (!g.deck.length) {
        if (g.disc.length <= 1) break;
        const t = g.disc.pop(), rnd = rng(g.seed = (g.seed * 1103515245 + 12345) & 0x7fffffff);
        g.deck = shuffle(g.disc, rnd); g.disc = [t];
      }
      const c = g.deck.pop(); g.hands[seat].push(c); got.push(c);
    }
    return got;
  }
  function canPlay(g, card) {
    if (g.pend > 0) { if (!g.opts.stack) return false; return g.pendV === DRAW2 ? (card.v === DRAW2 || card.v === WILD4) : card.v === WILD4; }
    if (card.c === 4) return true;
    const t = top(g);
    return card.c === g.color || (t.c !== 4 && card.v === t.v);
  }
  function legal(g, seat) {
    if (g.winner >= 0 || seat !== g.turn) return [];
    const h = g.hands[seat];
    if (g.drawn != null) { const c = h.find(x => x.id === g.drawn); return c && canPlay(g, c) ? [c.id] : []; }
    return h.filter(c => canPlay(g, c)).map(c => c.id);
  }
  const bestColor = (hand, without) => { const n = [0, 0, 0, 0]; hand.forEach(c => { if (c.c < 4 && c.id !== without) n[c.c]++; }); let b = 0; for (let i = 1; i < 4; i++) if (n[i] > n[b]) b = i; return b; };
  function closeCatch(g) { g.catchWin = null; }

  // ---- Aktionen ----------------------------------------------------------------------
  function act(g0, seat, type, arg, now) {
    if (!g0 || g0.winner >= 0) return null;
    now = now || Date.now();
    const g = clone(g0);
    if (type === 'call') {                               // "Letzte Karte!" ansagen
      const h = g.hands[seat]; if (!h) return null;
      if (g.catchWin && g.catchWin.seat === seat) { closeCatch(g); g.called[seat] = true; g.last = { k: 'call', seat }; return g; }
      if (seat === g.turn && h.length === 2 && !g.called[seat]) { g.called[seat] = true; g.last = { k: 'call', seat }; return g; }
      return null;
    }
    if (type === 'catch') {                              // jemanden erwischen, der nicht angesagt hat
      if (!g.catchWin || g.catchWin.seat === seat || now > g.catchWin.until + 400) return null;
      const off = g.catchWin.seat; closeCatch(g); drawCards(g, off, 2); g.called[off] = false;
      g.last = { k: 'caught', seat, target: off }; g.moves++; return g;
    }
    if (seat !== g.turn) return null;
    if (g.catchWin) closeCatch(g);                       // der nächste Zug schließt das Zeitfenster
    const h = g.hands[seat];
    if (type === 'play') {
      const id = arg && arg.id, i = h.findIndex(c => c.id === id); if (i < 0) return null;
      if (!legal(g0, seat).includes(id)) return null;
      const card = h.splice(i, 1)[0]; g.disc.push(card); g.drawn = null; g.moves++;
      g.color = card.c === 4 ? ([0, 1, 2, 3].includes(arg.color) ? arg.color : bestColor(h)) : card.c;
      let steps = 1;
      if (card.v === SKIP) steps = 2;
      if (card.v === REV) { g.dir = -g.dir; if (g.n === 2) steps = 2; }
      if (card.v === DRAW2) { g.pend += 2; g.pendV = DRAW2; }
      if (card.v === WILD4) { g.pend += 4; g.pendV = WILD4; }
      if (arg.call && h.length === 1) g.called[seat] = true;
      g.last = { k: 'play', seat, card, color: g.color };
      if (!h.length) { g.winner = seat; return g; }
      if (h.length === 1 && !g.called[seat]) g.catchWin = { seat, until: now + CATCH_MS };
      g.called = g.called.map((x, s) => g.hands[s].length <= 2 ? x : false);
      g.turn = next(g, seat, steps);
      return g;
    }
    if (type === 'draw') {
      if (g.drawn != null) return null;
      g.moves++;
      if (g.pend > 0) { const k = g.pend; drawCards(g, seat, k); g.pend = 0; g.pendV = 0; g.last = { k: 'penalty', seat, n: k }; g.called[seat] = false; g.turn = next(g, seat); return g; }
      // Hausregel "Ziehen bis es passt" (opts.until): so lange ziehen, bis eine Karte passt oder nichts mehr da ist
      let got = drawCards(g, seat, 1), n = got.length;
      while (g.opts.until && got[0] && !canPlay(g, got[0]) && n < 60) { got = drawCards(g, seat, 1); n += got.length; }
      g.called[seat] = false;
      if (got[0] && canPlay(g, got[0])) { g.drawn = got[0].id; g.last = { k: 'draw', seat, n, playable: true }; return g; }
      g.last = { k: 'draw', seat, n }; g.turn = next(g, seat); return g;
    }
    if (type === 'pass') { if (g.drawn == null) return null; g.drawn = null; g.moves++; g.last = { k: 'pass', seat }; g.turn = next(g, seat); return g; }
    return null;
  }
  function tick(g, now) { if (g && g.catchWin && now > g.catchWin.until) { const n = clone(g); closeCatch(n); return n; } return null; }

  // ---- Ansicht für einen Sitz (das Einzige, was ein Browser zu sehen bekommt) --------
  function viewFor(g, seat) {
    return { n: g.n, me: seat, hand: seat >= 0 && g.hands[seat] ? g.hands[seat].slice() : [], counts: g.hands.map(h => h.length),
      top: top(g), color: g.color, dir: g.dir, turn: g.turn, pend: g.pend, pendV: g.pendV, drawn: seat === g.turn ? g.drawn : null,
      catchWin: g.catchWin, called: g.called.slice(), winner: g.winner, last: g.last, moves: g.moves, deckN: g.deck.length,
      legal: legal(g, seat), opts: g.opts, finalHands: g.winner >= 0 ? g.hands.map(h => h.length) : null };
  }

  // ---- Bots ----------------------------------------------------------------------------
  const CALL_P = { 1: 0.6, 2: 0.88, 3: 1 }, CATCH = { 1: [0.3, 2400], 2: [0.65, 1500], 3: [0.95, 700] };
  function botMove(g, seat, level, rnd) {
    rnd = rnd || Math.random;
    const h = g.hands[seat], ids = legal(g, seat), nxt = next(g, seat), nxtCards = g.hands[nxt].length;
    const play = c => ({ type: 'play', arg: { id: c.id, color: c.c === 4 ? (level === 1 ? Math.floor(rnd() * 4) : bestColor(h, c.id)) : undefined, call: h.length === 2 && rnd() < CALL_P[level] } });
    if (g.drawn != null) { const c = h.find(x => x.id === g.drawn); return c && ids.includes(c.id) && (level > 1 || rnd() < 0.7) ? play(c) : { type: 'pass' }; }
    if (!ids.length) return { type: 'draw' };
    const cards = h.filter(c => ids.includes(c.id));
    if (g.pend > 0) return level === 1 && rnd() < 0.3 ? { type: 'draw' } : play(cards.sort((a, b) => a.v - b.v)[0]);
    if (level === 1) {                                   // Leicht: meist irgendeine normale Karte, Joker eher selten
      const plain = cards.filter(c => c.c !== 4), pool = plain.length && rnd() < 0.75 ? plain : cards;
      return play(pool[Math.floor(rnd() * pool.length)]);
    }
    // Mittel/Schwer: Karten bewerten
    const colorCount = [0, 0, 0, 0]; h.forEach(c => { if (c.c < 4) colorCount[c.c]++; });
    const score = c => {
      let s = 0;
      if (c.c === 4) s -= c.v === WILD4 ? 6 : 4;                     // Joker möglichst aufheben
      else s += colorCount[c.c] * (level === 3 ? 0.8 : 0.4);           // in der Farbe bleiben, in der man viel hat
      if (c.v === SKIP || c.v === REV || c.v === DRAW2) s += nxtCards <= 2 ? 6 : (level === 3 ? 0.5 : 1.5);
      if (c.v === DRAW2 && nxtCards <= 3) s += 2;
      if (c.v === WILD4 && nxtCards <= 2) s += 9;                      // Notbremse gegen fast Fertige
      if (c.v <= 9) s += c.v * 0.08;                                   // hohe Zahlen zuerst loswerden
      if (h.length <= 2 && c.c === 4) s += 5;                          // zum Schluss Joker raus
      return s + rnd() * (level === 3 ? 0.2 : 0.8);
    };
    return play(cards.sort((a, b) => score(b) - score(a))[0]);
  }
  // Soll ein Bot jemanden erwischen? -> {delay} oder null
  function botCatch(g, seat, level, rnd) {
    if (!g.catchWin || g.catchWin.seat === seat) return null;
    const [p, d] = CATCH[level]; if ((rnd || Math.random)() > p) return null;
    return { delay: d * (0.7 + (rnd || Math.random)() * 0.6) };
  }

  root.SFCore = { newGame, act, tick, legal, canPlay, viewFor, botMove, botCatch, cardName, COLORS, NAME, SKIP, REV, DRAW2, WILD, WILD4, CATCH_MS, next };
})(typeof globalThis !== 'undefined' ? globalThis : window);
