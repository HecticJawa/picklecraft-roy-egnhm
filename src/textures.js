// Procedural pixel-art textures, the block atlas, item icons, and everything derived from the two photos.
import * as THREE from 'three';
import { TILE_NAMES, TILE, ATLAS_COLS, WOOL_COLORS, CLAY_COLORS, BLOCKS } from './blocks.js';
import { ITEMS, isBlockItem } from './items.js';
import { mulberry32, clamp } from './util.js';

export const TILE_PX = 64;
export const ATLAS_ROWS = 8;

// Photo crop settings (pixel coordinates in the original images). Tune here if a crop looks off.
export const PHOTO = {
  roy: {
    src: 'assets/photos/roy.jpg',
    face: { x: 215, y: 150, s: 570 },             // square used on cube faces
    head: { cx: 494, cy: 420, rx: 232, ry: 314 },  // ellipse around the whole head (cutouts)
    skin: { x: 360, y: 440, w: 40, h: 40 },        // cheek sample
    beard: { x: 470, y: 640, w: 60, h: 40 },
    shirt: { x: 120, y: 1000, w: 120, h: 120 },
  },
  suit: {
    src: 'assets/photos/creeper-man.png',
    face: { x: 85, y: 62, s: 530 },
    hair: { x: 170, y: 210, w: 30, h: 40 },
    skin: { x: 260, y: 360, w: 30, h: 30 },
    beard: { x: 300, y: 500, w: 50, h: 40 },
  },
};

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const c255 = (v) => clamp(Math.round(v), 0, 255);
const shade = (rgb, f) => [c255(rgb[0] * f), c255(rgb[1] * f), c255(rgb[2] * f)];
const vary = (rgb, r, amt) => { const d = (r() - 0.5) * 2 * amt; return [c255(rgb[0] + d), c255(rgb[1] + d), c255(rgb[2] + d)]; };
export const rgbCss = (rgb, a = 1) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;

function paint16(seed, fn) {
  const c = mk(16, 16), ctx = c.getContext('2d');
  const img = ctx.createImageData(16, 16), r = mulberry32(seed * 7919 + 13);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const col = fn(x, y, r);
    const i = (y * 16 + x) * 4;
    if (!col) { img.data[i + 3] = 0; continue; }
    img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = col[3] ?? 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ---------- block tile painters (16x16 logical pixels) ----------
const DIRT = [134, 96, 67], STONE = [127, 127, 127], PLANK = [162, 130, 78], GRASS = [94, 157, 52];
function blobs(r, n, rad) { const pts = []; for (let i = 0; i < n; i++) pts.push([1 + r() * 14, 1 + r() * 14, rad * (0.7 + r() * 0.6)]); return pts; }
function inBlob(pts, x, y) { for (const [bx, by, br] of pts) { const d = Math.hypot(x + 0.5 - bx, y + 0.5 - by); if (d < br) return d / br; } return -1; }
function ore(seed, color) {
  const r0 = mulberry32(seed), pts = blobs(r0, 5, 1.6), oc = hexRgb(color);
  return paint16(seed, (x, y, r) => { const b = inBlob(pts, x, y); return b >= 0 ? shade(oc, 1.15 - b * 0.4) : vary(STONE, r, 14); });
}
function voronoi(seed, n) {
  const r = mulberry32(seed), pts = [];
  for (let i = 0; i < n; i++) pts.push([r() * 16, r() * 16, r()]);
  return (x, y) => {
    let d1 = 99, d2 = 99, id = 0;
    for (let ox = -16; ox <= 16; ox += 16) for (let oy = -16; oy <= 16; oy += 16) for (let i = 0; i < n; i++) {
      const d = Math.hypot(x + 0.5 - pts[i][0] - ox, y + 0.5 - pts[i][1] - oy);
      if (d < d1) { d2 = d1; d1 = d; id = i; } else if (d < d2) d2 = d;
    }
    return { edge: d2 - d1, v: pts[id][2] };
  };
}
function crossPlant(seed, draw) {
  const c = mk(16, 16), ctx = c.getContext('2d');
  draw(ctx, mulberry32(seed));
  return c;
}

const PAINT = {
  grass_top: (s) => paint16(s, (x, y, r) => (r() < 0.12 ? shade(GRASS, 0.82) : vary(GRASS, r, 16))),
  grass_side: (s) => { const r0 = mulberry32(s); const depth = Array.from({ length: 16 }, () => 2 + (r0() < 0.55 ? 1 : 0) + (r0() < 0.25 ? 1 : 0));
    return paint16(s, (x, y, r) => (y < depth[x] ? vary(GRASS, r, 14) : r() < 0.1 ? shade(DIRT, 0.8) : vary(DIRT, r, 12))); },
  dirt: (s) => paint16(s, (x, y, r) => { const v = r(); return v < 0.1 ? shade(DIRT, 0.78) : v > 0.93 ? shade(DIRT, 1.2) : vary(DIRT, r, 10); }),
  stone: (s) => paint16(s, (x, y, r) => (r() < 0.08 ? shade(STONE, 0.8) : vary(STONE, r, 12))),
  cobble: (s) => { const vo = voronoi(s, 9); return paint16(s, (x, y, r) => { const q = vo(x, y); return q.edge < 1.1 ? vary([82, 82, 82], r, 8) : vary(shade(STONE, 0.85 + q.v * 0.35), r, 8); }); },
  sand: (s) => paint16(s, (x, y, r) => vary([219, 206, 160], r, 10)),
  water: (s) => paint16(s, (x, y, r) => (((x + Math.floor(y * 1.6)) % 7 === 0) ? [86, 140, 230] : vary([44, 94, 205], r, 8))),
  log_side: (s) => { const r0 = mulberry32(s); const groove = Array.from({ length: 16 }, () => r0() < 0.3);
    return paint16(s, (x, y, r) => (groove[x] ? vary([72, 55, 33], r, 6) : vary([104, 82, 50], r, 10))); },
  log_top: (s) => paint16(s, (x, y, r) => { const d = Math.hypot(x - 7.5, y - 7.5); if (d > 6.9) return vary([104, 82, 50], r, 8); return Math.floor(d * 1.2) % 2 ? vary([182, 148, 92], r, 6) : vary([158, 125, 74], r, 6); }),
  leaves: (s) => paint16(s, (x, y, r) => { const v = r(); return v < 0.1 ? null : v < 0.3 ? [38, 88, 22] : vary([58, 122, 34], r, 16); }),
  planks: (s) => paint16(s, (x, y, r) => { const row = y >> 2; if ((y & 3) === 3) return vary([110, 86, 50], r, 6); if (x === ((row * 7 + 3) & 15)) return [118, 92, 54]; return vary(PLANK, r, 9); }),
  glass: (s) => paint16(s, (x, y) => { if (x === 0 || y === 0 || x === 15 || y === 15) return [210, 235, 245]; if ((x - y === 5 || x - y === 6) && x > 6 && x < 12) return [250, 252, 255, 210]; if (x - y === -6 && x > 2 && x < 6) return [250, 252, 255, 210]; return null; }),
  coal_ore: (s) => ore(s, '#222222'), iron_ore: (s) => ore(s, '#d8af93'), gold_ore: (s) => ore(s, '#fcee4b'),
  diamond_ore: (s) => ore(s, '#5decf5'), pickle_ore: (s) => ore(s, '#58b83a'),
  bedrock: (s) => paint16(s, (x, y, r) => { const g = [34, 64, 92, 120][Math.floor(r() * 4)]; return [g, g, g]; }),
  gravel: (s) => paint16(s, (x, y, r) => { const v = r(); return v < 0.3 ? vary([96, 92, 90], r, 10) : v < 0.6 ? vary([140, 132, 128], r, 10) : v < 0.8 ? vary([120, 104, 92], r, 10) : vary([170, 164, 160], r, 8); }),
  brick: (s) => paint16(s, (x, y, r) => { const row = y >> 2; if ((y & 3) === 3) return vary([180, 172, 165], r, 8); if (x === (row % 2 ? 3 : 11)) return vary([180, 172, 165], r, 8); return vary([150, 72, 56], r, 12); }),
  court_blue: (s) => paint16(s, (x, y, r) => vary([46, 96, 172], r, 4)),
  court_green: (s) => paint16(s, (x, y, r) => vary([62, 132, 86], r, 4)),
  pickle_block_side: (s) => paint16(s, (x, y, r) => { if (r() < 0.1) return [160, 206, 96]; if (x % 5 === 0) return vary([70, 112, 32], r, 6); return vary([96, 146, 46], r, 9); }),
  pickle_block_top: (s) => paint16(s, (x, y, r) => { const d = Math.hypot(x - 7.5, y - 7.5); if (d > 6.8) return vary([80, 128, 38], r, 6); if (Math.abs(d - 3.6) < 0.7 && r() < 0.6) return [236, 240, 196]; return vary([176, 212, 112], r, 7); }),
  pickle_lamp: (s) => paint16(s, (x, y, r) => { if (x === 0 || y === 0 || x === 15 || y === 15) return [52, 82, 30]; const d = Math.hypot((x - 7.5) * 1.8, y - 7.5); if (d < 5.2) return d < 4 ? vary([92, 168, 52], r, 10) : [60, 120, 36]; return vary([236, 255, 158], r, 10); }),
  bookshelf: (s) => { const r0 = mulberry32(s); const cols = ['#a12722', '#35399d', '#546d1b', '#f8c627', '#792aac', '#e9ecec', '#724728'];
    const spine = Array.from({ length: 32 }, () => hexRgb(cols[Math.floor(r0() * cols.length)]));
    return paint16(s, (x, y, r) => { if (y < 2 || y === 7 || y === 8 || y > 13) return vary(PLANK, r, 8); if (x === 0 || x === 15) return [92, 70, 40]; const sp = spine[x + (y > 8 ? 16 : 0)]; return (y === 2 || y === 9) && r() < 0.3 ? [40, 30, 20] : vary(sp, r, 10); }); },
  crafting_top: (s) => paint16(s, (x, y, r) => { if (x === 0 || y === 0 || x === 15 || y === 15) return [92, 70, 40]; if (x === 5 || x === 10 || y === 5 || y === 10) return [120, 92, 52]; return vary([182, 146, 92], r, 8); }),
  crafting_side: (s) => paint16(s, (x, y, r) => { if (y < 3) return vary([182, 146, 92], r, 8); if ((x === 3 || x === 4) && y > 5 && y < 13) return [80, 60, 36]; if (x > 1 && x < 7 && y > 4 && y < 7) return [140, 140, 140]; if (x > 9 && x < 14 && y > 5 && y < 12 && (x + y) % 2 === 0) return [150, 150, 150]; return vary(PLANK, r, 9); }),
  tall_grass: (s) => crossPlant(s, (ctx, r) => { for (let i = 0; i < 9; i++) { const x = 1 + Math.floor(r() * 14), h = 5 + Math.floor(r() * 10); const g = vary([80, 150, 46], r, 22); ctx.fillStyle = rgbCss(g); for (let k = 0; k < h; k++) ctx.fillRect(x + Math.round((k / h) * (r() < 0.5 ? -1 : 1)), 15 - k, 1, 1); } }),
  flower_red: (s) => crossPlant(s, (ctx) => { ctx.fillStyle = '#3f8a2a'; ctx.fillRect(7, 8, 1, 8); ctx.fillRect(5, 11, 2, 1); ctx.fillRect(8, 12, 2, 1); ctx.fillStyle = '#d21f1f'; ctx.fillRect(5, 4, 5, 4); ctx.fillRect(6, 3, 3, 6); ctx.fillStyle = '#2a1408'; ctx.fillRect(7, 5, 1, 2); }),
  flower_yellow: (s) => crossPlant(s, (ctx) => { ctx.fillStyle = '#3f8a2a'; ctx.fillRect(7, 9, 1, 7); ctx.fillRect(8, 12, 2, 1); ctx.fillStyle = '#f5d322'; ctx.fillRect(5, 5, 5, 4); ctx.fillRect(6, 4, 3, 6); ctx.fillStyle = '#f9ef7a'; ctx.fillRect(7, 6, 1, 2); }),
  pickle_plant: (s) => crossPlant(s, (ctx) => { ctx.fillStyle = '#3f8a2a'; ctx.fillRect(7, 2, 2, 14); ctx.fillRect(3, 6, 4, 2); ctx.fillRect(9, 9, 4, 2); ctx.fillStyle = '#4c7a1c'; ctx.fillRect(3, 9, 3, 6); ctx.fillRect(10, 3, 3, 6); ctx.fillStyle = '#8fc858'; ctx.fillRect(4, 10, 1, 1); ctx.fillRect(4, 13, 1, 1); ctx.fillRect(11, 4, 1, 1); ctx.fillRect(11, 7, 1, 1); }),
  suit: (s) => paint16(s, (x, y, r) => (x % 4 === 0 ? vary([66, 82, 158], r, 5) : vary([34, 50, 122], r, 6))),
  stone_brick: (s) => paint16(s, (x, y, r) => { if (y === 7 || y === 15) return vary([86, 86, 86], r, 6); if (x === (y < 8 ? 0 : 8)) return vary([86, 86, 86], r, 6); return vary([126, 126, 126], r, 9); }),
  hay_side: (s) => paint16(s, (x, y, r) => { if (y === 3 || y === 4 || y === 11 || y === 12) return vary([150, 40, 30], r, 10); return x % 3 === 0 ? vary([168, 140, 30], r, 10) : vary([206, 176, 52], r, 12); }),
  hay_top: (s) => paint16(s, (x, y, r) => (Math.floor(Math.hypot(x - 7.5, y - 7.5)) % 2 ? vary([214, 186, 64], r, 10) : vary([176, 148, 36], r, 10))),
  snow: (s) => paint16(s, (x, y, r) => vary([240, 246, 250], r, 5)),
};
for (const [c, hex] of Object.entries(WOOL_COLORS)) PAINT['wool_' + c] = (s) => paint16(s, (x, y, r) => vary(shade(hexRgb(hex), (x + y) % 2 ? 1.0 : 0.94), r, 7));
for (const [c, hex] of Object.entries(CLAY_COLORS)) PAINT['clay_' + c] = (s) => paint16(s, (x, y, r) => vary(hexRgb(hex), r, 5));

// ---------- photos ----------
function loadImage(src) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Could not load ' + src)); im.src = src; });
}
function avgColor(img, rect) {
  const c = mk(rect.w, rect.h), ctx = c.getContext('2d');
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  const d = ctx.getImageData(0, 0, rect.w, rect.h).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}
// Studio background is ~(1,0,244); the suit is ~(10,18,145), so key on brightness of blue too.
const isBlueBg = (r, g, b) => b > 175 && b - Math.max(r, g) > 110;

export const photos = {}; // filled by loadPhotos()

export async function loadPhotos() {
  const [royImg, suitImg] = await Promise.all([loadImage(PHOTO.roy.src), loadImage(PHOTO.suit.src)]);
  const R = PHOTO.roy, S = PHOTO.suit;
  photos.royImg = royImg; photos.suitImg = suitImg;
  photos.roySkin = avgColor(royImg, R.skin);
  photos.royBeard = avgColor(royImg, R.beard);
  photos.royShirt = avgColor(royImg, R.shirt);
  photos.suitHair = avgColor(suitImg, S.hair);
  photos.suitSkin = avgColor(suitImg, S.skin);
  photos.suitBeard = avgColor(suitImg, S.beard);

  // Roy face square: outside the head ellipse fades to skin (top) / beard (bottom) so it sits on a cube head.
  {
    const N = 256, c = mk(N, N), ctx = c.getContext('2d');
    ctx.drawImage(royImg, R.face.x, R.face.y, R.face.s, R.face.s, 0, 0, N, N);
    const id = ctx.getImageData(0, 0, N, N), d = id.data, h = R.head;
    for (let v = 0; v < N; v++) for (let u = 0; u < N; u++) {
      const px = R.face.x + (u + 0.5) * R.face.s / N, py = R.face.y + (v + 0.5) * R.face.s / N;
      const e = ((px - h.cx) / h.rx) ** 2 + ((py - h.cy) / h.ry) ** 2;
      if (e <= 0.92) continue;
      const t = clamp((e - 0.92) / 0.2, 0, 1);
      const fill = py > h.cy + h.ry * 0.45 ? photos.royBeard : photos.roySkin;
      const i = (v * N + u) * 4;
      for (let k = 0; k < 3; k++) d[i + k] = d[i + k] * (1 - t) + fill[k] * t;
    }
    ctx.putImageData(id, 0, 0);
    photos.royFace = c;
  }
  // Roy head cutout (transparent outside ellipse) for the sun, moon, sprites and UI.
  {
    const h = R.head, W = 256, H = Math.round(256 * h.ry / h.rx), c = mk(W, H), ctx = c.getContext('2d');
    ctx.drawImage(royImg, h.cx - h.rx, h.cy - h.ry, h.rx * 2, h.ry * 2, 0, 0, W, H);
    const id = ctx.getImageData(0, 0, W, H), d = id.data;
    for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
      const e = ((u + 0.5 - W / 2) / (W / 2)) ** 2 + ((v + 0.5 - H / 2) / (H / 2)) ** 2;
      const a = clamp((1 - e) / 0.06, 0, 1);
      d[(v * W + u) * 4 + 3] *= a;
    }
    ctx.putImageData(id, 0, 0);
    photos.royHead = c;
  }
  // Suit-man face square for the creeper head: blue studio background becomes hair.
  {
    const N = 256, c = mk(N, N), ctx = c.getContext('2d');
    ctx.drawImage(suitImg, S.face.x, S.face.y, S.face.s, S.face.s, 0, 0, N, N);
    const id = ctx.getImageData(0, 0, N, N), d = id.data, hair = photos.suitHair;
    for (let i = 0; i < d.length; i += 4) {
      if (isBlueBg(d[i], d[i + 1], d[i + 2])) { const n = 0.8 + 0.4 * Math.random(); d[i] = hair[0] * n; d[i + 1] = hair[1] * n; d[i + 2] = hair[2] * n; }
    }
    ctx.putImageData(id, 0, 0);
    photos.suitFace = c;
  }
  // Suit-man full cutout (no background), for posters and the title screen.
  {
    const W = 352, H = 354, c = mk(W, H), ctx = c.getContext('2d');
    ctx.drawImage(suitImg, 0, 0, W, H);
    const id = ctx.getImageData(0, 0, W, H), d = id.data;
    for (let i = 0; i < d.length; i += 4) if (isBlueBg(d[i], d[i + 1], d[i + 2])) d[i + 3] = 0;
    // the dark TV bezel along the top edge
    for (let y = 0; y < 22; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (d[i] + d[i + 1] + d[i + 2] < 160) d[i + 3] = 0; }
    ctx.putImageData(id, 0, 0);
    photos.suitCutout = c;
  }
  photos.royHeadURL = photos.royHead.toDataURL();
  photos.suitCutoutURL = photos.suitCutout.toDataURL();
  return photos;
}

// Hair texture for the sides and back of the creeper-man's head.
export function hairTexture(rgb, seed = 5) {
  return paint16(seed, (x, y, r) => { const curl = Math.sin(x * 1.7 + y * 0.9 + r() * 2) > 0.3; return vary(shade(rgb, curl ? 1.15 : 0.8), r, 14); });
}
export function solid16(rgb, amt = 6, seed = 3) { return paint16(seed, (x, y, r) => vary(rgb, r, amt)); }

// ---------- atlas ----------
export let atlas = null;
export const tileCanvases = [];

export function buildAtlas() {
  const W = ATLAS_COLS * TILE_PX, H = ATLAS_ROWS * TILE_PX;
  const c = mk(W, H), ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  TILE_NAMES.forEach((name, i) => {
    let tc;
    if (name === 'roy') { tc = mk(TILE_PX, TILE_PX); const t = tc.getContext('2d'); t.imageSmoothingEnabled = true; t.drawImage(photos.royFace, 0, 0, TILE_PX, TILE_PX); }
    else tc = PAINT[name](i + 1);
    tileCanvases[i] = tc;
    ctx.drawImage(tc, (i % ATLAS_COLS) * TILE_PX, Math.floor(i / ATLAS_COLS) * TILE_PX, TILE_PX, TILE_PX);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  atlas = { canvas: c, texture: tex };
  return atlas;
}

const INSET = 0.002;
export function tileUV(tile) {
  const col = tile % ATLAS_COLS, row = Math.floor(tile / ATLAS_COLS);
  const u0 = col / ATLAS_COLS + INSET, u1 = (col + 1) / ATLAS_COLS - INSET;
  const v1 = 1 - row / ATLAS_ROWS - INSET * 2, v0 = 1 - (row + 1) / ATLAS_ROWS + INSET * 2;
  return [u0, v0, u1, v1];
}

export function canvasTexture(canvas, nearest = true) {
  const t = new THREE.CanvasTexture(canvas);
  if (nearest) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; }
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- crack overlay stages ----------
export function crackTextures() {
  const out = [];
  const r = mulberry32(99);
  const lines = [];
  for (let i = 0; i < 40; i++) { let x = 8, y = 8; const seg = []; const ang = r() * Math.PI * 2; for (let k = 0; k < 7; k++) { x += Math.cos(ang + (r() - 0.5) * 1.6) * 1.3; y += Math.sin(ang + (r() - 0.5) * 1.6) * 1.3; seg.push([Math.floor(x), Math.floor(y)]); } lines.push(seg); }
  for (let s = 0; s < 10; s++) {
    const c = mk(16, 16), ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    const n = Math.floor((s + 1) * 4);
    for (let i = 0; i < n; i++) for (const [x, y] of lines[i].slice(0, 3 + Math.floor(s / 2))) if (x >= 0 && x < 16 && y >= 0 && y < 16) ctx.fillRect(x, y, 1, 1);
    out.push(canvasTexture(c));
  }
  return out;
}

// ---------- item icons ----------
const PIX = {
  pick: ['.....HHHHH......', '...HHhhhhhHH....', '..Hh....SshH....', '.Hh....Ss..hH...', '.H....Ss....H...', '......Ss........', '.....Ss.........', '....Ss..........', '...Ss...........', '..Ss............', '.Ss.............', 'Ss..............'],
  axe: ['.......HHH......', '......HhhHH.....', '.....HhhhSH.....', '......HhSsH.....', '.......SsHH.....', '......Ss........', '.....Ss.........', '....Ss..........', '...Ss...........', '..Ss............', '.Ss.............', 'Ss..............'],
  shovel: ['..........HHH...', '.........HhhH...', '.........HhhH...', '........SHHH....', '.......Ss.......', '......Ss........', '.....Ss.........', '....Ss..........', '...Ss...........', '..Ss............', '.Ss.............', 'Ss..............'],
  sword: ['............KK..', '...........KhHK.', '..........KhHK..', '.........KhHK...', '........KhHK....', '.......KhHK.....', '..KK..KhHK......', '..KGK.hHK.......', '...KGGHK........', '....KGGK........', '...KSSKGK.......', '..KSSK.KGK......', '.KSSK...KK......', '.KKK............'],
  stick: ['................', '..........Ss....', '.........Ss.....', '........Ss......', '.......Ss.......', '......Ss........', '.....Ss.........', '....Ss..........', '...Ss...........', '..Ss............'],
  ingot: ['................', '................', '................', '................', '.....KKKKKKK....', '....KhhhhhhHK...', '...KhHHHHHHHK...', '..KhHHHHHHHK....', '..KKKKKKKKKK....'],
  coal: ['................', '................', '.....KKKK.......', '....KhHHKK......', '...KhHHHHHK.....', '...KHHHhHHHK....', '..KHHHHHHHHK....', '..KHHhHHHHK.....', '...KHHHHHK......', '....KKKKK.......'],
  diamond: ['................', '................', '.....KKKKKK.....', '....KhhHHHHK....', '...KhHHHHHHHK...', '..KKKKKKKKKKKK..', '...KHHHHHHHHK...', '....KHHHHHHK....', '.....KHHHHK.....', '......KHHK......', '.......KK.......'],
  pickle: ['.........KKK....', '........KhHHK...', '.......KhHhHK...', '......KhHHHK....', '.....KhHhHK.....', '....KhHHHK......', '...KhHhHK.......', '..KhHHHK........', '..KHhHK.........', '..KHHK..........', '...KK...........'],
  tie: ['......KKKK......', '......KhHK......', '.......KK.......', '......KhHK......', '......KhHK......', '.....KhHHHK.....', '.....KhHhHK.....', '.....KhHHHK.....', '.....KhHhHK.....', '......KHHK......', '.......KK.......'],
};
function drawPix(ctx, rows, pal, ox = 0, oy = 2) {
  rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const ch = row[x]; if (ch === '.' || !pal[ch]) continue; ctx.fillStyle = pal[ch]; ctx.fillRect(x + ox, y + oy, 1, 1); } });
}
const MAT = { WOOD: ['#8a6a3a', '#b38b4d'], STONE: ['#6d6d6d', '#9a9a9a'], IRON: ['#b8b8b8', '#ececec'], DIAMOND: ['#2fb8c4', '#8ff4fb'] };

function itemPixelIcon(it) {
  const c = mk(16, 16), ctx = c.getContext('2d');
  const stickPal = { S: '#6b4f2a', s: '#4a3418' };
  const toolPal = (m) => ({ H: m[0], h: m[1], ...stickPal });
  const k = it.key;
  if (k.endsWith('_PICK')) drawPix(ctx, PIX.pick, toolPal(MAT[k.split('_')[0]]));
  else if (k === 'WOOD_AXE') drawPix(ctx, PIX.axe, toolPal(MAT.STONE));
  else if (k === 'WOOD_SHOVEL') drawPix(ctx, PIX.shovel, toolPal(MAT.STONE));
  else if (k === 'WOOD_SWORD') drawPix(ctx, PIX.sword, { K: '#2a1e10', H: '#b38b4d', h: '#d9b070', G: '#6b4f2a', S: '#4a3418' });
  else if (k === 'DIAMOND_SWORD') drawPix(ctx, PIX.sword, { K: '#10353a', H: '#33c9d6', h: '#a5f7fc', G: '#6b4f2a', S: '#4a3418' });
  else if (k === 'ROY_SWORD') drawPix(ctx, PIX.sword, { K: '#5a1030', H: '#f06aa5', h: '#ffd1e6', G: '#f8c627', S: '#35399d' });
  else if (k === 'STICK') drawPix(ctx, PIX.stick, stickPal, 0, 3);
  else if (k === 'IRON') drawPix(ctx, PIX.ingot, { K: '#555', H: '#d8d8d8', h: '#fff' }, 0, 3);
  else if (k === 'GOLD') drawPix(ctx, PIX.ingot, { K: '#7a5a00', H: '#f5cf2c', h: '#fff2a0' }, 0, 3);
  else if (k === 'COAL') drawPix(ctx, PIX.coal, { K: '#000', H: '#262626', h: '#4a4a4a' }, 0, 3);
  else if (k === 'DIAMOND') drawPix(ctx, PIX.diamond, { K: '#0b4a50', H: '#4fe3ee', h: '#c6fbff' }, 0, 2);
  else if (k === 'PICKLE') drawPix(ctx, PIX.pickle, { K: '#1f3a0c', H: '#5c9a2a', h: '#a6d968' }, 1, 2);
  else if (k === 'PINK_TIE') drawPix(ctx, PIX.tie, { K: '#6a0f3a', H: '#ea3d8c', h: '#ff9cc8' }, 0, 2);
  return c;
}

export function paddleIcon(size = 64) {
  const c = mk(size, size), ctx = c.getContext('2d'), s = size / 64;
  ctx.save(); ctx.translate(32 * s, 32 * s); ctx.rotate(-Math.PI / 4);
  ctx.fillStyle = '#3a2a1a'; ctx.fillRect(-4 * s, 8 * s, 8 * s, 22 * s);
  ctx.fillStyle = '#9ad13b'; ctx.beginPath(); ctx.roundRect(-15 * s, -26 * s, 30 * s, 36 * s, 12 * s); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.roundRect(-13 * s, -24 * s, 26 * s, 32 * s, 10 * s); ctx.clip();
  ctx.drawImage(photos.royHead, -13 * s, -24 * s, 26 * s, 32 * s); ctx.restore();
  ctx.restore();
  return c;
}
function trophyIcon(size = 64) {
  const c = mk(size, size), ctx = c.getContext('2d'), s = size / 64;
  ctx.fillStyle = '#c89b12'; ctx.fillRect(18 * s, 50 * s, 28 * s, 8 * s); ctx.fillRect(28 * s, 38 * s, 8 * s, 12 * s);
  ctx.fillStyle = '#f5cf2c'; ctx.beginPath(); ctx.moveTo(12 * s, 6 * s); ctx.lineTo(52 * s, 6 * s); ctx.lineTo(44 * s, 38 * s); ctx.lineTo(20 * s, 38 * s); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#f5cf2c'; ctx.lineWidth = 4 * s; ctx.beginPath(); ctx.arc(12 * s, 18 * s, 7 * s, Math.PI * 0.5, Math.PI * 1.5); ctx.stroke(); ctx.beginPath(); ctx.arc(52 * s, 18 * s, 7 * s, -Math.PI * 0.5, Math.PI * 0.5); ctx.stroke();
  ctx.save(); ctx.globalAlpha = 0.85; ctx.filter = 'sepia(1) saturate(3) brightness(1.1)'; ctx.drawImage(photos.royHead, 22 * s, 8 * s, 20 * s, 26 * s); ctx.restore();
  return c;
}

function blockIcon(id, size = 64) {
  const b = BLOCKS[id], c = mk(size, size), ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const s = size / 64;
  if (b.cross) { ctx.drawImage(tileCanvases[b.faces[0]], 8 * s, 8 * s, 48 * s, 48 * s); return c; }
  const faces = [
    { tile: b.faces[2], O: [4, 18], U: [28, -14], V: [28, 14], dark: 0 },  // top
    { tile: b.faces[4], O: [4, 18], U: [28, 14], V: [0, 28], dark: 0.22 }, // left (+z)
    { tile: b.faces[0], O: [32, 32], U: [28, -14], V: [0, 28], dark: 0.4 }, // right (+x)
  ];
  for (const f of faces) {
    const tc = tileCanvases[f.tile], n = tc.width;
    ctx.setTransform(f.U[0] * s / n, f.U[1] * s / n, f.V[0] * s / n, f.V[1] * s / n, f.O[0] * s, f.O[1] * s);
    ctx.drawImage(tc, 0, 0);
    if (f.dark) { ctx.fillStyle = `rgba(0,0,0,${f.dark})`; ctx.fillRect(0, 0, n, n); }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return c;
}

const iconCache = new Map();
export function iconCanvas(id) {
  if (iconCache.has(id)) return iconCache.get(id);
  let c;
  if (isBlockItem(id)) c = blockIcon(id);
  else {
    const it = ITEMS[id];
    if (it.key === 'PADDLE') c = paddleIcon();
    else if (it.key === 'GOLDEN_ROY') c = trophyIcon();
    else { const p = itemPixelIcon(it); c = mk(64, 64); const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(p, 0, 0, 64, 64); }
  }
  iconCache.set(id, c);
  return c;
}
const urlCache = new Map();
export function iconURL(id) {
  if (!urlCache.has(id)) urlCache.set(id, iconCanvas(id).toDataURL());
  return urlCache.get(id);
}
export function itemPixelCanvas(id) { return isBlockItem(id) ? null : itemPixelIcon(ITEMS[id]); }

// ---------- misc textures ----------
export function cloudTexture() {
  const r = mulberry32(7), N = 64, c = mk(N, N), ctx = c.getContext('2d');
  const cells = new Uint8Array(N * N);
  for (let i = 0; i < 70; i++) { const cx = Math.floor(r() * N), cy = Math.floor(r() * N), w = 2 + Math.floor(r() * 7), h = 2 + Math.floor(r() * 5); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells[((cy + y) % N) * N + ((cx + x) % N)] = 1; }
  ctx.fillStyle = '#fff';
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (cells[y * N + x]) ctx.fillRect(x, y, 1, 1);
  const t = canvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function signCanvas(lines, { w = 256, h = 128, bg = '#b38b4d', fg = '#2a1a08', font = 'bold 22px monospace', border = '#6b4f2a' } = {}) {
  const c = mk(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.08)'; for (let y = 0; y < h; y += 8) ctx.fillRect(0, y, w, 2);
  ctx.strokeStyle = border; ctx.lineWidth = 8; ctx.strokeRect(4, 4, w - 8, h - 8);
  ctx.fillStyle = fg; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lh = h / (lines.length + 1);
  lines.forEach((l, i) => ctx.fillText(l, w / 2, lh * (i + 1)));
  return c;
}
