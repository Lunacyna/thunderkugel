// Lunacynas Spielezimmer – Cloudflare Worker
// Liefert die Spielseite aus (public/) und betreibt die Online-Räume über Durable Objects.
// Jeder Raum (Lobby oder ein einzelnes Spiel) ist ein eigenes Durable Object.
// Das Objekt verteilt nur "Presence": jeder Teilnehmer hat ein kleines JSON-Objekt,
// das an alle anderen im selben Raum weitergegeben wird. Die Spiellogik läuft im Browser
// des Spielleiters.

import { DurableObject } from "cloudflare:workers";

const ROOM_RE = /^(lobby|lobby-zw|g-(kb|zw)-[a-z0-9]{4})$/;
const ID_RE = /^[a-z0-9_]{4,24}$/;
const MAX_MSG = 12000;     // Bytes pro Nachricht
const MAX_PEERS = 64;      // Verbindungen pro Raum

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.presence = new Map(); // peer -> presence (im Speicher)
  }

  async fetch(request) {
    const url = new URL(request.url);
    const peer = url.searchParams.get("peer") || "";
    const by = url.searchParams.get("by") || "";
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
    server.serializeAttachment({ peer, by, pr: {} });
    this.presence.set(peer, {});

    const peers = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === server) continue;
      const a = this.att(ws);
      if (!a || a.peer === peer) continue;
      peers.push({ peer: a.peer, by: a.by, pr: this.presence.get(a.peer) || a.pr || {} });
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
    this.broadcast({ t: "p", peer: a.peer, by: a.by, pr: m.pr }, ws);
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
// Store: dauerhafte Daten (eigene Zwanzig-Karten, Vorschläge, Bestenliste)
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
  const by = clean(c.by, 30);
  if (answer.length < 2) return { error: "Bitte einen Begriff eintragen." };
  if (!category) return { error: "Bitte Person, Ort oder Ding wählen." };
  if (hints.length < 12) return { error: "Es braucht mindestens 12 Hinweise (jetzt: " + hints.length + ")." };
  if (hints.length > 20) return { error: "Höchstens 20 Hinweise." };
  return { card: { answer, category, level, aliases, hints, by } };
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
    return all ? out : out.filter(c => c.status === "ok").map(({ id, answer, category, level, aliases, hints }) => ({ id, answer, category, level, aliases, hints }));
  }
  async suggest(input, ip) {
    if (await this.limited("sg:" + ip, 8)) return { error: "Zu viele Vorschläge in kurzer Zeit. Versuch es später noch mal." };
    const v = validCard(input);
    if (v.error) return v;
    const id = crypto.randomUUID().slice(0, 8);
    const card = { ...v.card, id, status: "pending", at: Date.now() };
    await this.ctx.storage.put("card:" + id, card);
    return { ok: true, id };
  }
  async save(input) {
    const v = validCard(input);
    if (v.error) return v;
    const id = /^[a-z0-9-]{4,40}$/.test(input.id || "") ? input.id : crypto.randomUUID().slice(0, 8);
    const old = (await this.ctx.storage.get("card:" + id)) || {};
    const status = ["ok", "pending", "off"].includes(input.status) ? input.status : "ok";
    const card = { ...old, ...v.card, by: v.card.by || old.by || "", id, status, at: old.at || Date.now(), edited: Date.now() };
    await this.ctx.storage.put("card:" + id, card);
    return { ok: true, card };
  }
  async remove(id) {
    await this.ctx.storage.delete("card:" + String(id).slice(0, 40));
    return { ok: true };
  }
  async report(input, ip) {
    if (!input || !GAMES.includes(input.game)) return { error: "Unbekanntes Spiel." };
    const gid = clean(input.gid, 40);
    if (gid.length < 6) return { error: "Spiel-ID fehlt." };
    if (await this.ctx.storage.get("gid:" + gid)) return { ok: true, dup: true };
    if (await this.limited("sc:" + ip, 40)) return { error: "Zu viele Meldungen." };
    const rows = (Array.isArray(input.players) ? input.players : []).slice(0, 6)
      .map(p => ({ name: clean(p && p.name, 30), pts: Math.max(0, Math.min(999, Math.round(+p.pts || 0))), win: !!(p && p.win) }))
      .filter(p => p.name.length >= 2 && !GENERIC_NAME.test(p.name));
    await this.ctx.storage.put("gid:" + gid, Date.now());
    if (!rows.length) return { ok: true, counted: 0 };
    const month = new Date().toISOString().slice(0, 7);
    const key = "sc:" + input.game + ":" + month;
    const board = (await this.ctx.storage.get(key)) || {};
    for (const r of rows) {
      const k = r.name.toLowerCase();
      const e = board[k] || { name: r.name, w: 0, g: 0, p: 0 };
      e.name = r.name; e.g += 1; e.p += r.pts; if (r.win) e.w += 1;
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
        const m = merged[k] || { name: e.name, w: 0, g: 0, p: 0 };
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
  if (path === "/api/cards/suggest" && method === "POST") { const r = await store.suggest(await body(), ip); return json(r, r.error ? 400 : 200); }
  if (path === "/api/scores" && method === "POST") { const r = await store.report(await body(), ip); return json(r, r.error ? 400 : 200); }
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
      const stub = env.ROOMS.get(env.ROOMS.idFromName(room));
      return stub.fetch(request);
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
