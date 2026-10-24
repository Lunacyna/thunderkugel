/* ==========================================================================
   Letzte Karte! (intern: sternenfall) – Kartenspiel für 2–6 (Browser-Teil)
   Regeln, Bots und Spieleransicht stecken in sternenfall-core.js (SFCore) –
   dieselbe Datei läuft auch im Cloudflare Worker.
   Zwei Modi:
     Gegen Bots  – alles läuft im Browser (SFCore + setTimeout-Bots)
     Online      – ein Spieltisch-Server (Durable Object "SFTable") mischt, verteilt und
                   prüft jeden Zug. Der Browser bekommt nur seine eigene Hand zu sehen.
   Beide Modi liefern dasselbe Modell M an render(); jede Eingabe geht über send(type, arg).
   ========================================================================== */
(function () {
  'use strict';
  const SF = window.SFCore;
  const $ = id => document.getElementById(id);
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const say = (t, assertive) => { if (window.LZCozy) LZCozy.announce(t, { assertive: !!assertive }); };
  const snd = n => { if (window.LZSound) LZSound.play(n); };
  const LEVELS = [[1, 'Leicht'], [2, 'Mittel'], [3, 'Schwer']];
  const LVL = { 1: 'Leicht', 2: 'Mittel', 3: 'Schwer' };
  const COLORS = SF.COLORS;
  const BOT_NAMES = ['Mondkatze', 'Kometa', 'Sternchen', 'Nebula', 'Orbit'];

  // ---- Symbole -------------------------------------------------------------------------
  const ICON = [
    '<path d="M15.5 2.5a9.5 9.5 0 1 0 6 16.6A8 8 0 0 1 15.5 2.5z"/>',                                                    // Mond
    '<path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 20.9l1.6-7L2 9.2l7.1-.6z"/>',                                  // Stern
    '<path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.2 3 4.5 6.6 4.5c2.1 0 3.6 1.2 5.4 3.2 1.8-2 3.3-3.2 5.4-3.2 3.6 0 5.7 3.7 4.2 7.2C19.5 16.4 12 21 12 21z"/>', // Herz
    '<ellipse cx="12" cy="16.2" rx="5.2" ry="4.3"/><ellipse cx="5.2" cy="10.2" rx="2.2" ry="2.8"/><ellipse cx="9.4" cy="5.8" rx="2.2" ry="2.9"/><ellipse cx="14.6" cy="5.8" rx="2.2" ry="2.9"/><ellipse cx="18.8" cy="10.2" rx="2.2" ry="2.8"/>', // Pfote
    '<path d="M14.5 3l1.9 4.3 4.6.4-3.5 3 1.1 4.6-4.1-2.4-4 2.4 1-4.6-3.5-3 4.7-.4z"/><path d="M8.6 12.6 2.5 19M10.6 15.6 6 21.5M6.4 10.4 1.5 14" stroke-width="1.8" stroke-linecap="round" fill="none" stroke="currentColor"/>', // Sternschnuppe
  ];
  const icon = (c, cls) => `<svg class="${cls || 'ic'}" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${ICON[c]}</svg>`;
  const glyph = v => v <= 9 ? String(v) : { 10: '⊘', 11: '⇄', 12: '+2', 13: '', 14: '+4' }[v];
  const cardName = c => SF.cardName(c);
  function cardHtml(c, extra) {
    const g = glyph(c.v), wild = c.c === 4;
    const mid = wild ? (c.v === 14 ? `<b class="gl">+4</b>${icon(4, 'ic big')}` : icon(4, 'ic huge')) : `<b class="gl">${esc(g)}</b>`;
    return `<span class="sf-card c${c.c}${c.v > 9 ? ' act' : ''}${extra || ''}" aria-hidden="true"><i class="tl">${wild ? '' : esc(g)}${icon(c.c, 'ic sm')}</i><span class="mid">${mid}</span><i class="br">${icon(c.c, 'ic sm')}</i></span>`;
  }
  const backHtml = (cls) => `<span class="sf-card back${cls || ''}" aria-hidden="true">${icon(1, 'ic big')}</span>`;
  const colorChip = c => `<span class="sf-col c${c}">${icon(c, 'ic sm')}${esc(COLORS[c])}</span>`;

  // ---- Zustand --------------------------------------------------------------------------
  const V = { view: 'menu', mode: null, level: 2, opp: 2, stack: true, until: false };
  let M = null;                                   // aktuelles Modell für render()
  const L = { g: null, seats: [], wins: [], timers: [], gid: '', start: 0 };   // lokales Spiel gegen Bots
  const NET = { ws: null, code: '', retry: 0, leaving: false, offset: 0, room: null, lobbyUnsub: null, ping: null, lost: false };
  let lastKey = '', picked = null, timerRAF = 0, lastTurnMine = false;
  try { const p = JSON.parse(localStorage.getItem('lz_sf') || '{}'); if (p.level) V.level = p.level; if (p.opp) V.opp = p.opp; if (p.stack != null) V.stack = p.stack; if (p.until != null) V.until = p.until; } catch (e) {}
  const savePref = () => { try { localStorage.setItem('lz_sf', JSON.stringify({ level: V.level, opp: V.opp, stack: V.stack, until: V.until })); } catch (e) {} };
  const myName = () => (window.kbName && kbName.get()) || 'Du';

  // ---- Eingaben ----------------------------------------------------------------------------
  function send(type, arg) {
    if (V.mode === 'bot') { const g2 = SF.act(L.g, 0, type, arg, Date.now()); if (!g2) return false; L.g = g2; localAfter(); return true; }
    if (V.mode === 'online' && NET.ws && NET.ws.readyState === 1) { NET.ws.send(JSON.stringify({ t: 'act', type, arg })); return true; }
    return false;
  }
  function hostCmd(a, extra) {
    if (V.mode === 'online' && NET.ws && NET.ws.readyState === 1) NET.ws.send(JSON.stringify({ t: 'host', a, ...(extra || {}) }));
  }

  // ---- Lokales Spiel gegen Bots -------------------------------------------------------------
  function startLocal() {
    clearLocal();
    const n = 1 + V.opp;
    L.seats = [{ name: myName(), bot: 0, v: false, on: true, host: true }];
    for (let i = 0; i < V.opp; i++) L.seats.push({ name: BOT_NAMES[i], bot: V.level, v: false, on: true, host: false });
    if (L.wins.length !== n || V.mode !== 'bot') L.wins = new Array(n).fill(0);
    L.g = SF.newGame(n, { stack: V.stack, until: V.until });
    L.gid = window.LZCozy && LZCozy.stats ? LZCozy.stats.newId() : Math.random().toString(36).slice(2, 14);
    L.start = Date.now(); L.res = null;
    V.mode = 'bot'; V.view = 'table'; lastKey = '';
    localAfter();
  }
  function clearLocal() { L.timers.forEach(clearTimeout); L.timers = []; }
  function localAfter() {
    clearLocal();
    const g = L.g, now = Date.now();
    if (g.winner >= 0 && !L.res) {
      const left = g.hands.map(h => h.length);
      L.res = { winner: g.winner, left, pts: left.reduce((a, b) => a + b, 0) };
      L.wins[g.winner]++;
      if (window.LZCozy && LZCozy.stats) LZCozy.stats.round({ game: 'sf', id: L.gid + ':1', start: L.start });
    }
    if (g.winner < 0) {
      const who = L.seats[g.turn];
      if (who.bot) L.timers.push(setTimeout(() => {
        const mv = SF.botMove(L.g, L.g.turn, who.bot);
        L.g = SF.act(L.g, L.g.turn, mv.type, mv.arg, Date.now()) || SF.act(L.g, L.g.turn, L.g.drawn != null ? 'pass' : 'draw', null, Date.now()) || L.g;
        localAfter();
      }, g.drawn != null ? 650 : 900 + Math.random() * 700));
      if (g.catchWin) {
        L.timers.push(setTimeout(() => { const t = SF.tick(L.g, Date.now()); if (t) { L.g = t; localAfter(); } }, Math.max(0, g.catchWin.until + 450 - now)));
        L.seats.forEach((x, i) => {
          if (!x.bot || i === g.catchWin.seat) return;
          const c = SF.botCatch(g, i, x.bot); if (!c) return;
          L.timers.push(setTimeout(() => { const g2 = SF.act(L.g, i, 'catch', null, Date.now()); if (g2) { L.g = g2; localAfter(); } }, c.delay));
        });
      }
    }
    M = { mode: 'bot', phase: g.winner >= 0 ? 'end' : 'play', me: 0, isHost: true, seats: L.seats.map((x, i) => ({ ...x, wins: L.wins[i] })),
          opts: { stack: V.stack, until: V.until }, view: SF.viewFor(g, 0), res: L.res, deadline: 0 };
    render();
  }

  // ---- Online ------------------------------------------------------------------------------
  const peerId = Math.random().toString(36).slice(2, 12).padEnd(10, '0');
  function uid() { let u = null; try { u = localStorage.getItem('kb_uid'); } catch (e) {} if (!u || !/^u_[a-z0-9]{10}$/.test(u)) { u = 'u_' + Math.random().toString(36).slice(2, 12).padEnd(10, '0'); try { localStorage.setItem('kb_uid', u); } catch (e) {} } return u; }
  async function lobbyInit() {
    if (!window.claude || !window.KB_SERVER) return null;
    try { NET.room = await window.claude.use('room'); } catch (e) { NET.room = null; }
    return NET.room;
  }
  function openTables() {
    if (!NET.room) return [];
    return NET.room.peers().filter(p => !p.isMe && p.presence && p.presence.host && p.presence.host.game === 'sf' && /^sf-[a-z0-9]{4}$/.test(p.presence.host.code || ''));
  }
  function connect(code) {
    if (NET.code !== code) { NET.opened = false; NET.fails = 0; }
    NET.code = code; NET.leaving = false; NET.lost = false;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/sf?t=${code}&peer=${peerId}&by=${uid()}&n=${encodeURIComponent(myName())}`);
    NET.ws = ws;
    ws.onopen = () => { NET.retry = 0; NET.opened = true; NET.fails = 0; if (NET.lost) { NET.lost = false; toast('Wieder verbunden'); } };
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch (_) { return; }
      if (m.t === 'st') { NET.offset = m.now - Date.now(); M = { ...m, mode: 'online' }; V.view = 'table'; render(); hostPresence(); }
      else if (m.t === 'nope') { snd('wrong'); toast('Das geht gerade nicht.'); }
    };
    ws.onclose = () => {
      if (NET.ws !== ws || NET.leaving) return;
      if (!NET.opened && ++NET.fails >= 3 && V.view === 'connecting') return diagnose(code);
      if (!NET.lost) { NET.lost = true; toast('Verbindung weg – verbinde neu …'); }
      NET.retry = Math.min(NET.retry + 1, 6); setTimeout(() => { if (!NET.leaving && NET.code === code) connect(code); }, 500 * NET.retry);
    };
    clearInterval(NET.ping); NET.ping = setInterval(() => { if (NET.ws && NET.ws.readyState === 1) NET.ws.send('{"t":"ping"}'); }, 25000);
  }
  // Kommt gar keine Verbindung zustande: nachsehen, woran es liegt, statt ewig "Verbinde …" zu zeigen
  async function diagnose(code) {
    let st = null; try { const r = await fetch('/api/sf/status', { cache: 'no-store' }); st = r.ok ? await r.json() : { old: true }; } catch (e) {}
    NET.leaving = true; clearInterval(NET.ping);
    const m = $('main'); if (!m || V.view !== 'connecting') return;
    const why = !st ? 'Der Server antwortet gerade nicht. Prüf deine Internetverbindung.'
      : st.old || st.tables === false ? 'Die Online-Tische sind auf dem Server noch nicht eingerichtet. (Für die Seitenbetreiberin: <code>wrangler.jsonc</code> aus der Zip mit hochladen – darin steht der Spieltisch-Server „TABLES“.)'
      : 'Der Spieltisch antwortet gerade nicht. Versuch es gleich noch einmal.';
    m.innerHTML = `<div class="panel sheet"><h2>Keine Verbindung</h2><p>${why}</p><p class="hint">Gegen Bots kannst du trotzdem spielen.</p><div class="row"><button class="btn" type="button" data-sf="retry" data-code="${esc(code)}">Nochmal versuchen</button><button class="btn ghost" type="button" data-sf="menu">Zurück</button></div></div>`;
    say(window.LZCozy ? LZCozy.text(why) : why, true);
  }
  function leaveOnline() {
    NET.leaving = true; clearInterval(NET.ping);
    try { NET.ws && NET.ws.close(); } catch (e) {}
    NET.ws = null; NET.code = '';
    if (NET.room) NET.room.presence({ host: null }).catch(() => {});
  }
  let lastPres = '';
  function hostPresence() {
    if (!NET.room || !M) return;
    const pr = M.isHost && M.phase !== 'end' ? { code: M.code, game: 'sf', ph: M.phase === 'wait' ? 'wait' : 'play', n: M.seats.length } : null;
    const k = JSON.stringify(pr); if (k === lastPres) return; lastPres = k;
    NET.room.presence({ host: pr }).catch(() => {});
  }
  const newCode = () => 'sf-' + Math.random().toString(36).slice(2, 6).padEnd(4, '0');

  // ---- Darstellung -----------------------------------------------------------------------------
  function toast(msg) { const t = $('arToast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1800); say(msg); }
  const nameOf = i => !M || !M.seats[i] ? 'Jemand' : i === M.me ? 'Du' : M.seats[i].name;
  function describe(v) {
    const l = v.last || {}, n = nameOf(l.seat), mine = l.seat === M.me;
    switch (l.k) {
      case 'start': return `Los geht's! Erste Karte: ${cardName(l.card)}.`;
      case 'play': return `${n} ${mine ? 'spielst' : 'spielt'} ${cardName(l.card)}${l.card.c === 4 ? ` und ${mine ? 'wählst' : 'wählt'} ${COLORS[l.color]}` : ''}.${l.card.v === SF.REV ? ` Jetzt geht es ${v.dir === 1 ? 'im' : 'gegen den'} Uhrzeigersinn weiter.` : ''}`;
      case 'draw': return mine && l.playable && v.drawn != null ? `Du hast ${l.n > 1 ? l.n + ' Karten gezogen, zuletzt ' : ''}${cardName(v.hand.find(c => c.id === v.drawn) || { c: 4, v: 13 })}${l.n > 1 ? '' : ' gezogen'} – ausspielen oder behalten?` : `${n} ${mine ? 'ziehst' : 'zieht'} ${l.n > 1 ? l.n + ' Karten' : 'eine Karte'}${l.timeout ? ' (Zeit abgelaufen)' : ''}.`;
      case 'penalty': return `${n} ${mine ? 'ziehst' : 'zieht'} ${l.n} Karten${l.timeout ? ' (Zeit abgelaufen)' : ''}.`;
      case 'pass': return `${n} ${mine ? 'behältst' : 'behält'} die Karte${l.timeout ? ' (Zeit abgelaufen)' : ''}.`;
      case 'call': return `${n}: „Letzte Karte!“`;
      case 'caught': return `${n} ${mine ? 'erwischst' : 'erwischt'} ${l.target === M.me ? 'dich' : nameOf(l.target)}! ${l.target === M.me ? 'Du ziehst' : nameOf(l.target) + ' zieht'} 2 Karten.`;
      default: return '';
    }
  }
  const log = [];
  function eventSound(v) {
    const l = v.last || {};
    if (l.k === 'play') snd(l.card.c === 4 ? 'powerup' : l.card.v > 9 ? 'magic' : 'klack');
    else if (l.k === 'draw' || l.k === 'pass') snd('blip');
    else if (l.k === 'penalty') snd('powerdown');
    else if (l.k === 'call') snd('coin');
    else if (l.k === 'caught') snd('buzz');
  }

  function render() {
    renderMain(); renderSide();             // Seitenleiste danach: der Verlauf kennt dann schon den neuesten Zug
  }
  function renderMain() {
    const m = $('main'); if (!m) return;
    if (V.view === 'menu') return renderMenu(m);
    if (V.view === 'lobby') return renderLobby(m);
    if (V.view === 'connecting') { m.innerHTML = `<div class="panel sheet"><h2>Verbinde …</h2><p><span class="dots">Einen Moment</span></p><div class="row"><button class="btn ghost" type="button" data-sf="menu">Abbrechen</button></div></div>`; return; }
    if (!M) return;
    if (M.phase === 'wait') return renderWait(m);
    renderTable(m);
  }

  function seg(key, cur, values) { return `<div class="seg" data-seg="${key}">${values.map(([v, l]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${String(cur) === String(v)}">${esc(l)}</button>`).join('')}</div>`; }
  function renderMenu(m) {
    const net = !!NET.room;
    m.innerHTML = `<div class="panel sheet"><h2>Wie willst du spielen?</h2><div class="choices">
      <div class="choice" style="cursor:default"><b>Gegen Bots</b><span>Du und 1–3 Bots. Leg deine Karten schneller ab als sie.</span>
        <div class="sf-opts"><div class="field"><span class="label">Gegner</span>${seg('opp', V.opp, [[1, '1 Bot'], [2, '2 Bots'], [3, '3 Bots']])}</div>
        <div class="field"><span class="label">Stärke</span>${seg('level', V.level, LEVELS)}</div></div>
        <div class="row" style="margin-top:10px"><button class="btn" type="button" data-sf="bot">Austeilen</button></div></div>
      <button class="choice" type="button" data-sf="online" ${net ? '' : 'disabled'}><b>Online · 2 bis 6</b><span>${net ? 'Eröffne einen Tisch oder setz dich dazu. Freie Plätze füllt die Spielleitung mit Bots. Die Karten verteilt der Server – keiner kann in fremde Hände schauen.' : 'Kein Spielserver gefunden. Online geht nur, wenn die Seite als Cloudflare Worker läuft.'}</span></button>
    </div>
    <div class="field"><span class="label">+2 und +4 stapeln · gegen Bots</span>${seg('stack', V.stack ? 1 : 0, [[1, 'Erlaubt'], [0, 'Aus']])}</div>
    <div class="field"><span class="label">Ziehen, bis eine Karte passt · gegen Bots</span>${seg('until', V.until ? 1 : 0, [[1, 'An'], [0, 'Aus (eine Karte)']])}</div></div>`;
  }
  function renderLobby(m) {
    const list = openTables();
    const verified = window.kbName && kbName.verified();
    m.innerHTML = `<div class="panel sheet"><div class="label">Online</div><h2>Tisch finden</h2>
      <div class="field"><span class="label">Dein Name</span><div class="row" style="flex-wrap:nowrap"><input class="txt" id="sfName" value="${esc(myName())}" maxlength="24" autocomplete="off" ${verified ? 'disabled' : ''}><button class="btn small ghost" type="button" data-sf="savename">Speichern</button></div></div>
      <div class="games" id="sfTables">${tablesHtml(list)}</div>
      <div class="row"><button class="btn" type="button" data-sf="create">Neuen Tisch eröffnen</button><button class="btn ghost" type="button" data-sf="menu">Zurück</button></div></div>`;
  }
  function tablesHtml(list) {
    return list.length ? list.map(p => { const h = p.presence.host, open = h.ph === 'wait'; return `<div class="game"><div style="min-width:0"><div class="t">Tisch von ${esc(p.presence.nm || 'jemandem')}</div><div class="s">${open ? `wartet · ${h.n | 0}/6 Plätze` : 'läuft gerade'}</div></div><button class="btn small ${open ? '' : 'ghost'}" type="button" data-sf="join" data-code="${esc(h.code)}">${open ? 'Hinsetzen' : 'Zuschauen'}</button></div>`; }).join('')
      : '<div class="empty">Gerade wartet kein Tisch. Eröffne einen – wer „Online“ wählt oder auf der Startseite vorbeischaut, sieht ihn.</div>';
  }
  function seatBadges(x, i) {
    const b = [];
    if (i === M.me) b.push('<span class="tag me">Du</span>');
    if (x.host) b.push('<span class="tag">Spielleitung</span>');
    if (x.bot) b.push(`<span class="tag bot">Bot · ${LVL[x.bot]}</span>`);
    if (!x.on) b.push('<span class="tag off">weg</span>');
    return b.join('');
  }
  function renderWait(m) {
    const host = M.isHost, n = M.seats.length;
    const link = location.origin + '/letztekarte/?join=' + M.code;
    m.innerHTML = `<div class="panel sheet"><div class="label">Online · Tisch ${esc(M.code.slice(3).toUpperCase())}</div><h2>${host ? 'Dein Tisch' : 'Am Tisch'}</h2>
      <ul class="sf-seats" aria-label="Plätze">${M.seats.map((x, i) => `<li><span class="nm">${esc(x.name)}${x.v ? ' <span class="vb" title="Mit Twitch bestätigt">✓</span>' : ''}</span>${seatBadges(x, i)}
        ${host && x.bot ? `<span class="sf-seatctl">${seg('lvl:' + i, x.bot, LEVELS)}<button class="btn small ghost" type="button" data-sf="rm" data-i="${i}" aria-label="${esc(x.name)} entfernen">✕</button></span>` : ''}
        ${host && !x.bot && !x.on && !x.host ? `<button class="btn small ghost" type="button" data-sf="rm" data-i="${i}">Platz freigeben</button>` : ''}</li>`).join('')}
        ${new Array(Math.max(0, 6 - n)).fill('<li class="free">freier Platz</li>').join('')}</ul>
      ${host ? `<div class="row"><button class="btn ghost" type="button" data-sf="addbot" ${n >= 6 ? 'disabled' : ''}>+ Bot hinzufügen</button>${seg('botlvl', V.level, LEVELS)}</div>
        <div class="field"><span class="label">+2 und +4 stapeln</span>${seg('tstack', M.opts.stack ? 1 : 0, [[1, 'Erlaubt'], [0, 'Aus']])}</div>
        <div class="field"><span class="label">Ziehen, bis eine Karte passt</span>${seg('tuntil', M.opts.until ? 1 : 0, [[1, 'An'], [0, 'Aus (eine Karte)']])}</div>` : `<p class="hint">+2/+4 stapeln: ${M.opts.stack ? 'erlaubt' : 'aus'} · Ziehen bis es passt: ${M.opts.until ? 'an' : 'aus'}</p>`}
      <div class="field"><span class="label">Freunde einladen</span><div class="row" style="flex-wrap:nowrap"><input class="txt sf-link" id="sfLink" value="${esc(link)}" readonly aria-label="Einladungslink"><button class="btn small ghost" type="button" data-sf="copy">Kopieren</button></div></div>
      <div class="row">${host ? `<button class="btn big" type="button" data-sf="start" ${n < 2 ? 'disabled' : ''}>Austeilen</button>` : '<p class="hint"><span class="dots">Warte auf die Spielleitung</span></p>'}<button class="btn ghost" type="button" data-sf="menu">Verlassen</button></div>
      ${host && n < 2 ? '<p class="hint">Es braucht mindestens zwei Plätze – lade jemanden ein oder setz einen Bot dazu.</p>' : ''}</div>`;
  }

  function renderTable(m) {
    const v = M.view; if (!v) return;
    const me = M.me, myTurn = v.turn === me && v.winner < 0, over = M.phase === 'end';
    // Neues Ereignis ansagen
    const key = v.moves + '|' + JSON.stringify(v.last) + '|' + (v.catchWin ? v.catchWin.seat : '');
    if (key !== lastKey) {
      const txt = describe(v);
      if (lastKey && txt) { eventSound(v); log.unshift(txt); log.length = Math.min(log.length, 6); }
      else if (!lastKey) { log.length = 0; if (txt) log.unshift(txt); }
      lastKey = key;
      let s = txt;
      if (!over && myTurn && !lastTurnMine) { s += ' Du bist dran.'; snd('turn'); }
      if (v.catchWin && v.catchWin.seat !== me && me >= 0) s += ` ${nameOf(v.catchWin.seat)} hat nur noch eine Karte und nichts gesagt – Erwischt drücken!`;
      if (v.catchWin && v.catchWin.seat === me) s += ' Schnell: Letzte Karte sagen!';
      if (s && !over) say(s, v.catchWin != null);
    }
    lastTurnMine = myTurn;

    // Sitzordnung wie an einem echten Tisch: du unten, die anderen im Uhrzeigersinn links → oben → rechts
    const n = M.seats.length, base = me >= 0 ? me : 0;
    const opp = []; for (let k = 1; k < n; k++) opp.push((base + k) % n);
    const POS = { 1: ['top'], 2: ['left', 'right'], 3: ['left', 'top', 'right'], 4: ['left', 'top', 'top', 'right'], 5: ['left', 'top', 'top', 'top', 'right'] }[opp.length] || [];
    const at = pos => opp.filter((_, k) => POS[k] === pos);
    const hand = v.hand.slice().sort((a, b) => a.c - b.c || a.v - b.v);
    const legal = new Set(v.legal);
    const canCatch = v.catchWin && v.catchWin.seat !== me && me >= 0;
    const canCall = me >= 0 && !over && ((v.catchWin && v.catchWin.seat === me) || (myTurn && v.hand.length === 2 && !v.called[me] && v.legal.length > 0));
    const drawLabel = v.pend > 0 ? `${v.pend} ziehen` : M.opts && M.opts.until ? 'Ziehen bis es passt' : 'Ziehen';
    const status = over ? 'Runde vorbei' : myTurn ? (v.pend > 0 ? `<em>Du bist dran</em> – leg ${v.pendV === SF.WILD4 ? '+4' : '+2 oder +4'} drauf oder zieh ${v.pend}` : v.drawn != null ? '<em>Gezogen</em> – ausspielen oder behalten?' : '<em>Du bist dran</em>') : `${esc(nameOf(v.turn))} ist dran`;
    const dirTxt = v.dir === 1 ? 'im Uhrzeigersinn' : 'gegen den Uhrzeigersinn';
    const nextSeat = over ? -1 : SF.next({ n: v.n, dir: v.dir }, v.turn);
    const flipNow = v.last && v.last.k === 'play' && v.last.card.v === SF.REV && v.moves !== renderTable.flipShown;
    if (flipNow) renderTable.flipShown = v.moves;
    const seat = (i, pos) => { const x = M.seats[i], c = v.counts[i], shown = Math.min(c, pos === 'top' ? 9 : 8);
      return `<li class="sf-seat ${pos}${v.turn === i && !over ? ' turn' : ''}${x.on ? '' : ' off'}${c === 1 ? ' one' : ''}${v.catchWin && v.catchWin.seat === i ? ' catchme' : ''}" aria-label="${esc(x.name)}: ${c} ${c === 1 ? 'Karte' : 'Karten'}${v.turn === i ? ', ist dran' : ''}${x.bot ? ', Bot' : ''}${x.on ? '' : ', nicht verbunden'}">
        <span class="sf-backs" aria-hidden="true" style="--n:${shown}">${new Array(shown).fill('<i></i>').join('')}</span>
        <span class="sf-tag" aria-hidden="true"><span class="nm">${esc(x.name)}${x.v ? ' <span class="vb">✓</span>' : ''}</span><span class="cnt">${c}</span></span>
        <span class="st" aria-hidden="true">${i === nextSeat ? '<b class="sf-next">als Nächstes</b> ' : ''}${v.called[i] && c > 0 && c <= 2 ? 'Letzte Karte!' : x.bot ? 'Bot · ' + LVL[x.bot] : x.on ? '' : 'weg'}</span></li>`; };
    const bx = M.seats[base];
    m.innerHTML = `<div class="ar-stage sf-stage">
      <div class="ar-bar"><div class="ar-status" id="sfStatus">${status}</div><div class="row">${M.opts && M.opts.until ? '<span class="sf-rule" title="Hausregel: Ziehen, bis eine Karte passt">Ziehen bis es passt</span>' : ''}</div></div>
      ${M.deadline && !over ? `<div class="ar-timer" id="sfTimer" aria-hidden="true"><i></i></div>` : ''}
      <div class="sf-felt o${opp.length}">
        <ul class="sf-top" aria-label="Mitspielende gegenüber">${at('top').map(i => seat(i, 'top')).join('')}</ul>
        <ul class="sf-side l" aria-label="Links">${at('left').map(i => seat(i, 'left')).join('')}</ul>
        <div class="sf-center">
          <svg class="sf-ring ${v.dir === 1 ? 'cw' : 'ccw'}" viewBox="0 0 200 200" aria-hidden="true"><g style="animation-delay:-${((Date.now() % 14000) / 1000).toFixed(2)}s"><circle cx="100" cy="100" r="88" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="10 12" opacity=".55"/>${[0, 90, 180, 270].map(a => `<path transform="rotate(${a} 100 100)" d="${v.dir === 1 ? 'M92 4 L108 12 L92 20 Z' : 'M108 4 L92 12 L108 20 Z'}" fill="currentColor"/>`).join('')}</g></svg>
          ${flipNow ? '<span class="sf-flip" aria-hidden="true">⇄ Richtungswechsel!</span>' : ''}
          <button class="sf-pile" type="button" data-sf="draw" ${myTurn && v.drawn == null ? '' : 'disabled'} aria-label="${drawLabel}, ${v.deckN} Karten im Stapel">${backHtml()}<span class="pn">${v.deckN}</span></button>
          <div class="sf-disc" aria-label="Oben liegt ${esc(cardName(v.top))}${v.top.c === 4 ? ', gewählte Farbe ' + COLORS[v.color] : ''}" role="img">${cardHtml(v.top, ' top ring' + v.color)}</div>
          <div class="sf-now">${colorChip(v.color)}<span class="sf-dirchip ${v.dir === 1 ? 'cw' : 'ccw'}" title="Spielrichtung">${v.dir === 1 ? '↻ im Uhrzeigersinn' : '↺ gegen den Uhrzeigersinn'}</span>${v.pend > 0 ? `<span class="sf-pend">+${v.pend} aufgestaut</span>` : ''}</div>
        </div>
        <ul class="sf-side r" aria-label="Rechts">${at('right').map(i => seat(i, 'right')).join('')}</ul>
        <div class="sf-bottom">
          <div class="sf-me${v.turn === base && !over ? ' turn' : ''}">${base === nextSeat ? '<b class="sf-next">als Nächstes</b>' : ''}<span class="nm">${esc(me >= 0 ? 'Du' : bx.name)}${me < 0 ? ` · ${v.counts[base]} Karten` : ''}</span>${me >= 0 && v.called[me] && v.hand.length <= 2 ? '<span class="st">Letzte Karte!</span>' : ''}</div>
          <div class="sf-actions">
            <button class="btn" type="button" data-sf="draw" ${myTurn && v.drawn == null ? '' : 'disabled'}>${drawLabel} <kbd>Z</kbd></button>
            ${v.drawn != null && myTurn ? `<button class="btn ghost" type="button" data-sf="pass">Behalten <kbd>B</kbd></button>` : ''}
            <button class="btn sf-call${canCall ? ' hot' : ''}" type="button" data-sf="call" ${canCall ? '' : 'disabled'}>Letzte Karte! <kbd>L</kbd></button>
            ${canCatch ? `<button class="btn sf-catch" type="button" data-sf="catch">Erwischt! <kbd>E</kbd></button>` : ''}
          </div>
          ${me >= 0 ? `<div class="sf-hand" data-lz-arrows role="group" aria-label="Deine Hand: ${hand.length} Karten">${hand.map(c => { const ok = legal.has(c.id) && !over; return `<button type="button" class="sf-hc${ok ? ' ok' : myTurn ? ' dim' : ''}${v.drawn === c.id ? ' new' : ''}" data-card="${c.id}" ${ok ? '' : 'aria-disabled="true"'} aria-label="${esc(cardName(c))}${ok ? ', spielbar' : ''}">${cardHtml(c)}</button>`; }).join('')}</div>`
            : '<p class="hint sf-watch">Du schaust zu. Nach der Runde kann dich die Spielleitung an den Tisch holen.</p>'}
        </div>
      </div>
      <div id="sfOver" ${over ? '' : 'hidden'}>${over ? overHtml(v) : ''}</div>
    </div>`;
    if (over && !renderTable.overShown) {
      renderTable.overShown = true;
      const won = M.res && M.res.winner === me;
      snd(won ? 'fanfare' : 'lose');
      say((won ? 'Gewonnen! ' : nameOf(M.res.winner) + ' gewinnt. ') + 'Die Runde ist vorbei.', true);
      setTimeout(() => { const b = document.querySelector('#sfOver .btn'); if (b) b.focus({ preventScroll: true }); }, 60);
    }
    if (!over) renderTable.overShown = false;
    if (myTurn && document.activeElement === document.body) { const f = document.querySelector('.sf-hc.ok') || document.querySelector('[data-sf="draw"].btn:not([disabled])'); if (f && !matchMedia('(hover:none)').matches) f.focus({ preventScroll: true }); }
    timerLoop();
  }
  function overHtml(v) {
    const r = M.res || { winner: v.winner, left: v.counts, pts: 0 }, me = M.me, won = r.winner === me;
    const rows = M.seats.map((x, i) => ({ x, i, left: r.left[i] })).sort((a, b) => a.left - b.left);
    const btns = M.mode === 'bot' ? `<button class="btn" type="button" data-sf="again">Nochmal</button><button class="btn ghost" type="button" data-sf="menu">Anderer Modus</button>`
      : M.isHost ? `<button class="btn" type="button" data-sf="start">Nochmal</button><button class="btn ghost" type="button" data-sf="lobby">Plätze ändern</button><button class="btn ghost" type="button" data-sf="menu">Verlassen</button>`
      : `<span class="hint">Die Spielleitung kann eine neue Runde starten.</span><button class="btn ghost" type="button" data-sf="menu">Verlassen</button>`;
    return `<div class="ar-over"><div class="panel" role="dialog" aria-labelledby="sfOverT"><h2 id="sfOverT">${won ? 'Gewonnen!' : esc(nameOf(r.winner)) + ' gewinnt!'}</h2>
      <ol class="sf-res">${rows.map(o => `<li class="${o.i === r.winner ? 'win' : ''}"><span>${esc(o.i === me ? 'Du' : o.x.name)}</span><span>${o.i === r.winner ? '★ fertig' : o.left + (o.left === 1 ? ' Karte' : ' Karten')}</span><b title="Siege an diesem Tisch">${o.x.wins || 0}</b></li>`).join('')}</ol>
      <p class="hint">Rechte Zahl: Siege an diesem Tisch${M.mode === 'online' ? ' · Zählt für die Bestenliste, wenn mindestens zwei Menschen mitspielen.' : ''}</p>
      <div class="row">${btns}</div></div></div>`;
  }
  function timerLoop() {
    cancelAnimationFrame(timerRAF);
    const el = $('sfTimer'); if (!el || !M || !M.deadline) return;
    const i = el.querySelector('i');
    const step = () => {
      const left = M.deadline - (Date.now() + NET.offset), f = Math.max(0, Math.min(1, left / M.turnMs));
      i.style.transform = `scaleX(${f})`; el.classList.toggle('hot', left < 10000 && M.view && M.view.turn === M.me);
      if (left > 0 && document.body.contains(el)) timerRAF = requestAnimationFrame(step);
    };
    step();
  }
  function renderSide() {
    const s = $('side'); if (!s) return;
    let html = '';
    if (M && V.view === 'table' && M.view) {
      html += `<div class="panel"><h3>Am Tisch <span>${M.mode === 'bot' ? 'gegen Bots' : 'Online · ' + esc(M.code.slice(3).toUpperCase())}</span></h3><div class="ar-score">${M.seats.map((x, i) =>
        `<div class="ar-pl ${M.view.turn === i && M.phase === 'play' ? 'on' : ''}"><i aria-hidden="true" style="background:var(--sf-c${i % 4})"></i><span class="nm">${esc(i === M.me ? x.name + ' (du)' : x.name)}${x.v ? ' <span class="vb" title="Mit Twitch bestätigt">✓</span>' : ''}<span class="sub">${M.view.counts[i]} ${M.view.counts[i] === 1 ? 'Karte' : 'Karten'}${x.bot ? ' · Bot ' + LVL[x.bot] : ''}${x.on ? '' : ' · weg'}</span></span><b title="Siege">${x.wins || 0}</b></div>`).join('')}</div></div>`;
      html += `<div class="panel"><h3>Verlauf</h3><ol class="sf-log">${log.map(t => `<li>${esc(t)}</li>`).join('') || '<li>–</li>'}</ol></div>`;
    }
    html += `<div class="panel"><h3>So geht's</h3><ol class="rules">
      <li><span>Leg eine Karte mit <b>gleicher Farbe</b> (Mond, Stern, Herz, Pfote) oder <b>gleichem Wert</b> ab. Wer zuerst keine Karten mehr hat, gewinnt.</span></li>
      <li><span>Kannst oder willst du nicht, ziehst du eine Karte. Passt sie, darfst du sie sofort spielen – oder behalten. Mit der Regel <b>„Ziehen, bis eine Karte passt“</b> ziehst du so lange weiter, bis eine passt.</span></li>
      <li><span><b>⊘</b> setzt den Nächsten aus, <b>⇄</b> dreht die Richtung, <b>+2</b> lässt ihn zwei ziehen.</span></li>
      <li><span><b>Sternschnuppe</b> geht immer und du wählst die Farbe; mit <b>+4</b> zieht der Nächste vier. +2 und +4 dürfen gestapelt werden (abschaltbar).</span></li>
      <li><span>Bei der vorletzten Karte <b>„Letzte Karte!“</b> drücken. Wer es vergisst und erwischt wird, zieht 2.</span></li>
    </ol><p class="kbdhint">Tasten: Pfeile wählen Karten · Enter spielt · Z ziehen · B behalten · L Letzte Karte · E Erwischt</p></div>`;
    s.innerHTML = html;
  }

  // ---- Karte spielen (mit Farbwahl bei Sternschnuppen) ------------------------------------
  function playCard(id) {
    const v = M && M.view; if (!v) return;
    if (!v.legal.includes(id)) { snd('wrong'); toast(v.turn !== M.me ? 'Du bist gerade nicht dran.' : v.pend > 0 ? `Leg ${v.pendV === SF.WILD4 ? '+4' : '+2 oder +4'} drauf – oder zieh ${v.pend}.` : 'Die Karte passt nicht.'); return; }
    const c = v.hand.find(x => x.id === id);
    const call = v.hand.length === 2 && v.called[M.me];
    if (c.c === 4) return pickColor(color => send('play', { id, color, call }));
    send('play', { id, color: undefined, call });
  }
  function pickColor(cb) {
    let box = $('sfPick'); if (!box) { box = document.createElement('div'); box.id = 'sfPick'; document.body.appendChild(box); }
    const back = document.activeElement;
    box.innerHTML = `<div class="sf-pick" role="dialog" aria-modal="true" aria-labelledby="sfPickT"><div class="panel"><h2 id="sfPickT">Welche Farbe?</h2><div class="sf-pickrow" data-lz-arrows>${COLORS.map((n, i) => `<button type="button" class="sf-pc c${i}" data-col="${i}">${icon(i, 'ic big')}<span>${esc(n)}</span></button>`).join('')}</div><button class="btn ghost small" type="button" data-col="x">Abbrechen <kbd>Esc</kbd></button></div></div>`;
    box.hidden = false;
    const close = () => { box.hidden = true; box.innerHTML = ''; document.removeEventListener('keydown', key, true); if (back && document.body.contains(back)) back.focus({ preventScroll: true }); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } else if (/^[1-4]$/.test(e.key)) { e.stopPropagation(); close(); cb(+e.key - 1); } };
    document.addEventListener('keydown', key, true);
    box.onclick = e => { const b = e.target.closest('[data-col]'); if (!b) { if (e.target.classList.contains('sf-pick')) close(); return; } close(); if (b.dataset.col !== 'x') cb(+b.dataset.col); };
    box.querySelector('[data-col="0"]').focus();
  }

  // ---- Klicks & Tasten -----------------------------------------------------------------------
  function toMenu() {
    clearLocal(); if (V.mode === 'online') leaveOnline();
    V.view = 'menu'; V.mode = null; M = null; lastKey = ''; log.length = 0;
    render(); const f = document.querySelector('#main .btn,#main .choice:not([disabled])'); if (f) f.focus({ preventScroll: true });
  }
  const running = () => V.view === 'table' && M && M.phase === 'play' && M.me >= 0;
  function confirmLeave(cb) {
    if (!running()) return cb();
    let m = $('arConfirm'); if (!m) { m = document.createElement('div'); m.id = 'arConfirm'; document.body.appendChild(m); }
    m.innerHTML = `<div class="ar-over" style="position:fixed;border-radius:0;z-index:60"><div class="panel" role="dialog" aria-modal="true" aria-labelledby="cfT"><h2 id="cfT">Tisch verlassen?</h2><p>${V.mode === 'online' ? 'Bist du länger weg, zieht der Tisch automatisch für dich.' : 'Die laufende Runde geht verloren.'}</p><div class="row"><button class="btn" type="button" id="cfYes">Verlassen</button><button class="btn ghost" type="button" id="cfNo">Bleiben</button></div></div></div>`;
    m.hidden = false; const close = () => { m.hidden = true; m.innerHTML = ''; };
    $('cfNo').onclick = close; $('cfYes').onclick = () => { close(); cb(); }; $('cfNo').focus();
  }
  function goOnline() {
    V.view = 'lobby'; V.mode = null; render();
    if (NET.room && !NET.lobbyUnsub) NET.lobbyUnsub = NET.room.onPeers(() => { const g = $('sfTables'); if (g && V.view === 'lobby') g.innerHTML = tablesHtml(openTables()); });
  }
  function join(code) { const i = $('sfName'); if (i && window.kbName) kbName.set(i.value); V.mode = 'online'; V.view = 'connecting'; M = null; lastKey = ''; log.length = 0; render(); connect(code); }

  document.addEventListener('click', e => {
    const sg = e.target.closest('[data-seg] button');
    if (sg) {
      const k = sg.parentElement.dataset.seg, val = +sg.dataset.v;
      sg.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === sg)));
      if (k === 'level' || k === 'botlvl') V.level = val; else if (k === 'opp') V.opp = val; else if (k === 'stack') V.stack = !!val; else if (k === 'until') V.until = !!val;
      else if (k === 'tuntil') hostCmd('opts', { until: !!val });
      else if (k === 'tstack') hostCmd('opts', { stack: !!val });
      else if (k.startsWith('lvl:')) hostCmd('lvl', { i: +k.slice(4), lvl: val });
      savePref(); return;
    }
    const card = e.target.closest('[data-card]'); if (card) { playCard(+card.dataset.card); return; }
    const b = e.target.closest('[data-sf]'); if (!b || b.disabled) return;
    const a = b.dataset.sf;
    if (a === 'bot' || a === 'again') { V.mode = 'bot'; startLocal(); const f = document.querySelector('.sf-hc.ok,.sf-hc'); if (f) f.focus({ preventScroll: true }); }
    else if (a === 'online') goOnline();
    else if (a === 'create') join(newCode());
    else if (a === 'join' || a === 'retry') { NET.fails = 0; join(b.dataset.code); }
    else if (a === 'savename') { const i = $('sfName'); if (i && window.kbName) { kbName.set(i.value); toast('Name gespeichert'); } }
    else if (a === 'menu') confirmLeave(toMenu);
    else if (a === 'draw') send('draw');
    else if (a === 'pass') send('pass');
    else if (a === 'call') { if (send('call')) toast('Letzte Karte!'); }
    else if (a === 'catch') send('catch');
    else if (a === 'addbot') hostCmd('addbot', { lvl: V.level });
    else if (a === 'rm') hostCmd('rm', { i: +b.dataset.i });
    else if (a === 'start') hostCmd('start');
    else if (a === 'lobby') hostCmd('lobby');
    else if (a === 'copy') { const i = $('sfLink'); try { navigator.clipboard.writeText(i.value).then(() => toast('Link kopiert'), () => { i.select(); toast('Link markiert – jetzt kopieren'); }); } catch (_) { i.select(); } }
  });
  document.addEventListener('keydown', e => {
    if ((window.LZCozy ? LZCozy.isTyping(e) : /INPUT|TEXTAREA/.test(e.target.tagName)) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (V.view !== 'table' || !M || M.phase !== 'play' || $('sfPick') && !$('sfPick').hidden) return;
    const k = e.key.toLowerCase(), v = M.view;
    if (k === 'z' && v.turn === M.me && v.drawn == null) { e.preventDefault(); send('draw'); }
    else if (k === 'b' && v.drawn != null) { e.preventDefault(); send('pass'); }
    else if (k === 'l') { e.preventDefault(); if (send('call')) toast('Letzte Karte!'); }
    else if (k === 'e' && v.catchWin && v.catchWin.seat !== M.me) { e.preventDefault(); send('catch'); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && V.mode === 'online' && NET.code && (!NET.ws || NET.ws.readyState > 1)) connect(NET.code); });

  async function boot() {
    if (window.LZSound) LZSound.mountToggle($('muteBtn'));
    $('btnBack').onclick = () => { if (V.view === 'menu') location.href = '/'; else confirmLeave(toMenu); };
    document.addEventListener('click', e => { const a = e.target.closest('a[data-home]'); if (!a || !running()) return; e.preventDefault(); confirmLeave(() => { if (V.mode === 'online') leaveOnline(); location.href = a.href; }); });
    window.addEventListener('pagehide', () => { if (V.mode === 'online') leaveOnline(); });
    if (window.LZCozy && LZCozy.theme) LZCozy.theme.onChange(() => render());
    render();
    await lobbyInit();
    const jn = new URLSearchParams(location.search).get('join');
    if (jn && NET.room && /^sf-[a-z0-9]{4}$/.test(jn) && V.view === 'menu') { history.replaceState(null, '', location.pathname); join(jn); return; }
    if (V.view === 'menu') render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
