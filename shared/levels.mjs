/* The scenes, as data.
 *
 * Solo and co-op are different places, not the same place with a partner
 * subtracted. A co-op gate is "somebody has to be standing there while
 * somebody else moves", and there is no honest way to hand that to one player:
 * you either give them a robot friend, which is nobody's idea of a good time,
 * or you build them a room whose problems are their own.
 *
 * So SOLO 1 is a small, sparse, deliberately clumsy tutorial for one person,
 * and CO-OP 1 is the collapsing hotel. Both are data; the builder in level.mjs
 * reads whichever it is handed, and only creates the mechanisms a scene
 * actually declares.
 */

export const FLOOR1 = 620;
export const FLOOR2 = 300;

/* ========================================================================
 * SOLO 1 - "ROOM 402"
 *
 * The first thing anybody plays. It has four props and one idea per beat, and
 * it is built so the player is hurt early and harmlessly, because a game about
 * falling over should establish in the first twenty seconds that falling over
 * is the point rather than a failure.
 * ===================================================================== */
const SOLO1 = {
  id: 'solo1',
  name: 'ROOM 402',
  solo: true,
  end: 2300,
  spawns: [{ x: 200, y: FLOOR1 - 120 }, { x: 260, y: FLOOR1 - 120 }],

  // One storey, and the camera is not allowed to look outside it. Without
  // this the frame showed 720 units of a 340-unit room: a painted wall in a
  // band across the middle with bare fill above and below it, which reads as
  // a half-finished level rather than as a hotel room.
  floors: [FLOOR1],
  bounds: { top: 236, bottom: 700 },

  // Three. One to knock over, one to carry, and a bed to wake up on. Nothing
  // in the route is blocked by scenery: the only things in the way are the
  // ones the scene is teaching.
  props: [
    { id: 'bed1',  type: 'bed',  x: 210, y: FLOOR1 - 26, w: 190, h: 46, mass: 5 },
    { id: 'lamp',  type: 'lamp', x: 400, y: FLOOR1 - 30, w: 22,  h: 54, mass: 0.6 },
    { id: 'case1', type: 'case', x: 1330, y: FLOOR1 - 24, w: 74,  h: 48, mass: 2.6 },
  ],

  statics: [
    { id: 'f_room', x: -120, y: FLOOR1, w: 1500, h: 60 },
    // butted up against the room floor: the gap that used to be here was a
    // pit in the middle of the tutorial that nothing warned you about
    { id: 'f_hall', x: 1380, y: FLOOR1, w: 1060, h: 60 },
    { id: 'w_left', x: -140, y: 120, w: 40, h: 560 },
    { id: 'ceil',   x: -120, y: 250, w: 2500, h: 30 },
    // the step you have to get over, low enough that walking into it works.
    // It is a heap of what used to be the ceiling, not a white block.
    { id: 'step',   x: 1120, y: FLOOR1 - 34, w: 140, h: 34, look: 'rubble' },
    { id: 'w_end',  x: 2280, y: 120, w: 40, h: 560 },
  ],

  // One pressure plate and one door. The puzzle is NOT "be heavy enough" - a
  // person already outweighs the plate's threshold, so standing on it works
  // fine and proves nothing. The puzzle is that you cannot stand on the plate
  // and walk through the door at the same time, which is a problem exactly one
  // person has, and the suitcase is the answer.
  // Wide, on purpose. You are carrying the thing out in front of you and it
  // keeps some of your speed when you let go; a narrow plate turns a nice idea
  // into a placement puzzle nobody asked for.
  plate: { x: 1620, w: 230, needs: 2.0 },
  // It shuts slowly enough that sprinting off the plate is a valid, silly
  // answer too - you just have to mean it.
  door:  { x: 1900, travel: 190, close: 0.007 },

  // and a lump of ceiling that lets go, once, on cue
  ceilingDrop: { x: 900, at: 620 },

  switches: [
    { id: 'lights', x: 470, y: FLOOR1 - 76, w: 22, h: 34, on: true, label: 'LIGHTS' },
  ],

  beats: [
    { id: 'wake',  at: 60,   title: 'ROOM 402',        hint: 'You have had better mornings.' },
    { id: 'walk',  at: 520,  title: 'MIND THE CEILING', hint: 'That was not your fault. Probably.' },
    { id: 'step',  at: 1060, title: 'OVER YOU GO',      hint: 'Just walk into it. You will manage.' },
    { id: 'case',  at: 1280, title: 'A SUITCASE',        hint: 'Heavy things are useful. Pick it up.' },
    { id: 'plate', at: 1560, title: 'THE DOOR IS SHUT',  hint: 'Something has to stay on the plate. You cannot.' },
    { id: 'out',   at: 1980, title: 'OUT',              hint: 'Go on then.' },
  ],
};

/* ========================================================================
 * CO-OP 1 - "THE COLLAPSING HOTEL"
 * Unchanged: every gate needs two people, by a number a test asserts.
 * ===================================================================== */
const COOP1 = {
  id: 'coop1',
  name: 'THE COLLAPSING HOTEL',
  solo: false,
  end: 5320,
  spawns: [{ x: 190, y: FLOOR1 - 120 }, { x: 470, y: FLOOR1 - 120 }],

  // Two storeys and a shaft you are meant to be able to see down, so the
  // camera is left alone here.
  floors: [FLOOR1, FLOOR2],

  props: [
    { id: 'bed1',   type: 'bed',    x: 190,  y: FLOOR1 - 26, w: 190, h: 46, mass: 5 },
    { id: 'bed2',   type: 'bed',    x: 470,  y: FLOOR1 - 26, w: 190, h: 46, mass: 5 },
    { id: 'lamp',   type: 'lamp',   x: 330,  y: FLOOR1 - 30, w: 22,  h: 54, mass: 0.6 },
    { id: 'tv',     type: 'tv',     x: 620,  y: FLOOR1 - 22, w: 70,  h: 44, mass: 1.3 },
    { id: 'chair1', type: 'chair',  x: 700,  y: FLOOR1 - 24, w: 42,  h: 46, mass: 1.0 },
    { id: 'wardrobe', type: 'wardrobe', x: 770, y: FLOOR1 - 84, w: 96, h: 168, mass: 60, friction: 1.1 },
    { id: 'case1',  type: 'case',   x: 1180, y: FLOOR1 - 24, w: 74,  h: 48, mass: 1.9 },
    { id: 'case2',  type: 'case',   x: 1265, y: FLOOR1 - 24, w: 66,  h: 44, mass: 1.7 },
    { id: 'ext1',   type: 'ext',    x: 1090, y: FLOOR1 - 26, w: 24,  h: 52, mass: 0.9 },
    { id: 'trolley', type: 'trolley', x: 1230, y: FLOOR1 - 46, w: 120, h: 88, mass: 6.4 },
    { id: 'chair2', type: 'chair',  x: 1350, y: FLOOR1 - 24, w: 42,  h: 46, mass: 1.0 },
    { id: 'cart',   type: 'trolley', x: 2020, y: FLOOR1 - 46, w: 118, h: 88, mass: 6.0 },
    { id: 'crate1', type: 'crate',  x: 2180, y: FLOOR1 - 30, w: 58,  h: 58, mass: 2.6 },
    { id: 'plank1', type: 'plank',  x: 2460, y: FLOOR1 - 12, w: 230, h: 20, mass: 2.2 },
    { id: 'crate2', type: 'crate',  x: 2900, y: FLOOR1 - 30, w: 62,  h: 62, mass: 2.6 },
    { id: 'crate3', type: 'crate',  x: 2990, y: FLOOR1 - 30, w: 62,  h: 62, mass: 2.6 },
    { id: 'crate4', type: 'crate',  x: 3080, y: FLOOR1 - 30, w: 62,  h: 62, mass: 2.6 },
    { id: 'bed3',   type: 'bed',    x: 3220, y: FLOOR1 - 26, w: 180, h: 46, mass: 5.0 },
    { id: 'table1', type: 'table',  x: 3380, y: FLOOR1 - 34, w: 120, h: 62, mass: 3.2 },
    { id: 'case3',  type: 'case',   x: 3640, y: FLOOR2 - 24, w: 70,  h: 46, mass: 1.9 },
    { id: 'plank2', type: 'plank',  x: 3700, y: FLOOR2 - 12, w: 520, h: 20, mass: 3.2 },
    { id: 'crate5', type: 'crate',  x: 4380, y: FLOOR2 - 30, w: 58,  h: 58, mass: 2.6 },
    { id: 'plant',  type: 'plant',  x: 4600, y: FLOOR2 - 34, w: 46,  h: 68, mass: 1.2 },
    { id: 'case4',  type: 'case',   x: 4900, y: FLOOR2 - 24, w: 70,  h: 46, mass: 1.8 },
  ],

  statics: [
    { id: 'f_room',   x: -120, y: FLOOR1, w: 1080, h: 60 },
    { id: 'f_corr',   x: 960,  y: FLOOR1, w: 900,  h: 60 },
    { id: 'f_hall_a', x: 1860, y: FLOOR1, w: 300,  h: 60 },
    { id: 'f_hall_b', x: 2620, y: FLOOR1, w: 240,  h: 60 },
    { id: 'f_climb',  x: 2860, y: FLOOR1, w: 700,  h: 60 },
    { id: 'f2_a',   x: 3560, y: FLOOR2, w: 300, h: 44 },
    { id: 'f2_b',   x: 4300, y: FLOOR2, w: 200, h: 44 },
    { id: 'f2_c',   x: 4500, y: FLOOR2, w: 820, h: 44 },
    { id: 'w_left',    x: -140, y: 60,  w: 40, h: 620 },
    { id: 'w_room_hi', x: 940,  y: 268, w: 30, h: 12 },
    { id: 'w_room_lo', x: 940,  y: 410, w: 30, h: 210, grab: true },
    { id: 'vent_sill', x: 900,  y: 410, w: 40, h: 16, grab: true },
    { id: 'ceil_room', x: -120, y: 268, w: 1030, h: 34 },
    { id: 'ledge2',    x: 3520, y: FLOOR2, w: 60, h: 44, grab: true },
    { id: 'w_end',     x: 5280, y: 120,  w: 40, h: 560 },
  ],

  crumble: { from: 2160, count: 9, step: 52, w: 50, h: 26, y: FLOOR1 },
  plate: { x: 1520, needs: 8.0 },
  shutter: { x: 1660, travel: 212 },
  levers: [4560, 5140],
  lift: { x: 4860, from: FLOOR2 + 120, travel: 132 },

  switches: [
    { id: 'lights', x: 905,  y: FLOOR1 - 76, w: 22, h: 34, on: true,  label: 'LIGHTS' },
    { id: 'tv',     x: 668,  y: FLOOR1 - 74, w: 26, h: 26, on: false, label: 'TV' },
    { id: 'alarm',  x: 1105, y: FLOOR1 - 78, w: 26, h: 40, on: false, label: 'ALARM' },
    { id: 'vend',   x: 4700, y: FLOOR2 - 76, w: 28, h: 34, on: false, label: 'SNACK' },
  ],

  beats: [
    { id: 'wake',    at: 120,  title: 'ROOM 402',             hint: 'The door is blocked. Find another way out.' },
    { id: 'vent',    at: 700,  title: 'THE VENT IS TOO HIGH', hint: 'One holds BOOST. The other jumps off them.' },
    { id: 'plate',   at: 1150, title: 'EMERGENCY SHUTTER',    hint: 'Something has to hold the plate down.' },
    { id: 'hall',    at: 1960, title: 'THE FLOOR IS LEAVING', hint: 'Do not stand still.' },
    { id: 'climb',   at: 2900, title: 'GET UP THERE',         hint: 'Stack the furniture, or boost each other up.' },
    { id: 'broken',  at: 3700, title: 'THE BROKEN SECTION',   hint: 'Run at your friend and jump. Or lay the plank across.' },
    { id: 'lift',    at: 4500, title: 'EMERGENCY LIFT',       hint: 'Both levers. At the same time.' },
    { id: 'escape',  at: 5000, title: 'GET IN',               hint: 'Both of you. Now.' },
  ],
};

export const LEVELS = { solo1: SOLO1, coop1: COOP1 };
export const DEFAULT_LEVEL = 'coop1';
export const levelById = (id) => LEVELS[id] || LEVELS[DEFAULT_LEVEL];
