// Lunacynas Spielezimmer – Cloudflare Worker
// Liefert die Spielseite aus (public/) und betreibt die Online-Räume über Durable Objects.
// Jeder Raum (Lobby oder ein einzelnes Spiel) ist ein eigenes Durable Object.
// Das Objekt verteilt nur "Presence": jeder Teilnehmer hat ein kleines JSON-Objekt,
// das an alle anderen im selben Raum weitergegeben wird. Die Spiellogik läuft im Browser
// des Spielleiters.

import { DurableObject } from "cloudflare:workers";

const ROOM_RE = /^(lobby|lobby-zw|lobby-ne|g-(kb|zw|ne)-[a-z0-9]{4})$/;
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
// Store: dauerhafte Daten (eigene Karten für 20 Questions, Vorschläge, Bestenliste)
// ---------------------------------------------------------------------------
const CATS = ["Person", "Ort", "Ding"];
const GAMES = ["kb", "zw"];
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
  async scores(month, game) {
    const games = game === "all" ? GAMES : [game];
    const merged = {};
    for (const g of games) {
      const b = (await this.ctx.storage.get("sc:" + g + ":" + month)) || {};
      for (const [k, e] of Object.entries(b)) {
        const m = merged[k] || { name: e.name, v: !!e.v, w: 0, g: 0, p: 0 };
        m.w += e.w; m.g += e.g; m.p += e.p; merged[k] = m;
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
async function api(request, env, url) {
  const store = env.STORE.get(env.STORE.idFromName("main"));
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const path = url.pathname, method = request.method;
  const body = async () => { try { return await request.json(); } catch { return null; } };

  if (path === "/api/cards" && method === "GET") return json(await store.cards(false));
  if (path === "/api/cards/suggest" && method === "POST") { const r = await store.suggest(await body(), ip, await readSession(request, env)); return json(r, r.error ? 400 : 200); }
  if (path === "/api/scores" && method === "POST") {
    const input = await body();
    let vu = {};
    const room = input && typeof input.room === "string" ? input.room : "";
    if (/^(kb|zw)-[a-z0-9]{4}$/.test(room) && input.game === room.slice(0, 2)) {
      try { vu = await env.ROOMS.get(env.ROOMS.idFromName("g-" + room)).verifiedUsers(); } catch {}
    }
    const r = await store.report(input, ip, vu); return json(r, r.error ? 400 : 200);
  }
  if (path === "/api/scores" && method === "GET") {
    const month = /^\d{4}-\d{2}$/.test(url.searchParams.get("month") || "") ? url.searchParams.get("month") : new Date().toISOString().slice(0, 7);
    const game = ["kb", "zw", "all"].includes(url.searchParams.get("game")) ? url.searchParams.get("game") : "all";
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
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }
      const room = url.searchParams.get("room") || "";
      if (!ROOM_RE.test(room)) return new Response("bad room", { status: 400 });
      // Twitch-Identität kommt ausschließlich aus dem signierten Cookie, nie vom Browser
      const user = await readSession(request, env);
      const u2 = new URL(request.url);
      const headers = new Headers(request.headers);
      headers.delete("x-verified-name");
      if (user) { u2.searchParams.set("by", "tw_" + user.id); headers.set("x-verified-name", encodeURIComponent(user.name)); }
      else if ((u2.searchParams.get("by") || "").startsWith("tw_")) u2.searchParams.set("by", "u_" + (u2.searchParams.get("by") || "").slice(3, 13));
      const stub = env.ROOMS.get(env.ROOMS.idFromName(room));
      return stub.fetch(new Request(u2.toString(), { headers }));
    }
    if (url.pathname.startsWith("/auth/")) {
      try { return await auth(request, env, url); }
      catch (e) { return page("Login fehlgeschlagen", "Es ist ein unerwarteter Fehler aufgetreten."); }
    }
    if (url.pathname.startsWith("/api/")) {
      try { return await api(request, env, url); }
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
