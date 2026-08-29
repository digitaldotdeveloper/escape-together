/* The difference between "correct" and "good".
 *
 * Nothing in here changes what happens in the game. It changes whether you can
 * feel it. A crate landing with no dust, no thump, no camera move and no
 * squash is information; the same crate with all four is an event, and a
 * physics comedy is nothing but a chain of events you were not expecting.
 *
 * Everything is driven from the impacts the simulation already produces, so
 * the effects can never disagree with the physics: if you saw dust, something
 * really did hit something, that hard.
 */

const MAX = 260;
const parts = [];
let stopUntil = 0;      // hit-stop: the world holds still for a few frames
let shake = 0;
let shakeDecay = 0;

export const fx = {
  /** Frozen for a moment after something enormous. Read by the game loop. */
  frozen(now) { return now < stopUntil; },
  shakeAmount() { return shake; },
};

function add(p) {
  if (parts.length >= MAX) parts.shift();
  parts.push(p);
}

/* ------------------------------------------------------------- the makers */

export function dust(x, y, n, power, tint) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = (0.4 + Math.random()) * power;
    add({
      t: 'dust', x, y,
      vx: Math.cos(a) * s * 0.7,
      vy: Math.sin(a) * s * 0.5 - power * 0.35,
      r: 3 + Math.random() * (4 + power),
      life: 0.5 + Math.random() * 0.5, age: 0,
      tint: tint || '210,196,170',
    });
  }
}

export function chips(x, y, n, power, tint) {
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
    const s = (0.8 + Math.random() * 1.6) * power;
    add({
      t: 'chip', x, y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      r: 1.6 + Math.random() * 2.6, spin: (Math.random() - 0.5) * 0.5, a: 0,
      life: 0.7 + Math.random() * 0.6, age: 0,
      tint: tint || '150,132,110',
    });
  }
}

export function splash(x, y, n) {
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.8;
    const s = 1.2 + Math.random() * 2.2;
    add({
      t: 'drop', x, y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      r: 1.2 + Math.random(), life: 0.5, age: 0,
      tint: '180,220,255',
    });
  }
}

/** A ring that expands and fades: reads as force even at a glance. */
export function ring(x, y, power) {
  add({ t: 'ring', x, y, r: 6, grow: 90 + power * 26, life: 0.32, age: 0 });
}

export function star(x, y) {
  add({ t: 'star', x, y, vx: (Math.random() - 0.5) * 2, vy: -1.4, life: 0.6, age: 0 });
}

/** Speed lines behind something moving fast enough to deserve them. */
export function streak(x, y, vx, vy) {
  add({ t: 'streak', x, y, vx: vx * 0.2, vy: vy * 0.2, life: 0.22, age: 0 });
}

export function punch(amount, decay = 2.6) {
  shake = Math.min(1.4, shake + amount);
  shakeDecay = decay;
}

export function freeze(ms) {
  stopUntil = Math.max(stopUntil, performance.now() + ms);
}

/* --------------------------------------------------------------- the loop */

export function updateFx(dt) {
  shake = Math.max(0, shake - dt * shakeDecay);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.age += dt;
    if (p.age >= p.life) { parts.splice(i, 1); continue; }
    if (p.t === 'ring') { p.r += p.grow * dt; continue; }
    if (p.t === 'streak') continue;
    p.x += p.vx * dt * 60;
    p.y += p.vy * dt * 60;
    if (p.t === 'dust') { p.vy += 12 * dt; p.vx *= 0.94; p.vy *= 0.96; }
    else { p.vy += 46 * dt; }
    if (p.t === 'star') p.vy += 18 * dt;
    if (p.spin) p.a += p.spin;
  }
}

export function drawFx(ctx) {
  ctx.save();
  for (const p of parts) {
    const k = 1 - p.age / p.life;
    if (p.t === 'dust') {
      ctx.globalAlpha = 0.42 * k;
      ctx.fillStyle = 'rgb(' + p.tint + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1.6 - k * 0.6), 0, Math.PI * 2);
      ctx.fill();
    } else if (p.t === 'chip') {
      ctx.globalAlpha = k;
      ctx.fillStyle = 'rgb(' + p.tint + ')';
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.fillRect(-p.r, -p.r * 0.7, p.r * 2, p.r * 1.4);
      ctx.restore();
    } else if (p.t === 'drop') {
      ctx.globalAlpha = 0.8 * k;
      ctx.strokeStyle = 'rgb(' + p.tint + ')';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx, p.y - p.vy);
      ctx.stroke();
    } else if (p.t === 'ring') {
      ctx.globalAlpha = 0.5 * k * k;
      ctx.strokeStyle = '#fff3d0';
      ctx.lineWidth = 3 * k + 0.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.stroke();
    } else if (p.t === 'star') {
      ctx.globalAlpha = k;
      ctx.fillStyle = '#ffd85e';
      ctx.font = 'bold 16px system-ui';
      ctx.fillText('*', p.x, p.y);
    } else if (p.t === 'streak') {
      ctx.globalAlpha = 0.30 * k;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 8, p.y - p.vy * 8);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function clearFx() {
  parts.length = 0;
  shake = 0;
  stopUntil = 0;
}
