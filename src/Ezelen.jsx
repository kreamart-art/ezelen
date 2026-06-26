import React, { useState, useEffect, useRef, useCallback } from "react";
import { Hand, Users, Plus, Play, RotateCcw, ChevronRight, ChevronLeft, Settings2, X, Check, WifiOff, Info, LogOut, Camera, Upload, User, Minus, Globe, Volume2, VolumeX, Loader2 } from "lucide-react";
import { createNet, clientId } from "./net.js";
import { L, LANGS } from "./i18n.js";
import { sfx, unlock as sfxUnlock, setMuted as sfxSetMuted } from "./sfx.js";
import medallionUrl from "./assets/logo.webp";

/* ------------------------------------------------------------------ */
/*  EZELEN — het reactiekaartspel, online op het Kingsen-platform.      */
/*  Hergebruikt de gedeelde room + socket-laag (./net.js), de echte  */
/*  speelkaarten en de Kingsen-onboarding (intro, taal, naam + foto).    */
/*  Eigen huisstijl: "Veld en Mandarijn". De server is autoritair.       */
/* ------------------------------------------------------------------ */

// ---- Veld en Mandarijn tokens ----
const C = {
  bg: "#0c1413",
  glowWarm: "rgba(242,145,63,0.10)", glowAlarm: "rgba(255,61,104,0.30)",
  mand: "#f2913f", mandLite: "#ffb066", mandDeep: "#c4641f",
  alarm: "#ff3d68", alarmDeep: "#d11f49",
  cream: "#f3ead9", ink: "#1b1916", redSuit: "#bd3a2c",
  text: "#ece3d3", muted: "#a89c85", faint: "#6b6354", rim: "rgba(242,145,63,0.22)",
  feltHi: "#1a5d46", feltMid: "#0e3528", feltLo: "#07211b", stitch: "rgba(242,145,63,0.40)",
  rail0: "#8a5a32", rail1: "#6e4626", rail2: "#3c2413",
};
const FR = "'Fraunces', Georgia, serif";
const UI = "'Inter', system-ui, sans-serif";

const FELT_NOISE = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";
const WOOD_GRAIN = "repeating-linear-gradient(96deg, rgba(0,0,0,0.16) 0px, rgba(0,0,0,0) 2px, rgba(255,255,255,0.05) 4px, rgba(0,0,0,0) 7px)";
const FILM_GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='f'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23f)'/%3E%3C/svg%3E\")";

// Real card art (the deck Kingsen already ships): src/assets/cards/{RANK}{SUIT}.webp
const _cardGlob = import.meta.glob("./assets/cards/*.webp", { eager: true, import: "default" });
const CARD_FACES = {};
for (const _p in _cardGlob) { const _m = _p.match(/\/cards\/([^/]+)\.webp$/); if (_m) CARD_FACES[_m[1]] = _cardGlob[_p]; }
function cardSrc(c) { return c && c.suit ? CARD_FACES[String(c.rank) + (c.suit.letter || "")] : null; }

function cleanName(n) { return String(n || "").replace(/[ -]/g, "").trim().slice(0, 18); }
const STORE_ROOM = "ezelen_room_v1", STORE_NAME = "ezelen_name_v1", STORE_AVATAR = "ezelen_avatar_v1", STORE_LANG = "ezelen_lang_v1", STORE_MUTE = "ezelen_mute_v1";
function loadStore(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } }
function saveStore(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } }

export default function Ezelen() {
  const startLang = loadStore(STORE_LANG);
  const [screen, setScreen] = useState("intro"); // intro | language | home | room
  const [lang, setLang] = useState(startLang || "nl");
  const [name, setName] = useState(() => loadStore(STORE_NAME) || "");
  const [avatar, setAvatar] = useState(() => loadStore(STORE_AVATAR) || "");
  const [joinCode, setJoinCode] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [roomState, setRoomState] = useState(null);
  const [code, setCode] = useState("");
  const [myPid, setMyPid] = useState(() => clientId());
  const [hostId, setHostId] = useState("");
  const [adminOpen, setAdminOpen] = useState(false);
  const [uitlegOpen, setUitlegOpen] = useState(false);
  const [simLatency, setSimLatency] = useState(0);
  const [muted, setMuted] = useState(() => !!loadStore(STORE_MUTE));

  const t = L(lang);
  const netRef = useRef(null);
  const reduced = useRef(false);
  useEffect(() => { reduced.current = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }, []);
  useEffect(() => { sfxSetMuted(muted); saveStore(STORE_MUTE, muted); }, [muted]);

  const ensureNet = useCallback(() => {
    if (netRef.current) return netRef.current;
    netRef.current = createNet({
      onStatus: (s) => setStatus(s),
      onError: (e) => setError(e || ""),
      onJoined: (m) => { setCode(m.code); setMyPid(m.playerId); setHostId(m.hostId); setError(""); saveStore(STORE_ROOM, { code: m.code, ts: Date.now() }); },
      onState: (st) => { setRoomState(st); if (st && st.hostId) setHostId(st.hostId); },
    });
    return netRef.current;
  }, []);
  useEffect(() => () => { try { netRef.current && netRef.current.close(); } catch { /* */ } }, []);

  const act = useCallback((a, p) => { if (netRef.current) netRef.current.action(a, p); }, []);
  const serverNow = useCallback(() => (netRef.current && netRef.current.serverNow ? netRef.current.serverNow() : Date.now()), []);

  function chooseLang(code) { sfxUnlock(); sfx.tap(); setLang(code); saveStore(STORE_LANG, code); setScreen("home"); }
  function doCreate() {
    const nm = cleanName(name) || (lang === "en" ? "Host" : "Gastheer");
    saveStore(STORE_NAME, nm); saveStore(STORE_AVATAR, avatar);
    sfx.tap(); setError(""); setRoomState(null);
    ensureNet().create({ name: nm, mode: "ezelen", lang, avatar });
    setScreen("room");
  }
  function doJoin(c) {
    const cc = (c || joinCode).trim().toUpperCase();
    if (cc.length < 4) { setError(t.enterCode); return; }
    const nm = cleanName(name) || (lang === "en" ? "Player" : "Speler");
    saveStore(STORE_NAME, nm); saveStore(STORE_AVATAR, avatar);
    sfx.tap(); setError(""); setRoomState(null);
    ensureNet().join({ code: cc, name: nm, avatar });
    setScreen("room");
  }
  function leaveRoom() {
    sfx.tap();
    try { netRef.current && netRef.current.action("leave"); } catch { /* */ }
    try { netRef.current && netRef.current.close(); } catch { /* */ }
    netRef.current = null; saveStore(STORE_ROOM, null);
    setRoomState(null); setCode(""); setScreen("home");
  }

  const amHost = myPid && hostId && myPid === hostId;
  const igniting = roomState && roomState.ezelen && roomState.ezelen.phase === "race";

  return (
    <div style={{
      minHeight: "100dvh", color: C.text, fontFamily: UI, position: "relative", overflowX: "hidden",
      background: igniting
        ? `radial-gradient(130% 95% at 50% 34%, ${C.glowAlarm} 0%, ${C.bg} 60%), ${C.bg}`
        : `radial-gradient(120% 85% at 50% -8%, rgba(242,145,63,0.06) 0%, ${C.bg} 55%), ${C.bg}`,
      transition: "background 260ms ease",
    }}>
      <GlobalStyle />
      <div aria-hidden style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 1, backgroundImage: FILM_GRAIN, backgroundSize: "140px 140px", opacity: reduced.current ? 0.04 : 0.06, mixBlendMode: "overlay" }} />
      <div aria-hidden style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 1, background: "radial-gradient(120% 100% at 50% 40%, transparent 55%, rgba(0,0,0,0.55) 100%)" }} />

      <div style={{ position: "relative", zIndex: 2, maxWidth: 480, margin: "0 auto", minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
        {screen === "language" && <LanguagePage t={t} current={lang} onPick={chooseLang} />}
        {screen === "home" && (
          <Home t={t} lang={lang} name={name} setName={setName} avatar={avatar} setAvatar={setAvatar}
            joinCode={joinCode} setJoinCode={setJoinCode} error={error}
            onCreate={doCreate} onJoin={() => doJoin()} onResume={(c) => doJoin(c)}
            onUitleg={() => { sfx.tap(); setUitlegOpen(true); }} onLang={() => setScreen("language")}
            muted={muted} onMute={() => setMuted((m) => !m)} />
        )}
        {screen === "room" && (
          <Room t={t} st={roomState} status={status} error={error} code={code} myPid={myPid} amHost={amHost}
            reduced={reduced.current} act={act} serverNow={serverNow} simLatency={simLatency}
            muted={muted} onMute={() => setMuted((m) => !m)}
            onLeave={leaveRoom} onAdmin={() => { sfx.tap(); setAdminOpen(true); }} onUitleg={() => { sfx.tap(); setUitlegOpen(true); }}
            onRetry={() => netRef.current && netRef.current.retry && netRef.current.retry()} />
        )}
      </div>

      {screen === "intro" && <Intro t={t} reduced={reduced.current} onDone={() => setScreen("language")} />}
      {uitlegOpen && <Uitleg t={t} onClose={() => { sfx.tap(); setUitlegOpen(false); }} />}
      {adminOpen && amHost && <AdminSheet t={t} st={roomState} myPid={myPid} act={act} onClose={() => setAdminOpen(false)} simLatency={simLatency} setSimLatency={setSimLatency} />}
    </div>
  );
}

/* ============================ INTRO (Artnomad) ============================ */
// Same intro as Kings: a typewriter that types "An Artnomad Game" with a key-
// strike per character + a carriage bell at the end, then goes to the language
// screen. Waits for a tap (which unlocks audio so the sound plays) and also
// auto-runs silently after a short wait so it is never a dead end.
const INTRO_TEXT = "An Artnomad Game";
function Intro({ reduced, onDone }) {
  const [typed, setTyped] = useState(0);
  const [started, setStarted] = useState(false);
  const ran = useRef(false), cancelled = useRef(false);
  const run = useCallback((withSound) => {
    if (ran.current) return;
    ran.current = true; setStarted(true);
    const full = INTRO_TEXT.length;
    if (reduced) { setTyped(full); setTimeout(onDone, 900); return; }
    if (withSound) sfxUnlock();
    setTyped(0);
    let i = 0; const PER = 135;
    const step = () => {
      if (cancelled.current) return;
      i += 1; setTyped(i);
      const ch = INTRO_TEXT[i - 1];
      if (withSound && ch && ch !== " ") sfx.type();
      if (i < full) setTimeout(step, PER);
      else { if (withSound) sfx.ding(); setTimeout(onDone, 1300); }
    };
    setTimeout(step, 350);
  }, [reduced, onDone]);
  useEffect(() => { const tmo = setTimeout(() => run(false), 2200); return () => clearTimeout(tmo); }, [run]); // silent fallback
  function onTap() { if (ran.current) { cancelled.current = true; onDone(); } else run(true); }
  const shown = INTRO_TEXT.slice(0, typed);
  const done = typed >= INTRO_TEXT.length;
  return (
    <div onClick={onTap} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onTap()} aria-label={INTRO_TEXT}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: C.bg, display: "grid", placeItems: "center", cursor: "pointer", padding: "8vw" }}>
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", animation: reduced ? "none" : "ezIn .5s ease both" }}>
        <span style={{ position: "relative", display: "inline-block", fontFamily: FR, fontWeight: 900, fontSize: "clamp(18px,5.4vw,30px)", lineHeight: 1, letterSpacing: "0.4px", color: C.text, whiteSpace: "nowrap", textShadow: "0 2px 18px rgba(0,0,0,.55)" }}>
          <span aria-hidden style={{ visibility: "hidden" }}>{INTRO_TEXT}</span>
          <span style={{ position: "absolute", left: 0, top: 0, whiteSpace: "nowrap" }}>
            {shown}<span className={"ez-caret" + (done || !started ? " ez-caret-blink" : "")} style={{ display: "inline-block", marginLeft: 1, color: C.mand, fontWeight: 400, transform: "translateY(-1px)" }}>|</span>
          </span>
        </span>
        {!started && <span style={{ marginTop: 18, fontSize: 11, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(242,145,63,0.55)", animation: reduced ? "none" : "ezTap 1.6s ease-in-out infinite" }}>tik om te starten · tap to start</span>}
      </div>
    </div>
  );
}

/* ============================ LANGUAGE ============================ */
function LanguagePage({ t, current, onPick }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "26px 22px 60px" }}>
      <div style={{ textAlign: "center", marginBottom: 26 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}><Medallion size={112} glow /></div>
        <Wordmark size={34} />
        <div style={{ marginTop: 16, display: "inline-flex", alignItems: "center", gap: 8, color: C.muted, fontSize: 14 }}><Globe size={16} /> {t.chooseLanguage}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {LANGS.map((l) => (
          <button key={l.code} onClick={() => onPick(l.code)} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px", borderRadius: 14, cursor: "pointer",
            fontSize: 16, fontWeight: 600, fontFamily: UI, color: current === l.code ? "#241a08" : C.text,
            background: current === l.code ? `linear-gradient(180deg, ${C.mandLite}, ${C.mandDeep})` : "rgba(255,255,255,0.05)",
            border: `1px solid ${current === l.code ? C.mand : C.rim}`,
          }}>
            {l.label}
            {current === l.code && <Check size={18} />}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ============================ HOME ============================ */
function Home({ t, lang, name, setName, avatar, setAvatar, joinCode, setJoinCode, error, onCreate, onJoin, onResume, onUitleg, onLang, muted, onMute }) {
  const stored = loadStore(STORE_ROOM);
  const fresh = stored && stored.code && Date.now() - (stored.ts || 0) < 1000 * 60 * 60 * 3;
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "20px 20px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Medallion size={44} />
          <Wordmark size={34} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button aria-label="mute" onClick={onMute} style={iconBtn()}>{muted ? <VolumeX size={15} /> : <Volume2 size={15} />}</button>
          <button aria-label="taal" onClick={onLang} style={iconBtn()}><Globe size={15} /></button>
        </div>
      </div>
      <p style={{ fontFamily: FR, fontSize: 20, lineHeight: 1.32, color: C.text, margin: "12px 0 6px" }}>
        {t.tagline1} <span style={{ color: C.mand }}>{t.tagline2}</span>
      </p>
      <p style={{ fontSize: 13.5, lineHeight: 1.55, color: C.muted, margin: "0 0 18px" }}>{t.blurb}</p>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
        <AvatarPicker t={t} value={avatar} onChange={setAvatar} />
      </div>

      <label style={{ fontSize: 12, color: C.faint, marginBottom: 6 }}>{t.yourName}</label>
      <input value={name} onChange={(e) => setName(e.target.value.slice(0, 18))} placeholder={t.namePh} style={inputStyle()} />

      {fresh && (
        <button onClick={() => onResume(stored.code)} style={{ ...primaryBtn(), marginTop: 6, background: "rgba(242,145,63,0.12)", color: C.mand, border: `1px solid ${C.rim}` }}>
          <RotateCcw size={17} /> {t.resume(stored.code)}
        </button>
      )}
      <button onClick={onCreate} style={{ ...primaryBtn(), marginTop: fresh ? 10 : 6 }}><Plus size={18} /> {t.makeTable}</button>

      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 2px 14px" }}>
        <div style={{ flex: 1, height: 1, background: C.rim }} />
        <span style={{ fontSize: 11, letterSpacing: "0.14em", color: C.faint, textTransform: "uppercase" }}>{t.orJoin}</span>
        <div style={{ flex: 1, height: 1, background: C.rim }} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 4))}
          onKeyDown={(e) => e.key === "Enter" && onJoin()} placeholder={t.codePh} maxLength={4}
          style={{ ...inputStyle(), textAlign: "center", letterSpacing: "0.32em", fontWeight: 700, fontSize: 18, color: C.mand, marginBottom: 0 }} />
        <button onClick={onJoin} disabled={joinCode.trim().length < 4} style={{ ...ghostBtn(), width: 100, opacity: joinCode.trim().length < 4 ? 0.45 : 1 }}>{t.joinBtn}</button>
      </div>
      {error && <p style={{ color: C.alarm, fontSize: 12.5, marginTop: 12 }}>{error}</p>}

      <div style={{ flex: 1 }} />
      <button onClick={onUitleg} style={{ ...textBtn(), alignSelf: "center", marginTop: 24 }}><Info size={14} /> {t.howItWorks}</button>
    </div>
  );
}

/* ============================ ROOM (lobby + game) ============================ */
function Room(props) {
  const { t, st, status, error, code, onRetry } = props;
  if (status === "error") {
    return (
      <Centered>
        <WifiOff size={28} color={C.alarm} />
        <p style={{ fontFamily: FR, fontSize: 18, marginTop: 14 }}>{t.noConnection}</p>
        <p style={{ color: C.muted, fontSize: 13, marginTop: 6, textAlign: "center" }}>{error || t.serverUnreachable}</p>
        <button onClick={onRetry} style={{ ...primaryBtn(), marginTop: 20, width: 200 }}><RotateCcw size={16} /> {t.retry}</button>
      </Centered>
    );
  }
  if (!st) {
    return (
      <Centered>
        <div className="ez-spin" style={{ width: 30, height: 30, borderRadius: "50%", border: `3px solid ${C.rim}`, borderTopColor: C.mand }} />
        <p style={{ color: C.muted, fontSize: 13, marginTop: 16 }}>{t.connecting(code)}</p>
      </Centered>
    );
  }
  if (st.closed) {
    return (
      <Centered>
        <p style={{ fontFamily: FR, fontSize: 20 }}>{t.tableClosed}</p>
        <p style={{ color: C.muted, fontSize: 13, marginTop: 8, textAlign: "center" }}>{t.hostLeft}</p>
        <button onClick={props.onLeave} style={{ ...primaryBtn(), marginTop: 20, width: 200 }}>{t.back}</button>
      </Centered>
    );
  }
  if (!st.started) return <Lobby {...props} />;
  return <Game {...props} />;
}

function TopBar({ t, st, status, code, amHost, muted, onMute, onLeave, onAdmin, onUitleg }) {
  const dot = status === "open" ? "#7bd88f" : status === "reconnecting" ? C.mand : C.faint;
  const round = st && st.ezelen ? st.ezelen.round : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 6px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <Medallion size={24} />
        <Wordmark size={22} />
        {round > 0 && <span style={{ fontSize: 11, color: C.faint, alignSelf: "flex-end", marginBottom: 2 }}>{t.round(round)}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span title={status} style={{ width: 8, height: 8, borderRadius: "50%", background: dot, boxShadow: `0 0 8px ${dot}` }} />
        {code && <span style={{ fontFamily: FR, fontWeight: 700, fontSize: 14, color: C.mand, letterSpacing: "0.12em" }}>{code}</span>}
        <button aria-label="mute" onClick={onMute} style={iconBtn()}>{muted ? <VolumeX size={15} /> : <Volume2 size={15} />}</button>
        <button aria-label="uitleg" onClick={onUitleg} style={iconBtn()}><Info size={15} /></button>
        {amHost && <button aria-label="beheer" onClick={onAdmin} style={iconBtn()}><Settings2 size={15} /></button>}
        <button aria-label="verlaat" onClick={onLeave} style={iconBtn()}><LogOut size={15} /></button>
      </div>
    </div>
  );
}

/* ============================ LOBBY ============================ */
function Lobby({ t, st, status, code, myPid, amHost, act, muted, onMute, onLeave, onAdmin, onUitleg }) {
  const players = st.players || [];
  const gate = !!st.gate;
  const myReady = !!(st.gateReady && st.gateReady[myPid]);
  const connGuests = players.filter((p) => p.connected && p.id !== st.hostId && !p.bot);
  const allReady = connGuests.every((p) => st.gateReady && st.gateReady[p.id]);
  const enough = players.length >= 3;
  const mode = (st.ezelen && st.ezelen.opdrachtMode) || "auto";
  const click = (a, p) => { sfx.tap(); act(a, p); };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <TopBar t={t} st={st} status={status} code={code} amHost={amHost} muted={muted} onMute={onMute} onLeave={onLeave} onAdmin={onAdmin} onUitleg={onUitleg} />
      <div style={{ flex: 1, padding: "8px 18px 26px", display: "flex", flexDirection: "column" }}>
        <p style={{ fontFamily: FR, fontSize: 22, margin: "10px 0 2px" }}>{gate ? t.readyToPlay : t.waitingRoom}</p>
        <p style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>{gate ? t.gateHint : t.lobbyShare(code)}</p>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {players.map((p) => {
            const isHost = p.id === st.hostId;
            const ready = st.gateReady && st.gateReady[p.id];
            return (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 13px", borderRadius: 13, background: "rgba(255,255,255,0.04)", border: `1px solid ${p.id === myPid ? C.rim : "rgba(255,255,255,0.06)"}` }}>
                <Avatar p={p} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}{p.id === myPid ? ` (${t.you})` : ""}</div>
                  <div style={{ fontSize: 11, color: C.faint, display: "flex", gap: 6 }}>
                    {isHost && <span style={{ color: C.mand }}>{t.host}</span>}
                    {p.bot && <span>{t.bot}</span>}
                    {!p.connected && <span style={{ color: C.alarm }}>{t.offline}</span>}
                  </div>
                </div>
                {gate && (ready ? <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#7bd88f" }}><Check size={14} /> {t.ready}</span> : <span style={{ fontSize: 12, color: C.faint }}>{t.reading}</span>)}
              </div>
            );
          })}
        </div>

        {amHost && !gate && (
          <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: 13, background: "rgba(0,0,0,0.22)", border: `1px solid ${C.rim}` }}>
            <div style={{ fontSize: 11, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>{t.opdrachtLabel}</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[["auto", t.opdrachtAuto], ["self", t.opdrachtSelf]].map(([m, label]) => (
                <button key={m} onClick={() => click("ez_opdrachtmode", { mode: m })} style={{
                  flex: 1, padding: "10px", borderRadius: 10, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: UI,
                  color: mode === m ? "#241a08" : C.muted, background: mode === m ? `linear-gradient(180deg, ${C.mandLite}, ${C.mandDeep})` : "rgba(255,255,255,0.05)",
                  border: `1px solid ${mode === m ? C.mand : C.rim}`,
                }}>{label}</button>
              ))}
            </div>
          </div>
        )}

        <div style={{ flex: 1 }} />

        {amHost && !st.started && (
          <button onClick={() => click("addbot")} style={{ ...textBtn(), alignSelf: "center", border: `1px dashed ${C.rim}`, padding: "9px 14px", borderRadius: 11, margin: "16px 0 4px", color: C.mand }}>
            <Plus size={14} /> {t.addBot}
          </button>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
          {!gate ? (
            amHost ? (
              <button onClick={() => click("opengate")} disabled={!enough} style={{ ...primaryBtn(), opacity: enough ? 1 : 0.45 }}><Play size={18} /> {enough ? t.openRules : t.minPlayers}</button>
            ) : <div style={waitBox()}>{t.waitHost}</div>
          ) : amHost ? (
            <>
              <div style={{ ...waitBox(), color: allReady ? "#9be3b0" : C.muted }}>{allReady ? t.allReady : t.waitAllReady}</div>
              <button onClick={() => click("start")} disabled={!allReady} style={{ ...primaryBtn(), opacity: allReady ? 1 : 0.45 }}><Play size={18} /> {t.startGame}</button>
              <button onClick={() => click("closegate")} style={ghostBtn()}><ChevronLeft size={16} /> {t.back}</button>
            </>
          ) : (
            <button onClick={() => click("gateready", { on: !myReady })} style={myReady ? readyDoneBtn() : primaryBtn()}>{myReady ? <><Check size={18} /> {t.imReady}</> : t.imReady}</button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================ GAME ============================ */
function Game({ t, st, status, code, myPid, amHost, reduced, act, serverNow, simLatency, muted, onMute, onLeave, onAdmin, onUitleg }) {
  const E = st.ezelen;
  const players = st.players || [];
  const me = players.find((p) => p.id === myPid);
  const opponents = players.filter((p) => p.id !== myPid);

  const phase = E ? E.phase : "passing";
  const myHand = (E && E.yourHand) || [];
  const mySet = E ? E.yourSet : null;
  const myCount = E ? E.yourCount : myHand.length;
  const bestRank = E ? E.yourBestRank : null;
  const bestCount = E ? E.yourBestCount : 0;
  const youPending = E ? E.youPending : null;            // the card you chose to shove (lockstep)
  const pendingIds = (E && E.pendingIds) || [];
  const pendingCount = pendingIds.length;
  const passTotal = E ? (E.passTotal || players.length) : players.length;
  const canPass = phase === "passing" && !mySet;          // pick / re-pick any time until the swap
  const declarerId = E ? E.declarerId : null;
  const iAmDeclarer = declarerId === myPid;
  const reactedIds = (E && E.reactedIds) || [];
  const iReacted = reactedIds.includes(myPid);

  const [myMs, setMyMs] = useState(null);
  const lastRace = useRef(0);
  useEffect(() => {
    if (phase === "race" && E.raceStartTs !== lastRace.current) { lastRace.current = E.raceStartTs; setMyMs(null); }
    if (phase !== "race") setMyMs(null);
  }, [phase, E && E.raceStartTs]);

  // ---- sound cues on phase / round transitions ----
  const prevPhase = useRef(phase), prevRound = useRef(E ? E.round : 0), prevResultRound = useRef(-1);
  useEffect(() => {
    const round = E ? E.round : 0;
    if (phase === "race" && prevPhase.current !== "race" && !iAmDeclarer) sfx.race();
    if (phase === "passing" && prevPhase.current === "result") sfx.deal();
    if (round !== prevRound.current && phase === "passing") { prevRound.current = round; }
    if (phase === "result" && prevPhase.current !== "result" && E.result && prevResultRound.current !== round) {
      prevResultRound.current = round;
      if (E.result.loserId === myPid) sfx.letter();
    }
    if (phase === "gameover" && prevPhase.current !== "gameover") sfx.gameOver();
    prevPhase.current = phase;
  }, [phase, E && E.round]); // eslint-disable-line

  // fresh-card arrival -> soft receive sound + animation
  const prevIds = useRef([]);
  const freshId = useRef(null);
  useEffect(() => {
    const ids = myHand.map((c) => c.id);
    const added = ids.find((id) => !prevIds.current.includes(id));
    if (added != null && prevIds.current.length && phase === "passing") { freshId.current = added; sfx.receive(); }
    else if (!prevIds.current.length) freshId.current = null;
    prevIds.current = ids;
  }, [myHand.map((c) => c.id).join(",")]); // eslint-disable-line

  const doReact = useCallback(() => {
    if (phase !== "race" || iAmDeclarer || iReacted || myMs != null) return;
    const ms = Math.max(0, Math.round(serverNow() - (E.raceStartTs || serverNow())));
    setMyMs(ms); sfx.slam();
    const fire = () => act("react", { ms });
    if (simLatency > 0) setTimeout(fire, simLatency); else fire();
  }, [phase, iAmDeclarer, iReacted, myMs, serverNow, E, act, simLatency]);
  const doDeclare = useCallback(() => { if (phase === "passing" && mySet) { sfx.declare(); act("declare"); } }, [phase, mySet, act]);
  const doPass = useCallback((cardId) => { if (canPass) { sfx.pass(); act("pass", { cardId }); } }, [canPass, act]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <TopBar t={t} st={st} status={status} code={code} amHost={amHost} muted={muted} onMute={onMute} onLeave={onLeave} onAdmin={onAdmin} onUitleg={onUitleg} />
      <Table>
        {arcPositions(opponents.length).map((pos, i) => (
          <OpponentSeat key={opponents[i].id} t={t} p={opponents[i]} pos={pos} phase={phase} isDeclarer={opponents[i].id === declarerId} reacted={reactedIds.includes(opponents[i].id)} chose={pendingIds.includes(opponents[i].id)} count={E ? (E.counts[opponents[i].id] || 0) : 0} reduced={reduced} />
        ))}
        <div style={{ position: "absolute", left: "50%", top: "49%", transform: "translate(-50%,-50%)", zIndex: 6 }}>
          <CenterHero t={t} phase={phase} mySet={mySet} bestRank={bestRank} bestCount={bestCount} myCount={myCount}
            iAmDeclarer={iAmDeclarer} iReacted={iReacted} myMs={myMs} onDeclare={doDeclare} onReact={doReact} reduced={reduced} />
        </div>
        {me && (
          <div style={{ position: "absolute", left: "50%", bottom: "5%", transform: "translateX(-50%)", textAlign: "center", zIndex: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.mand }}>{me.name} ({t.you})</div>
            <Pips letters={me.letters || 0} isLoser={E && E.result && E.result.loserId === myPid} />
          </div>
        )}
      </Table>

      <div style={{ textAlign: "center", minHeight: 22, padding: "10px 16px 2px", fontSize: 13 }}>
        <StatusLine t={t} phase={phase} E={E} bestRank={bestRank} bestCount={bestCount} iAmDeclarer={iAmDeclarer} iReacted={iReacted} myMs={myMs} players={players} youPending={youPending} pendingCount={pendingCount} passTotal={passTotal} />
      </div>

      <div style={{ padding: "4px 12px calc(16px + env(safe-area-inset-bottom))" }}>
        <div style={{ textAlign: "center", fontSize: 11, color: C.faint, marginBottom: 8 }}>
          {phase === "passing" ? (mySet ? t.handHasSet : youPending != null ? t.handChosen(pendingCount, passTotal) : t.handChoose) : t.yourCards}
        </div>
        <Fan hand={myHand} collectRank={bestRank} disabled={!canPass} freshId={freshId.current} locked={!!mySet} pendingId={youPending} onTap={doPass} reduced={reduced} />
      </div>

      {phase === "result" && E.result && <ResultOverlay t={t} E={E} myPid={myPid} amHost={amHost} act={act} />}
      {phase === "gameover" && <GameOverOverlay t={t} E={E} myPid={myPid} amHost={amHost} act={act} />}
    </div>
  );
}

/* ---- the skeuomorphic table: walnut rail + green felt + non-clipping seats ---- */
function Table({ children }) {
  return (
    <div style={{ padding: "10px 14px 2px" }}>
      <div style={{ position: "relative", width: "100%", aspectRatio: "1 / 1.04", borderRadius: "46% / 44%", padding: 15, background: `linear-gradient(160deg, ${C.rail0}, ${C.rail1} 48%, ${C.rail2})`, boxShadow: "0 22px 44px rgba(0,0,0,0.55), 0 2px 0 rgba(255,255,255,0.10) inset, 0 -10px 22px rgba(0,0,0,0.45) inset" }}>
        <div aria-hidden style={{ position: "absolute", inset: 0, borderRadius: "46% / 44%", backgroundImage: WOOD_GRAIN, opacity: 0.5, mixBlendMode: "overlay", pointerEvents: "none" }} />
        <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: "44% / 42%", background: `radial-gradient(120% 120% at 50% 42%, ${C.feltHi} 0%, ${C.feltMid} 52%, ${C.feltLo} 100%)`, boxShadow: `0 0 0 2px ${C.rail2} inset, 0 10px 30px rgba(0,0,0,0.55) inset, 0 -2px 8px rgba(0,0,0,0.4) inset`, overflow: "hidden" }}>
          <div aria-hidden style={{ position: "absolute", inset: 0, backgroundImage: FELT_NOISE, backgroundSize: "200px 200px", opacity: 0.12, mixBlendMode: "soft-light", pointerEvents: "none" }} />
          <div aria-hidden style={{ position: "absolute", inset: 9, borderRadius: "44% / 42%", border: `1.5px dashed ${C.stitch}`, opacity: 0.7, pointerEvents: "none" }} />
          <div aria-hidden style={{ position: "absolute", inset: 0, background: "radial-gradient(42% 36% at 50% 48%, rgba(0,0,0,0.28), transparent 70%)", pointerEvents: "none" }} />
        </div>
        {/* seats layer — sibling of the felt so seats are NEVER clipped by its overflow */}
        <div style={{ position: "absolute", inset: 15, pointerEvents: "none" }}>
          <div style={{ position: "absolute", inset: 0, pointerEvents: "auto" }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

function OpponentSeat({ t, p, pos, phase, isDeclarer, reacted, chose, count, reduced }) {
  const choosing = phase === "passing" && p.connected && !isDeclarer && !chose; // still picking their pass
  const passedOk = phase === "passing" && chose && !isDeclarer;
  const dim = phase === "race" && !reacted && !isDeclarer ? 1 : phase === "race" ? 0.5 : 1;
  const ring = isDeclarer ? C.alarm : reacted && phase === "race" ? C.mand : passedOk ? "rgba(123,216,143,0.6)" : C.rim;
  const statusTxt = isDeclarer ? t.fourAlike : reacted && phase === "race" ? t.tapped : !p.connected ? t.offline : phase === "passing" ? (chose ? t.chosePassed : t.choosing) : t.nCards(count);
  const statusColor = isDeclarer ? C.alarm : reacted && phase === "race" ? C.mand : passedOk ? "#7bd88f" : C.faint;
  return (
    <div style={{ position: "absolute", left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%,-50%)", width: 72, textAlign: "center", zIndex: 5, opacity: dim, transition: "opacity 160ms" }}>
      <div style={{ position: "relative", width: 44, height: 44, margin: "0 auto" }}>
        <Avatar p={p} size={44} ring={ring} />
        {isDeclarer && phase === "race" && <span aria-hidden className={reduced ? "" : "ez-alarmring"} style={{ position: "absolute", inset: -4, borderRadius: "50%", border: `2px solid ${C.alarm}` }} />}
        {choosing && <span aria-hidden style={{ position: "absolute", top: -2, right: -2, width: 9, height: 9, borderRadius: "50%", background: C.mand, boxShadow: `0 0 8px ${C.mand}`, animation: reduced ? "none" : "ezThink 1s ease-in-out infinite" }} />}
        {passedOk && <span aria-hidden style={{ position: "absolute", top: -3, right: -3, width: 15, height: 15, borderRadius: "50%", background: "#7bd88f", display: "grid", placeItems: "center", color: "#0c1413" }}><Check size={10} /></span>}
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: C.text, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
      <div style={{ fontSize: 10, color: statusColor, height: 13 }}>{statusTxt}</div>
      <Pips letters={p.letters || 0} small />
    </div>
  );
}

function CenterHero({ t, phase, mySet, bestRank, bestCount, myCount, iAmDeclarer, iReacted, myMs, onDeclare, onReact, reduced }) {
  const SIZE = 132;
  if (phase === "race") {
    if (iAmDeclarer) {
      return (
        <div style={{ width: SIZE, height: SIZE, borderRadius: "50%", display: "grid", placeItems: "center", textAlign: "center", background: "rgba(242,145,63,0.12)", border: `2px solid ${C.mand}`, color: C.mand, padding: 14 }}>
          <div><div style={{ fontFamily: FR, fontWeight: 700, fontSize: 17 }}>{t.safe}</div><div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{t.youFirst}</div></div>
        </div>
      );
    }
    const live = !iReacted && myMs == null;
    return (
      <button onClick={onReact} disabled={!live} aria-label={t.slamNow} className={`ez-slam ${live && !reduced ? "ez-slam-live" : ""}`}
        style={{ width: SIZE, height: SIZE, borderRadius: "50%", border: "none", cursor: live ? "pointer" : "default", display: "grid", placeItems: "center", color: "#fff",
          background: live ? `radial-gradient(circle at 50% 38%, ${C.alarm}, ${C.alarmDeep})` : "rgba(255,255,255,0.05)",
          boxShadow: live ? `0 0 0 2px ${C.alarm}, 0 14px 40px ${C.glowAlarm}` : "none", transition: "background 140ms" }}>
        <div style={{ textAlign: "center" }}>
          <Hand size={live ? 36 : 26} color={live ? "#fff" : C.faint} fill={live ? "rgba(255,255,255,0.18)" : "none"} />
          <div style={{ fontFamily: FR, fontWeight: 800, fontSize: live ? 19 : 14, letterSpacing: "0.04em", marginTop: 4, color: live ? "#fff" : C.faint }}>{myMs != null ? `${myMs} ms` : live ? t.slamNow : t.tapped}</div>
        </div>
      </button>
    );
  }
  if (phase === "passing" && mySet) {
    return (
      <button onClick={onDeclare} aria-label={t.vier} className={reduced ? "" : "ez-declare"}
        style={{ width: SIZE, height: SIZE, borderRadius: "50%", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: "#241a08", background: `radial-gradient(circle at 50% 36%, ${C.mandLite}, ${C.mandDeep})`, boxShadow: `0 0 0 2px ${C.mand}, 0 14px 40px ${C.glowWarm}` }}>
        <div style={{ textAlign: "center" }}><div style={{ fontFamily: FR, fontWeight: 900, fontSize: 26, lineHeight: 1 }}>{t.vier}</div><div style={{ fontSize: 11, fontWeight: 700, marginTop: 4 }}>{t.slamToTable}</div></div>
      </button>
    );
  }
  const frac = Math.min(1, (bestCount || 0) / 4);
  const r = (SIZE - 16) / 2, circ = 2 * Math.PI * r;
  return (
    <div style={{ width: SIZE, height: SIZE, position: "relative", display: "grid", placeItems: "center" }}>
      <svg width={SIZE} height={SIZE} style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="8" />
        <circle cx={SIZE / 2} cy={SIZE / 2} r={r} fill="none" stroke={C.mand} strokeWidth="8" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - frac)} style={{ transition: "stroke-dashoffset 320ms ease", filter: `drop-shadow(0 0 6px ${C.glowWarm})` }} />
      </svg>
      <div aria-hidden className={reduced ? "" : "ez-flow"} style={{ position: "absolute", inset: 12, borderRadius: "50%", border: `1px dashed ${C.rim}` }} />
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: FR, fontWeight: 800, fontSize: 30, color: C.text, lineHeight: 1 }}>{bestCount || 0}<span style={{ fontSize: 16, color: C.faint }}>/4</span></div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{bestRank ? t.rank(bestRank) : t.collectWord}</div>
        {myCount < 4 && <div style={{ fontSize: 9.5, color: C.faint, marginTop: 1 }}>{t.waitCard}</div>}
      </div>
    </div>
  );
}

function StatusLine({ t, phase, E, bestRank, bestCount, iAmDeclarer, iReacted, myMs, players, youPending, pendingCount, passTotal }) {
  if (phase === "race") {
    const decl = players.find((p) => p.id === E.declarerId);
    if (iAmDeclarer) return <span style={{ color: C.mand, fontFamily: FR }}>{t.safeFirst}</span>;
    if (myMs != null || iReacted) return <span style={{ color: C.muted }}>{t.tappedWait(myMs)}</span>;
    return <span style={{ color: C.alarm, fontFamily: FR, fontWeight: 600 }}>{t.raceCall(decl ? decl.name : "?", t.rank(E.rank))}</span>;
  }
  if (phase === "passing") {
    if (E && E.yourSet) return <span style={{ color: C.mand, fontWeight: 600 }}>{t.fourReady(t.rank(E.yourSet))}</span>;
    if (youPending != null) return <span style={{ color: C.muted }}>{t.chosenWait(pendingCount, passTotal)}</span>;
    return <span style={{ color: C.muted }}>{t.collect(bestCount || 0, t.rank(bestRank))}</span>;
  }
  return <span style={{ color: C.faint }}>&nbsp;</span>;
}

// In lockstep the hand is always at most 4 cards, so they sit side by side with a
// small gap (no overlap) at the real card aspect ratio (320x465) — every card,
// incl. its index corners, is fully visible. The card you chose to shove lifts up.
function Fan({ hand, collectRank, disabled, freshId, locked, pendingId, onTap, reduced }) {
  const n = hand.length;
  const W = n >= 6 ? 52 : 64; // shrink a touch only if somehow more than 5 cards
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "flex-end", gap: 6, minHeight: 110 }}>
      {hand.map((c, i) => {
        const mid = (n - 1) / 2;
        const rot = (i - mid) * 2.5;
        const glow = collectRank && c.rank === collectRank;
        const chosen = pendingId != null && c.id === pendingId;
        const lift = chosen ? 18 : glow ? 7 : 0;
        const src = cardSrc(c);
        const ringShadow = chosen ? `0 0 0 2.5px ${C.mandLite}, 0 12px 22px ${C.glowWarm}` : glow ? `0 0 0 2px ${C.mand}, 0 8px 18px ${C.glowWarm}` : "0 4px 12px rgba(0,0,0,0.5)";
        return (
          <button key={c.id} onClick={() => onTap(c.id)} disabled={disabled} className={freshId === c.id && !reduced ? "ez-newcard" : ""} aria-label={`${c.rank} ${c.suit.sym}`}
            style={{ width: W, aspectRatio: "320 / 465", padding: 0, border: "none", borderRadius: 7, background: "transparent",
              transform: `rotate(${rot}deg) translateY(${-lift}px)`, transformOrigin: "bottom center",
              cursor: disabled ? "default" : "pointer", opacity: disabled && !locked && !chosen ? 0.9 : 1, position: "relative", transition: "transform 160ms" }}>
            {src ? <img src={src} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 7, display: "block", boxShadow: ringShadow }} /> : <FallbackCard c={c} glow={glow || chosen} />}
          </button>
        );
      })}
    </div>
  );
}
function FallbackCard({ c, glow }) {
  return (
    <div style={{ width: "100%", height: "100%", borderRadius: 8, padding: 6, background: C.cream, color: c.suit.red ? C.redSuit : C.ink, display: "flex", flexDirection: "column", justifyContent: "space-between", boxShadow: glow ? `0 0 0 2px ${C.mand}, 0 8px 18px ${C.glowWarm}` : "0 4px 12px rgba(0,0,0,0.5)" }}>
      <span style={{ fontSize: 16, fontWeight: 800, lineHeight: 1 }}>{c.rank}</span>
      <span style={{ alignSelf: "center", fontSize: 22 }}>{c.suit.sym}</span>
      <span style={{ fontSize: 16, fontWeight: 800, alignSelf: "flex-end", transform: "rotate(180deg)", lineHeight: 1 }}>{c.rank}</span>
    </div>
  );
}

function Pips({ letters, isLoser, small }) {
  const sz = small ? 13 : 16;
  return (
    <div style={{ display: "flex", gap: 2, justifyContent: "center", marginTop: 4 }}>
      {["E", "Z", "E", "L"].map((l, i) => {
        const on = i < letters;
        const newest = on && isLoser && i === letters - 1;
        return <span key={i} className={newest ? "ez-stamp" : ""} style={{ fontFamily: FR, fontWeight: 700, width: sz, height: sz + 2, lineHeight: `${sz + 2}px`, fontSize: small ? 10 : 12, textAlign: "center", color: on ? "#241a08" : C.faint, background: on ? `linear-gradient(180deg, ${C.mandLite}, ${C.mandDeep})` : "transparent", border: on ? "none" : `1px solid ${C.rim}`, borderRadius: 4 }}>{l}</span>;
      })}
    </div>
  );
}

function Avatar({ p, size, ring }) {
  const r = ring || C.rim;
  return p.avatar
    ? <img src={p.avatar} alt="" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: `1.5px solid ${r}` }} />
    : <div style={{ width: size, height: size, borderRadius: "50%", display: "grid", placeItems: "center", fontWeight: 700, fontSize: size * 0.4, color: C.text, background: "rgba(242,145,63,0.12)", border: `1.5px solid ${r}` }}>{(p.name || "?")[0].toUpperCase()}</div>;
}

/* ============================ OVERLAYS ============================ */
function ResultOverlay({ t, E, myPid, amHost, act }) {
  const R = E.result;
  const youLost = R.loserId === myPid;
  const youDeclared = R.declarerId === myPid;
  const myMs = R.reactions ? R.reactions[myPid] : null;
  return (
    <Overlay>
      <div style={{ fontFamily: FR, fontSize: 13, color: C.muted, marginBottom: 6 }}>{t.collectedFour(R.declarerName, t.rank(R.rank))}</div>
      <div style={{ fontFamily: FR, fontWeight: 700, fontSize: 26, color: C.alarm, marginBottom: 8 }}>{youLost ? t.youTooLate : t.xTooLate(R.loserName)}</div>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 20 }}>{youDeclared ? t.youWereSafe : myMs == null ? t.notInTime : t.yourReaction(myMs)} {t.aLetterAdded}</div>
      <Pips letters={R.letters} isLoser />
      {amHost ? <button onClick={() => { sfx.tap(); act("nextround"); }} style={{ ...primaryBtn(), marginTop: 22 }}><ChevronRight size={17} /> {t.nextRound}</button> : <div style={{ fontSize: 12, color: C.faint, marginTop: 20 }}>{t.nextSoon}</div>}
    </Overlay>
  );
}

function GameOverOverlay({ t, E, myPid, amHost, act }) {
  const youLost = E.ezelId === myPid;
  const needsOpdracht = !E.opdracht; // "self" mode: the ezel writes it
  const [txt, setTxt] = useState("");
  return (
    <Overlay>
      <div style={{ fontFamily: FR, fontSize: 14, color: C.muted, marginBottom: 4 }}>{t.ezelFull}</div>
      <div style={{ fontFamily: FR, fontWeight: 700, fontSize: 30, color: C.alarm, marginBottom: 14 }}>{youLost ? t.youAreEzel : t.xIsEzel(E.ezelName)}</div>

      {E.opdracht ? (
        <div style={{ padding: "12px 16px", borderRadius: 12, background: "rgba(242,145,63,0.10)", border: `1px solid ${C.rim}`, color: C.text, fontSize: 14, marginBottom: 22 }}>{t.opdrachtPrefix} {E.opdracht}</div>
      ) : youLost ? (
        <div style={{ marginBottom: 18, textAlign: "left" }}>
          <div style={{ fontSize: 12, color: C.faint, marginBottom: 6 }}>{t.writeOwn}</div>
          <textarea value={txt} onChange={(e) => setTxt(e.target.value.slice(0, 160))} placeholder={t.opdrachtPh} rows={2}
            style={{ ...inputStyle(), resize: "none", marginBottom: 10 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { sfx.tap(); if (txt.trim()) act("ez_opdracht", { text: txt.trim() }); }} disabled={!txt.trim()} style={{ ...primaryBtn(), opacity: txt.trim() ? 1 : 0.45, flex: 1 }}>{t.lockIn}</button>
            <button onClick={() => { sfx.tap(); act("ez_opdracht", { auto: true }); }} style={{ ...ghostBtn(), flex: 1 }}>{t.letGamePick}</button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 22 }}>{t.ezelWriting}</div>
      )}

      {amHost ? (
        <>
          <button onClick={() => { sfx.newGame(); act("newgame"); }} style={primaryBtn()}><RotateCcw size={17} /> {t.playAgain}</button>
          <button onClick={() => { sfx.tap(); act("tolobby"); }} style={{ ...ghostBtn(), marginTop: 10 }}><Users size={16} /> {t.backToLobby}</button>
        </>
      ) : <div style={{ fontSize: 12.5, color: C.faint }}>{t.waitHostNewGame}</div>}
    </Overlay>
  );
}

function Uitleg({ t, onClose }) {
  return (
    <Overlay onClose={onClose}>
      <div style={{ fontFamily: FR, fontWeight: 700, fontSize: 22, color: C.mand, marginBottom: 16 }}>{t.howTitle}</div>
      <div style={{ textAlign: "left", display: "flex", flexDirection: "column", gap: 12 }}>
        {t.how.map(([title, desc], i) => (
          <div key={i}>
            <div style={{ fontWeight: 700, fontSize: 13.5, color: C.text }}>{i + 1}. {title}</div>
            <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>{desc}</div>
          </div>
        ))}
      </div>
      <button onClick={onClose} style={{ ...primaryBtn(), marginTop: 22 }}>{t.gotIt}</button>
    </Overlay>
  );
}

function AdminSheet({ t, st, myPid, act, onClose, simLatency, setSimLatency }) {
  const players = (st && st.players) || [];
  const started = st && st.started;
  const [target, setTarget] = useState(myPid);
  const [letters, setLetters] = useState(0);
  const targets = players.length ? players : [];
  const targetValid = targets.find((p) => p.id === target) ? target : (targets[0] && targets[0].id);
  return (
    <Overlay onClose={onClose} align="stretch">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontFamily: FR, fontWeight: 700, fontSize: 18, color: C.mand, display: "flex", gap: 8, alignItems: "center" }}><Settings2 size={16} /> {t.admin}</div>
        <button onClick={onClose} style={iconBtn()}><X size={16} /></button>
      </div>
      <AdminRow label={t.aTable}>
        <button onClick={() => act("addbot")} disabled={started} style={adminBtn()}>{t.aTestbot}</button>
        <button onClick={() => act("ez_forcedeal")} style={adminBtn()}>{t.aForceDeal}</button>
      </AdminRow>
      <div style={{ fontSize: 11, color: C.faint, margin: "14px 0 6px" }}>{t.aPlayer}</div>
      <select value={targetValid} onChange={(e) => setTarget(e.target.value)} style={{ ...inputStyle(), marginBottom: 10 }}>
        {targets.map((p) => <option key={p.id} value={p.id} style={{ color: "#000" }}>{p.name}</option>)}
      </select>
      <AdminRow label={t.aForce}>
        <button onClick={() => act("ez_forceset", { playerId: targetValid })} disabled={!started} style={adminBtn()}>{t.aGiveSet}</button>
        <button onClick={() => act("ez_forcedeclare", { playerId: targetValid })} disabled={!started} style={adminBtn()}>{t.aMakeSlam}</button>
      </AdminRow>
      <div style={{ fontSize: 11, color: C.faint, margin: "14px 0 6px" }}>{t.aLetters}: {letters}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="range" min={0} max={4} value={letters} onChange={(e) => setLetters(Number(e.target.value))} style={{ flex: 1, accentColor: C.mand }} />
        <button onClick={() => act("ez_setletters", { playerId: targetValid, n: letters })} style={adminBtn()}>{t.aSet}</button>
      </div>
      <div style={{ fontSize: 11, color: C.faint, margin: "16px 0 6px" }}>{t.aSimLatency}: {simLatency} ms <span>{t.aSimHint}</span></div>
      <input type="range" min={0} max={1500} step={50} value={simLatency} onChange={(e) => setSimLatency(Number(e.target.value))} style={{ width: "100%", accentColor: C.alarm }} />
    </Overlay>
  );
}
function AdminRow({ label, children }) {
  return <div style={{ marginBottom: 4 }}><div style={{ fontSize: 11, color: C.faint, margin: "8px 0 6px" }}>{label}</div><div style={{ display: "flex", gap: 8 }}>{children}</div></div>;
}

/* ============================ AVATAR (ported from Kingsen) ============================ */
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith("image/")) { reject(new Error("not an image")); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}
const AV_VIEW = 256, AV_OUT = 256, AV_MAXZOOM = 4;
function canvasToAvatarURL(c) {
  for (const q of [0.82, 0.72, 0.62, 0.5]) { const url = c.toDataURL("image/jpeg", q); if (url.length <= 48000) return url; }
  return c.toDataURL("image/jpeg", 0.42);
}
function AvatarPicker({ t, value, onChange }) {
  const camRef = useRef(null), upRef = useRef(null);
  const [pending, setPending] = useState(null);
  async function handle(file, inputEl) { if (inputEl) inputEl.value = ""; if (!file) return; try { setPending(await fileToDataURL(file)); } catch { /* */ } }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <button type="button" onClick={() => { sfx.tap(); upRef.current && upRef.current.click(); }} aria-label={t.addPhoto} style={{ position: "relative", background: "none", border: "none", padding: 0, cursor: "pointer" }}>
        {value ? <img src={value} alt="" style={{ width: 54, height: 54, borderRadius: "50%", objectFit: "cover", border: `1.5px solid ${C.rim}` }} />
          : <span style={{ width: 54, height: 54, borderRadius: "50%", display: "grid", placeItems: "center", background: "rgba(242,145,63,0.1)", border: `1.5px solid ${C.rim}`, color: C.mand }}><User size={24} /></span>}
        <span style={{ position: "absolute", bottom: -2, right: -2, width: 20, height: 20, borderRadius: "50%", display: "grid", placeItems: "center", background: `linear-gradient(180deg, ${C.mandLite}, ${C.mandDeep})`, color: "#241a08" }}>{value ? <Check size={12} /> : <Plus size={12} />}</span>
      </button>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" onClick={() => { sfx.tap(); camRef.current && camRef.current.click(); }} style={{ ...miniBtn() }}><Camera size={13} /> {t.takePhoto}</button>
          <button type="button" onClick={() => { sfx.tap(); upRef.current && upRef.current.click(); }} style={{ ...miniBtn() }}><Upload size={13} /> {t.uploadPhoto}</button>
          {value && <button type="button" onClick={() => onChange("")} aria-label={t.removePhoto} style={{ ...miniBtn(), color: "#f0a0a0", borderColor: "rgba(240,138,138,0.4)", padding: "6px 8px" }}><X size={14} /></button>}
        </div>
        <span style={{ fontSize: 10, color: C.faint }}>{t.photoOptional}</span>
      </div>
      <input ref={camRef} type="file" accept="image/*" capture="user" style={{ display: "none" }} onChange={(e) => handle(e.target.files && e.target.files[0], e.target)} />
      <input ref={upRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handle(e.target.files && e.target.files[0], e.target)} />
      {pending && <AvatarCropper t={t} src={pending} onCancel={() => setPending(null)} onConfirm={(url) => { onChange(url); setPending(null); }} />}
    </div>
  );
}
function AvatarCropper({ t, src, onCancel, onConfirm }) {
  const [img, setImg] = useState(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const baseRef = useRef(1), gRef = useRef(null), stateRef = useRef({ scale: 1, pan: { x: 0, y: 0 } });
  stateRef.current = { scale, pan };
  useEffect(() => {
    let alive = true; const im = new Image();
    im.onload = () => { if (!alive) return; baseRef.current = AV_VIEW / Math.max(1, Math.min(im.naturalWidth, im.naturalHeight)); setImg(im); setScale(1); setPan({ x: 0, y: 0 }); };
    im.onerror = () => { if (alive) onCancel && onCancel(); };
    im.src = src; return () => { alive = false; };
  }, [src]); // eslint-disable-line
  function clampPan(x, y, sc, im = img) {
    if (!im) return { x: 0, y: 0 };
    const mx = Math.max(0, (im.naturalWidth * baseRef.current * sc - AV_VIEW) / 2);
    const my = Math.max(0, (im.naturalHeight * baseRef.current * sc - AV_VIEW) / 2);
    return { x: Math.max(-mx, Math.min(mx, x)), y: Math.max(-my, Math.min(my, y)) };
  }
  function setZoom(sc) { const ns = Math.max(1, Math.min(AV_MAXZOOM, sc)); setScale(ns); setPan((p) => clampPan(p.x, p.y, ns)); }
  const touchDist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  function onTouchStart(e) { const ts = e.touches; if (ts.length >= 2) gRef.current = { mode: "pinch", d: touchDist(ts[0], ts[1]), scale: stateRef.current.scale, pan: stateRef.current.pan }; else if (ts.length === 1) gRef.current = { mode: "pan", x: ts[0].clientX, y: ts[0].clientY, pan: stateRef.current.pan }; }
  function onTouchMove(e) {
    const g = gRef.current; if (!g) return; const ts = e.touches;
    if (g.mode === "pinch" && ts.length >= 2) { const ns = Math.max(1, Math.min(AV_MAXZOOM, g.scale * (touchDist(ts[0], ts[1]) / Math.max(1, g.d)))); setScale(ns); setPan(clampPan(g.pan.x, g.pan.y, ns)); }
    else if (g.mode === "pan" && ts.length === 1) setPan(clampPan(g.pan.x + (ts[0].clientX - g.x), g.pan.y + (ts[0].clientY - g.y), stateRef.current.scale));
  }
  function onTouchEnd(e) { if (e.touches.length === 0) gRef.current = null; else if (e.touches.length === 1) gRef.current = { mode: "pan", x: e.touches[0].clientX, y: e.touches[0].clientY, pan: stateRef.current.pan }; }
  function onMouseDown(e) { e.preventDefault(); const start = { x: e.clientX, y: e.clientY, pan: stateRef.current.pan }; const move = (ev) => setPan(clampPan(start.pan.x + (ev.clientX - start.x), start.pan.y + (ev.clientY - start.y), stateRef.current.scale)); const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); }; window.addEventListener("mousemove", move); window.addEventListener("mouseup", up); }
  function onWheel(e) { setZoom(stateRef.current.scale * (e.deltaY < 0 ? 1.12 : 0.89)); }
  function confirm() {
    if (!img) return;
    const bs = baseRef.current * scale;
    const imgLeft = AV_VIEW / 2 + pan.x - (img.naturalWidth * bs) / 2;
    const imgTop = AV_VIEW / 2 + pan.y - (img.naturalHeight * bs) / 2;
    const srcSize = AV_VIEW / bs;
    const c = document.createElement("canvas"); c.width = AV_OUT; c.height = AV_OUT;
    const g = c.getContext("2d"); g.fillStyle = "#0c1413"; g.fillRect(0, 0, AV_OUT, AV_OUT);
    g.drawImage(img, -imgLeft / bs, -imgTop / bs, srcSize, srcSize, 0, 0, AV_OUT, AV_OUT);
    sfx.tap(); onConfirm(canvasToAvatarURL(c));
  }
  const dW = img ? img.naturalWidth * baseRef.current * scale : 0;
  const dH = img ? img.naturalHeight * baseRef.current * scale : 0;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 90, display: "grid", placeItems: "center", padding: 22, background: "rgba(7,12,11,0.9)", backdropFilter: "blur(4px)" }}>
      <div style={{ width: "100%", maxWidth: 340, borderRadius: 18, padding: 18, background: "linear-gradient(180deg,#14201d,#0e1816)", border: `1px solid ${C.rim}` }}>
        <div style={{ textAlign: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{t.cropTitle}</div>
          <div style={{ marginTop: 4, fontSize: 11, color: C.faint, display: "flex", gap: 5, justifyContent: "center", alignItems: "center" }}><Hand size={12} /> {t.cropHint}</div>
        </div>
        <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onMouseDown={onMouseDown} onWheel={onWheel}
          style={{ width: AV_VIEW, height: AV_VIEW, maxWidth: "100%", position: "relative", overflow: "hidden", borderRadius: 16, touchAction: "none", cursor: "grab", margin: "0 auto", background: "#07120f", userSelect: "none" }}>
          {img ? <img src={src} alt="" draggable={false} style={{ position: "absolute", left: "50%", top: "50%", width: dW, height: dH, maxWidth: "none", transform: `translate(-50%,-50%) translate(${pan.x}px,${pan.y}px)`, pointerEvents: "none" }} />
            : <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}><Loader2 size={22} className="ez-spin" style={{ color: C.mand }} /></div>}
          <div style={{ position: "absolute", left: "50%", top: "50%", width: AV_VIEW, height: AV_VIEW, transform: "translate(-50%,-50%)", borderRadius: "50%", boxShadow: "0 0 0 9999px rgba(7,12,11,0.62)", outline: `2px solid ${C.mand}`, pointerEvents: "none" }} />
        </div>
        <div style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => setZoom(stateRef.current.scale - 0.3)} style={{ ...iconBtn(), color: C.mand }} aria-label="zoom -"><Minus size={16} /></button>
          <input type="range" min="1" max={AV_MAXZOOM} step="0.01" value={scale} onChange={(e) => setZoom(parseFloat(e.target.value))} style={{ flex: 1, accentColor: C.mand }} aria-label={t.cropZoom} />
          <button onClick={() => setZoom(stateRef.current.scale + 0.3)} style={{ ...iconBtn(), color: C.mand }} aria-label="zoom +"><Plus size={16} /></button>
        </div>
        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
          <button onClick={() => { sfx.tap(); onCancel(); }} style={{ ...ghostBtn(), flex: 1 }}><X size={16} /> {t.cropCancel}</button>
          <button onClick={confirm} style={{ ...primaryBtn(), flex: 1 }}><Check size={16} /> {t.cropUse}</button>
        </div>
      </div>
    </div>
  );
}

/* ============================ small UI bits ============================ */
function Wordmark({ size = 28 }) { return <span style={{ fontFamily: FR, fontWeight: 900, fontSize: size, letterSpacing: "0.03em", color: C.mand, lineHeight: 1 }}>EZELEN</span>; }
function Medallion({ size = 40, glow }) { return <img src={medallionUrl} alt="Ezelen" draggable={false} style={{ width: size, height: size, objectFit: "contain", display: "block", filter: glow ? `drop-shadow(0 6px 18px ${C.glowWarm})` : "none" }} />; }
function Centered({ children }) { return <div style={{ flex: 1, minHeight: "70dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>{children}</div>; }
function Overlay({ children, onClose, align }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(7,12,11,0.8)", backdropFilter: "blur(7px)", WebkitBackdropFilter: "blur(7px)", display: "grid", placeItems: "center", padding: 22 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 380, background: "linear-gradient(180deg, #14201d, #0e1816)", border: `1px solid ${C.rim}`, borderRadius: 20, padding: 24, textAlign: align === "stretch" ? "left" : "center", boxShadow: "0 24px 60px rgba(0,0,0,0.6)", animation: "ezPop 240ms ease both" }}>{children}</div>
    </div>
  );
}
function inputStyle() { return { width: "100%", borderRadius: 11, padding: "12px 14px", marginBottom: 14, background: "rgba(255,255,255,0.05)", border: `1px solid ${C.rim}`, color: C.text, fontSize: 15, fontFamily: UI, outline: "none" }; }
function primaryBtn() { return { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "14px", borderRadius: 13, border: "none", cursor: "pointer", color: "#241a08", fontWeight: 700, fontSize: 15.5, fontFamily: UI, background: `linear-gradient(180deg, ${C.mandLite}, ${C.mandDeep})`, boxShadow: `0 8px 24px ${C.glowWarm}` }; }
function ghostBtn() { return { display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "13px 14px", borderRadius: 13, cursor: "pointer", color: C.text, fontWeight: 600, fontSize: 14.5, fontFamily: UI, background: "rgba(255,255,255,0.05)", border: `1px solid ${C.rim}` }; }
function readyDoneBtn() { return { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "14px", borderRadius: 13, cursor: "pointer", color: "#9be3b0", fontWeight: 700, fontSize: 15.5, fontFamily: UI, background: "rgba(123,216,143,0.14)", border: "1px solid rgba(123,216,143,0.5)" }; }
function textBtn() { return { display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: C.muted, fontSize: 12.5, cursor: "pointer", fontFamily: UI }; }
function iconBtn() { return { display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 9, background: "rgba(255,255,255,0.05)", border: `1px solid ${C.rim}`, color: C.muted, cursor: "pointer" }; }
function miniBtn() { return { display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: 9, fontSize: 12, fontFamily: UI, cursor: "pointer", color: C.mand, background: "transparent", border: `1px solid ${C.rim}` }; }
function adminBtn() { return { flex: 1, padding: "10px", borderRadius: 10, border: `1px solid ${C.rim}`, background: "rgba(242,145,63,0.06)", color: C.mand, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: UI }; }
function waitBox() { return { borderRadius: 12, padding: "12px 14px", textAlign: "center", fontSize: 13, color: C.muted, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.rim}` }; }

function arcPositions(k) {
  const pts = [];
  for (let i = 0; i < k; i++) {
    const t = k === 1 ? 0.5 : i / (k - 1);
    const ang = (198 - 216 * t) * Math.PI / 180;
    pts.push({ x: 50 + 41 * Math.cos(ang), y: 45 - 30 * Math.sin(ang) });
  }
  return pts;
}

function GlobalStyle() {
  return (
    <style>{`
      @keyframes ezThink { 0%,100% { opacity:.4; transform: scale(1) } 50% { opacity:1; transform: scale(1.3) } }
      @keyframes ezStamp { from { transform: scale(1.9) rotate(-12deg); opacity:0 } to { transform:none; opacity:1 } }
      @keyframes ezNewcard { from { transform: translateY(16px) scale(.85); opacity:0 } to { opacity:1 } }
      @keyframes ezAlarmRing { 0% { box-shadow:0 0 0 0 rgba(255,61,104,.6) } 100% { box-shadow:0 0 0 16px rgba(255,61,104,0) } }
      @keyframes ezSlamPulse { 0% { box-shadow:0 0 0 2px ${C.alarm},0 0 0 0 rgba(255,61,104,.5) } 100% { box-shadow:0 0 0 2px ${C.alarm},0 0 0 30px rgba(255,61,104,0) } }
      @keyframes ezDeclareBeat { 0%,100% { transform: scale(1) } 50% { transform: scale(1.05) } }
      @keyframes ezFlow { from { transform: rotate(0) } to { transform: rotate(360deg) } }
      @keyframes ezPop { from { transform: scale(.94); opacity:0 } to { transform:none; opacity:1 } }
      @keyframes ezPulse { 0%,100% { opacity:.5 } 50% { opacity:1 } }
      @keyframes ezSpin { to { transform: rotate(360deg) } }
      @keyframes splashFade { 0% { opacity:0 } 8% { opacity:1 } 92% { opacity:1 } 100% { opacity:1 } }
      @keyframes ezIn { from { opacity:0; transform: translateY(8px) } to { opacity:1; transform:none } }
      @keyframes ezTap { 0%,100% { opacity:.45 } 50% { opacity:.9 } }
      @keyframes ezCaret { 0%,49% { opacity:1 } 50%,100% { opacity:0 } }
      .ez-caret-blink { animation: ezCaret 1s steps(1,end) infinite; }
      .ez-stamp { animation: ezStamp 260ms ease both; }
      .ez-newcard { animation: ezNewcard 260ms ease both; }
      .ez-alarmring { animation: ezAlarmRing 1.1s ease-out infinite; }
      .ez-slam-live { animation: ezSlamPulse 1.05s ease-out infinite; }
      .ez-declare { animation: ezDeclareBeat 900ms ease-in-out infinite; }
      .ez-flow { animation: ezFlow 9s linear infinite; }
      .ez-spin { animation: ezSpin 800ms linear infinite; }
      .ez-slam:focus-visible, button:focus-visible { outline: 3px solid ${C.mandLite}; outline-offset: 3px; }
      input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid ${C.mand}; outline-offset: 1px; }
      @media (prefers-reduced-motion: reduce) { .ez-stamp,.ez-newcard,.ez-alarmring,.ez-slam-live,.ez-declare,.ez-flow,.ez-spin,.ez-caret-blink { animation: none !important; } }
    `}</style>
  );
}
