/* ------------------------------------------------------------------ */
/*  Kingsen — multiplayer client (WebSocket).                          */
/*                                                                      */
/*  Thin wrapper over the /ws endpoint. While a connection has never    */
/*  succeeded it retries a few times then reports "error" (so the UI    */
/*  can show a clear message + Retry instead of spinning forever). Once  */
/*  a connection HAS opened, drops are treated as transient and it      */
/*  reconnects indefinitely, replaying the last create/join.            */
/*  Callbacks: onState, onJoined, onError, onStatus.                    */
/*  Statuses: connecting | open | reconnecting | error | closed         */
/* ------------------------------------------------------------------ */

// Where the WS server lives. Defaults to the same host as the gallery API,
// upgraded to ws/wss. Override with VITE_EZELEN_WS.
function defaultWsUrl() {
  const api = (import.meta.env && import.meta.env.VITE_EZELEN_API) || "";
  if (api) return api.replace(/^http/, "ws").replace(/\/$/, "") + "/ws";
  // dev / same-origin fallback
  if (typeof location !== "undefined") {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${location.host}/ws`;
  }
  return "";
}
const WS_URL = (import.meta.env && import.meta.env.VITE_EZELEN_WS) || defaultWsUrl();

const CONNECT_TIMEOUT_MS = 8000; // give up on a single attempt after this
const MAX_INITIAL_ATTEMPTS = 4;  // before a connection ever opens, then -> "error"

export function clientId() {
  try {
    let id = localStorage.getItem("ezelen_pid_v1");
    if (!id) { id = "p_" + Math.random().toString(36).slice(2) + Date.now().toString(36).slice(-4); localStorage.setItem("ezelen_pid_v1", id); }
    return id;
  } catch { return "p_anon"; }
}

const PING_MS = 10000;        // heartbeat interval
const PONG_GRACE_MS = 12000;  // if no pong within this, consider the socket dead
// The server re-broadcasts room state every ~3s, so on a healthy socket we hear
// something at least that often. If an action fires and we haven't heard ANYTHING
// in this long, the socket is half-open — reconnect SYNCHRONOUSLY on the tap
// (background tabs freeze setTimeout, so we can't wait for a timer).
const STALE_ACTION_MS = 7000;

export function createNet({ onState, onJoined, onError, onStatus } = {}) {
  let ws = null;
  let closedByUs = false;
  let backoff = 600;
  let lastJoin = null;       // {t:'create'|'join', ...} to replay on reconnect
  let pingTimer = null;
  let connectTimer = null;   // per-attempt open timeout
  let everOpen = false;      // has any connection ever succeeded?
  let attempts = 0;          // failed attempts since last success (initial phase)
  let lastRx = 0;            // timestamp of the last message received (any type)
  let connectStartedAt = 0;  // when the current attempt began (to catch a stuck-CONNECTING socket)
  // ---- clock sync (EZELEN reaction race): estimate the server clock so a reaction
  // can be measured in the SAME time domain on every device, regardless of latency.
  let clockOffset = 0;       // serverNow ≈ Date.now() + clockOffset
  let bestRtt = 0;           // keep the offset from the lowest-RTT (least-jittered) sample
  function sendClock() { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: "clock", c: Date.now() })); } catch { /* */ } }

  function status(s) { onStatus && onStatus(s); }
  function clearConnectTimer() { if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; } }

  // Force the current socket dead and reconnect (rejoins the room + pulls fresh
  // state). Used when a half-open socket stops delivering messages.
  function forceReconnect() {
    try { ws && ws.close(); } catch { /* */ } // triggers onclose -> scheduleReconnect
  }

  function connect() {
    clearConnectTimer();
    connectStartedAt = Date.now();
    status(everOpen ? "reconnecting" : "connecting");
    try { ws = new WebSocket(WS_URL); } catch { onAttemptFailed(); return; }

    // If the socket doesn't open within the timeout, treat it as a failed attempt.
    connectTimer = setTimeout(() => {
      if (ws && ws.readyState !== 1) { try { ws.close(); } catch { /* */ } }
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      clearConnectTimer();
      everOpen = true;
      attempts = 0;
      backoff = 600;
      lastRx = Date.now();
      status("open");
      if (lastJoin) ws.send(JSON.stringify(lastJoin)); // replay create/join
      // Clock-sync burst: a few quick samples converge the offset, then it rides
      // along on the heartbeat below + on every refocus.
      bestRtt = 0;
      sendClock();
      setTimeout(sendClock, 250);
      setTimeout(sendClock, 700);
      clearInterval(pingTimer);
      // Heartbeat: ping regularly AND verify the server is still answering. If
      // nothing has arrived (incl. pong) within the grace window, the socket is
      // half-open (backgrounded PWA / network blip) -> drop it and reconnect so
      // taps aren't silently lost and fresh state flows again.
      pingTimer = setInterval(() => {
        if (!ws || ws.readyState !== 1) return;
        if (Date.now() - lastRx > PONG_GRACE_MS) { forceReconnect(); return; }
        try { ws.send(JSON.stringify({ t: "ping" })); } catch { /* */ }
        sendClock(); // keep the clock estimate fresh
      }, PING_MS);
    };
    ws.onmessage = (ev) => {
      lastRx = Date.now();
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === "pong") return; // heartbeat ack
      if (m.t === "clock") {      // clock-sync reply: refine the server-time offset
        const nowc = Date.now();
        const rtt = nowc - m.c;
        if (rtt >= 0 && (bestRtt === 0 || rtt < bestRtt)) { bestRtt = rtt; clockOffset = m.s + rtt / 2 - nowc; }
        return;
      }
      if (m.t === "state") onState && onState(m.state);
      else if (m.t === "joined") {
        // Once we're in a room, EVERY future reconnect must REJOIN this exact
        // room — never replay the original "create" (which would spawn a brand
        // new room with a new code and orphan the code already shared, e.g.
        // after backgrounding the app to send the code over WhatsApp).
        // The server reconnects the host by playerId, so a join keeps the room.
        lastJoin = { t: "join", playerId: clientId(), code: m.code, name: (lastJoin && lastJoin.name) || "", avatar: (lastJoin && lastJoin.avatar) || "" };
        onJoined && onJoined(m);
      }
      else if (m.t === "error") onError && onError(m.error);
    };
    ws.onclose = () => {
      clearConnectTimer();
      clearInterval(pingTimer);
      if (closedByUs) { status("closed"); return; }
      if (everOpen) { status("reconnecting"); scheduleReconnect(); return; }
      onAttemptFailed();
    };
    ws.onerror = () => { try { ws.close(); } catch { /* */ } };
  }

  // A connection that never opened just failed. Retry a few times, then give up
  // with a clear "error" status so the UI can offer Retry.
  function onAttemptFailed() {
    attempts += 1;
    if (attempts >= MAX_INITIAL_ATTEMPTS) { status("error"); return; }
    scheduleReconnect();
  }

  function scheduleReconnect() {
    setTimeout(() => { if (!closedByUs) connect(); }, backoff);
    backoff = Math.min(backoff * 2, 8000);
  }

  function raw(obj) {
    if (ws && ws.readyState === 1) {
      // Socket LOOKS open — but if nothing has arrived in a while it's half-open
      // (server re-broadcasts every ~3s, so silence > STALE_ACTION_MS means dead).
      // Reconnect synchronously on THIS tap rather than sending into the void and
      // waiting for a timer that a backgrounded tab has frozen.
      if (lastRx && Date.now() - lastRx > STALE_ACTION_MS) { forceReconnect(); return false; }
      ws.send(JSON.stringify(obj));
      return true;
    }
    // socket not open -> the action would be lost. Kick a reconnect so the
    // room is rejoined and the player can act again (instead of a dead tap).
    if (!closedByUs && lastJoin) {
      if (!ws || ws.readyState !== 1) connect();
    }
    return false;
  }

  // When the app returns to the foreground (PWA was backgrounded) or the network
  // comes back, proactively verify the socket and reconnect if it's stale.
  function checkAlive() {
    if (closedByUs || !lastJoin) return;
    if (!ws || ws.readyState > 1) { connect(); return; }       // closed/closing -> reconnect
    // Stuck mid-connect (onopen never fired — common after a backgrounded tab
    // throttled the connect timeout): abandon it and start a fresh attempt.
    if (ws.readyState === 0 && Date.now() - connectStartedAt > CONNECT_TIMEOUT_MS) { try { ws.close(); } catch { /* */ } connect(); return; }
    if (ws.readyState === 1 && Date.now() - lastRx > PONG_GRACE_MS) forceReconnect(); // half-open -> recycle
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkAlive(); });
  }
  if (typeof window !== "undefined") {
    window.addEventListener("online", checkAlive);
    window.addEventListener("focus", checkAlive);
  }

  function startFresh() {
    // reset the initial-connect budget and (re)connect, replaying lastJoin
    closedByUs = false;
    everOpen = false;
    attempts = 0;
    backoff = 600;
    if (ws && ws.readyState <= 1) { try { ws.close(); } catch { /* */ } }
    connect();
  }

  return {
    create({ name, setCode, setName, lang, alcoholFree, avatar, mode, opdrachten }) {
      lastJoin = { t: "create", playerId: clientId(), name, setCode, setName, lang, alcoholFree, avatar: avatar || "", mode, opdrachten };
      startFresh();
    },
    join({ code, name, avatar }) {
      lastJoin = { t: "join", playerId: clientId(), code: (code || "").toUpperCase(), name, avatar: avatar || "" };
      startFresh();
    },
    // Best estimate of the server clock (ms). Used by EZELEN to time reactions in a
    // latency-independent domain. Falls back to local time before the first sample.
    serverNow() { return Date.now() + clockOffset; },
    // Manual retry from the UI after an "error" status.
    retry() { if (lastJoin) startFresh(); },
    action(action, payload) {
      const before = lastRx;
      raw({ t: "action", action, payload });
      // Ack guard: the server answers EVERY action (a broadcast or an error). If
      // nothing comes back shortly, the socket is half-open (open but not
      // delivering) — recycle it so fresh state (incl. the game-over the user is
      // stuck before) flows in. This makes a "tap does nothing" self-heal on the
      // very next tap instead of freezing — esp. at the last king.
      setTimeout(() => {
        if (closedByUs || !lastJoin || lastRx > before) return; // got a reply -> fine
        if (ws && ws.readyState === 1) { try { ws.close(); } catch { /* */ } } // -> onclose reconnects+rejoins
        else if (!ws) connect();
      }, 2500);
    },
    close() { closedByUs = true; clearConnectTimer(); clearInterval(pingTimer); try { ws && ws.close(); } catch { /* */ } },
    // Heal a half-open socket on ANY in-game tap — even when the tap sends no
    // action (a spectator waiting for someone else). Without this, a stale
    // spectator (e.g. waiting on the last king) had no way to recover by tapping.
    poke() {
      if (closedByUs || !lastJoin) return;
      if (!ws || ws.readyState > 1) { connect(); return; }                                   // closed/closing -> reconnect
      if (ws.readyState === 0 && Date.now() - connectStartedAt > CONNECT_TIMEOUT_MS) { try { ws.close(); } catch { /* */ } connect(); return; } // stuck connecting
      if (ws.readyState === 1 && lastRx && Date.now() - lastRx > STALE_ACTION_MS) forceReconnect(); // half-open -> recycle
    },
    isConnected() { return !!ws && ws.readyState === 1; },
  };
}
