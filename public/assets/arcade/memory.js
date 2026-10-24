/* ==========================================================================
   Speed-Memory – Lunacynas Spielezimmer
   Datenstruktur:
     cards: Array(16) Motiv-Nummer 0–7 (je zweimal)     – online verdeckt (hide)
     up:    [i, j]     gerade aufgedeckt, noch nicht gefunden
     found: Array(16)  −1 oder Sitz, der das Paar gefunden hat
     hideAt  Zeitpunkt, an dem ein Fehlversuch wieder zugedeckt wird
     t0/tEnd, misses (Solo: +1 Sekunde Strafe je Fehlversuch)
   Game-Loop: act('flip',{i}); bei zwei Karten -> Paar (gleicher Sitz bleibt dran)
              oder Fehlversuch -> tick() deckt nach kurzer Zeit wieder zu.
   Bot: beobachtet jede aufgedeckte Karte und merkt sie sich nur mit
        Wahrscheinlichkeit p (Leicht 50 %, Mittel 75 %, Schwer 95 %).
        Bekanntes Paar? -> nehmen. Sonst eine unbekannte Karte, dann den
        Partner aus dem Gedächtnis oder wieder eine unbekannte.
   ========================================================================== */
(function () {
  'use strict';
  const PAIRS = 8, N = 16, HIDE_MS = 950, SOLO_HIDE_MS = 650;
  const logic = {
    hide: ['cards'],
    init(cfg, rnd) {
      const cards = LZArcade.shuffle([...Array(PAIRS).keys(), ...Array(PAIRS).keys()], rnd);
      return { mode: cfg.mode, solo: cfg.mode === 'solo', cards, up: [], found: new Array(N).fill(-1), turn: cfg.rematch ? (Math.random() < 0.5 ? 0 : 1) : 0, score: [0, 0], misses: 0, hideAt: 0, t0: 0, tEnd: 0, flips: 0, last: null };
    },
    act(s, seat, type, arg, now) {
      if (type !== 'flip' || s.hideAt || logic.done(s)) return null;
      if (!s.solo && seat !== s.turn) return null;
      if (s.solo && seat !== 0) return null;
      const i = arg && arg.i | 0;
      if (!(i >= 0 && i < N) || s.found[i] >= 0 || s.up.includes(i)) return null;
      const n = { ...s, up: s.up.concat(i), flips: s.flips + 1, t0: s.t0 || now };
      if (n.up.length === 2) {
        const [a, b] = n.up;
        if (s.cards[a] === s.cards[b]) {
          n.found = s.found.slice(); n.found[a] = n.found[b] = seat; n.up = []; n.score = s.score.slice(); n.score[seat]++;
          n.last = { k: 'pair', seat, a, b, t: now };
          if (n.found.every(x => x >= 0)) n.tEnd = now;
        } else { n.hideAt = now + (s.solo ? SOLO_HIDE_MS : HIDE_MS); n.misses = s.misses + 1; n.last = { k: 'miss', seat, a, b, t: now }; }
      } else n.last = { k: 'flip', seat, a: i, t: now };
      return n;
    },
    tick(s, dt, now) {
      if (s.hideAt && now >= s.hideAt) return { ...s, up: [], hideAt: 0, turn: s.solo ? 0 : 1 - s.turn };
      return null;
    },
    done: s => s.found.every(x => x >= 0),
    turn: s => logic.done(s) || s.hideAt ? -1 : (s.solo ? 0 : s.turn),
    over(s) {
      if (!logic.done(s)) return null;
      if (s.solo) {
        const t = Math.round((s.tEnd - s.t0) / 100) / 10 + s.misses;
        return { title: 'Alle Paare gefunden!', text: `Zeit: <b>${fmt(t)} s</b> (davon ${s.misses} s Strafe für ${s.misses} ${s.misses === 1 ? 'Fehlversuch' : 'Fehlversuche'}).`, best: { key: 'time', value: t, lower: true, fmt: v => fmt(v) + ' s' }, record: t };
      }
      const [a, b] = s.score;
      return a === b ? { winner: -1, title: 'Unentschieden', text: `${a} : ${b} Paare` } : { winner: a > b ? 0 : 1, text: `${a} : ${b} Paare` };
    }
  };
  const fmt = v => v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  // ---- Bot mit lückenhaftem Gedächtnis ----
  const REMEMBER = { 1: 0.5, 2: 0.75, 3: 0.95 };
  const bot = {
    observe(s, mem, level) {
      mem.known = mem.known || {}; mem.flips = mem.flips || 0;
      if (s.flips === mem.flips) return;                       // nur neue Aufdeck-Ereignisse
      mem.flips = s.flips;
      const i = s.last && (s.last.k === 'flip' ? s.last.a : s.last.b);
      const look = s.last && s.last.k !== 'flip' ? [s.last.a, s.last.b] : [i];
      // auch die erste Karte eines Paares wurde beim ersten Aufdecken schon gesehen
      for (const j of look) if (j != null && s.found[j] < 0 && !(j in mem.known) && Math.random() < REMEMBER[level]) mem.known[j] = s.cards[j];
      for (const j in mem.known) if (s.found[j] >= 0) delete mem.known[j];
    },
    delay: (s, level) => 650 + Math.random() * 450 + (level === 1 ? 250 : 0),
    think(s, seat, level, mem) {
      const known = mem.known || {}, open = [...Array(N).keys()].filter(i => s.found[i] < 0 && !s.up.includes(i));
      const unknown = open.filter(i => !(i in known)), rnd = a => a[Math.floor(Math.random() * a.length)];
      if (!open.length) return null;
      if (s.up.length === 0) {
        const bySym = {};
        for (const i of open) if (i in known) { const k = known[i]; (bySym[k] = bySym[k] || []).push(i); }
        const pair = Object.values(bySym).find(a => a.length >= 2);
        return { type: 'flip', arg: { i: pair ? pair[0] : (unknown.length ? rnd(unknown) : rnd(open)) } };
      }
      const first = s.up[0], sym = s.cards[first];
      const partner = open.find(i => known[i] === sym);
      const rest = unknown.filter(i => i !== first);
      return { type: 'flip', arg: { i: partner != null ? partner : (rest.length ? rnd(rest) : rnd(open)) } };
    }
  };

  // ---- View: 4×4 Karten mit Motiven ----
  const SYM = [
    ['Mond', '#FFD98A', '<path d="M30 9a16 16 0 1 0 9 26A13 13 0 0 1 30 9z"/>'],
    ['Stern', '#FFE66D', '<path d="M24 6l5 11 12 1-9 8 3 12-11-6-11 6 3-12-9-8 12-1z"/>'],
    ['Katze', '#C9B6FF', '<path d="M10 14l7 6h14l7-6v18a14 12 0 0 1-28 0z"/><circle cx="19" cy="28" r="2" fill="#2A1E4F"/><circle cx="29" cy="28" r="2" fill="#2A1E4F"/>'],
    ['Pfote', '#F2A7A8', '<ellipse cx="24" cy="31" rx="8" ry="7"/><circle cx="13" cy="21" r="4"/><circle cx="20" cy="14" r="4"/><circle cx="28" cy="14" r="4"/><circle cx="35" cy="21" r="4"/>'],
    ['Tasse', '#9FE3C7', '<path d="M10 16h22v12a9 9 0 0 1-9 9h-4a9 9 0 0 1-9-9z"/><path d="M32 19h3a5 5 0 0 1 0 10h-3" fill="none" stroke="currentColor" stroke-width="3"/>'],
    ['Pilz', '#FF8FA3', '<path d="M8 24a16 13 0 0 1 32 0z"/><rect x="19" y="24" width="10" height="14" rx="3" fill="#FFF4E6"/>'],
    ['Herz', '#FF6F91', '<path d="M24 39S8 29 8 18a8 8 0 0 1 16-2 8 8 0 0 1 16 2c0 11-16 21-16 21z"/>'],
    ['Geist', '#E8F1FF', '<path d="M11 40V22a13 13 0 0 1 26 0v18l-4-3-5 3-4-3-4 3-5-3z"/><circle cx="19" cy="22" r="2" fill="#2A1E4F"/><circle cx="29" cy="22" r="2" fill="#2A1E4F"/>']
  ];
  let el, seen = { flips: -1 };
  const view = {
    mount(root, ctx) {
      el = root;
      root.innerHTML = `<div class="mm-wrap"><div class="mm-bar" id="mmBar"></div><div class="mm-grid" role="grid" aria-label="16 Karten">${[...Array(N).keys()].map(i => `<button class="mm-card" type="button" data-i="${i}"><span class="mm-in"><span class="mm-back" aria-hidden="true"></span><span class="mm-face"></span></span></button>`).join('')}</div></div>`;
      root.querySelector('.mm-grid').addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) ctx.act('flip', { i: +b.dataset.i }); });
      seen = { flips: -1 };
    },
    render(s, ctx) {
      const can = logic.turn(s) >= 0 && ctx.canAct(logic.turn(s));
      el.querySelectorAll('.mm-card').forEach((b, i) => {
        const vis = s.found[i] >= 0 || s.up.includes(i), sym = vis ? SYM[s.cards[i]] : null;
        b.classList.toggle('open', vis); b.classList.toggle('found', s.found[i] >= 0);
        b.classList.toggle('p0', s.found[i] === 0); b.classList.toggle('p1', s.found[i] === 1);
        b.classList.toggle('miss', !!s.hideAt && s.up.includes(i));
        const face = b.querySelector('.mm-face');
        const key = vis ? String(s.cards[i]) : '';
        if (face.dataset.k !== key) { face.dataset.k = key; face.innerHTML = sym ? `<svg viewBox="0 0 48 48" style="color:${sym[1]}" fill="currentColor" aria-hidden="true">${sym[2]}</svg>` : ''; }
        b.setAttribute('aria-label', `Karte ${i + 1}${vis ? ': ' + sym[0] : ', verdeckt'}${s.found[i] >= 0 ? ', gefunden' : ''}`);
        b.disabled = !can || vis;
      });
      if (s.flips !== seen.flips) {
        if (seen.flips >= 0 && s.last) {
          if (s.last.k === 'pair') { ctx.sound('correct'); ctx.say(`Paar gefunden: ${SYM[s.cards[s.last.a]][0]}.`); }
          else if (s.last.k === 'miss') { ctx.sound('wrong'); ctx.say(`${SYM[s.cards[s.last.b]][0]} passt nicht zu ${SYM[s.cards[s.last.a]][0]}.`); }
          else { ctx.sound('click'); ctx.say(SYM[s.cards[s.last.a]][0]); }
        }
        seen.flips = s.flips;
      }
    },
    frame(s) {
      if (!s.solo) return;
      const bar = el.querySelector('#mmBar');
      const t = s.t0 ? ((s.tEnd || Date.now()) - s.t0) / 1000 : 0;
      const txt = `⏱ ${fmt(t)} s${s.misses ? ` <small>+${s.misses} s Strafe</small>` : ''}`;
      if (bar._t !== txt) { bar._t = txt; bar.innerHTML = txt; }
    }
  };

  LZArcade.define({
    id: 'memo', title: 'Speed-Memory', sub: '8 Paare',
    modes: {
      solo: { desc: 'Gegen die Stoppuhr: Jeder Fehlversuch kostet eine Strafsekunde.' },
      local: { desc: 'Punkte-Duell: Wer ein Paar findet, darf nochmal.' },
      bot: { desc: 'Der Bot vergisst: Leicht merkt sich 50 %, Mittel 75 %, Schwer 95 % der Karten.' },
      online: { desc: 'Jede Person am eigenen Gerät – die Karten sind für beide verdeckt.' }
    },
    rules: ['Deck zwei Karten auf. Gleiches Motiv? Dann bleibt das Paar liegen.', 'Passen sie nicht, werden sie wieder umgedreht – merk dir, wo was lag.', 'Zu zweit: Wer ein Paar findet, ist nochmal dran. Die meisten Paare gewinnen.'],
    keys: '<b>Tastatur:</b> <kbd class="lz-kbd">Pfeile</kbd> wandern über die Karten · <kbd class="lz-kbd">Enter</kbd> deckt auf',
    logic, bot, view,
    points: (s, i) => s.score[i],
    scores(s, ctx) {
      if (s.solo) return [{ name: ctx.names[0], value: s.score[0] + '/8', sub: s.misses + ' Fehlversuche', on: true }];
      return [0, 1].map(i => ({ name: ctx.names[i], vb: ctx.vb && ctx.vb[i], value: s.score[i], sub: 'Paare', on: logic.turn(s) === i }));
    },
    status(s, ctx) {
      if (logic.done(s)) return 'Alle Paare gefunden!';
      if (s.solo) return s.t0 ? `<em>${s.score[0]}</em> von 8 Paaren` : 'Die Uhr startet mit der ersten Karte.';
      const t = s.turn, nm = ctx.esc(ctx.names[t]);
      if (s.hideAt) return 'Kein Paar …';
      if (ctx.isBot(t)) return `<span class="dots">${nm} überlegt</span>`;
      return ctx.canAct(t) && ctx.mode !== 'local' ? 'Du bist dran' : `<em>${nm}</em> ist dran`;
    }
  });
  if (window.LZCozy && LZCozy.arrowGroups) LZCozy.arrowGroups.push('.mm-grid');
})();
