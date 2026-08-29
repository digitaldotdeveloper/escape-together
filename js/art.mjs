/* Drawing a character.
 *
 * The face and the clothes come from the generated artwork; the arms and legs
 * are drawn in code from colours sampled out of that same artwork. That split
 * is deliberate. A ragdoll's limbs move through angles no illustration can
 * cover, but nobody looks at an elbow - they look at the face, and the face is
 * a painting that survives being thrown down a stairwell.
 */

import { asset } from './base.mjs';

const CACHE = new Map();

export const CAST = [
  { id: 'gary',   name: 'GARY',     tag: 'THE NERVOUS OFFICE WORKER', quip: '"I really don\'t think we should."' },
  { id: 'brick',  name: 'BRICK',    tag: 'THE OVERCONFIDENT ATHLETE', quip: '"I got this. I definitely got this."' },
  { id: 'dusty',  name: 'DUSTY',    tag: 'THE CHAOTIC BUILDER',       quip: '"That was load-bearing, probably."' },
  { id: 'pierre', name: 'PIERRE',   tag: 'THE RIDICULOUS CHEF',       quip: '"This is an OUTRAGE."' },
  { id: 'penny',  name: 'PENNY',    tag: 'THE UNLUCKY TOURIST',       quip: '"Ooh, is this part of the tour?"' },
  { id: 'volta',  name: 'DR VOLTA', tag: 'THE ECCENTRIC SCIENTIST',   quip: '"Fascinating! We are going to die!"' },
];

const loadImage = (src) =>
  new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  });

export async function loadChar(id) {
  if (CACHE.has(id)) return CACHE.get(id);
  const base = asset('char/' + id + '/');
  const p = (async () => {
    const [head, torso, palette] = await Promise.all([
      loadImage(base + 'head.webp'),
      loadImage(base + 'torso.webp'),
      fetch(base + 'palette.json').then((r) => r.json()).catch(() => ({})),
    ]);
    const hero = await loadImage(asset('hero/' + id + '.webp'));
    return { id, head, torso, hero, pal: palette };
  })();
  CACHE.set(id, p);
  return p;
}

export function preloadCast() {
  return Promise.all(CAST.map((c) => loadChar(c.id)));
}

/* ------------------------------------------------------------------ limbs */

function capsule(ctx, x1, y1, x2, y2, r, fill, edge) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.arc(x1, y1, r, a + Math.PI / 2, a - Math.PI / 2);
  ctx.arc(x2, y2, r, a - Math.PI / 2, a + Math.PI / 2);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (edge) {
    ctx.lineWidth = Math.max(1.2, r * 0.34);
    ctx.strokeStyle = edge;
    ctx.stroke();
  }
}

function endOf(body, sign) {
  // the far end of a limb bone, in world space
  const h = (body.bounds.max.y - body.bounds.min.y);
  const len = Math.max(h, 18) / 2;
  return {
    x: body.position.x + Math.sin(body.angle) * -len * sign,
    y: body.position.y + Math.cos(body.angle) * len * sign,
  };
}

function limb(ctx, upper, lower, pal, r, colUpper, colLower, footCol) {
  const hip = endOf(upper, -1);
  const knee = endOf(upper, 1);
  const toe = endOf(lower, 1);
  capsule(ctx, hip.x, hip.y, knee.x, knee.y, r, colUpper, pal.edge);
  capsule(ctx, knee.x, knee.y, toe.x, toe.y, r * 0.92, colLower, pal.edge);
  if (footCol) {
    ctx.save();
    ctx.translate(toe.x, toe.y);
    ctx.rotate(lower.angle);
    ctx.beginPath();
    ctx.ellipse(r * 0.5, r * 0.15, r * 1.5, r * 0.85, 0, 0, Math.PI * 2);
    ctx.fillStyle = footCol;
    ctx.fill();
    ctx.restore();
  }
}

function sprite(ctx, img, body, scale, dx = 0, dy = 0) {
  if (!img) return;
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.save();
  ctx.translate(body.position.x, body.position.y);
  ctx.rotate(body.angle);
  ctx.drawImage(img, -w / 2 + dx, -h / 2 + dy, w, h);
  ctx.restore();
}

/* -------------------------------------------------------------- the whole */

export function drawCharacter(ctx, rd, art, opts = {}) {
  const p = rd.parts;
  const pal = art.pal || {};
  const edge = 'rgba(42,22,16,0.55)';
  const P = {
    edge,
    skin: pal.skin || '#d9a97f', skinDark: pal.skinDark || '#b98a63',
    sleeve: pal.sleeve || '#dfe4ea', sleeveDark: pal.sleeveDark || '#b9c0c8',
    hand: pal.hand || pal.skin || '#d9a97f',
    trouser: pal.trouser || '#3b4450', trouserDark: pal.trouserDark || '#2b323b',
    shoe: pal.shoe || '#4a3222', shoeDark: pal.shoeDark || '#33210f',
  };
  const flip = rd.facing < 0;

  // contact shadow, so nobody floats
  const feet = Math.max(p.shinB.position.y, p.shinF.position.y);
  const t = p.torso.position;
  ctx.save();
  ctx.globalAlpha = 0.20;
  ctx.beginPath();
  ctx.ellipse(t.x, feet + 16, 30, 7, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();

  // Far side first, then torso, then near side: three planes is all the depth
  // a side view needs, and it is what stops the arms reading as spaghetti.
  limb(ctx, p.thighB, p.shinB, P, 7.8, P.trouserDark, P.trouserDark, P.shoeDark || P.shoe);
  limb(ctx, p.uarmB, p.farmB, P, 6.2, P.sleeveDark, P.skinDark, null);

  const torsoScale = (40 / (art.torso ? art.torso.width : 40)) * 1.18;
  if (art.torso) sprite(ctx, art.torso, p.torso, torsoScale, 0, 2);
  else {
    ctx.save();
    ctx.translate(t.x, t.y); ctx.rotate(p.torso.angle);
    ctx.fillStyle = P.sleeve;
    ctx.beginPath(); ctx.roundRect(-14, -20, 28, 40, 9); ctx.fill();
    ctx.restore();
  }

  limb(ctx, p.thighF, p.shinF, P, 8.4, P.trouser, P.trouser, P.shoe);
  limb(ctx, p.uarmF, p.farmF, P, 6.8, P.sleeve, P.skin, null);

  // hands last: they are what the player is aiming, so they must be visible
  for (const side of ['B', 'F']) {
    const hand = endOf(p['farm' + side], 1);
    const holding = rd.grabs && rd.grabs[side];
    ctx.beginPath();
    ctx.arc(hand.x, hand.y, holding ? 7.4 : 6.6, 0, Math.PI * 2);
    ctx.fillStyle = side === 'F' ? P.hand : P.skinDark;
    ctx.fill();
    if (holding) {
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(255,225,140,0.95)';
      ctx.stroke();
    }
  }

  const headScale = (34 / (art.head ? art.head.width : 34)) * (opts.headScale || 1.5);
  if (art.head) {
    ctx.save();
    ctx.translate(p.head.position.x, p.head.position.y);
    ctx.rotate(p.head.angle);
    if (flip) ctx.scale(-1, 1);
    const w = art.head.width * headScale, h = art.head.height * headScale;
    ctx.drawImage(art.head, -w / 2, -h * 0.52, w, h);
    ctx.restore();
  } else {
    ctx.beginPath();
    ctx.arc(p.head.position.x, p.head.position.y, 14, 0, Math.PI * 2);
    ctx.fillStyle = P.skin; ctx.fill();
  }

  // the little state tells: stunned stars, a brace stance, a hard landing
  if (rd.stun > 0) {
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.font = 'bold 15px system-ui';
    ctx.fillStyle = '#ffd85e';
    const n = 3;
    for (let i = 0; i < n; i++) {
      const a = (Date.now() / 240) + (i * Math.PI * 2) / n;
      ctx.fillText('*', p.head.position.x + Math.cos(a) * 20 - 4,
        p.head.position.y - 22 + Math.sin(a) * 7);
    }
    ctx.restore();
  }
}

/** The banner portrait used by menus - the full generated render. */
export function drawHero(ctx, art, x, y, h) {
  if (!art.hero) return;
  const s = h / art.hero.height;
  ctx.drawImage(art.hero, x - (art.hero.width * s) / 2, y - h, art.hero.width * s, h);
}
