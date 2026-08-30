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
  runSpeed: 7.0,        // world units per step
  accel: 0.22,          // how fast we approach runSpeed (low = clumsy)
  airAccel: 0.085,      // enough air control to aim a landing, not to fly
  jumpImpulse: 13.2,
  jumpSustain: 0.55,    // extra push per step while the button is held
  jumpHold: 11,         // for at most this many steps
  coyote: 7,            // still jumpable this long after leaving the ground
  jumpBuffer: 9,        // a press this early still counts on landing
  // Anything lower than this is a step, not a wall. It was 46, and a suitcase
  // is 48: you could pick your luggage up, put it down, and then be stopped
  // dead by it forever, which reads as the controls having given up. A crate
  // is 58 and still needs a jump, which is what crates are for.
  stepHeightMax: 54,
  stepLift: 5.2,        // enough to clear 54; 4.4 cleared 34 and no more
  armSpan: 78,          // an arm is this long; the aim never reaches further
  strength: 0.0062,     // the entire budget of one pair of legs. THE dial.
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
    stun: 0, launched: 0, lastImpact: 0, lastVx: 0, tripped: 0,
    coyote: 0, jumpBuffer: 0, rising: 0, tripChance: 0.1, stepping: 0, tripCool: 0, stepCool: 0,
    stuck: 0, skid: 0, flail: 0,
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

  // TRIP. Running flat out and then stopping dead or turning on the spot should
  // take your legs from under you. This is most of the comedy in the genre and
  // it was completely missing: the character was sure-footed, which is another
  // way of saying nothing surprising ever happened to them.
  const vx = torso.velocity.x;
  // These thresholds are in units PER STEP. Measured, not assumed: the top
  // speed a character actually reaches is about 6 per step and the biggest
  // single-step change is about 1.5, so anything written against runSpeed or
  // against the average travel speed simply never fires.
  const turning = input.move !== 0 && Math.sign(input.move) !== Math.sign(vx)
    && Math.abs(vx) > 2.6;
  const stopping = Math.abs(rd.lastVx - vx) > 1.2;
  // One roll per reversal, not one per frame. Rolling every frame meant a
  // nominal 8% chance became a near certainty over the twenty frames a turn
  // takes, and the early game - which is supposed to feel steady - tripped
  // half the time.
  if (rd.tripCool > 0) rd.tripCool--;
  if (rd.grounded && !rd.stun && rd.limp <= 0 && rd.tripCool <= 0
      && (turning || stopping)) {
    rd.tripCool = 45;
    if (Math.random() < (rd.tripChance ?? 0.25)) {
      rd.stun = Math.round(TUNE.getUpTime * 0.55);
      rd.tripped = 14;
      Body.setAngularVelocity(torso, torso.angularVelocity + Math.sign(vx || 1) * 0.24);
    }
  }
  rd.lastVx = vx;
  if (rd.tripped > 0) rd.tripped--;
  if (rd.stun > 0) rd.stun--;
  if (rd.limp > 0) rd.limp--;

  // authority: 1 = full control, 0 = a sack of potatoes
  const target = rd.limp > 0 ? 0 : rd.stun > 0 ? 0.12 : 1;
  rd.balance += (target - rd.balance) * (target > rd.balance ? 0.045 : 0.3);
  const A = rd.balance;

  // --- torso and head try to stand up ------------------------------------
  // Lean into the direction of travel: it looks eager, and it is what makes
  // a hard stop pitch you onto your face.
  // Leaning is where almost all of the comedy in a walk cycle lives, and the
  // old numbers were an apology. Lean hard into a start, and - the good bit -
  // lean BACKWARDS while overrunning a stop, feet ahead of your centre of mass
  // like a man on ice who has decided to commit.
  const leanTarget = rd.skid > 0
    ? clamp(-Math.sign(torso.velocity.x) * 0.30, -0.34, 0.34)
    : clamp(input.move * 0.34 + torso.velocity.x * 0.020, -0.48, 0.48);
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
  // Letting go of the stick at a run does not stop you. You keep going for
  // another few strides with your arms up, which is the single funniest thing
  // a walking character can do and costs the player nothing: they were
  // stopping anyway, and the overrun is short and always in the direction
  // they were already committed to.
  if (rd.skid > 0) rd.skid--;
  if (!moving && rd.grounded > 0 && Math.abs(torso.velocity.x) > 4.4
      && rd.skid <= 0 && rd.stun <= 0) {
    rd.skid = 20;
  }
  const skidding = rd.skid > 0 && !moving;

  // Feet grip when you are standing and slide when you are running: high
  // friction is what lets you brace, and it is also what nails you to the spot.
  const gripping = (!moving && !skidding) || rd.bracing;
  for (const sh of [p.shinB, p.shinF]) {
    sh.friction = gripping ? TUNE.braceFriction : (skidding ? 0.05 : 0.28);
  }

  // --- getting over things --------------------------------------------------
  //
  // Every platformer has this and it is invisible when it works: walking into
  // something low should carry you over it, not stop you dead. Without it a
  // ragdoll walks into the edge of a bed, the legs jam, the balance controller
  // fights the wall, and the character shudders in place until you jump - which
  // reads as the controls being broken rather than as the bed being there.
  //
  // Two probes: one at shin height, one a step higher. Something at the first
  // and nothing at the second means "that is a step, not a wall".
  //
  // Only when actually BLOCKED. The first version probed the floor in front at
  // shin height and fired whenever it found something - which included the very
  // surface being stood on, because shins sink a few units into whatever they
  // rest on. So it fired every frame while walking along a bed, pumping energy
  // into the solver until the character's position went non-finite and the
  // whole game stopped drawing. "Am I being stopped?" is the honest test.
  if (rd.stepCool > 0) rd.stepCool--;
  const wantMove = Math.abs(input.move) > 0.5;
  const blocked = wantMove && Math.abs(torso.velocity.x) < 1.3;
  // How long you have been trying to walk and not walking. A character who
  // can be permanently stopped by a 34-unit step is not funny, he is broken.
  rd.stuck = (blocked && rd.grounded > 0) ? rd.stuck + 1 : 0;

  if (rd.grounded > 0 && blocked && rd.stepCool <= 0 && rd.stun <= 0 && rd.limp <= 0) {
    const dir = Math.sign(input.move);
    const feet = Math.max(p.shinB.bounds.max.y, p.shinF.bounds.max.y);
    const others = Composite.allBodies(world).filter((b) => b.plugin.owner !== rd.id);
    // Probe from the TOES, not from the middle of the chest. A single probe 26
    // units in front of the torso sits behind your own feet, so a character
    // stopped dead by a step - or by his own swinging arm hitting it first -
    // probed thin air, found nothing to climb, and ground against it forever.
    const toe = dir > 0
      ? Math.max(p.shinB.bounds.max.x, p.shinF.bounds.max.x)
      : Math.min(p.shinB.bounds.min.x, p.shinF.bounds.min.x);
    let found = false;
    let clear = true;
    for (const reach of [4, 18, 32]) {
      const ahead = toe + dir * reach;
      const low = Query.point(others, { x: ahead, y: feet - 14 });
      const high = Query.point(others, { x: ahead, y: feet - TUNE.stepHeightMax });
      const headroom = Query.point(others, { x: ahead, y: feet - 96 });
      if (headroom.length) clear = false;
      if (low.length && !high.length && !headroom.length) { found = true; break; }
    }
    if (found) {
      rd.stepping = 12;
      rd.stepCool = 22;
    }
  }
  if (rd.stepping > 0) {
    rd.stepping--;
    // a lift, not a jump: enough to clear a step, gone before it becomes flight
    for (const b of [torso, p.head, p.thighB, p.thighF, p.shinB, p.shinF]) {
      Body.setVelocity(b, {
        x: b.velocity.x + rd.facing * 0.34,
        y: Math.min(b.velocity.y, -TUNE.stepLift),
      });
    }
  }

  // --- jump ----------------------------------------------------------------
  //
  // Three things that every platformer has and this one did not:
  //
  //   coyote time  - you may still jump for a few frames after walking off an
  //                  edge, because you pressed it when you MEANT to be on the
  //                  ledge and the game should agree with you
  //   buffering    - a press a few frames before landing is remembered and
  //                  fires on touchdown, instead of being silently eaten
  //   hold to rise - keeping the button down keeps pushing for a moment, so
  //                  there is a short hop and a full jump rather than one
  //                  fixed arc
  //
  // Together they are most of the difference between controls that feel
  // responsive and controls that feel like they are ignoring you.
  if (rd.grounded) rd.coyote = TUNE.coyote;
  else if (rd.coyote > 0) rd.coyote--;

  if (input.jump && !rd.jumpHeld) rd.jumpBuffer = TUNE.jumpBuffer;
  else if (rd.jumpBuffer > 0) rd.jumpBuffer--;

  if (rd.jumpBuffer > 0 && rd.coyote > 0 && rd.balance > 0.55 && rd.rising <= 0) {
    // Carrying something costs you height, which is the whole reason to put a
    // heavy thing down before jumping and the whole reason not to.
    let load = 0;
    for (const side of ['B', 'F']) {
      const c = rd.grabs[side];
      if (c && c.bodyB && !c.bodyB.isStatic) load = Math.max(load, c.bodyB.mass);
    }
    const j = TUNE.jumpImpulse * (1 - Math.min(0.42, load * 0.075));
    Body.setVelocity(torso, { x: torso.velocity.x, y: -j });
    for (const b of [p.thighB, p.thighF, p.shinB, p.shinF])
      Body.setVelocity(b, { x: b.velocity.x, y: -j * 0.82 });
    rd.grounded = 0;
    rd.coyote = 0;
    rd.jumpBuffer = 0;
    rd.rising = TUNE.jumpHold;
  }

  // held: keep pushing while the button is down and we are still going up
  if (rd.rising > 0) {
    rd.rising--;
    if (input.jump && torso.velocity.y < 0) {
      Body.setVelocity(torso, { x: torso.velocity.x, y: torso.velocity.y - TUNE.jumpSustain });
    } else {
      rd.rising = 0;
    }
  }
  rd.jumpHeld = input.jump;

  // --- arms reach for the aim point ---------------------------------------
  // Two rules, both learned the hard way. A stale aim point is a tractor beam:
  // hands pull toward it forever and quietly walk the character across the
  // level, so the aim is clamped to what an arm could actually reach. And with
  // no aim at all the hands hang by the hips instead of at the world origin.
  if (input.aim) rd.aim = input.aim;
  const rest = { x: torso.position.x + rd.facing * 24, y: torso.position.y + 30 };
  // Falling with nothing to hold and nowhere to point: windmill. Purely
  // decorative - the hands are springs toward a target and this only moves the
  // target - so it cannot cost you a landing, and it is worth the whole scene.
  const flailing = !rd.grounded && !rd.aim && !rd.grabs.F && !rd.grabs.B
    && rd.stun <= 0 && rd.limp <= 0;
  if (flailing) rd.flail += 0.46; else rd.flail = 0;
  // Centred at hip height, NOT above the head. Two hand springs both pulling
  // toward a point above the torso every frame is a helicopter: it added
  // enough lift to clear a gap that is supposed to need two people.
  let aim = flailing
    ? { x: torso.position.x + Math.cos(rd.flail) * 44,
        y: torso.position.y + 24 + Math.sin(rd.flail) * 30 }
    : (rd.aim || rest);
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
    let tx = aim.x + off * rd.facing;
    let ty = aim.y + (side === 'B' ? 6 : 0);
    if (flailing && side === 'B') {
      // half a turn behind, so it reads as windmilling and not as semaphore
      tx = torso.position.x + Math.cos(rd.flail + Math.PI) * 44;
      ty = torso.position.y + 24 + Math.sin(rd.flail + Math.PI) * 30;
    }
    const dx = tx - hand.position.x;
    const dy = ty - hand.position.y;
    const d = Math.hypot(dx, dy) || 1;
    const pull = Math.min(d, 90) * reach * (held ? 0.35 : 1) * (flailing ? 0.6 : 1);
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

/* Where you are reaching.
 *
 * Not "wherever the hand happens to be". The hands are ragdoll parts: they
 * swing, they trail behind, they end up behind your back halfway through a
 * stride - so searching from the hand meant the same button press picked a
 * different object depending on which frame you pressed it in, which is
 * exactly what "it grabs random things" feels like.
 *
 * You reach where you are pointing, and if you are pointing nowhere you reach
 * in front of you at about knee height, because that is where the things on
 * the floor are.
 */
function reachPoints(rd, aim) {
  const t = rd.parts.torso.position;
  // Always: in front of you, at about knee height. This is where the things on
  // the floor are, and it is what you mean when you walk up to a suitcase and
  // press the button without thinking about where the cursor is.
  const front = { x: t.x + rd.facing * 34, y: t.y + 30 };
  // And, if you are actually pointing at something, there - because reaching
  // for a ledge above you or for your friend is a real thing to want.
  const a = aim || rd.aim;
  if (!a) return [front];
  const dx = a.x - t.x, dy = a.y - t.y;
  const d = Math.hypot(dx, dy) || 1;
  const k = Math.min(1, TUNE.armSpan / d);
  return [{ x: t.x + dx * k, y: t.y + dy * k }, front];
}

/** Where the hands end up once they have hold of something. */
function reachPoint(rd, aim) { return reachPoints(rd, aim)[0]; }

/* The ONE thing this press is going to take hold of.
 *
 * Picked once, for both hands. Letting each hand search on its own meant the
 * left hand could take the bed while the right took a lump of ceiling, and the
 * character would then walk off holding two unrelated objects at arm's length
 * with no way to tell which one the release was going to drop.
 *
 * A real prop beats scenery of the same distance, because when a suitcase is
 * at your feet and a wall is behind you, you meant the suitcase.
 */
export function pickGrab(Matter, rd, bodies, aim) {
  const { Vertices } = Matter;
  // The aim MUST come from this tick's input. Reading the ragdoll's remembered
  // aim meant the first press after moving searched wherever you were pointing
  // a moment ago, and picked up whatever happened to be standing there - which
  // is precisely what "it grabs random things" feels like from the outside.
  const points = reachPoints(rd, aim);
  let best = null, bestScore = 68;
  for (const b of bodies) {
    if (b.isStatic && !b.plugin.grabbable) continue;
    if (b.plugin.owner === rd.id) continue;
    if (b.plugin.noGrab) continue;
    if (b.plugin.parked) continue;      // debris waiting off-stage to fall
    let d = Infinity;
    for (const hp of points) {
      // standing with your hand inside something counts as touching it, which
      // matters for anything wide: the nearest CORNER of a bed is far away
      if (Vertices.contains(b.vertices, hp)) { d = 0; break; }
      for (const v of b.vertices) d = Math.min(d, Math.hypot(v.x - hp.x, v.y - hp.y));
    }
    const score = d - (b.plugin.propId ? 26 : 0);
    if (score < bestScore) { bestScore = score; best = b; }
  }
  return best;
}

/** Take hold of `target` with one hand. Returns the constraint, or null. */
export function tryGrab(Matter, world, rd, side, bodies, target, aim) {
  const { Constraint, Composite } = Matter;
  if (rd.grabs[side]) return rd.grabs[side];
  const hand = rd.parts['farm' + side];
  const best = target || pickGrab(Matter, rd, bodies, aim);
  if (!best) return null;
  // hold it where you actually took hold of it
  let hp = reachPoint(rd, aim);
  if (!Matter.Vertices.contains(best.vertices, hp)) {
    let d = Infinity;
    for (const v of best.vertices) {
      const k = Math.hypot(v.x - hp.x, v.y - hp.y);
      if (k < d) { d = k; }
    }
    // pull the anchor onto the object rather than leaving it hanging in the
    // air beside it, which made a held prop dangle off the fingertips
    const dx = best.position.x - hp.x, dy = best.position.y - hp.y;
    const m = Math.hypot(dx, dy) || 1;
    const step = Math.min(m, d + 4);
    hp = { x: hp.x + (dx / m) * step, y: hp.y + (dy / m) * step };
  }

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
