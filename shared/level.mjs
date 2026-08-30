/* Building a scene.
 *
 * The layouts live in levels.mjs as data; this file turns whichever one it is
 * handed into bodies. Both the server and every client run this same builder
 * over the same definition in the same order, so body N on one machine is body
 * N on the other and a snapshot is just a list of numbers.
 *
 * The corollary, learned the hard way: BOTH ENDS MUST BUILD THE SAME LEVEL.
 * A client on solo1 reading a coop1 snapshot decodes every position from the
 * wrong offset, and the symptom shows up as the physics exploding rather than
 * as anything to do with levels. sim.mjs length-checks for exactly that.
 */

import { LEVELS, DEFAULT_LEVEL, levelById, FLOOR1, FLOOR2 } from './levels.mjs';

export { FLOOR1, FLOOR2, LEVELS, levelById };
export const LEVEL_END = 5320;

// A room's worth of pastel hotel colours, so the whole thing reads as one place.
export const PALETTE = {
  wall: '#f0d9b8', wallDark: '#d8b98f', carpet: '#9c3b3b', carpetDark: '#7d2f2f',
  wood: '#8b5a2b', woodDark: '#6b4420', metal: '#8e99a6', metalDark: '#6a747f',
  bed: '#e8e2d5', accent: '#2f6f8f', hazard: '#e0a01f', shutter: '#b0562a',
};

export function buildLevel(Matter, world, levelId = DEFAULT_LEVEL) {
  const { Bodies, Body, Composite, Constraint } = Matter;
  const L = levelById(levelId);
  const add = (b) => { Composite.add(world, b); return b; };
  const mech = {};
  const dynamic = [];   // everything the network syncs, in build order
  const decor = [];

  // ---- static geometry ---------------------------------------------------
  for (const s of L.statics) {
    const b = Bodies.rectangle(s.x + s.w / 2, s.y + s.h / 2, s.w, s.h, {
      isStatic: true, label: 'static:' + s.id, friction: 0.9,
    });
    b.plugin.kind = 'wall';
    b.plugin.grabbable = !!s.grab;
    add(b);
    decor.push({ ...s, body: b });
  }

  // ---- props -------------------------------------------------------------
  // Props carry a target mass, not a density: "the wardrobe weighs three
  // people" is a design statement, and a prop must not get heavier just
  // because somebody made it bigger.
  for (const p of L.props) {
    const b = Bodies.rectangle(p.x, p.y, p.w, p.h, {
      label: 'prop:' + p.id,
      density: (p.mass || 2) / (p.w * p.h),
      friction: p.friction ?? 0.62,
      frictionAir: 0.014,
      restitution: 0.08,
      chamfer: { radius: 4 },
    });
    b.plugin.kind = p.type;
    b.plugin.propId = p.id;
    b.plugin.w = p.w; b.plugin.h = p.h;
    b.plugin.mass0 = p.mass || 2;
    // Light enough to pick up and carry, or heavy enough that all you can do
    // is lean on it. The renderer picks a carrying or a shoving pose from this,
    // and jumping while holding the light one costs you height.
    b.plugin.liftable = (p.mass || 2) <= 3.2;
    add(b);
    dynamic.push(b);
    mech[p.id] = b;
  }

  // ---- crumbling floor tiles ---------------------------------------------
  // Built DYNAMIC and then frozen, never built static: Matter only remembers a
  // body's real mass in setStatic(true), so a body created static has none to
  // restore and the first velocity written to it turns its position into NaN.
  mech.crumble = [];
  if (L.crumble) {
    const c = L.crumble;
    for (let i = 0; i < c.count; i++) {
      const x = c.from + i * c.step;
      const b = Bodies.rectangle(x + c.w / 2, c.y + c.h / 2, c.w, c.h, {
        label: 'crumble:cr' + i, friction: 0.9, density: 0.004,
      });
      Body.setStatic(b, true);
      b.plugin.kind = 'crumble';
      b.plugin.w = c.w; b.plugin.h = c.h;
      b.plugin.fuse = -1;
      b.plugin.home = { x: b.position.x, y: b.position.y };
      add(b);
      dynamic.push(b);
      mech.crumble.push(b);
    }
  }

  // ---- the thing the pressure plate opens ---------------------------------
  // Kinematic: the sim moves it by hand, so it can block and crush without
  // being pushed around by what it is blocking.
  mech.plateNeeds = L.plate ? L.plate.needs : 0;
  mech.shutterOpen = 0;
  mech.plateLoad = 0;
  const gate = L.shutter || L.door;
  if (gate) {
    const shutter = Bodies.rectangle(gate.x, FLOOR1 - 90, 34, 200, {
      isStatic: true, label: 'mech:shutter', friction: 0.4,
    });
    shutter.plugin.kind = L.door ? 'door' : 'shutter';
    shutter.plugin.w = 34; shutter.plugin.h = 200;
    shutter.plugin.homeX = gate.x;
    shutter.plugin.travel = gate.travel;
    shutter.plugin.closeRate = gate.close ?? 0.026;
    add(shutter);
    dynamic.push(shutter);
    mech.shutter = shutter;
  }
  if (L.plate) {
    const pw = L.plate.w || 150;
    const plate = Bodies.rectangle(L.plate.x, FLOOR1 - 7, pw, 16, {
      isStatic: true, label: 'mech:plate', friction: 0.9,
    });
    plate.plugin.kind = 'plate';
    plate.plugin.w = pw; plate.plugin.h = 16;
    add(plate);
    dynamic.push(plate);
    mech.plate = plate;
  }

  // ---- the two lift levers, and the lift ----------------------------------
  mech.levers = [];
  if (L.levers) {
    for (const [i, lx] of L.levers.entries()) {
      const lever = Bodies.rectangle(lx, FLOOR2 - 66, 16, 84, {
        label: 'mech:lever' + i, density: 0.0009, friction: 0.6, chamfer: { radius: 6 },
      });
      lever.plugin.kind = 'lever';
      lever.plugin.w = 16; lever.plugin.h = 84;
      lever.plugin.leverIndex = i;
      add(lever);
      dynamic.push(lever);
      add(Constraint.create({
        bodyA: lever, pointA: { x: 0, y: 40 },
        pointB: { x: lx, y: FLOOR2 - 26 },
        length: 0, stiffness: 1, render: { visible: false },
      }));
      mech.levers.push(lever);
    }
  }
  mech.liftPos = 0;
  if (L.lift) {
    const lift = Bodies.rectangle(L.lift.x, L.lift.from, 210, 22, {
      isStatic: true, label: 'mech:lift', friction: 1,
    });
    lift.plugin.kind = 'lift';
    lift.plugin.w = 210; lift.plugin.h = 22;
    lift.plugin.homeX = L.lift.x;
    lift.plugin.from = L.lift.from;
    lift.plugin.travel = L.lift.travel;
    add(lift);
    dynamic.push(lift);
    mech.lift = lift;
  }

  // ---- the lump of ceiling that lets go, once, on cue ---------------------
  if (L.ceilingDrop) {
    const c = Bodies.rectangle(L.ceilingDrop.x, 292, 78, 34, {
      label: 'mech:ceiling', density: 0.0022, friction: 0.7, chamfer: { radius: 3 },
    });
    Body.setStatic(c, true);
    c.plugin.kind = 'debris';
    c.plugin.w = 78; c.plugin.h = 34;
    c.plugin.home = { x: L.ceilingDrop.x, y: 292 };
    add(c);
    dynamic.push(c);
    mech.ceiling = c;
    mech.ceilingAt = L.ceilingDrop.at;
    mech.ceilingDropped = false;
  }

  // ---- things on the wall that can be pressed -----------------------------
  mech.switches = (L.switches || []).map((sw) => ({ ...sw, held: [false, false] }));

  // ---- falling debris, pre-made and parked off-stage ----------------------
  // Pre-made because a fixed body list keeps the snapshot a plain array of
  // numbers. Nothing is ever spawned mid-match.
  mech.debris = [];
  const debrisCount = L.solo ? 5 : 14;
  for (let i = 0; i < debrisCount; i++) {
    const b = Bodies.rectangle(-900 - i * 90, -600, 34 + (i % 3) * 16, 30 + (i % 4) * 10, {
      label: 'debris:' + i, density: 0.0022, friction: 0.7, chamfer: { radius: 3 },
    });
    b.plugin.kind = 'debris';
    b.plugin.w = 34 + (i % 3) * 16; b.plugin.h = 30 + (i % 4) * 10;
    b.plugin.parked = true;
    add(b);
    dynamic.push(b);
    mech.debris.push(b);
  }

  // The offsets of every vertex from its own centre, kept so a body whose
  // position has gone non-finite can have its shape written back by hand.
  for (const b of dynamic) {
    b.plugin.vx = b.vertices.map((v) => v.x - b.position.x);
    b.plugin.vy = b.vertices.map((v) => v.y - b.position.y);
    if (!b.plugin.home) b.plugin.home = { x: b.position.x, y: b.position.y };
  }

  return {
    def: L, mech, dynamic, decor,
    statics: L.statics, props: L.props,
    consts: { FLOOR1, FLOOR2, LEVEL_END: L.end },
  };
}

export const BEATS = LEVELS[DEFAULT_LEVEL].beats;
