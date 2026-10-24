/* ==========================================================================
   Lunacynas Spielezimmer – Arcade-Rahmen (LZArcade)
   Ein Spiel beschreibt sich mit LZArcade.define({...}) und liefert drei
   getrennte Teile:
     logic  – reine Zustandsmaschine: init / act / tick / turn / over
              (kein DOM; dieselben Regeln für Mensch, Bot und Online)
     bot    – Heuristik: think (rundenbasiert) oder control (Echtzeit)
     view   – Darstellung: mount / render / frame (Canvas)
   Der Rahmen kümmert sich um alles Drumherum: Modus-Auswahl, Spiel-Schleife,
   Bots, Online-Räume, Ergebnis-Karte, Bestwerte, Statistik, Sound, Ansagen.

   Einheitlicher Input: JEDE Eingabe – Maus, Touch, Tastatur, Bot, Netzwerk –
   landet als  act(seat, type, arg)  in logic.act. Ein Bot "drückt" also exakt
   dieselben Knöpfe wie ein Mensch.

   Spiel-Definition (Kurzfassung):
   {
     id, title, sub, modes:{solo:{desc}, local:{desc}, bot:{desc}, online:{desc}},
     options:[{key,label,values:[[v,label]],modes:[...],def}],
     rules:[html], keys:html,
     logic:{ init(cfg,rnd), act(s,seat,type,arg,now)->s'|null, tick?(s,dt,now)->s'|true|null,
             turn?(s)->seat|-1, over(s)->null|{winner,title,text,best?}, hide?:[keys] },
     bot:{ think?(s,seat,level,mem,ctx)->{type,arg}|null, delay?(s,level)->ms,
           control?(s,seat,level,mem,dt,now)->[[type,arg],...], observe?(s,mem,level,seat) },
     view:{ mount(el,ctx), render(s,ctx), frame?(s,ctx,dt) },
     scores(s,ctx)->[{name,value,sub,on}], status(s,ctx)->html
   }
   ========================================================================== */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LEVELS = [[1, 'Leicht'], [2, 'Mittel'], [3, 'Schwer']];

  // ---- kleine Helfer, die auch die Spiele benutzen ------------------------
  function rng(seed) { let a = seed >>> 0 || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function shuffle(arr, rnd) { const a = arr.slice(); rnd = rnd || Math.random; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  const clone = o => JSON.parse(JSON.stringify(o));
  const obf = o => { try { return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).split('').reverse().join(''); } catch (e) { return ''; } };
  const deobf = s => { try { return JSON.parse(decodeURIComponent(escape(atob(String(s).split('').reverse().join(''))))); } catch (e) { return null; } };

  let DEF = null;
  const V = { view: 'menu', mode: null, level: 2, opt: {} };
  let S = null, ver = 0, mem = [{}, {}], botTimer = null, botFails = 0, overShown = false, overInfo = null, startedAt = 0, gid = '';
  let lastT = 0, loopOn = false, lastStatus = '', ctx = null;
  const keys = new Set();
  const ON = { room: null, gr: null, code: '', host: false, seats: [], seq: 0, acts: [], seen: {}, offset: 0, me: -1, hostSeen: 0, guestSeen: 0, gid: '', unsub: null, lobbyUnsub: null, lost: false };

  // ---- Persistenz kleiner Einstellungen (letzter Modus, Stufe, Optionen) --
  const PREF = () => 'lz_ar_' + DEF.id;
  function loadPref() { try { const p = JSON.parse(localStorage.getItem(PREF()) || '{}'); if (p.level) V.level = p.level; if (p.opt) V.opt = p.opt; } catch (e) {} }
  function savePref() { try { localStorage.setItem(PREF(), JSON.stringify({ level: V.level, opt: V.opt })); } catch (e) {} }
  function best(key, value, lower) {
    const k = 'lz_best_' + DEF.id + '_' + key; let old = null;
    try { const v = localStorage.getItem(k); old = v == null ? null : +v; } catch (e) {}
    const better = old == null || (lower ? value < old : value > old);
    if (better) { try { localStorage.setItem(k, String(value)); } catch (e) {} }
    return { old, isNew: better && old != null, first: old == null, best: better ? value : old };
  }

  // ---- Kontext für logic/view/bot ------------------------------------------
  function myName() { return (window.kbName && kbName.get()) || 'Du'; }
  function makeCtx(names) {
    return {
      def: DEF, mode: V.mode, level: V.level, opt: V.opt, names,
      get me() { return V.mode === 'online' ? ON.me : (V.mode === 'local' ? null : 0); },
      isBot: seat => seat === botSeat(),
      isHuman: seat => seat !== botSeat(),
      // Darf DIESES Gerät für den Sitz handeln?
      canAct(seat) { if (V.mode === 'online') return seat === ON.me; if (botSeat() >= 0) return seat === 0; return true; },
      act: (type, arg, seat) => humanAct(type, arg, seat),
      sound: n => { if (window.LZSound) LZSound.play(n); },
      say: (t, assertive) => { if (window.LZCozy) LZCozy.announce(t, { assertive: !!assertive }); },
      toast, now: hostNow, keys, esc, levelName: l => (LEVELS.find(x => x[0] === l) || [0, ''])[1]
    };
  }
  // Welcher Sitz wird vom Bot gespielt? (Bot-Modus, oder Solo-Modi mit eingebautem Gegner)
  function botSeat() { return V.mode === 'bot' || (V.mode === 'solo' && DEF.soloBot) ? 1 : -1; }
  function botLevel() { return V.mode === 'solo' && DEF.soloBot ? DEF.soloBot.level : V.level; }
  function hostNow() { return V.mode === 'online' && !ON.host ? Date.now() + ON.offset : Date.now(); }
  let toastT = 0;
  function toast(msg) { const t = $('arToast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1600); if (window.LZCozy) LZCozy.announce(msg); }

  // ---- Eingaben: alles läuft durch act(seat,type,arg) ---------------------------
  function defaultSeat() {
    if (V.mode === 'online') return ON.me;
    if (V.mode === 'local') { const t = DEF.logic.turn ? DEF.logic.turn(S) : 0; return t >= 0 ? t : 0; }
    return 0;
  }
  function humanAct(type, arg, seat) {
    if (!S || overShown) return false;
    if (seat == null) seat = defaultSeat();
    if (!ctx.canAct(seat)) return false;
    if (V.mode === 'online' && !ON.host) { sendIntent(type, arg); return true; }
    return apply(seat, type, arg);
  }
  function apply(seat, type, arg) {
    const n = DEF.logic.act(S, seat, type, arg, Date.now());
    if (!n) return false;
    S = n; commit(); return true;
  }
  function commit() {
    ver++;
    if (botSeat() >= 0 && DEF.bot && DEF.bot.observe) DEF.bot.observe(S, mem[1], botLevel(), 1);
    if (V.mode === 'online' && ON.host) publish();
    render(); checkOver();
  }

  // ---- Spiel starten -------------------------------------------------------------
  function namesFor(mode) {
    if (mode === 'solo') return DEF.soloBot ? [myName(), DEF.soloBot.name || 'Bot'] : [myName()];
    if (mode === 'bot') return [myName(), 'Bot · ' + LEVELS.find(l => l[0] === V.level)[1]];
    if (mode === 'local') return ['Spieler 1', 'Spieler 2'];
    return ['', ''];
  }
  function startLocal(mode) {
    V.mode = mode; V.view = 'game'; savePref();
    gid = (window.LZCozy && LZCozy.stats ? LZCozy.stats.newId() : Math.random().toString(36).slice(2, 14));
    const names = namesFor(mode);
    ctx = makeCtx(names);
    S = DEF.logic.init({ mode, level: V.level, opt: V.opt, names, seats: mode === 'solo' ? 1 : 2 }, rng((Math.random() * 2 ** 31) | 0));
    mem = [{}, {}]; clearTimeout(botTimer); botTimer = null; overShown = false; overInfo = null; startedAt = Date.now(); ver = 0;
    mountStage();
    commit();
    startLoop();
  }
  function mountStage() {
    const m = $('main');
    m.innerHTML = `<div class="ar-stage"><div class="ar-bar"><div class="ar-status" id="arStatus" aria-live="off"></div><div class="row" id="arTools"></div></div><div id="arView"></div><div id="arOver" hidden></div></div>`;
    const tools = $('arTools');
    if (V.mode !== 'online') tools.innerHTML = `<button class="btn small ghost" type="button" data-ar="restart">Neu starten</button>`;
    else tools.innerHTML = `<span class="label">${ON.me >= 0 ? 'Online · Raum ' + esc(ON.code.slice(3).toUpperCase()) : 'Du schaust zu'}</span>`;
    lastStatus = '';
    DEF.view.mount($('arView'), ctx);
  }

  // ---- Darstellung -----------------------------------------------------------------
  function render() {
    if (!S || V.view !== 'game') return;
    DEF.view.render(S, ctx);
    const st = DEF.status ? DEF.status(S, ctx) : '';
    const el = $('arStatus'); if (el && el.innerHTML !== st) el.innerHTML = st;
    const plain = window.LZCozy ? LZCozy.text(st) : '';
    if (plain && plain !== lastStatus) { lastStatus = plain; if (window.LZCozy && DEF.announceStatus !== false) LZCozy.announce(plain); }
    renderSide();
  }
  function renderSide() {
    const side = $('side'); if (!side) return;
    if (V.view !== 'game' || !S) { side.innerHTML = rulesHtml(); return; }
    const sc = DEF.scores ? DEF.scores(S, ctx) : [];
    const html = `<div class="panel"><h3>${V.mode === 'solo' ? 'Dein Spiel' : 'Punktestand'} <span>${esc(modeLabel())}</span></h3><div class="ar-score">${sc.map(p =>
      `<div class="ar-pl ${p.on ? 'on' : ''}"><i aria-hidden="true"></i><span class="nm">${esc(p.name)}${p.vb ? ' <span class="vb" title="Mit Twitch bestätigt">✓</span>' : ''}${p.sub ? `<span class="sub">${p.sub}</span>` : ''}</span><b>${p.value}</b></div>`).join('')}</div></div>` +
      `<div class="panel"><h3>So geht's</h3><ol class="rules">${(DEF.rules || []).map(r => `<li><span>${r}</span></li>`).join('')}</ol>${DEF.keys ? `<p class="kbdhint">${DEF.keys}</p>` : ''}</div>`;
    if (side._h !== html) { side.innerHTML = html; side._h = html; }
  }
  function modeLabel() { return { solo: 'Solo', local: 'Zu zweit hier', bot: 'Gegen Bot · ' + ctx.levelName(V.level), online: 'Online' }[V.mode] || ''; }
  function rulesHtml() {
    return `<div class="panel"><h3>So geht's</h3><ol class="rules">${(DEF.rules || []).map(r => `<li><span>${r}</span></li>`).join('')}</ol>${DEF.keys ? `<p class="kbdhint">${DEF.keys}</p>` : ''}</div>`;
  }

  // ---- Ende einer Partie ----------------------------------------------------------
  function checkOver() {
    if (!S || overShown) return;
    const o = DEF.logic.over(S); if (!o) return;
    overShown = true; overInfo = o;
    clearTimeout(botTimer); botTimer = null;
    let rec = '';
    if (o.best && (V.mode !== 'online' || ON.me >= 0)) {
      const r = best(o.best.key, o.best.value, o.best.lower);
      const f = o.best.fmt || (v => v);
      rec = r.isNew ? `<p class="rec">Neuer Rekord! (vorher ${esc(f(r.old))})</p>` : r.first ? `<p class="rec">Dein erster Rekord.</p>` : `<p class="hint">Dein Rekord: ${esc(f(r.best))}</p>`;
    }
    const authority = V.mode !== 'online' || ON.host;
    if (authority && window.LZCozy && LZCozy.stats) LZCozy.stats.round({ game: DEF.id, id: gid + ':1', start: startedAt });
    reportBoard(o);
    const won = o.winner != null && o.winner >= 0 && ctx.canAct(o.winner) && V.mode !== 'local';
    const lost = o.winner != null && o.winner >= 0 && !ctx.canAct(o.winner) && V.mode !== 'local';
    if (window.LZSound) LZSound.play(V.mode === 'solo' ? (rec.includes('Neuer') ? 'fanfare' : 'win') : won ? 'fanfare' : lost ? 'lose' : 'win');
    const again = V.mode !== 'online' ? `<button class="btn" type="button" data-ar="restart">Nochmal</button>`
      : ON.host ? `<button class="btn" type="button" data-ar="rematch">Revanche</button>` : `<span class="hint">Die Spielleitung kann eine Revanche starten.</span>`;
    const box = $('arOver');
    if (!o.title) o.title = o.winner != null && o.winner >= 0 ? (won ? 'Gewonnen!' : (ctx.names[o.winner] || 'Jemand') + ' gewinnt!') : 'Spielende';
    box.innerHTML = `<div class="ar-over"><div class="panel" role="dialog" aria-labelledby="arOverT"><h2 id="arOverT">${esc(o.title)}</h2>${o.text ? `<p>${o.text}</p>` : ''}${rec}
      <div class="row">${again}<button class="btn ghost" type="button" data-ar="menu">${V.mode === 'online' ? 'Verlassen' : 'Anderer Modus'}</button></div></div></div>`;
    box.hidden = false;
    if (window.LZCozy) LZCozy.announce((o.title || 'Spielende') + '. ' + LZCozy.text(o.text || ''), { assertive: true });
    const f = box.querySelector('.btn'); if (f) setTimeout(() => f.focus({ preventScroll: true }), 60);
  }

  // ---- Bestenliste ----------------------------------------------------------------------
  // Siege zählen nur zwischen zwei Menschen online (die Spielleitung meldet, der Server prüft
  // per Raum, wer wirklich mitgespielt hat). Solo-Rekorde meldet das eigene Gerät.
  function post(url, body) { try { fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', keepalive: true }).catch(() => {}); } catch (e) {} }
  function reportBoard(o) {
    if (!window.KB_SERVER) return;
    if (V.mode === 'online' && ON.host && ON.seats.length === 2) {
      const players = ON.seats.map((x, i) => ({ name: ctx.names[i] || '', b: (x && x.by) || '', pts: DEF.points ? DEF.points(S, i) | 0 : 0, win: o.winner === i }));
      post('/api/scores', { game: DEF.id, gid: ON.gid, room: ON.code, players });
    }
    if (V.mode === 'solo' && o.record != null) post('/api/records', { game: DEF.id, value: o.record, name: myName() });
  }

  // ---- Schleife: Ticks, Echtzeit-Bots, rundenbasierte Bots, Canvas -------------------
  function startLoop() { if (loopOn) return; loopOn = true; lastT = performance.now(); requestAnimationFrame(loop); }
  function loop(t) {
    if (V.view !== 'game' || !S) { loopOn = false; return; }
    const dt = Math.min(0.05, (t - lastT) / 1000); lastT = t;
    const authority = V.mode !== 'online' || ON.host;
    if (authority && !overShown) {
      if (DEF.logic.tick) { const n = DEF.logic.tick(S, dt, Date.now()); if (n) { if (n !== true) S = n; commit(); } }
      if (botSeat() >= 0 && DEF.bot && !overShown) {
        if (DEF.bot.control) { const acts = DEF.bot.control(S, 1, botLevel(), mem[1], dt, Date.now()) || []; for (const [ty, ar] of acts) apply(1, ty, ar); }
        if (DEF.bot.think) scheduleBot();
      }
    }
    if (DEF.view.frame) DEF.view.frame(S, ctx, dt);
    requestAnimationFrame(loop);
  }
  function scheduleBot() {
    if (botTimer || overShown) return;
    const turn = DEF.logic.turn ? DEF.logic.turn(S) : -1;
    if (turn !== 1) { botFails = 0; return; }
    const v = ver, delay = DEF.bot.delay ? DEF.bot.delay(S, botLevel()) : 600;
    botTimer = setTimeout(() => {
      botTimer = null;
      if (ver !== v || overShown || botSeat() < 0) return;     // Zustand hat sich inzwischen geändert -> neu planen
      const plan = DEF.bot.think(S, 1, botLevel(), mem[1], ctx);
      if (plan && apply(1, plan.type, plan.arg)) botFails = 0;
      else if (++botFails > 5) { console.warn('Bot findet keinen gültigen Zug'); botFails = -1e9; }
    }, botFails > 0 ? 60 : delay);
  }

  // ---- Online (nur für rundenbasierte Spiele) ----------------------------------------
  // Raum-Code "ar-xxxx"; Spielleitung = Sitz 0, wer beitritt = Sitz 1, alle weiteren schauen zu.
  // Spielleitung publiziert {g:{s,seats,gid,t}}, Gäste schicken ihre Eingaben als a:[[seq,type,arg],…].
  function pack(s) {
    const h = DEF.logic.hide || []; if (!h.length) return s;
    const pub = { ...s }, sec = {}; h.forEach(k => { if (k in pub) { sec[k] = pub[k]; delete pub[k]; } });
    pub.__x = obf(sec); return pub;
  }
  function unpack(p) { if (!p || !p.__x) return p; const s = { ...p, ...(deobf(p.__x) || {}) }; delete s.__x; return s; }
  function publish() {
    if (!ON.gr) return;
    ON.gr.presence({ j: 1, g: { id: DEF.id, s: pack(S), seats: ON.seats, gid: ON.gid, t: Date.now() } }).catch(() => {});
    ON.room && ON.room.presence({ host: { code: ON.code, game: DEF.id, ph: overShown ? 'over' : 'play', n: 2 } }).catch(() => {});
  }
  function sendIntent(type, arg) {
    ON.acts.push([++ON.seq, type, arg == null ? null : arg]); if (ON.acts.length > 8) ON.acts.shift();
    ON.gr && ON.gr.presence({ j: 1, a: ON.acts }).catch(() => {});
  }
  async function onlineInit() {
    if (!window.claude || !window.KB_SERVER) return null;
    try { ON.room = await window.claude.use('room'); } catch (e) { ON.room = null; }
    return ON.room;
  }
  function lobbyList() {
    const list = lobbyGames();
    return list.length ? list.map(p => { const h = p.presence.host, open = h.ph === 'wait'; return `<div class="game"><div style="min-width:0"><div class="t">Spiel von ${esc(p.presence.nm || 'jemandem')}</div><div class="s">${open ? 'wartet auf dich' : 'läuft gerade'}</div></div><button class="btn small ${open ? '' : 'ghost'}" type="button" data-ar="join" data-code="${esc(h.code)}">${open ? 'Mitspielen' : 'Zuschauen'}</button></div>`; }).join('')
      : '<div class="empty">Gerade wartet niemand. Eröffne ein Spiel – wer diese Seite öffnet und „Online“ wählt, sieht es hier.</div>';
  }
  function lobbyGames() {
    if (!ON.room) return [];
    return ON.room.peers().filter(p => !p.isMe && p.presence && p.presence.host && p.presence.host.game === DEF.id && /^ar-[a-z0-9]{4}$/.test(p.presence.host.code || ''));
  }
  async function onlineCreate() {
    const code = 'ar-' + Math.random().toString(36).slice(2, 6).padEnd(4, '0');
    ON.code = code; ON.host = true; ON.gid = Math.random().toString(36).slice(2, 10);
    ON.gr = await ON.room.join(code);
    ON.gr.presence({ j: 1 });
    ON.room.presence({ host: { code, game: DEF.id, ph: 'wait', n: 1 } });
    V.view = 'wait'; V.mode = 'online'; renderMenu();
    watchRoom();
  }
  async function onlineJoin(code) {
    ON.code = code; ON.host = false;
    ON.gr = await ON.room.join(code);
    ON.gr.presence({ j: 1 });
    V.view = 'joining'; V.mode = 'online'; renderMenu();
    watchRoom();
  }
  function onlineLeave() {
    try { ON.unsub && ON.unsub(); } catch (e) {}
    if (ON.gr) { try { ON.gr.presence({ g: null, a: null, j: null }); ON.gr.leave(); } catch (e) {} }
    if (ON.room) ON.room.presence({ host: null }).catch(() => {});
    Object.assign(ON, { gr: null, code: '', host: false, seats: [], acts: [], seq: 0, seen: {}, me: -1, unsub: null, lost: false, gid: '' });
  }
  function peerInfo(p) { return { p: p.peer, by: p.by, nm: (p.presence && p.presence.nm) || '' }; }
  function watchRoom() {
    ON.unsub = ON.gr.onPeers(({ peers }) => {
      const me = peers.find(p => p.isMe);
      if (ON.host) hostPeers(peers, me); else guestPeers(peers, me);
    });
    // Abwesenheit prüfen
    clearInterval(ON.watch);
    ON.watch = setInterval(() => {
      if (!ON.gr || V.mode !== 'online') { clearInterval(ON.watch); return; }
      const t = Date.now();
      if (!ON.host && V.view === 'game' && t - ON.hostSeen > 6000 && !ON.lost) { ON.lost = true; lostOverlay('Die Verbindung zur Spielleitung ist weg.'); }
      if (ON.host && V.view === 'game' && ON.seats[1] && t - ON.guestSeen > 15000 && !ON.lost) { ON.lost = true; lostOverlay(esc(ON.seats[1].nm || 'Dein Gegner') + ' hat das Spiel verlassen.'); }
    }, 1000);
  }
  function hostPeers(peers, me) {
    const others = peers.filter(p => !p.isMe && p.presence && p.presence.j === 1);
    if (V.view === 'wait') {
      const g = others[0]; if (!g) return;
      ON.seats = [peerInfo(me), peerInfo(g)];
      const names = [myName(), ON.seats[1].nm || 'Gast'];
      V.view = 'game'; ctx = makeCtx(names); ctx.vb = [window.kbName && kbName.verified(), window.kbName && kbName.isVerified(g.by)];
      S = DEF.logic.init({ mode: 'online', level: 2, opt: V.opt, names, seats: 2 }, rng((Math.random() * 2 ** 31) | 0));
      ON.me = 0; overShown = false; startedAt = Date.now(); gid = ON.gid;
      if (window.LZSound) LZSound.play('join');
      mountStage(); commit(); startLoop();
      return;
    }
    if (V.view !== 'game') return;
    // Sitz 1 wiederfinden (auch nach Neuladen: gleiche Nutzer-ID)
    const s1 = ON.seats[1];
    const g = others.find(p => p.peer === s1.p) || others.find(p => p.by && p.by === s1.by);
    if (g) {
      ON.guestSeen = Date.now();
      if (g.peer !== s1.p) { s1.p = g.peer; ON.seen[g.peer] = 0; }
      if (ON.lost) { ON.lost = false; $('arOver').hidden = !overShown; if (!overShown) $('arOver').innerHTML = ''; }
      const a = g.presence.a;
      if (Array.isArray(a)) for (const it of a) {
        if (!Array.isArray(it) || !Number.isInteger(it[0])) continue;
        if (it[0] <= (ON.seen[g.peer] || 0)) continue;
        ON.seen[g.peer] = it[0];
        if (!overShown) apply(1, String(it[1]), it[2]);
      }
    }
  }
  function guestPeers(peers, me) {
    const h = peers.find(p => !p.isMe && p.presence && p.presence.g && p.presence.g.id === DEF.id);
    if (!h) return;
    ON.hostSeen = Date.now();
    const g = h.presence.g;
    ON.offset = (g.t || Date.now()) - Date.now();
    ON.seats = g.seats || [];
    const myIdx = ON.seats.findIndex(x => x && (x.p === me.peer || (me.by && x.by === me.by)));
    const newGame = g.gid !== ON.gid || V.view !== 'game';
    if (newGame) {
      ON.gid = g.gid; ON.me = myIdx; overShown = false; ON.seen = {}; ON.acts = []; ON.seq = 0;
      const names = ON.seats.map((x, i) => (x && x.nm) || (i ? 'Gast' : 'Spielleitung'));
      ctx = makeCtx(names); ctx.vb = ON.seats.map(x => !!(x && window.kbName && kbName.isVerified(x.by)));
      V.view = 'game'; S = unpack(g.s); mountStage();
      if (window.LZSound) LZSound.play('join');
      render(); checkOver(); startLoop();
      return;
    }
    if (ON.lost) { ON.lost = false; if (!overShown) { $('arOver').hidden = true; $('arOver').innerHTML = ''; } }
    const s = unpack(g.s);
    // Revanche: neuer Spielzustand ohne Ende -> Ergebnis-Karte schließen
    if (overShown && !DEF.logic.over(s)) { overShown = false; $('arOver').hidden = true; }
    S = s; ver++; render(); checkOver();
  }
  function lostOverlay(msg) {
    const box = $('arOver'); if (!box) return;
    box.innerHTML = `<div class="ar-over"><div class="panel" role="alertdialog" aria-labelledby="arLostT"><h2 id="arLostT">Verbindung weg</h2><p>${msg}</p><p class="hint">Kommt die Person zurück, geht es automatisch weiter.</p>
      <div class="row"><button class="btn ghost" type="button" data-ar="menu">Zurück zur Auswahl</button></div></div></div>`;
    box.hidden = false;
    if (window.LZCozy) LZCozy.announce(LZCozy.text(msg), { assertive: true });
  }

  // ---- Menü --------------------------------------------------------------------------
  function seg(key, cur, values) { return `<div class="seg" data-seg="${key}">${values.map(([v, l]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${String(cur) === String(v)}">${esc(l)}</button>`).join('')}</div>`; }
  function optionsFor(mode) {
    return (DEF.options || []).filter(o => !o.modes || o.modes.includes(mode));
  }
  function renderMenu() {
    const m = $('main'); if (!m) return;
    renderSide();
    const md = DEF.modes || {};
    if (V.view === 'menu') {
      const net = !!ON.room;
      const opts = (DEF.options || []).map(o => { if (V.opt[o.key] == null) V.opt[o.key] = o.def; return `<div class="field"><span class="label">${esc(o.label)}${o.modes ? ' · ' + o.modes.map(x => ({ solo: 'Solo', local: 'zu zweit', bot: 'Bot', online: 'online' }[x])).join(', ') : ''}</span>${seg('opt:' + o.key, V.opt[o.key], o.values)}</div>`; }).join('');
      m.innerHTML = `<div class="panel sheet"><h2>Wie willst du spielen?</h2><div class="choices">
        ${md.solo ? `<button class="choice" type="button" data-ar="solo"><b>Solo</b><span>${md.solo.desc}</span></button>` : ''}
        ${md.local ? `<button class="choice" type="button" data-ar="local"><b>Zu zweit hier</b><span>${md.local.desc}</span></button>` : ''}
        ${md.bot ? `<div class="choice" style="cursor:default"><b>Gegen den Bot</b><span>${md.bot.desc}</span><div style="width:100%;margin-top:8px">${seg('level', V.level, LEVELS)}</div><div class="row" style="margin-top:10px"><button class="btn" type="button" data-ar="bot">Los geht's</button></div></div>` : ''}
        ${md.online ? `<button class="choice" type="button" data-ar="online" ${net ? '' : 'disabled'}><b>Online zu zweit</b><span>${net ? md.online.desc : 'Kein Spielserver gefunden. Online geht nur, wenn die Seite als Cloudflare Worker läuft.'}</span></button>` : ''}
      </div>${opts}</div>`;
      return;
    }
    if (V.view === 'lobby') {
      const nm = myName();
      m.innerHTML = `<div class="panel sheet"><div class="label">Online</div><h2>Gegner finden</h2>
        <div class="field"><span class="label">Dein Name</span><div class="row" style="flex-wrap:nowrap"><input class="txt" id="arName" value="${esc(nm)}" maxlength="24" autocomplete="off" ${window.kbName && kbName.verified() ? 'disabled' : ''}><button class="btn small ghost" type="button" data-ar="savename">Speichern</button></div></div>
        <div class="games">${lobbyList()}</div>
        <div class="row"><button class="btn" type="button" data-ar="create">Neues Spiel eröffnen</button><button class="btn ghost" type="button" data-ar="menu">Zurück</button></div></div>`;
      return;
    }
    if (V.view === 'wait') {
      m.innerHTML = `<div class="panel sheet"><div class="label">Online · Raum ${esc(ON.code.slice(3).toUpperCase())}</div><h2>Warte auf Gegner</h2><p><span class="dots">Dein Spiel steht in der Liste</span></p><p class="hint">Sobald jemand auf „Mitspielen“ klickt, geht es los.</p><div class="row"><button class="btn ghost" type="button" data-ar="menu">Abbrechen</button></div></div>`;
      return;
    }
    if (V.view === 'joining') {
      m.innerHTML = `<div class="panel sheet"><h2>Verbinde …</h2><p><span class="dots">Einen Moment</span></p><div class="row"><button class="btn ghost" type="button" data-ar="menu">Abbrechen</button></div></div>`;
    }
  }
  function toMenu() {
    clearTimeout(botTimer); botTimer = null;
    if (V.mode === 'online') onlineLeave();
    if (DEF.view.unmount) try { DEF.view.unmount(); } catch (e) {}
    S = null; V.view = 'menu'; V.mode = null; overShown = false; renderMenu();
    const f = document.querySelector('#main .choice:not([disabled]),#main .btn'); if (f) f.focus({ preventScroll: true });
  }
  function running() { return V.view === 'game' && S && !overShown; }
  function confirmLeave(cb) {
    if (!running() || V.mode === 'solo') return cb();
    let m = $('arConfirm'); if (!m) { m = document.createElement('div'); m.id = 'arConfirm'; m.className = 'ar-confirm'; document.body.appendChild(m); }
    m.innerHTML = `<div class="ar-over" style="position:fixed;border-radius:0;z-index:60"><div class="panel" role="dialog" aria-modal="true" aria-labelledby="cfT"><h2 id="cfT">Spiel verlassen?</h2><p>${V.mode === 'online' ? 'Die Partie endet für euch beide.' : 'Die laufende Partie geht verloren.'}</p><div class="row"><button class="btn" type="button" id="cfYes">Verlassen</button><button class="btn ghost" type="button" id="cfNo">Bleiben</button></div></div></div>`;
    m.hidden = false; const close = () => { m.hidden = true; m.innerHTML = ''; };
    $('cfNo').onclick = close; $('cfYes').onclick = () => { close(); cb(); }; $('cfNo').focus();
  }

  // ---- Klicks & Tasten ----------------------------------------------------------------
  document.addEventListener('click', async e => {
    const sg = e.target.closest('[data-seg] button');
    if (sg && V.view === 'menu') {
      const k = sg.parentElement.dataset.seg, v = sg.dataset.v;
      if (k === 'level') V.level = +v; else if (k.startsWith('opt:')) { const o = DEF.options.find(x => x.key === k.slice(4)); V.opt[o.key] = typeof o.def === 'number' ? +v : v; }
      sg.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === sg)));
      savePref(); return;
    }
    const b = e.target.closest('[data-ar]'); if (!b || b.disabled) return;
    const a = b.dataset.ar;
    if (a === 'solo' || a === 'local' || a === 'bot') startLocal(a);
    else if (a === 'online') { V.view = 'lobby'; renderMenu(); if (ON.room && !ON.lobbyUnsub) ON.lobbyUnsub = ON.room.onPeers(() => { if (V.view === 'lobby') { const g = document.querySelector('#main .games'); if (g) g.innerHTML = lobbyList(); } }); }
    else if (a === 'create') { const i = $('arName'); if (i && window.kbName) kbName.set(i.value); onlineCreate(); }
    else if (a === 'join') { const i = $('arName'); if (i && window.kbName) kbName.set(i.value); onlineJoin(b.dataset.code); }
    else if (a === 'savename') { const i = $('arName'); if (i && window.kbName) { kbName.set(i.value); toast('Name gespeichert'); } }
    else if (a === 'menu') toMenu();
    else if (a === 'restart') { if (overShown || V.mode === 'solo') startLocal(V.mode); else confirmLeave(() => startLocal(V.mode)); }
    else if (a === 'rematch' && ON.host) {
      ON.gid = Math.random().toString(36).slice(2, 10); gid = ON.gid;
      S = DEF.logic.init({ mode: 'online', level: 2, opt: V.opt, names: ctx.names, seats: 2, rematch: true }, rng((Math.random() * 2 ** 31) | 0));
      overShown = false; $('arOver').hidden = true; startedAt = Date.now(); commit();
    }
  });
  function typing(e) { return window.LZCozy ? LZCozy.isTyping(e) : /INPUT|TEXTAREA/.test(e.target.tagName); }
  document.addEventListener('keydown', e => {
    if (typing(e)) return;
    keys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    if (V.view === 'game' && DEF.view.key && S && !overShown && !document.querySelector('dialog[open]')) DEF.view.key(e, S, ctx);
  });
  document.addEventListener('keyup', e => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
  window.addEventListener('blur', () => keys.clear());

  // ---- Start ------------------------------------------------------------------------------
  async function boot() {
    loadPref();
    document.title = DEF.title + ' · Lunacynas Spielezimmer';
    $('btnBack').onclick = () => { if (V.view === 'menu') location.href = '/'; else confirmLeave(toMenu); };
    document.addEventListener('click', e => { const a = e.target.closest('a[data-home]'); if (!a || !running() || V.mode === 'solo') return; e.preventDefault(); confirmLeave(() => { if (V.mode === 'online') onlineLeave(); location.href = a.href; }); });
    window.addEventListener('beforeunload', e => { if (running() && V.mode === 'online') { e.preventDefault(); e.returnValue = ''; } });
    if (window.LZSound) LZSound.mountToggle($('muteBtn'));
    renderMenu();
    await onlineInit();
    if (V.view === 'menu') renderMenu();
  }
  function define(def) {
    DEF = def;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }
  // ---- Canvas-Helfer für Echtzeit-Spiele ------------------------------------------------
  // Logische Größe w×h; im 8-Bit-Modus wird in Viertel-Auflösung gezeichnet (pixelig hochskaliert).
  function canvas(host, w, h, label) {
    const cv = document.createElement('canvas'); cv.className = 'ar-canvas'; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', label || 'Spielfeld');
    host.appendChild(cv);
    const g = cv.getContext('2d'); const api = { cv, g, w, h, colors: {} };
    function css(n, f) { const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return v || f; }
    api.refresh = () => {
      const retro = document.documentElement.classList.contains('retro-mode');
      const k = retro ? 0.5 : Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(w * k); cv.height = Math.round(h * k); cv.style.aspectRatio = w + '/' + h;
      g.setTransform(k, 0, 0, k, 0, 0); g.imageSmoothingEnabled = !retro; api.retro = retro;
      const c = api.colors;
      ['night', 'night-2', 'dusk', 'horizon', 'panel-a', 'panel-b', 'frame', 'frame-hi', 'text', 'muted', 'neon', 'glow', 'lavender', 'moon', 'peach', 'ink'].forEach(n => c[n] = css('--c-' + n, '#888'));
      c.p1 = css('--p1', '#FFC857'); c.p2 = css('--p2', '#6FD3FF');
      c.font = retro ? '"LZ Pixel", monospace' : '"Quicksand", system-ui, sans-serif';
      c.display = retro ? '"LZ Pixel", monospace' : '"Dancing Script", cursive';
    };
    api.refresh();
    const re = () => setTimeout(() => { if (cv.isConnected) api.refresh(); }, 30);
    window.addEventListener('lzretro', re); if (window.LZCozy) LZCozy.theme.onChange(re);
    api.toLogic = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * w / r.width, y: (e.clientY - r.top) * h / r.height }; };
    return api;
  }
  window.LZArcade = { define, canvas, rng, shuffle, clone, esc, LEVELS, _state: () => S, _ver: () => ver };
})();
