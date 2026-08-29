/* Everything you hear, synthesised on the spot.
 *
 * No audio files at all: the brief asks for no copyrighted music, and a game
 * that must load instantly on a phone should not be shipping megabytes of it
 * either. A lounge vamp built out of six oscillators costs nothing to download
 * and can do something a recording cannot - speed up and sour as the building
 * runs out of patience.
 *
 * The music is scheduled ahead of time against the audio clock rather than
 * from a timer. setInterval drifts by tens of milliseconds under load, which
 * you would hear immediately as a limping beat.
 */

const AC = window.AudioContext || window.webkitAudioContext;

let ctx = null;
let master = null;
let musicGain = null;
let sfxGain = null;
let started = false;

export const audio = {
  soundOn: true,
  musicOn: true,
  intensity: 0,      // 0 = calm, 1 = the ceiling is coming in
};

/** Must be called from a real user gesture or the browser will refuse. */
export function wake() {
  if (!AC) return;
  if (!ctx) {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.0;
    musicGain.connect(master);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = 1;
    sfxGain.connect(master);
  }
  if (ctx.state === 'suspended') ctx.resume();
  if (!started) { started = true; scheduleLoop(); }
}

const now = () => (ctx ? ctx.currentTime : 0);

/* --------------------------------------------------------------- voices */

function tone({ freq, dur = 0.2, type = 'square', gain = 0.1, at = 0, to, attack = 0.005,
                dest = null, detune = 0 }) {
  // Music must not be silenced by the SOUND EFFECTS switch. Both used to go
  // through the same soundOn check, so turning off the sound effects took the
  // soundtrack with it.
  if (!ctx) return;
  if (dest === musicGain ? !audio.musicOn : !audio.soundOn) return;
  const t = now() + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.detune.value = detune;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest || sfxGain);
  o.start(t);
  o.stop(t + dur + 0.03);
  return o;
}

function noise({ dur = 0.2, gain = 0.12, at = 0, band = 0, q = 1, dest = null }) {
  if (!ctx) return;
  if (dest === musicGain ? !audio.musicOn : !audio.soundOn) return;
  const t = now() + at;
  const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 1.7;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = gain;
  let node = src;
  if (band) {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = band;
    f.Q.value = q;
    node.connect(f);
    node = f;
  }
  node.connect(g).connect(dest || sfxGain);
  src.start(t);
}

/* ------------------------------------------------------- the funny noises */

export const sfx = {
  /** grabbing hold of something: a rubbery little boing */
  boing() {
    tone({ freq: 180, to: 520, dur: 0.13, type: 'triangle', gain: 0.11 });
    tone({ freq: 520, to: 300, dur: 0.16, type: 'triangle', gain: 0.08, at: 0.11 });
  },
  /** letting go */
  release() { tone({ freq: 380, to: 220, dur: 0.07, type: 'sine', gain: 0.05 }); },

  /** being launched off your friend: the slide whistle, obviously */
  slideUp() {
    tone({ freq: 320, to: 1500, dur: 0.42, type: 'sine', gain: 0.13 });
    noise({ dur: 0.12, gain: 0.05, band: 900, q: 2 });
  },
  /** and going the other way */
  slideDown() { tone({ freq: 1200, to: 190, dur: 0.5, type: 'sine', gain: 0.12 }); },

  /** landing badly */
  splat() {
    noise({ dur: 0.18, gain: 0.2, band: 320, q: 0.7 });
    tone({ freq: 110, to: 48, dur: 0.16, type: 'square', gain: 0.1 });
  },
  thud() { noise({ dur: 0.13, gain: 0.14, band: 180, q: 0.8 }); },

  /** planting your feet */
  brace() { tone({ freq: 90, to: 130, dur: 0.14, type: 'sawtooth', gain: 0.07 }); },

  /** something heavy giving way */
  creak() {
    tone({ freq: 96, to: 61, dur: 0.65, type: 'sawtooth', gain: 0.045 });
    tone({ freq: 143, to: 88, dur: 0.6, type: 'sawtooth', gain: 0.03, at: 0.05 });
  },
  crash() {
    noise({ dur: 0.5, gain: 0.22, band: 260, q: 0.5 });
    noise({ dur: 0.3, gain: 0.12, band: 1800, q: 0.8, at: 0.02 });
    tone({ freq: 70, to: 34, dur: 0.4, type: 'square', gain: 0.1 });
  },
  rumble() { noise({ dur: 0.9, gain: 0.07, band: 90, q: 0.4 }); },

  /** the shutter coming down like a guillotine */
  slam() {
    noise({ dur: 0.35, gain: 0.24, band: 200, q: 0.6 });
    tone({ freq: 150, to: 40, dur: 0.28, type: 'square', gain: 0.13 });
  },

  /** the lift finally arriving */
  ding() {
    tone({ freq: 988, dur: 0.5, type: 'sine', gain: 0.11 });
    tone({ freq: 1319, dur: 0.7, type: 'sine', gain: 0.09, at: 0.13 });
  },

  /** a switch, a button, a thing on a wall */
  click() {
    tone({ freq: 900, dur: 0.05, type: 'square', gain: 0.07 });
    tone({ freq: 420, dur: 0.07, type: 'square', gain: 0.05, at: 0.04 });
  },
  /** somebody pulled the fire alarm */
  alarm() {
    for (let i = 0; i < 5; i++) {
      tone({ freq: 780, to: 980, dur: 0.16, type: 'square', gain: 0.09, at: i * 0.34 });
      tone({ freq: 980, to: 780, dur: 0.16, type: 'square', gain: 0.09, at: i * 0.34 + 0.17 });
    }
  },

  /** a step done in the tutorial */
  tick() { tone({ freq: 760, dur: 0.09, type: 'square', gain: 0.06 }); },
  goodJob() {
    [0, 4, 7, 12].forEach((s, i) =>
      tone({ freq: 392 * Math.pow(2, s / 12), dur: 0.18, type: 'triangle', gain: 0.08, at: i * 0.07 }));
  },

  /** the sad trombone. It had to be here. */
  fail() {
    const notes = [233, 220, 208, 185];
    notes.forEach((f, i) =>
      tone({ freq: f, to: f * 0.94, dur: 0.3, type: 'sawtooth', gain: 0.10, at: i * 0.19 }));
  },
  /** and the fanfare */
  win() {
    [523, 659, 784, 1047].forEach((f, i) =>
      tone({ freq: f, dur: 0.35, type: 'square', gain: 0.09, at: i * 0.11 }));
    noise({ dur: 0.4, gain: 0.06, band: 4000, q: 1, at: 0.3 });
  },
};

/* ----------------------------------------------------------------- music */

// A three-chord lounge vamp in A minor, the sort of thing a hotel lobby has
// been playing since 1974 and has not been asked about since.
const CHORDS = [
  [57, 60, 64],   // Am
  [53, 57, 60],   // F
  [55, 59, 62],   // G
  [57, 60, 64],   // Am
];
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

let step = 0;
let nextNoteAt = 0;
let musicMode = 'menu';

export function setMusic(mode) {
  musicMode = mode;                       // 'menu' | 'game' | 'off'
  if (!ctx) return;
  // These are multiplied by each note's own gain and then by the master, so a
  // value that looks reasonable here ends up around -34dB and nobody can hear
  // a thing on a phone speaker. Measured, not guessed.
  const want = mode === 'off' || !audio.musicOn ? 0 : (mode === 'menu' ? 0.62 : 0.5);
  musicGain.gain.cancelScheduledValues(now());
  musicGain.gain.linearRampToValueAtTime(want, now() + 0.8);
}

function scheduleLoop() {
  const tick = () => {
    if (!ctx) return;
    // As the clock runs down the vamp gets faster and the bass gets nastier.
    const bpm = (musicMode === 'menu' ? 96 : 108) + audio.intensity * 30;
    const beat = 60 / bpm / 2;            // eighth notes
    while (nextNoteAt < now() + 0.15) {
      if (nextNoteAt < now()) nextNoteAt = now() + 0.02;
      playStep(step, nextNoteAt);
      nextNoteAt += beat;
      step++;
    }
    setTimeout(tick, 25);
  };
  nextNoteAt = now() + 0.1;
  tick();
}

function playStep(i, at) {
  if (!ctx || !audio.musicOn || musicMode === 'off') return;
  const bar = Math.floor(i / 8) % CHORDS.length;
  const chord = CHORDS[bar];
  const eighth = i % 8;
  const game = musicMode === 'game';
  const urgent = audio.intensity > 0.55;

  // walking bass
  if (eighth % 2 === 0) {
    const root = chord[0] - 24 + (eighth === 4 ? 7 : 0);
    tone({ freq: hz(root), dur: 0.28, type: urgent ? 'sawtooth' : 'triangle',
      gain: 0.24, at: at - now(), dest: musicGain });
  }
  // off-beat chord stabs, the lounge piano
  if (eighth === 1 || eighth === 3 || eighth === 6) {
    for (const n of chord) {
      tone({ freq: hz(n + 12), dur: 0.16, type: 'triangle', gain: 0.085,
        at: at - now(), dest: musicGain, detune: (Math.random() - 0.5) * 6 });
    }
  }
  // shaker
  noise({ dur: 0.05, gain: eighth % 2 ? 0.035 : 0.055, band: 7000, q: 1.4,
    at: at - now(), dest: musicGain });
  // kick
  if (eighth === 0 || eighth === 4 || (urgent && eighth === 6)) {
    tone({ freq: 110, to: 44, dur: 0.16, type: 'sine', gain: 0.34,
      at: at - now(), dest: musicGain });
  }
  // once things are bad, a siren-ish top line arrives
  if (game && urgent && eighth === 7) {
    tone({ freq: hz(chord[2] + 24), to: hz(chord[2] + 19), dur: 0.3, type: 'square',
      gain: 0.06, at: at - now(), dest: musicGain });
  }
}

export function setEnabled({ sound, music }) {
  if (sound !== undefined) audio.soundOn = sound;
  if (music !== undefined) {
    audio.musicOn = music;
    setMusic(musicMode);
  }
}
