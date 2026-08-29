/* Controls.
 *
 * WASD to move, SPACE to jump, E or left mouse to grab, Q or right mouse to
 * brace, R to go limp. The mouse aims your hands; on a phone the thumbstick
 * aims them, which is what makes grabbing a ledge above you possible without
 * a second thumb.
 *
 * ONE layout function describes where the touch buttons are, and both the
 * hit-testing and the drawing read it. They used to be written out separately
 * and had drifted completely apart - the buttons were drawn bottom-right in a
 * cluster while the taps were being sorted into thirds of the screen, so
 * pressing GRAB jumped. If you move a button, move it here.
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

/** Where the on-screen controls live. The single source of truth. */
export function controlLayout(view) {
  const w = view.w, h = view.h;
  // fat enough for a thumb on a small phone, not silly on a tablet
  const s = Math.max(0.85, Math.min(1.3, Math.min(w, h) / 400));
  const r = 42 * s;
  const pad = 20 * s;
  return {
    r,
    stickMax: 56 * s,
    stickZone: w * 0.46,       // left of this, a touch steers
    buttons: [
      { id: 'jump',  label: 'JUMP',  x: w - pad - r,         y: h - pad - r },
      { id: 'grab',  label: 'GRAB',  x: w - pad - r,         y: h - pad - r * 3.4 },
      { id: 'brace', label: 'BRACE', x: w - pad - r * 3.4,   y: h - pad - r * 1.7 },
    ],
  };
}

export function createInput(canvas, opts = {}) {
  const down = new Set();
  const state = {
    move: 0, jump: false, grab: false, brace: false, limp: false,
    aim: null, mouse: { x: 0, y: 0 }, hasMouse: false, touch: false,
  };

  const held = (action) => KEYMAP[action].some((c) => down.has(c));
  const view = () => ({ w: canvas.clientWidth, h: canvas.clientHeight });

  /* ------------------------------------------------------------- keyboard */

  const onKey = (e, isDown) => {
    if (opts.blocked && opts.blocked()) { down.clear(); return; }
    const all = Object.values(KEYMAP).flat();
    if (!all.includes(e.code)) return;
    // Only swallow the key once we know it is ours AND a menu is not open,
    // or SPACE stops working on the buttons in the lobby.
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (isDown) down.add(e.code); else down.delete(e.code);
  };
  addEventListener('keydown', (e) => onKey(e, true));
  addEventListener('keyup', (e) => onKey(e, false));
  addEventListener('blur', () => down.clear());

  /* ---------------------------------------------------------------- mouse */

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

  /* ---------------------------------------------------------------- touch */

  const pressed = new Map();   // touch id -> button id
  let stick = null;

  const buttonAt = (x, y) => {
    const L = controlLayout(view());
    let best = null, bestD = L.r * 1.35;
    for (const b of L.buttons) {
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < bestD) { bestD = d; best = b.id; }
    }
    return best;
  };

  const touchStart = (t) => {
    state.touch = true;
    const x = t.clientX, y = t.clientY;
    const btn = buttonAt(x, y);
    if (btn) { pressed.set(t.identifier, btn); return; }
    if (!stick && x < controlLayout(view()).stickZone) {
      stick = { id: t.identifier, ox: x, oy: y, x, y };
    }
  };
  const touchEnd = (t) => {
    if (stick && stick.id === t.identifier) stick = null;
    pressed.delete(t.identifier);
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
  canvas.addEventListener('touchend', endAll, { passive: false });
  canvas.addEventListener('touchcancel', endAll, { passive: false });

  /* ----------------------------------------------------------------- read */

  state.read = (toWorld, self) => {
    const L = controlLayout(view());
    let move = 0;
    let stickV = null;

    if (held('left')) move -= 1;
    if (held('right')) move += 1;

    if (stick) {
      const dx = stick.x - stick.ox, dy = stick.y - stick.oy;
      const len = Math.hypot(dx, dy);
      if (len > 4) stickV = { x: dx / Math.max(len, L.stickMax), y: dy / Math.max(len, L.stickMax) };
      move = Math.max(-1, Math.min(1, dx / L.stickMax));
      if (Math.abs(move) < 0.16) move = 0;
    }
    state.move = move;

    const btn = new Set(pressed.values());
    state.jump = held('jump') || btn.has('jump');
    state.grab = held('grab') || !!state.mouseGrab || btn.has('grab');
    state.brace = held('brace') || !!state.mouseBrace || btn.has('brace');
    state.limp = held('limp');

    if (state.hasMouse && !state.touch) {
      state.aim = toWorld(state.mouse.x, state.mouse.y);
    } else if (self) {
      // On a phone the thumbstick doubles as the aim: push up and your hands
      // go up. Without this you can only ever reach straight ahead, which
      // makes grabbing a ledge - or your friend, above you - impossible.
      const t = self.parts.torso.position;
      const dir = stickV && (Math.abs(stickV.x) > 0.15 || Math.abs(stickV.y) > 0.15)
        ? stickV
        : { x: self.facing, y: 0.34 };
      const len = Math.hypot(dir.x, dir.y) || 1;
      state.aim = { x: t.x + (dir.x / len) * 62, y: t.y + (dir.y / len) * 62 + 8 };
    }
    return state;
  };

  state.touchUI = () => ({ stick, buttons: new Set(pressed.values()) });
  return state;
}
