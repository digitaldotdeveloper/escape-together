/* Drawing the hotel.
 *
 * Everything here is painted from the level's own body list, so the picture
 * and the physics can never disagree - if you can see it, you can hit it.
 * The camera frames BOTH players at once and refuses to leave either behind,
 * which is the cheapest co-op design tool there is: you cannot wander off,
 * because the screen will not let you.
 */

import { drawCharacter, drawPosed } from './art.mjs';

export const CAM = {
  x: 400, y: 480, zoom: 1,
  shake: 0, shakeX: 0, shakeY: 0,
};

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ------------------------------------------------------------------ camera */

export function updateCamera(sim, view, dt, soloFocus, extraShake = 0) {
  const a = sim.players[0].parts.torso.position;
  const b = sim.connected[1] ? sim.players[1].parts.torso.position : a;
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;

  // Zoom out until both of them fit, and no further. The lower bound matters
  // more than the upper: below about 0.55 a character is 60 pixels tall, you
  // can no longer read a face, and the game stops being funny.
  // More room around the pair. At the old margins a phone was showing about
  // five metres of hotel and you could not see the thing you were walking
  // towards until you were standing on it - which reads as "zoomed in" and
  // plays as "why did that hit me".
  const spanX = Math.abs(a.x - b.x) + 520;
  const spanY = Math.abs(a.y - b.y) + 400;
  // On a TALL screen the height is not the real constraint - obeying it would
  // zoom in until the two of you no longer fit side by side - so it is allowed
  // to pull the zoom down only so far. On a wide screen, which is how the game
  // is meant to be held, the height is a genuine limit and is obeyed.
  const tall = view.h > view.w;
  const hLimit = tall ? Math.max(view.h, view.w * 0.62) : view.h;
  const fit = Math.min(view.w / spanX, hLimit / spanY);
  // A scene that declares its own top and bottom gets framed by them: zoom in
  // far enough that nothing outside the room is on screen. Only ever applied
  // when there is one person to follow - with two, "both of you fit" wins.
  const B = sim.level.def.bounds;
  const alone = !sim.connected[1];
  const boundZoom = (B && alone) ? view.h / (B.bottom - B.top) : 0;
  const zoom = clamp(Math.max(fit, boundZoom), 0.5, 1.9);

  // A single non-finite body position propagates into the camera and then into
  // every gradient and transform drawn from it, and the canvas throws rather
  // than drawing nothing - so the whole frame is lost. Refuse it here, once,
  // instead of guarding forty draw calls.
  if (!Number.isFinite(midX) || !Number.isFinite(midY) || !Number.isFinite(zoom)) return;

  // and repair itself if it ever did get poisoned: a NaN camera draws nothing
  // at all, forever, because the canvas throws rather than skipping the shape
  if (!Number.isFinite(CAM.x) || !Number.isFinite(CAM.y) || !Number.isFinite(CAM.zoom)) {
    CAM.x = midX; CAM.y = midY; CAM.zoom = zoom; CAM.shake = 0;
  }

  const k = 1 - Math.pow(0.0016, dt);
  CAM.x = lerp(CAM.x, midX, k);
  // sit the pair low in frame: there is always more happening above them
  // (ceilings, debris, the floor they are trying to reach) than below
  // sit the pair low in frame: there is always more happening above them
  // (ceilings, debris, the floor they are trying to reach) than below. On a
  // portrait screen there is more spare room, so push them lower still.
  // Held sideways, the controls take the two bottom corners rather than a
  // whole band, so the pair can sit a little lower in frame and leave room
  // above them for ceilings, debris and the floor they are trying to reach.
  const lowness = tall ? 0.02 : 0.08;
  CAM.y = lerp(CAM.y, midY - view.h * lowness / zoom, k);
  CAM.zoom = lerp(CAM.zoom, zoom, k * 0.7);

  // and having zoomed to fit the room, stay inside it
  if (B && alone) {
    const half = view.h / (2 * CAM.zoom);
    CAM.y = (B.bottom - B.top) < half * 2
      ? (B.top + B.bottom) / 2
      : clamp(CAM.y, B.top + half, B.bottom - half);
  }

  CAM.shake = Math.max(Math.max(sim.shake, extraShake), CAM.shake - dt * 1.2);
  const s = CAM.shake * 16;
  CAM.shakeX = (Math.random() - 0.5) * s;
  CAM.shakeY = (Math.random() - 0.5) * s;
}

export function applyCamera(ctx, view) {
  // setTransform, not scale/translate on top of what is already there - but it
  // must start FROM the device pixel ratio, not from identity. Resetting to
  // identity throws the ratio away, and on any 2x screen (which is every
  // phone) the entire world then draws at half size inside a canvas twice the
  // size it thinks it is. It looks perfectly fine on a 1x desktop monitor,
  // which is exactly why it survived so long.
  const d = view.dpr || 1;
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.translate(view.w / 2 + CAM.shakeX, view.h / 2 + CAM.shakeY);
  ctx.scale(CAM.zoom, CAM.zoom);
  ctx.translate(-CAM.x, -CAM.y);
}

export function screenToWorld(view, sx, sy) {
  return {
    x: (sx - view.w / 2 - CAM.shakeX) / CAM.zoom + CAM.x,
    y: (sy - view.h / 2 - CAM.shakeY) / CAM.zoom + CAM.y,
  };
}

/* -------------------------------------------------------------- the hotel */

const C = {
  wallA: '#c8a15e', wallB: '#b98d4d', wallTop: '#e2c48b',
  plaster: '#e8d6b4', skirt: '#7c5a33',
  carpet: '#8d3540', carpetB: '#7a2c36',
  concrete: '#6f6a63', concreteDark: '#57534d',
  metal: '#98a3ae', metalDark: '#6d7681',
  wood: '#9a6634', woodDark: '#744a24',
  gold: '#f0c04a', warn: '#e8a72c',
};

function shadedBox(ctx, x, y, w, h, top, body, r = 3) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(x, y, w, Math.min(7, h * 0.34), r);
  ctx.fillStyle = top;
  ctx.fill();
}

function wallpaper(ctx, x, y, w, h) {
  ctx.fillStyle = C.wallA;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.055)';
  for (let i = x - (x % 46); i < x + w; i += 46) ctx.fillRect(i, y, 22, h);
  // dado rail and skirting: the two lines that make a flat block read as a room
  ctx.fillStyle = C.plaster;
  ctx.fillRect(x, y + h * 0.52, w, 5);
  ctx.fillStyle = C.skirt;
  ctx.fillRect(x, y + h - 12, w, 12);
}

/* The hotel is not one wall repeated for five thousand units.
 *
 * Each stretch of the level names the room it is in, and the backdrop is drawn
 * from that. It is the cheapest possible way to make a building feel like a
 * building rather than a corridor with the same wallpaper printed on it, and
 * it is what lets a player say "meet me by the lifts" and be understood. */
const ZONE_SETS = {
  coop1: [
    { from: -1200, to: 960,  bg: 'bedroom',  name: 'ROOM 402' },
    { from: 960,   to: 2860, bg: 'corridor', name: 'FOURTH FLOOR CORRIDOR' },
    { from: 2860,  to: 3560, bg: 'service',  name: 'SERVICE STAIRS' },
    { from: 3560,  to: 6600, bg: 'lobby',    name: 'LIFT LOBBY' },
  ],
  solo1: [
    { from: -1200, to: 1080, bg: 'bedroom',  name: 'ROOM 402' },
    { from: 1080,  to: 1800, bg: 'corridor', name: 'THE CORRIDOR' },
    { from: 1800,  to: 4000, bg: 'service',  name: 'THE FIRE ESCAPE' },
  ],
};

export const zonesFor = (id) => ZONE_SETS[id] || ZONE_SETS.coop1;
export const ZONES = ZONE_SETS.coop1;

let zoneList = ZONE_SETS.coop1;
const zoneAt = (x) => zoneList.find((z) => x >= z.from && x < z.to)
  || zoneList[zoneList.length - 1];

function drawBackdrop(ctx, sim, view, bgs) {
  const { FLOOR1, FLOOR2 } = sim.level.consts;
  zoneList = zonesFor(sim.level.def.id);
  // warm dusty interior, going black below the lowest floor so a hole in the
  // ground reads as a hole and not as more room
  const g = ctx.createLinearGradient(0, FLOOR2 - 460, 0, FLOOR1 + 30);
  g.addColorStop(0, '#33232a');
  g.addColorStop(0.5, '#6a4638');
  g.addColorStop(1, '#8a5c3e');
  ctx.fillStyle = g;
  ctx.fillRect(CAM.x - 2400, CAM.y - 1600, 4800, 3200);
  const v = ctx.createLinearGradient(0, FLOOR1 + 10, 0, FLOOR1 + 300);
  v.addColorStop(0, 'rgba(12,6,8,0.55)');
  v.addColorStop(1, '#080405');
  ctx.fillStyle = v;
  ctx.fillRect(CAM.x - 2400, FLOOR1 + 10, 4800, 1400);

  // Something down the shaft. On a portrait phone a third of the screen is
  // below the floor, and an unbroken black rectangle reads as a rendering
  // fault rather than as a drop - so the floors below get sketched in,
  // fading out, with a dim emergency light somewhere down there.
  ctx.save();
  for (let i = 1; i <= 3; i++) {
    const y = FLOOR1 + i * 190;
    const a = 0.30 / i;
    ctx.globalAlpha = a;
    ctx.fillStyle = '#4a3a34';
    ctx.fillRect(CAM.x - 1400, y, 2800, 16);
    ctx.fillStyle = '#2c211f';
    ctx.fillRect(CAM.x - 1400, y + 16, 2800, 8);
    // a few broken joists poking out of the dark
    ctx.globalAlpha = a * 0.8;
    ctx.fillStyle = '#6b4a30';
    for (let k = -6; k <= 6; k++) {
      const jx = CAM.x + k * 230 + ((i * 61) % 140);
      ctx.fillRect(jx, y - 26, 12, 26);
    }
  }
  ctx.globalAlpha = 0.16;
  const glow = ctx.createRadialGradient(
    CAM.x + 180, FLOOR1 + 250, 6, CAM.x + 180, FLOOR1 + 250, 260);
  glow.addColorStop(0, '#ff6a3a');
  glow.addColorStop(1, 'rgba(255,106,58,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(CAM.x - 200, FLOOR1 + 20, 800, 500);
  ctx.restore();
  ctx.globalAlpha = 1;

  // The wall, drawn per zone and parallaxed a touch. Each tile asks which room
  // it is standing in, so the change of room happens at the doorway rather
  // than wherever the tiling happened to land.
  const px = CAM.x * 0.06;
  // A character is ~118 units tall and a door should be about 130. Drawn at
  // 420 the painted doors came out over 250 units - twice life size - and the
  // hotel read as a doll's house with a giant living in it. 300 puts a door at
  // roughly a person and a half, which is what a door looks like.
  const H = 300;
  const tile = (floorY) => {
    const step = 360;
    const first = Math.floor((CAM.x - 1500 + px) / step) * step;
    for (let x = first; x < CAM.x + 1500; x += step) {
      const z = zoneAt(x + step / 2);
      const bg = bgs[z.bg] || bgs.room;
      if (!bg) { wallpaper(ctx, x - px, floorY - 360, step + 2, 360); continue; }
      const w = (bg.width / bg.height) * H;
      // draw the wall from its BOTTOM up: the interesting half of these
      // paintings is the doors and the skirting, not the ceiling
      ctx.drawImage(bg, 0, 0, bg.width, bg.height,
        x - px, floorY - H + 4, Math.max(step + 2, w * 0.42), H);
    }
  };
  ctx.globalAlpha = 0.97;
  // Only the storeys this level actually has. Tiling FLOOR2 unconditionally
  // hung a strip of corridor wall in mid-air across the top of every
  // single-storey scene.
  for (const floorY of (sim.level.def.floors || [FLOOR1, FLOOR2])) tile(floorY);
  ctx.globalAlpha = 1;

  // Close the room in. The paintings end 300 units above the floor and the
  // ceiling sits a little higher than that, and the gap between them was
  // empty gradient - a stripe of outdoors inside a hotel bedroom.
  for (const floorY of (sim.level.def.floors || [FLOOR1, FLOOR2])) {
    const top = floorY - H + 4;
    const c = ctx.createLinearGradient(0, top - 150, 0, top + 2);
    c.addColorStop(0, '#241a1c');
    c.addColorStop(1, '#4a332c');
    ctx.fillStyle = c;
    ctx.fillRect(CAM.x - 2400, top - 150, 4800, 152);
    ctx.fillStyle = 'rgba(255,226,180,0.10)';
    ctx.fillRect(CAM.x - 2400, top - 8, 4800, 5);
  }
}

function drawStatic(ctx, s) {
  const { x, y, w, h, id } = s;
  if (s.look === 'rubble') {
    // A pile of the ceiling on the floor. It was being drawn with the generic
    // wall shader, which made the one thing in the room you are meant to climb
    // over look like a floating white slab.
    ctx.fillStyle = '#2a1c18';
    ctx.fillRect(x, y + h - 8, w, 8);
    const art = PROP_ART.debris;
    if (art) {
      // Chunks of different sizes, overlapping, some of them tipped over and
      // some half buried. Evenly spaced identical copies read as a pattern,
      // and a pattern reads as a mistake.
      const n = Math.max(3, Math.round(w / 46));
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1 || 1);
        const k = (i * 2654435761) % 1000 / 1000;      // stable per chunk
        const dh = (h + 12) * (0.62 + k * 0.62);
        const dw = dh * art.aspect;
        ctx.save();
        ctx.globalAlpha = 0.94;
        ctx.translate(x + 10 + t * (w - 20), y + h - dh * 0.34 + k * 6);
        ctx.rotate((k - 0.5) * 0.9);
        ctx.drawImage(art.im, -dw / 2, -dh / 2, dw, dh);
        ctx.restore();
      }
      // dust settling in the gaps, and a shadow where it meets the floor
      ctx.fillStyle = 'rgba(30,18,16,0.35)';
      ctx.fillRect(x - 4, y + h - 6, w + 8, 6);
    } else {
      ctx.fillStyle = '#cbb99c';
      ctx.fillRect(x, y, w, h);
    }
    return;
  }
  if (id === 'vent_sill') {
    // the way out of room 402, framed in metal so it reads as a way out
    ctx.fillStyle = C.metalDark;
    ctx.fillRect(x - 4, y - 4, w + 8, h + 4);
    ctx.fillStyle = C.metal;
    ctx.fillRect(x, y - 2, w, 5);
    ctx.fillStyle = C.warn;
    for (let i = 0; i < w; i += 14) ctx.fillRect(x + i, y + 5, 7, 4);
    return;
  }
  if (id.startsWith('f')) {
    // A floor slab. The old one was a 60-unit block of grey with a 7-unit
    // stripe of carpet on it, and since the camera now frames the room that
    // grey was a fifth of the screen. It is a carpet, a brass nosing and then
    // the dark under the boards - the floor should end, not continue.
    ctx.fillStyle = '#140c0e';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = C.carpet;
    ctx.fillRect(x, y, w, 16);
    // the runner down the middle of the corridor, worn through in places
    ctx.fillStyle = C.carpetB;
    for (let i = x - (x % 74); i < x + w; i += 74) ctx.fillRect(i, y + 3, 38, 10);
    ctx.fillStyle = 'rgba(255,214,150,0.13)';
    for (let i = x - (x % 74); i < x + w; i += 74) ctx.fillRect(i + 44, y + 5, 12, 5);
    ctx.fillStyle = C.gold;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(x, y + 16, w, 3);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#2a1a18';
    ctx.fillRect(x, y + 19, w, 9);
    const u = ctx.createLinearGradient(0, y + 28, 0, y + h);
    u.addColorStop(0, '#241618');
    u.addColorStop(1, '#0b0709');
    ctx.fillStyle = u;
    ctx.fillRect(x, y + 28, w, h - 28);
  } else {
    // A wall: plaster with a shaded return, so a gap in it reads as a doorway.
    // The far end wall is in shadow rather than lit - a full-height slab of
    // bright plaster at the edge of the level pulled the eye straight off the
    // character and onto nothing.
    ctx.fillStyle = h > 300 ? '#8e7a5e' : C.plaster;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(120,80,50,0.18)';
    ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.fillRect(x + w - 6, y, 6, h);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(x, y, 4, h);
    ctx.fillStyle = C.skirt;
    if (h > 60) ctx.fillRect(x - 2, y + h - 12, w + 4, 12);
  }
}

/* --------------------------------------------------------------- the props */

/* Painted prop sprites, keyed by prop kind, filled in by the loader. */
export const PROP_ART = {};

/* Draw the painted sprite for a prop, if there is one.
 *
 * The physics box and the painting are not the same shape and should not be
 * forced to be: the box is what you collide with, the painting is what the
 * thing looks like. Match the width, keep the drawn proportions, and stand it
 * on the bottom of the box so furniture sits on the floor rather than hovering
 * above it or sinking into it.
 */
function paintedProp(ctx, b, kind) {
  const art = PROP_ART[kind];
  if (!art) return false;
  const W = b.plugin.w || (b.bounds.max.x - b.bounds.min.x);
  const H = b.plugin.h || (b.bounds.max.y - b.bounds.min.y);
  // A tall thin thing is sized by its height, a wide flat thing by its width,
  // so neither ends up hanging out of the room.
  const byW = W / art.aspect;
  const scale = byW >= H * 0.72 ? W : H * art.aspect;
  const dw = scale, dh = scale / art.aspect;
  ctx.save();
  ctx.translate(b.position.x, b.position.y);
  ctx.rotate(b.angle);
  ctx.drawImage(art.im, -dw / 2, H / 2 - dh, dw, dh);
  ctx.restore();
  return true;
}

function propArt(ctx, b, kind) {
  if (paintedProp(ctx, b, kind)) return;
  const w = b.bounds.max.x - b.bounds.min.x;
  const h = b.bounds.max.y - b.bounds.min.y;
  ctx.save();
  ctx.translate(b.position.x, b.position.y);
  ctx.rotate(b.angle);
  const W = b.plugin.w || w, H = b.plugin.h || h;
  const x = -W / 2, y = -H / 2;

  switch (kind) {
    case 'bed':
      shadedBox(ctx, x, y, W, H, '#f4efe2', '#d9d2c2', 5);
      ctx.fillStyle = '#b23b46';
      ctx.fillRect(x + W * 0.08, y + 3, W * 0.84, H * 0.34);
      ctx.fillStyle = '#f7f3ea';
      ctx.fillRect(x + W * 0.06, y + 2, W * 0.22, H * 0.30);
      ctx.fillStyle = C.woodDark;
      ctx.fillRect(x, y + H - 6, 7, 6);
      ctx.fillRect(x + W - 7, y + H - 6, 7, 6);
      break;
    case 'wardrobe':
      shadedBox(ctx, x, y, W, H, '#a9743f', C.wood, 4);
      ctx.strokeStyle = C.woodDark; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(0, y + 5); ctx.lineTo(0, y + H - 5); ctx.stroke();
      ctx.fillStyle = C.gold;
      ctx.beginPath(); ctx.arc(-6, 0, 3, 0, 7); ctx.arc(6, 0, 3, 0, 7); ctx.fill();
      break;
    case 'crate':
      shadedBox(ctx, x, y, W, H, '#c08a4c', '#a9743f', 3);
      ctx.strokeStyle = C.woodDark; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 3, y + 3); ctx.lineTo(x + W - 3, y + H - 3);
      ctx.moveTo(x + W - 3, y + 3); ctx.lineTo(x + 3, y + H - 3);
      ctx.stroke();
      break;
    case 'case':
      shadedBox(ctx, x, y, W, H, '#8e5a6d', '#714656', 5);
      ctx.fillStyle = '#3a2530';
      ctx.fillRect(x + 3, y + H * 0.42, W - 6, 4);
      ctx.strokeStyle = '#3a2530'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, y, 8, Math.PI, 0); ctx.stroke();
      break;
    case 'trolley':
      ctx.fillStyle = C.metalDark;
      ctx.fillRect(x + 4, y, 5, H - 8);
      ctx.fillRect(x + W - 9, y, 5, H - 8);
      shadedBox(ctx, x, y + H * 0.42, W, H * 0.30, C.metal, C.metalDark, 3);
      ctx.fillStyle = '#b23b46';
      ctx.fillRect(x + 6, y + H * 0.12, W - 12, H * 0.32);
      ctx.fillStyle = '#2a2a2e';
      for (const wx of [x + 8, x + W - 8]) {
        ctx.beginPath(); ctx.arc(wx, y + H - 5, 5, 0, 7); ctx.fill();
      }
      break;
    case 'table':
      ctx.fillStyle = C.wood;
      ctx.fillRect(x, y, W, 8);
      ctx.fillStyle = C.woodDark;
      ctx.fillRect(x + 6, y + 8, 6, H - 8);
      ctx.fillRect(x + W - 12, y + 8, 6, H - 8);
      break;
    case 'chair':
      ctx.fillStyle = C.wood;
      ctx.fillRect(x, y + H * 0.4, W, 6);
      ctx.fillRect(x + W - 7, y, 6, H * 0.5);
      ctx.fillStyle = C.woodDark;
      ctx.fillRect(x + 2, y + H * 0.4 + 6, 5, H * 0.55);
      ctx.fillRect(x + W - 8, y + H * 0.4 + 6, 5, H * 0.55);
      break;
    case 'tv':
      shadedBox(ctx, x, y, W, H, '#4a4a52', '#33333a', 3);
      ctx.fillStyle = '#7fd8e8';
      ctx.fillRect(x + 4, y + 4, W - 8, H - 12);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(x + 4, y + 4, (W - 8) * 0.4, H - 12);
      break;
    case 'lamp':
      ctx.fillStyle = C.metalDark;
      ctx.fillRect(-2, y + H * 0.3, 4, H * 0.7);
      ctx.fillStyle = '#f2e2b0';
      ctx.beginPath();
      ctx.moveTo(-W * 0.7, y + H * 0.3); ctx.lineTo(W * 0.7, y + H * 0.3);
      ctx.lineTo(W * 0.45, y); ctx.lineTo(-W * 0.45, y); ctx.closePath(); ctx.fill();
      break;
    case 'ext':
      shadedBox(ctx, x, y, W, H, '#e05a4a', '#b8382c', 5);
      ctx.fillStyle = '#2a2a2e';
      ctx.fillRect(x, y, W, 5);
      break;
    case 'plant':
      ctx.fillStyle = '#a9743f';
      ctx.fillRect(x + 4, y + H * 0.55, W - 8, H * 0.45);
      ctx.fillStyle = '#4f8f3d';
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.ellipse(i * 7, y + H * 0.28, 7, 16, i * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'plank':
      shadedBox(ctx, x, y, W, H, '#c08a4c', C.wood, 2);
      break;
    case 'debris': {
      // What came off the ceiling: old plaster, with the paint still on the
      // side that used to be the ceiling and bare lath on the broken side.
      ctx.beginPath();
      ctx.moveTo(x, y + H * 0.3); ctx.lineTo(x + W * 0.4, y);
      ctx.lineTo(x + W, y + H * 0.2); ctx.lineTo(x + W * 0.8, y + H);
      ctx.lineTo(x + W * 0.1, y + H * 0.85); ctx.closePath();
      ctx.fillStyle = '#d8c8ae';
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#efe6d4';
      ctx.fillRect(x, y, W, H * 0.34);
      ctx.fillStyle = 'rgba(120,86,54,0.30)';
      for (let i = 0; i < W; i += 9) ctx.fillRect(x + i, y + H * 0.45, 5, H);
      ctx.fillStyle = 'rgba(60,38,26,0.22)';
      ctx.fillRect(x, y + H * 0.44, W, 3);
      ctx.restore();
      ctx.strokeStyle = 'rgba(52,32,22,0.42)'; ctx.lineWidth = 2; ctx.stroke();
      break;
    }
    case 'crumble':
      ctx.fillStyle = C.carpet;
      ctx.fillRect(x, y, W, 6);
      ctx.fillStyle = C.concrete;
      ctx.fillRect(x, y + 6, W, H - 6);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.5, y + 0.5, W - 1, H - 1);
      break;
    case 'shutter':
      shadedBox(ctx, x, y, W, H, '#d0803c', '#a9622a', 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 2;
      for (let i = y + 8; i < y + H; i += 14) {
        ctx.beginPath(); ctx.moveTo(x, i); ctx.lineTo(x + W, i); ctx.stroke();
      }
      break;
    case 'plate':
      shadedBox(ctx, x, y, W, H, C.metal, C.metalDark, 3);
      break;
    case 'lever':
      ctx.fillStyle = C.metalDark;
      ctx.fillRect(-3, y, 6, H);
      ctx.fillStyle = '#e04a3a';
      ctx.beginPath(); ctx.arc(0, y + 6, 9, 0, 7); ctx.fill();
      break;
    case 'lift':
      shadedBox(ctx, x, y, W, H, C.metal, C.metalDark, 3);
      ctx.fillStyle = C.gold;
      ctx.fillRect(x, y, W, 3);
      break;
    case 'seesaw':
      shadedBox(ctx, x, y, W, H, '#c08a4c', C.wood, 2);
      break;
    default:
      shadedBox(ctx, x, y, W, H, '#bbb', '#999', 3);
  }
  ctx.restore();
}

/* ----------------------------------------------------------------- the lot */

export function drawWorld(ctx, sim, view, arts, bgs, ui) {
  const { FLOOR1 } = sim.level.consts;
  drawBackdrop(ctx, sim, view, bgs);

  for (const s of sim.level.decor) drawStatic(ctx, s);

  for (const b of sim.netBodies) {
    if (b.plugin.owner) continue;                 // characters are drawn later
    if (b.plugin.kind === 'debris' && b.plugin.parked) continue;
    propArt(ctx, b, b.plugin.kind);
  }

  // ---- the things you can press -----------------------------------------
  for (const sw of sim.mech.switches) {
    ctx.save();
    ctx.translate(sw.x, sw.y);
    // backplate
    ctx.fillStyle = '#4a4038';
    ctx.beginPath();
    ctx.roundRect(-sw.w / 2, -sw.h / 2, sw.w, sw.h, 5);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke();
    // the button itself
    const lit = sw.id === 'alarm' ? sw.on : sw.on;
    ctx.beginPath();
    ctx.roundRect(-sw.w / 2 + 4, -sw.h / 2 + 4, sw.w - 8, sw.h - 8, 3);
    ctx.fillStyle = sw.id === 'alarm'
      ? (sw.on ? '#ff5a3a' : '#c0392b')
      : lit ? '#ffd85e' : '#6d6257';
    ctx.fill();
    if (lit) {
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(0, 0, sw.w, 0, Math.PI * 2);
      ctx.fillStyle = sw.id === 'alarm' ? '#ff5a3a' : '#ffd85e';
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // say what it is, once somebody is close enough to press it
    let near = false;
    for (let i = 0; i < 2; i++) {
      if (!sim.connected[i]) continue;
      const t = sim.players[i].parts.torso.position;
      if (Math.hypot(t.x - sw.x, t.y - sw.y) < 96) near = true;
    }
    if (near) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '900 11px system-ui, sans-serif';
      const beat = 0.6 + 0.4 * Math.sin(Date.now() / 240);
      ctx.fillStyle = 'rgba(255,216,94,' + beat + ')';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 4;
      ctx.strokeText(sw.label, sw.x, sw.y - sw.h / 2 - 10);
      ctx.fillText(sw.label, sw.x, sw.y - sw.h / 2 - 10);
      ctx.restore();
    }
  }

  // the plate glows when it is doing its job - a mechanism you cannot read is
  // not a puzzle, it is a bug report
  const plate = sim.mech.plate;
  const need = sim.mech.plateLoad / 8;
  if (need > 0.02) {
    ctx.save();
    ctx.globalAlpha = 0.30 + Math.min(1, need) * 0.5;
    ctx.fillStyle = need >= 1 ? '#7dff9a' : '#ffd85e';
    ctx.beginPath();
    ctx.ellipse(plate.position.x, plate.position.y - 6, 78, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  for (const [i, lv] of sim.mech.levers.entries()) {
    if (!(sim.mech.leversOn && sim.mech.leversOn[i])) continue;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#7dff9a';
    ctx.beginPath(); ctx.arc(lv.position.x, lv.position.y, 22, 0, 7); ctx.fill();
    ctx.restore();
  }

  for (let i = 0; i < 2; i++) {
    if (!sim.connected[i]) continue;
    const art = arts[i];
    if (!art) continue;
    // Drawn poses when the character has them; the old jointed rendering is
    // the fallback for anyone not yet drawn.
    if (!drawPosed(ctx, sim.players[i], art, ui.dt)) {
      drawCharacter(ctx, sim.players[i], art);
    }
  }

  // The boost is the one thing nobody works out on their own, so the game says
  // it out loud exactly when it becomes possible: when one of you is holding
  // BOOST and the other is standing close enough to be thrown.
  if (sim.connected[0] && sim.connected[1]) {
    for (let i = 0; i < 2; i++) {
      const holder = sim.players[i];
      const flier = sim.players[1 - i];
      if (!holder.bracing) continue;
      const a = holder.parts.torso.position;
      const b = flier.parts.torso.position;
      const near = Math.abs(a.x - b.x) < 52 && Math.abs(a.y - b.y) < 90;
      const mine = (1 - i) === ui.slot;
      const beat = 0.5 + 0.5 * Math.sin(Date.now() / 220);

      ctx.save();
      ctx.textAlign = 'center';
      if (near) {
        // over the person who should jump
        ctx.font = '900 15px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(125,255,154,' + (0.7 + beat * 0.3) + ')';
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.lineWidth = 5;
        const label = mine ? 'JUMP!' : 'THEY CAN JUMP';
        ctx.strokeText(label, b.x, b.y - 78 - beat * 4);
        ctx.fillText(label, b.x, b.y - 78 - beat * 4);
      } else {
        // holding it with nobody there: say what is missing
        ctx.font = '800 12px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,216,94,0.75)';
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 4;
        const label = 'READY - COME STAND HERE';
        ctx.strokeText(label, a.x, a.y - 76);
        ctx.fillText(label, a.x, a.y - 76);
      }
      ctx.restore();
    }
  }

  // name tags, so you always know which floppy person is you
  for (let i = 0; i < 2; i++) {
    if (!sim.connected[i]) continue;
    const t = sim.players[i].parts.torso.position;
    const mine = i === ui.slot;
    ctx.save();
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const label = mine ? 'YOU' : (ui.peerName || 'FRIEND');
    ctx.fillStyle = mine ? '#ffd85e' : '#8fd8ff';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 4;
    ctx.strokeText(label, t.x, t.y - 62);
    ctx.fillText(label, t.x, t.y - 62);
    ctx.restore();
  }
}

/** The room with the lights off, and the water coming down. Both are drawn
 *  over the world and under the HUD, because they are things happening to the
 *  room rather than things in it. */
export function drawRoomState(ctx, sim, view, dt) {
  const lights = sim.mech.switches.find((s) => s.id === 'lights');
  const alarm = sim.mech.switches.find((s) => s.id === 'alarm');

  // a real blackout is darker than someone flicking the switch off
  if (sim.blackout > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#2b3560';
    ctx.fillRect(CAM.x - 2400, CAM.y - 1400, 4800, 2800);
    ctx.restore();
    // emergency lighting: a dim red wash from somewhere down the corridor
    ctx.save();
    ctx.globalAlpha = 0.13 + 0.05 * Math.sin(Date.now() / 700);
    ctx.fillStyle = '#ff2d1f';
    ctx.fillRect(CAM.x - 2400, CAM.y - 1400, 4800, 2800);
    ctx.restore();
  } else if (lights && !lights.on) {
    // not pitch black: dim, blue, and lit by whatever is still on
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#4a5a86';
    ctx.fillRect(CAM.x - 2400, CAM.y - 1400, 4800, 2800);
    ctx.restore();
  }

  if (sim.sprinklers > 0) {
    ctx.save();
    ctx.strokeStyle = 'rgba(180,220,255,0.55)';
    ctx.lineWidth = 1.4;
    const t = Date.now() / 90;
    for (let i = 0; i < 120; i++) {
      const x = CAM.x - 700 + ((i * 137.5 + t * 3) % 1400);
      const y = CAM.y - 500 + ((i * 91.7 + t * 46) % 1000);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 1.5, y + 13);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (sim.party > 0) {
    // the ballroom system, which nobody asked for
    ctx.save();
    const hue = (Date.now() / 6) % 360;
    ctx.globalAlpha = 0.13;
    ctx.fillStyle = 'hsl(' + hue + ',90%,55%)';
    ctx.fillRect(CAM.x - 2400, CAM.y - 1400, 4800, 2800);
    ctx.restore();
  }

  if (alarm && alarm.on) {
    ctx.save();
    ctx.globalAlpha = 0.10 + 0.10 * Math.sin(Date.now() / 130);
    ctx.fillStyle = '#ff3b1f';
    ctx.fillRect(CAM.x - 2400, CAM.y - 1400, 4800, 2800);
    ctx.restore();
  }
}

/** Dust and falling grit, drawn over everything - pure atmosphere. */
const motes = Array.from({ length: 90 }, () => ({
  x: Math.random() * 5400, y: Math.random() * 700,
  s: 0.4 + Math.random() * 1.6, v: 0.2 + Math.random() * 0.7,
}));

export function drawDust(ctx, dt, shake) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,236,200,0.5)';
  for (const m of motes) {
    m.y += m.v * dt * 60 * (1 + shake * 6);
    if (m.y > 780) { m.y = -40; m.x = CAM.x + (Math.random() - 0.5) * 1600; }
    if (Math.abs(m.x - CAM.x) > 1300) m.x = CAM.x + (Math.random() - 0.5) * 1600;
    ctx.globalAlpha = 0.10 + m.s * 0.14;
    ctx.fillRect(m.x, m.y, m.s, m.s * 2.4);
  }
  ctx.restore();
}
