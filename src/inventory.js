// 36-slot inventory: slots 0-8 are the hotbar.
import { maxStack } from './items.js';

export class Inventory {
  constructor() {
    this.slots = new Array(36).fill(null);
    this.selected = 0;
    this.onChange = null;
  }
  get held() { return this.slots[this.selected]; }
  get heldId() { return this.slots[this.selected]?.id ?? 0; }

  add(id, n = 1) {
    const max = maxStack(id);
    for (let pass = 0; pass < 2 && n > 0; pass++) {
      for (let i = 0; i < 36 && n > 0; i++) {
        const s = this.slots[i];
        if (pass === 0 && s && s.id === id && s.count < max) { const k = Math.min(n, max - s.count); s.count += k; n -= k; }
        if (pass === 1 && !s) { const k = Math.min(n, max); this.slots[i] = { id, count: k }; n -= k; }
      }
    }
    this.onChange?.();
    return n; // leftover that did not fit
  }
  count(id) { let c = 0; for (const s of this.slots) if (s && s.id === id) c += s.count; return c; }
  remove(id, n = 1) {
    for (let i = 35; i >= 0 && n > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) { const k = Math.min(n, s.count); s.count -= k; n -= k; if (!s.count) this.slots[i] = null; }
    }
    this.onChange?.();
    return n === 0;
  }
  takeHeld(n = 1) {
    const s = this.slots[this.selected];
    if (!s) return false;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.onChange?.();
    return true;
  }
  find(id) { return this.slots.findIndex((s) => s && s.id === id); }
  select(i) { this.selected = ((i % 9) + 9) % 9; this.onChange?.(); }
  // Put an item in the hotbar and select it (moves an existing stack there if needed).
  equip(id) {
    let i = this.find(id);
    if (i < 0) { this.add(id, 1); i = this.find(id); }
    if (i < 0) return;
    if (i >= 9) { const t = this.slots[this.selected]; this.slots[this.selected] = this.slots[i]; this.slots[i] = t; }
    else this.selected = i;
    this.onChange?.();
  }
  toJSON() { return { slots: this.slots, selected: this.selected }; }
  load(o) { if (o?.slots?.length === 36) { this.slots = o.slots; this.selected = o.selected || 0; this.onChange?.(); } }
}
