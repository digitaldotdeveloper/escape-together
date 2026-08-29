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

/* Where the on-screen controls live. The single source of truth: the drawing
 * and the hit-testing both read this, because when they were written out
 * separately they drifted and pressing GRAB jumped.
 *
 * The three action buttons are a single vertical column against the right
 * edge, close enough together that a thumb slides from one to the next without
 * being lifted or aimed. JUMP is at the bottom, where the thumb already rests;
 * GRAB and BOOST are one flex and two flexes up. A scattered cluster looked
 * tidier and was much worse to actually play: every change of button was a
 * small act of navigation.
 *
 * They also sit above the iOS home indicator and clear the steering thumb.
 */
let safeInset = null;
function bottomSafeArea() {
  if (safeInset !== null) return safeInset;
  try {
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;left:0;bottom:0;width:1px;pointer-events:none;' +
      'height:env(safe-area-inset-bottom,0px)';
    document.body.appendChild(probe);
    safeInset = probe.getBoundingClientRect().height || 0;
    probe.remove();
  } catch { safeInset = 0; }
  return safeInset;
}

export function controlLayout(view) {
  const w = view.w, h = view.h;
  const s = Math.max(0.82, Math.min(1.25, Math.min(w, h) / 400));
  const sab = bottomSafeArea();
  const right = (px) => w - px * s;
  const bottom = (px) => h - px * s - sab;

  const colX = right(78);
  const step = 98 * s;          // centre to centre: touching, never overlapping
  return {
    scale: s,
    stickMax: 58 * s,
    stickZone: w * 0.46,
    stickHome: { x: 88 * s, y: bottom(104) },
    // the strip the controls live over, darkened so they always have contrast
    scrimTop: h - (330 * s + sab),
    buttons: [
      { id: 'jump',  label: 'JUMP',  glyph: 'up',    r: 46 * s, x: colX, y: bottom(88) },
      { id: 'grab',  label: 'GRAB',  glyph: 'pinch', r: 44 * s, x: colX, y: bottom(88) - step },
      { id: 'brace', label: 'BOOST', glyph: 'cup',   r: 44 * s, x: colX, y: bottom(88) - step * 2 },
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
    let best = null, bestScore = Infinity;
    for (const b of L.buttons) {
      // a generous ring around each button, scored by how far outside it the
      // touch landed, so a tap between two of them picks the nearer
      const d = Math.hypot(b.x - x, b.y - y) - b.r * 1.28;
      if (d < 0 && d < bestScore) { bestScore = d; best = b.id; }
    }
    return best;
  };

  // a short tick under the thumb: the only feedback a finger gets when it is
  // covering the thing it just pressed
  const buzz = () => { if (navigator.vibrate) { try { navigator.vibrate(11); } catch {} } };

  const touchStart = (t) => {
    state.touch = true;
    const x = t.clientX, y = t.clientY;
    const btn = buttonAt(x, y);
    if (btn) {
      pressed.set(t.identifier, btn);
      buzz();
      return;
    }
    if (!stick && x < controlLayout(view()).stickZone) {
      stick = { id: t.identifier, ox: x, oy: y, x, y };
    }
  };

  /** A finger already down on the buttons has moved: follow it.
   *
   *  Without this a touch is welded to whatever it first landed on, so sliding
   *  from JUMP up to GRAB does nothing at all and every change of button means
   *  lifting the thumb, finding the next one, and pressing again. */
  const touchDrag = (t) => {
    if (!pressed.has(t.identifier)) return;
    const was = pressed.get(t.identifier);
    const now = buttonAt(t.clientX, t.clientY);
    if (now === was) return;
    if (now) { pressed.set(t.identifier, now); buzz(); }
    else pressed.delete(t.identifier);   // slid off the column: let go
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
      else touchDrag(t);
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
