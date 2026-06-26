/* ------------------------------------------------------------------ */
/*  EZELEN — server-authoritative game logic on the shared Kingsen      */
/*  room engine. The server owns the deck, EVERY hand, the phase and     */
/*  all timing. A client only ever receives ITS OWN hand plus everyone's */
/*  card COUNTS — hands are never sent to other clients, so they can't    */
/*  be cheated.                                                          */
/*                                                                       */
/*  This module is pure logic: it mutates a room object owned by         */
/*  rooms.js and is dispatched from roomEngine.action / .tick. It does    */
/*  NOT touch the kingsen card-game state (those fields stay null for     */
/*  ezelen rooms), so the two games share the registry/transport without  */
/*  forking it.                                                          */
/* ------------------------------------------------------------------ */

// Real playing-card ranks — one rank per player (N ranks for an N-player game).
// These map to the real card art in src/assets/cards/{RANK}{SUIT}.webp on the
// client (e.g. "A"+"S" -> AS.webp). Ordered most-distinct-first for 3..8 players.
const RANK_POOL = ["A", "K", "Q", "J", "10", "9", "8", "7"];
const SUITS = [
  { letter: "S", sym: "♠", red: false }, // spades
  { letter: "H", sym: "♥", red: true },  // hearts
  { letter: "D", sym: "♦", red: true },  // diamonds
  { letter: "C", sym: "♣", red: false }, // clubs
];
export const EZEL_LETTERS = ["E", "Z", "E", "L"];
export const EZELEN_MIN_PLAYERS = 3;
export const EZELEN_MAX_PLAYERS = 8;
const MAX_BOTS = 6;

// Default forfeits (host may override via opdrachten in the lobby/admin). Dutch,
// no emoji, kept light and family-friendly.
const DEFAULT_OPDRACHTEN = [
  "Doe tien kniebuigingen voor de hele groep.",
  "Praat een minuut lang met een raar accent.",
  "Zing een liedje naar keuze, hardop.",
  "Vertel een genant verhaal over jezelf.",
  "Doe vanavond de afwas voor iedereen.",
  "Imiteer een familielid tot iemand lacht.",
  "Vertel een mop, ook als die niet grappig is.",
  "Doe je beste dansje van tien tellen.",
];

// ---- timing (ms) ----
const RACE_CAP_MS = 3000;          // resolve the race at most this long after the declare
const RESULT_MS = 4600;            // round-result reveal before the next round is dealt
const STALL_MS = 11000;            // a connected human holding 4+ (no set) this long -> auto-pass their worst
const DISCONNECT_PASS_MS = 1100;   // a disconnected holder of 4+ -> auto-pass quickly so the loop never freezes
const BOT_PASS_MIN = 650, BOT_PASS_MAX = 1600;
const BOT_REACT_MIN = 360, BOT_REACT_MAX = 1500;

// ---- helpers ----
function rand(a, b) { return a + Math.random() * (b - a); }
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
function makeCards(n) {
  const ranks = RANK_POOL.slice(0, n);
  const cards = {};
  let id = 0;
  for (const r of ranks) for (let si = 0; si < 4; si++) { cards[id] = { rank: r, suit: SUITS[si] }; id++; }
  return cards;
}
function rankCounts(handIds, cards) {
  const m = {};
  for (const id of handIds) { const c = cards[id]; if (!c) continue; m[c.rank] = (m[c.rank] || 0) + 1; }
  return m;
}
// Rank the hand has four of (a complete set), else null.
function setRankOf(handIds, cards) {
  const m = rankCounts(handIds, cards);
  for (const r in m) if (m[r] >= 4) return r;
  return null;
}
// Best progress: [rank, count] of the rank the holder has most of.
function bestRank(handIds, cards) {
  const m = rankCounts(handIds, cards);
  let r = null, c = 0;
  for (const k in m) if (m[k] > c) { c = m[k]; r = k; }
  return [r, c];
}
// The card of the least-useful rank (what you'd pass away).
function worstCard(handIds, cards) {
  const m = rankCounts(handIds, cards);
  let worst = null, worstC = 99;
  for (const id of handIds) { const c = m[cards[id].rank]; if (c < worstC) { worstC = c; worst = id; } }
  return worst;
}
// Left neighbour = next seat in player order (wrapping), skipping anyone with no
// hand entry. Disconnected players keep their seat (the tick auto-passes for them).
function leftNeighbourId(room, pid) {
  const ps = room.players, n = ps.length;
  const i = ps.findIndex((p) => p.id === pid);
  if (i < 0) return null;
  for (let s = 1; s <= n; s++) { const cand = ps[(i + s) % n]; if (cand && room.ezelen.hands[cand.id]) return cand.id; }
  return null;
}
function nameOf(room, id) { const p = room.players.find((x) => x.id === id); return p ? p.name : "?"; }
function pickOpdracht(room) {
  const list = (Array.isArray(room.opdrachten) && room.opdrachten.length) ? room.opdrachten : DEFAULT_OPDRACHTEN;
  return list[Math.floor(Math.random() * list.length)];
}

// ---- deal a fresh round (keeps each player's EZEL letters) ----
export function ezelenDeal(room) {
  const E = room.ezelen || (room.ezelen = {});
  const players = room.players;
  const n = players.length;
  const cards = makeCards(n);
  const ids = shuffle(Object.keys(cards).map(Number));
  E.cards = cards;
  E.hands = {};
  players.forEach((p) => { E.hands[p.id] = []; });
  ids.forEach((id, i) => E.hands[players[i % n].id].push(id));
  E.n = n;
  E.ranks = RANK_POOL.slice(0, n);
  E.phase = "passing";
  E.round = (E.round || 0) + 1;
  E.declarerId = null; E.rank = null; E.raceStartTs = 0;
  E.reactions = {}; E.result = null; E.resultAt = 0;
  E.lastHeldSince = {}; E.botPassAt = {}; E.botReactAt = {}; E.discPassAt = {};
  E.startedAt = Date.now();
  // stagger the bots' first pass so they don't move in lockstep
  players.forEach((p) => { if (p.bot) E.botPassAt[p.id] = Date.now() + rand(0, 700); });
}

// ---- start a fresh GAME (reset every player's letters, then deal) ----
export function ezelenStartGame(room) {
  room.started = true;
  room.gate = false; room.gateReady = {};
  room.players.forEach((p) => { p.letters = 0; });
  room.ezelen = room.ezelen || {};
  room.ezelen.round = 0;
  room.ezelen.ezelId = null; room.ezelen.ezelName = null; room.ezelen.opdracht = null;
  ezelenDeal(room);
}

// ---- move one card from a holder to their left neighbour ----
function doPass(room, fromId, cardId) {
  const E = room.ezelen;
  const hand = E.hands[fromId];
  if (!hand) return false;
  const k = hand.indexOf(cardId);
  if (k < 0) return false;
  const left = leftNeighbourId(room, fromId);
  if (left == null) return false;
  hand.splice(k, 1);
  E.hands[left].push(cardId);
  delete E.lastHeldSince[fromId];
  return true;
}

// ---- ignite the race (a valid declare) ----
function igniteRace(room, declarerId, rank) {
  const E = room.ezelen;
  E.phase = "race";
  E.declarerId = declarerId;
  E.rank = rank;
  E.raceStartTs = Date.now();
  E.reactions = { [declarerId]: { ms: 0 } }; // the declarer is safe
  E.botReactAt = {};
  room.players.forEach((p) => { if (p.bot && p.id !== declarerId && p.connected) E.botReactAt[p.id] = Date.now() + rand(BOT_REACT_MIN, BOT_REACT_MAX); });
}

// Resolve the race once every connected non-declarer has reacted (or from the tick cap).
function maybeResolveRace(room) {
  const E = room.ezelen;
  if (E.phase !== "race") return;
  const contenders = room.players.filter((p) => p.id !== E.declarerId && p.connected);
  if (contenders.length === 0 || contenders.every((p) => E.reactions[p.id])) resolveRace(room);
}

function resolveRace(room) {
  const E = room.ezelen;
  if (E.phase !== "race") return;
  // Every non-declarer competes; a non-reactor is treated as the slowest.
  const contenders = room.players.filter((p) => p.id !== E.declarerId);
  let loser = null, worst = -1;
  for (const p of contenders) {
    const r = E.reactions[p.id];
    const ms = r ? r.ms : Number.MAX_SAFE_INTEGER;  // never reacted -> slowest
    if (ms > worst) { worst = ms; loser = p; }       // first max wins ties (seat order)
  }
  const reactions = {};
  for (const p of contenders) reactions[p.id] = E.reactions[p.id] ? E.reactions[p.id].ms : null;
  if (loser) {
    loser.letters = Math.min(4, (loser.letters || 0) + 1);
    E.result = {
      loserId: loser.id, loserName: loser.name,
      letter: EZEL_LETTERS[Math.max(0, loser.letters - 1)],
      letters: loser.letters,
      declarerId: E.declarerId, declarerName: nameOf(room, E.declarerId),
      rank: E.rank, reactions,
    };
    if (loser.letters >= 4) {
      E.phase = "gameover";
      E.ezelId = loser.id; E.ezelName = loser.name;
      // "self" mode: the ezel writes their own opdracht (null until they submit); "auto": the game picks.
      E.opdracht = room.opdrachtMode === "self" ? null : pickOpdracht(room);
    } else {
      E.phase = "result"; E.resultAt = Date.now();
    }
  } else {
    // no contenders at all (everyone gone) -> just deal again
    E.phase = "result"; E.resultAt = Date.now(); E.result = null;
  }
}

/* ---- action dispatch. Returns {room} / {error} when handled, or null to let
   the shared (kingsen) switch handle generic lobby actions. ---- */
export function ezelenAction(room, playerId, type, payload, ctx) {
  const isHost = ctx.isHost;
  const E = room.ezelen;

  switch (type) {
    case "opengate": {
      if (!isHost) return { error: "Alleen de gastheer kan starten" };
      if (room.started) return { room };
      if (room.players.length < EZELEN_MIN_PLAYERS) return { error: "Minimaal 3 spelers" };
      room.gate = true; room.gateReady = {};
      room.players.forEach((p) => { if (p.bot) room.gateReady[p.id] = true; });
      return { room };
    }
    case "addbot": {
      if (!isHost) return { error: "Alleen de gastheer" };
      if (room.started) return { room };
      const botCount = room.players.filter((p) => p.bot).length;
      if (room.players.length >= EZELEN_MAX_PLAYERS || botCount >= MAX_BOTS) return { room };
      const id = "bot_" + Math.random().toString(36).slice(2, 9);
      room.players.push({ id, name: "Ezel-bot " + (botCount + 1), avatar: "", connected: true, cards: 0, threes: 0, drinks: 0, letters: 0, bot: true });
      if (room.gate) room.gateReady[id] = true;
      return { room };
    }
    case "start": {
      if (!isHost) return { error: "Alleen de gastheer kan starten" };
      if (room.players.length < EZELEN_MIN_PLAYERS) return { error: "Minimaal 3 spelers" };
      if (!room.gate) return { error: "Open eerst de uitleg" };
      if (room.players.some((p) => p.connected && p.id !== room.hostId && !p.bot && !room.gateReady[p.id])) return { error: "Nog niet iedereen is klaar" };
      ezelenStartGame(room);
      return { room };
    }
    case "restart":
    case "newgame": {
      if (!isHost) return { error: "Alleen de gastheer" };
      ezelenStartGame(room);
      return { room };
    }
    case "tolobby": {
      // back to the lobby (keep everyone in the room, drop the game state)
      if (!isHost) return { error: "Alleen de gastheer" };
      room.started = false; room.gate = false; room.gateReady = {};
      room.players.forEach((p) => { p.letters = 0; });
      room.ezelen = null;
      return { room };
    }
    case "pass": {
      if (!E || E.phase !== "passing") return { error: "Niet nu" };
      const hand = E.hands[playerId];
      if (!hand) return { room };
      if (hand.length < 4) return { error: "Wacht op een kaart van rechts" };
      if (setRankOf(hand, E.cards)) return { error: "Je hebt vier gelijk, sla op tafel" };
      const cardId = Number(payload && payload.cardId);
      if (!doPass(room, playerId, cardId)) return { error: "Die kaart heb je niet" };
      return { room };
    }
    case "declare": {
      if (!E || E.phase !== "passing") return { room }; // already racing / not now -> ignore (first declare wins)
      const hand = E.hands[playerId];
      if (!hand) return { room };
      const r = setRankOf(hand, E.cards);
      if (!r) return { error: "Je hebt nog geen vier gelijk" };
      igniteRace(room, playerId, r);
      return { room };
    }
    case "react": {
      if (!E || E.phase !== "race") return { room };
      if (playerId === E.declarerId) return { room };
      if (E.reactions[playerId]) return { room };
      const serverArrival = Math.max(0, Date.now() - E.raceStartTs);
      let ms = Number(payload && payload.ms);
      if (!isFinite(ms) || ms < 0) ms = serverArrival;       // no client estimate -> use server arrival
      ms = Math.max(0, Math.min(ms, serverArrival));         // fairness cap: can't beat physical arrival
      E.reactions[playerId] = { ms };
      maybeResolveRace(room);
      return { room };
    }
    case "nextround": {
      // host (or anyone, harmless) skips the result reveal to the next round
      if (!E || E.phase !== "result") return { room };
      ezelenDeal(room);
      return { room };
    }
    case "leave": {
      // A guest leaving mid-round: keep their cards in circulation so the current
      // passing round stays playable, then let the shared `leave` remove them.
      if (E && playerId !== room.hostId) {
        if (E.phase === "passing") {
          const hand = E.hands[playerId];
          if (hand && hand.length) { const left = leftNeighbourId(room, playerId); if (left != null) { E.hands[left].push(...hand); E.hands[playerId] = []; } }
        } else if (E.phase === "race" && playerId === E.declarerId) {
          ezelenDeal(room); // the declarer bailed mid-race -> abort to a fresh round
        }
      }
      return null; // fall through to the shared leave (removes the player + grace logic)
    }

    // ---- admin / test controls (host only) ----
    case "ez_forcedeal": {
      if (!isHost) return { error: "Alleen de gastheer" };
      if (!room.started) ezelenStartGame(room); else ezelenDeal(room);
      return { room };
    }
    case "ez_forceset": {
      // give a target player a complete set right now (for testing the declare/race)
      if (!isHost || !E || E.phase !== "passing") return { room };
      const targetId = (payload && payload.playerId) || playerId;
      const hand = E.hands[targetId];
      if (!hand) return { room };
      // pick the rank the target already has the most of, then pull its 4 cards in from wherever they are
      const [rank] = bestRank(hand, E.cards);
      const r = rank || E.ranks[0];
      const wanted = Object.keys(E.cards).map(Number).filter((id) => E.cards[id].rank === r);
      for (const id of wanted) {
        for (const p of room.players) { const h = E.hands[p.id]; const k = h.indexOf(id); if (k >= 0) { h.splice(k, 1); break; } }
      }
      // make room in the target hand: keep it at 4 by dropping extras to the left
      E.hands[targetId] = wanted.slice(0, 4);
      return { room };
    }
    case "ez_forcedeclare": {
      if (!isHost || !E || E.phase !== "passing") return { room };
      const targetId = (payload && payload.playerId) || playerId;
      const hand = E.hands[targetId];
      let r = hand ? setRankOf(hand, E.cards) : null;
      if (!r) { // give them a set first
        ezelenAction(room, playerId, "ez_forceset", { playerId: targetId }, ctx);
        r = setRankOf(E.hands[targetId], E.cards);
      }
      if (r) igniteRace(room, targetId, r);
      return { room };
    }
    case "ez_setletters": {
      if (!isHost) return { room };
      const t = room.players.find((p) => p.id === (payload && payload.playerId));
      if (t) t.letters = Math.max(0, Math.min(4, Number(payload && payload.n) || 0));
      return { room };
    }
    case "ez_opdrachtmode": {
      // host chooses, in the lobby, whether the game picks the forfeit or the ezel writes it
      if (!isHost) return { error: "Alleen de gastheer" };
      room.opdrachtMode = (payload && payload.mode === "self") ? "self" : "auto";
      return { room };
    }
    case "ez_opdracht": {
      // the ezel submits their own forfeit (or asks the game to pick) at game over
      if (!E || E.phase !== "gameover") return { room };
      if (playerId !== E.ezelId) return { error: "Alleen de ezel" };
      if (E.opdracht) return { room };
      if (payload && payload.auto) { E.opdracht = pickOpdracht(room); return { room }; }
      const txt = String((payload && payload.text) || "").replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 160);
      if (txt) E.opdracht = txt;
      return { room };
    }

    default:
      return null; // not an ezelen action -> let the shared switch handle it
  }
}

/* ---- per-room tick: race cap, anti-stall auto-pass, result auto-advance, bots.
   Called on a fast cadence (see server.js). Returns true if the room changed. ---- */
export function ezelenTick(room, now) {
  const E = room.ezelen;
  if (!E || !room.started || room.closed) return false;
  let changed = false;

  if (E.phase === "race") {
    if (now >= E.raceStartTs + RACE_CAP_MS) { resolveRace(room); changed = true; }
    else {
      // schedule any due bot reactions
      for (const p of room.players) {
        if (p.bot && p.connected && p.id !== E.declarerId && !E.reactions[p.id] && E.botReactAt[p.id] && now >= E.botReactAt[p.id]) {
          E.reactions[p.id] = { ms: Math.max(0, E.botReactAt[p.id] - E.raceStartTs) };
          changed = true;
        }
      }
      if (changed) maybeResolveRace(room);
    }
    return changed;
  }

  if (E.phase === "result") {
    if (E.resultAt && now >= E.resultAt + RESULT_MS) { ezelenDeal(room); changed = true; }
    return changed;
  }

  if (E.phase === "passing") {
    for (const p of room.players) {
      const hand = E.hands[p.id];
      if (!hand) continue;
      const hasSet = !!setRankOf(hand, E.cards);

      if (!p.connected) {
        // keep the loop alive: auto-pass a dropped player's worst card (even if it
        // breaks a set — they left; we never auto-DECLARE for them)
        if (hand.length >= 4) {
          if (now >= (E.discPassAt[p.id] || 0)) {
            const c = worstCard(hand, E.cards);
            if (c != null && doPass(room, p.id, c)) { changed = true; }
            E.discPassAt[p.id] = now + DISCONNECT_PASS_MS;
          }
        }
        continue;
      }

      if (p.bot) {
        if (hasSet) {
          // bots declare their own set (manual declare for everyone) after a short beat
          if (now >= (E.botPassAt[p.id] || 0)) { igniteRace(room, p.id, setRankOf(hand, E.cards)); changed = true; return changed; }
        } else if (hand.length >= 4 && now >= (E.botPassAt[p.id] || 0)) {
          const c = worstCard(hand, E.cards);
          if (c != null && doPass(room, p.id, c)) changed = true;
          E.botPassAt[p.id] = now + rand(BOT_PASS_MIN, BOT_PASS_MAX);
        }
        continue;
      }

      // connected human: anti-stall (holding 4+ with no set for too long -> nudge a pass)
      if (hand.length >= 4 && !hasSet) {
        if (!E.lastHeldSince[p.id]) E.lastHeldSince[p.id] = now;
        else if (now - E.lastHeldSince[p.id] > STALL_MS) {
          const c = worstCard(hand, E.cards);
          if (c != null && doPass(room, p.id, c)) changed = true;
          delete E.lastHeldSince[p.id];
        }
      } else {
        delete E.lastHeldSince[p.id];
      }
    }
    return changed;
  }

  return changed;
}

/* ---- per-viewer public state. A client only ever sees its OWN hand plus
   everyone's card counts + letters. Hands are never leaked. ---- */
export function ezelenPublic(room, viewerId) {
  const E = room.ezelen;
  if (!E) return null;
  const counts = {};
  for (const p of room.players) counts[p.id] = (E.hands[p.id] || []).length;
  const yourIds = E.hands[viewerId] || [];
  const yourHand = yourIds.map((id) => ({ id, rank: E.cards[id].rank, suit: E.cards[id].suit }));
  const yourSet = setRankOf(yourIds, E.cards);
  const [bRank, bCount] = bestRank(yourIds, E.cards);
  return {
    phase: E.phase,
    round: E.round || 0,
    n: E.n || room.players.length,
    ranks: E.ranks || [],
    counts,
    yourHand,
    yourSet,
    yourBestRank: bRank,
    yourBestCount: bCount,
    yourCount: yourIds.length,
    declarerId: E.declarerId || null,
    rank: E.rank || null,
    raceStartTs: E.raceStartTs || 0,
    reactedIds: Object.keys(E.reactions || {}),
    result: (E.phase === "result" || E.phase === "gameover") ? (E.result || null) : null,
    ezelId: E.ezelId || null,
    ezelName: E.ezelName || null,
    opdracht: E.opdracht || null,
    opdrachtMode: room.opdrachtMode || "auto",
    serverNow: Date.now(),
  };
}
