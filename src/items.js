// Non-block items (ids >= 256), crafting recipes and item metadata helpers.
import { B, BLOCKS, resolveDrops } from './blocks.js';

export const I = {};
export const ITEMS = {}; // id -> {id, name, kind, ...}
let nid = 256;
function item(key, name, o = {}) {
  const id = nid++;
  I[key] = id;
  ITEMS[id] = { id, key, name, stack: o.stack ?? 64, ...o };
}

item('PADDLE', 'Roy Paddle', { stack: 1, damage: 3, kind: 'paddle' });
item('PICKLE', 'Pickle', { food: 4, heal: 2, kind: 'food' });
item('STICK', 'Stick');
item('PINK_TIE', 'Pink Necktie', { kind: 'tie' });
item('GOLDEN_ROY', 'Golden Roy Trophy', { stack: 1, kind: 'trophy' });
item('COAL', 'Coal');
item('IRON', 'Iron Ingot');
item('GOLD', 'Gold Ingot');
item('DIAMOND', 'Diamond');
item('WOOD_PICK', 'Wooden Pickaxe', { stack: 1, tool: 'pick', power: 2, damage: 2 });
item('STONE_PICK', 'Stone Pickaxe', { stack: 1, tool: 'pick', power: 3.5, damage: 3 });
item('IRON_PICK', 'Iron Pickaxe', { stack: 1, tool: 'pick', power: 5, damage: 4 });
item('DIAMOND_PICK', 'Diamond Pickaxe', { stack: 1, tool: 'pick', power: 7, damage: 5 });
item('WOOD_AXE', 'Wooden Axe', { stack: 1, tool: 'axe', power: 2.5, damage: 3 });
item('WOOD_SHOVEL', 'Wooden Shovel', { stack: 1, tool: 'shovel', power: 2.5, damage: 2 });
item('WOOD_SWORD', 'Wooden Sword', { stack: 1, damage: 4 });
item('DIAMOND_SWORD', 'Diamond Sword', { stack: 1, damage: 8 });
item('ROY_SWORD', 'The Roy-al Sword', { stack: 1, damage: 12 });

resolveDrops(I);

export const isBlockItem = (id) => id > 0 && id < 256;
export function itemName(id) {
  if (isBlockItem(id)) return BLOCKS[id]?.name ?? '???';
  return ITEMS[id]?.name ?? '???';
}
export function maxStack(id) {
  return isBlockItem(id) ? 64 : ITEMS[id]?.stack ?? 64;
}
export function itemDamage(id) {
  return (!isBlockItem(id) && ITEMS[id]?.damage) || 1;
}

// Recipe-book style crafting (no 3x3 grid): inputs are consumed, output is produced.
export const RECIPES = [
  { out: [B.PLANKS, 4], in: [[B.LOG, 1]] },
  { out: [I.STICK, 4], in: [[B.PLANKS, 2]] },
  { out: [B.CRAFTING_TABLE, 1], in: [[B.PLANKS, 4]] },
  { out: [I.PADDLE, 1], in: [[B.PLANKS, 2], [I.PICKLE, 1]] },
  { out: [I.WOOD_PICK, 1], in: [[B.PLANKS, 3], [I.STICK, 2]] },
  { out: [I.WOOD_AXE, 1], in: [[B.PLANKS, 3], [I.STICK, 2]] },
  { out: [I.WOOD_SHOVEL, 1], in: [[B.PLANKS, 1], [I.STICK, 2]] },
  { out: [I.WOOD_SWORD, 1], in: [[B.PLANKS, 2], [I.STICK, 1]] },
  { out: [I.STONE_PICK, 1], in: [[B.COBBLE, 3], [I.STICK, 2]] },
  { out: [I.IRON_PICK, 1], in: [[I.IRON, 3], [I.STICK, 2]] },
  { out: [I.DIAMOND_PICK, 1], in: [[I.DIAMOND, 3], [I.STICK, 2]] },
  { out: [I.DIAMOND_SWORD, 1], in: [[I.DIAMOND, 2], [I.STICK, 1]] },
  { out: [I.ROY_SWORD, 1], in: [[B.ROY, 2], [I.PINK_TIE, 1]] },
  { out: [B.ROY, 4], in: [[I.GOLD, 1], [I.PICKLE, 1]] },
  { out: [B.PICKLE_BLOCK, 1], in: [[I.PICKLE, 4]] },
  { out: [B.PICKLE_LAMP, 2], in: [[I.PICKLE, 1], [I.COAL, 1]] },
  { out: [B.GLASS, 4], in: [[B.SAND, 4], [I.COAL, 1]] },
  { out: [B.BRICK, 4], in: [[B.DIRT, 4], [I.COAL, 1]] },
  { out: [B.STONE_BRICK, 4], in: [[B.COBBLE, 4]] },
  { out: [B.SUIT, 2], in: [[I.PINK_TIE, 1], [B.WOOL_BLUE, 1]] },
  { out: [B.WOOL_WHITE, 1], in: [[B.TALL_GRASS, 0], [B.HAY, 1]] },
  { out: [B.HAY, 1], in: [[I.STICK, 3]] },
  { out: [B.BOOKSHELF, 1], in: [[B.PLANKS, 6]] },
].map((r) => ({ ...r, in: r.in.filter(([, n]) => n > 0) }));
