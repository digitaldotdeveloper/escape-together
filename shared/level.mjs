/* SEASON 1 - THE COLLAPSING HOTEL.
 *
 * The level is data. Both the server and every client run this same builder in
 * the same order, so body N on one machine is body N on the other and a
 * snapshot is just a list of numbers - no spawn messages, no id negotiation.
 *
 * Design rule for every beat: it must be physically impossible alone. Not
 * "hard alone" - impossible. Either something is too heavy for one pair of
 * hands, or something has to be *held* while someone else moves. That is what
 * turns a level into a conversation.
 */

export const FLOOR1 = 620;   // y of the ground floor surface
export const FLOOR2 = 300;   // y of the upper floor surface
export const LEVEL_END = 5320;

// A room's worth of pastel hotel colours, so the whole thing reads as one place.
export const PALETTE = {
  wall: '#f0d9b8', wallDark: '#d8b98f', carpet: '#9c3b3b', carpetDark: '#7d2f2f',
  wood: '#8b5a2b', woodDark: '#6b4420', metal: '#8e99a6', metalDark: '#6a747f',
  bed: '#e8e2d5', accent: '#2f6f8f', hazard: '#e0a01f', shutter: '#b0562a',
};

/** Every prop in the hotel. A player weighs about 4.7, and `mass` below is in
 *  the same units - so the wardrobe at 15 really is three people, and no
 *  amount of heroic solo shoving will move it. That number IS the level design. */
const props = [
  // --- ROOM 402, where they wake up -------------------------------------
  { id: 'bed1',   type: 'bed',    x: 190,  y: FLOOR1 - 26, w: 190, h: 46 , mass: 5 },
  { id: 'bed2',   type: 'bed',    x: 470,  y: FLOOR1 - 26, w: 190, h: 46 , mass: 5 },
  { id: 'lamp',   type: 'lamp',   x: 330,  y: FLOOR1 - 30, w: 22,  h: 54 , mass: 0.6 },
  { id: 'tv',     type: 'tv',     x: 620,  y: FLOOR1 - 22, w: 70,  h: 44 , mass: 1.3 },
  { id: 'chair1', type: 'chair',  x: 700,  y: FLOOR1 - 24, w: 42,  h: 46 , mass: 1.0 },
  // heavy scenery: shovable enough to be fun, far too heavy to be a staircase
  { id: 'wardrobe', type: 'wardrobe', x: 770, y: FLOOR1 - 84, w: 96, h: 168 , mass: 60, friction: 1.1 },

  // --- CORRIDOR: the pressure plate and the emergency shutter -------------
  { id: 'case1',  type: 'case',   x: 1180, y: FLOOR1 - 24, w: 74,  h: 48 , mass: 1.9 },
  { id: 'case2',  type: 'case',   x: 1265, y: FLOOR1 - 24, w: 66,  h: 44 , mass: 1.7 },
  { id: 'ext1',   type: 'ext',    x: 1090, y: FLOOR1 - 26, w: 24,  h: 52 , mass: 0.9 },
  { id: 'trolley', type: 'trolley', x: 1230, y: FLOOR1 - 46, w: 120, h: 88 , mass: 6.4 },
  { id: 'chair2', type: 'chair',  x: 1350, y: FLOOR1 - 24, w: 42,  h: 46 , mass: 1.0 },

  // --- COLLAPSING HALLWAY -------------------------------------------------
  { id: 'cart',   type: 'trolley', x: 2020, y: FLOOR1 - 46, w: 118, h: 88 , mass: 6.0 },
  { id: 'crate1', type: 'crate',  x: 2180, y: FLOOR1 - 30, w: 58,  h: 58 , mass: 2.6 },
  { id: 'plank1', type: 'plank',  x: 2460, y: FLOOR1 - 12, w: 230, h: 20 , mass: 2.2 },

  // --- THE CLIMB to the second floor -------------------------------------
  { id: 'crate2', type: 'crate',  x: 2900, y: FLOOR1 - 30, w: 62,  h: 62 , mass: 2.6 },
  { id: 'crate3', type: 'crate',  x: 2990, y: FLOOR1 - 30, w: 62,  h: 62 , mass: 2.6 },
  { id: 'crate4', type: 'crate',  x: 3080, y: FLOOR1 - 30, w: 62,  h: 62 , mass: 2.6 },
  { id: 'bed3',   type: 'bed',    x: 3220, y: FLOOR1 - 26, w: 180, h: 46 , mass: 5.0 },
  { id: 'table1', type: 'table',  x: 3380, y: FLOOR1 - 34, w: 120, h: 62 , mass: 3.2 },

  // --- THE BROKEN SECTION on floor two -----------------------------------
  { id: 'case3',  type: 'case',   x: 3760, y: FLOOR2 - 24, w: 70,  h: 46 , mass: 1.9 },
  { id: 'plank2', type: 'plank',  x: 3900, y: FLOOR2 - 12, w: 330, h: 20 , mass: 2.4 },
  { id: 'crate5', type: 'crate',  x: 4380, y: FLOOR2 - 30, w: 58,  h: 58 , mass: 2.6 },

  // --- THE LOBBY of the emergency lift ------------------------------------
  { id: 'plant',  type: 'plant',  x: 4600, y: FLOOR2 - 34, w: 46,  h: 68 , mass: 1.2 },
  { id: 'case4',  type: 'case',   x: 4900, y: FLOOR2 - 24, w: 70,  h: 46 , mass: 1.8 },
];

/** Static geometry: floors, walls, ledges. `gap` entries are holes to fall in. */
const statics = [
  // ground floor slabs, with the hallway holes left out
  { id: 'f_room',   x: -120, y: FLOOR1, w: 1080, h: 60 },
  { id: 'f_corr',   x: 960,  y: FLOOR1, w: 900,  h: 60 },
  { id: 'f_hall_a', x: 1860, y: FLOOR1, w: 300,  h: 60 },
  // ...then crumbling tiles (built separately), then a gap, then:
  { id: 'f_hall_b', x: 2620, y: FLOOR1, w: 240,  h: 60 },
  { id: 'f_climb',  x: 2860, y: FLOOR1, w: 700,  h: 60 },

  // the upper floor, broken in the middle
  { id: 'f2_a',   x: 3560, y: FLOOR2, w: 460, h: 44 },            // ends at 4020
  { id: 'f2_b',   x: 4300, y: FLOOR2, w: 200, h: 44 },            // island past the seesaw
  { id: 'f2_c',   x: 4500, y: FLOOR2, w: 820, h: 44 },            // lift lobby

  // walls and ceilings
  { id: 'w_left',    x: -140, y: 60,  w: 40, h: 620 },
  // the wall between room and corridor, with a vent gap at 280..410. The sill
  // is 210 above the floor - higher than a jump (60) or a jump off the bed,
  // and reachable only off another person's shoulders.
  { id: 'w_room_hi', x: 940,  y: 268, w: 30, h: 12 },
  { id: 'w_room_lo', x: 940,  y: 410, w: 30, h: 210, grab: true },
  { id: 'vent_sill', x: 900,  y: 410, w: 40, h: 16, grab: true },
  { id: 'ceil_room', x: -120, y: 268, w: 1030, h: 34 },  // stops short of the vent
  { id: 'ledge2',    x: 3520, y: FLOOR2, w: 60, h: 44, grab: true }, // lip to haul up onto
  { id: 'w_end',     x: 5280, y: 120,  w: 40, h: 560 },
];

/** Floor tiles in the collapsing hallway. Step on one and it lets go. */
const crumble = [];
for (let i = 0; i < 9; i++) {
  crumble.push({ id: 'cr' + i, x: 2160 + i * 52, y: FLOOR1, w: 50, h: 26 });
}

export function buildLevel(Matter, world) {
  const { Bodies, Body, Composite, Constraint } = Matter;
  const add = (b) => { Composite.add(world, b); return b; };
  const mech = {};
  const dynamic = [];   // everything the network has to sync, in build order
  const decor = [];

  // ---- static geometry ---------------------------------------------------
  for (const s of statics) {
    const b = Bodies.rectangle(s.x + s.w / 2, s.y + s.h / 2, s.w, s.h, {
      isStatic: true, label: 'static:' + s.id, friction: 0.9,
    });
    b.plugin.kind = 'wall';
    b.plugin.grabbable = !!s.grab;
    add(b);
    decor.push({ ...s, body: b });
  }

  // ---- props -------------------------------------------------------------
  for (const p of props) {
    // Props carry a target mass, not a density: "the wardrobe weighs three
    // people" is a design statement, and a prop must not get heavier just
    // because someone made it bigger.
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
    // the renderer draws the shape it was built with, not the rotated bounds
    b.plugin.w = p.w; b.plugin.h = p.h;
    add(b);
    dynamic.push(b);
    mech[p.id] = b;
  }

  // ---- crumbling hallway tiles ------------------------------------------
  mech.crumble = [];
  for (const c of crumble) {
    // Built DYNAMIC and then frozen, never built static. Matter only remembers
    // a body's real mass in Body.setStatic(true); a body created static has no
    // remembered mass, so releasing it later leaves mass at Infinity and the
    // first velocity written to it turns its position into NaN - the tile
    // vanishes for the rest of the match and can never be put back.
    const b = Bodies.rectangle(c.x + c.w / 2, c.y + c.h / 2, c.w, c.h, {
      label: 'crumble:' + c.id, friction: 0.9, density: 0.004,
    });
    Body.setStatic(b, true);
    b.plugin.kind = 'crumble';
    b.plugin.w = c.w; b.plugin.h = c.h;
    b.plugin.fuse = -1;      // >=0 once stepped on: steps until it lets go
    b.plugin.home = { x: b.position.x, y: b.position.y };
    add(b);
    dynamic.push(b);
    mech.crumble.push(b);
  }

  // ---- the emergency shutter, driven by the pressure plate ---------------
  // The shutter is kinematic: the sim moves it by hand, so it can crush,
  // carry and block without ever being pushed around by what it is crushing.
  const shutter = Bodies.rectangle(1660, FLOOR1 - 90, 34, 200, {
    isStatic: true, label: 'mech:shutter', friction: 0.4,
  });
  shutter.plugin.kind = 'shutter';
  shutter.plugin.w = 34; shutter.plugin.h = 200;
  add(shutter);
  dynamic.push(shutter);
  mech.shutter = shutter;
  mech.shutterOpen = 0;      // 0 closed .. 1 fully up

  const plate = Bodies.rectangle(1520, FLOOR1 - 7, 150, 16, {
    isStatic: true, label: 'mech:plate', friction: 0.9,
  });
  plate.plugin.kind = 'plate';
  plate.plugin.w = 150; plate.plugin.h = 16;
  add(plate);
  dynamic.push(plate);
  mech.plate = plate;
  mech.plateLoad = 0;

  // No seesaw here any more. A plank long enough to span the gap also rests
  // on both lips, which makes it a bridge that cannot tip; a plank short
  // enough to tip cannot be crossed. The gap is now a BOOST gap - which reuses
  // the verb the vent already taught - with a loose plank lying nearby as the
  // second, calmer solution for people who would rather build than fly.

  // ---- the two lift levers, one at each end of the lobby -----------------
  mech.levers = [];
  for (const [i, lx] of [4560, 5140].entries()) {
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

  // ---- the lift itself ----------------------------------------------------
  const lift = Bodies.rectangle(4860, FLOOR2 + 120, 210, 22, {
    isStatic: true, label: 'mech:lift', friction: 1,
  });
  lift.plugin.kind = 'lift';
  lift.plugin.w = 210; lift.plugin.h = 22;
  add(lift);
  dynamic.push(lift);
  mech.lift = lift;
  mech.liftPos = 0;          // 0 = below the floor, 1 = arrived

  // ---- falling debris, pre-made and parked off-stage ----------------------
  // Pre-made because a fixed body list keeps the network snapshot a plain
  // array of numbers. Nothing is ever spawned mid-match.
  mech.debris = [];
  for (let i = 0; i < 14; i++) {
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

  return { mech, dynamic, decor, statics, props, crumble,
    consts: { FLOOR1, FLOOR2, LEVEL_END } };
}

/** The eight beats, in order. `at` is where the camera banner fires. */
export const BEATS = [
  { id: 'wake',    at: 120,  title: 'ROOM 402',            hint: 'WASD to move. The door is blocked.' },
  { id: 'wardrobe', at: 700, title: 'TOO HEAVY FOR ONE',   hint: 'Both of you. Grab it and pull.' , mass: 15 },
  { id: 'plate',   at: 1150, title: 'EMERGENCY SHUTTER',   hint: 'Something has to hold the plate down.' },
  { id: 'hall',    at: 1960, title: 'THE FLOOR IS LEAVING', hint: 'Do not stand still.' },
  { id: 'climb',   at: 2900, title: 'GET UP THERE',        hint: 'Stack it. Boost each other.' },
  { id: 'broken',  at: 3700, title: 'THE BROKEN SECTION',  hint: 'Run at your friend and jump. Or build a bridge.' },
  { id: 'lift',    at: 4500, title: 'EMERGENCY LIFT',      hint: 'Both levers. At the same time.' },
  { id: 'escape',  at: 5000, title: 'GET IN',              hint: 'Both of you. Now.' },
];
