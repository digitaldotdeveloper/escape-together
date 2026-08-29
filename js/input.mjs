/* Controls.
 *
 * WASD to move, SPACE to jump, E or left mouse to grab, Q or right mouse to
 * brace, R to go limp. The mouse aims your hands; with no mouse the hands
 * follow the way you are facing.
 *
 * The one rule the whole scheme is built on: every button does something on
 * its own AND something better with a friend. Grab moves furniture, or moves
 * your friend. Brace holds a plate down, or launches your friend at a vent.
 */

export const KEYMAP = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  jump: ['Space'],
  grab: ['KeyE'],
  brace: ['KeyQ'],
  limp: ['KeyR'],
};

export function createInput(canvas, opts = {}) {
  const down = new Set();
  const state = {
    move: 0, jump: false, grab: false, brace: false, limp: false,
    aim: null, mouse: { x: 0, y: 0 }, hasMouse: false, touch: false,
  };

  const held = (action) => KEYMAP[action].some((c) => down.has(c));

  const onKey = (e, isDown) => {
    if (opts.blocked && opts.blocked()) { down.clear(); return; }
    const all = Object.values(KEYMAP).flat();
    if (!all.includes(e.code)) return;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (isDown) down.add(e.code); else down.delete(e.code);
  };
  addEventListener('keydown', (e) => onKey(e, true));
  addEventListener('keyup', (e) => onKey(e, false));
  addEventListener('blur', () => down.clear());

  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    state.mouse.x = e.clientX - r.left;
    state.mouse.y = e.clientY - r.top;
    state.hasMouse = true;
  });
  canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (e.button === 0) state.mouseGrab = true;
    if (e.button === 2) state.mouseBrace = true;
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 0) state.mouseGrab = false;
    if (e.button === 2) state.mouseBrace = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // --- touch: a thumbstick on the left, three fat buttons on the right ----
  const touches = new Map();
  let stick = null;
  const zones = () => ({ w: canvas.clientWidth, h: canvas.clientHeight });

  const touchStart = (t) => {
    const { w, h } = zones();
    const x = t.clientX, y = t.clientY;
    state.touch = true;
    if (x < w * 0.42) {
      stick = { id: t.identifier, ox: x, oy: y, x, y };
      return;
    }
    // right side: bottom-right jump, above it grab, left of it brace
    const rx = (x - w * 0.42) / (w * 0.58), ry = y / h;
    let btn = 'jump';
    if (ry < 0.55) btn = 'grab';
    else if (rx < 0.4) btn = 'brace';
    touches.set(t.identifier, btn);
  };
  const touchEnd = (t) => {
    if (stick && stick.id === t.identifier) stick = null;
    touches.delete(t.identifier);
  };
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) touchStart(t);
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (stick && stick.id === t.identifier) { stick.x = t.clientX; stick.y = t.clientY; }
    }
  }, { passive: false });
  const endAll = (e) => { for (const t of e.changedTouches) touchEnd(t); };
  canvas.addEventListener('touchend', endAll);
  canvas.addEventListener('touchcancel', endAll);

  /** Read the controls. `toWorld` turns screen pixels into world units. */
  state.read = (toWorld, self) => {
    let move = 0;
    if (held('left')) move -= 1;
    if (held('right')) move += 1;
    if (stick) {
      const dx = (stick.x - stick.ox) / 60;
      move = Math.max(-1, Math.min(1, dx));
      if (Math.abs(move) < 0.18) move = 0;
    }
    state.move = move;

    const btn = new Set(touches.values());
    state.jump = held('jump') || btn.has('jump') || (stick && stick.oy - stick.y > 45);
    state.grab = held('grab') || !!state.mouseGrab || btn.has('grab');
    state.brace = held('brace') || !!state.mouseBrace || btn.has('brace');
    state.limp = held('limp');

    if (state.hasMouse && !state.touch) {
      state.aim = toWorld(state.mouse.x, state.mouse.y);
    } else if (self) {
      // no pointer: reach forward, a bit low, like someone about to grab a box
      const t = self.parts.torso.position;
      state.aim = { x: t.x + self.facing * 52, y: t.y + 26 };
    }
    return state;
  };

  state.touchUI = () => ({ stick, buttons: new Set(touches.values()) });
  return state;
}
