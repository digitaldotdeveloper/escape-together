/* An active ragdoll: a real jointed body that is *trying* to stand up.
 *
 * The whole feel of the game lives here. The rule that keeps it funny instead
 * of frustrating: the player always commands the character, but the character
 * only ever *asks* the physics for what the player wants. Every controller
 * below is a spring pulling toward a pose - it can always be beaten by a heavy
 * box, a shove, or a friend grabbing an ankle.
 *
 * Controllers are velocity-level PD, not torque. Matter's torque integration
 * scales with the square of the timestep and is very hard to tune across
 * framerates; nudging velocity toward a target is stable, framerate-tolerant,
 * and - because it quietly adds energy - reads as a cartoon character heaving
 * itself upright, which is exactly what we want.
 */

export const PART_NAMES = [
  'head', 'torso',
  'uarmB', 'farmB', 'uarmF', 'farmF', // B = far arm (behind), F = near arm (front)
  'thighB', 'shinB', 'thighF', 'shinF',
];

// Body plan, in world units. A character is ~104 tall, which reads as ~1.8m.
const PLAN = {
  head:   { w: 27, h: 27, circle: true, density: 0.0013 },
  torso:  { w: 26, h: 36, density: 0.0022 },
  uarmB:  { w: 9,  h: 21, density: 0.0008 },
  farmB:  { w: 8,  h: 21, density: 0.0008 },
  uarmF:  { w: 9,  h: 21, density: 0.0008 },
  farmF:  { w: 8,  h: 21, density: 0.0008 },
  thighB: { w: 11, h: 23, density: 0.0014 },
  shinB:  { w: 10, h: 23, density: 0.0012 },
  thighF: { w: 11, h: 23, density: 0.0014 },
  shinF:  { w: 10, h: 23, density: 0.0012 },
};

// Where each part sits relative to the pelvis when standing, and how the
// skeleton is pinned together.
const OFFSET = {
  head:   [0, -46],
  torso:  [0, -22],
  uarmB:  [-2, -22], farmB: [-3, -1],
  uarmF:  [2, -22],  farmF: [3, -1],
  thighB: [-5, 12],  shinB: [-6, 34],
  thighF: [5, 12],   shinF: [6, 34],
};

const JOINTS = [
  // [a, b, pointA, pointB, stiffness]
  ['torso', 'head',   [0, -18], [0, 12],  0.9],
  ['torso', 'uarmB',  [-8, -14], [0, -9], 0.75],
  ['uarmB', 'farmB',  [0, 10],  [0, -10], 0.8],
  ['torso', 'uarmF',  [8, -14], [0, -9],  0.75],
  ['uarmF', 'farmF',  [0, 10],  [0, -10], 0.8],
  ['torso', 'thighB', [-6, 17], [0, -10], 0.9],
  ['thighB', 'shinB', [0, 11],  [0, -11], 0.9],
  ['torso', 'thighF', [6, 17],  [0, -10], 0.9],
  ['thighF', 'shinF', [0, 11],  [0, -11], 0.9],
];

// Tuning. Everything a designer would want to turn is in one place.
export const TUNE = {
  standTorque: 0.34,    // how hard the torso fights to stay upright
  standDamp: 0.55,
  legTorque: 0.30,
  runSpeed: 6.2,        // world units per step
  accel: 0.20,          // how fast we approach runSpeed (low = clumsy)
  airAccel: 0.06,
  jumpImpulse: 11.5,
  armSpan: 78,          // an arm is this long; the aim never reaches further
  strength: 0.0055,     // the entire budget of one pair of legs. THE dial.
  tearDist: 110,        // a grip this far past its anchor has been torn off
  stepHeight: 0.55,     // leg swing amplitude while walking
  stepRate: 0.22,
  armReach: 0.055,      // hand spring toward the aim point
  armReachLimp: 0.012,
  grabStiffness: 0.16,
  grabHeavyStiffness: 0.05,
  braceFriction: 1.0,
  tripAngle: 1.15,      // past this lean, the legs give up (comedy)
  getUpTime: 90,        // steps spent flailing on the floor before standing
  limpTime: 70,
};

let GROUP = 0;

export function makeRagdoll(Matter, { x, y, id, tint }) {
  const { Bodies, Body, Composite, Constraint } = Matter;
  const group = --GROUP; // negative: a ragdoll never collides with itself

  const parts = {};
  for (const name of PART_NAMES) {
    const p = PLAN[name];
    const [ox, oy] = OFFSET[name];
    const opts = {
      label: id + ':' + name,
      density: p.density,
      friction: name.startsWith('shin') ? 0.9 : 0.35,
      frictionAir: 0.012,
      restitution: 0.05,
      collisionFilter: { group },
      chamfer: p.circle ? undefined : { radius: Math.min(p.w, p.h) * 0.34 },
    };
    parts[name] = p.circle
      ? Bodies.circle(x + ox, y + oy, p.w / 2, opts)
      : Bodies.rectangle(x + ox, y + oy, p.w, p.h, opts);
    parts[name].plugin.owner = id;
    parts[name].plugin.part = name;
  }

  const constraints = JOINTS.map(([a, b, pa, pb, stiffness]) =>
    Constraint.create({
      bodyA: parts[a], bodyB: parts[b],
      pointA: { x: pa[0], y: pa[1] }, pointB: { x: pb[0], y: pb[1] },
      length: 0, stiffness, damping: 0.1,
      render: { visible: false },
    })
  );

  const rd = {
    id, tint, group, parts, constraints,
    bodies: PART_NAMES.map((n) => parts[n]),
    // control state
    facing: 1, phase: 0, balance: 1, limp: 0, grounded: 0, bracing: false,
    grabs: { B: null, F: null },   // active grab constraints, per hand
    aim: null,   // world point the hands reach for; null = let them hang
    stun: 0, launched: 0, lastImpact: 0,
    spawn: { x, y },
  };
  return rd;
}

export function addRagdoll(Matter, world, rd) {
  Matter.Composite.add(world, [...rd.bodies, ...rd.constraints]);
}

/* ---------------------------------------------------------------- helpers */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const angleDiff = (a, b) => {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/** Nudge a body's spin toward `target` radians. The heart of the whole feel. */
function poseTo(Matter, body, target, gain, damp, authority) {
  if (authority <= 0) return;
  const err = angleDiff(target, body.angle);
  const want = clamp(err * gain, -0.5, 0.5) - body.angularVelocity * damp;
  Matter.Body.setAngularVelocity(body, body.angularVelocity + want * authority);
}

/* ------------------------------------------------------------- the update */

export function stepRagdoll(Matter, world, rd, input, all) {
  const { Body, Query, Constraint, Composite, Vector } = Matter;
  const p = rd.parts;
  const torso = p.torso;

  // --- grounded: does either shin touch anything that is not us? ----------
  rd.grounded = Math.max(0, rd.grounded - 1);
  for (const shin of [p.shinB, p.shinF]) {
    const under = Query.point(
      Composite.allBodies(world).filter((b) => b.plugin.owner !== rd.id),
      { x: shin.position.x, y: shin.position.y + 15 }
    );
    if (under.length) rd.grounded = 6;
  }

  // --- did something just hit us hard enough to be funny? ----------------
  const speed = Math.hypot(torso.velocity.x, torso.velocity.y);
  if (speed > 14) rd.launched = Math.min(60, rd.launched + 2);
  else rd.launched = Math.max(0, rd.launched - 1);

  // --- balance: upright, tripping, or face down --------------------------
  const lean = Math.abs(angleDiff(torso.angle, 0));
  if (input.limp) rd.limp = Math.max(rd.limp, 6);
  if (lean > TUNE.tripAngle && rd.grounded && !rd.stun) rd.stun = TUNE.getUpTime;
  if (rd.stun > 0) rd.stun--;
  if (rd.limp > 0) rd.limp--;

  // authority: 1 = full control, 0 = a sack of potatoes
  const target = rd.limp > 0 ? 0 : rd.stun > 0 ? 0.12 : 1;
  rd.balance += (target - rd.balance) * (target > rd.balance ? 0.045 : 0.3);
  const A = rd.balance;

  // --- torso and head try to stand up ------------------------------------
  // Lean into the direction of travel: it looks eager, and it is what makes
  // a hard stop pitch you onto your face.
  const leanTarget = clamp(input.move * 0.22 + torso.velocity.x * 0.012, -0.35, 0.35);
  poseTo(Matter, torso, leanTarget, TUNE.standTorque, TUNE.standDamp, A);
  poseTo(Matter, p.head, leanTarget * 0.5, 0.30, 0.5, A);

  // --- legs ---------------------------------------------------------------
  const moving = Math.abs(input.move) > 0.05;
  if (moving && rd.grounded) rd.phase += TUNE.stepRate * (0.6 + Math.abs(input.move) * 0.6);
  else rd.phase += (0 - (rd.phase % (Math.PI * 2))) * 0.05;

  const swing = moving ? TUNE.stepHeight : 0.06;
  const s = Math.sin(rd.phase);
  const legs = [
    [p.thighF, p.shinF, s],
    [p.thighB, p.shinB, -s],
  ];
  for (const [thigh, shin, ph] of legs) {
    const thighT = leanTarget + ph * swing * (moving ? 1 : 0.4);
    // the shin only ever folds backwards, which is what stops the knees
    // bending the wrong way and turning everyone into a flamingo
    const shinT = thighT + Math.max(0, -ph) * swing * 1.1 + (rd.grounded ? 0 : 0.25);
    poseTo(Matter, thigh, thighT, TUNE.legTorque, 0.4, A);
    poseTo(Matter, shin, shinT, TUNE.legTorque * 0.8, 0.4, A);
  }

  // --- horizontal drive ----------------------------------------------------
  if (Math.abs(input.move) > 0.05) rd.facing = input.move > 0 ? 1 : -1;
  const wantVx = input.move * TUNE.runSpeed * (rd.bracing ? 0.25 : 1);
  const accel = (rd.grounded ? TUNE.accel : TUNE.airAccel) * A;
  if (accel > 0) {
    // FORCE, not velocity. Setting velocity directly makes a character
    // infinitely strong: they walk off dragging a wardrobe as if it were a
    // balloon, and every "too heavy for one person" puzzle in the game
    // silently dies. A capped force means strength is a number - one player
    // has it, two players have twice it, and the level design means something.
    //
    // Matter integrates dv = (force / mass) * dt^2, and dt is 16.66ms.
    const DT2 = (1000 / 60) ** 2;
    const drive = [
      [torso, 1], [p.head, 0.55],
      [p.thighB, 0.9], [p.thighF, 0.9],
      [p.shinB, 0.7], [p.shinF, 0.7],
      [p.uarmB, 0.35], [p.uarmF, 0.35],
    ];
    let budget = TUNE.strength * A;
    for (const [b, w] of drive) {
      const dv = (wantVx - b.velocity.x) * accel;
      const want = (b.mass * dv) / DT2;
      const f = clamp(want, -budget * w, budget * w);
      Body.applyForce(b, b.position, { x: f, y: 0 });
    }
  }
  // Feet grip when you are standing and slide when you are running: high
  // friction is what lets you brace, and it is also what nails you to the spot.
  const gripping = !moving || rd.bracing;
  for (const sh of [p.shinB, p.shinF]) sh.friction = gripping ? TUNE.braceFriction : 0.28;

  // --- jump ----------------------------------------------------------------
  if (input.jump && rd.grounded && rd.balance > 0.6 && !rd.jumpHeld) {
    const j = TUNE.jumpImpulse;
    Body.setVelocity(torso, { x: torso.velocity.x, y: -j });
    for (const b of [p.thighB, p.thighF, p.shinB, p.shinF])
      Body.setVelocity(b, { x: b.velocity.x, y: -j * 0.8 });
    rd.grounded = 0;
  }
  rd.jumpHeld = input.jump;

  // --- arms reach for the aim point ---------------------------------------
  // Two rules, both learned the hard way. A stale aim point is a tractor beam:
  // hands pull toward it forever and quietly walk the character across the
  // level, so the aim is clamped to what an arm could actually reach. And with
  // no aim at all the hands hang by the hips instead of at the world origin.
  if (input.aim) rd.aim = input.aim;
  const rest = { x: torso.position.x + rd.facing * 24, y: torso.position.y + 30 };
  let aim = rd.aim || rest;
  {
    const dx = aim.x - torso.position.x, dy = aim.y - torso.position.y;
    const d = Math.hypot(dx, dy);
    if (d > TUNE.armSpan) aim = {
      x: torso.position.x + (dx / d) * TUNE.armSpan,
      y: torso.position.y + (dy / d) * TUNE.armSpan,
    };
  }
  const reach = (rd.limp > 0 || rd.stun > 0) ? TUNE.armReachLimp : TUNE.armReach;
  for (const side of ['B', 'F']) {
    const hand = p['farm' + side];
    const held = rd.grabs[side];
    // the far arm trails a little, so the two arms never overlap perfectly
    const off = side === 'B' ? 10 : -4;
    const tx = aim.x + off * rd.facing;
    const ty = aim.y + (side === 'B' ? 6 : 0);
    const dx = tx - hand.position.x;
    const dy = ty - hand.position.y;
    const d = Math.hypot(dx, dy) || 1;
    const pull = Math.min(d, 90) * reach * (held ? 0.35 : 1);
    // Reaching upward is capped hard. Without this the two hand springs are a
    // pair of helicopter blades and the character calmly hovers to the ceiling.
    const uy = (dy / d) * pull;
    Body.setVelocity(hand, {
      x: hand.velocity.x + (dx / d) * pull,
      y: hand.velocity.y + (uy < 0 ? Math.max(uy, -0.55) : uy),
    });
    poseTo(Matter, p['uarm' + side], Math.atan2(-dx * rd.facing, 40) * 0.8, 0.2, 0.4, A * 0.7);
  }

  // --- brace: plant your feet and become furniture -------------------------
  rd.bracing = !!input.brace && rd.grounded > 0;
  if (rd.bracing) {
    poseTo(Matter, torso, 0, TUNE.standTorque * 1.8, 0.8, A);
    Body.setVelocity(torso, { x: torso.velocity.x * 0.7, y: torso.velocity.y });
  }
}

/* ----------------------------------------------------------------- grabbing */

/** Grab whatever is under the given hand. Returns the constraint, or null. */
export function tryGrab(Matter, world, rd, side, bodies) {
  const { Constraint, Composite, Vector } = Matter;
  if (rd.grabs[side]) return rd.grabs[side];
  const hand = rd.parts['farm' + side];
  const hp = { x: hand.position.x + hand.velocity.x * 2, y: hand.position.y + 10 };

  let best = null, bestD = 34; // grab radius
  for (const b of bodies) {
    if (b.isStatic && !b.plugin.grabbable) continue;
    if (b.plugin.owner === rd.id) continue;
    if (b.plugin.noGrab) continue;
    // distance to the body's closest vertex is good enough and very cheap
    let d = Infinity;
    for (const v of b.vertices) d = Math.min(d, Math.hypot(v.x - hp.x, v.y - hp.y));
    d = Math.min(d, Math.hypot(b.position.x - hp.x, b.position.y - hp.y) - 6);
    if (d < bestD) { bestD = d; best = b; }
  }
  if (!best) return null;

  const c = Constraint.create({
    bodyA: hand,
    pointA: { x: 0, y: 10 },
    bodyB: best,
    pointB: {
      x: (hp.x - best.position.x) * Math.cos(-best.angle) - (hp.y - best.position.y) * Math.sin(-best.angle),
      y: (hp.x - best.position.x) * Math.sin(-best.angle) + (hp.y - best.position.y) * Math.cos(-best.angle),
    },
    // Holding a PERSON gets a long link. A short one puts two 26-wide bodies
    // 6 apart, they permanently intersect, the solver shoves them apart, and
    // the pair judders on the spot instead of forming a conga line.
    length: best.plugin.owner ? 30 : 6,
    // One stiffness for everything. A firm grip on a wardrobe does not fail
    // politely - it pulls the person instead, which is exactly the comedy and
    // exactly the physics.
    stiffness: TUNE.grabStiffness,
    damping: 0.2,
    render: { visible: false },
  });
  c.plugin = { grab: true, by: rd.id, side };
  Composite.add(world, c);
  rd.grabs[side] = c;
  return c;
}

export function releaseGrab(Matter, world, rd, side) {
  const c = rd.grabs[side];
  if (!c) return;
  Matter.Composite.remove(world, c);
  rd.grabs[side] = null;
}

/** A grab that is stretched far past its length has been torn off. */
export function enforceGrabs(Matter, world, rd) {
  for (const side of ['B', 'F']) {
    const c = rd.grabs[side];
    if (!c) continue;
    const a = Matter.Constraint.pointAWorld(c);
    const b = Matter.Constraint.pointBWorld(c);
    if (Math.hypot(a.x - b.x, a.y - b.y) > TUNE.tearDist) releaseGrab(Matter, world, rd, side);
  }
}

export function ragdollCentre(rd) {
  const t = rd.parts.torso.position;
  return { x: t.x, y: t.y };
}
