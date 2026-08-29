/* Portrait, on a phone, on purpose.
 *
 * The game is designed for a phone held upright: the action sits in the top
 * two thirds and the bottom third is thumbs. Turned sideways the same layout
 * puts the buttons on top of the characters and the camera has nowhere to put
 * the second player.
 *
 * Three things, in order of how much the browser will actually let us do:
 *   1. the manifest asks for portrait, which is honoured when the game has
 *      been added to a home screen
 *   2. entering the hotel goes fullscreen and asks to lock portrait, which
 *      Android grants and iOS quietly ignores
 *   3. and because iOS ignores it, a phone held sideways gets asked, nicely
 *
 * A tablet or a desktop window that happens to be wide is left alone - this is
 * about phones, not about every landscape viewport.
 */

const isPhone = () =>
  (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0)
  && Math.min(innerWidth, innerHeight) < 560;

export const orientation = {
  /** Sideways on a phone: the game hides and asks for a turn.
   *
   *  Asked of the media query rather than of innerWidth/innerHeight: those two
   *  are not always updated by the time a resize handler runs, so comparing
   *  them reports the PREVIOUS orientation for a frame or two and the card
   *  appears exactly when it should not. */
  wrong() {
    return isPhone() && matchMedia('(orientation: landscape)').matches;
  },

  /** Called from a real tap, which is the only time either of these is allowed. */
  async goFullscreen() {
    if (!isPhone()) return;
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch { /* refused; the game is fine in a normal tab */ }
    try {
      if (screen.orientation && screen.orientation.lock) {
        await screen.orientation.lock('portrait');
      }
    } catch { /* iOS, and any browser that will not lock. The nudge covers it. */ }
  },

  /** Show or hide the "turn your phone" card, and keep it in step. */
  watch(el) {
    const sync = () => el.classList.toggle('show', orientation.wrong());
    // Sync now AND again shortly after: a rotation lands in stages, so the
    // first measurement can still describe the old shape. Deliberately not
    // requestAnimationFrame - a browser stops calling that in a tab that is
    // not in front, and the card would then be stuck on whatever it last was.
    const later = () => { sync(); setTimeout(sync, 150); setTimeout(sync, 450); };
    matchMedia('(orientation: landscape)').addEventListener('change', later);
    addEventListener('resize', later);
    addEventListener('orientationchange', later);
    sync();
    return sync;
  },
};
