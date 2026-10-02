// Blocky character and prop models built from boxes. Front of every model faces +Z.
import * as THREE from 'three';
import { photos, canvasTexture, hairTexture, solid16, tileUV, iconCanvas, atlas } from './textures.js';
import { BLOCKS, isOpaque } from './blocks.js';
import { isBlockItem } from './items.js';

const PX = 1 / 16;
const lam = (opts) => new THREE.MeshLambertMaterial(opts);
const texMat = (canvas, extra = {}) => lam({ map: canvasTexture(canvas), ...extra });
const colMat = (hex) => lam({ color: hex });
const rgbHex = (rgb) => (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];

function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function pix(w, h, draw) { const c = mk(w, h); const ctx = c.getContext('2d'); draw(ctx); return c; }

// Box whose pivot sits at the top-centre (for limbs) or bottom-centre (for bodies).
function box(w, h, d, mats, pivot = 'center') {
  const g = new THREE.BoxGeometry(w, h, d);
  if (pivot === 'top') g.translate(0, -h / 2, 0);
  if (pivot === 'bottom') g.translate(0, h / 2, 0);
  const m = new THREE.Mesh(g, mats);
  m.castShadow = false;
  return m;
}
// six-face material array from a front canvas and a shared side material
const faces = (front, side, top = side, bottom = side, back = side) => [side, side, top, bottom, front, back];

// ---------------- shared textures (built lazily after photos load) ----------------
let T = null;
function shared() {
  if (T) return T;
  const skin = [189, 139, 114];
  T = {
    villSkin: colMat(rgbHex(skin)),
    villSkinTex: texMat(solid16(skin, 5)),
    royFace: texMat(photos.royFace),
    roySkin: texMat(solid16(photos.roySkin, 4)),
    royShirt: texMat(solid16(photos.royShirt, 10)),
    royHairBack: texMat(pix(16, 16, (c) => { c.fillStyle = `rgb(${photos.roySkin})`; c.fillRect(0, 0, 16, 16); c.fillStyle = '#7d756c'; c.fillRect(0, 8, 16, 5); })),
    royTop: texMat(pix(16, 16, (c) => { c.fillStyle = `rgb(${photos.roySkin.map((v) => Math.min(255, v + 18))})`; c.fillRect(0, 0, 16, 16); c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(5, 4, 4, 3); })),
    jeans: texMat(solid16([52, 70, 118], 8)),
    suitFace: texMat(photos.suitFace),
    suitHair: texMat(hairTexture(photos.suitHair)),
    suitBeard: texMat(solid16(photos.suitBeard, 10)),
    suitCloth: texMat(solid16([36, 52, 132], 6)),
    suitFront: texMat(pix(16, 24, (c) => {
      c.fillStyle = '#243484'; c.fillRect(0, 0, 16, 24);
      c.fillStyle = '#9dbbe8'; c.beginPath(); c.moveTo(4, 0); c.lineTo(12, 0); c.lineTo(8, 12); c.closePath(); c.fill();
      c.fillStyle = '#e8318a'; c.fillRect(7, 1, 2, 2); c.beginPath(); c.moveTo(7, 3); c.lineTo(9, 3); c.lineTo(10, 13); c.lineTo(8, 15); c.lineTo(6, 13); c.closePath(); c.fill();
      c.fillStyle = '#1a2668'; c.fillRect(3, 0, 1, 14); c.fillRect(12, 0, 1, 14);
      c.fillStyle = '#d9d9d9'; c.fillRect(8, 16, 1, 1); c.fillRect(8, 19, 1, 1);
    })),
    shoe: colMat(0x15151a),
    beak: colMat(0xf0a020),
    wattle: colMat(0xd02020),
    white: texMat(solid16([236, 236, 230], 8)),
    paddleEdge: colMat(0x9ad13b),
    paddleHandle: colMat(0x3a2a1a),
  };
  return T;
}

// ---------------- villagers ----------------
const OUTFITS = {
  farmer: { robe: [107, 74, 43], trim: [70, 120, 40], hat: 0xd9b84a },
  librarian: { robe: [216, 216, 216], trim: [160, 40, 40] },
  pro: { robe: [245, 211, 34], trim: [30, 30, 30], number: '11', band: 0xffffff },
  referee: { robe: [240, 240, 240], stripes: true },
  fan: { robe: [58, 110, 190], trim: [245, 211, 34] },
  plain: { robe: [96, 140, 60], trim: [70, 50, 30] },
  priest: { robe: [120, 50, 140], trim: [240, 200, 60] },
};

function villagerHeadCanvas(eyeColor = '#2c8a2c') {
  return pix(8, 10, (c) => {
    c.fillStyle = '#bd8b72'; c.fillRect(0, 0, 8, 10);
    c.fillStyle = '#a87660'; c.fillRect(0, 0, 8, 1);
    c.fillStyle = '#3a2418'; c.fillRect(1, 3, 6, 1);           // unibrow
    c.fillStyle = '#fff'; c.fillRect(1, 4, 1, 1); c.fillRect(6, 4, 1, 1);
    c.fillStyle = eyeColor; c.fillRect(2, 4, 1, 1); c.fillRect(5, 4, 1, 1);
    c.fillStyle = '#8c5a46'; c.fillRect(3, 8, 2, 1);           // mouth
  });
}
function robeCanvas(o, w, h, front) {
  return pix(w, h, (c) => {
    c.fillStyle = `rgb(${o.robe})`; c.fillRect(0, 0, w, h);
    if (o.stripes) { c.fillStyle = '#111'; for (let x = 0; x < w; x += 2) c.fillRect(x, 0, 1, h); }
    if (o.trim) { c.fillStyle = `rgb(${o.trim})`; c.fillRect(0, h - 2, w, 2); if (front) c.fillRect(Math.floor(w / 2) - 1, 0, 2, h); }
    if (o.number && front) { c.fillStyle = '#111'; c.font = 'bold 5px monospace'; c.textAlign = 'center'; c.fillText(o.number, w / 2, 7); }
  });
}

/**
 * Minecraft-style villager. mode 'crossed' (arms folded) or 'player' (free arms, for pickleball).
 */
export function makeVillager({ outfit = 'plain', mode = 'crossed', eye } = {}) {
  const S = shared();
  const o = OUTFITS[outfit] || OUTFITS.plain;
  const scale = 0.92;
  const root = new THREE.Group();
  const model = new THREE.Group();
  model.scale.setScalar(scale);
  root.add(model);
  const robeSide = texMat(robeCanvas(o, 6, 12, false));
  const robeFront = texMat(robeCanvas(o, 8, 12, true));
  const robeBack = texMat(robeCanvas(o, 8, 12, false));
  const legMat = texMat(robeCanvas({ robe: o.robe.map((v) => v * 0.75) }, 4, 12, false));

  const legL = box(4 * PX, 12 * PX, 4 * PX, legMat, 'top'); legL.position.set(-2 * PX, 12 * PX, 0);
  const legR = box(4 * PX, 12 * PX, 4 * PX, legMat, 'top'); legR.position.set(2 * PX, 12 * PX, 0);
  const body = box(8 * PX, 12 * PX, 6 * PX, faces(robeFront, robeSide, robeSide, robeSide, robeBack), 'bottom'); body.position.y = 12 * PX;
  const headPivot = new THREE.Group(); headPivot.position.y = 24 * PX;
  const head = box(8 * PX, 10 * PX, 8 * PX, faces(texMat(villagerHeadCanvas(eye)), S.villSkinTex), 'bottom');
  const nose = box(2 * PX, 4 * PX, 2 * PX, S.villSkin); nose.position.set(0, 3 * PX, 5 * PX);
  headPivot.add(head, nose);
  model.add(legL, legR, body, headPivot);
  if (o.hat) { const hat = box(12 * PX, 1 * PX, 12 * PX, colMat(o.hat), 'bottom'); hat.position.y = 10 * PX; const top = box(8 * PX, 3 * PX, 8 * PX, colMat(o.hat), 'bottom'); top.position.y = 11 * PX; headPivot.add(hat, top); }
  if (o.band) { const band = box(8.6 * PX, 1.5 * PX, 8.6 * PX, colMat(o.band), 'bottom'); band.position.y = 7 * PX; headPivot.add(band); }

  const parts = { root, model, legL, legR, body, head: headPivot };
  if (mode === 'crossed') {
    const arms = box(8 * PX, 4 * PX, 4 * PX, robeSide); arms.position.set(0, 19 * PX, 4 * PX); arms.rotation.x = -0.6;
    const hands = box(4 * PX, 4 * PX, 4 * PX, S.villSkin); hands.position.set(0, 18 * PX, 5.5 * PX); hands.rotation.x = -0.6;
    model.add(arms, hands);
    parts.arms = arms;
  } else {
    const armL = box(4 * PX, 12 * PX, 4 * PX, robeSide, 'top'); armL.position.set(-6 * PX, 23 * PX, 0);
    const armR = box(4 * PX, 12 * PX, 4 * PX, robeSide, 'top'); armR.position.set(6 * PX, 23 * PX, 0);
    model.add(armL, armR);
    parts.armL = armL; parts.armR = armR;
  }
  return parts;
}

// ---------------- creeper-man (suit, four legs, the face from photo 2) ----------------
export function makeCreeperMan() {
  const S = shared();
  const root = new THREE.Group(), model = new THREE.Group();
  root.add(model);
  const legs = [];
  for (const [x, z] of [[-2, 2], [2, 2], [-2, -2], [2, -2]]) {
    const l = new THREE.Group(); l.position.set(x * PX, 6 * PX, z * PX * 1.5);
    const leg = box(4 * PX, 5 * PX, 4 * PX, S.suitCloth, 'top');
    const shoe = box(4.4 * PX, 1.4 * PX, 5 * PX, S.shoe, 'top'); shoe.position.set(0, -4.8 * PX, 0.4 * PX);
    l.add(leg, shoe); model.add(l); legs.push(l);
  }
  const body = box(8 * PX, 13 * PX, 5 * PX, faces(S.suitFront, S.suitCloth), 'bottom'); body.position.y = 6 * PX;
  const headPivot = new THREE.Group(); headPivot.position.y = 19 * PX;
  const head = box(10 * PX, 10 * PX, 10 * PX, faces(S.suitFace, S.suitHair, S.suitHair, S.suitBeard, S.suitHair), 'bottom');
  headPivot.add(head);
  model.add(body, headPivot);
  // white flash overlay used while the fuse burns
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
  const flash = box(10.6 * PX, 10.6 * PX, 10.6 * PX, flashMat, 'bottom'); flash.position.y = -0.3 * PX; headPivot.add(flash);
  const flashBody = box(8.6 * PX, 13.6 * PX, 5.6 * PX, flashMat, 'bottom'); flashBody.position.y = 5.7 * PX; model.add(flashBody);
  return { root, model, legs, body, head: headPivot, flashMat };
}

// ---------------- Roy (player skin + statue) ----------------
export function makeRoy({ gold = false } = {}) {
  const S = shared();
  const root = new THREE.Group(), model = new THREE.Group();
  root.add(model);
  const m = (mat) => (gold ? Object.assign(mat.clone(), { color: new THREE.Color(0xffd76a) }) : mat); // gold statue tint
  const shirtFront = texMat(pix(16, 24, (c) => {
    c.fillStyle = `rgb(${photos.royShirt})`; c.fillRect(0, 0, 16, 24);
    c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(5, 0, 6, 2);
    c.fillStyle = '#c8202f'; c.font = 'bold 4px monospace'; c.textAlign = 'center'; c.fillText('PICKLE', 8, 10); c.fillText('CRAFT', 8, 14);
  }));
  const legL = box(4 * PX, 12 * PX, 4 * PX, m(S.jeans), 'top'); legL.position.set(-2 * PX, 12 * PX, 0);
  const legR = box(4 * PX, 12 * PX, 4 * PX, m(S.jeans), 'top'); legR.position.set(2 * PX, 12 * PX, 0);
  const body = box(8 * PX, 12 * PX, 4 * PX, faces(m(shirtFront), m(S.royShirt)), 'bottom'); body.position.y = 12 * PX;
  const armMat = m(S.roySkin);
  const armL = new THREE.Group(); armL.position.set(-6 * PX, 24 * PX, 0);
  const armR = new THREE.Group(); armR.position.set(6 * PX, 24 * PX, 0);
  for (const a of [armL, armR]) {
    a.add(box(4 * PX, 12 * PX, 4 * PX, armMat, 'top'));
    const sleeve = box(4.4 * PX, 4 * PX, 4.4 * PX, m(S.royShirt), 'top'); a.add(sleeve);
  }
  const headPivot = new THREE.Group(); headPivot.position.y = 24 * PX;
  const head = box(8 * PX, 8 * PX, 8 * PX, faces(m(S.royFace), m(S.royHairBack), m(S.royTop), m(S.roySkin), m(S.royHairBack)), 'bottom');
  headPivot.add(head);
  model.add(legL, legR, body, armL, armR, headPivot);
  return { root, model, legL, legR, body, armL, armR, head: headPivot };
}

// ---------------- chicken with Roy's face ----------------
export function makeChickenRoy() {
  const S = shared();
  const root = new THREE.Group(), model = new THREE.Group();
  root.add(model);
  const body = box(6 * PX, 6 * PX, 8 * PX, S.white, 'bottom'); body.position.y = 5 * PX;
  const wingL = box(1 * PX, 4 * PX, 6 * PX, S.white, 'top'); wingL.position.set(-3.5 * PX, 10 * PX, 0);
  const wingR = box(1 * PX, 4 * PX, 6 * PX, S.white, 'top'); wingR.position.set(3.5 * PX, 10 * PX, 0);
  const headPivot = new THREE.Group(); headPivot.position.set(0, 9 * PX, 4 * PX);
  const head = box(5 * PX, 6 * PX, 4 * PX, faces(S.royFace, S.roySkin, S.royTop), 'bottom');
  const beak = box(3 * PX, 1.5 * PX, 2 * PX, S.beak); beak.position.set(0, -0.2 * PX, 2.5 * PX);
  const wattle = box(1.5 * PX, 2 * PX, 1 * PX, S.wattle); wattle.position.set(0, -1.6 * PX, 2.2 * PX);
  headPivot.add(head, beak, wattle);
  const legs = [];
  for (const x of [-1.5, 1.5]) { const l = box(1 * PX, 5 * PX, 1 * PX, S.beak, 'top'); l.position.set(x * PX, 5 * PX, 0); model.add(l); legs.push(l); }
  model.add(body, wingL, wingR, headPivot);
  return { root, model, legL: legs[0], legR: legs[1], wingL, wingR, head: headPivot };
}

// ---------------- props ----------------
let paddleFaceMat = null;
export function makePaddle() {
  const S = shared();
  if (!paddleFaceMat) {
    const c = pix(64, 80, (ctx) => {
      ctx.fillStyle = '#9ad13b'; ctx.beginPath(); ctx.roundRect(0, 0, 64, 80, 22); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.roundRect(4, 4, 56, 72, 18); ctx.clip(); ctx.drawImage(photos.royHead, 4, 4, 56, 72); ctx.restore();
    });
    paddleFaceMat = new THREE.MeshLambertMaterial({ map: canvasTexture(c, false), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
  }
  const g = new THREE.Group();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.25), paddleFaceMat);
  face.position.y = 0.2;
  const handle = box(0.035, 0.13, 0.03, S.paddleHandle); handle.position.y = 0.025;
  g.add(face, handle);
  return g;
}

let ballMat = null;
export function makeBall(radius = 0.13) {
  if (!ballMat) {
    const c = pix(256, 128, (ctx) => {
      ctx.fillStyle = '#f2e62a'; ctx.fillRect(0, 0, 256, 128);
      ctx.fillStyle = '#c9b81a';
      for (let i = 0; i < 26; i++) { const x = (i * 53) % 256, y = 14 + ((i * 37) % 100); ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); }
      ctx.drawImage(photos.royHead, 96, 18, 64, 88);
    });
    ballMat = new THREE.MeshLambertMaterial({ map: canvasTexture(c, false), emissive: 0x222200 });
  }
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), ballMat);
}

// Small floating version of an item (used for drops and the first-person hand).
const dropGeoCache = new Map();
export function makeItemMesh(id, size = 0.25) {
  if (isBlockItem(id)) {
    const b = BLOCKS[id];
    if (!b.cross) {
      let g = dropGeoCache.get(id);
      if (!g) {
        g = new THREE.BoxGeometry(1, 1, 1);
        const uv = g.attributes.uv;
        for (let f = 0; f < 6; f++) {
          const [u0, v0, u1, v1] = tileUV(b.faces[f]);
          for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0); }
        }
        dropGeoCache.set(id, g);
      }
      const mat = new THREE.MeshLambertMaterial({ map: atlas.texture, alphaTest: 0.5, transparent: !isOpaque(id) && b.pass === 'water' });
      const m = new THREE.Mesh(g, mat);
      m.scale.setScalar(size);
      return m;
    }
  }
  const tex = canvasTexture(iconCanvas(id), false);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size * 1.5, size * 1.5), new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }));
  return m;
}

// A picture on a frame (paintings, posters, Roy signs held by fans).
export function makePicture(canvas, w, h, { frame = 0x6b4f2a, border = 0.08 } = {}) {
  const g = new THREE.Group();
  const back = new THREE.Mesh(new THREE.BoxGeometry(w + border * 2, h + border * 2, 0.06), colMat(frame));
  back.position.z = -0.035;
  // alphaTest lets cut-out photos (transparent around the head) show the frame behind them
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: canvasTexture(canvas, false), alphaTest: 0.5 }));
  pic.position.z = 0.004;
  g.add(back, pic);
  return g;
}
