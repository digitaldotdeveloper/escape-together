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

export function updateCamera(sim, view, dt, soloFocus) {
  const a = sim.players[0].parts.torso.position;
  const b = sim.connected[1] ? sim.players[1].parts.torso.position : a;
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;

  // Zoom out until both of them fit, and no further. The lower bound matters
  // more than the upper: below about 0.55 a character is 60 pixels tall, you
  // can no longer read a face, and the game stops being funny.
  const spanX = Math.abs(a.x - b.x) + 330;
  const spanY = Math.abs(a.y - b.y) + 300;
  // On a TALL screen the height is not the real constraint - obeying it would
  // zoom in until the two of you no longer fit side by side - so it is allowed
  // to pull the zoom down only so far. On a wide screen, which is how the game
  // is meant to be held, the height is a genuine limit and is obeyed.
  const tall = view.h > view.w;
  const hLimit = tall ? Math.max(view.h, view.w * 0.62) : view.h;
  const fit = Math.min(view.w / spanX, hLimit / spanY);
  const zoom = clamp(fit, 0.55, 1.55);

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

  CAM.shake = Math.max(sim.shake, CAM.shake - dt * 1.2);
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

function drawBackdrop(ctx, sim, view, bgs) {
  const { FLOOR1, FLOOR2 } = sim.level.consts;
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

  // the interior wall, one long painted strip, parallaxed a touch
  const px = CAM.x * 0.06;
  const bg = bgs.room;
  if (bg) {
    const h = 420;
    const w = (bg.width / bg.height) * h;
    ctx.globalAlpha = 0.95;
    for (let x = Math.floor((CAM.x - 1600 + px) / w) * w; x < CAM.x + 1600; x += w) {
      ctx.drawImage(bg, x - px, FLOOR1 - h + 4, w, h);
      ctx.drawImage(bg, x - px, FLOOR2 - h + 4, w, h);
    }
    ctx.globalAlpha = 1;
  } else {
    wallpaper(ctx, CAM.x - 1600, FLOOR1 - 360, 3200, 360);
    wallpaper(ctx, CAM.x - 1600, FLOOR2 - 360, 3200, 360);
  }
}

function drawStatic(ctx, s) {
  const { x, y, w, h, id } = s;
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
    // a floor slab: concrete underside, carpet on top
    ctx.fillStyle = C.concreteDark;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = C.concrete;
    ctx.fillRect(x, y, w, 8);
    ctx.fillStyle = C.carpet;
    ctx.fillRect(x, y, w, 7);
    ctx.fillStyle = C.carpetB;
    for (let i = x - (x % 60); i < x + w; i += 60) ctx.fillRect(i, y, 30, 7);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(x, y + h - 5, w, 5);
  } else {
    // a wall: plaster with a shaded return, so a gap in it reads as a doorway
    ctx.fillStyle = C.plaster;
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

function propArt(ctx, b, kind) {
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
    case 'debris':
      ctx.fillStyle = C.concrete;
      ctx.beginPath();
      ctx.moveTo(x, y + H * 0.3); ctx.lineTo(x + W * 0.4, y);
      ctx.lineTo(x + W, y + H * 0.2); ctx.lineTo(x + W * 0.8, y + H);
      ctx.lineTo(x + W * 0.1, y + H * 0.85); ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2; ctx.stroke();
      break;
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

  if (lights && !lights.on) {
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
