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
import { BEATS, LEVEL_END } from '../shared/level.mjs';
import { connect } from './net.mjs';
import { MODE } from './mode.mjs';
import * as P2P from './p2p.mjs';
import { asset } from './base.mjs';
import { createInput } from './input.mjs';
import { loadChar, preloadCast, CAST } from './art.mjs';
import {
  CAM, updateCamera, applyCamera, screenToWorld, drawWorld, drawDust,
} from './render.mjs';
import { UI } from './ui.mjs';
import { wake, setMusic, setEnabled, audio, sfx } from './audio.mjs';
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
  authority: false,     // true when THIS browser is running the simulation
  tutorial: createTutorial(),
  firstSnap: true,
  history: [],          // ring buffer of snapshots, for the replay
  moment: null,         // { until, caption, frames, i }
  beatShown: -1,
  banner: null,
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
  G.firstSnap = false;
  G.history.push(f);
  if (G.history.length > 130) G.history.shift();
}

function handleEvent(ev) {
  G.tutorial.noteEvent(ev);
  const play = sfxMap[ev.type];
  if (play) play();
  if (ev.type === 'yeet') moment('yeet');
  if (ev.type === 'respawn' && ev.why === 'fell') moment('fell');
  if (ev.type === 'escaped') { sfx.win(); setMusic('menu'); UI.showEnd(true); }
  if (ev.type === 'collapsed') { sfx.fail(); moment('collapsed'); UI.showEnd(false); }
}

/** Start a fresh hotel. `authority` decides whether this copy is in charge. */
function useSim(authority) {
  G.sim = createSim(Matter, { authority });
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

function join(kind, code, char) {
  wake();
  if (G.net) G.net.close();
  G.moment = null;
  G.history = [];

  if (MODE === 'ws') return joinViaServer(kind, code, char);
  return joinViaPeer(kind, code, char);
}

/* ---- with a room server: it is the authority, we only ever draw ---------- */

function joinViaServer(kind, code, char) {
  useSim(false);
  G.net = connect({
    open: (net) => net.send({ t: kind, code, char }),
    snapshot: handleSnapshot,
    close: () => UI.setStatus('DISCONNECTED'),
    message: async (msg, net) => {
      if (msg.t === 'ev') return msg.events.forEach(handleEvent);
      if (msg.t === 'err') return UI.setStatus(msg.why);
      if (msg.t === 'joined') {
        G.slot = msg.slot;
        UI.setRoom(msg.code, msg.slot);
        await setChar(msg.slot, char);
      }
      if (msg.t === 'room') {
        const other = msg.players[1 - G.slot];
        G.sim.connected = [!!msg.players[0], !!msg.players[1]];
        if (other) await setChar(1 - G.slot, other.char);
        UI.setLobby(msg, G.slot);
      }
      if (msg.t === 'solo') G.sim.connected = [true, true];
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

function joinViaPeer(kind, code, char) {
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
      useSim(t.host);
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
      if (msg.t === 'ev' && !t.host) return msg.events.forEach(handleEvent);
      if (msg.t === 'hello' && t.host) {
        await setChar(1, msg.char || 'brick');
        G.sim.connected[1] = true;
        lobby();
      }
      if (msg.t === 'hostinfo' && !t.host) {
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

  G.net = kind === 'create' ? P2P.createRoom(handlers) : P2P.joinRoom(code, handlers);
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
  // the vamp gets faster and nastier as the clock runs down
  audio.intensity = G.sim.started
    ? 1 - Math.max(0, Math.min(1, G.sim.timeLeft / (480 * TICK_HZ)))
    : 0;

  if (G.moment) { playMoment(); return; }

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
  const f = G.sim.snapshot();
  G.history.push(f);
  if (G.history.length > 130) G.history.shift();
  if (G.net && G.net.conn && G.net.conn.open) {
    G.net.conn.send(f.buffer.slice(0));
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

  updateCamera(G.sim, view, dt, G.slot);
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.fillStyle = '#241a1c';
  ctx.fillRect(0, 0, view.w, view.h);
  ctx.save();
  applyCamera(ctx, view);   // applies the device pixel ratio itself
  drawWorld(ctx, G.sim, view, G.arts, G.bgs, { slot: G.slot, peerName: UI.peerName });
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
  if (sim.beat !== G.beatShown) {
    G.beatShown = sim.beat;
    G.banner = { t: 0, beat: BEATS[sim.beat] };
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

  // clock + progress
  const secs = Math.max(0, Math.ceil(sim.timeLeft / TICK_HZ));
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  ctx.save();
  ctx.font = '800 22px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = secs < 60 ? '#ff7a5e' : '#ffe6bd';
  ctx.fillText(mm + ':' + ss, 20, 34);
  ctx.font = '600 12px system-ui';
  ctx.fillStyle = 'rgba(255,235,200,0.6)';
  ctx.fillText('BEFORE IT ALL COMES DOWN', 20, 52);

  const px = 20, py = 64, pw = Math.min(280, w * 0.3);
  const prog = Math.max(0, Math.min(1, sim.cameraFocus().x / LEVEL_END));
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(px, py, pw, 7);
  ctx.fillStyle = '#ffd85e';
  ctx.fillRect(px, py, pw * prog, 7);
  ctx.restore();

  // who is here
  ctx.save();
  ctx.textAlign = 'right';
  ctx.font = '700 13px system-ui';
  ctx.fillStyle = sim.connected[1 - G.slot] ? '#8fd8ff' : '#ff9a7a';
  ctx.fillText(sim.connected[1 - G.slot] ? 'FRIEND CONNECTED' : 'WAITING FOR YOUR FRIEND', w - 20, 30);
  ctx.fillStyle = 'rgba(255,235,200,0.55)';
  ctx.font = '600 12px ui-monospace, monospace';
  ctx.fillText('ROOM ' + (G.net && G.net.code ? G.net.code : '-----'), w - 20, 50);
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
    ctx.fillText('WASD move   SPACE jump   E / CLICK grab   Q hold to BOOST a friend   R flop',
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

  // Three ways of asking, because no single one is reliable: a phone that has
  // not been touched yet reports no touches, some Android browsers report a
  // fine pointer, and a laptop with a touchscreen should still get the pad
  // once a finger is actually used.
  const coarse = input.touch
    || matchMedia('(pointer: coarse)').matches
    || navigator.maxTouchPoints > 0;
  if (coarse) drawTouchUI(dt, G.tutorial.currentId());
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

function drawTouchUI(dt, highlight) {
  const { stick, buttons, grabLatch: latched } = input.touchUI();
  const L = controlLayout(view);
  const w = view.w, h = view.h;
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);

  ctx.save();

  // the control band, so a pale wallpaper never swallows the buttons
  const scrim = ctx.createLinearGradient(0, L.scrimTop, 0, h);
  scrim.addColorStop(0, 'rgba(18,10,12,0)');
  scrim.addColorStop(1, 'rgba(18,10,12,0.5)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, L.scrimTop, w, h - L.scrimTop);

  // --- the steering thumb -------------------------------------------------
  const base = stick ? { x: stick.ox, y: stick.oy } : L.stickHome;
  const knob = stick ? { x: stick.x, y: stick.y } : L.stickHome;
  const dx = knob.x - base.x, dy = knob.y - base.y;
  const len = Math.hypot(dx, dy);
  const cap = Math.min(len, L.stickMax);
  const kx = len > 0 ? base.x + (dx / len) * cap : base.x;
  const ky = len > 0 ? base.y + (dy / len) * cap : base.y;

  ctx.globalAlpha = stick ? 0.5 : 0.24;
  ctx.beginPath();
  ctx.arc(base.x, base.y, L.stickMax, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(18,10,12,0.5)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffd85e';
  ctx.stroke();

  ctx.globalAlpha = stick ? 0.95 : 0.45;
  ctx.beginPath();
  ctx.arc(kx, ky, L.stickMax * 0.46, 0, Math.PI * 2);
  ctx.fillStyle = stick ? '#ffd85e' : 'rgba(255,242,216,0.75)';
  ctx.fill();

  if (!stick) {
    ctx.globalAlpha = 0.5;
    ctx.font = '800 ' + Math.round(11 * L.scale) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd85e';
    ctx.fillText('MOVE', base.x, base.y + L.stickMax + 16 * L.scale);
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

  for (const [key, src] of [['room', asset('bg/room.webp')]]) {
    const im = new Image();
    im.onload = () => { G.bgs[key] = im; };
    im.src = src;
  }

  // skipping the tutorial, by key or by tapping the corner of its card
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyT' && G.playing) G.tutorial.skip();
  });
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    if (G.tutorial.hitSkip(e.clientX - r.left, e.clientY - r.top)) G.tutorial.skip();
  });

  orientation.watch(document.getElementById('rotate'));

  UI.init({
    cast: CAST,
    onPlay: (kind, code, char) => {
      wake();
      setMusic('menu');
      join(kind, code, char);
    },
    // pressing ENTER THE HOTEL is what starts the clock, not creating the room
    onStart: () => {
      G.playing = true;
      wake();
      // a real tap, which is the only moment a browser will grant either of
      // these: full screen, and a portrait lock where one is available
      orientation.goFullscreen();
      setMusic('game');
      if (G.authority) G.sim.started = true;
      else G.net && G.net.send({ t: 'start' });
    },
    onSolo: () => {
      if (G.authority) G.sim.connected = [true, true];
      else G.net && G.net.send({ t: 'solo' });
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
})();

window.G = G;   // a hand-hold for the console while tuning
// where the touch buttons actually are, so a test can press one
window.__layout = () => controlLayout(view);
window.__orient = orientation;
