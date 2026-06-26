/* ------------------------------------------------------------------ */
/*  EZELEN — sound effects (WebAudio), a lean port of Kingsen's engine.  */
/*  Reuses the shared mp3 assets. One toggle mutes everything. Decodes    */
/*  the instant-feel cues up front and unlocks the AudioContext on the    */
/*  first user gesture (mobile browsers start it suspended).             */
/* ------------------------------------------------------------------ */
import clickUrl from "./assets/click.mp3";
import cardDrawUrl from "./assets/card-draw.mp3";
import cardOpenUrl from "./assets/card-open.mp3";
import reactGoodUrl from "./assets/react-good.mp3";
import reactLateUrl from "./assets/react-late.mp3";
import gameOverUrl from "./assets/game-over.mp3";
import cheersUrl from "./assets/cheers.mp3";
import mythicKingUrl from "./assets/mythic-king.mp3";
import twBellUrl from "./assets/tw-bell.mp3";
import twKeyUrl from "./assets/tw-key.mp3";

let _muted = false;
export function setMuted(m) { _muted = !!m; }
export function isMuted() { return _muted; }

let _ac = null;
function ac() {
  if (typeof window === "undefined") return null;
  if (!_ac) { try { _ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { _ac = null; } }
  return _ac;
}

const _cache = {};
function load(url) {
  const a = ac();
  if (!a) return Promise.resolve(null);
  if (_cache[url] && _cache[url].buf) return Promise.resolve(_cache[url].buf);
  if (_cache[url] && _cache[url].loading) return _cache[url].loading;
  const loading = fetch(url).then((r) => r.arrayBuffer()).then((ab) => new Promise((res, rej) => {
    a.decodeAudioData(ab, (buf) => { _cache[url] = { buf }; res(buf); }, rej);
  })).catch(() => null);
  _cache[url] = { loading };
  return loading;
}
function play(url, gain) {
  const a = ac();
  if (!a || _muted) return;
  if (a.state === "suspended") { try { a.resume(); } catch { /* */ } }
  load(url).then((buf) => {
    if (!buf || _muted) return;
    const src = a.createBufferSource();
    const g = a.createGain();
    src.buffer = buf;
    g.gain.value = Math.max(0.0001, gain == null ? 0.9 : gain);
    src.connect(g); g.connect(a.destination);
    try { src.start(); } catch { /* */ }
  });
}
// short synth note (used for the Artnomad intro sting)
function tone(freq, dur, gain, delay) {
  const a = ac();
  if (!a || _muted) return;
  const t0 = a.currentTime + (delay || 0);
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, t0);
  const peak = Math.max(0.0002, (gain || 0.1));
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(a.destination);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}
function vibrate(p) { try { if (!_muted && navigator.vibrate) navigator.vibrate(p); } catch { /* */ } }

const WARM = [clickUrl, cardDrawUrl, cardOpenUrl, reactGoodUrl, reactLateUrl, twKeyUrl, twBellUrl];
let _warmed = false;
export function warm() { if (_warmed) return; _warmed = true; if (ac()) WARM.forEach(load); }
// Call on the first user gesture so every later cue actually plays.
let _unlocked = false;
export function unlock() {
  const a = ac();
  if (!a) return;
  if (a.state === "suspended") { try { a.resume(); } catch { /* */ } }
  warm();
  if (!_unlocked) {
    try { const b = a.createBuffer(1, 1, 22050); const s = a.createBufferSource(); s.buffer = b; s.connect(a.destination); s.start(0); _unlocked = true; } catch { /* */ }
  }
}

export const sfx = {
  tap() { play(clickUrl, 0.6); },
  pass() { play(cardDrawUrl, 0.8); vibrate(10); },          // you slide a card to the left
  receive() { play(cardOpenUrl, 0.55); },                   // a card arrives in your hand
  declare() { play(mythicKingUrl, 0.9); vibrate([20, 40, 20]); }, // you have four -> slam to declare
  race() { vibrate(25); },                                  // the table flips to the alarm: only a haptic buzz (no jingle — add a sound here later)
  slam() { play(reactGoodUrl, 0.85); vibrate(12); },        // you reacted in the race
  letter() { play(reactLateUrl, 0.9); vibrate([40, 60, 40]); }, // you were last -> a letter
  gameOver() { play(gameOverUrl, 1.0); vibrate([40, 60, 40, 60, 120]); }, // the ezel is decided
  deal() { play(cardDrawUrl, 0.5); },                       // a fresh round is dealt
  newGame() { play(cheersUrl, 0.9); vibrate([15, 30]); },
  // Artnomad typewriter intro: a key-strike per character + a carriage bell at the end.
  type() { play(twKeyUrl, 0.9); },
  ding() { play(twBellUrl, 0.7); vibrate(20); },
};
