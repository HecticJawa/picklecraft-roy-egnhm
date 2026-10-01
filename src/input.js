// Keyboard + mouse (pointer lock) and touch controls (joystick, drag-to-look, tap = use, hold = mine).
import { isTouchDevice } from './util.js';

export class Input {
  constructor(canvas, ui, settings) {
    this.canvas = canvas; this.ui = ui; this.settings = settings;
    this.touch = isTouchDevice() || new URLSearchParams(location.search).has('touch');
    this.keys = new Set();
    this.move = { x: 0, z: 0 };
    this.look = { dx: 0, dy: 0 };
    this.attackHeld = false;
    this.useHeld = false;
    this.jumpHeld = false;
    this.sneakHeld = false;
    this.sprint = false;
    this.enabled = false;          // game input active (no menu open)
    this.onAction = () => {};     // (name, arg) => void
    this.lastSpace = 0; this.lastW = 0;
    this.locked = false;
    this.bindDesktop();
    if (this.touch) this.buildTouch();
  }

  // ---------- desktop ----------
  bindDesktop() {
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const code = e.code;
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab', 'F5'].includes(code)) e.preventDefault();
      if (e.repeat) { this.keys.add(code); return; }
      this.keys.add(code);
      if (code === 'Escape') { this.onAction('escape'); return; } // leaving pointer lock is handled by pointerlockchange
      if (code === 'KeyE') this.onAction('inventory');
      if (!this.enabled) return;
      if (code.startsWith('Digit') && code !== 'Digit0') this.onAction('hotbar', +code.slice(5) - 1);
      if (code === 'KeyT' || code === 'Slash' || code === 'Enter') { e.preventDefault(); this.onAction('chat', code === 'Slash' ? '/' : ''); }
      if (code === 'F5' || code === 'KeyV') this.onAction('camera');
      if (code === 'KeyQ') this.onAction('drop');
      if (code === 'KeyF') this.onAction('swing');
      if (code === 'Space') { const t = performance.now(); if (t - this.lastSpace < 300) this.onAction('toggleFly'); this.lastSpace = t; }
      if (code === 'KeyW') { const t = performance.now(); if (t - this.lastW < 280) this.sprint = true; this.lastW = t; }
      if (code === 'ControlLeft') this.sprint = true;
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyW') this.sprint = false;
    });
    addEventListener('blur', () => { this.keys.clear(); this.attackHeld = false; this.useHeld = false; });

    this.canvas.addEventListener('mousedown', (e) => {
      if (this.touch) return;
      if (!this.locked) { if (this.enabled) this.lock(); return; }
      if (e.button === 0) { this.attackHeld = true; this.onAction('attack'); }
      if (e.button === 2) { this.useHeld = true; this.onAction('use'); }
      if (e.button === 1) { e.preventDefault(); this.onAction('pick'); }
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.attackHeld = false; if (e.button === 2) this.useHeld = false; });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      const s = 0.0022 * this.settings.sensitivity;
      this.look.dx += e.movementX * s; this.look.dy += e.movementY * s * (this.settings.invertY ? -1 : 1);
    });
    addEventListener('wheel', (e) => { if (this.enabled && this.locked) this.onAction('hotbar-scroll', Math.sign(e.deltaY)); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      if (was && !this.locked) { this.attackHeld = false; this.useHeld = false; this.keys.clear(); this.onAction('unlocked'); }
    });
  }
  lock() {
    if (this.touch) return;
    // raw mouse input where supported; otherwise plain pointer lock. Failures (no user gesture yet) are harmless:
    // the next click on the canvas locks again.
    const plain = () => { try { this.canvas.requestPointerLock()?.catch?.(() => {}); } catch { /* ignore */ } };
    try { const p = this.canvas.requestPointerLock({ unadjustedMovement: true }); p?.catch?.(plain); } catch { plain(); }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  // ---------- touch ----------
  buildTouch() {
    document.body.classList.add('touch');
    const root = document.createElement('div');
    root.id = 'touch';
    root.innerHTML = `
      <div id="tc-look"></div>
      <div id="tc-stick"><div id="tc-knob"></div></div>
      <button class="tc-btn" id="tc-jump">⬆</button>
      <button class="tc-btn" id="tc-sneak">⬇</button>
      <button class="tc-btn" id="tc-swing">SWING</button>
      <button class="tc-btn small" id="tc-inv">🎒</button>
      <button class="tc-btn small" id="tc-cam">👁</button>
      <button class="tc-btn small" id="tc-pause">❚❚</button>
      <button class="tc-btn small" id="tc-chat">💬</button>`;
    this.ui.appendChild(root);
    this.touchRoot = root;
    const stick = root.querySelector('#tc-stick'), knob = root.querySelector('#tc-knob'), look = root.querySelector('#tc-look');
    let stickId = null, sx = 0, sy = 0;
    const R = 55;
    const setKnob = (dx, dy) => { knob.style.transform = `translate(${dx}px, ${dy}px)`; };
    stick.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0]; stickId = t.identifier;
      const r = stick.getBoundingClientRect(); sx = r.left + r.width / 2; sy = r.top + r.height / 2;
      this.stickMove(t.clientX - sx, t.clientY - sy, R, setKnob);
    }, { passive: false });
    stick.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === stickId) this.stickMove(t.clientX - sx, t.clientY - sy, R, setKnob);
    }, { passive: false });
    const endStick = (e) => { for (const t of e.changedTouches) if (t.identifier === stickId) { stickId = null; this.move.x = this.move.z = 0; this.sprint = false; setKnob(0, 0); } };
    stick.addEventListener('touchend', endStick); stick.addEventListener('touchcancel', endStick);

    // drag to look; tap = use, long press = attack/mine
    const lookTouches = new Map();
    look.addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const info = { x: t.clientX, y: t.clientY, sx: t.clientX, sy: t.clientY, t0: performance.now(), moved: 0, holding: false };
        info.timer = setTimeout(() => { if (info.moved < 14 && this.enabled) { info.holding = true; this.attackHeld = true; this.onAction('attack', { x: info.x, y: info.y }); } }, 280);
        lookTouches.set(t.identifier, info);
      }
    }, { passive: false });
    look.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const info = lookTouches.get(t.identifier); if (!info) continue;
        const dx = t.clientX - info.x, dy = t.clientY - info.y;
        info.moved += Math.abs(dx) + Math.abs(dy);
        info.x = t.clientX; info.y = t.clientY;
        if (this.enabled) { const s = 0.0055 * this.settings.sensitivity; this.look.dx += dx * s; this.look.dy += dy * s * (this.settings.invertY ? -1 : 1); }
      }
    }, { passive: false });
    const endLook = (e) => {
      for (const t of e.changedTouches) {
        const info = lookTouches.get(t.identifier); if (!info) continue;
        clearTimeout(info.timer);
        if (info.holding) this.attackHeld = false;
        else if (info.moved < 14 && performance.now() - info.t0 < 280 && this.enabled) this.onAction('tap', { x: info.x, y: info.y });
        lookTouches.delete(t.identifier);
      }
    };
    look.addEventListener('touchend', endLook); look.addEventListener('touchcancel', endLook);

    const hold = (id, on, off) => {
      const el = root.querySelector(id);
      el.addEventListener('touchstart', (e) => { e.preventDefault(); el.classList.add('down'); on(); }, { passive: false });
      const up = (e) => { e.preventDefault(); el.classList.remove('down'); off?.(); };
      el.addEventListener('touchend', up); el.addEventListener('touchcancel', up);
    };
    let lastJump = 0;
    hold('#tc-jump', () => { this.jumpHeld = true; const t = performance.now(); if (t - lastJump < 300) this.onAction('toggleFly'); lastJump = t; }, () => { this.jumpHeld = false; });
    hold('#tc-sneak', () => { this.sneakHeld = true; }, () => { this.sneakHeld = false; });
    hold('#tc-swing', () => this.onAction('swing'));
    hold('#tc-inv', () => this.onAction('inventory'));
    hold('#tc-cam', () => this.onAction('camera'));
    hold('#tc-pause', () => this.onAction('pause'));
    hold('#tc-chat', () => this.onAction('chat', '/'));
  }
  stickMove(dx, dy, R, setKnob) {
    const d = Math.hypot(dx, dy), k = d > R ? R / d : 1;
    setKnob(dx * k, dy * k);
    this.move.x = (dx * k) / R; this.move.z = -(dy * k) / R;
    const mag = Math.hypot(this.move.x, this.move.z);
    if (mag < 0.15) { this.move.x = this.move.z = 0; }
    this.sprint = d > R * 1.25 && this.move.z > 0.6;
  }

  // ---------- per-frame ----------
  readMove() {
    if (!this.enabled) return { x: 0, z: 0 };
    if (this.touch && (this.move.x || this.move.z)) return { ...this.move };
    const k = this.keys;
    let x = 0, z = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) z += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) z -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (x && z) { x *= Math.SQRT1_2; z *= Math.SQRT1_2; }
    if (!z) this.sprint = this.touch ? this.sprint : false;
    return { x, z };
  }
  get jump() { return this.enabled && (this.jumpHeld || this.keys.has('Space')); }
  get sneak() { return this.enabled && (this.sneakHeld || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')); }
  consumeLook() { const l = { ...this.look }; this.look.dx = this.look.dy = 0; return l; }
}
