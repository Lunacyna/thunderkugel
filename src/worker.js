// Lunacynas Spielezimmer – Cloudflare Worker
// Liefert die Spielseite aus (public/) und betreibt die Online-Räume über Durable Objects.
// Jeder Raum (Lobby oder ein einzelnes Spiel) ist ein eigenes Durable Object.
// Das Objekt verteilt nur "Presence": jeder Teilnehmer hat ein kleines JSON-Objekt,
// das an alle anderen im selben Raum weitergegeben wird. Die Spiellogik läuft im Browser
// des Spielleiters.

import { DurableObject } from "cloudflare:workers";
import { SOLUTIONS, ALLOWED } from "./mondwort-words.js";
import "./sternenfall-core.js";   // stellt globalThis.SFCore bereit (Regeln + Bots von „Letzte Karte!“)

const ROOM_RE = /^(lobby|lobby-zw|lobby-ne|lobby-ar|g-(kb|zw|ne|ar)-[a-z0-9]{4})$/;
const ID_RE = /^[a-z0-9_]{4,24}$/;
const MAX_MSG = 12000;     // Bytes pro Nachricht
const MAX_PEERS = 64;      // Verbindungen pro Raum

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.presence = new Map(); // peer -> presence (im Speicher)
    this.vu = null;            // per Twitch verifizierte Teilnehmer: by -> Anzeigename
  }

  // Für die Bestenliste: wer war mit Twitch-Login in diesem Raum?
  // Offene Spiele in einem Lobby-Raum (für "Gerade suchen Spieler" auf der Startseite)
  async openGames() {
    const out = [], seen = new Set();
    for (const ws of this.ctx.getWebSockets()) {
      const a = this.att(ws); if (!a || seen.has(a.peer)) continue; seen.add(a.peer);
      const pr = this.presence.get(a.peer) || a.pr || {}, h = pr.host;
      if (!h || typeof h.code !== "string" || !/^(kb|zw|ne|ar|sf)-[a-z0-9]{4}$/.test(h.code)) continue;
      out.push({ code: h.code, game: typeof h.game === "string" ? h.game.slice(0, 8) : "", ph: String(h.ph || "").slice(0, 8), n: Math.max(0, Math.min(99, h.n | 0)),
                 host: String(a.vn || pr.nm || "").slice(0, 30), v: !!a.vn });
    }
    return out;
  }
  async verifiedUsers() {
    if (!this.vu) this.vu = (await this.ctx.storage.get("vu")) || {};
    return this.vu;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const peer = url.searchParams.get("peer") || "";
    const by = url.searchParams.get("by") || "";
    const vn = request.headers.get("x-verified-name") ? decodeURIComponent(request.headers.get("x-verified-name")) : "";
    if (!ID_RE.test(peer) || !ID_RE.test(by)) return new Response("bad peer", { status: 400 });

    const sockets = this.ctx.getWebSockets();
    if (sockets.length >= MAX_PEERS) return new Response("room full", { status: 429 });

    // Alte Verbindung desselben Tabs (Reconnect) schließen
    for (const ws of sockets) {
      const a = this.att(ws);
      if (a && a.peer === peer) { try { ws.close(1000, "replaced"); } catch {} }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ peer, by, vn, pr: {} });
    this.presence.set(peer, {});
    if (vn) { const vu = await this.verifiedUsers(); if (vu[by] !== vn) { vu[by] = vn; await this.ctx.storage.put("vu", vu); } }

    const peers = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === server) continue;
      const a = this.att(ws);
      if (!a || a.peer === peer) continue;
      peers.push({ peer: a.peer, by: a.by, vn: a.vn || "", pr: this.presence.get(a.peer) || a.pr || {} });
    }
    server.send(JSON.stringify({ t: "snap", peers }));
    return new Response(null, { status: 101, webSocket: client });
  }

  att(ws) {
    try { return ws.deserializeAttachment(); } catch { return null; }
  }

  broadcast(msg, except) {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(s); } catch {}
    }
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== "string" || message.length > MAX_MSG) return;
    let m;
    try { m = JSON.parse(message); } catch { return; }
    if (!m || m.t !== "p" || typeof m.pr !== "object" || m.pr === null || Array.isArray(m.pr)) return;
    const a = this.att(ws);
    if (!a) return;
    this.presence.set(a.peer, m.pr);
    // Kleine Presence auch am Socket sichern (übersteht ein Schlafen des Objekts)
    if (message.length < 1500) { a.pr = m.pr; try { ws.serializeAttachment(a); } catch {} }
    this.broadcast({ t: "p", peer: a.peer, by: a.by, vn: a.vn || "", pr: m.pr }, ws);
  }

  async webSocketClose(ws) { this.gone(ws); }
  async webSocketError(ws) { this.gone(ws); }

  gone(ws) {
    const a = this.att(ws);
    try { ws.close(1000, "bye"); } catch {}
    if (!a) return;
    // Nur austragen, wenn kein neuerer Socket desselben Tabs existiert
    const still = this.ctx.getWebSockets().some(w => w !== ws && (this.att(w) || {}).peer === a.peer);
    if (still) return;
    this.presence.delete(a.peer);
    this.broadcast({ t: "p", peer: a.peer, by: a.by, pr: null }, ws);
  }
}


// ---------------------------------------------------------------------------
// SFTable: ein Tisch von „Letzte Karte!“ (ein Durable Object pro Code "sf-xxxx")
// Anders als die übrigen Räume läuft hier die Spiellogik auf dem SERVER: er mischt,
// verteilt, prüft jeden Zug und schickt jedem Browser nur dessen eigene Ansicht
// (SFCore.viewFor) – fremde Hände und der Nachziehstapel verlassen den Server nie.
// Bots spielen über Alarme, ebenso die Zeitlimits. Der Tisch schläft zwischen
// den Nachrichten (Hibernation); der Zustand liegt im Speicher des Objekts.
// ---------------------------------------------------------------------------
const SF_RE = /^sf-[a-z0-9]{4}$/;
const SF_MAX = 6, SF_TURN_MS = 45000, SF_AWAY_MS = 6000, SF_PRUNE_MS = 10000, SF_IDLE_MS = 30 * 60000;
const SF_BOTS = ["Mondkatze", "Kometa", "Sternchen", "Nebula", "Orbit", "Luna-Bot"];

export class SFTable extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.st = null;
    ctx.blockConcurrencyWhile(async () => { this.st = (await ctx.storage.get("st")) || null; });
  }
  att(ws) { try { return ws.deserializeAttachment(); } catch { return null; } }
  socks(except) { return this.ctx.getWebSockets().filter(w => w !== except && w.readyState !== 3); }
  onlineBys(except) { const s = new Set(); for (const w of this.socks(except)) { const a = this.att(w); if (a) s.add(a.by); } return s; }
  seatOf(by) { return this.st ? this.st.seats.findIndex(x => x.by === by) : -1; }

  async fetch(request) {
    const url = new URL(request.url);
    const code = url.searchParams.get("t") || "", peer = url.searchParams.get("peer") || "", by = url.searchParams.get("by") || "";
    const vn = request.headers.get("x-verified-name") ? clean(decodeURIComponent(request.headers.get("x-verified-name")), 30) : "";
    if (!SF_RE.test(code) || !ID_RE.test(peer) || !ID_RE.test(by)) return new Response("bad request", { status: 400 });
    if (this.socks().length >= 24) return new Response("table full", { status: 429 });
    let name = vn || clean(url.searchParams.get("n"), 24);
    if (name.length < 2) name = "Gast";
    for (const w of this.socks()) { const a = this.att(w); if (a && a.peer === peer) { try { w.close(1000, "replaced"); } catch {} } }

    if (!this.st) this.st = { code, host: by, seats: [], phase: "wait", opts: { stack: true, until: false }, g: null, gid: "", started: 0, wins: {}, res: null, tm: {}, round: 0 };
    const st = this.st;
    let seat = this.seatOf(by);
    if (seat < 0 && st.phase === "wait" && st.seats.length < SF_MAX) { st.seats.push({ by, name, v: !!vn, bot: 0 }); seat = st.seats.length - 1; }
    if (seat >= 0) { st.seats[seat].name = name; st.seats[seat].v = !!vn; }
    if (!st.seats.some(x => x.by === st.host && !x.bot)) st.host = seat >= 0 ? by : st.host;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ peer, by, name, v: !!vn });
    st.tm.clean = 0; st.tm.toKey = null;                     // wer zurückkommt, bekommt wieder die volle Bedenkzeit
    await this.update();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== "string" || message.length > 2000 || !this.st) return;
    let m; try { m = JSON.parse(message); } catch { return; }
    const a = this.att(ws); if (!a || !m || typeof m !== "object") return;
    const st = this.st, seat = this.seatOf(a.by), isHost = a.by === st.host;
    if (m.t === "ping") { try { ws.send(JSON.stringify({ t: "pong", now: Date.now() })); } catch {} return; }
    if (m.t === "name" && !a.v) {
      const n = clean(m.name, 24); if (n.length < 2) return;
      a.name = n; ws.serializeAttachment(a); if (seat >= 0) st.seats[seat].name = n;
      return this.update();
    }
    if (m.t === "act" && st.phase === "play" && seat >= 0 && typeof m.type === "string") {
      const arg = m.arg && typeof m.arg === "object" ? { id: m.arg.id | 0, color: m.arg.color, call: !!m.arg.call } : null;
      const g2 = SFCore.act(st.g, seat, m.type, arg, Date.now());
      if (!g2) { try { ws.send(JSON.stringify({ t: "nope" })); } catch {} return; }
      st.g = g2;
      return this.update();
    }
    if (m.t !== "host" || !isHost) return;
    if (m.a === "addbot" && st.phase !== "play" && st.seats.length < SF_MAX) {
      const lvl = [1, 2, 3].includes(m.lvl) ? m.lvl : 2;
      const used = new Set(st.seats.map(x => x.name));
      st.seats.push({ by: "bot_" + crypto.randomUUID().slice(0, 6), name: SF_BOTS.find(n => !used.has(n)) || "Bot", v: false, bot: lvl });
    } else if (m.a === "rm" && st.phase !== "play") {
      const i = m.i | 0, x = st.seats[i];
      if (x && (x.bot || !this.onlineBys().has(x.by)) && x.by !== st.host) st.seats.splice(i, 1);
    } else if (m.a === "lvl" && st.phase !== "play") {
      const x = st.seats[m.i | 0]; if (x && x.bot && [1, 2, 3].includes(m.lvl)) x.bot = m.lvl;
    } else if (m.a === "opts" && st.phase !== "play") {
      if ("stack" in m) st.opts.stack = !!m.stack;
      if ("until" in m) st.opts.until = !!m.until;
    } else if (m.a === "start" && st.phase !== "play" && st.seats.length >= 2) {
      st.g = SFCore.newGame(st.seats.length, st.opts);
      st.phase = "play"; st.res = null; st.round++; st.started = Date.now();
      st.gid = crypto.randomUUID().replace(/-/g, "").slice(0, 16); st.tm = {};
    } else if (m.a === "lobby" && st.phase === "end") {
      st.phase = "wait"; st.g = null; st.res = null;
      // Zuschauer dürfen sich jetzt an freie Plätze setzen
      for (const w of this.socks()) {
        const b = this.att(w); if (!b || this.seatOf(b.by) >= 0 || st.seats.length >= SF_MAX) continue;
        st.seats.push({ by: b.by, name: b.name, v: !!b.v, bot: 0 });
      }
    } else return;
    return this.update();
  }

  async webSocketClose(ws) { await this.left(ws); }
  async webSocketError(ws) { await this.left(ws); }
  async left(ws) {
    try { ws.close(1000, "bye"); } catch {}
    if (!this.st) return;
    this.st.tm.toKey = null;                    // Bedenkzeit neu berechnen (abwesend = kurz)
    if (this.st.phase !== "play") this.st.tm.prune = Date.now() + SF_PRUNE_MS;
    await this.update(ws);
  }

  // Nach jeder Änderung: Spielende prüfen, Zeitgeber planen, speichern, an alle senden
  async update(except) {
    const st = this.st; if (!st) return;
    if (st.phase === "play" && st.g && st.g.winner >= 0) await this.finish();
    const now = Date.now(), on = this.onlineBys(except), tm = st.tm || (st.tm = {});
    // Spielleitung weitergeben, wenn sie weg ist
    if (!on.has(st.host)) { const h = st.seats.find(x => !x.bot && on.has(x.by)); if (h) st.host = h.by; }
    tm.bot = 0; tm.to = 0;
    if (st.phase === "play") {
      const g = st.g, humansOn = st.seats.some(x => !x.bot && on.has(x.by));
      if (humansOn) {
        const turnKey = g.moves + ":" + g.turn + ":" + (g.drawn || 0) + ":" + g.pend, who = st.seats[g.turn];
        if (who.bot) { if (tm.botKey !== turnKey) { tm.botKey = turnKey; tm.botAt = now + (g.drawn != null ? 650 : 900 + Math.random() * 700); } tm.bot = tm.botAt; }
        else { if (tm.toKey !== turnKey) { tm.toKey = turnKey; tm.toAt = now + (on.has(who.by) ? SF_TURN_MS : SF_AWAY_MS); } tm.to = tm.toAt; }
      }
      const cw = g.catchWin, ck = cw ? cw.seat + ":" + cw.until : "";
      if (ck !== tm.catchKey) {
        tm.catchKey = ck; tm.exp = cw ? cw.until + 450 : 0;
        tm.catches = cw ? st.seats.map((x, i) => { if (!x.bot || i === cw.seat) return null; const c = SFCore.botCatch(g, i, x.bot); return c ? { seat: i, t: now + c.delay } : null; }).filter(Boolean) : [];
      }
    } else { tm.exp = 0; tm.catches = []; }
    if (!on.size) tm.clean = tm.clean || now + SF_IDLE_MS;
    await this.ctx.storage.put("st", st);
    const due = [tm.bot, tm.to, tm.exp, tm.prune, tm.clean, ...(tm.catches || []).map(c => c.t)].filter(t => t > 0);
    if (due.length) await this.ctx.storage.setAlarm(Math.max(now + 50, Math.min(...due))); else await this.ctx.storage.deleteAlarm();
    this.broadcast(on, except);
  }

  broadcast(on, except) {
    const st = this.st, tm = st.tm;
    const seats = st.seats.map(x => ({ name: x.name, bot: x.bot, v: x.v, on: x.bot ? true : on.has(x.by), host: x.by === st.host, wins: st.wins[x.by] || 0 }));
    for (const w of this.socks(except)) {
      const a = this.att(w); if (!a) continue;
      const me = this.seatOf(a.by);
      const msg = { t: "st", code: st.code, phase: st.phase, me, isHost: a.by === st.host, seats, opts: st.opts, round: st.round,
        view: st.g ? SFCore.viewFor(st.g, me) : null, res: st.res, deadline: tm.to || 0, turnMs: SF_TURN_MS, now: Date.now() };
      try { w.send(JSON.stringify(msg)); } catch {}
    }
  }

  async alarm() {
    const st = this.st; if (!st) return;
    const now = Date.now(), tm = st.tm || {};
    if (tm.clean && now >= tm.clean && !this.socks().length) { await this.ctx.storage.deleteAll(); this.st = null; return; }
    if (tm.prune && now >= tm.prune) {              // im Warteraum: wer weg ist, macht den Platz frei
      tm.prune = 0;
      if (st.phase !== "play") { const on = this.onlineBys(); st.seats = st.seats.filter(x => x.bot ? st.seats.some(y => !y.bot && on.has(y.by)) : on.has(x.by)); }
    }
    if (st.phase === "play" && st.g) {
      let g = st.g;
      if (tm.exp && now >= tm.exp) { g = SFCore.tick(g, now) || g; tm.exp = 0; }
      for (const c of (tm.catches || []).filter(c => now >= c.t)) { const g2 = SFCore.act(g, c.seat, "catch", null, now); if (g2) g = g2; }
      tm.catches = (tm.catches || []).filter(c => now < c.t && g.catchWin);
      const who = st.seats[g.turn];
      if (tm.bot && now >= tm.bot && who.bot && g.winner < 0) {
        const mv = SFCore.botMove(g, g.turn, who.bot);
        g = SFCore.act(g, g.turn, mv.type, mv.arg, now) || SFCore.act(g, g.turn, g.drawn != null ? "pass" : "draw", null, now) || g;
      } else if (tm.to && now >= tm.to && !who.bot && g.winner < 0) {
        // Zeit abgelaufen: ziehen bzw. die gezogene Karte behalten
        const seat = g.turn;
        g = SFCore.act(g, seat, g.drawn != null ? "pass" : "draw", null, now) || g;
        if (g.turn === seat && g.drawn != null) g = SFCore.act(g, seat, "pass", null, now) || g;
        g.last = { ...g.last, timeout: true };
      }
      st.g = g;
    }
    await this.update();
  }

  async finish() {
    const st = this.st, g = st.g, w = g.winner;
    st.phase = "end"; st.tm = { clean: st.tm.clean || 0 };
    const left = g.hands.map(h => h.length), pts = Math.min(999, left.reduce((a, b) => a + b, 0));
    const winBy = st.seats[w] && st.seats[w].by; if (winBy) st.wins[winBy] = (st.wins[winBy] || 0) + 1;
    st.res = { winner: w, left, pts };
    const store = this.env.STORE.get(this.env.STORE.idFromName("main"));
    const sec = Math.round((Date.now() - st.started) / 1000);
    try { await store.stat({ game: "sf", id: st.gid + ":1", sec }, "sf:" + st.code); } catch {}
    // Bestenliste: nur Partien mit mindestens zwei Menschen; Bots zählen nie
    const humans = st.seats.map((x, i) => ({ x, i })).filter(o => !o.x.bot);
    if (humans.length >= 2) {
      const vu = {}; humans.forEach(o => { if (o.x.v && o.x.by.startsWith("tw_")) vu[o.x.by] = o.x.name; });
      const players = humans.map(o => ({ name: o.x.name, b: o.x.by, pts: o.i === w ? pts : 0, win: o.i === w }));
      try { await store.report({ game: "sf", gid: st.gid, players }, "sf:" + st.code, vu); } catch {}
    }
  }
}

// ---------------------------------------------------------------------------
// Store: dauerhafte Daten (eigene Karten für 20 Questions, Vorschläge, Bestenliste)
// ---------------------------------------------------------------------------
const CATS = ["Person", "Ort", "Ding"];
const GAMES = ["kb", "zw", "c4", "dots", "memo", "dung", "sf"];   // Spiele mit Siegen (Mensch gegen Mensch)
// Solo-Rekorde: plausible Wertebereiche, "lower" = kleiner ist besser (Zeit)
const RECORDS = {
  stack: { min: 1, max: 400 },             // Turmhöhe in Blöcken
  pong: { min: 1, max: 5000 },             // Squash-Treffer
  memo: { min: 5, max: 3600, lower: true, dec: 1 },   // Sekunden inkl. Strafzeit
  dung: { min: 1, max: 400 },              // Gold + übrige HP, nur wenn überlebt
};
// Obergrenzen pro gemeldeter Runde: offene/vergessene Tabs zählen nicht als Stunden
const STAT_GAMES = {
  kb: { sec: 15 * 60, balls: 20, shakes: 12 },   // eine Kugelblitz-Karte (bis 4 Spieler × 5 Kugeln / 3 Joker)
  zw: { sec: 30 * 60 },                           // eine 20-Questions-Karte
  ne: { sec: 15 * 60 },                           // eine Nur-Einer-Karte
  // Mini-Spiele: eine Partie, nur Spielzeit
  stack: { sec: 20 * 60 }, pong: { sec: 20 * 60 }, c4: { sec: 20 * 60 }, dots: { sec: 20 * 60 },
  memo: { sec: 20 * 60 }, dung: { sec: 30 * 60 }, sf: { sec: 30 * 60 },
};
const clean = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const GENERIC_NAME = /^(spieler|person) ?\d+$/i;

function validCard(c) {
  if (!c || typeof c !== "object") return { error: "Keine Karte übergeben." };
  const answer = clean(c.answer, 60);
  const category = CATS.includes(c.category) ? c.category : null;
  const level = c.level === 2 ? 2 : 1;
  const aliases = (Array.isArray(c.aliases) ? c.aliases : String(c.aliases || "").split(","))
    .map(a => clean(a, 60)).filter(Boolean).slice(0, 10);
  const hints = (Array.isArray(c.hints) ? c.hints : []).map(h => clean(h, 200)).filter(h => h.length >= 3);
  const author = clean(c.author != null ? c.author : c.by, 30);
  if (answer.length < 2) return { error: "Bitte einen Begriff eintragen." };
  if (!category) return { error: "Bitte Person, Ort oder Ding wählen." };
  if (hints.length < 12) return { error: "Es braucht mindestens 12 Hinweise (jetzt: " + hints.length + ")." };
  if (hints.length > 20) return { error: "Höchstens 20 Hinweise." };
  return { card: { answer, category, level, aliases, hints, author } };
}

export class Store extends DurableObject {
  async limited(key, max) {
    const hour = new Date().toISOString().slice(0, 13);
    const k = "rl:" + key + ":" + hour;
    const n = (await this.ctx.storage.get(k)) || 0;
    if (n >= max) return true;
    await this.ctx.storage.put(k, n + 1);
    return false;
  }
  async cards(all) {
    const m = await this.ctx.storage.list({ prefix: "card:" });
    const out = [...m.values()];
    const withAuthor = c => ({ ...c, author: c.author || c.by || "", authorVerified: !!c.authorTw });
    return all ? out.map(withAuthor) : out.filter(c => c.status === "ok").map(withAuthor)
      .map(({ id, answer, category, level, aliases, hints, author, authorVerified }) => ({ id, answer, category, level, aliases, hints, author, authorVerified }));
  }
  async suggest(input, ip, user) {
    if (await this.limited("sg:" + (user ? "tw" + user.id : ip), 8)) return { error: "Zu viele Vorschläge in kurzer Zeit. Versuch es später noch mal." };
    const v = validCard(input);
    if (v.error) return v;
    const id = crypto.randomUUID().slice(0, 8);
    const card = { ...v.card, id, status: "pending", at: Date.now() };
    if (user) { card.author = user.name; card.authorTw = user.id; }
    await this.ctx.storage.put("card:" + id, card);
    return { ok: true, id };
  }
  async save(input) {
    const v = validCard(input);
    if (v.error) return v;
    const id = /^[a-z0-9-]{4,40}$/.test(input.id || "") ? input.id : crypto.randomUUID().slice(0, 8);
    const old = (await this.ctx.storage.get("card:" + id)) || {};
    const status = ["ok", "pending", "off"].includes(input.status) ? input.status : "ok";
    const author = v.card.author || old.author || old.by || "";
    const card = { ...old, ...v.card, author, id, status, at: old.at || Date.now(), edited: Date.now() };
    delete card.by;
    // Twitch-Bestätigung bleibt nur, solange der Name nicht geändert wurde
    if (old.authorTw && author !== old.author) delete card.authorTw;
    await this.ctx.storage.put("card:" + id, card);
    return { ok: true, card };
  }
  async remove(id) {
    await this.ctx.storage.delete("card:" + String(id).slice(0, 40));
    return { ok: true };
  }
  async report(input, ip, vu) {
    vu = vu || {};
    if (!input || !GAMES.includes(input.game)) return { error: "Unbekanntes Spiel." };
    const gid = clean(input.gid, 40);
    if (gid.length < 6) return { error: "Spiel-ID fehlt." };
    if (await this.ctx.storage.get("gid:" + gid)) return { ok: true, dup: true };
    if (await this.limited("sc:" + ip, 40)) return { error: "Zu viele Meldungen." };
    const rows = (Array.isArray(input.players) ? input.players : []).slice(0, 6)
      .map(p => {
        const b = typeof (p && p.b) === "string" ? p.b : "";
        const vname = b.startsWith("tw_") && vu[b] ? vu[b] : "";
        return { name: vname || clean(p && p.name, 30), tw: vname ? b.slice(3) : "", pts: Math.max(0, Math.min(999, Math.round(+p.pts || 0))), win: !!(p && p.win) };
      })
      .filter(p => p.tw || (p.name.length >= 2 && !GENERIC_NAME.test(p.name)));
    await this.ctx.storage.put("gid:" + gid, Date.now());
    if (!rows.length) return { ok: true, counted: 0 };
    const month = new Date().toISOString().slice(0, 7);
    const key = "sc:" + input.game + ":" + month;
    const board = (await this.ctx.storage.get(key)) || {};
    const verifiedNames = new Set(Object.values(board).filter(e => e.v).map(e => e.name.toLowerCase()).concat(rows.filter(r => r.tw).map(r => r.name.toLowerCase())));
    for (const r of rows) {
      let k, name = r.name;
      if (r.tw) k = "tw:" + r.tw;
      else {
        // Ohne Login darf niemand unter dem Namen einer verifizierten Person auftauchen
        if (verifiedNames.has(name.toLowerCase())) name = name.slice(0, 22) + " (Gast)";
        k = name.toLowerCase();
      }
      const e = board[k] || { name, w: 0, g: 0, p: 0 };
      e.name = name; e.v = !!r.tw; e.g += 1; e.p += r.pts; if (r.win) e.w += 1;
      board[k] = e;
    }
    await this.ctx.storage.put(key, board);
    return { ok: true, counted: rows.length };
  }
  // ---- Fun Metrics: eine Meldung pro abgeschlossener Runde/Karte --------------------
  // Datenmodell (alles in diesem Durable Object, kein Extra-Speicher):
  //   "st:YYYY-MM" und "st:all" -> { sec, rounds, zw, ne, balls, shakes }  (Zähler, nur hochgezählt)
  //   "st:seen"                 -> die letzten 3000 Runden-IDs (doppelte Meldungen ignorieren)
  // Pro Meldung: 1 Lesezugriff + 1 Schreibzugriff (Batch über alle drei Schlüssel).
  async stat(input, ip) {
    if (!input || typeof input !== "object") return { error: "Ungültig." };
    const game = STAT_GAMES[input.game] ? input.game : null;
    if (!game) return { error: "Unbekanntes Spiel." };
    const id = String(input.id || "");
    if (!/^[a-z0-9]{6,24}:\d{1,3}$/.test(id)) return { error: "Runden-ID fehlt." };
    if (await this.limited("st:" + ip, 150)) return { error: "Zu viele Meldungen." };
    const month = new Date().toISOString().slice(0, 7), mk = "st:" + month;
    const got = await this.ctx.storage.get([mk, "st:all", "st:seen"]);
    const seen = got.get("st:seen") || [];
    if (seen.includes(id)) return { ok: true, dup: true };
    seen.push(id); if (seen.length > 3000) seen.splice(0, seen.length - 3000);
    const lim = STAT_GAMES[game], n = (v, max) => Math.max(0, Math.min(max, Math.round(+v || 0)));
    const add = { sec: n(input.sec, lim.sec), rounds: 1 };
    if (game === "kb") { add.balls = n(input.balls, lim.balls); add.shakes = n(input.shakes, lim.shakes); }
    else if (game === "zw" || game === "ne") add[game] = input.cards ? 1 : 0;
    const bump = o => { o = o || {}; for (const k in add) o[k] = (o[k] || 0) + add[k]; return o; };
    await this.ctx.storage.put({ [mk]: bump(got.get(mk)), "st:all": bump(got.get("st:all")), "st:seen": seen });
    return { ok: true };
  }
  async stats(month) {
    const got = await this.ctx.storage.get(["st:" + month, "st:all"]);
    const z = o => ({ sec: 0, rounds: 0, zw: 0, ne: 0, balls: 0, shakes: 0, ...(o || {}) });
    return { month, m: z(got.get("st:" + month)), all: z(got.get("st:all")) };
  }
  // ---- Solo-Rekorde: pro Spiel und Monat der beste Wert je Person -------------------
  async record(input, ip, user) {
    const R = input && RECORDS[input.game]; if (!R) return { error: "Unbekanntes Spiel." };
    let v = +input.value; if (!Number.isFinite(v)) return { error: "Kein Wert." };
    v = R.dec ? Math.round(v * 10) / 10 : Math.round(v);
    if (v < R.min || v > R.max) return { error: "Unplausibler Wert." };
    if (await this.limited("rc:" + ip, 60)) return { error: "Zu viele Meldungen." };
    let name = user ? clean(user.name, 30) : clean(input.name, 30);
    if (!user && (name.length < 2 || GENERIC_NAME.test(name))) return { ok: true, counted: 0 };
    const month = new Date().toISOString().slice(0, 7), key = "rec:" + input.game + ":" + month;
    const board = (await this.ctx.storage.get(key)) || {};
    if (!user && Object.values(board).some(e => e.v && e.name.toLowerCase() === name.toLowerCase())) name = name.slice(0, 22) + " (Gast)";
    const k = user ? "tw:" + user.id : name.toLowerCase();
    const old = board[k], better = !old || (R.lower ? v < old.s : v > old.s);
    if (better) { board[k] = { name, v: !!user, s: v, at: Date.now() }; await this.ctx.storage.put(key, board); }
    return { ok: true, best: better };
  }
  async records(month, game) {
    const R = RECORDS[game], b = (await this.ctx.storage.get("rec:" + game + ":" + month)) || {};
    return Object.values(b).sort((x, y) => R.lower ? x.s - y.s || x.at - y.at : y.s - x.s || x.at - y.at).slice(0, 30).map(e => ({ name: e.name, v: e.v, s: e.s, at: e.at }));
  }
  // ---- Mondwort (Wort des Tages) --------------------------------------------------------
  // "wa:<datum>"           Lösung des Tages (einmal festgelegt, ändert sich danach nie mehr)
  // "wd:<datum>:<spieler>" Versuche einer Person an einem Tag {g:[wörter], done, won, t0, t1}
  // "ws:<spieler>"         Statistik {played, wins, cur, best, last, dist[6]}
  // "wb:<datum>"           Tages-Bestenliste, "wm:<JJJJ-MM>" Monats-Bestenliste
  async mwAnswer(date, pick) {
    let a = await this.ctx.storage.get("wa:" + date);
    if (!a) { a = pick; await this.ctx.storage.put("wa:" + date, a); }
    return a;
  }
  async mwPlay(p) {
    const k = "wd:" + p.date + ":" + p.key;
    const got = await this.ctx.storage.get([k, "ws:" + p.key]);
    const s = got.get(k) || { g: [], done: false, won: false, t0: 0, t1: 0 };
    let st = got.get("ws:" + p.key) || { played: 0, wins: 0, cur: 0, best: 0, last: 0, dist: [0, 0, 0, 0, 0, 0] };
    let counted = null;
    if (p.guess && !s.done) {
      if (await this.limited("wg:" + p.ip, 300)) return { error: "Ganz schön viele Versuche – probier es gleich noch mal." };
      if (!s.t0) s.t0 = Date.now();
      s.g.push(p.guess);
      if (p.guess === p.answer) { s.done = true; s.won = true; } else if (s.g.length >= 6) s.done = true;
      const put = { [k]: s };
      if (s.done) {
        s.t1 = Date.now();
        st.played++;
        if (s.won) { st.wins++; st.dist[s.g.length - 1]++; st.cur = st.last === p.nr - 1 ? st.cur + 1 : 1; st.best = Math.max(st.best, st.cur); }
        else st.cur = 0;
        st.last = p.nr; put["ws:" + p.key] = st;
        counted = await this.mwBoards(p, s, st);
      }
      await this.ctx.storage.put(put);
    }
    const shown = { ...st, cur: st.last >= p.nr - 1 ? st.cur : 0 };
    return { s, st: shown, counted };
  }
  async mwBoards(p, s, st) {
    let name = p.name;
    if (!p.v && (name.length < 2 || GENERIC_NAME.test(name))) return false;
    const dk = "wb:" + p.date, mk = "wm:" + p.date.slice(0, 7);
    const got = await this.ctx.storage.get([dk, mk]);
    const day = got.get(dk) || {}, mon = got.get(mk) || {};
    if (!p.v && Object.values(day).concat(Object.values(mon)).some(e => e.v && e.name.toLowerCase() === name.toLowerCase())) name = name.slice(0, 22) + " (Gast)";
    const bk = p.v ? "tw:" + p.key.slice(3) : name.toLowerCase();
    if (day[bk]) return false;                 // derselbe Name hat heute schon ein Ergebnis (z. B. zweites Gerät ohne Login)
    const n = s.g.length;
    day[bk] = { name, v: p.v, n, won: s.won, ms: Math.max(0, s.t1 - s.t0), at: s.t1 };
    const m = mon[bk] || { name, v: p.v, p: 0, won: 0, played: 0, tries: 0, cur: 0, best: 0 };
    m.name = name; m.played++; if (s.won) { m.won++; m.tries += n; m.p += 7 - n; }
    m.cur = st.cur; m.best = Math.max(m.best, st.best); m.last = p.nr;
    mon[bk] = m;
    await this.ctx.storage.put({ [dk]: day, [mk]: mon });
    return true;
  }
  async mwBoard(kind, key, nr) {
    const b = (await this.ctx.storage.get(kind + key)) || {};
    const rows = Object.values(b);
    if (kind === "wb:") return rows.sort((x, y) => (y.won - x.won) || (x.n - y.n) || (x.ms - y.ms) || (x.at - y.at)).slice(0, 50)
      .map(e => ({ name: e.name, v: e.v, n: e.n, won: e.won, ms: e.ms }));
    return rows.sort((x, y) => (y.p - x.p) || (y.won - x.won) || ((x.tries / (x.won || 1)) - (y.tries / (y.won || 1)))).slice(0, 50)
      .map(e => ({ name: e.name, v: e.v, p: e.p, won: e.won, played: e.played, avg: e.won ? Math.round(e.tries / e.won * 10) / 10 : null, cur: e.last >= nr - 1 ? e.cur : 0, best: e.best }));
  }
  async scores(month, game) {
    const games = game === "all" ? GAMES : [game];
    const merged = {};
    for (const g of games) {
      const b = (await this.ctx.storage.get("sc:" + g + ":" + month)) || {};
      for (const [k, e] of Object.entries(b)) {
        const m = merged[k] || { name: e.name, v: !!e.v, w: 0, g: 0, p: 0, gm: {} };
        m.w += e.w; m.g += e.g; m.p += e.p; m.gm[g] = (m.gm[g] || 0) + e.g; merged[k] = m;   // gm: Partien je Spiel ("meistgespielt")
      }
    }
    return Object.values(merged).sort((a, b) => b.w - a.w || b.p - a.p || a.g - b.g).slice(0, 50);
  }
}

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
function sameKey(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
// ---------------------------------------------------------------------------
// Offene Spielersuche: alle wartenden Räume als schlanke Liste
// Die Startseite fragt alle 15 s nach. Damit das auf dem Gratis-Plan nicht mit jedem
// Besucher teurer wird, wird die Liste 10 s zwischengespeichert (im Worker-Speicher und
// im Cloudflare-Cache) – egal wie viele zuschauen, kostet das höchstens 4 Abfragen / 10 s.
// ---------------------------------------------------------------------------
const LOBBIES = [
  { room: "lobby", game: "kugelblitz", max: 4, wait: ["lobby"] },
  { room: "lobby-zw", game: "zwanzig", max: 6, wait: ["lobby"] },
  { room: "lobby-ne", game: "nureiner", max: 8, wait: ["lobby"] },
  { room: "lobby-ar", game: null, max: 2, wait: ["wait"] },
];
const AR_PAGES = { c4: "viergewinnt", dots: "kaesekaestchen", memo: "memory", dung: "dungeon", sf: "letztekarte" };
const AR_MAX = { sf: 6 };   // Spiele in lobby-ar mit mehr als zwei Plätzen
let lobbyMemo = { t: 0, body: null };
async function lobbies(env, ctx) {
  const now = Date.now();
  if (lobbyMemo.body && now - lobbyMemo.t < 10000) return lobbyMemo.body;
  const key = new Request("https://lobby-cache.internal/api/lobbys");
  try { const hit = await caches.default.match(key); if (hit) { const body = await hit.text(); lobbyMemo = { t: now, body }; return body; } } catch {}
  const lists = await Promise.all(LOBBIES.map(async L => {
    try { return { L, games: await env.ROOMS.get(env.ROOMS.idFromName(L.room)).openGames() }; } catch { return { L, games: [] }; }
  }));
  const open = [];
  for (const { L, games } of lists) for (const g of games) {
    if (!L.wait.includes(g.ph)) continue;                 // nur Räume, die noch auf Leute warten
    const gameId = L.game || AR_PAGES[g.game]; if (!gameId) continue;
    const max = (!L.game && AR_MAX[g.game]) || L.max;
    if (g.n >= max) continue;
    open.push({ gameId, roomCode: g.code, currentPlayers: Math.max(1, g.n), maxPlayers: max, host: g.host, verified: g.v });
  }
  const body = JSON.stringify({ t: now, open });
  lobbyMemo = { t: now, body };
  try { ctx && ctx.waitUntil && ctx.waitUntil(caches.default.put(key, new Response(body, { headers: { "content-type": "application/json", "cache-control": "max-age=10" } }))); } catch {}
  return body;
}

// ---------------------------------------------------------------------------
// Feedback-Formular -> privater Discord-Kanal (Webhook)
// Die Webhook-URL liegt als Geheimnis FEEDBACK_WEBHOOK bei Cloudflare und
// erscheint nirgends im Quellcode oder im Browser.
// ---------------------------------------------------------------------------
const FB_TYPES = { bug: ["🐞 Bug", 0xFF8FA3], idee: ["💡 Idee", 0xFDD5BB], sonstiges: ["💬 Sonstiges", 0xB9A6E8] };
const cleanText = (v, max) => String(v == null ? "" : v).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
  .replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
async function feedback(request, env, url, store, ip) {
  // nur von der eigenen Seite (schützt vor Formular-Spam über fremde Seiten)
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return json({ error: "Nicht erlaubt." }, 403);
  if (+(request.headers.get("content-length") || 0) > 12000) return json({ error: "Die Nachricht ist zu lang." }, 413);
  const hook = env.FEEDBACK_WEBHOOK || "";
  // erlaubt: Discord-Webhooks; http://localhost nur für lokale Tests mit "wrangler dev"
  if (!/^https:\/\/(discord\.com|discordapp\.com|canary\.discord\.com|ptb\.discord\.com)\/api\/webhooks\//.test(hook) &&
      !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(hook))
    return json({ error: "Das Feedback-Formular ist noch nicht eingerichtet." }, 503);
  let b; try { b = await request.json(); } catch { b = null; }
  if (!b || typeof b !== "object") return json({ error: "Ungültige Anfrage." }, 400);
  // Bots: Honigtopf-Feld ausgefüllt oder in unter 2,5 s abgeschickt -> freundlich so tun, als ob
  if (b.website || (typeof b.dt === "number" && b.dt < 2500)) return json({ ok: true });
  const type = FB_TYPES[b.type] ? b.type : "sonstiges";
  const name = clean(b.name, 40), email = clean(b.email, 120), msg = cleanText(b.msg, 2000);
  const page = clean(b.page, 120) || "/", theme = clean(b.theme, 12), ua = clean(b.ua, 200);
  if (!name) return json({ error: "Bitte gib einen Namen oder Nick an." }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: "Die E-Mail sieht nicht ganz richtig aus." }, 400);
  if (msg.length < 5) return json({ error: "Schreib bitte ein paar Worte mehr." }, 400);
  if (await store.limited("fb:" + ip, 5)) return json({ error: "Du hast in der letzten Stunde schon einiges geschickt – danke! Versuch es später noch mal." }, 429);
  if (await store.limited("fb:all", 60)) return json({ error: "Gerade kommt sehr viel Feedback an. Versuch es bitte später noch mal." }, 429);
  const user = await readSession(request, env);
  const [title, color] = FB_TYPES[type];
  const fields = [
    { name: "Von", value: name + (user ? "  ·  ✓ twitch.tv/" + user.login : ""), inline: true },
    { name: "Seite", value: page, inline: true },
  ];
  if (email) fields.push({ name: "E-Mail", value: email, inline: false });
  const payload = {
    username: "Spielezimmer-Feedback",
    allowed_mentions: { parse: [] },          // kein @everyone / @here aus Nutzertext
    embeds: [{ title, description: msg, color, fields, timestamp: new Date().toISOString(),
               footer: { text: (theme ? "Theme: " + theme + " · " : "") + ua.slice(0, 120) } }],
  };
  try {
    const r = await fetch(hook + (hook.includes("?") ? "&" : "?") + "wait=true", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    });
    if (!r.ok) return json({ error: "Konnte gerade nicht zugestellt werden. Versuch es gleich noch mal." }, 502);
  } catch { return json({ error: "Konnte gerade nicht zugestellt werden. Versuch es gleich noch mal." }, 502); }
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// Mondwort – deutsches Wort des Tages (neues Wort um 0:00 Uhr deutscher Zeit)
// Die Lösung kennt nur der Server: Der Browser schickt einen Versuch und bekommt die
// Farben zurück, das Wort selbst erst, wenn die Runde vorbei ist.
// Die Reihenfolge der Wörter würfelt das Geheimnis MONDWORT_SECRET (Cloudflare,
// Typ "Geheimnis"). Ohne Geheimnis läuft es auch, dann wäre die Reihenfolge aber aus
// dem öffentlichen Code berechenbar.
// ---------------------------------------------------------------------------
const MW_START = Date.UTC(2026, 9, 24);          // Mondwort Nr. 1 = 24. Oktober 2026
function berlinParts(ts) {
  const o = {};
  for (const x of new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ts)))
    if (x.type !== "literal") o[x.type] = +x.value;
  return o;
}
function mwToday(now) {
  const b = berlinParts(now), mid = Date.UTC(b.year, b.month - 1, b.day);
  const offset = Date.UTC(b.year, b.month - 1, b.day, b.hour, b.minute, b.second) - Math.floor(now / 1000) * 1000;
  const date = new Date(mid).toISOString().slice(0, 10);
  return { date, nr: Math.round((mid - MW_START) / 864e5) + 1, next: Math.max(1000, mid + 864e5 - offset - now) };
}
let mwPerm = null, mwPermKey = null;
function mwPick(env, nr) {
  const secret = env.MONDWORT_SECRET || "lunacynas-spielezimmer";
  if (mwPermKey !== secret) {
    let h = 2166136261; for (let i = 0; i < secret.length; i++) h = Math.imul(h ^ secret.charCodeAt(i), 16777619);
    let a = h >>> 0; const rnd = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    mwPerm = SOLUTIONS.map((_, i) => i); for (let i = mwPerm.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [mwPerm[i], mwPerm[j]] = [mwPerm[j], mwPerm[i]]; }
    mwPermKey = secret;
  }
  const L = SOLUTIONS.length;
  return SOLUTIONS[mwPerm[(((nr - 1) % L) + L) % L]];
}
function mwPattern(guess, answer) {             // 2 = richtige Stelle, 1 = kommt vor, 0 = nicht drin
  const g = [...guess], a = [...answer], res = [0, 0, 0, 0, 0], left = {};
  for (let i = 0; i < 5; i++) { if (g[i] === a[i]) res[i] = 2; else left[a[i]] = (left[a[i]] || 0) + 1; }
  for (let i = 0; i < 5; i++) if (res[i] !== 2 && left[g[i]]) { res[i] = 1; left[g[i]]--; }
  return res;
}
async function mondwort(request, env, url, store, ip) {
  const now = Date.now(), T = mwToday(now);
  if (url.pathname === "/api/wort/board") {
    const m = url.searchParams.get("m");
    if (/^\d{4}-\d{2}$/.test(m || "")) return json({ kind: "month", month: m, rows: await store.mwBoard("wm:", m, T.nr) });
    const d = url.searchParams.get("d"), date = /^\d{4}-\d{2}-\d{2}$/.test(d || "") ? d : T.date;
    return json({ kind: "day", date, rows: await store.mwBoard("wb:", date, T.nr) });
  }
  let b = {};
  if (request.method === "POST") {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return json({ error: "Nicht erlaubt." }, 403);
    try { b = (await request.json()) || {}; } catch { b = {}; }
  } else b = { u: url.searchParams.get("u") || "" };
  const user = await readSession(request, env);
  let key, name, v = false;
  if (user) { key = "tw_" + user.id; name = clean(user.name, 30); v = true; }
  else if (/^u_[a-z0-9]{10}$/.test(b.u || "")) { key = b.u; name = clean(b.name, 24); }
  else return json({ error: "Spieler-ID fehlt." }, 400);
  let guess = null;
  if (b.guess != null) {
    guess = String(b.guess).toLowerCase().normalize("NFC").trim();
    if (!/^[a-zäöü]{5}$/.test(guess)) return json({ error: "Bitte ein Wort mit genau fünf Buchstaben." }, 400);
    if (!ALLOWED.has(guess)) return json({ error: "Das Wort kennt Mondwort nicht.", unknown: true }, 400);
    if (b.nr && b.nr !== T.nr) return json({ error: "Inzwischen gibt es ein neues Wort – die Seite lädt neu.", reload: true }, 409);
  }
  const answer = await store.mwAnswer(T.date, mwPick(env, T.nr));
  const r = await store.mwPlay({ key, name, v, date: T.date, nr: T.nr, answer, guess, ip });
  if (r.error) return json(r, 429);
  const s = r.s;
  return json({ nr: T.nr, date: T.date, next: T.next, name, v,
    guesses: s.g.map(w => ({ w, p: mwPattern(w, answer) })), done: s.done, won: s.won,
    answer: s.done ? answer : undefined, ms: s.done ? s.t1 - s.t0 : undefined, stats: r.st, counted: r.counted });
}

async function api(request, env, url, ctx) {
  const store = env.STORE.get(env.STORE.idFromName("main"));
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const path = url.pathname, method = request.method;
  const body = async () => { try { return await request.json(); } catch { return null; } };

  if (path === "/api/lobbys" && method === "GET") return new Response(await lobbies(env, ctx), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=5" } });
  if (path === "/api/sf/status") return json({ tables: !!env.TABLES });
  if (path === "/api/wort" || path === "/api/wort/board") return mondwort(request, env, url, store, ip);
  if (path === "/api/feedback" && method === "POST") return feedback(request, env, url, store, ip);
  if (path === "/api/cards" && method === "GET") return json(await store.cards(false));
  if (path === "/api/cards/suggest" && method === "POST") { const r = await store.suggest(await body(), ip, await readSession(request, env)); return json(r, r.error ? 400 : 200); }
  if (path === "/api/scores" && method === "POST") {
    const input = await body();
    if (input && input.game === "sf") return json({ error: "Letzte Karte! meldet der Spieltisch selbst." }, 400);
    let vu = {};
    const room = input && typeof input.room === "string" ? input.room : "";
    const arcade = ["c4", "dots", "memo", "dung"].includes(input && input.game);
    if ((/^(kb|zw)-[a-z0-9]{4}$/.test(room) && input.game === room.slice(0, 2)) || (arcade && /^ar-[a-z0-9]{4}$/.test(room))) {
      try { vu = await env.ROOMS.get(env.ROOMS.idFromName("g-" + room)).verifiedUsers(); } catch {}
    }
    const r = await store.report(input, ip, vu); return json(r, r.error ? 400 : 200);
  }
  if (path === "/api/stats" && method === "POST") {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return json({ error: "Nicht erlaubt." }, 403);
    const r = await store.stat(await body(), ip); return json(r, r.error ? 400 : 200);
  }
  if (path === "/api/stats" && method === "GET") {
    const month = /^\d{4}-\d{2}$/.test(url.searchParams.get("month") || "") ? url.searchParams.get("month") : new Date().toISOString().slice(0, 7);
    return json(await store.stats(month));
  }
  if (path === "/api/records" && method === "POST") {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return json({ error: "Nicht erlaubt." }, 403);
    const r = await store.record(await body(), ip, await readSession(request, env)); return json(r, r.error ? 400 : 200);
  }
  if (path === "/api/records" && method === "GET") {
    const month = /^\d{4}-\d{2}$/.test(url.searchParams.get("month") || "") ? url.searchParams.get("month") : new Date().toISOString().slice(0, 7);
    const game = RECORDS[url.searchParams.get("game")] ? url.searchParams.get("game") : null;
    if (!game) return json({ error: "Unbekanntes Spiel." }, 400);
    return json(await store.records(month, game));
  }
  if (path === "/api/scores" && method === "GET") {
    const month = /^\d{4}-\d{2}$/.test(url.searchParams.get("month") || "") ? url.searchParams.get("month") : new Date().toISOString().slice(0, 7);
    const game = GAMES.concat("all").includes(url.searchParams.get("game")) ? url.searchParams.get("game") : "all";
    return json(await store.scores(month, game));
  }
  if (path.startsWith("/api/admin/")) {
    if (!env.ADMIN_KEY) return json({ error: "Es ist noch kein Admin-Schlüssel eingerichtet (ADMIN_KEY in Cloudflare)." }, 503);
    if (!sameKey(request.headers.get("x-admin-key") || "", env.ADMIN_KEY)) {
      await new Promise(r => setTimeout(r, 400));
      return json({ error: "Falscher Schlüssel." }, 401);
    }
    if (path === "/api/admin/check") return json({ ok: true });
    if (path === "/api/admin/cards" && method === "GET") return json(await store.cards(true));
    if (path === "/api/admin/cards" && method === "POST") { const r = await store.save(await body()); return json(r, r.error ? 400 : 200); }
    const m = path.match(/^\/api\/admin\/cards\/([a-z0-9-]{4,40})$/);
    if (m && method === "DELETE") return json(await store.remove(m[1]));
  }
  return json({ error: "Nicht gefunden." }, 404);
}

// ---------------------------------------------------------------------------
// Twitch-Login (OAuth 2.0 Authorization Code Flow, nur Scope "openid")
// Benötigte Geheimnisse in Cloudflare: TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, SESSION_SECRET
// Der Browser bekommt nur ein signiertes Cookie mit Twitch-ID und Anzeigename – nie ein Twitch-Token.
// ---------------------------------------------------------------------------
const SESSION_COOKIE = "lz_sess", STATE_COOKIE = "lz_oauth", SESSION_DAYS = 30;
const authEnabled = env => !!(env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET && env.SESSION_SECRET);
const enc = new TextEncoder();
const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uText = t => b64u(enc.encode(t));
const fromB64uText = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)));
async function sign(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
function getCookie(request, name) {
  const m = (request.headers.get("cookie") || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? m[1] : "";
}
const cookie = (name, value, maxAge, path = "/") => `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
async function readSession(request, env) {
  if (!env.SESSION_SECRET) return null;
  const raw = getCookie(request, SESSION_COOKIE);
  const [payload, sig] = raw.split(".");
  if (!payload || !sig || !sameKey(sig, await sign(env.SESSION_SECRET, payload))) return null;
  try {
    const u = JSON.parse(fromB64uText(payload));
    if (!u || !/^\d{1,20}$/.test(u.id) || !(u.exp > Date.now())) return null;
    return { id: u.id, login: u.login, name: u.name };
  } catch { return null; }
}
const safeReturn = r => (typeof r === "string" && /^\/[a-zA-Z0-9/_\-#.]*$/.test(r) && !r.startsWith("//")) ? r : "/";
function page(title, text) {
  return new Response(`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#16123A;color:#EFE9FF;font:16px system-ui,sans-serif;padding:16px">
<div style="max-width:440px"><h1 style="font-size:24px">${title}</h1><p style="color:#A99FCB">${text}</p><p><a href="/" style="color:#FDD5BB">Zurück zum Spielezimmer</a></p></div></body></html>`,
    { status: 400, headers: { "content-type": "text/html; charset=utf-8" } });
}
async function auth(request, env, url) {
  const path = url.pathname;
  const redirectUri = env.TWITCH_REDIRECT_URI || url.origin + "/auth/twitch/callback";
  if (path === "/auth/me") {
    return json({ enabled: authEnabled(env), user: await readSession(request, env) });
  }
  if (path === "/auth/logout") {
    return new Response(null, { status: 302, headers: { location: safeReturn(url.searchParams.get("r")), "set-cookie": cookie(SESSION_COOKIE, "", 0) } });
  }
  if (!authEnabled(env)) return page("Twitch-Login ist nicht eingerichtet", "Im Cloudflare-Dashboard fehlen TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET oder SESSION_SECRET.");
  if (path === "/auth/twitch/login") {
    const state = b64u(crypto.getRandomValues(new Uint8Array(18)));
    const back = safeReturn(url.searchParams.get("r"));
    const q = new URLSearchParams({ response_type: "code", client_id: env.TWITCH_CLIENT_ID, redirect_uri: redirectUri, scope: "openid", state });
    return new Response(null, { status: 302, headers: {
      location: "https://id.twitch.tv/oauth2/authorize?" + q,
      "set-cookie": cookie(STATE_COOKIE, state + "." + b64uText(back), 600, "/auth"),
    } });
  }
  if (path === "/auth/twitch/callback") {
    const [state, backEnc] = getCookie(request, STATE_COOKIE).split(".");
    const back = backEnc ? safeReturn(fromB64uText(backEnc)) : "/";
    if (url.searchParams.get("error")) return page("Login abgebrochen", "Du hast den Twitch-Login abgebrochen. Du kannst trotzdem ohne Login weiterspielen.");
    if (!state || state !== url.searchParams.get("state")) return page("Login fehlgeschlagen", "Die Anmeldung ist abgelaufen oder ungültig. Bitte versuch es noch einmal.");
    const code = url.searchParams.get("code") || "";
    const tr = await fetch("https://id.twitch.tv/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.TWITCH_CLIENT_ID, client_secret: env.TWITCH_CLIENT_SECRET, code, grant_type: "authorization_code", redirect_uri: redirectUri }) });
    if (!tr.ok) return page("Login fehlgeschlagen", "Twitch hat die Anmeldung nicht bestätigt. Stimmt die Redirect-URL in der Twitch-App?");
    const tok = await tr.json();
    const ur = await fetch("https://api.twitch.tv/helix/users", { headers: { authorization: "Bearer " + tok.access_token, "client-id": env.TWITCH_CLIENT_ID } });
    const ud = ur.ok ? await ur.json() : null;
    // Token wird nicht gebraucht und sofort widerrufen
    fetch("https://id.twitch.tv/oauth2/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.TWITCH_CLIENT_ID, token: tok.access_token }) }).catch(() => {});
    const u = ud && ud.data && ud.data[0];
    if (!u) return page("Login fehlgeschlagen", "Twitch hat keine Benutzerdaten geliefert.");
    const payload = b64uText(JSON.stringify({ id: u.id, login: u.login, name: clean(u.display_name || u.login, 30), exp: Date.now() + SESSION_DAYS * 864e5 }));
    const headers = new Headers({ location: back });
    headers.append("set-cookie", cookie(SESSION_COOKIE, payload + "." + await sign(env.SESSION_SECRET, payload), SESSION_DAYS * 86400));
    headers.append("set-cookie", cookie(STATE_COOKIE, "", 0, "/auth"));
    return new Response(null, { status: 302, headers });
  }
  return json({ error: "Nicht gefunden." }, 404);
}

// Vorschaubild für Discord & Co.: Links in den Meta-Tags brauchen eine volle Adresse
class AbsUrl {
  constructor(origin, attr) { this.origin = origin; this.attr = attr; }
  element(el) {
    const v = el.getAttribute(this.attr);
    if (v && v.startsWith("/")) el.setAttribute(this.attr, this.origin + v);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Entfernte Spiele: alte Links landen auf der Startseite statt auf einer toten Seite
    if (/^\/stadtlandfluss(\/|$)|^\/assets\/arcade\/stadtlandfluss\./.test(url.pathname)) return Response.redirect(url.origin + "/", 301);
    // Umbenannt: Sternenfall heißt jetzt "Letzte Karte!" (Einladungslinks mit ?join= bleiben gültig)
    if (/^\/sternenfall(\/|$)/.test(url.pathname)) return Response.redirect(url.origin + "/letztekarte/" + url.search, 301);
    if (url.pathname === "/ws" || url.pathname === "/sf") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }
      const sf = url.pathname === "/sf";
      const room = sf ? url.searchParams.get("t") || "" : url.searchParams.get("room") || "";
      if (!(sf ? SF_RE : ROOM_RE).test(room)) return new Response("bad room", { status: 400 });
      // Twitch-Identität kommt ausschließlich aus dem signierten Cookie, nie vom Browser
      const user = await readSession(request, env);
      const u2 = new URL(request.url);
      const headers = new Headers(request.headers);
      headers.delete("x-verified-name");
      if (user) { u2.searchParams.set("by", "tw_" + user.id); headers.set("x-verified-name", encodeURIComponent(user.name)); }
      else if ((u2.searchParams.get("by") || "").startsWith("tw_")) u2.searchParams.set("by", "u_" + (u2.searchParams.get("by") || "").slice(3, 13));
      const ns = sf ? env.TABLES : env.ROOMS;
      if (!ns) return new Response("Spieltisch-Server fehlt: Binding TABLES (wrangler.jsonc) ist nicht eingerichtet.", { status: 503 });
      return ns.get(ns.idFromName(room)).fetch(new Request(u2.toString(), { headers }));
    }
    if (url.pathname.startsWith("/auth/")) {
      try { return await auth(request, env, url); }
      catch (e) { return page("Login fehlgeschlagen", "Es ist ein unerwarteter Fehler aufgetreten."); }
    }
    if (url.pathname.startsWith("/api/")) {
      try { return await api(request, env, url, ctx); }
      catch (e) { return json({ error: "Serverfehler." }, 500); }
    }
    const res = await env.ASSETS.fetch(request);
    if ((res.headers.get("content-type") || "").includes("text/html")) {
      const page = url.origin + url.pathname;
      return new HTMLRewriter()
        .on('meta[property="og:image"]', new AbsUrl(url.origin, "content"))
        .on('meta[name="twitter:image"]', new AbsUrl(url.origin, "content"))
        .on('meta[property="og:url"]', { element(el) { el.setAttribute("content", page); } })
        .transform(res);
    }
    return res;
  },
};
