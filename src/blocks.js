// Block registry. Block ids 1..255 double as item ids for the block's item form.
// Tiles are named here; textures.js paints each named tile into the atlas.

export const WOOL_COLORS = {
  white: '#e9ecec', orange: '#f07613', magenta: '#bd44b3', light_blue: '#3aafd9',
  yellow: '#f8c627', lime: '#70b919', pink: '#ed8dac', gray: '#3e4447',
  light_gray: '#8e8e86', cyan: '#158991', purple: '#792aac', blue: '#35399d',
  brown: '#724728', green: '#546d1b', red: '#a12722', black: '#141519',
};
// Skin, beard and shadow tones. Mount Roymore is painted with these plus the wools.
export const CLAY_COLORS = {
  peach: '#f0c2a8', tan: '#dca184', rose: '#c98572', sienna: '#a8664f',
  umber: '#7a4a3a', beard_gray: '#b8b2aa', beard_white: '#e2ddd5', shadow: '#4a3a34',
};

export const TILE_NAMES = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'cobble', 'sand', 'water', 'log_side', 'log_top',
  'leaves', 'planks', 'glass', 'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'pickle_ore',
  'bedrock', 'gravel', 'brick', 'roy', 'court_blue', 'court_green', 'pickle_block_side', 'pickle_block_top',
  'pickle_lamp', 'bookshelf', 'crafting_top', 'crafting_side', 'tall_grass', 'flower_red', 'flower_yellow',
  'suit', 'stone_brick', 'pickle_plant', 'hay_side', 'hay_top', 'snow',
  ...Object.keys(WOOL_COLORS).map((c) => 'wool_' + c),
  ...Object.keys(CLAY_COLORS).map((c) => 'clay_' + c),
];
export const TILE = Object.fromEntries(TILE_NAMES.map((n, i) => [n, i]));
export const ATLAS_COLS = 16;

// pass: 'opaque' | 'cutout' (alpha-tested, e.g. leaves/glass/plants) | 'water' (blended) | 'glow' (ignores night)
const defs = [];
function def(id, name, o) {
  const t = o.tiles;
  const faces = t.all !== undefined
    ? [t.all, t.all, t.all, t.all, t.all, t.all]
    : [t.side, t.side, t.top, t.bottom ?? t.top, t.side, t.side]; // +x,-x,+y,-y,+z,-z
  defs[id] = {
    id, name,
    faces: faces.map((n) => TILE[n]),
    solid: o.solid ?? true,
    opaque: o.opaque ?? true,
    pass: o.pass ?? 'opaque',
    cross: o.cross ?? false,
    hardness: o.hardness ?? 1,
    tool: o.tool ?? null,
    drop: o.drop === undefined ? id : o.drop,
    protected: o.protected ?? false,
    sound: o.sound ?? 'stone',
    color: o.color, // used for break particles / icons when no tile fits
    creative: o.creative ?? true,
  };
  return id;
}

export const B = {};
let nid = 1;
const add = (key, name, o) => { B[key] = def(nid++, name, o); };

add('GRASS', 'Grass Block', { tiles: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' }, hardness: 0.6, tool: 'shovel', drop: 'DIRT', sound: 'grass' });
add('DIRT', 'Dirt', { tiles: { all: 'dirt' }, hardness: 0.5, tool: 'shovel', sound: 'gravel' });
add('STONE', 'Stone', { tiles: { all: 'stone' }, hardness: 1.5, tool: 'pick', drop: 'COBBLE' });
add('COBBLE', 'Cobblestone', { tiles: { all: 'cobble' }, hardness: 2, tool: 'pick' });
add('SAND', 'Sand', { tiles: { all: 'sand' }, hardness: 0.5, tool: 'shovel', sound: 'sand' });
add('WATER', 'Water', { tiles: { all: 'water' }, solid: false, opaque: false, pass: 'water', hardness: Infinity, drop: null, creative: false });
add('LOG', 'Oak Log', { tiles: { top: 'log_top', side: 'log_side' }, hardness: 2, tool: 'axe', sound: 'wood' });
add('LEAVES', 'Oak Leaves', { tiles: { all: 'leaves' }, opaque: false, pass: 'cutout', hardness: 0.2, drop: null, sound: 'grass' });
add('PLANKS', 'Oak Planks', { tiles: { all: 'planks' }, hardness: 2, tool: 'axe', sound: 'wood' });
add('GLASS', 'Glass', { tiles: { all: 'glass' }, opaque: false, pass: 'cutout', hardness: 0.3, drop: null, sound: 'glass' });
add('COAL_ORE', 'Coal Ore', { tiles: { all: 'coal_ore' }, hardness: 3, tool: 'pick', drop: 'I:COAL' });
add('IRON_ORE', 'Iron Ore', { tiles: { all: 'iron_ore' }, hardness: 3, tool: 'pick', drop: 'I:IRON' });
add('GOLD_ORE', 'Gold Ore', { tiles: { all: 'gold_ore' }, hardness: 3, tool: 'pick', drop: 'I:GOLD' });
add('DIAMOND_ORE', 'Diamond Ore', { tiles: { all: 'diamond_ore' }, hardness: 3, tool: 'pick', drop: 'I:DIAMOND' });
add('PICKLE_ORE', 'Pickle Ore', { tiles: { all: 'pickle_ore' }, hardness: 2.5, tool: 'pick', drop: 'I:PICKLE' });
add('BEDROCK', 'Bedrock', { tiles: { all: 'bedrock' }, hardness: Infinity, drop: null, creative: false });
add('GRAVEL', 'Gravel', { tiles: { all: 'gravel' }, hardness: 0.6, tool: 'shovel', sound: 'gravel' });
add('BRICK', 'Bricks', { tiles: { all: 'brick' }, hardness: 2, tool: 'pick' });
add('ROY', 'Roy Block', { tiles: { all: 'roy' }, hardness: 0.8, sound: 'roy' });
add('COURT_BLUE', 'Court Surface', { tiles: { all: 'court_blue' }, protected: true, hardness: Infinity, creative: false });
add('COURT_GREEN', 'Court Apron', { tiles: { all: 'court_green' }, protected: true, hardness: Infinity, creative: false });
add('PICKLE_BLOCK', 'Block of Pickle', { tiles: { top: 'pickle_block_top', side: 'pickle_block_side' }, hardness: 0.8, sound: 'grass' });
add('PICKLE_LAMP', 'Pickle Lamp', { tiles: { all: 'pickle_lamp' }, pass: 'glow', hardness: 0.3, sound: 'glass' });
add('BOOKSHELF', 'Bookshelf', { tiles: { top: 'planks', side: 'bookshelf' }, hardness: 1.5, tool: 'axe', sound: 'wood' });
add('CRAFTING_TABLE', 'Crafting Table', { tiles: { top: 'crafting_top', side: 'crafting_side', bottom: 'planks' }, hardness: 2.5, tool: 'axe', sound: 'wood' });
add('TALL_GRASS', 'Tall Grass', { tiles: { all: 'tall_grass' }, solid: false, opaque: false, pass: 'cutout', cross: true, hardness: 0, drop: null, sound: 'grass' });
add('FLOWER_RED', 'Poppy', { tiles: { all: 'flower_red' }, solid: false, opaque: false, pass: 'cutout', cross: true, hardness: 0, sound: 'grass' });
add('FLOWER_YELLOW', 'Dandelion', { tiles: { all: 'flower_yellow' }, solid: false, opaque: false, pass: 'cutout', cross: true, hardness: 0, sound: 'grass' });
add('SUIT', 'Suit Fabric', { tiles: { all: 'suit' }, hardness: 0.8, sound: 'cloth' });
add('STONE_BRICK', 'Stone Bricks', { tiles: { all: 'stone_brick' }, hardness: 1.5, tool: 'pick' });
add('PICKLE_PLANT', 'Pickle Plant', { tiles: { all: 'pickle_plant' }, solid: false, opaque: false, pass: 'cutout', cross: true, hardness: 0, drop: 'I:PICKLE', sound: 'grass' });
add('HAY', 'Hay Bale', { tiles: { top: 'hay_top', side: 'hay_side' }, hardness: 0.5, sound: 'grass' });
add('SNOW', 'Snow', { tiles: { all: 'snow' }, hardness: 0.3, tool: 'shovel', sound: 'cloth' });
for (const c of Object.keys(WOOL_COLORS)) add('WOOL_' + c.toUpperCase(), c.replace('_', ' ').replace(/\b\w/g, (m) => m.toUpperCase()) + ' Wool', { tiles: { all: 'wool_' + c }, hardness: 0.8, sound: 'cloth', color: WOOL_COLORS[c] });
for (const c of Object.keys(CLAY_COLORS)) add('CLAY_' + c.toUpperCase(), c.replace('_', ' ').replace(/\b\w/g, (m) => m.toUpperCase()) + ' Clay', { tiles: { all: 'clay_' + c }, hardness: 1.2, tool: 'pick', color: CLAY_COLORS[c] });

export const BLOCKS = defs;
export const AIR = 0;

// Resolve symbolic drops ('DIRT', 'I:COAL') once items.js has registered item ids.
export function resolveDrops(itemIds) {
  for (const d of defs) {
    if (!d) continue;
    if (typeof d.drop === 'string') {
      d.drop = d.drop.startsWith('I:') ? itemIds[d.drop.slice(2)] : B[d.drop];
    }
  }
}

export const isSolid = (id) => id !== 0 && defs[id].solid;
export const isOpaque = (id) => id !== 0 && defs[id].opaque;
