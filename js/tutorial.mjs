/* The first thirty seconds.
 *
 * Not a separate tutorial level and not a wall of text: a card in the corner
 * that asks for one verb at a time and ticks itself off when you do it. You
 * are already in the hotel while it runs, so nothing is being held up, and a
 * player who already knows the controls clears the whole thing in about eight
 * seconds without noticing it was a tutorial.
 *
 * It teaches the four verbs in the order the level needs them, and the last
 * one - the boost - is the only one that cannot be done alone, which is the
 * point being made.
 */

import { sfx } from './audio.mjs';

const STEPS = [
  {
    id: 'move',
    title: 'WALK',
    keys: 'A / D',
    touch: 'Drag the left of the screen',
    hint: 'You are not very good at walking. Nobody here is.',
    check: (s) => Math.abs(s.me.parts.torso.position.x - s.startX) > 120,
  },
  {
    id: 'jump',
    title: 'JUMP',
    keys: 'SPACE',
    touch: 'Tap JUMP',
    hint: 'It is not much of a jump.',
    check: (s) => s.me.parts.torso.position.y < s.floorY - 46,
  },
  {
    id: 'grab',
    title: 'GRAB SOMETHING',
    keys: 'E  or  LEFT CLICK',
    touch: 'Hold GRAB near something',
    hint: 'Beds, doors, luggage, your friend. Aim with the mouse or the stick.',
    check: (s) => !!(s.me.grabs.F || s.me.grabs.B),
  },
  {
    id: 'brace',
    title: 'HOLD BOOST',
    keys: 'Q  or  RIGHT CLICK',
    touch: 'Hold BOOST',
    hint: 'You plant your feet and cup your hands. Nothing happens on your own.',
    check: (s) => s.cmd && s.cmd.brace && s.me.grounded > 0,
  },
  {
    id: 'boost',
    title: 'NOW LAUNCH EACH OTHER',
    keys: 'One holds Q. The other walks up beside them and presses SPACE.',
    touch: 'One holds BOOST. The other stands beside them and taps JUMP.',
    hint: 'That is how you get anywhere in this building.',
    needsPartner: true,
    check: (s) => s.boosted,
  },
];

export function createTutorial() {
  const seen = localStorage.getItem('et.tutorial') === 'done';
  const t = {
    active: !seen,
    i: 0,
    done: seen,
    flash: 0,
    startX: null,
    floorY: null,
    boosted: false,
    finishedAt: 0,

    /** Which on-screen button this step wants, so it can be made to glow. */
    currentId() {
      if (!t.active) return null;
      const step = STEPS[t.i];
      if (!step) return null;
      return step.id === 'move' ? null : step.id === 'boost' ? 'brace' : step.id;
    },

    /** Something happened in the world that a step might be waiting for. */
    noteEvent(ev) {
      if (ev.type === 'boost') t.boosted = true;
    },

    skip() {
      t.active = false;
      t.done = true;
      localStorage.setItem('et.tutorial', 'done');
    },

    restart() {
      t.active = true;
      t.done = false;
      t.i = 0;
      t.startX = null;
      t.boosted = false;
      localStorage.removeItem('et.tutorial');
    },

    update(sim, slot, cmd, dt) {
      if (!t.active) {
        if (t.finishedAt) t.finishedAt = Math.max(0, t.finishedAt - dt);
        return;
      }
      const me = sim.players[slot];
      if (t.startX === null) {
        t.startX = me.parts.torso.position.x;
        t.floorY = me.parts.torso.position.y;
      }

      const step = STEPS[t.i];
      if (!step) return;

      // a step that needs two people waits, rather than asking for the
      // impossible, until there is somebody to do it with
      if (step.needsPartner && !sim.connected[1 - slot]) return;

      if (step.check({ me, cmd, startX: t.startX, floorY: t.floorY, boosted: t.boosted })) {
        t.i++;
        t.flash = 1;
        if (t.i >= STEPS.length) {
          sfx.goodJob();
          t.active = false;
          t.done = true;
          t.finishedAt = 2.6;
          localStorage.setItem('et.tutorial', 'done');
        } else {
          sfx.tick();
          // each new step measures from where you are now
          t.startX = me.parts.torso.position.x;
          t.floorY = me.parts.torso.position.y;
        }
      }
      t.flash = Math.max(0, t.flash - dt * 1.6);
    },

    /** The card. Drawn in screen space, over everything. */
    draw(ctx, view, isTouch, waitingForPartner) {
      if (!t.active && t.finishedAt <= 0) return;
      const w = view.w, h = view.h;
      const narrow = w < 620;
      const cw = Math.min(narrow ? w - 28 : 440, w - 28);
      const ch = narrow ? 92 : 104;
      const x = narrow ? 14 : 20;
      // On a phone the bottom of the screen belongs to the thumbs - the card
      // was sitting directly on top of the GRAB and BRACE buttons - so it goes
      // up under the clock instead, where nothing is ever pressed.
      const y = narrow ? 214 : 96;

      ctx.save();
      ctx.translate(x, y);

      // the card
      ctx.fillStyle = 'rgba(26,14,16,0.82)';
      ctx.beginPath();
      ctx.roundRect(0, 0, cw, ch, 16);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = t.flash > 0
        ? 'rgba(125,255,154,' + (0.35 + t.flash * 0.65) + ')'
        : 'rgba(255,216,94,0.34)';
      ctx.stroke();

      if (!t.active) {
        ctx.fillStyle = '#7dff9a';
        ctx.font = '900 17px system-ui, sans-serif';
        ctx.fillText('THAT IS EVERYTHING.', 16, 38);
        ctx.fillStyle = 'rgba(255,242,216,0.78)';
        ctx.font = '600 13px system-ui, sans-serif';
        ctx.fillText('Now get out of the building.', 16, 62);
        ctx.restore();
        return;
      }

      const step = STEPS[t.i];
      const waiting = step.needsPartner && waitingForPartner;

      // progress pips
      for (let i = 0; i < STEPS.length; i++) {
        ctx.beginPath();
        ctx.arc(16 + i * 15, 18, 5, 0, Math.PI * 2);
        ctx.fillStyle = i < t.i ? '#7dff9a' : i === t.i ? '#ffd85e' : 'rgba(255,242,216,0.22)';
        ctx.fill();
      }

      ctx.fillStyle = '#ffd85e';
      ctx.font = '900 ' + (narrow ? 18 : 21) + 'px system-ui, sans-serif';
      ctx.fillText(waiting ? 'WAIT FOR YOUR FRIEND' : step.title, 16, narrow ? 48 : 52);

      ctx.fillStyle = '#fff2d8';
      ctx.font = '700 ' + (narrow ? 12 : 13) + 'px system-ui, sans-serif';
      ctx.fillText(waiting ? 'This one takes two of you.' : (isTouch ? step.touch : step.keys),
        16, narrow ? 68 : 74);

      ctx.fillStyle = 'rgba(255,242,216,0.55)';
      ctx.font = '500 ' + (narrow ? 11 : 12) + 'px system-ui, sans-serif';
      ctx.fillText(step.hint, 16, narrow ? 84 : 94);

      ctx.fillStyle = 'rgba(255,242,216,0.38)';
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(isTouch ? 'tap here to skip' : 'press T to skip', cw - 14, 18);
      ctx.textAlign = 'left';
      ctx.restore();

      t.cardRect = { x, y, w: cw, h: ch };
    },

    /** Did a tap land on the card's skip corner? */
    hitSkip(px, py) {
      const r = t.cardRect;
      if (!t.active || !r) return false;
      return px > r.x + r.w - 90 && px < r.x + r.w && py > r.y && py < r.y + 34;
    },
  };
  return t;
}
