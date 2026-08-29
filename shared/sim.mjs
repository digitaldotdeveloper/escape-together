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

import { buildLevel, FLOOR1, FLOOR2, BEATS, LEVEL_END } from './level.mjs';
import {
  makeRagdoll, addRagdoll, stepRagdoll, tryGrab, releaseGrab, enforceGrabs,
  PART_NAMES,
} from './ragdoll.mjs';

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

export function createSim(Matter, { authority = false } = {}) {
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

  const level = buildLevel(Matter, world);
  const { mech } = level;

  // Both ragdolls always exist, even before player two arrives. A fixed body
  // list is what lets a snapshot be a bare array of floats.
  const players = SPAWNS.map((s, i) => {
    const rd = makeRagdoll(Matter, { x: s.x, y: s.y, id: 'p' + i, tint: i });
    addRagdoll(Matter, world, rd);
    return rd;
  });

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
    timeLeft: ROUND_SECONDS * TICK_HZ,
    shake: 0,
    beat: 0,
    checkpoint: SPAWNS.map((s) => ({ ...s })),
    inputs: [{ ...EMPTY_INPUT }, { ...EMPTY_INPUT }],
    connected: [false, false],
    events: [],                // drained by the server each send
    authority,
    debrisTimer: 240,
    liftRiders: [],
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

  function stepMechanisms() {
    // --- pressure plate -> emergency shutter -------------------------------
    mech.plateLoad = totalLoadOn(mech.plate, 150, 70);
    const wantOpen = mech.plateLoad >= PLATE_NEEDS ? 1 : 0;
    const prev = mech.shutterOpen;
    // it grinds up slowly and drops like a guillotine, which is the joke
    mech.shutterOpen = wantOpen
      ? Math.min(1, mech.shutterOpen + 0.010)
      : Math.max(0, mech.shutterOpen - 0.026);
    if (prev > 0.05 && mech.shutterOpen <= 0.05) emit('shutterSlam', { x: 1660 });
    Body.setPosition(mech.shutter, {
      x: 1660,
      y: FLOOR1 - 90 - mech.shutterOpen * 212,   // clears a 104-tall character
    });

    // --- crumbling hallway --------------------------------------------------
    for (const tile of mech.crumble) {
      const pl = tile.plugin;
      if (pl.fuse === -1 && tile.isStatic) {
        const load = totalLoadOn(tile, 50, 40);
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
    const pulled = mech.levers.map((l) => Math.abs(l.angle) > 0.42);
    mech.leversOn = pulled;
    const both = pulled[0] && pulled[1];
    const wasCalled = mech.liftPos >= 1;
    mech.liftPos = both
      ? Math.min(1, mech.liftPos + 1 / (60 * 2.2))
      : Math.max(0, mech.liftPos - 1 / (60 * 1.1));
    if (!wasCalled && mech.liftPos >= 1) emit('liftHere', {});
    Body.setPosition(mech.lift, {
      x: 4860,
      y: FLOOR2 + 120 - mech.liftPos * 132,
    });

    // Anything standing on the lift rides it, or it slides out from under them
    // like a rug. Static platforms do not carry passengers on their own.
    const dy = mech.lift.position.y - (mech.lift.plugin.lastY ?? mech.lift.position.y);
    if (dy) {
      for (const b of Query.region(Composite.allBodies(world), {
        min: { x: 4755, y: mech.lift.position.y - 130 },
        max: { x: 4965, y: mech.lift.position.y - 4 },
      })) {
        if (!b.isStatic) Body.translate(b, { x: 0, y: dy });
      }
    }
    mech.lift.plugin.lastY = mech.lift.position.y;

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

  function cameraFocus() {
    const a = players[0].parts.torso.position;
    const b = sim.connected[1] ? players[1].parts.torso.position : a;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function respawn(i, why) {
    const rd = players[i];
    const cp = sim.checkpoint[i];
    for (const side of ['B', 'F']) releaseGrab(Matter, world, rd, side);
    // rebuild the pose from scratch so nobody respawns already folded in half
    const fresh = makeRagdoll(Matter, { x: cp.x, y: cp.y - 40, id: rd.id, tint: rd.tint });
    for (const name of PART_NAMES) {
      const src = fresh.parts[name], dst = rd.parts[name];
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
    while (sim.beat < BEATS.length - 1 && focus.x > BEATS[sim.beat + 1].at) {
      sim.beat++;
      emit('beat', { beat: sim.beat });
      // a checkpoint per beat, so a wipe costs a laugh and not the level
      for (let i = 0; i < 2; i++) {
        const t = players[i].parts.torso.position;
        sim.checkpoint[i] = { x: clamp(t.x, 60, LEVEL_END - 60), y: Math.min(t.y, FLOOR1 - 60) };
      }
    }

    for (let i = 0; i < 2; i++) {
      const rd = players[i];
      const t = rd.parts.torso.position;
      if (t.y > FLOOR1 + 380 || t.x < -200) respawn(i, 'fell');
      if (rd.launched > 40) { emit('yeet', { player: i }); rd.launched = 0; }
    }

    // both of them, on the lift, with the lift actually here
    if (sim.state === 'playing' && mech.liftPos >= 1) {
      const onboard = players.filter((rd, i) => {
        if (i === 1 && !sim.connected[1]) return true; // solo practice still ends
        const t = rd.parts.torso.position;
        return Math.abs(t.x - 4860) < 110 && Math.abs(t.y - (mech.lift.position.y - 60)) < 90;
      });
      if (onboard.length === 2) {
        sim.state = 'escaped';
        emit('escaped', {});
      }
    }

    if (sim.state === 'playing' && sim.started) {
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
    for (let i = 0; i < 2; i++) {
      const rd = players[i];
      const input = sim.connected[i] ? sim.inputs[i] : EMPTY_INPUT;

      // grab is edge-triggered: press to take hold, release to let go
      if (input.grab && !input.wasGrab) {
        const bodies = Composite.allBodies(world);
        tryGrab(Matter, world, rd, 'F', bodies);
        tryGrab(Matter, world, rd, 'B', bodies);
      } else if (!input.grab && input.wasGrab) {
        releaseGrab(Matter, world, rd, 'F');
        releaseGrab(Matter, world, rd, 'B');
      }
      input.wasGrab = input.grab;

      stepRagdoll(Matter, world, rd, input, players);
      enforceGrabs(Matter, world, rd);
    }

    boosts();

    stepMechanisms();
    Matter.Engine.update(engine, 1000 / TICK_HZ);
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

  /* -------------------------------------------------------------- snapshots */

  const HEAD = 9;
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
    f[8] = sim.started ? 1 : 0;

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
    sim.tick = f[0];
    sim.state = ['playing', 'escaped', 'collapsed'][f[1]] || 'playing';
    sim.timeLeft = f[2];
    mech.shutterOpen = f[3];
    mech.liftPos = f[4];
    mech.plateLoad = f[5];
    sim.beat = f[6];
    sim.shake = f[7];
    sim.started = f[8] > 0.5;

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
