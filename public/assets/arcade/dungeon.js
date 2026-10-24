/* ==========================================================================
   Karten-Dungeon (Card Crawl Light) – Lunacynas Spielezimmer
   Datenstruktur:
     deck: [card]   verdeckter Stapel (online verborgen)
     grid: Array(9) offene Auslage 3×3 (card | null), Lücken werden sofort nachgelegt
     pl:   [{hp, max, gold, weapon, shield, forced}]
     card = {id, k:'monster'|'weapon'|'shield'|'potion'|'gold'|'dagger'|'bait', v}
   Regeln (act('take', {i})):
     Monster  – Schaden = Wert − Waffe; der Schild fängt den Rest ab (und verbraucht sich).
                Überlebst du, gibt es den Wert als Kopfgeld in Gold. Die Waffe stumpft um 1 ab.
     Waffe / Schild – ersetzt die alte.   Trank – heilt.   Gold – Gold.
     Nur im Duell:  Dolch – trifft den Gegner direkt.
                    Köder – der Gegner MUSS als Nächstes das stärkste Monster nehmen.
   Solo: Räume den ganzen Dungeon leer, ohne zu sterben. Punkte = Gold + übrige HP.
   Duell: abwechselnd ziehen. Wer auf 0 HP fällt, verliert; sonst gewinnt am Ende mehr Gold.
   Bot: bewertet jede Karte (Schaden, Kopfgeld, Heilung, Ausrüstungsgewinn, Schaden
        beim Gegner). Schwer schaut zusätzlich, was der Gegner danach Bestes ziehen kann.
   ========================================================================== */
(function (root) {
  'use strict';
  const MAX_HP = 13, HANDICAP = 3;
  const SOLO = { monster: [2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 10, 11], weapon: [2, 3, 4, 5, 6, 7], shield: [2, 3, 4, 5, 6], potion: [2, 3, 4, 5, 6, 7], gold: [1, 2, 3, 4, 5, 6] };
  const DUO_EXTRA = { monster: [3, 5, 7, 9], potion: [3, 5], dagger: [2, 3, 4, 5], bait: [1, 1] };
  function makeDeck(duo, rnd) {
    const out = []; let id = 1;
    const add = set => { for (const k in set) for (const v of set[k]) out.push({ id: id++, k, v }); };
    add(SOLO); if (duo) add(DUO_EXTRA);
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  }
  const strongest = grid => { let m = -1; grid.forEach(c => { if (c && c.k === 'monster' && c.v > m) m = c.v; }); return m; };
  function legal(s, seat) {
    const p = s.pl[seat], idx = [];
    const forcedV = p.forced ? strongest(s.grid) : -1;
    s.grid.forEach((c, i) => { if (!c) return; if (forcedV > 0 && !(c.k === 'monster' && c.v === forcedV)) return; idx.push(i); });
    return idx;
  }
  function hit(p, dmg) {                      // Schaden gegen Schild, dann HP
    const abs = Math.min(p.shield, dmg); p.shield -= abs; dmg -= abs; p.hp = Math.max(0, p.hp - dmg); return dmg;
  }
  function resolve(s, seat, i) {              // gibt neuen Zustand zurück (Kopie)
    const n = { ...s, grid: s.grid.slice(), deck: s.deck.slice(), pl: s.pl.map(p => ({ ...p })) };
    const c = n.grid[i], me = n.pl[seat], op = n.pl[1 - seat];
    let info = { seat, card: c };
    me.forced = false;
    if (c.k === 'monster') {
      const raw = Math.max(0, c.v - me.weapon); if (me.weapon > 0) me.weapon--;
      info.dmg = hit(me, raw); if (me.hp > 0) { me.gold += c.v; info.gold = c.v; }
    } else if (c.k === 'weapon') me.weapon = c.v;
    else if (c.k === 'shield') me.shield = c.v;
    else if (c.k === 'potion') { const h = Math.min(c.v, me.max - me.hp); me.hp += h; info.heal = h; }
    else if (c.k === 'gold') { me.gold += c.v; info.gold = c.v; }
    else if (c.k === 'dagger' && op) info.dmg = hit(op, c.v);
    else if (c.k === 'bait' && op) { op.forced = strongest(n.grid.map((x, j) => j === i ? null : x)) > 0; info.bait = op.forced; }
    n.grid[i] = n.deck.length ? n.deck.pop() : null;
    n.log = (s.log || []).concat(info).slice(-8); n.last = info; n.lastI = i; n.moves = (s.moves || 0) + 1;
    return n;
  }
  const logic = {
    hide: ['deck'],
    init(cfg, rnd) {
      const duo = cfg.mode !== 'solo', deck = makeDeck(duo, rnd), grid = [];
      for (let i = 0; i < 9; i++) grid.push(deck.pop());
      const p = () => ({ hp: MAX_HP, max: MAX_HP, gold: 0, weapon: 0, shield: 0, forced: false });
      const turn = cfg.rematch ? (Math.random() < 0.5 ? 0 : 1) : 0, pl = duo ? [p(), p()] : [p()];
      if (duo) pl[1 - turn].hp = pl[1 - turn].max = MAX_HP + HANDICAP;   // wer als Zweites zieht, hält mehr aus (gleicht den Anzugsvorteil aus – per Simulation ~50:50)
      return { mode: cfg.mode, duo, deck, grid, pl, turn, moves: 0, log: [], last: null };
    },
    act(s, seat, type, arg) {
      if (type !== 'take' || logic.done(s) || seat !== s.turn) return null;
      const i = arg && arg.i | 0; if (!legal(s, seat).includes(i)) return null;
      const n = resolve(s, seat, i);
      if (n.duo) { n.turn = 1 - seat; if (n.pl[n.turn].forced && strongest(n.grid) < 0) n.pl[n.turn].forced = false; }
      return n;
    },
    done: s => s.pl.some(p => p.hp <= 0) || s.grid.every(c => !c),
    turn: s => logic.done(s) ? -1 : s.turn,
    over(s) {
      if (!logic.done(s)) return null;
      if (!s.duo) {
        const p = s.pl[0];
        if (p.hp <= 0) return { title: 'Im Dungeon gefallen', text: `Du hattest <b>${p.gold}</b> Gold gesammelt. Noch ${s.grid.filter(Boolean).length + s.deck.length} Karten übrig.` };
        const pts = p.gold + p.hp;
        return { title: 'Dungeon geschafft!', text: `${p.gold} Gold + ${p.hp} HP = <b>${pts}</b> Punkte.`, best: { key: 'solo', value: pts, fmt: v => v + ' Punkte' }, record: pts };
      }
      const [a, b] = s.pl;
      if (a.hp <= 0 || b.hp <= 0) { const w = a.hp > 0 ? 0 : 1; return { winner: w, text: 'K.o. im Dungeon!' }; }
      if (a.gold === b.gold) return a.hp === b.hp ? { winner: -1, title: 'Unentschieden', text: `${a.gold} : ${b.gold} Gold` } : { winner: a.hp > b.hp ? 0 : 1, text: `Gleich viel Gold – mehr Lebenspunkte entscheiden.` };
      return { winner: a.gold > b.gold ? 0 : 1, text: `${a.gold} : ${b.gold} Gold` };
    }
  };

  // ---- Bot: Kartenbewertung ----
  function dmgTo(p, raw) { return Math.max(0, raw - p.shield); }
  function value(s, seat, i) {
    const c = s.grid[i], me = s.pl[seat], op = s.pl[1 - seat];
    const monsters = s.grid.filter(x => x && x.k === 'monster').length;
    switch (c.k) {
      case 'monster': { const d = dmgTo(me, Math.max(0, c.v - me.weapon)); if (d >= me.hp) return -1000 + c.v; return c.v * 1.0 - d * 2.1 - (me.weapon > 0 ? 0.6 : 0) - (me.hp - d < 4 ? 4 : 0); }
      case 'weapon': return (c.v - me.weapon) * 2.2 + (monsters ? 1 : 0);
      case 'shield': return (c.v - me.shield) * 1.8 + (monsters ? 0.5 : 0);
      case 'potion': { const h = Math.min(c.v, me.max - me.hp); return h * 2.1 - (c.v - h) * 0.4 - (h === 0 ? 3 : 0); }
      case 'gold': return c.v * 1.3;
      case 'dagger': { if (!op) return 0; const d = dmgTo(op, c.v); return d * 2.3 + (d >= op.hp ? 1000 : 0); }
      case 'bait': {
        if (!op) return 0; const m = strongest(s.grid.map((x, j) => j === i ? null : x)); if (m < 0) return -2;
        const d = dmgTo(op, Math.max(0, m - op.weapon)); return d * 1.9 - m * 0.4 + (d >= op.hp ? 900 : 0);
      }
    }
    return 0;
  }
  function bestValue(s, seat) { return Math.max(-1e9, ...legal(s, seat).map(i => value(s, seat, i))); }
  const bot = {
    delay: (s, level) => 750 + Math.random() * 500 - level * 80,
    think(s, seat, level) {
      const opts = legal(s, seat); if (!opts.length) return null;
      let scored = opts.map(i => ({ i, v: value(s, seat, i) }));
      if (level === 3 && s.duo) scored = scored.map(o => { const n = resolve(s, seat, o.i); n.turn = 1 - seat; return { i: o.i, v: o.v - 0.6 * Math.max(0, bestValue(n, 1 - seat)) + (n.pl[1 - seat].hp <= 0 ? 2000 : 0) }; });
      scored.sort((a, b) => b.v - a.v);
      let pick = scored[0];
      if (level === 1) { const top = scored.filter(o => o.v > -500).slice(0, 3); if (top.length) pick = top[Math.floor(Math.random() * top.length)]; }
      return { type: 'take', arg: { i: pick.i } };
    }
  };

  // ---- View ----
  const ICON = {
    monster: '<path d="M12 4c-4 0-7 3-7 7v6l2-1 2 2 3-2 3 2 2-2 2 1v-6c0-4-3-7-7-7z"/><circle cx="9.5" cy="10.5" r="1.4" fill="var(--c-ink)"/><circle cx="14.5" cy="10.5" r="1.4" fill="var(--c-ink)"/>',
    weapon: '<path d="M19 3l2 2-10 10-2-2zM8 14l2 2-4 4-2-2zM6 12l6 6"/>',
    shield: '<path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/>',
    potion: '<path d="M9 3h6v3l3 5v7a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3v-7l3-5z"/><path d="M7 13h10" stroke="var(--c-ink)" stroke-width="1.5"/>',
    gold: '<circle cx="12" cy="12" r="8"/><path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4" stroke="var(--c-ink)" stroke-width="1.6" fill="none"/>',
    dagger: '<path d="M12 2l2 9h-4zM8 11h8v2H8zM11 13h2v6l-1 2-1-2z"/>',
    bait: '<path d="M12 3a3 3 0 0 1 3 3v6a5 5 0 0 1-10 0h3a2 2 0 0 0 4 0V6"/><circle cx="12" cy="4" r="1.5"/>'
  };
  const NAME = { monster: 'Monster', weapon: 'Waffe', shield: 'Schild', potion: 'Heiltrank', gold: 'Gold', dagger: 'Wurfdolch', bait: 'Köder' };
  const DESC = { monster: v => `Schaden ${v}, Kopfgeld ${v}`, weapon: v => `zieht ${v} vom Monster-Schaden ab`, shield: v => `fängt ${v} Schaden ab`, potion: v => `heilt ${v}`, gold: v => `${v} Gold`, dagger: v => `${v} Schaden beim Gegner`, bait: () => 'Gegner muss das stärkste Monster nehmen' };
  let el, seen = { moves: -1 };
  const bar = (p, i, ctx, on) => `<div class="dg-pl ${on ? 'on' : ''} p${i}"><div class="dg-nm">${LZArcade.esc(ctx.names[i])}${p.forced ? ' <span class="dg-forced">muss ein Monster nehmen</span>' : ''}</div>
    <div class="dg-hp" role="meter" aria-label="Lebenspunkte" aria-valuemin="0" aria-valuemax="${p.max}" aria-valuenow="${p.hp}"><i style="width:${p.hp / p.max * 100}%"></i><span>${p.hp}/${p.max} HP</span></div>
    <div class="dg-gear"><span title="Waffe">⚔ ${p.weapon}</span><span title="Schild">🛡 ${p.shield}</span><span title="Gold">◉ ${p.gold}</span></div></div>`;
  const view = {
    mount(root, ctx) {
      el = root; seen = { moves: -1 };
      root.innerHTML = '<div class="dg-wrap"><div class="dg-bars" id="dgBars"></div><div class="dg-grid" id="dgGrid" role="grid" aria-label="Auslage, 3 mal 3 Karten"></div><div class="dg-foot"><span class="hint" id="dgDeck"></span><span class="hint" id="dgLog" aria-live="off"></span></div></div>';
      root.querySelector('#dgGrid').addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b && !b.disabled) ctx.act('take', { i: +b.dataset.i }); });
    },
    render(s, ctx) {
      const t = logic.turn(s);
      el.querySelector('#dgBars').innerHTML = s.pl.map((p, i) => bar(p, i, ctx, s.duo && t === i)).join('');
      const can = t >= 0 && ctx.canAct(t), ok = can ? legal(s, t) : [];
      const me = s.pl[t >= 0 ? t : 0];
      const gridEl = el.querySelector('#dgGrid'), keep = window.LZCozy ? LZCozy.saveFocus(gridEl) : null;
      gridEl.innerHTML = s.grid.map((c, i) => {
        if (!c) return '<div class="dg-card empty" aria-hidden="true"></div>';
        let preview = '';
        if (c.k === 'monster' && me) { const d = Math.max(0, Math.max(0, c.v - me.weapon) - me.shield); preview = `<span class="dg-prev ${d >= me.hp ? 'lethal' : ''}">−${d} HP</span>`; }
        const isNew = seen.moves !== s.moves && i === s.lastI;
        return `<button class="dg-card k-${c.k}${isNew ? ' new' : ''}" type="button" data-i="${i}" ${ok.includes(i) ? '' : 'disabled'} aria-label="${NAME[c.k]} ${c.v}: ${DESC[c.k](c.v)}">
          <span class="dg-v">${c.k === 'bait' ? '!' : c.v}</span><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[c.k]}</svg><span class="dg-k">${NAME[c.k]}</span>${preview}</button>`;
      }).join('');
      if (keep) keep('.dg-card:not([disabled])');
      el.querySelector('#dgDeck').textContent = `Stapel: ${s.deck.length} Karten`;
      if (s.moves !== seen.moves) {
        if (seen.moves >= 0 && s.last) {
          const L = s.last, who = ctx.names[L.seat], c = L.card;
          let msg = `${who}: ${NAME[c.k]} ${c.k === 'bait' ? '' : c.v}`;
          if (c.k === 'monster') msg += ` – ${L.dmg} Schaden${L.gold ? `, +${L.gold} Gold` : ''}`;
          if (c.k === 'potion') msg += ` – +${L.heal} HP`;
          if (c.k === 'dagger') msg += ` – ${L.dmg} Schaden beim Gegner`;
          if (c.k === 'bait' && L.bait) msg += ' – der Gegner muss ein Monster nehmen!';
          el.querySelector('#dgLog').textContent = msg; ctx.say(msg);
          ctx.sound(c.k === 'monster' ? (L.dmg ? 'buzz' : 'correct') : c.k === 'potion' ? 'magic' : c.k === 'gold' ? 'pop' : c.k === 'dagger' ? 'wrong' : 'click');
        }
        seen.moves = s.moves;
      }
    }
  };

  const def = {
    id: 'dung', title: 'Karten-Dungeon', sub: 'Roguelite mit Karten',
    modes: {
      solo: { desc: 'Überlebe den ganzen Dungeon-Stapel. Teile dir Lebenspunkte, Waffen und Tränke klug ein.' },
      bot: { desc: 'Der Bot wägt Schaden, Gold und Ausrüstung ab. Schwer denkt auch an deinen nächsten Zug.' },
      online: { desc: 'Jede Person am eigenen Gerät, gemeinsame Auslage.' }
    },
    rules: ['Nimm eine Karte aus der 3×3-Auslage – die Lücke wird sofort aus dem Stapel gefüllt.', 'Monster schaden dir (Waffe zieht ab, Schild fängt auf), geben aber Kopfgeld. Tränke heilen, Gold zählt.', 'Im Duell: Wurfdolche treffen den Gegner, Köder zwingen ihn, das stärkste Monster zu nehmen. Wer als Zweites zieht, startet mit 16 statt 13 HP. 0 HP = verloren, sonst gewinnt mehr Gold.'],
    keys: '<b>Tastatur:</b> <kbd class="lz-kbd">Pfeile</kbd> wandern über die Karten · <kbd class="lz-kbd">Enter</kbd> nimmt sie',
    logic, bot, view,
    points: (s, i) => s.pl[i].gold,
    scores(s, ctx) {
      return s.pl.map((p, i) => ({ name: ctx.names[i], vb: ctx.vb && ctx.vb[i], value: p.gold, sub: `Gold · ${p.hp} HP`, on: s.duo && logic.turn(s) === i }));
    },
    status(s, ctx) {
      if (logic.done(s)) return 'Vorbei!';
      if (!s.duo) return `Noch <em>${s.grid.filter(Boolean).length + s.deck.length}</em> Karten im Dungeon`;
      const t = s.turn, nm = ctx.esc(ctx.names[t]);
      if (ctx.isBot(t)) return `<span class="dots">${nm} überlegt</span>`;
      return (ctx.canAct(t) && ctx.mode !== 'local' ? 'Du bist dran' : `<em>${nm}</em> ist dran`) + (s.pl[t].forced ? ' – <em>Köder: das stärkste Monster!</em>' : '');
    }
  };
  if (root.LZArcade) { root.LZArcade.define(def); if (root.LZCozy && LZCozy.arrowGroups) LZCozy.arrowGroups.push('.dg-grid'); }
  root.DUNGEON = { logic, bot, legal, value };
})(typeof window !== 'undefined' ? window : globalThis);
