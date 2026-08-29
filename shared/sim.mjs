/* The simulation. One copy runs on the server as the authority; one copy runs
 * in every browser so the game feels instant instead of feeling like a webcam.
 *
 * Networking model, deliberately the small one:
 *   - the server owns the truth and steps at 60Hz
 *   - clients step the same world at 60Hz with their own input applied at once
 *   - 30 times a second the server sends every body's position and velocity
 *   - clients do not roll back; they *lean* toward the snapshot
 *
 * Rollback would be the textbook answer and it is the wrong one here. A pile
 * of jointed ragdolls holding a wardrobe cannot be resimulated ten frames deep
 * on a phone, and the failure mode of leaning - a box that is a few centimetres
 * out of place for a moment - is invisible in a game about falling over.
 */

import { buildLevel, FLOOR1, FLOOR2, levelById } from './level.mjs';
import { DEFAULT_LEVEL } from './levels.mjs';
import {
  makeRagdoll, addRagdoll, stepRagdoll, tryGrab, releaseGrab, enforceGrabs,
  PART_NAMES,
} from './ragdoll.mjs';
import { botInput, botRescue, BOT_FOLLOW, BOT_WAIT } from './bot.mjs';
import { stepChaos, freshChaos, EVENTS, eventIndex } from './chaos.mjs';

export const TICK_HZ = 60;
export const SEND_HZ = 30;
export const PLATE_NEEDS = 8.0;      // a player is ~4.7: one alone can never hold it
export const ROUND_SECONDS = 480;

export const SPAWNS = [
  { x: 190, y: FLOOR1 - 120 },
  { x: 470, y: FLOOR1 - 120 },
];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// aim is null, not {0,0}: a zeroed aim point is the top-left corner of the
// world, and the arm springs will happily haul the whole character up to it.
export const EMPTY_INPUT = {
  move: 0, jump: false, grab: false, brace: false, limp: false, aim: null,
};

export function createSim(Matter, { authority = false, level: levelId = DEFAULT_LEVEL } = {}) {
  const { Engine, Composite, Body, Bodies, Query, Vector, Events } = Matter;

  const engine = Engine.create({
    gravity: { x: 0, y: 1.15 },
    // Sleeping would make the snapshot lie about bodies that a remote player
    // is about to shove, so it stays off. 70-odd bodies is nothing.
    enableSleeping: false,
    positionIterations: 8,
    velocityIterations: 6,
    constraintIterations: 4,
  });
  const world = engine.world;

  const level = buildLevel(Matter, world, levelId);
  const { mech } = level;
  const DEF = level.def;
  const BEATS = DEF.beats;
  const SPAWN = DEF.spawns;
  const LEVEL_END = DEF.end;

  /* Every collision worth noticing, with a number for how hard it was.
   *
   * These are NOT sent over the network. Both machines run the same world, so
   * both machines have the same collisions, and a thump is a presentation
   * detail rather than a fact anyone has to agree about. Sending them would
   * add traffic to tell the other end something it already knows.
   */
  const impacts = [];
  Events.on(engine, 'collisionStart', (e) => {
    for (const pair of e.pairs) {
      const { bodyA, bodyB } = pair;
      const speed = Math.hypot(
        bodyB.velocity.x - bodyA.velocity.x,
        bodyB.velocity.y - bodyA.velocity.y);
      // A standing character's limbs are never quite still, and the balance
      // controller nudges them every step; at 2.2 a person doing nothing on a
      // bed produced five "impacts" a second and the game rattled.
      if (speed < 3.2) continue;
      // reduced mass: a crate hitting a wall is not the same event as a crate
      // hitting a teaspoon, even at the same speed
      const ma = bodyA.isStatic ? Infinity : bodyA.mass;
      const mb = bodyB.isStatic ? Infinity : bodyB.mass;
      const mu = ma === Infinity ? mb : mb === Infinity ? ma : (ma * mb) / (ma + mb);
      const mag = speed * Math.min(mu, 14);
      if (!Number.isFinite(mag) || mag < 12) continue;
      const c = pair.collision && pair.collision.supports && pair.collision.supports[0];
      impacts.push({
        x: c ? c.x : (bodyA.position.x + bodyB.position.x) / 2,
        y: c ? c.y : (bodyA.position.y + bodyB.position.y) / 2,
        mag,
        speed,
        owner: bodyA.plugin.owner || bodyB.plugin.owner || null,
        part: bodyA.plugin.part || bodyB.plugin.part || null,
        kind: bodyA.plugin.owner ? bodyB.plugin.kind || 'wall' : bodyA.plugin.kind || 'wall',
      });
      if (impacts.length > 24) impacts.shift();
    }
  });

  // Both ragdolls always exist, even before player two arrives. A fixed body
  // list is what lets a snapshot be a bare array of floats.
  const players = SPAWN.map((s, i) => {
    const rd = makeRagdoll(Matter, { x: s.x, y: s.y, id: 'p' + i, tint: i });
    addRagdoll(Matter, world, rd);
    return rd;
  });

  // A solo scene has ONE person in it. The second ragdoll still exists,
  // because a fixed body list is what keeps the snapshot a bare array of
  // floats, but it is parked off the map and nothing drives it. No partner,
  // no bot: the scene has to be finishable alone or it is not a solo scene.
  if (DEF.solo) {
    const rd = players[1];
    // capture the offset as NUMBERS first: torso.position is a live object, so
    // moving the torso changes the delta for every part after it in the loop
    const dx = -3000 - rd.parts.torso.position.x;
    const dy = (FLOOR1 - 400) - rd.parts.torso.position.y;
    for (const b of rd.bodies) {
      Body.setPosition(b, { x: b.position.x + dx, y: b.position.y + dy });
      Body.setStatic(b, true);
    }
  }

  // Body order for the wire: level dynamics first, then each ragdoll's parts.
  const netBodies = [...level.dynamic];
  for (const rd of players) netBodies.push(...rd.bodies);

  const sim = {
    Matter, engine, world, level, mech, players, netBodies,
    tick: 0,
    state: 'playing',          // playing | escaped | collapsed
    // The round does not begin until somebody actually enters the hotel.
    // Without this the collapse clock and the falling masonry start the moment
    // the room is created, so a pair who spend two minutes choosing characters
    // walk in with six minutes left and no idea why.
    started: false,
    // Solo play: slot 1 is driven by the partner instead of by a person.
    bot: false,
    botMode: BOT_FOLLOW,
    timeLeft: ROUND_SECONDS * TICK_HZ,
    shake: 0,
    beat: 0,
    // Where to put somebody back: the ground line they were last standing on,
    // not the position their torso happened to have. Storing a torso position
    // meant a player who fell down a lift shaft was put back in mid-air, in
    // the shaft, forever.
    levelId: DEF.id,
    checkpoint: SPAWN.map((s) => ({ x: s.x, y: s.y + 45 })),
    inputs: [{ ...EMPTY_INPUT }, { ...EMPTY_INPUT }],
    connected: [false, false],
    events: [],                // drained by the server each send
    authority,
    debrisTimer: 240,
    liftRiders: [],
    sprinklers: 0,
    wasWet: false,
    botAnchor: null,
    impacts,
    // The hotel's own agenda, and how much of it there is. Difficulty is not a
    // setting: it is how far in you are. The first minute is calm on purpose,
    // because a game that is chaotic before you can walk is not funny, it is
    // just confusing.
    chaos: freshChaos(),
    difficulty: 0,
    blackout: 0,
    party: 0,
    wind: 0,
  };

  /* ------------------------------------------------------------- mechanisms */

  function totalLoadOn(body, width, height) {
    // What is resting on this thing? Anything overlapping the slab of space
    // just above it counts, which is exactly how a real pressure plate feels.
    const p = body.position;
    const region = {
      min: { x: p.x - width / 2, y: p.y - height },
      max: { x: p.x + width / 2, y: p.y - 2 },
    };
    let load = 0;
    const seen = new Set();
    for (const b of Query.region(Composite.allBodies(world), region)) {
      if (b.isStatic) continue;
      // a ragdoll counts once, at its full bodyweight, however it is lying
      const owner = b.plugin.owner;
      if (owner) {
        if (seen.has(owner)) continue;
        seen.add(owner);
        const rd = players.find((r) => r.id === owner);
        load += rd ? rd.bodies.reduce((s, x) => s + x.mass, 0) : b.mass;
      } else {
        load += b.mass;
      }
    }
    return load;
  }

  /* Anything on the wall you can press. A hand within reach plus the grab
   * button, edge-triggered so leaning on one does not strobe it. */
  function stepSwitches() {
    for (const sw of mech.switches) {
      for (let i = 0; i < 2; i++) {
        if (!sim.connected[i]) continue;
        const rd = players[i];
        let touched = false;
        for (const side of ['B', 'F']) {
          const hand = rd.parts['farm' + side].position;
          if (Math.hypot(hand.x - sw.x, hand.y - sw.y) < 50) touched = true;
        }
        // Edge-triggered on the button, NOT on a cooldown. A cooldown means
        // standing next to a light switch with GRAB held strobes it twice a
        // second, which is not a light switch, it is a nightclub.
        const pressing = touched && !!sim.inputs[i].grab;
        const was = sw.held && sw.held[i];
        if (!sw.held) sw.held = [false, false];
        sw.held[i] = pressing;
        if (!pressing || was) continue;
        sw.on = !sw.on;
        emit('press', { id: sw.id, on: sw.on, x: sw.x, y: sw.y });

        if (sw.id === 'alarm' && sw.on) sim.sprinklers = 60 * 22;
        if (sw.id === 'vend' && sw.on) {
          // a can, from the debris pool, straight at your shins
          const can = mech.debris[(debrisNext++) % mech.debris.length];
          Body.setStatic(can, false);
          Body.setPosition(can, { x: sw.x - 30, y: sw.y + 60 });
          Body.setVelocity(can, { x: -3.5, y: -2 });
          Body.setAngularVelocity(can, -0.3);
          can.plugin.parked = false;
          sw.on = false;   // it is a button, not a latch
        }
      }
    }
  }

  /** Only what a player weighs, for things that should react to people. */
  function playerLoadOn(body, width, height) {
    const p = body.position;
    const region = {
      min: { x: p.x - width / 2, y: p.y - height },
      max: { x: p.x + width / 2, y: p.y - 2 },
    };
    let load = 0;
    const seen = new Set();
    for (const b of Query.region(Composite.allBodies(world), region)) {
      const owner = b.plugin.owner;
      if (!owner || seen.has(owner)) continue;
      seen.add(owner);
      const rd = players.find((r) => r.id === owner);
      if (rd) load += rd.bodies.reduce((s, x) => s + x.mass, 0);
    }
    return load;
  }

  /* How far in, and therefore how mean the building is allowed to be.
   * Half from progress and half from the clock, so a slow careful pair still
   * get an escalation and a fast one is not punished for being good. */
  function updateDifficulty() {
    const byBeat = sim.beat / Math.max(1, BEATS.length - 1);
    const byClock = 1 - Math.max(0, sim.timeLeft) / (ROUND_SECONDS * TICK_HZ);
    sim.difficulty = Math.max(0, Math.min(1, byBeat * 0.55 + byClock * 0.45));
  }

  /** Whatever the building is currently doing to you. */
  function stepChaosEffects() {
    const started = stepChaos(sim, TICK_HZ);
    if (started) emit('chaos', { id: started });

    // the lull between events shortens as things get worse
    if (sim.chaos.next > 0 && sim.difficulty > 0.35) {
      sim.chaos.next -= Math.random() < sim.difficulty * 0.9 ? 1 : 0;
    }

    sim.blackout = Math.max(0, sim.blackout - 1);
    sim.party = Math.max(0, sim.party - 1);
    sim.wind = Math.max(0, sim.wind - 1);

    const id = sim.chaos.id;
    if (!id) return;

    if (id === 'power') {
      sim.blackout = 4;
      const lights = mech.switches.find((x) => x.id === 'lights');
      if (lights) lights.on = false;
    } else if (id === 'sprinklers') {
      sim.sprinklers = Math.max(sim.sprinklers, 4);
    } else if (id === 'party') {
      sim.party = 4;
    } else if (id === 'draught') {
      sim.wind = 4;
      // a steady shove along the corridor: enough to make carrying something
      // awkward, nowhere near enough to move a person on its own
      for (const b of level.dynamic) {
        if (b.isStatic || b.plugin.parked) continue;
        if (b.mass > 8) continue;
        Body.applyForce(b, b.position, { x: -0.00012 * b.mass, y: 0 });
      }
    } else if (id === 'quake') {
      const t = sim.chaos.left;
      sim.shake = Math.min(1, sim.shake + 0.08);
      if (t % 7 === 0) {
        for (const b of level.dynamic) {
          if (b.isStatic || b.plugin.parked) continue;
          Body.setVelocity(b, {
            x: b.velocity.x + (Math.random() - 0.5) * 2.4,
            y: b.velocity.y - Math.random() * 1.2,
          });
        }
        for (const rd of players) {
          Body.setAngularVelocity(rd.parts.torso,
            rd.parts.torso.angularVelocity + (Math.random() - 0.5) * 0.12);
        }
      }
    }
  }

  function stepMechanisms() {
    stepSwitches();
    updateDifficulty();
    stepChaosEffects();
    if (sim.sprinklers > 0) sim.sprinklers--;
    // --- pressure plate -> the gate it opens --------------------------------
    if (mech.plate && mech.shutter) {
      mech.plateLoad = totalLoadOn(mech.plate, 150, 70);
      const wantOpen = mech.plateLoad >= mech.plateNeeds ? 1 : 0;
      const prev = mech.shutterOpen;
      // it grinds up slowly and drops like a guillotine, which is the joke
      mech.shutterOpen = wantOpen
        ? Math.min(1, mech.shutterOpen + 0.010)
        : Math.max(0, mech.shutterOpen - (mech.shutter.plugin.closeRate ?? 0.026));
      const sx = mech.shutter.plugin.homeX;
      if (prev > 0.05 && mech.shutterOpen <= 0.05) emit('shutterSlam', { x: sx });
      Body.setPosition(mech.shutter, {
        x: sx,
        y: FLOOR1 - 90 - mech.shutterOpen * mech.shutter.plugin.travel,
      });
    }

    // --- the lump of ceiling that lets go on cue ----------------------------
    if (mech.ceiling && !mech.ceilingDropped && sim.started) {
      const near = players.some((rd, i) => sim.connected[i]
        && Math.abs(rd.parts.torso.position.x - mech.ceilingAt) < 90);
      if (near) {
        mech.ceilingDropped = true;
        Body.setStatic(mech.ceiling, false);
        Body.setVelocity(mech.ceiling, { x: 0, y: 2 });
        Body.setAngularVelocity(mech.ceiling, 0.06);
        emit('ceiling', { x: mech.ceiling.position.x, y: mech.ceiling.position.y });
      }
    }

    // --- crumbling hallway --------------------------------------------------
    for (const tile of mech.crumble) {
      const pl = tile.plugin;
      if (pl.fuse === -1 && tile.isStatic) {
        // A PERSON has to step on it. It used to be any weight at all, and a
        // plank happened to be lying across the hallway at the start of every
        // match - so the floor collapsed on its own, in an empty room, before
        // either player had left the bedroom.
        const load = playerLoadOn(tile, 50, 40);
        if (load > 0.5) { pl.fuse = 34; emit('creak', { x: tile.position.x }); }
      } else if (pl.fuse > 0) {
        pl.fuse--;
        if (pl.fuse === 0) {
          Body.setStatic(tile, false);
          Body.setVelocity(tile, { x: (Math.random() - 0.5) * 0.6, y: 1.4 });
          Body.setAngularVelocity(tile, (Math.random() - 0.5) * 0.1);
          pl.regrow = 60 * 9;
          emit('tileGo', { x: tile.position.x });
        }
      } else if (pl.regrow > 0) {
        pl.regrow--;
        // Catch it once it is well out of sight. A body left falling forever
        // eventually integrates its way to a non-finite position, and once
        // that happens setPosition can never bring it back: the move is
        // computed as a delta FROM the broken position, so the vertices stay
        // NaN and the tile is gone for the rest of the match.
        if (!tile.isStatic && (tile.position.y > FLOOR1 + 700
            || !Number.isFinite(tile.position.y))) {
          Body.setStatic(tile, true);
          Body.setAngle(tile, 0);
          Body.setPosition(tile, { x: pl.home.x, y: FLOOR1 + 1600 });
        }
        if (pl.regrow === 0) {
          // put it back so a retry is a retry, not a dead end
          Body.setStatic(tile, true);
          Body.setAngle(tile, 0);
          Body.setPosition(tile, pl.home);
          pl.fuse = -1;
        }
      }
    }

    // --- the two lift levers ------------------------------------------------
    if (!mech.levers.length || !mech.lift) return stepRest();
    const pulled = mech.levers.map((l) => Math.abs(l.angle) > 0.42);
    mech.leversOn = pulled;
    const both = pulled[0] && pulled[1];
    const wasCalled = mech.liftPos >= 1;
    mech.liftPos = both
      ? Math.min(1, mech.liftPos + 1 / (60 * 2.2))
      : Math.max(0, mech.liftPos - 1 / (60 * 1.1));
    if (!wasCalled && mech.liftPos >= 1) emit('liftHere', {});
    Body.setPosition(mech.lift, {
      x: mech.lift.plugin.homeX,
      y: mech.lift.plugin.from - mech.liftPos * mech.lift.plugin.travel,
    });

    // Anything standing on the lift rides it, or it slides out from under them
    // like a rug. Static platforms do not carry passengers on their own.
    const dy = mech.lift.position.y - (mech.lift.plugin.lastY ?? mech.lift.position.y);
    if (dy) {
      const lx = mech.lift.plugin.homeX;
      for (const b of Query.region(Composite.allBodies(world), {
        min: { x: lx - 105, y: mech.lift.position.y - 130 },
        max: { x: lx + 105, y: mech.lift.position.y - 4 },
      })) {
        if (!b.isStatic) Body.translate(b, { x: 0, y: dy });
      }
    }
    mech.lift.plugin.lastY = mech.lift.position.y;

    return stepRest();
  }

  /** Everything that happens in every scene, whether or not it has a lift. */
  function stepRest() {
    // Wet floor. Pulling the alarm soaks everything, and a soaked floor is a
    // very funny place to try to carry a wardrobe.
    const wet = sim.sprinklers > 0;
    if (wet !== sim.wasWet) {
      sim.wasWet = wet;
      for (const b of Composite.allBodies(world)) {
        if (b.plugin.kind === 'wall' || b.plugin.kind === 'crumble') {
          b.friction = wet ? 0.16 : 0.9;
        }
      }
    }

    // --- the building slowly gives up ---------------------------------------
    if (!sim.started) return;
    sim.debrisTimer--;
    const urgency = 1 - sim.timeLeft / (ROUND_SECONDS * TICK_HZ);
    if (sim.debrisTimer <= 0) {
      sim.debrisTimer = Math.max(60, 300 - urgency * 220);
      dropDebris();
    }
    sim.shake = Math.max(0, sim.shake - 0.02);
  }

  let debrisNext = 0;
  function dropDebris() {
    const focus = cameraFocus();
    const b = mech.debris[debrisNext++ % mech.debris.length];
    Body.setStatic(b, false);
    Body.setPosition(b, { x: focus.x + (Math.random() - 0.5) * 900, y: focus.y - 520 });
    Body.setVelocity(b, { x: 0, y: 3 });
    Body.setAngularVelocity(b, (Math.random() - 0.5) * 0.2);
    b.plugin.parked = false;
    sim.shake = Math.min(1, sim.shake + 0.35);
    emit('rumble', { x: b.position.x });
  }

  /* ------------------------------------------------------------------ rules */

  function emit(type, data) {
    if (sim.authority) sim.events.push({ type, ...data, tick: sim.tick });
  }

  /* Anything whose position has stopped being a number.
   *
   * Matter moves a body by adding a delta to where it currently is, so once a
   * position is NaN there is no way back through the normal API - and the NaN
   * then spreads into collision reports, into the camera, and into the audio,
   * where the browser throws rather than doing nothing. One sweep, twice a
   * second, ends the whole family of bugs. */
  /** Put a body's geometry back by hand. Nothing in Matter's API can move a
   *  body whose position is already NaN, because every move is a delta. */
  function repair(dst, src) {
    for (let k = 0; k < dst.vertices.length && k < src.vertices.length; k++) {
      dst.vertices[k].x = src.vertices[k].x;
      dst.vertices[k].y = src.vertices[k].y;
    }
    dst.position.x = src.position.x;
    dst.position.y = src.position.y;
    dst.positionPrev.x = src.position.x;
    dst.positionPrev.y = src.position.y;
    dst.velocity.x = 0; dst.velocity.y = 0;
    dst.angle = 0; dst.anglePrev = 0; dst.angularVelocity = 0;
    dst.force.x = 0; dst.force.y = 0;
    dst.torque = 0;
    Matter.Bounds.update(dst.bounds, dst.vertices, dst.velocity);
  }

  function sweepBroken() {
    for (const b of netBodies) {
      if (Number.isFinite(b.position.x) && Number.isFinite(b.position.y)) continue;
      if (b.plugin.owner) continue;                 // players are respawned instead
      const home = b.plugin.home || { x: -1200, y: -800 };
      const dx = home.x - (b.plugin.spawnX ?? home.x);
      repair(b, {
        vertices: b.vertices.map((v, k) => ({
          x: home.x + (b.plugin.vx ? b.plugin.vx[k] : 0),
          y: home.y + (b.plugin.vy ? b.plugin.vy[k] : 0),
        })),
        position: home,
      });
      if (b.plugin.kind === 'debris') b.plugin.parked = true;
      else if (b.plugin.kind !== 'crumble') Body.setStatic(b, false);
    }
  }

  /** Remember the ground each connected player is standing on. */
  function saveCheckpoints() {
    for (let i = 0; i < 2; i++) {
      if (!sim.connected[i]) continue;
      const rd = players[i];
      if (rd.grounded <= 0 || rd.stun > 0) continue;
      const t = rd.parts.torso.position;
      const feet = Math.max(rd.parts.shinB.bounds.max.y, rd.parts.shinF.bounds.max.y);
      if (feet > FLOOR1 + 60) continue;          // standing on something falling
      sim.checkpoint[i] = { x: clamp(t.x, 60, LEVEL_END - 60), y: feet };
    }
  }

  function cameraFocus() {
    const a = players[0].parts.torso.position;
    const b = sim.connected[1] ? players[1].parts.torso.position : a;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function respawn(i, why) {
    const rd = players[i];
    const cp = sim.checkpoint[i];
    for (const side of ['B', 'F']) releaseGrab(Matter, world, rd, side);
    // rebuild the pose from scratch so nobody respawns already folded in half,
    // standing ON the checkpoint's floor rather than somewhere above it
    const fresh = makeRagdoll(Matter, { x: cp.x, y: cp.y - 46, id: rd.id, tint: rd.tint });
    for (const name of PART_NAMES) {
      const src = fresh.parts[name], dst = rd.parts[name];
      // setPosition moves by a delta FROM the current position, so a body that
      // is already non-finite can never be moved back. Put its geometry back
      // by hand first.
      if (!Number.isFinite(dst.position.x) || !Number.isFinite(dst.position.y)) {
        repair(dst, src);
      }
      Body.setPosition(dst, src.position);
      Body.setAngle(dst, 0);
      Body.setVelocity(dst, { x: 0, y: 0 });
      Body.setAngularVelocity(dst, 0);
    }
    rd.limp = 0; rd.stun = 30; rd.balance = 0.4; rd.launched = 0;
    emit('respawn', { player: i, why });
  }

  function checkProgress() {
    const focus = cameraFocus();

    // Progress only counts if it was made on your feet. Falling past a marker
    // used to advance the beat and hand out its checkpoint, so missing the
    // jump over the broken section put you down on the FAR side of the hole
    // you had just failed to cross - which quietly deleted the puzzle.
    const standing = players.some((rd, i) => sim.connected[i] && rd.grounded > 0);

    while (sim.beat < BEATS.length - 1 && focus.x > BEATS[sim.beat + 1].at && standing) {
      sim.beat++;
      emit('beat', { beat: sim.beat });
      saveCheckpoints();
    }

    // and keep the checkpoint fresh while they are safely on the ground, so a
    // fall costs you the last few paces rather than the last few minutes
    if (sim.tick % 30 === 0) saveCheckpoints();

    for (let i = 0; i < 2; i++) {
      // An empty slot is not a player who has fallen out of the world. The
      // out-of-bounds rescue was hauling the parked second ragdoll back to the
      // spawn point in every solo scene, where it then stood on the player.
      if (!sim.connected[i]) continue;
      const rd = players[i];
      const t = rd.parts.torso.position;

      // A character whose position has gone non-finite is gone for good: every
      // later move is computed as a delta from NaN. Rebuild them rather than
      // leaving an invisible player and a camera that can no longer draw.
      if (!Number.isFinite(t.x) || !Number.isFinite(t.y)) {
        respawn(i, 'broke');
        continue;
      }

      // Out of the world by depth, or simply stuck somewhere below it. The
      // depth test alone was not enough: a player could come to rest on a
      // ledge in the shaft, above the threshold, not grounded, and stay there
      // for the rest of the match with nothing to do and no way back.
      const belowTheFloor = t.y > FLOOR1 + 120;
      rd.lost = belowTheFloor && rd.grounded <= 0 ? (rd.lost || 0) + 1 : 0;
      if (t.y > FLOOR1 + 380 || t.x < -200 || rd.lost > 150) {
        rd.lost = 0;
        respawn(i, 'fell');
      }
      if (rd.launched > 40) { emit('yeet', { player: i }); rd.launched = 0; }
    }

    // How a scene ends. With a lift: everybody aboard, lift here. Without one:
    // simply get to the far end - a solo scene has nobody to wait for.
    if (sim.state === 'playing') {
      if (mech.lift) {
        if (mech.liftPos >= 1) {
          const lx = mech.lift.plugin.homeX;
          const onboard = players.filter((rd, i) => {
            if (i === 1 && !sim.connected[1]) return true;
            const t = rd.parts.torso.position;
            return Math.abs(t.x - lx) < 110
              && Math.abs(t.y - (mech.lift.position.y - 60)) < 90;
          });
          if (onboard.length === 2) { sim.state = 'escaped'; emit('escaped', {}); }
        }
      } else {
        const out = players.every((rd, i) => !sim.connected[i]
          || rd.parts.torso.position.x > LEVEL_END - 160);
        if (out) { sim.state = 'escaped'; emit('escaped', {}); }
      }
    }

    // A tutorial with a doom clock is not a tutorial. The solo scene has all
    // the time in the world; the building is only impatient in co-op.
    if (sim.state === 'playing' && sim.started && !DEF.solo) {
      sim.timeLeft--;
      if (sim.timeLeft <= 0) { sim.state = 'collapsed'; emit('collapsed', {}); }
    }
  }

  /* ------------------------------------------------------------------- step */

  sim.setInput = (i, input) => {
    const cur = sim.inputs[i];
    const next = { ...EMPTY_INPUT, ...input };
    next.wasGrab = cur.grab;
    sim.inputs[i] = next;
  };

  sim.step = () => {
    // the partner decides what it is doing before anybody moves
    if (sim.bot && sim.connected[1] && !DEF.solo) {
      sim.setInput(1, botInput(sim, 1, 0, sim.botMode));
      if (botRescue(sim, 1, 0)) {
        const t = players[0].parts.torso.position;
        sim.checkpoint[1] = { x: t.x - 40, y: Math.min(t.y, FLOOR1 - 60) };
        respawn(1, 'lost');
      }
    }

    for (let i = 0; i < 2; i++) {
      const rd = players[i];

      // Nobody there: do not simulate them at all. Running the controller on an
      // absent player is not merely wasted work - it writes velocities and
      // angular velocities onto bodies that are parked and frozen, and in a
      // solo scene that was enough to pin the REAL player in place three
      // thousand units away. An empty slot is empty.
      if (!sim.connected[i]) {
        rd.reaching = false;
        continue;
      }

      const input = sim.inputs[i];

      // grab is edge-triggered: press to take hold, release to let go
      // reaching: the button is down but nothing has been caught yet
      rd.reaching = !!input.grab && !rd.grabs.F && !rd.grabs.B;

      if (input.grab && !input.wasGrab) {
        const bodies = Composite.allBodies(world);
        tryGrab(Matter, world, rd, 'F', bodies);
        tryGrab(Matter, world, rd, 'B', bodies);
      } else if (!input.grab && input.wasGrab) {
        releaseGrab(Matter, world, rd, 'F');
        releaseGrab(Matter, world, rd, 'B');
      }
      input.wasGrab = input.grab;

      // Smooth at the start, comic later. A character who trips over their own
      // feet in the first ten seconds reads as broken controls; the same
      // character tripping in a blackout during an earthquake reads as a joke.
      rd.tripChance = 0.06 + sim.difficulty * 0.62;
      stepRagdoll(Matter, world, rd, input, players);
      enforceGrabs(Matter, world, rd);
    }

    boosts();

    // WAIT means WAIT, at this spot. Bracing alone is not enough: the human
    // walks into it, or grabs it, and the partner ends up sixty units from the
    // plate it was told to stand on - which is exactly the moment the puzzle
    // stops working and the player blames the game. So it remembers where it
    // was standing and leans back toward it.
    if (sim.bot && sim.botMode === 1 && sim.connected[1]) {
      const rd = players[1];
      if (sim.botAnchor === null) sim.botAnchor = rd.parts.torso.position.x;
      const err = sim.botAnchor - rd.parts.torso.position.x;
      // stiff enough to survive being walked into, which is the only force
      // that ever actually moves it
      const pull = Math.max(-2.6, Math.min(2.6, err * 0.26));
      for (const name of ['torso', 'thighB', 'thighF', 'shinB', 'shinF']) {
        const b = rd.parts[name];
        Body.setVelocity(b, { x: b.velocity.x * 0.34 + pull, y: b.velocity.y });
      }
    } else {
      sim.botAnchor = null;
    }

    stepMechanisms();
    Matter.Engine.update(engine, 1000 / TICK_HZ);
    if (sim.tick % 30 === 0) sweepBroken();
    checkProgress();
    sim.tick++;
  };

  /** THE BOOST. Brace (the special) means "I am cupping my hands"; a friend
   *  who jumps while standing next to you is launched off you.
   *
   *  This started out as emergent stacking - climb onto your friend's head and
   *  jump - and it did not survive contact with a ragdoll: a head is a circle,
   *  the pile collapses, and the boost was worth 21 units of height. Making it
   *  an explicit verb costs nothing in honesty (it is still one player's legs
   *  throwing the other) and gains a mechanic two people can actually aim.
   */
  function boosts() {
    for (let i = 0; i < 2; i++) {
      const a = players[i], b = players[1 - i];
      if (!a.bracing || !sim.connected[i] || !sim.connected[1 - i]) continue;
      const input = sim.inputs[1 - i];
      if (!input.jump || b.boostCooldown > 0) continue;
      const at = a.parts.torso.position, bt = b.parts.torso.position;
      if (Math.abs(at.x - bt.x) > 52 || bt.y > at.y + 44 || bt.y < at.y - 120) continue;

      const dir = Math.sign(bt.x - at.x) || b.facing;
      for (const part of b.bodies) {
        Body.setVelocity(part, { x: part.velocity.x + dir * 2.2, y: -18.5 });
      }
      b.boostCooldown = 25;
      b.grounded = 0;
      // the launcher gets flattened, because of course they do
      Body.setVelocity(a.parts.torso, { x: a.parts.torso.velocity.x, y: 3.2 });
      a.stun = Math.max(a.stun, 22);
      emit('boost', { player: 1 - i, x: bt.x, y: bt.y });
    }
    for (const rd of players) if (rd.boostCooldown > 0) rd.boostCooldown--;
  }

  sim.cameraFocus = cameraFocus;
  sim.respawn = respawn;
  sim.drainEvents = () => { const e = sim.events; sim.events = []; return e; };
  sim.drainImpacts = () => impacts.splice(0, impacts.length);

  /* -------------------------------------------------------------- snapshots */

  const HEAD = 12;
  const PER_BODY = 6;
  const PER_PLAYER = 14;
  const FLOATS = HEAD + netBodies.length * PER_BODY + 2 * PER_PLAYER;

  sim.snapshotSize = FLOATS * 4;

  sim.snapshot = () => {
    const f = new Float32Array(FLOATS);
    f[0] = sim.tick;
    f[1] = sim.state === 'playing' ? 0 : sim.state === 'escaped' ? 1 : 2;
    f[2] = sim.timeLeft;
    f[3] = mech.shutterOpen;
    f[4] = mech.liftPos;
    f[5] = mech.plateLoad;
    f[6] = sim.beat;
    f[7] = sim.shake;
    f[8] = (sim.started ? 1 : 0) + (sim.bot ? 2 : 0) + (sim.botMode ? 4 : 0);
    let bits = sim.sprinklers > 0 ? 1 : 0;
    mech.switches.forEach((sw, i) => { if (sw.on) bits |= 2 << i; });
    f[9] = bits;
    f[10] = sim.chaos.id ? eventIndex(sim.chaos.id) + 1 : 0;
    f[11] = sim.difficulty;

    let o = HEAD;
    for (const b of netBodies) {
      f[o++] = b.position.x; f[o++] = b.position.y; f[o++] = b.angle;
      f[o++] = b.velocity.x; f[o++] = b.velocity.y; f[o++] = b.angularVelocity;
    }
    for (const rd of players) {
      f[o++] = rd.facing; f[o++] = rd.balance; f[o++] = rd.limp; f[o++] = rd.stun;
      f[o++] = rd.grounded; f[o++] = rd.launched;
      f[o++] = rd.aim ? rd.aim.x : NaN; f[o++] = rd.aim ? rd.aim.y : NaN;
      for (const side of ['B', 'F']) {
        const c = rd.grabs[side];
        f[o++] = c ? netBodies.indexOf(c.bodyB) : -1;
        f[o++] = c ? c.pointB.x : 0;
        f[o++] = c ? c.pointB.y : 0;
      }
    }
    return f;
  };

  /** Lean this world toward the authority's. `k` 0..1 - how hard to lean. */
  sim.applySnapshot = (f, k = 0.35) => {
    // A snapshot of the wrong length is not a snapshot, it is somebody else's
    // data read as ours: every body lands somewhere arbitrary, positions go
    // non-finite within seconds, and the symptom appears in the camera and the
    // audio rather than anywhere near the cause. Ask once, refuse clearly.
    // (Which is exactly what happened: a server left running across a change
    // to the header size cost an hour of hunting a "physics explosion".)
    if (f.length !== FLOATS) {
      sim.protocolMismatch = true;
      return;
    }
    sim.protocolMismatch = false;
    sim.tick = f[0];
    sim.state = ['playing', 'escaped', 'collapsed'][f[1]] || 'playing';
    sim.timeLeft = f[2];
    mech.shutterOpen = f[3];
    mech.liftPos = f[4];
    mech.plateLoad = f[5];
    sim.beat = f[6];
    sim.shake = f[7];
    const flags = Math.round(f[8]);
    sim.started = !!(flags & 1);
    sim.bot = !!(flags & 2);
    sim.botMode = (flags & 4) ? 1 : 0;
    const bits = Math.round(f[9]);
    sim.sprinklers = (bits & 1) ? 1 : 0;
    mech.switches.forEach((sw, i) => { sw.on = !!(bits & (2 << i)); });
    const ev = Math.round(f[10]);
    sim.chaos.id = ev > 0 && EVENTS[ev - 1] ? EVENTS[ev - 1].id : null;
    sim.difficulty = f[11];
    sim.blackout = sim.chaos.id === 'power' ? 4 : 0;
    sim.party = sim.chaos.id === 'party' ? 4 : 0;
    sim.wind = sim.chaos.id === 'draught' ? 4 : 0;

    let o = HEAD;
    for (const b of netBodies) {
      const x = f[o++], y = f[o++], a = f[o++], vx = f[o++], vy = f[o++], va = f[o++];
      if (b.isStatic) {
        Body.setPosition(b, { x, y });
        Body.setAngle(b, a);
        continue;
      }
      const dx = x - b.position.x, dy = y - b.position.y;
      // A big divergence is not a nudge, it is a teleport somewhere else: snap.
      const far = dx * dx + dy * dy > 90 * 90;
      Body.setPosition(b, far
        ? { x, y }
        : { x: b.position.x + dx * k, y: b.position.y + dy * k });
      let da = a - b.angle;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      Body.setAngle(b, far ? a : b.angle + da * k);
      Body.setVelocity(b, { x: vx, y: vy });
      Body.setAngularVelocity(b, va);
    }
    for (const rd of players) {
      rd.facing = f[o++]; rd.balance = f[o++]; rd.limp = f[o++]; rd.stun = f[o++];
      rd.grounded = f[o++]; rd.launched = f[o++];
      const ax = f[o++], ay = f[o++];
      rd.aim = Number.isNaN(ax) ? null : { x: ax, y: ay };
      for (const side of ['B', 'F']) {
        const idx = f[o++], px = f[o++], py = f[o++];
        const cur = rd.grabs[side];
        const want = idx >= 0 ? netBodies[idx] : null;
        if (!want) { if (cur) releaseGrab(Matter, world, rd, side); continue; }
        if (cur && cur.bodyB === want) { cur.pointB.x = px; cur.pointB.y = py; continue; }
        if (cur) releaseGrab(Matter, world, rd, side);
        const c = Matter.Constraint.create({
          bodyA: rd.parts['farm' + side], pointA: { x: 0, y: 10 },
          bodyB: want, pointB: { x: px, y: py },
          length: want.plugin.owner ? 30 : 6, stiffness: 0.16, damping: 0.2,
          render: { visible: false },
        });
        c.plugin = { grab: true, by: rd.id, side };
        Composite.add(world, c);
        rd.grabs[side] = c;
      }
    }
  };

  return sim;
}
