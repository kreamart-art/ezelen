/* ------------------------------------------------------------------ */
/*  EZELEN — realtime room server (WebSocket + HTTP polling fallback).   */
/*  Authoritative, in-memory rooms (no database). Per-viewer state so a  */
/*  client only ever receives ITS OWN hand + everyone's counts.          */
/* ------------------------------------------------------------------ */
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { roomEngine } from "./rooms.js";

const PORT = process.env.PORT || 8787;
const ORIGINS = (process.env.EZELEN_ORIGINS || "*").split(",").map((s) => s.trim());

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "128kb" })); // room create/join carry a small avatar data URL
app.use(cors({ origin: ORIGINS.includes("*") ? true : ORIGINS, methods: ["GET", "POST"], allowedHeaders: ["Content-Type", "X-Client-Id"] }));

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/ws-health", (_req, res) => res.json({ ok: true, ...roomEngine.stats() }));

const rl = rateLimit({ windowMs: 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false, message: { error: "Slow down" } });

app.post("/api/room", rl, (req, res) => {
  const b = req.body || {};
  if (!b.playerId) return res.status(400).json({ error: "Missing playerId" });
  const room = roomEngine.create({ hostId: b.playerId, name: b.name, avatar: b.avatar, lang: b.lang, opdrachten: b.opdrachten });
  roomEngine.touch(room.code, b.playerId);
  res.json({ code: room.code, hostId: room.hostId, playerId: b.playerId, state: roomEngine.publicState(room, b.playerId) });
});
app.post("/api/room/:code/join", rl, (req, res) => {
  const b = req.body || {};
  if (!b.playerId) return res.status(400).json({ error: "Missing playerId" });
  const r = roomEngine.join({ code: req.params.code, playerId: b.playerId, name: b.name, avatar: b.avatar });
  if (r.error) return res.status(409).json({ error: r.error });
  roomEngine.touch(r.room.code, b.playerId);
  res.json({ code: r.room.code, hostId: r.room.hostId, playerId: b.playerId, state: roomEngine.publicState(r.room, b.playerId) });
});
app.get("/api/room/:code", rl, (req, res) => {
  const pid = req.query.pid ? String(req.query.pid) : null;
  const room = pid ? roomEngine.touch(req.params.code, pid) : roomEngine.get(req.params.code);
  if (!room) return res.status(404).json({ error: "Room niet gevonden" });
  res.json({ code: room.code, hostId: room.hostId, state: roomEngine.publicState(room, pid) });
});
app.post("/api/room/:code/action", rl, (req, res) => {
  const b = req.body || {};
  if (!b.playerId) return res.status(400).json({ error: "Missing playerId" });
  roomEngine.touch(req.params.code, b.playerId);
  const r = roomEngine.action(req.params.code, b.playerId, b.action, b.payload);
  if (r.error) return res.status(409).json({ error: r.error });
  res.json({ code: r.room.code, hostId: r.room.hostId, state: roomEngine.publicState(r.room, b.playerId) });
});

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

function send(ws, msg) { try { ws.send(JSON.stringify(msg)); } catch { /* closed */ } }
function broadcast(room) {
  // per-viewer: each client gets its own hand + everyone's counts (hands never leak)
  for (const client of wss.clients) {
    if (client.readyState === 1 && client._code === room.code) send(client, { t: "state", state: roomEngine.publicState(room, client._pid) });
  }
}
function supersedeOldSockets(ws) {
  for (const c of wss.clients) { if (c !== ws && c._code === ws._code && c._pid === ws._pid) { c._superseded = true; try { c.terminate(); } catch { /* */ } } }
}
function hasLiveSibling(ws) {
  for (const c of wss.clients) { if (c !== ws && c.readyState === 1 && c._code === ws._code && c._pid === ws._pid) return true; }
  return false;
}

wss.on("connection", (ws) => {
  ws._code = null; ws._pid = null;
  ws.on("message", (buf) => {
    let m; try { m = JSON.parse(String(buf)); } catch { return; }
    if (!m || typeof m.t !== "string") return;
    if (m.t === "create") {
      const room = roomEngine.create({ hostId: m.playerId, name: m.name, avatar: m.avatar, lang: m.lang, opdrachten: m.opdrachten });
      ws._code = room.code; ws._pid = m.playerId;
      supersedeOldSockets(ws);
      send(ws, { t: "joined", code: room.code, playerId: m.playerId, hostId: room.hostId });
      broadcast(room);
      return;
    }
    if (m.t === "join") {
      const r = roomEngine.join({ code: m.code, playerId: m.playerId, name: m.name, avatar: m.avatar });
      if (r.error) { send(ws, { t: "error", error: r.error }); return; }
      ws._code = r.room.code; ws._pid = m.playerId;
      supersedeOldSockets(ws);
      send(ws, { t: "joined", code: r.room.code, playerId: m.playerId, hostId: r.room.hostId });
      broadcast(r.room);
      return;
    }
    if (m.t === "action") {
      const r = roomEngine.action(ws._code, ws._pid, m.action, m.payload);
      if (r.error) { send(ws, { t: "error", error: r.error }); return; }
      if (r.room) broadcast(r.room);
      return;
    }
    if (m.t === "ping") { send(ws, { t: "pong" }); return; }
    // clock sync for the reaction race: echo the client stamp + the server clock
    if (m.t === "clock") { send(ws, { t: "clock", c: m.c, s: Date.now() }); return; }
  });
  ws.on("close", () => {
    if (!ws._code || !ws._pid) return;
    if (ws._superseded || hasLiveSibling(ws)) return; // a newer socket already serves this player
    const room = roomEngine.disconnect(ws._code, ws._pid);
    if (room) broadcast(room);
  });
});

// slow watchdog: host-grace expiry, poll-timeout, heartbeat
setInterval(() => { try { for (const room of roomEngine.tick()) broadcast(room); } catch { /* */ } }, 1000).unref?.();
// fast tick: race cap, continuous-pass loop, bots
setInterval(() => { try { for (const room of roomEngine.tickEzelen()) broadcast(room); } catch { /* */ } }, 180).unref?.();

httpServer.listen(PORT, () => console.log(`EZELEN server on :${PORT} (ws: /ws)`));
