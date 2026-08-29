/* The hotel having opinions.
 *
 * A level that plays out identically every time is a test, not a game. These
 * are the things the building does TO you, chosen at random, on a schedule you
 * cannot learn - so the run you tell your friend about afterwards is never
 * quite the run the level designer wrote.
 *
 * Three rules keep them from being annoying rather than funny:
 *
 *   1. an event never blocks the route - it changes how the route feels
 *   2. an event is always announced, so nobody thinks the game has broken
 *   3. two events never overlap, and there is always a lull between them
 *
 * Everything an event does has to be derivable from (id, elapsed) so it can
 * ride in the snapshot as two numbers rather than as a stream of commands.
 */

export const EVENTS = [
  {
    id: 'power',
    name: 'THE POWER GOES OUT',
    sub: 'Somewhere below, something important gives up.',
    dur: 26,
    weight: 3,
  },
  {
    id: 'quake',
    name: 'THE BUILDING SHIFTS',
    sub: 'Hold on to something. Or someone.',
    dur: 9,
    weight: 3,
  },
  {
    id: 'sprinklers',
    name: 'THE SPRINKLERS GO OFF',
    sub: 'Everything is now extremely slippery.',
    dur: 22,
    weight: 3,
  },
  {
    id: 'party',
    name: 'THE BALLROOM SYSTEM COMES BACK ON',
    sub: 'Nobody knows why. Nobody turns it off.',
    dur: 30,
    weight: 2,
  },
  {
    id: 'draught',
    name: 'A WINDOW GOES',
    sub: 'The wind is now a participant.',
    dur: 20,
    weight: 2,
  },
];

const TOTAL = EVENTS.reduce((s, e) => s + e.weight, 0);

/** Deterministic pick, so both ends choose the same one from the same seed. */
export function pickEvent(seed) {
  let r = (Math.abs(Math.sin(seed) * 43758.5453) % 1) * TOTAL;
  for (const e of EVENTS) {
    r -= e.weight;
    if (r <= 0) return e;
  }
  return EVENTS[0];
}

export const eventById = (id) => EVENTS.find((e) => e.id === id) || null;
export const eventIndex = (id) => EVENTS.findIndex((e) => e.id === id);

/**
 * Advance the chaos director. Returns an event id when a NEW one starts.
 *
 * @param {object} sim  the simulation, whose `chaos` field this owns
 * @param {number} tickHz
 */
export function stepChaos(sim, tickHz) {
  const c = sim.chaos;
  if (!sim.started || sim.state !== 'playing') return null;

  if (c.left > 0) {
    c.left--;
    if (c.left === 0) {
      c.id = null;
      // a lull, so the hotel is not permanently having a crisis
      c.next = Math.round((14 + Math.random() * 16) * tickHz);
    }
    return null;
  }

  if (c.next > 0) { c.next--; return null; }

  const e = pickEvent(sim.tick + c.seed);
  c.id = e.id;
  c.left = Math.round(e.dur * tickHz);
  c.seed++;
  return e.id;
}

export function freshChaos() {
  return {
    id: null,
    left: 0,
    // the first one waits: let them get their bearings and finish the tutorial
    next: 60 * 40,
    seed: Math.floor(Math.random() * 10000),
  };
}
