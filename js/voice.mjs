/* Character voices, synthesised.
 *
 * There are no voice recordings to ship and there is no budget for a cast, so
 * these are built the way cartoon voices were built before anyone could
 * afford a cast either: a buzzing source pushed through two resonant filters
 * that sit where a mouth's formants sit. Move the two filters and you move
 * between vowels; slide the pitch and you get a yelp, a grunt, or a question.
 *
 * Each character gets its own pitch and throat size, so BRICK really does
 * sound like a wall and DR VOLTA really is reedy - and because it is all
 * generated, a new character costs one line rather than a recording session.
 *
 * The rule that keeps it from becoming irritating: a voice only ever fires on
 * something the player DID, never on a timer, and the same line will not play
 * twice within a second.
 */

// Two formants per vowel, in Hz. These are the real ones, roughly.
const VOWELS = {
  a: [730, 1090],    // "ah"  - shock
  e: [530, 1840],    // "eh"  - effort
  o: [570, 840],     // "oh"  - dismay
  u: [300, 870],     // "oo"  - falling
  i: [270, 2290],    // "ee"  - panic
};

// Per-character voice. `pitch` is the base in Hz, `size` scales the formants:
// a big chest moves them down, a small one moves them up.
const VOICES = {
  gary:   { pitch: 168, size: 1.06, rasp: 0.30, wobble: 5.5 },
  brick:  { pitch: 96,  size: 0.80, rasp: 0.16, wobble: 3.0 },
  dusty:  { pitch: 112, size: 0.86, rasp: 0.42, wobble: 3.6 },
  pierre: { pitch: 138, size: 0.94, rasp: 0.26, wobble: 6.5 },
  penny:  { pitch: 226, size: 1.16, rasp: 0.18, wobble: 5.0 },
  volta:  { pitch: 205, size: 1.22, rasp: 0.50, wobble: 8.0 },
};
const DEFAULT = { pitch: 160, size: 1, rasp: 0.3, wobble: 5 };

/* Each line is: which vowel, how the pitch moves, how long, how loud. */
const LINES = {
  grunt:  { v: 'e', from: 1.00, to: 0.86, dur: 0.16, gain: 0.5 },   // jumping
  effort: { v: 'e', from: 0.94, to: 1.06, dur: 0.26, gain: 0.5 },   // shoving
  oof:    { v: 'o', from: 1.12, to: 0.72, dur: 0.24, gain: 0.85 },  // landing hard
  yelp:   { v: 'a', from: 1.25, to: 1.75, dur: 0.30, gain: 0.9 },   // launched
  panic:  { v: 'i', from: 1.5, to: 1.15, dur: 0.55, gain: 0.75 },   // long fall
  groan:  { v: 'o', from: 0.80, to: 0.62, dur: 0.60, gain: 0.6 },   // face down
  huh:    { v: 'a', from: 0.95, to: 1.20, dur: 0.20, gain: 0.45 },  // what
  cheer:  { v: 'a', from: 1.1, to: 1.5, dur: 0.45, gain: 0.8 },     // out alive
};

let ctx = null;
let out = null;
const lastAt = new Map();

/* Which lines have actually been spoken, and when.
 *
 * `lastAt` already exists to stop a line stacking on itself, so this costs
 * nothing: it just makes the record readable from outside. A voice line that
 * is wired up but never actually reached sounds exactly like one that was
 * never written, and grepping for the call site does not tell them apart. */
export const spokenLines = () => Object.fromEntries(lastAt);

export function initVoice(audioCtx, destination) {
  ctx = audioCtx;
  out = destination;
}

/**
 * @param {string} line  which of LINES
 * @param {string} who   character id, for the timbre
 * @param {number} [force] 0..1, scales length and loudness
 */
export function say(line, who, force = 1) {
  if (!ctx || !out) return;
  const spec = LINES[line];
  if (!spec) return;

  // do not stack the same yelp on itself
  const key = who + ':' + line;
  const now = ctx.currentTime;
  if (now - (lastAt.get(key) || -9) < 0.55) return;
  lastAt.set(key, now);

  const V = VOICES[who] || DEFAULT;
  const [f1, f2] = VOWELS[spec.v];
  const dur = spec.dur * (0.85 + force * 0.3);
  const gain = spec.gain * (0.5 + force * 0.6);

  // a buzzing larynx
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  const p0 = V.pitch * spec.from;
  const p1 = V.pitch * spec.to;
  osc.frequency.setValueAtTime(p0, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, p1), now + dur);

  // vibrato: the thing that stops it sounding like a doorbell
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = V.wobble;
  lfoGain.gain.value = p0 * 0.035;
  lfo.connect(lfoGain).connect(osc.frequency);

  // breath
  const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = V.rasp * 0.5;

  // the mouth
  const mk = (freq, q, g) => {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq * V.size;
    f.Q.value = q;
    const gg = ctx.createGain();
    gg.gain.value = g;
    f.connect(gg);
    return { f, gg };
  };
  const a = mk(f1, 7, 1.0);
  const b = mk(f2, 9, 0.55);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, now);
  env.gain.exponentialRampToValueAtTime(gain, now + 0.02);
  env.gain.setValueAtTime(gain, now + dur * 0.55);
  env.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  osc.connect(a.f); osc.connect(b.f);
  noise.connect(noiseGain);
  noiseGain.connect(a.f); noiseGain.connect(b.f);
  a.gg.connect(env); b.gg.connect(env);
  env.connect(out);

  osc.start(now); lfo.start(now); noise.start(now);
  osc.stop(now + dur + 0.04);
  lfo.stop(now + dur + 0.04);
}

/** A footstep on a given surface, pitched for the character's weight. */
export function step(who, force = 1, wet = false) {
  if (!ctx || !out) return;
  const V = VOICES[who] || DEFAULT;
  const now = ctx.currentTime;
  const dur = 0.09;
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = wet ? 'bandpass' : 'lowpass';
  f.frequency.value = (wet ? 1800 : 520) / V.size;
  f.Q.value = wet ? 1.6 : 0.9;
  const g = ctx.createGain();
  g.gain.value = 0.16 * force;
  src.connect(f).connect(g).connect(out);
  src.start(now);
}
