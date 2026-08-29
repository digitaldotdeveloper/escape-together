/* The partner, when you are playing on your own.
 *
 * Deliberately not clever. Every co-op gate in this game is "somebody has to
 * be standing there while somebody else moves", and a bot that decides for
 * itself when to be standing there is a bot that is somewhere else at the
 * moment you needed it. So it has exactly two states and YOU choose which:
 *
 *   FOLLOW - trots after you, keeps out of the way
 *   WAIT   - stands exactly here, braces, and holds on to whatever it can reach
 *
 * That covers the whole level. Leave it on the pressure plate and go through.
 * Leave it under the vent and jump off it. Leave it at one lever and pull the
 * other. It is a very good ladder and a very obedient paperweight, and it will
 * never be the reason a puzzle failed.
 */

export const BOT_FOLLOW = 0;
export const BOT_WAIT = 1;

const IDLE = { move: 0, jump: false, grab: false, brace: false, limp: false, aim: null };

export function botInput(sim, me, mate, mode) {
  const a = sim.players[me].parts.torso.position;
  const b = sim.players[mate].parts.torso.position;
  const rd = sim.players[me];

  if (mode === BOT_WAIT) {
    // Plant. Brace makes it heavy enough to hold a plate and gives the human
    // something to jump off, and it grabs whatever is under its hands so it
    // can hold a lever down too.
    // aim low and at its own feet: reaching out at head height means it grabs
    // the person walking past and gets towed away from the thing it is holding
    return { ...IDLE, brace: true, grab: true, aim: { x: a.x + rd.facing * 16, y: a.y + 46 } };
  }

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const far = Math.abs(dx);

  // Stand off rather than shove: a partner that walks into you knocks you off
  // ledges, and being knocked off a ledge by your own helper is not the kind
  // of chaos the game is going for.
  let move = 0;
  if (far > 74) move = Math.sign(dx);
  else if (far < 34) move = -Math.sign(dx) * 0.5;

  // hop if the human is clearly above and close - it will not climb a wall,
  // but it will manage a bed or a crate
  const jump = dy < -52 && far < 120 && rd.grounded > 0;

  return {
    ...IDLE,
    move,
    jump,
    aim: { x: a.x + (move || rd.facing) * 34, y: a.y + 26 },
  };
}

/** Too far behind to be any use: bring it back rather than let it be lost. */
export function botRescue(sim, me, mate) {
  const a = sim.players[me].parts.torso.position;
  const b = sim.players[mate].parts.torso.position;
  return Math.abs(a.x - b.x) > 900 || a.y > b.y + 500;
}
