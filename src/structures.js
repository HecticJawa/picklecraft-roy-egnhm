// Hand-placed places near spawn: the pickleball court, the village, the farm and the forest edge.
// Blocks go into world.structures (stamped over terrain during chunk generation); everything that
// is not a block (signs, paintings, villager spots) is returned as metadata for main.js.
import { B, AIR } from './blocks.js';
import { GROUND } from './world.js';
import { mulberry32 } from './util.js';

const Y = GROUND;      // ground block layer
const S = GROUND + 1;  // walking surface

export function buildStructures(world) {
  const put = (x, y, z, id) => world.putStructure(x, y, z, id);
  const fill = (x0, y0, z0, x1, y1, z1, id) => { for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) put(x, y, z, id); };
  const clearAbove = (x, z, h = 3) => { for (let y = S; y < S + h; y++) put(x, y, z, AIR); };
  const meta = { signs: [], posters: [], paintings: [], houses: [], seats: [], lamps: [] };
  const rng = mulberry32(4242);

  // ---------------- pickleball court ----------------
  for (let z = -10; z <= 9; z++) for (let x = -6; x <= 5; x++) {
    const inBounds = x >= -3 && x <= 2 && z >= -7 && z <= 6;
    put(x, Y, z, inBounds ? B.COURT_BLUE : B.COURT_GREEN);
    put(x, Y - 1, z, B.STONE);
    clearAbove(x, z, 4);
  }
  // bleachers on the east side (seat surfaces at S+1..S+3)
  for (let z = -7; z <= 6; z++) {
    fill(7, S, z, 7, S, z, B.PLANKS);
    fill(8, S, z, 8, S + 1, z, B.PLANKS);
    fill(9, S, z, 9, S + 2, z, B.PLANKS);
    fill(10, S, z, 10, S + 4, z, B.LOG);
  }
  for (const z of [-6, -3, 0, 3, 5]) meta.seats.push({ x: 7.5 + (z % 2 ? 1 : 0), y: S + 1 + (z % 2 ? 1 : 0), z: z + 0.5 });
  meta.seats.push({ x: 9.5, y: S + 3, z: -1.5 }, { x: 9.5, y: S + 3, z: 2.5 });
  // referee chair beside the net, west side
  fill(-5, S, -1, -5, S + 1, -1, B.LOG);
  meta.refSpot = { x: -4.5, y: S + 2, z: -0.5 };
  // scoreboard posts behind the north baseline
  fill(-4, S, -13, -4, S + 4, -13, B.LOG);
  fill(3, S, -13, 3, S + 4, -13, B.LOG);
  meta.scoreboard = { x: 0, y: S + 3.6, z: -12.45 };
  // court lamps
  for (const [x, z] of [[-8, -12], [7, -12], [-8, 11], [7, 11]]) { fill(x, S, z, x, S + 2, z, B.LOG); put(x, S + 3, z, B.PICKLE_LAMP); }

  // signs and Roy everywhere
  meta.spawn = { x: 0.5, y: S, z: 15.5, yaw: 0 };
  fill(3, S, 13, 3, S, 13, B.LOG);
  meta.signs.push({ x: 3.5, y: S + 1.45, z: 13.5, rotY: 0, w: 2.4, h: 1.2, lines: ['PICKLECRAFT COURT', 'Talk to Dinkleton', 'to play a match!', 'Losers explode. -Roy'] });
  meta.posters.push({ kind: 'roy', x: -14, y: S + 5.5, z: 14, rotY: Math.PI * 0.82, w: 6, h: 7.5, caption: 'ROY SAYS: DINK RESPONSIBLY', posts: true });
  fill(-17, S, 12, -17, S + 3, 12, B.LOG); fill(-11, S, 16, -11, S + 3, 16, B.LOG);

  // ---------------- forest edge ----------------
  meta.posters.push({ kind: 'suit', x: -24.5, y: S + 1.8, z: 6.5, rotY: Math.PI / 2, w: 1.8, h: 2.4, caption: 'HAVE YOU SEEN THIS MAN?', sub: 'Lives in forest. Hates losers.' });
  fill(-25, S, 6, -25, S + 1, 6, B.LOG);
  meta.signs.push({ x: -24.4, y: S + 1.3, z: -4.5, rotY: Math.PI / 2, w: 2.2, h: 1.1, lines: ['THE FOREST', 'Keep out.', 'Especially if you', 'lost at pickleball.'] });
  fill(-25, S, -5, -25, S, -5, B.LOG);
  meta.bigSuitStart = { x: -38, z: 0.5 };

  // ---------------- village (east) ----------------
  // main road from the court to the far end of the village
  for (let x = 11; x <= 72; x++) for (let z = -1; z <= 1; z++) { put(x, Y, z, B.GRAVEL); clearAbove(x, z); }
  // fountain plaza with the statue of Roy
  for (let z = -5; z <= 5; z++) for (let x = 41; x <= 51; x++) {
    const dx = x - 46, dz = z;
    const d = Math.hypot(dx, dz);
    if (d > 5.6) continue;
    clearAbove(x, z);
    if (d <= 3.3) put(x, Y, z, B.WATER);
    else if (d <= 4.3) { put(x, Y, z, B.STONE_BRICK); put(x, S, z, B.STONE_BRICK); }
    else put(x, Y, z, B.STONE_BRICK);
  }
  fill(45, Y - 1, -1, 47, S + 1, 1, B.STONE_BRICK);
  meta.statue = { x: 46.5, y: S + 2, z: 0.5, rotY: -Math.PI / 2, scale: 2.2 };
  // road lamps
  for (const x of [16, 30, 62, 70]) for (const z of [-3, 3]) { put(x, Y, z, B.COBBLE); fill(x, S, z, x, S + 2, z, B.LOG); put(x, S + 3, z, B.PICKLE_LAMP); }

  const houseSpots = [
    { x0: 25, z0: -13, door: 'S' }, { x0: 34, z0: -13, door: 'S' }, { x0: 55, z0: -13, door: 'S' }, { x0: 64, z0: -12, door: 'S' },
    { x0: 25, z0: 7, door: 'N' }, { x0: 34, z0: 7, door: 'N' }, { x0: 60, z0: 7, door: 'N' },
  ];
  for (const [i, h] of houseSpots.entries()) meta.houses.push(house(h.x0, h.z0, 7, 7, h.door, i));

  function house(x0, z0, w, d, door, n) {
    const x1 = x0 + w - 1, z1 = z0 + d - 1;
    const roof = n % 3 === 1 ? B.BRICK : n % 3 === 2 ? B.COBBLE : B.PLANKS;
    for (let z = z0 - 1; z <= z1 + 1; z++) for (let x = x0 - 1; x <= x1 + 1; x++) clearAbove(x, z, 8);
    fill(x0, Y, z0, x1, Y, z1, B.COBBLE);
    for (let y = S; y <= S + 2; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const edgeX = x === x0 || x === x1, edgeZ = z === z0 || z === z1;
      if (!edgeX && !edgeZ) continue;
      const corner = edgeX && edgeZ;
      const midZ = z === z0 + 3;
      let id = corner ? B.LOG : B.PLANKS;
      if (!corner && y === S + 1 && ((edgeZ && (x === x0 + 1 || x === x1 - 1)) || (edgeX && midZ))) id = B.GLASS;
      put(x, y, z, id);
    }
    // door gap and path to the road
    const dx = x0 + 3, dz = door === 'S' ? z1 : z0;
    put(dx, S, dz, AIR); put(dx, S + 1, dz, AIR);
    const step = door === 'S' ? 1 : -1;
    for (let z = dz + step; door === 'S' ? z <= -2 : z >= 2; z += step) { put(dx, Y, z, B.GRAVEL); clearAbove(dx, z); }
    // stepped roof
    for (let k = 0; k <= 3; k++) fill(x0 - 1 + k, S + 3 + k, z0 - 1 + k, x1 + 1 - k, S + 3 + k, z1 + 1 - k, roof);
    // furniture
    const inside = { x: x0 + 1.5 + (n % 2) * 3, y: S, z: z0 + 2.5 };
    put(x0 + 1, S, z0 + 1, B.CRAFTING_TABLE);
    put(x1 - 1, S, z0 + 1, B.BOOKSHELF); put(x1 - 1, S + 1, z0 + 1, B.BOOKSHELF);
    put(x0 + 1, S, z1 - 1, B.WOOL_RED); put(x0 + 2, S, z1 - 1, B.WOOL_WHITE);
    if (door === 'N') { put(x0 + 1, S, z0 + 1, B.WOOL_RED); put(x0 + 2, S, z0 + 1, B.WOOL_WHITE); put(x0 + 1, S, z1 - 1, B.CRAFTING_TABLE); }
    put(x0 + 3, S + 2, z0 + 3, B.PICKLE_LAMP);
    // a Roy portrait on the wall opposite the door
    const backZ = door === 'S' ? z0 + 1.02 : z1 - 0.02;
    meta.paintings.push({ x: x0 + 3.5, y: S + 1.5, z: backZ, rotY: door === 'S' ? 0 : Math.PI, w: 1.5, h: 1.5 });
    return { x0, z0, x1, z1, door: { x: dx + 0.5, z: dz + 0.5 }, inside };
  }

  // pickle farm with Roy's chickens
  for (let z = 12; z <= 20; z++) for (let x = 44; x <= 54; x++) {
    clearAbove(x, z);
    const edge = x === 44 || x === 54 || z === 12 || z === 20;
    if (edge) { put(x, Y, z, B.LOG); continue; }
    if (x === 49) { put(x, Y, z, B.WATER); continue; }
    put(x, Y, z, B.DIRT);
    if (rng() < 0.75) put(x, S, z, B.PICKLE_PLANT);
  }
  fill(56, S, 14, 57, S, 15, B.HAY); put(56, S + 1, 14, B.HAY);
  meta.farm = { x0: 42, x1: 58, z0: 10, z1: 24 };
  meta.signs.push({ x: 49.5, y: S + 1.3, z: 11.4, rotY: Math.PI, w: 2, h: 1, lines: ['PICKLE FARM', 'Do not pet the chickens.', 'They have faces.'] });
  fill(49, S, 11, 49, S, 11, B.LOG);

  return meta;
}
