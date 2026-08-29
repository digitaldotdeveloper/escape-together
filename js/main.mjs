/* ESCAPE TOGETHER - the client.
 *
 * The browser runs its own copy of the whole simulation. Your own input is
 * applied to it the instant you press a key, so the game feels local; thirty
 * times a second the server's version of events arrives and the local world
 * leans toward it. You are never waiting for a round trip to see your own
 * character move, and you are never more than a frame or two away from the
 * truth.
 */

import { createSim, TICK_HZ } from '../shared/sim.mjs';
import { LEVEL_END } from '../shared/level.mjs';
import { connect } from './net.mjs';
import { MODE } from './mode.mjs';
import * as P2P from './p2p.mjs';
import { asset } from './base.mjs';
import { createInput } from './input.mjs';
import { loadChar, preloadCast, CAST } from './art.mjs';
import {
  CAM, updateCamera, applyCamera, screenToWorld, drawWorld, drawDust,
  drawRoomState, zonesFor,
} from './render.mjs';
import { UI } from './ui.mjs';
import { eventById } from '../shared/chaos.mjs';
import { wake, setMusic, setEnabled, audio, sfx, audioNodes } from './audio.mjs';
import { initVoice, say, step as footstep } from './voice.mjs';
import {
  fx, updateFx, drawFx, clearFx, dust, chips, splash, ring, star, streak, punch, freeze,
} from './fx.mjs';
import { createTutorial } from './tutorial.mjs';
import { controlLayout } from './input.mjs';
import { orientation } from './orientation.mjs';

const Matter = window.Matter;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });

const view = { w: 0, h: 0, dpr: 1 };
function resize() {
  view.dpr = Math.min(2, devicePixelRatio || 1);
  view.w = canvas.clientWidth;
  view.h = canvas.clientHeight;
  canvas.width = Math.round(view.w * view.dpr);
  canvas.height = Math.round(view.h * view.dpr);
}
addEventListener('resize', resize);

/* ------------------------------------------------------------------ sounds */
// All of it is synthesised in audio.mjs - no files, no copyrighted music.
const sfxMap = {
  boost: () => sfx.slideUp(),
  yeet: () => sfx.slideDown(),
  respawn: () => sfx.splat(),
  tileGo: () => sfx.crash(),
  creak: () => sfx.creak(),
  rumble: () => sfx.rumble(),
  shutterSlam: () => sfx.slam(),
  liftHere: () => sfx.ding(),
  press: (ev) => (ev.id === 'alarm' && ev.on ? sfx.alarm() : sfx.click()),
};

/* ------------------------------------------------------------------- state */

const G = {
  sim: createSim(Matter, {}),
  net: null,
  slot: 0,
  arts: [null, null],
  chars: ['gary', 'brick'],
  bgs: {},
  playing: false,
  solo: false,
  level: 'coop1',
  authority: false,     // true when THIS browser is running the simulation
  tutorial: createTutorial(),
  firstSnap: true,
  history: [],          // ring buffer of snapshots, for the replay
  moment: null,         // { until, caption, frames, i }
  beatShown: -1,
  banner: null,
  endShown: false,
  ping: null,
  zoneName: null,
  zoneAt: 0,
};
G.sim.connected = [true, false];

const input = createInput(canvas, { blocked: () => !G.playing });

/* -------------------------------------------------- the funny failure system */

const QUIPS = {
  yeet: [
    'YOUR FRIEND DEFINITELY DID THAT ON PURPOSE.',
    'INCREDIBLE STRATEGY.',
    'THAT WENT WELL.',
    'TEAMWORK: 0/10',
    'MISSION SUCCESSFULLY FAILED.',
  ],
  fell: [
    'GRAVITY: UNDEFEATED.',
    'THAT IS ONE WAY DOWN.',
    'YOU BOTH FAILED.',
    'TEAMWORK: 0/10',
  ],
  collapsed: [
    'THE HOTEL WINS.',
    'MISSION SUCCESSFULLY FAILED.',
    'CHECKOUT WAS AT ELEVEN.',
  ],
};

function moment(kind) {
  if (G.moment || G.history.length < 20) return;
  const list = QUIPS[kind] || QUIPS.yeet;
  G.moment = {
    caption: list[Math.floor(Math.random() * list.length)],
    frames: G.history.slice(-70),
    i: 0,
    holdFor: 46,
    done: false,
  };
  sfx.splat();
}

/* ------------------------------------------------------------------ netcode */

function handleSnapshot(f) {
  // The first snapshot is the truth, wholesale; after that we only lean.
  G.sim.applySnapshot(f, G.firstSnap ? 1 : 0.34);
  if (G.sim.protocolMismatch) {
    UI.setStatus('THIS PAGE IS OUT OF DATE - RELOAD');
    return;
  }
  G.firstSnap = false;
  G.history.push(f);
  if (G.history.length > 130) G.history.shift();
  syncEndScreen();
}

/** Whether the run is over is carried in every snapshot, so the end screen is
 *  driven by that rather than by catching a single event. An event can be
 *  missed; a state cannot. */
function syncEndScreen() {
  const over = G.sim.state !== 'playing';
  if (over === G.endShown) return;
  G.endShown = over;
  if (!over) return UI.hideEnd();
  if (G.sim.state === 'escaped') { sfx.win(); setMusic('menu'); UI.showEnd(true); }
  else { sfx.fail(); moment('collapsed'); UI.showEnd(false); }
}

function handleEvent(ev) {
  G.tutorial.noteEvent(ev);
  const play = sfxMap[ev.type];
  if (play) play(ev);
  if (ev.type === 'boost') {
    const i = ev.player;
    say('yelp', G.chars[i], 1);
    punch(0.4);
    ring(ev.x, ev.y, 9);
    dust(ev.x, ev.y + 40, 10, 2.2);
  }
  if (ev.type === 'escaped') say('cheer', G.chars[G.slot], 1);
  if (ev.type === 'tileGo') { punch(0.3); chips(ev.x, 620, 8, 1.6, '120,110,100'); }
  if (ev.type === 'shutterSlam') { punch(0.7); freeze(70); dust(ev.x, 600, 12, 2.4); }
  if (ev.type === 'press') star(ev.x, ev.y - 20);
  if (ev.type === 'chaos') {
    const e = eventById(ev.id);
    if (e) {
      G.chaosBanner = { name: e.name, sub: e.sub, t: 0 };
      punch(0.5);
      if (ev.id === 'quake') { freeze(90); sfx.rumble(); }
      if (ev.id === 'power') sfx.slam();
      if (ev.id === 'sprinklers') sfx.alarm();
      if (ev.id === 'party') sfx.ding();
      if (ev.id === 'draught') sfx.whoosh(1);
    }
  }
  if (ev.type === 'yeet') moment('yeet');
  if (ev.type === 'respawn' && ev.why === 'fell') moment('fell');
  // escaped / collapsed are deliberately NOT handled here: they are read off
  // the snapshot state instead, so a lost event cannot leave the run hanging
}

/** Start a fresh hotel. `authority` decides whether this copy is in charge. */
function useSim(authority, levelId) {
  G.level = levelId || G.level || 'coop1';
  G.sim = createSim(Matter, { authority, level: G.level });
  G.sim.connected = [true, false];
  G.authority = authority;
  G.firstSnap = true;
  G.history = [];
  G.moment = null;
  G.beatShown = -1;
}

async function setChar(slot, id) {
  G.chars[slot] = id;
  G.arts[slot] = await loadChar(id);
}

function join(kind, code, char, levelId) {
  wake();
  if (G.net) G.net.close();
  G.moment = null;
  G.history = [];

  if (MODE === 'ws') return joinViaServer(kind, code, char, levelId);
  return joinViaPeer(kind, code, char, levelId);
}

/* ---- with a room server: it is the authority, we only ever draw ---------- */

function joinViaServer(kind, code, char, levelId) {
  useSim(false, levelId);
  G.net = connect({
    open: (net) => net.send({ t: kind, code, char, level: levelId }),
    snapshot: handleSnapshot,
    close: () => UI.setStatus('DISCONNECTED'),
    message: async (msg, net) => {
      if (msg.t === 'ev') return msg.events.forEach(handleEvent);
      if (msg.t === 'err') return UI.setStatus(msg.why);
      if (msg.t === 'joined') {
        G.slot = msg.slot;
        // the room decides the scene; rebuild if we guessed differently
        if (msg.level && msg.level !== G.level) useSim(false, msg.level);
        UI.setRoom(msg.code, msg.slot);
        await setChar(msg.slot, char);
      }
      if (msg.t === 'room') {
        const other = msg.players[1 - G.slot];
        G.sim.connected = [!!msg.players[0], !!msg.players[1]];
        if (other) await setChar(1 - G.slot, other.char);
        UI.setLobby(msg, G.slot);
      }
      if (msg.t === 'solo') {
        G.sim.connected = G.level === 'solo1' ? [true, false] : [true, true];
        if (G.level !== 'solo1') G.sim.bot = true;
      }
      if (msg.t === 'reset') {
        G.firstSnap = true;
        G.history = [];
        G.moment = null;
        G.beatShown = -1;
        UI.hideEnd();
      }
    },
  });
}

/* ---- with no server: whoever made the room runs the world ---------------- */

function joinViaPeer(kind, code, char, levelId) {
  const lobby = () => UI.setLobby({
    code: G.net && G.net.code,
    players: [
      G.sim.connected[0] ? { slot: 0, char: G.chars[0] } : null,
      G.sim.connected[1] ? { slot: 1, char: G.chars[1] } : null,
    ],
  }, G.slot);

  const handlers = {
    open: async (t) => {
      G.net = t;
      G.slot = t.slot;
      // the host's scene wins; a guest rebuilds when told which it is
      useSim(t.host, t.host ? levelId : G.level);
      await setChar(G.slot, char);
      UI.setRoom(t.code, t.slot);
      if (!t.host) {
        G.sim.connected = [true, true];
        t.send({ t: 'hello', char });
      }
      lobby();
    },

    peerOpen: async (t) => {
      if (!t.host) return;
      G.sim.connected[1] = true;
      t.send({ t: 'hostinfo', char: G.chars[0] });
      lobby();
    },

    peerGone: () => {
      if (!G.authority) return UI.setStatus('YOUR FRIEND DROPPED OUT');
      G.sim.connected[1] = false;
      lobby();
    },

    binary: (ab, t) => {
      if (!t.host) return handleSnapshot(new Float32Array(ab));
      // the guest's controls, in the same ten bytes the server would get
      const v = new DataView(ab);
      const bits = v.getUint8(0);
      G.sim.setInput(1, {
        move: v.getInt8(1) / 100,
        jump: !!(bits & 1), grab: !!(bits & 2),
        brace: !!(bits & 4), limp: !!(bits & 8),
        aim: { x: v.getFloat32(2, true), y: v.getFloat32(6, true) },
      });
    },

    message: async (msg, t) => {
      if (msg.t === 'err') return UI.setStatus(msg.why);
      if (msg.t === 'ping') return t.send({ t: 'pong', at: msg.at });
      if (msg.t === 'pong') { G.ping = Math.round(performance.now() - msg.at); return; }
      if (msg.t === 'ev' && !t.host) return msg.events.forEach(handleEvent);
      if (msg.t === 'hello' && t.host) {
        await setChar(1, msg.char || 'brick');
        G.sim.connected[1] = true;
        lobby();
      }
      if (msg.t === 'hostinfo' && !t.host) {
        if (msg.level && msg.level !== G.level) {
          useSim(false, msg.level);
          G.sim.connected = [true, true];
          G.slot = 1;
        }
        await setChar(0, msg.char || 'gary');
        lobby();
      }
      if (msg.t === 'char') { await setChar(t.host ? 1 : 0, msg.char); lobby(); }
      if (msg.t === 'retry' && t.host) {
        const connected = [...G.sim.connected];
        useSim(true);
        G.sim.connected = connected;
        t.send({ t: 'reset' });
      }
      if (msg.t === 'reset' && !t.host) {
        G.firstSnap = true;
        G.history = [];
        G.moment = null;
        G.beatShown = -1;
        UI.hideEnd();
      }
    },

    status: (msg) => UI.setConnecting(msg),
    fail: (why) => { UI.setConnecting(''); UI.setStatus(why); },
  };

  try {
    G.net = kind === 'create' ? P2P.createRoom(handlers) : P2P.joinRoom(code, handlers);
  } catch (e) {
    UI.setStatus(String(e.message || e));
    return;
  }

  // measure the link rather than guess at it
  clearInterval(G.pingTimer);
  G.pingTimer = setInterval(() => {
    if (G.net && G.net.conn && G.net.conn.open) {
      G.net.send({ t: 'ping', at: performance.now() });
    } else {
      G.ping = null;
    }
  }, 2000);
}

/* --------------------------------------------------------------- the loop */

let last = performance.now();
let inputAcc = 0;
let stepAcc = 0;
let snapAcc = 0;

/* The world advances on a timer; the picture is drawn on animation frames.
 *
 * These used to be the same loop, and that quietly made hosting fragile: a
 * browser stops calling requestAnimationFrame entirely in a tab that is not in
 * front, so the moment the host looked at another tab the simulation froze for
 * BOTH players and the guest sat there pressing keys at a still photograph.
 * Stepping on an interval keeps the host honest; drawing on rAF keeps the
 * picture smooth. Neither job is now waiting on the other.
 */
function advance(dt) {
  const self = G.sim.players[G.slot];
  const cmd = input.read((x, y) => screenToWorld(view, x, y), self);
  G.lastCmd = cmd;

  // Your own input goes into the local world immediately. That is the whole
  // trick behind the game feeling local while somebody else stays in charge.
  G.sim.setInput(G.slot, cmd);

  inputAcc += dt;
  if (inputAcc > 1 / 30) {
    inputAcc = 0;
    if (!G.authority) G.net && G.net.sendInput(cmd);
  }

  G.tutorial.update(G.sim, G.slot, cmd, dt);
  reactToImpacts(dt);
  // the vamp gets faster and nastier as the clock runs down
  audio.intensity = G.sim.started
    ? 1 - Math.max(0, Math.min(1, G.sim.timeLeft / (480 * TICK_HZ)))
    : 0;

  if (G.moment) { playMoment(); return; }
  // Hit-stop. Fifty milliseconds of stillness after a big one is the oldest
  // trick there is and it does more for weight than any amount of physics.
  // The accumulator is cleared rather than left running, or the world catches
  // up in a lurch the moment it unfreezes and the pause reads as a stutter.
  if (fx.frozen(performance.now())) { stepAcc = 0; return; }

  stepAcc += dt;
  let steps = Math.min(4, Math.floor(stepAcc * TICK_HZ));
  stepAcc -= steps / TICK_HZ;
  while (steps-- > 0) G.sim.step();

  // Hosting: this browser IS the server, so it publishes rather than listens.
  if (!G.authority) return;
  snapAcc += dt;
  if (snapAcc <= 1 / 30) return;
  snapAcc = 0;
  const events = G.sim.drainEvents();
  events.forEach(handleEvent);
  syncEndScreen();
  const f = G.sim.snapshot();
  G.history.push(f);
  if (G.history.length > 130) G.history.shift();
  if (G.net && G.net.conn && G.net.conn.open) {
    // On a reliable channel an unsent snapshot is not dropped, it is queued -
    // so on a link that cannot keep up, sending regardless builds a backlog
    // that gets further behind every second. Four frames' worth is plenty;
    // past that, skip this one. The next snapshot supersedes it anyway.
    if (G.net.backlog() < 4 * f.byteLength) G.net.conn.send(f.buffer.slice(0));
    if (events.length) G.net.send({ t: 'ev', events });
  }
}

let lastSim = performance.now();
setInterval(() => {
  if (!G.playing) { lastSim = performance.now(); return; }
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastSim) / 1000);
  lastSim = now;
  advance(dt);
}, 1000 / TICK_HZ);

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  if (!G.playing) { drawMenuScene(dt); return; }

  updateFx(dt);
  updateCamera(G.sim, view, dt, G.slot, fx.shakeAmount());
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.fillStyle = '#241a1c';
  ctx.fillRect(0, 0, view.w, view.h);
  ctx.save();
  applyCamera(ctx, view);   // applies the device pixel ratio itself
  drawWorld(ctx, G.sim, view, G.arts, G.bgs,
    { slot: G.slot, peerName: UI.peerName, dt });
  drawFx(ctx);
  drawRoomState(ctx, G.sim, view, dt);
  drawDust(ctx, dt, G.sim.shake);
  ctx.restore();

  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  drawHUD(dt);
}

function playMoment() {
  const m = G.moment;
  // slow motion: one recorded frame every third displayed frame
  if (m.i < m.frames.length * 3) {
    G.sim.applySnapshot(m.frames[Math.floor(m.i / 3)], 1);
    m.i++;
  } else if (m.holdFor-- <= 0) {
    G.moment = null;
    G.firstSnap = true;
  }
}

/** WAIT here / come with me. The whole of the partner's intelligence. */
function toggleBot() {
  const next = G.sim.botMode ? 0 : 1;
  if (G.authority) G.sim.botMode = next;
  else G.net && G.net.send({ t: 'botmode', mode: next });
  G.sim.botMode = next;
  sfx.tick();
}
window.__toggleBot = toggleBot;

/* ------------------------------------------------------------- reactions */

// Remembered per character so a landing, a footstep or a yelp fires once
// rather than every frame it is true for.
const feel = [
  { air: false, phase: 0, squash: 0, lastYelp: 0 },
  { air: false, phase: 0, squash: 0, lastYelp: 0 },
];

/** Turn this frame's collisions into noise, dust and camera movement. */
function reactToImpacts(dt) {
  const hits = G.sim.drainImpacts();
  const focus = G.sim.cameraFocus();
  const wet = G.sim.sprinklers > 0;

  for (const h of hits) {
    // only what is on screen: a crate falling down a shaft two rooms away
    // should not shake the camera or spend a sound
    if (Math.abs(h.x - focus.x) > 900 || Math.abs(h.y - focus.y) > 700) continue;
    const force = Math.min(1, h.mag / 26);
    if (force < 0.06) continue;

    const material = h.kind === 'wall' || h.kind === 'crumble' || h.kind === 'debris'
      ? 'stone'
      : h.kind === 'shutter' || h.kind === 'lift' || h.kind === 'plate'
        || h.kind === 'lever' || h.kind === 'trolley' ? 'metal' : h.kind;
    sfx.impact(force, material);

    if (h.owner) {
      // a person hitting something
      const i = h.owner === 'p0' ? 0 : 1;
      const rd = G.sim.players[i];
      const who = G.chars[i];
      dust(h.x, h.y, 2 + Math.round(force * 6), 0.6 + force * 1.8);
      if (wet) splash(h.x, h.y, 3 + Math.round(force * 5));
      feel[i].squash = Math.min(1, feel[i].squash + force);
      if (force > 0.34) {
        say(force > 0.62 ? 'oof' : 'grunt', who, force);
        ring(h.x, h.y, force * 8);
        punch(force * 0.5);
        if (force > 0.75) freeze(50 + force * 60);
        for (let k = 0; k < Math.round(force * 3); k++) star(h.x, h.y - 20);
      }
    } else {
      dust(h.x, h.y, 1 + Math.round(force * 5), 0.5 + force * 1.4);
      if (force > 0.3) chips(h.x, h.y, 2 + Math.round(force * 5), 0.7 + force);
      if (force > 0.45) { punch(force * 0.34); ring(h.x, h.y, force * 6); }
    }
  }

  // --- per-character continuous feel -------------------------------------
  for (let i = 0; i < 2; i++) {
    if (!G.sim.connected[i]) continue;
    const rd = G.sim.players[i];
    const f = feel[i];
    const who = G.chars[i];
    const t = rd.parts.torso;
    const airborne = !rd.grounded;
    const speed = Math.hypot(t.velocity.x, t.velocity.y);

    // footsteps, on the beat of the walk cycle the renderer is already using
    if (!airborne && Math.abs(t.velocity.x) > 1.2) {
      const ph = Math.floor(rd.phase / Math.PI);
      if (ph !== f.phase) {
        f.phase = ph;
        footstep(who, Math.min(1, Math.abs(t.velocity.x) / 5), G.sim.sprinklers > 0);
        dust(t.position.x, rd.parts.shinF.bounds.max.y, 2, 0.5);
      }
    }

    // the long fall: air noise, streaks, and eventually a scream
    if (airborne && t.velocity.y > 8) {
      streak(t.position.x, t.position.y, -t.velocity.x, -t.velocity.y);
      if (t.velocity.y > 13) {
        sfx.whoosh(Math.min(1, t.velocity.y / 26));
        say('panic', who, 0.8);
      }
    }
    if (rd.launched > 20) say('yelp', who, 1);
    if (rd.tripped === 13) { say('huh', who, 0.7); dust(t.position.x, t.position.y + 40, 5, 1.2); }
    if (rd.stun === 1) say('groan', who, 0.5);
    f.air = airborne;
    f.squash = Math.max(0, f.squash - dt * 4.2);
    rd.squash = f.squash;      // the renderer reads this
  }
}

/* -------------------------------------------------------------------- HUD */

function drawHUD(dt) {
  const sim = G.sim;
  const w = view.w, h = view.h;

  // the wallpaper is pale and the HUD is pale; one of them has to give
  const scrim = ctx.createLinearGradient(0, 0, 0, 110);
  scrim.addColorStop(0, 'rgba(18,10,12,0.55)');
  scrim.addColorStop(1, 'rgba(18,10,12,0)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, w, 110);

  // the beat banner: the level telling you what it wants, once
  // Beats belong to the scene, not to the game. Reading them from a module
  // constant meant the solo tutorial announced the co-op level's puzzles.
  const beats = sim.level.def.beats;
  if (sim.beat !== G.beatShown) {
    G.beatShown = sim.beat;
    G.banner = { t: 0, beat: beats[sim.beat] };
  }
  if (G.banner) {
    G.banner.t += dt;
    const a = G.banner.t < 0.4 ? G.banner.t / 0.4
      : G.banner.t > 4.2 ? Math.max(0, (4.8 - G.banner.t) / 0.6) : 1;
    if (a <= 0) G.banner = null;
    else {
      ctx.save();
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      // On a phone held sideways the top-left is the tutorial card and the two
      // bottom corners are thumbs, so the banner takes the one strip nothing
      // else wants: bottom centre.
      const narrow = w < 620;
      const squat = h < 520;
      const by = squat ? h - 74 : (narrow ? 132 : 92);
      ctx.font = (squat ? '900 24px' : narrow ? '900 26px' : '900 34px') +
        ' system-ui, sans-serif';
      ctx.fillStyle = '#ffd85e';
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = 7;
      ctx.strokeText(G.banner.beat.title, w / 2, by);
      ctx.fillText(G.banner.beat.title, w / 2, by);
      ctx.font = (squat || narrow ? '600 13px' : '600 16px') + ' system-ui, sans-serif';
      ctx.fillStyle = '#fff2d8';
      ctx.strokeText(G.banner.beat.hint, w / 2, by + 26);
      ctx.fillText(G.banner.beat.hint, w / 2, by + 26);
      ctx.restore();
    }
  }

  // the hotel announcing what it has decided to do
  if (G.chaosBanner) {
    const b = G.chaosBanner;
    b.t += dt;
    const a = b.t < 0.35 ? b.t / 0.35 : b.t > 3.6 ? Math.max(0, (4.4 - b.t) / 0.8) : 1;
    if (a <= 0) G.chaosBanner = null;
    else {
      ctx.save();
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      const y = h < 520 ? h * 0.34 : h * 0.32;
      ctx.font = '900 ' + (w < 620 ? 22 : 30) + 'px system-ui, sans-serif';
      ctx.fillStyle = '#ff8a5e';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 7;
      ctx.strokeText(b.name, w / 2, y);
      ctx.fillText(b.name, w / 2, y);
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillStyle = '#fff2d8';
      ctx.strokeText(b.sub, w / 2, y + 24);
      ctx.fillText(b.sub, w / 2, y + 24);
      ctx.restore();
    }
  }

  // where you are: the name of the room, fading in when it changes
  const here = zonesFor(sim.level.def.id).find((z) => {
    const x = sim.cameraFocus().x;
    return x >= z.from && x < z.to;
  });
  if (here && here.name !== G.zoneName) {
    G.zoneName = here.name;
    G.zoneAt = 2.4;
  }
  if (G.zoneAt > 0) {
    G.zoneAt -= dt;
    ctx.save();
    ctx.globalAlpha = Math.min(1, G.zoneAt) * 0.8;
    ctx.textAlign = 'center';
    ctx.font = '800 13px system-ui, sans-serif';
    ctx.fillStyle = '#ffd85e';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 4;
    const y = h < 520 ? 36 : 74;
    ctx.strokeText(G.zoneName, w / 2, y);
    ctx.fillText(G.zoneName, w / 2, y);
    ctx.restore();
  }

  // clock + progress
  const showClock = !sim.level.def.solo;
  const secs = Math.max(0, Math.ceil(sim.timeLeft / TICK_HZ));
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  ctx.save();
  ctx.font = '800 22px ui-monospace, monospace';
  ctx.textAlign = 'left';
  if (showClock) {
    ctx.fillStyle = secs < 60 ? '#ff7a5e' : '#ffe6bd';
    ctx.fillText(mm + ':' + ss, 20, 34);
    ctx.font = '600 12px system-ui';
    ctx.fillStyle = 'rgba(255,235,200,0.6)';
    ctx.fillText('BEFORE IT ALL COMES DOWN', 20, 52);
  } else {
    ctx.font = '800 13px system-ui';
    ctx.fillStyle = 'rgba(255,235,200,0.7)';
    ctx.fillText(sim.level.def.name, 20, 32);
    ctx.font = '600 11px system-ui';
    ctx.fillStyle = 'rgba(255,235,200,0.45)';
    ctx.fillText('TAKE YOUR TIME', 20, 50);
  }

  const px = 20, py = 64, pw = Math.min(280, w * 0.3);
  const prog = Math.max(0, Math.min(1, sim.cameraFocus().x / sim.level.def.end));
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(px, py, pw, 7);
  ctx.fillStyle = '#ffd85e';
  ctx.fillRect(px, py, pw * prog, 7);
  ctx.restore();

  // who is here
  ctx.save();
  ctx.textAlign = 'right';
  ctx.font = '700 13px system-ui';
  const alone = sim.level.def.solo;
  if (!alone) {
    ctx.fillStyle = sim.connected[1 - G.slot] ? '#8fd8ff' : '#ff9a7a';
    ctx.fillText(sim.connected[1 - G.slot] ? 'FRIEND CONNECTED' : 'WAITING FOR YOUR FRIEND',
      w - 20, 30);
  }
  ctx.fillStyle = 'rgba(255,235,200,0.55)';
  ctx.font = '600 12px ui-monospace, monospace';
  if (!alone) ctx.fillText('ROOM ' + (G.net && G.net.code ? G.net.code : '-----'), w - 20, 50);
  if (sim.connected[1 - G.slot]) {
    const link = G.authority
      ? (G.ping === null ? 'HOSTING' : 'HOSTING  ' + G.ping + 'ms')
      : (G.ping === null ? 'MEASURING…' : G.ping + 'ms');
    ctx.fillStyle = G.ping !== null && G.ping > 220
      ? 'rgba(255,150,110,0.8)' : 'rgba(255,235,200,0.45)';
    ctx.fillText(link, w - 20, 68);
  }
  ctx.restore();

  // the controls, for the first half minute, because the brief says thirty
  // seconds to understand and a control list is the cheapest way to buy 25 of them
  // The keyboard reminder is for keyboards. On a touch device the buttons say
  // what they are, and this line only sat on top of them.
  const touching = input.touch || matchMedia('(pointer: coarse)').matches
    || navigator.maxTouchPoints > 0;
  if (!touching && sim.timeLeft > (480 - 26) * TICK_HZ) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '600 13px system-ui';
    ctx.fillStyle = 'rgba(255,240,215,0.85)';
    ctx.fillText(sim.level.def.solo
      ? 'WASD move   SPACE jump (hold for higher)   E / CLICK grab   R flop'
      : 'WASD move   SPACE jump   E / CLICK grab   Q hold to BOOST a friend   R flop',
      w / 2, h - 26);
    ctx.restore();
  }

  if (G.moment) {
    ctx.save();
    ctx.fillStyle = 'rgba(20,10,12,0.55)';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.font = '900 clamp(26px, 5vw, 54px) system-ui, sans-serif';
    ctx.fillStyle = '#ffd85e';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 8;
    ctx.strokeText(G.moment.caption, w / 2, h / 2);
    ctx.fillText(G.moment.caption, w / 2, h / 2);
    ctx.restore();
  }

  // A pointer beats a touchscreen. A laptop with a touch panel, or a phone
  // plugged into a keyboard, should not be shown thumb controls it does not
  // need - and once a finger HAS been used, it should.
  const coarse = input.touch
    || (!input.hasMouse
      && (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0));
  if (coarse) drawTouchUI(dt, G.tutorial.currentId());
  if (G.sim.bot) drawBotOrder(coarse);
  G.tutorial.draw(ctx, view, coarse, !G.sim.connected[1 - G.slot]);
}

/* The on-screen controls.
 *
 * Drawn in the game's own language rather than as grey circles: dark rounded
 * pads with a gold ring, a glyph, and a label, sitting on a scrim so they
 * never have to compete with bright wallpaper behind them. Pressing one fills
 * it and squashes it, because on a touchscreen your thumb is covering the
 * button and the only way to know it worked is for the rest of it to move.
 */
const press = { jump: 0, grab: 0, brace: 0 };

function glyph(kind, x, y, r, colour) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = Math.max(2.5, r * 0.13);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const u = r * 0.34;
  if (kind === 'up') {                       // a jump: chevron with a takeoff line
    ctx.beginPath();
    ctx.moveTo(-u, 0); ctx.lineTo(0, -u * 1.05); ctx.lineTo(u, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -u * 0.9); ctx.lineTo(0, u * 0.55);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-u * 0.85, u * 1.0); ctx.lineTo(u * 0.85, u * 1.0);
    ctx.stroke();
  } else if (kind === 'pinch') {             // a grab: two hands closing in
    ctx.beginPath();
    ctx.arc(-u * 0.15, 0, u * 0.95, Math.PI * 0.62, Math.PI * 1.38);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(u * 0.15, 0, u * 0.95, Math.PI * 1.62, Math.PI * 0.38);
    ctx.stroke();
  } else {                    // a boost: cupped hands, and someone leaving them
    ctx.beginPath();
    ctx.arc(0, u * 0.35, u * 0.9, 0, Math.PI);      // the cupped hands
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -u * 1.15); ctx.lineTo(0, -u * 0.15);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-u * 0.5, -u * 0.6); ctx.lineTo(0, -u * 1.2); ctx.lineTo(u * 0.5, -u * 0.6);
    ctx.stroke();
  }
  ctx.restore();
}

/** Playing alone: the partner's current order, and how to change it. */
function drawBotOrder(coarse) {
  const waiting = !!G.sim.botMode;
  const w = view.w, h = view.h;
  const L = controlLayout(view);
  const bx = coarse ? L.stickHome.x + L.stickMax + 44 : 92;
  const by = coarse ? L.stickHome.y - L.stickMax - 26 : h - 54;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = '900 12px system-ui, sans-serif';
  const label = waiting ? 'PARTNER: WAITING' : 'PARTNER: FOLLOWING';
  const pw = ctx.measureText(label).width + 26;
  ctx.fillStyle = 'rgba(24,14,16,0.72)';
  ctx.beginPath();
  ctx.roundRect(bx - pw / 2, by - 15, pw, 30, 15);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = waiting ? 'rgba(125,255,154,0.75)' : 'rgba(255,216,94,0.55)';
  ctx.stroke();
  ctx.fillStyle = waiting ? '#7dff9a' : '#ffd85e';
  ctx.fillText(label, bx, by + 4);
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,242,216,0.5)';
  ctx.fillText(coarse ? 'tap to swap' : 'press F', bx, by + 24);
  ctx.restore();
  G.botButton = { x: bx, y: by, w: pw, h: 30 };
}

function drawTouchUI(dt, highlight) {
  const { stick, buttons, grabLatch: latched } = input.touchUI();
  const L = controlLayout(view);
  const w = view.w, h = view.h;
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);

  ctx.save();


  // --- the steering thumb -------------------------------------------------
  // Only drawn while a thumb is actually on it. A permanent ring in the corner
  // is a permanent obstruction: it sits over the game for the entire session
  // to tell you something you learn in the first two seconds.
  if (stick) {
    const dx = stick.x - stick.ox, dy = stick.y - stick.oy;
    const len = Math.hypot(dx, dy);
    const cap = Math.min(len, L.stickMax);
    const kx = len > 0 ? stick.ox + (dx / len) * cap : stick.ox;
    const ky = len > 0 ? stick.oy + (dy / len) * cap : stick.oy;

    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(stick.ox, stick.oy, L.stickMax, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(18,10,12,0.5)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffd85e';
    ctx.stroke();

    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.arc(kx, ky, L.stickMax * 0.46, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd85e';
    ctx.fill();
  }

  // --- the buttons ---------------------------------------------------------
  ctx.textAlign = 'center';
  for (const b of L.buttons) {
    const on = buttons.has(b.id);
    press[b.id] += ((on ? 1 : 0) - press[b.id]) * Math.min(1, dt * 22);
    const p = press[b.id];
    const r = b.r * (1 - p * 0.07);
    const wanted = highlight === b.id;

    ctx.globalAlpha = 1;
    // a soft dark halo under each pad: the top of the column reaches up out of
    // the scrim and over bright wallpaper, and a gold ring on pale yellow is
    // not a contrast you want to bet a button press on
    const halo = ctx.createRadialGradient(b.x, b.y, r * 0.75, b.x, b.y, r * 1.75);
    halo.addColorStop(0, 'rgba(14,8,9,0.55)');
    halo.addColorStop(1, 'rgba(14,8,9,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(b.x - r * 1.8, b.y - r * 1.8, r * 3.6, r * 3.6);

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 10 * L.scale;
    ctx.shadowOffsetY = 4 * L.scale * (1 - p);

    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.fillStyle = p > 0.02
      ? 'rgba(255,216,94,' + (0.35 + p * 0.6) + ')'
      : 'rgba(30,18,19,0.62)';
    ctx.fill();
    ctx.restore();

    // the ring, which is what the tutorial pulses when it wants this one
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.lineWidth = (wanted ? 4.5 : 3) * L.scale;
    ctx.strokeStyle = wanted
      ? 'rgba(125,255,154,' + (0.55 + pulse * 0.45) + ')'
      : 'rgba(255,216,94,' + (0.55 + p * 0.45) + ')';
    ctx.stroke();

    if (wanted) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, r + (6 + pulse * 7) * L.scale, 0, Math.PI * 2);
      ctx.lineWidth = 2 * L.scale;
      ctx.strokeStyle = 'rgba(125,255,154,' + (0.30 - pulse * 0.22) + ')';
      ctx.stroke();
    }

    const ink = p > 0.5 ? '#2a1a17' : '#ffd85e';
    glyph(b.glyph, b.x, b.y - r * 0.16, r, ink);
    ctx.fillStyle = ink;
    // a latched GRAB says what the next tap does, not what the last one did
    const label = b.latch && latched ? 'LET GO' : b.label;
    ctx.font = '900 ' + Math.round(r * (label.length > 5 ? 0.24 : 0.27)) +
      'px system-ui, sans-serif';
    ctx.fillText(label, b.x, b.y + r * 0.66);
  }

  ctx.textAlign = 'left';
  ctx.restore();
}

/* ------------------------------------------------------- the menu backdrop */

let menuT = 0;
function drawMenuScene(dt) {
  menuT += dt;
  const w = view.w, h = view.h;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#2a1c20');
  g.addColorStop(1, '#71432f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = 'rgba(255,236,200,0.5)';
  for (let i = 0; i < 60; i++) {
    const x = ((i * 137.5 + menuT * 14 * (1 + (i % 5))) % (w + 60)) - 30;
    const y = ((i * 91.7 + menuT * 26 * (1 + (i % 3))) % (h + 60)) - 30;
    ctx.fillRect(x, y, 2, 5);
  }
  ctx.restore();
}

/* -------------------------------------------------------------------- boot */

(async () => {
  resize();
  requestAnimationFrame(frame);

  const [cast] = await Promise.all([preloadCast()]);
  G.arts[0] = await loadChar('gary');
  G.arts[1] = await loadChar('brick');

  for (const key of ['room', 'bedroom', 'corridor', 'service', 'lobby']) {
    const im = new Image();
    im.onload = () => { G.bgs[key] = im; };
    im.src = asset('bg/' + key + '.webp');
  }

  // skipping the tutorial, by key or by tapping the corner of its card
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyT' && G.playing) G.tutorial.skip();
    if (e.code === 'KeyF' && G.playing && G.sim.bot) toggleBot();
  });
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    if (G.tutorial.hitSkip(px, py)) G.tutorial.skip();
    const b = G.botButton;
    if (G.sim.bot && b && Math.abs(px - b.x) < b.w / 2 + 10
        && Math.abs(py - b.y) < b.h / 2 + 14) toggleBot();
  });

  orientation.watch(document.getElementById('rotate'));

  UI.init({
    cast: CAST,
    onPlay: (kind, code, char, levelId) => {
      wake();
      const n = audioNodes();
      if (n) initVoice(n.ctx, n.sfxGain);
      setMusic('menu');
      join(kind, code, char, levelId);
    },
    // pressing ENTER THE HOTEL is what starts the clock, not creating the room
    onStart: () => {
      G.playing = true;
      wake();
      const n = audioNodes();
      if (n) initVoice(n.ctx, n.sfxGain);
      // a real tap, which is the only moment a browser will grant either of
      // these: full screen, and a portrait lock where one is available
      orientation.goFullscreen();
      setMusic('game');
      if (G.authority) G.sim.started = true;
      else G.net && G.net.send({ t: 'start' });
    },
    onSolo: () => {
      const soloScene = G.level === 'solo1';
      if (G.authority) {
        G.sim.connected = soloScene ? [true, false] : [true, true];
        G.sim.bot = !soloScene;
      } else {
        G.net && G.net.send({ t: 'solo' });
      }
    },
    onRetry: () => {
      if (G.authority) {
        const connected = [...G.sim.connected];
        useSim(true);
        G.sim.connected = connected;
        G.net && G.net.send({ t: 'reset' });
      } else {
        G.net && G.net.send({ t: 'retry' });
      }
      UI.hideEnd();
    },
    onQuit: () => {
      G.playing = false;
      setMusic('menu');
      if (G.net) G.net.close();
    },
    onChar: (id) => {
      setChar(G.slot, id);
      G.net && G.net.send({ t: 'char', char: id });
    },
    onSound: (on) => setEnabled({ sound: on }),
    onMusic: (on) => setEnabled({ music: on }),
    onTutorial: () => G.tutorial.restart(),
  });

  // The menu is now live. Until this line the buttons are only HTML: they can
  // be clicked, and nothing happens. Anything driving the page from outside -
  // a test, an invite link handler - waits for this rather than for a timer.
  G.uiBound = true;
})();

window.G = G;   // a hand-hold for the console while tuning
// where the touch buttons actually are, so a test can press one
window.__layout = () => controlLayout(view);
window.__orient = orientation;
