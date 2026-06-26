/* ------------------------------------------------------------------ */
/*  EZELEN — authoritative room registry + lifecycle.                   */
/*                                                                      */
/*  This is the proven Kingsen room plumbing (code create/join, host,    */
/*  presence, reconnect, host-grace, reaping) with all the drinking-game */
/*  logic removed: every game action is delegated to ./ezelen.js. The    */
/*  server owns the deck + every hand; clients only ever see their own    */
/*  hand + everyone's counts (publicState is per-viewer).                */
/*                                                                      */
/*  In-memory only; rooms are ephemeral and reaped after a TTL.          */
/* ------------------------------------------------------------------ */
import { ezelenAction, ezelenTick, ezelenPublic, EZELEN_MAX_PLAYERS } from "./ezelen.js";

const CODE_CHARS = "ACDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
function makeCode() { let s = ""; for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return s; }

const rooms = new Map();
const ROOM_TTL_MS = 1000 * 60 * 60 * 3;   // reap empty rooms after 3h idle
const HOST_GRACE_MS = 10000;              // host deliberately LEFT -> close after this
const HOST_DISCONNECT_GRACE_MS = 45000;   // host connection DROP -> longer grace (mobile blip)
const POLL_TIMEOUT_MS = 9000;             // HTTP poller not seen this long -> offline
const REBROADCAST_EVERY = 3;              // ticks (~3s): heartbeat so a quiet WS can't be seen as half-open
let tickCount = 0;

function cleanName(n) { return String(n == null ? "" : n).replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 18); }
function cleanAvatar(a) {
  if (typeof a !== "string") return "";
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(a)) return "";
  return a.length <= 60000 ? a : "";
}

function newRoom(code, hostId, opts) {
  return {
    code, hostId,
    mode: "ezelen",
    ezelen: null,                       // game state (see ./ezelen.js)
    opdrachtMode: "auto",               // "auto" (game picks) | "self" (ezel writes their own)
    opdrachten: Array.isArray(opts.opdrachten) ? opts.opdrachten.map((s) => String(s == null ? "" : s).replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 120)).filter(Boolean).slice(0, 24) : null,
    lang: opts.lang === "en" ? "en" : "nl",
    players: [],                        // {id,name,avatar,connected,letters,bot,lastSeen}
    started: false,
    gate: false, gateReady: {},
    hostAwaySince: 0, hostGraceMs: 0,
    lastLeft: null,
    closed: false,
    rev: 0,
    createdAt: Date.now(), touchedAt: Date.now(),
  };
}

function publicState(room, viewerId) {
  return {
    code: room.code,
    hostId: room.hostId,
    mode: "ezelen",
    ezelen: ezelenPublic(room, viewerId),
    lang: room.lang,
    players: room.players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar || "", connected: p.connected, letters: p.letters || 0, bot: !!p.bot })),
    started: room.started,
    gate: !!room.gate,
    gateReady: room.gateReady || {},
    hostAwaySince: room.hostAwaySince || 0,
    lastLeft: room.lastLeft || null,
    closed: !!room.closed,
    rev: room.rev || 0,
  };
}

// Remove a player; EZELEN has no turn pointer, and a leaver's cards are
// redistributed by ezelen.js's leave handler before we get here.
function removePlayerAt(room, idx) { if (idx >= 0) room.players.splice(idx, 1); }

export const roomEngine = {
  create({ hostId, name, avatar, lang, opdrachten }) {
    let code; do { code = makeCode(); } while (rooms.has(code));
    const room = newRoom(code, hostId, { lang, opdrachten });
    room.players.push({ id: hostId, name: cleanName(name), avatar: cleanAvatar(avatar), connected: true, letters: 0 });
    rooms.set(code, room);
    return room;
  },

  join({ code, playerId, name, avatar }) {
    const room = rooms.get((code || "").toUpperCase());
    if (!room) return { error: "Room niet gevonden" };
    if (room.closed) return { error: "Room gesloten" };
    let p = room.players.find((x) => x.id === playerId);
    if (p) { p.connected = true; p.name = cleanName(name) || p.name; if (avatar !== undefined) p.avatar = cleanAvatar(avatar) || p.avatar; } // reconnect
    else {
      if (room.started) return { error: "Spel al begonnen" };
      if (room.players.length >= EZELEN_MAX_PLAYERS) return { error: "Room vol" };
      room.players.push({ id: playerId, name: cleanName(name), avatar: cleanAvatar(avatar), connected: true, letters: 0 });
    }
    if (playerId === room.hostId) room.hostAwaySince = 0;
    room.touchedAt = Date.now();
    return { room };
  },

  get(code) { return rooms.get((code || "").toUpperCase()) || null; },

  action(code, playerId, type, payload) {
    const room = rooms.get((code || "").toUpperCase());
    if (!room) return { error: "Room niet gevonden" };
    room.touchedAt = Date.now();
    room.rev = (room.rev || 0) + 1;
    const isHost = playerId === room.hostId;

    // EZELEN owns most actions; null = fall through to the shared lobby actions.
    const handled = ezelenAction(room, playerId, type, payload, { isHost });
    if (handled) return handled;

    switch (type) {
      case "gateready": {
        if (!room.gate || room.started) return { room };
        const on = !(payload && payload.on === false);
        if (on) room.gateReady[playerId] = true; else delete room.gateReady[playerId];
        return { room };
      }
      case "closegate": {
        if (!isHost) return { error: "Alleen de gastheer" };
        room.gate = false; room.gateReady = {};
        return { room };
      }
      case "leave": {
        const p = room.players.find((x) => x.id === playerId);
        if (playerId === room.hostId) {
          if (p) p.connected = false;
          if (room.started && !room.closed) { room.hostAwaySince = Date.now(); room.hostGraceMs = HOST_GRACE_MS; }
        } else if (p) {
          room.lastLeft = { name: p.name, at: Date.now() };
          removePlayerAt(room, room.players.findIndex((x) => x.id === playerId));
        }
        return { room };
      }
      default: return { error: "Onbekende actie" };
    }
  },

  disconnect(code, playerId) {
    const room = rooms.get((code || "").toUpperCase());
    if (!room) return null;
    const p = room.players.find((x) => x.id === playerId);
    if (p) p.connected = false;
    if (playerId === room.hostId && room.started && !room.closed && !room.hostAwaySince) {
      room.hostAwaySince = Date.now(); room.hostGraceMs = HOST_DISCONNECT_GRACE_MS;
    }
    room.touchedAt = Date.now();
    return room;
  },

  // HTTP-polling keepalive: a poll/action marks the player present.
  touch(code, playerId) {
    const room = rooms.get((code || "").toUpperCase());
    if (!room) return null;
    const p = room.players.find((x) => x.id === playerId);
    if (p) { p.connected = true; p.lastSeen = Date.now(); }
    if (playerId === room.hostId) room.hostAwaySince = 0;
    room.touchedAt = Date.now();
    return room;
  },

  // Slow tick (~1s): host-grace expiry, poll-timeout, and the heartbeat that keeps
  // a quiet WebSocket from being treated as half-open (esp. in the lobby).
  tick() {
    const now = Date.now();
    const changed = [];
    tickCount++;
    const rebroadcast = tickCount % REBROADCAST_EVERY === 0;
    for (const [, room] of rooms) {
      if (room.hostAwaySince && !room.closed && now - room.hostAwaySince >= (room.hostGraceMs || HOST_GRACE_MS)) {
        room.closed = true; room.hostAwaySince = 0; room.rev = (room.rev || 0) + 1; changed.push(room);
      }
      for (const p of room.players) {
        if (p.lastSeen && p.connected && now - p.lastSeen > POLL_TIMEOUT_MS) {
          p.connected = false; room.rev = (room.rev || 0) + 1;
          if (p.id === room.hostId && room.started && !room.closed && !room.hostAwaySince) { room.hostAwaySince = now; room.hostGraceMs = HOST_DISCONNECT_GRACE_MS; }
          if (!changed.includes(room)) changed.push(room);
        }
      }
      if (rebroadcast && !room.closed && !changed.includes(room)) changed.push(room);
    }
    return changed;
  },

  // Fast tick (~180ms): the reaction race + continuous-pass loop + bots.
  tickEzelen() {
    const now = Date.now();
    const changed = [];
    for (const [, room] of rooms) {
      try { if (ezelenTick(room, now)) { room.rev = (room.rev || 0) + 1; changed.push(room); } } catch { /* keep the loop alive */ }
    }
    return changed;
  },

  reap() {
    const now = Date.now();
    for (const [code, room] of rooms) {
      const anyConnected = room.players.some((p) => p.connected);
      const old = now - room.touchedAt > ROOM_TTL_MS;
      const closedStale = room.closed && now - room.touchedAt > 30000;
      if ((!anyConnected && old) || closedStale) rooms.delete(code);
    }
  },

  stats() { return { rooms: rooms.size }; },
  publicState,
};

setInterval(() => roomEngine.reap(), 1000 * 60 * 10).unref?.();
