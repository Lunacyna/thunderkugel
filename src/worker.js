// Kugelblitz – Cloudflare Worker
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
    return env.ASSETS.fetch(request);
  },
};
