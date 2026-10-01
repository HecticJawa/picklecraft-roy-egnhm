// Voxel world: chunk storage, terrain generation, meshing, raycasting and block edits.
import * as THREE from 'three';
import { BLOCKS, B, AIR, isOpaque, isSolid, WOOL_COLORS, CLAY_COLORS } from './blocks.js';
import { Noise, hash2, hash3, clamp, lerp, smoothstep } from './util.js';
import { tileUV, photos, PHOTO } from './textures.js';

export const CS = 16;          // chunk size (x/z)
export const WH = 96;          // world height
export const SEA = 26;         // water fills up to this y (inclusive)
export const GROUND = 30;      // plaza grass level; walking surface is GROUND + 1
export const SEED = 20261001;

// Regions near spawn (world block coordinates).
export const PLAZA = { x0: -24, x1: 74, z0: -34, z1: 28 };      // flattened area: court + village
export const COURT_AREA = { x0: -6, x1: 5, z0: -10, z1: 9 };     // protected court blocks (inclusive)
export const COURT_COMPLEX = { x0: -9, x1: 11, z0: -14, z1: 17 }; // court, bleachers, chair, scoreboard: explosion-proof
export const FOREST = { x0: -110, x1: -27 };                     // the forest Big Suit lives in
export const ROYMORE = { x0: -16, w: 32, h: 42, z: -38, y0: GROUND + 3 };

const key = (cx, cz) => cx + ',' + cz;
const idx = (x, y, z) => x + z * CS + y * CS * CS;

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.blocks = new Uint8Array(CS * CS * WH);
    this.lightTop = new Int16Array(CS * CS).fill(-1); // highest light-blocking y per column
    this.meshes = null;
    this.dirty = true;
    this.generated = false;
  }
  get(x, y, z) { return this.blocks[idx(x, y, z)]; }
  set(x, y, z, id) { this.blocks[idx(x, y, z)] = id; }
  recomputeColumn(x, z) {
    let top = -1;
    for (let y = WH - 1; y >= 0; y--) { const id = this.blocks[idx(x, y, z)]; if (id && (BLOCKS[id].opaque || id === B.LEAVES)) { top = y; break; } }
    this.lightTop[x + z * CS] = top;
  }
}

export class World {
  constructor(scene, materials) {
    this.scene = scene;
    this.materials = materials;
    this.chunks = new Map();
    this.noise = new Noise(SEED);
    this.noise2 = new Noise(SEED + 17);
    this.caveNoise = new Noise(SEED + 33);
    this.edits = new Map();        // chunkKey -> Map(index -> id): player changes, saved
    this.structures = new Map();   // chunkKey -> Array([index, id]): hand-built places near spawn
    this.roymore = null;           // 2D array of block ids for the mountain face
    this.renderDist = 5;
    this.onBlockChanged = null;
  }

  // ---------- terrain shape ----------
  baseHeight(x, z) {
    const n = this.noise;
    const cont = n.fbm2(x * 0.007, z * 0.007, 4);
    const hills = n.fbm2(x * 0.03 + 50, z * 0.03, 3);
    const mtn = Math.max(0, this.noise2.fbm2(x * 0.0045, z * 0.0045, 3) - 0.1);
    let h = 29 + cont * 10 + hills * 3 + mtn * mtn * 120;
    // Flatten the plaza (court + village) with a soft rim.
    const dx = Math.max(PLAZA.x0 - x, 0, x - PLAZA.x1), dz = Math.max(PLAZA.z0 - z, 0, z - PLAZA.z1);
    const d = Math.hypot(dx, dz);
    h = lerp(GROUND, h, smoothstep(0, 16, d));
    // Mount Roymore: a massif with a sheer south cliff facing the court.
    if (z <= ROYMORE.z) {
      const mx = Math.max(0, Math.abs(x) - 26), mz = Math.max(0, -84 - z);
      const t = 1 - smoothstep(0, 18, Math.hypot(mx, mz));
      const top = GROUND + 50 + n.noise2(x * 0.08, z * 0.08) * 3;
      h = Math.max(h, lerp(h, top, t));
    }
    return clamp(Math.floor(h), 4, WH - 8);
  }
  inPlaza(x, z, pad = 0) { return x >= PLAZA.x0 - pad && x <= PLAZA.x1 + pad && z >= PLAZA.z0 - pad && z <= PLAZA.z1 + pad; }
  treeDensity(x, z) {
    if (this.inPlaza(x, z, 3)) return 0;
    if (z <= ROYMORE.z + 1 && Math.abs(x) < 30) return 0.003;
    if (x >= FOREST.x0 && x <= FOREST.x1 && z > -70 && z < 60) return 0.075; // the dark forest
    const f = this.noise2.noise2(x * 0.01 + 300, z * 0.01);
    return f > 0.35 ? 0.04 : 0.004;
  }

  // ---------- generation ----------
  generate(chunk) {
    const { cx, cz } = chunk, ox = cx * CS, oz = cz * CS;
    const heights = new Int16Array((CS + 4) * (CS + 4)); // with a 2-block margin for trees
    for (let z = -2; z < CS + 2; z++) for (let x = -2; x < CS + 2; x++) heights[(x + 2) + (z + 2) * (CS + 4)] = this.baseHeight(ox + x, oz + z);
    const H = (x, z) => heights[(x + 2) + (z + 2) * (CS + 4)];

    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const wx = ox + x, wz = oz + z, h = H(x, z);
      const beach = h <= SEA + 1 && !this.inPlaza(wx, wz);
      const snowy = h > 66;
      for (let y = 0; y <= Math.max(h, SEA); y++) {
        let id;
        if (y === 0) id = B.BEDROCK;
        else if (y < h - 3) id = B.STONE;
        else if (y < h) id = beach ? B.SAND : B.DIRT;
        else if (y === h) id = h < SEA ? (hash2(wx, wz, 5) < 0.3 ? B.GRAVEL : B.SAND) : beach ? B.SAND : snowy ? B.SNOW : B.GRASS;
        else id = B.WATER;
        if (id === B.STONE) {
          // caves (kept away from the surface and the plaza)
          if (y > 3 && y < h - 6 && !this.inPlaza(wx, wz, 4)) {
            const c = this.caveNoise.noise3(wx * 0.055, y * 0.09, wz * 0.055);
            if (c > 0.52) { id = AIR; chunk.set(x, y, z, id); continue; }
          }
          const r = hash3(wx, y, wz, 77);
          if (r < 0.0045 && y < 40) id = B.PICKLE_ORE;
          else if (r < 0.016) id = B.COAL_ORE;
          else if (r < 0.023 && y < 50) id = B.IRON_ORE;
          else if (r < 0.0255 && y < 28) id = B.GOLD_ORE;
          else if (r < 0.0268 && y < 16) id = B.DIAMOND_ORE;
        }
        chunk.set(x, y, z, id);
      }
      // ground cover
      if (h > SEA && !beach && !snowy && chunk.get(x, h, z) === B.GRASS && h + 1 < WH) {
        const r = hash2(wx, wz, 91);
        const nearCourt = wx > -14 && wx < 14 && wz > -16 && wz < 16;
        if (!nearCourt && !this.inPlaza(wx, wz, -2)) {
          if (r < 0.10) chunk.set(x, h + 1, z, B.TALL_GRASS);
          else if (r < 0.12) chunk.set(x, h + 1, z, B.FLOWER_RED);
          else if (r < 0.14) chunk.set(x, h + 1, z, B.FLOWER_YELLOW);
          else if (r < 0.145) chunk.set(x, h + 1, z, B.PICKLE_PLANT);
        } else if (!nearCourt && r < 0.03) chunk.set(x, h + 1, z, r < 0.015 ? B.FLOWER_YELLOW : B.FLOWER_RED);
      }
    }

    // trees (deterministic per column; may hang over chunk borders, so scan a margin)
    for (let z = -2; z < CS + 2; z++) for (let x = -2; x < CS + 2; x++) {
      const wx = ox + x, wz = oz + z, h = H(x, z);
      if (h <= SEA + 1 || h > 64) continue;
      const dens = this.treeDensity(wx, wz);
      if (dens <= 0 || hash2(wx, wz, 1234) >= dens) continue;
      // spacing: skip if a neighbour column also rolled a tree
      if (hash2(wx + 1, wz, 1234) < dens || hash2(wx, wz + 1, 1234) < dens) continue;
      const th = 4 + Math.floor(hash2(wx, wz, 55) * 3);
      const put = (lx, y, lz, id, soft) => {
        if (lx < 0 || lz < 0 || lx >= CS || lz >= CS || y < 0 || y >= WH) return;
        if (soft && chunk.get(lx, y, lz) !== AIR && chunk.get(lx, y, lz) !== B.TALL_GRASS) return;
        chunk.set(lx, y, lz, id);
      };
      for (let ly = th - 3; ly <= th + 1; ly++) {
        const rad = ly >= th ? 1 : 2;
        for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
          if (Math.abs(dx) === rad && Math.abs(dz) === rad && (ly >= th || hash3(wx + dx, ly, wz + dz, 9) < 0.5)) continue;
          put(x + dx, h + ly, z + dz, B.LEAVES, true);
        }
      }
      for (let ly = 1; ly <= th; ly++) put(x, h + ly, z, B.LOG, false);
      put(x, h, z, B.DIRT, false);
    }

    // Mount Roymore face
    if (this.roymore && ROYMORE.z >= oz && ROYMORE.z < oz + CS) {
      const lz = ROYMORE.z - oz;
      for (let i = 0; i < ROYMORE.w; i++) {
        const wx = ROYMORE.x0 + i;
        if (wx < ox || wx >= ox + CS) continue;
        for (let j = 0; j < ROYMORE.h; j++) {
          const id = this.roymore[j][i];
          const y = ROYMORE.y0 + (ROYMORE.h - 1 - j);
          chunk.set(wx - ox, y, lz, id);
          if (lz > 0) chunk.set(wx - ox, y, lz - 1, B.STONE);
        }
      }
    }

    // hand-built structures, then the player's saved edits
    const k = key(cx, cz);
    const st = this.structures.get(k);
    if (st) for (const [i, id] of st) chunk.blocks[i] = id;
    const ed = this.edits.get(k);
    if (ed) for (const [i, id] of ed) chunk.blocks[i] = id;

    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) chunk.recomputeColumn(x, z);
    chunk.generated = true;
  }

  // Paint the photo onto the mountain: each block takes the nearest palette colour.
  prepareRoymore() {
    const R = PHOTO.roy.head, img = photos.royImg;
    const W = ROYMORE.w, Hh = ROYMORE.h;
    const sx = R.cx - R.rx * 1.08, sy = R.cy - R.ry * 1.04, sw = R.rx * 2.16, sh = R.ry * 2.08;
    const c = document.createElement('canvas'); c.width = W; c.height = Hh;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, Hh);
    const d = ctx.getImageData(0, 0, W, Hh).data;
    const pal = [];
    const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
    for (const [c2, h] of Object.entries(WOOL_COLORS)) pal.push([B['WOOL_' + c2.toUpperCase()], hex(h)]);
    for (const [c2, h] of Object.entries(CLAY_COLORS)) pal.push([B['CLAY_' + c2.toUpperCase()], hex(h)]);
    pal.push([B.SAND, [219, 206, 160]], [B.SNOW, [240, 246, 250]], [B.STONE, [127, 127, 127]], [B.GRAVEL, [130, 122, 116]]);
    const dist = (a, b) => { const rm = (a[0] + b[0]) / 2; const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2]; return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db; };
    const out = [];
    for (let j = 0; j < Hh; j++) {
      const row = [];
      for (let i = 0; i < W; i++) {
        const e = ((i + 0.5 - W / 2) / (W / 2 / 1.08)) ** 2 + ((j + 0.5 - Hh / 2) / (Hh / 2 / 1.04)) ** 2;
        if (e > 1.0) { row.push(B.STONE); continue; }
        const p = (j * W + i) * 4, col = [d[p], d[p + 1], d[p + 2]];
        let best = B.STONE, bd = Infinity;
        for (const [id, rgb] of pal) { const dd = dist(col, rgb); if (dd < bd) { bd = dd; best = id; } }
        row.push(best);
      }
      out.push(row);
    }
    this.roymore = out;
  }

  // ---------- access ----------
  getChunk(cx, cz) { return this.chunks.get(key(cx, cz)); }
  getBlock(x, y, z) {
    if (y < 0 || y >= WH) return AIR;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const c = this.chunks.get(key(cx, cz));
    if (!c || !c.generated) return y < GROUND ? B.STONE : AIR;
    return c.blocks[idx(x - cx * CS, y, z - cz * CS)];
  }
  isLoaded(x, z) { const c = this.getChunk(Math.floor(x / CS), Math.floor(z / CS)); return !!(c && c.generated); }
  lightTopAt(x, z) {
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const c = this.chunks.get(key(cx, cz));
    if (!c) return -1;
    return c.lightTop[(x - cx * CS) + (z - cz * CS) * CS];
  }
  surfaceY(x, z) { // y of the highest solid block, or -1
    for (let y = WH - 1; y >= 0; y--) if (isSolid(this.getBlock(x, y, z))) return y;
    return -1;
  }

  setBlock(x, y, z, id, { record = true } = {}) {
    if (y < 0 || y >= WH) return false;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const c = this.chunks.get(key(cx, cz));
    if (!c || !c.generated) return false;
    const lx = x - cx * CS, lz = z - cz * CS, i = idx(lx, y, lz);
    const old = c.blocks[i];
    if (old === id) return false;
    c.blocks[i] = id;
    c.recomputeColumn(lx, lz);
    c.dirty = true;
    if (record) {
      const k = key(cx, cz);
      if (!this.edits.has(k)) this.edits.set(k, new Map());
      this.edits.get(k).set(i, id);
    }
    // neighbours share faces, AO and shading at the border
    const mark = (ccx, ccz) => { const n = this.chunks.get(key(ccx, ccz)); if (n) n.dirty = true; };
    if (lx === 0) mark(cx - 1, cz); if (lx === CS - 1) mark(cx + 1, cz);
    if (lz === 0) mark(cx, cz - 1); if (lz === CS - 1) mark(cx, cz + 1);
    if (lx === 0 && lz === 0) mark(cx - 1, cz - 1); if (lx === CS - 1 && lz === CS - 1) mark(cx + 1, cz + 1);
    if (lx === 0 && lz === CS - 1) mark(cx - 1, cz + 1); if (lx === CS - 1 && lz === 0) mark(cx + 1, cz - 1);
    // unsupported plants pop off
    if (!isSolid(id)) { const above = this.getBlock(x, y + 1, z); if (above && BLOCKS[above].cross) this.setBlock(x, y + 1, z, AIR, { record }); }
    this.onBlockChanged?.(x, y, z, old, id);
    return true;
  }

  // ---------- streaming ----------
  update(px, pz, budgetMs = 6) {
    const pcx = Math.floor(px / CS), pcz = Math.floor(pz / CS), R = this.renderDist;
    const t0 = performance.now();
    // generate in rings, closest first
    const want = [];
    for (let dz = -R - 1; dz <= R + 1; dz++) for (let dx = -R - 1; dx <= R + 1; dx++) {
      if (dx * dx + dz * dz > (R + 1.5) * (R + 1.5)) continue;
      const k = key(pcx + dx, pcz + dz);
      const c = this.chunks.get(k);
      if (!c || !c.generated || (c.dirty && dx * dx + dz * dz <= (R + 0.5) * (R + 0.5))) want.push([dx * dx + dz * dz, pcx + dx, pcz + dz]);
    }
    want.sort((a, b) => a[0] - b[0]);
    for (const [d2, cx, cz] of want) {
      if (performance.now() - t0 > budgetMs) break;
      const k = key(cx, cz);
      let c = this.chunks.get(k);
      if (!c) { c = new Chunk(cx, cz); this.chunks.set(k, c); }
      if (!c.generated) { this.generate(c); continue; }
      if (c.dirty && d2 <= (R + 0.5) * (R + 0.5) && this.neighboursReady(cx, cz)) this.buildMesh(c);
    }
    // unload far chunks
    for (const [k, c] of this.chunks) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (dx * dx + dz * dz > (R + 4) * (R + 4)) { this.disposeMesh(c); this.chunks.delete(k); }
    }
  }
  neighboursReady(cx, cz) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const n = this.getChunk(cx + dx, cz + dz); if (!n || !n.generated) return false; }
    return true;
  }
  pendingNear(px, pz, r = 1) {
    const pcx = Math.floor(px / CS), pcz = Math.floor(pz / CS);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz > r * r) continue;
      const c = this.getChunk(pcx + dx, pcz + dz);
      if (!c || !c.meshes) return true;
    }
    return false;
  }
  disposeMesh(c) {
    if (!c.meshes) return;
    for (const m of c.meshes) { this.scene.remove(m); m.geometry.dispose(); }
    c.meshes = null;
  }

  // ---------- meshing ----------
  buildMesh(c) {
    const ox = c.cx * CS, oz = c.cz * CS;
    const buckets = { solid: newBucket(), water: newBucket(), glow: newBucket() };
    const blocks = c.blocks;
    const get = (x, y, z) => {
      if (y < 0) return B.BEDROCK;
      if (y >= WH) return AIR;
      if (x >= 0 && x < CS && z >= 0 && z < CS) return blocks[idx(x, y, z)];
      return this.getBlock(ox + x, y, oz + z);
    };
    const lightTop = (x, z) => (x >= 0 && x < CS && z >= 0 && z < CS ? c.lightTop[x + z * CS] : this.lightTopAt(ox + x, oz + z));
    const opq = (x, y, z) => (isOpaque(get(x, y, z)) ? 1 : 0);

    for (let y = 0; y < WH; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const id = blocks[idx(x, y, z)];
      if (id === AIR) continue;
      const b = BLOCKS[id];
      if (b.cross) { emitCross(buckets.solid, ox + x, y, oz + z, b.faces[0], y < lightTop(x, z) ? LIGHT_SHADE : 1); continue; }
      const bucket = b.pass === 'water' ? buckets.water : b.pass === 'glow' ? buckets.glow : buckets.solid;
      const waterTop = id === B.WATER && get(x, y + 1, z) !== B.WATER;
      for (let f = 0; f < 6; f++) {
        const [nx, ny, nz] = FACES[f].n;
        const nid = get(x + nx, y + ny, z + nz);
        if (nid !== AIR) {
          const nb = BLOCKS[nid];
          if (nb.opaque) continue;
          if (nid === id && (id === B.WATER || id === B.GLASS || id === B.LEAVES)) continue;
          if (id === B.WATER && nb.solid && !nb.cross && nb.pass !== 'cutout') continue;
        }
        const lit = (y + ny) > lightTop(x + nx, z + nz) ? 1 : LIGHT_SHADE;
        emitFace(bucket, f, x, y, z, ox, oz, b.faces[f], lit, opq, waterTop, b.pass === 'glow');
      }
    }

    this.disposeMesh(c);
    c.meshes = [];
    for (const [name, bk] of Object.entries(buckets)) {
      if (!bk.pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(bk.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(bk.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(bk.col, 3));
      g.setIndex(bk.ind);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, this.materials[name]);
      m.matrixAutoUpdate = false;
      if (name === 'water') m.renderOrder = 2;
      this.scene.add(m);
      c.meshes.push(m);
    }
    c.dirty = false;
  }

  // ---------- queries ----------
  raycast(origin, dir, maxDist = 6, { hitWater = false } = {}) {
    let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    const sx = Math.sign(dir.x), sy = Math.sign(dir.y), sz = Math.sign(dir.z);
    const tdx = sx ? Math.abs(1 / dir.x) : Infinity, tdy = sy ? Math.abs(1 / dir.y) : Infinity, tdz = sz ? Math.abs(1 / dir.z) : Infinity;
    let tmx = sx > 0 ? (x + 1 - origin.x) * tdx : sx < 0 ? (origin.x - x) * tdx : Infinity;
    let tmy = sy > 0 ? (y + 1 - origin.y) * tdy : sy < 0 ? (origin.y - y) * tdy : Infinity;
    let tmz = sz > 0 ? (z + 1 - origin.z) * tdz : sz < 0 ? (origin.z - z) * tdz : Infinity;
    let t = 0, nx = 0, ny = 0, nz = 0;
    while (t <= maxDist) {
      const id = this.getBlock(x, y, z);
      if (id !== AIR && (id !== B.WATER || hitWater)) return { x, y, z, id, nx, ny, nz, dist: t };
      if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
      else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
      else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
    }
    return null;
  }

  // Does an AABB (min/max corners) overlap any solid block?
  boxHitsSolid(x0, y0, z0, x1, y1, z1) {
    for (let y = Math.floor(y0); y <= Math.floor(y1 - 1e-6); y++)
      for (let z = Math.floor(z0); z <= Math.floor(z1 - 1e-6); z++)
        for (let x = Math.floor(x0); x <= Math.floor(x1 - 1e-6); x++)
          if (isSolid(this.getBlock(x, y, z))) return true;
    return false;
  }

  explode(cx, cy, cz, radius, rng = Math.random) {
    const changed = [];
    const r = Math.ceil(radius);
    for (let y = -r; y <= r; y++) for (let z = -r; z <= r; z++) for (let x = -r; x <= r; x++) {
      const d = Math.hypot(x, y, z);
      if (d > radius - rng() * 0.8) continue;
      const bx = Math.floor(cx) + x, by = Math.floor(cy) + y, bz = Math.floor(cz) + z;
      if (bx >= COURT_COMPLEX.x0 && bx <= COURT_COMPLEX.x1 && bz >= COURT_COMPLEX.z0 && bz <= COURT_COMPLEX.z1) continue;
      const id = this.getBlock(bx, by, bz);
      if (id === AIR || id === B.WATER) continue;
      const b = BLOCKS[id];
      if (b.protected || b.hardness === Infinity) continue;
      if (this.setBlock(bx, by, bz, AIR)) changed.push([bx, by, bz, id]);
    }
    return changed;
  }

  // structure helpers -------------------------------------------------
  putStructure(x, y, z, id) {
    if (y < 0 || y >= WH) return;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS), k = key(cx, cz);
    if (!this.structures.has(k)) this.structures.set(k, []);
    this.structures.get(k).push([idx(x - cx * CS, y, z - cz * CS), id]);
  }

  // edits <-> save data
  serializeEdits() {
    const out = {};
    for (const [k, m] of this.edits) if (m.size) out[k] = Array.from(m.entries()).flat();
    return out;
  }
  loadEdits(obj) {
    this.edits.clear();
    for (const [k, arr] of Object.entries(obj || {})) {
      const m = new Map();
      for (let i = 0; i < arr.length; i += 2) m.set(arr[i], arr[i + 1]);
      this.edits.set(k, m);
    }
  }
}

// ---------- mesh helpers ----------
const LIGHT_SHADE = 0.55;
const FACE_SHADE = [0.8, 0.8, 1.0, 0.5, 0.65, 0.65];
const AO_LEVEL = [0.5, 0.68, 0.84, 1.0];
const lin = (f) => Math.pow(f, 2.2); // vertex colours are linear in three.js

// corners: BL, BR, TR, TL as seen from outside (CCW)
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], c: [[1, 0, 1], [0, 0, 1], [0, 0, 0], [1, 0, 0]] },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];
// Per face, per corner: offsets (from the cell in front of the face) of the two edge neighbours and the corner neighbour.
const AO_OFFS = FACES.map((F) => {
  const axis = F.n[0] ? 0 : F.n[1] ? 1 : 2, T1 = (axis + 1) % 3, T2 = (axis + 2) % 3;
  return F.c.map((c) => {
    const o1 = [0, 0, 0], o2 = [0, 0, 0];
    o1[T1] = c[T1] ? 1 : -1; o2[T2] = c[T2] ? 1 : -1;
    return [o1, o2, [o1[0] + o2[0], o1[1] + o2[1], o1[2] + o2[2]]];
  });
});
function newBucket() { return { pos: [], uv: [], col: [], ind: [] }; }

function emitFace(bk, f, x, y, z, ox, oz, tile, lit, opq, waterTop, glow) {
  const F = FACES[f], [nx, ny, nz] = F.n;
  const [u0, v0, u1, v1] = tileUV(tile);
  const uvs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  const base = bk.pos.length / 3;
  const ao = [];
  for (let k = 0; k < 4; k++) {
    const c = F.c[k];
    let vy = c[1];
    if (waterTop && vy === 1) vy = 0.88;
    bk.pos.push(ox + x + c[0], y + vy, oz + z + c[2]);
    bk.uv.push(uvs[k][0], uvs[k][1]);
    // ambient occlusion from the three blocks touching this corner on the face's outer side
    let level = 3;
    if (!glow) {
      const [o1, o2, o3] = AO_OFFS[f][k];
      const bx = x + nx, by = y + ny, bz = z + nz;
      const side1 = opq(bx + o1[0], by + o1[1], bz + o1[2]);
      const side2 = opq(bx + o2[0], by + o2[1], bz + o2[2]);
      const corner = opq(bx + o3[0], by + o3[1], bz + o3[2]);
      level = side1 && side2 ? 0 : 3 - (side1 + side2 + corner);
    }
    ao.push(level);
    const v = glow ? 1 : lin(FACE_SHADE[f] * AO_LEVEL[level] * lit);
    bk.col.push(v, v, v);
  }
  if (ao[0] + ao[2] < ao[1] + ao[3]) bk.ind.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
  else bk.ind.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function emitCross(bk, wx, y, wz, tile, lit) {
  const [u0, v0, u1, v1] = tileUV(tile);
  const v = lin(0.9 * lit);
  const quads = [
    [[0.15, 0.15], [0.85, 0.85]],
    [[0.15, 0.85], [0.85, 0.15]],
  ];
  for (const [[ax, az], [bx, bz]] of quads) {
    for (const flip of [false, true]) {
      const base = bk.pos.length / 3;
      const p = flip ? [[bx, bz], [ax, az]] : [[ax, az], [bx, bz]];
      bk.pos.push(wx + p[0][0], y, wz + p[0][1], wx + p[1][0], y, wz + p[1][1], wx + p[1][0], y + 1, wz + p[1][1], wx + p[0][0], y + 1, wz + p[0][1]);
      bk.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
      for (let k = 0; k < 4; k++) bk.col.push(v, v, v);
      bk.ind.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
}
