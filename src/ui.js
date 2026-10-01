// DOM user interface: title, HUD, inventory/crafting, dialogs, settings, captions and speech bubbles.
import * as THREE from 'three';
import { photos, iconURL, tileCanvases } from './textures.js';
import { BLOCKS, B, TILE } from './blocks.js';
import { ITEMS, I, RECIPES, itemName, isBlockItem, maxStack } from './items.js';
import { pick } from './util.js';

const SPLASHES = ['Now with 100% more Roy!', 'Dink responsibly!', 'Hrmm.', 'Also try Minecraft!', 'The kitchen is not for cooking!', 'Roy is the sun!', 'Win or explode!', 'Two bounces!', 'Contains pickles!', 'Nasal edition!', 'Suit up!', 'Look up!', 'Brined to perfection!', 'Roy is also the moon!', 'Lose and find out!', 'Hrmm? Hrmm!', 'Pickles > emeralds', '11 to win, 2 to... win by'];

const FONT = {
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
};

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class UI {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui');
    this.screen = null;
    this.bubbles = [];
    this.cursor = null; // stack held by the mouse in the inventory
    this.build();
  }

  build() {
    const r = this.root;
    r.insertAdjacentHTML('beforeend', `
      <div id="hud" class="hidden">
        <div id="crosshair">+</div>
        <div id="hurt"></div><div id="underwater"></div><div id="flash"></div>
        <div id="match-hud" class="hidden"></div>
        <div id="kitchen" class="hidden">YOU'RE IN THE KITCHEN — NO VOLLEYS!</div>
        <div id="pop"></div>
        <div id="toasts"></div>
        <div id="bubbles"></div>
        <div id="captions"></div>
        <div id="chatlog"></div>
        <div id="held-name"></div>
        <div id="bottom">
          <div id="stats"><div id="hearts"></div><div id="hunger"></div></div>
          <div id="hotbar"></div>
        </div>
        <div id="debug" class="hidden"></div>
      </div>
      <div id="loading" class="screen"><div class="panel"><img class="roy-spin" src="${photos.royHeadURL}"><h2>Generating world…</h2><p id="loading-tip">Roy is pickling the terrain.</p></div></div>
      <div id="title" class="screen hidden">
        <div class="logo-wrap"><canvas id="logo"></canvas><div id="splash"></div></div>
        <img id="title-roy" src="${photos.royHeadURL}">
        <div class="menu">
          <button data-act="play">Play</button>
          <button data-act="help">How to play</button>
          <button data-act="settings">Settings</button>
        </div>
        <div class="footer">Picklecraft · A fan-made goof · Not affiliated with Mojang or any pickleball authority · Roy approved</div>
      </div>
      <div id="pause" class="screen hidden"><div class="panel">
        <h2>Game Paused</h2>
        <div class="menu">
          <button data-act="resume">Back to Game</button>
          <button data-act="help">How to play</button>
          <button data-act="settings">Settings</button>
          <button data-act="forfeit" class="match-only">Forfeit match (you will explode)</button>
          <button data-act="quit">Save &amp; Quit to Title</button>
        </div></div></div>
      <div id="settings" class="screen hidden"><div class="panel wide"><h2>Settings</h2><div id="settings-body"></div><div class="menu"><button data-act="back">Done</button></div></div></div>
      <div id="help" class="screen hidden"><div class="panel wide scroll"><h2>How to play</h2><div id="help-body"></div><div class="menu"><button data-act="back">Got it</button></div></div></div>
      <div id="inventory" class="screen hidden"><div class="panel inv">
        <div class="inv-tabs"><button data-tab="inv" class="on">Inventory</button><button data-tab="craft">Crafting</button><button data-tab="creative" class="creative-only">Creative</button><button data-act="close" class="x">✕</button></div>
        <div class="inv-body">
          <div class="tab tab-inv"><div class="inv-roy"><img src="${photos.royHeadURL}"><p>You are Roy.<br>Roy is you.</p></div><div id="inv-main" class="grid"></div><div id="inv-hot" class="grid"></div></div>
          <div class="tab tab-craft hidden"><div id="recipes"></div></div>
          <div class="tab tab-creative hidden"><div id="palette" class="grid"></div></div>
        </div>
        <div id="inv-tip">Click a stack to pick it up, click a slot to drop it. Shift-click moves it.</div>
      </div></div>
      <div id="dialog" class="screen hidden"><div class="panel dlg"><div class="dlg-head"><div id="dlg-face"></div><div id="dlg-name"></div></div><p id="dlg-text"></p><div id="dlg-opts" class="menu"></div></div></div>
      <div id="death" class="screen hidden"><div class="panel death"><img class="roy-flip" src="${photos.royHeadURL}"><h1>You died!</h1><p id="death-msg"></p><p id="death-score"></p><div class="menu"><button data-act="respawn">Respawn</button><button data-act="quit">Title Screen</button></div></div></div>
      <div id="chat" class="hidden"><input id="chat-input" maxlength="120" autocomplete="off" placeholder="Say something, or /help"></div>
      <div id="cursor-stack"></div>
      <div id="rotate-hint">Turn your phone sideways for the best pickleball experience ↻</div>
    `);
    this.$ = (id) => document.getElementById(id);
    this.drawLogo();
    this.$('splash').textContent = pick(SPLASHES);
    // menu buttons
    this.root.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      this.game.audio.play('click');
      this.game.uiAction(b.dataset.act, b);
    });
    this.root.querySelectorAll('.inv-tabs button[data-tab]').forEach((b) => b.addEventListener('click', () => this.invTab(b.dataset.tab)));
    // chat
    const ci = this.$('chat-input');
    ci.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const v = ci.value.trim(); this.closeChat(); if (v) this.game.chatCommand(v); }
      if (e.key === 'Escape') this.closeChat();
    });
    // inventory cursor follows the pointer
    addEventListener('pointermove', (e) => { const c = this.$('cursor-stack'); c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; });
    this.buildHelp();
  }

  drawLogo() {
    const c = this.$('logo'), word = 'PICKLECRAFT', s = 9, depth = 4;
    const w = word.length * 6 * s + depth * 2, h = 7 * s + depth * 2;
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const tile = tileCanvases[TILE.pickle_block_side], top = tileCanvases[TILE.stone];
    let ox = 0;
    for (const ch of word) {
      const g = FONT[ch];
      for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) {
        if (g[y][x] !== '1') continue;
        const px = ox + x * s, py = y * s + depth;
        ctx.fillStyle = '#1d2e0c'; ctx.fillRect(px + depth, py + depth, s, s);
        ctx.drawImage(ch === 'C' && x === 0 && y === 3 ? top : tile, px, py, s, s);
      }
      ox += 6 * s;
    }
  }

  // ---------------- screens ----------------
  show(name) {
    for (const id of ['loading', 'title', 'pause', 'settings', 'help', 'inventory', 'dialog', 'death']) this.$(id).classList.toggle('hidden', id !== name);
    this.screen = name;
    this.$('hud').classList.toggle('hidden', name === 'title' || name === 'loading');
    document.body.classList.toggle('in-menu', !!name);
    if (name === 'title') this.$('splash').textContent = pick(SPLASHES);
    if (name === 'pause') this.root.querySelectorAll('.match-only').forEach((b) => b.classList.toggle('hidden', !this.game.match.active));
  }
  hideAll() { this.show(null); this.dropCursor(); }

  loadingTip(t) { this.$('loading-tip').textContent = t; }

  // ---------------- HUD ----------------
  updateHotbar() {
    const inv = this.game.player.inventory, hb = this.$('hotbar');
    if (hb.children.length !== 9) {
      hb.innerHTML = '';
      for (let i = 0; i < 9; i++) {
        const s = el('div', 'slot');
        s.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.game.player.inventory.select(i); });
        hb.appendChild(s);
      }
    }
    for (let i = 0; i < 9; i++) this.fillSlot(hb.children[i], inv.slots[i], i === inv.selected);
    const held = inv.held;
    const hn = this.$('held-name');
    const name = held ? itemName(held.id) : '';
    if (name !== this.lastHeldName) { this.lastHeldName = name; hn.textContent = name; hn.classList.remove('fade'); void hn.offsetWidth; hn.classList.add('fade'); }
    if (this.screen === 'inventory') this.renderInventory();
  }
  fillSlot(div, stack, selected = false) {
    div.classList.toggle('sel', selected);
    const key = stack ? stack.id + ':' + stack.count : '';
    if (div.dataset.key === key) return;
    div.dataset.key = key;
    div.innerHTML = stack ? `<img src="${iconURL(stack.id)}" draggable="false">${stack.count > 1 ? `<span>${stack.count}</span>` : ''}` : '';
    div.title = stack ? itemName(stack.id) : '';
  }
  updateStats() {
    const p = this.game.player;
    const hide = p.creative;
    this.$('stats').classList.toggle('hidden', hide);
    const key = Math.ceil(p.health) + ':' + Math.ceil(p.hunger);
    if (key === this.statKey) return;
    this.statKey = key;
    const heart = (i, v, img, cls) => { const full = v >= (i + 1) * 2, half = !full && v >= i * 2 + 1; return `<i class="${cls} ${full ? 'full' : half ? 'half' : 'empty'}" style="background-image:url(${img})"></i>`; };
    let h = ''; for (let i = 0; i < 10; i++) h += heart(i, p.health, photos.royHeadURL, 'heart');
    let f = ''; for (let i = 9; i >= 0; i--) f += heart(i, p.hunger, iconURL(I.PICKLE), 'food');
    this.$('hearts').innerHTML = h; this.$('hunger').innerHTML = f;
  }
  hurtFlash() { const h = this.$('hurt'); h.classList.remove('on'); void h.offsetWidth; h.classList.add('on'); }
  whiteFlash(dur = 1.2) { const f = this.$('flash'); f.style.transition = 'none'; f.style.opacity = 1; void f.offsetWidth; f.style.transition = `opacity ${dur}s`; f.style.opacity = 0; }
  underwater(on) { this.$('underwater').classList.toggle('on', on); }

  toast(title, text, icon = null, dur = 3.5) {
    const t = el('div', 'toast');
    const img = icon === 'roy' ? photos.royHeadURL : icon === 'suit' ? photos.suitCutoutURL : typeof icon === 'number' ? iconURL(icon) : null;
    t.innerHTML = `${img ? `<img src="${img}">` : ''}<div><b>${esc(title)}</b><br>${esc(text || '')}</div>`;
    this.$('toasts').appendChild(t);
    setTimeout(() => t.classList.add('out'), dur * 1000);
    setTimeout(() => t.remove(), dur * 1000 + 600);
  }
  pop(text) { const p = this.$('pop'); p.textContent = text; p.classList.remove('go'); void p.offsetWidth; p.classList.add('go'); }
  caption(name, text) {
    const c = this.$('captions');
    const line = el('div', 'cap', `${name ? `<b>${esc(name)}:</b> ` : ''}${esc(text)}`);
    c.appendChild(line);
    while (c.children.length > 3) c.firstChild.remove();
    setTimeout(() => line.classList.add('out'), 4500);
    setTimeout(() => line.remove(), 5200);
  }
  chatLog(html) {
    const c = this.$('chatlog');
    const line = el('div', 'msg', html);
    c.appendChild(line);
    while (c.children.length > 8) c.firstChild.remove();
    setTimeout(() => line.classList.add('out'), 9000);
  }
  bubble(entity, text) {
    const old = this.bubbles.find((b) => b.entity === entity);
    if (old) { old.div.remove(); this.bubbles.splice(this.bubbles.indexOf(old), 1); }
    const div = el('div', 'bubble', esc(text));
    this.$('bubbles').appendChild(div);
    this.bubbles.push({ entity, div, t: Math.min(7, 2.5 + text.length * 0.06) });
  }
  updateBubbles(dt, camera) {
    const w = innerWidth, h = innerHeight, v = new THREE.Vector3();
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.t -= dt;
      if (b.t <= 0 || b.entity.dead) { b.div.remove(); this.bubbles.splice(i, 1); continue; }
      v.set(b.entity.pos.x, b.entity.pos.y + b.entity.h + 0.55, b.entity.pos.z);
      const dist = v.distanceTo(camera.position);
      v.project(camera);
      const vis = v.z < 1 && dist < 24 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      b.div.style.display = vis ? '' : 'none';
      if (vis) { b.div.style.transform = `translate(-50%,-100%) translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px) scale(${Math.max(0.6, 1.2 - dist / 30)})`; b.div.style.opacity = Math.min(1, b.t * 2); }
    }
  }
  matchHud(d) {
    const m = this.$('match-hud');
    if (!d) { m.classList.add('hidden'); this.kitchenWarn(false); return; }
    m.classList.remove('hidden');
    m.innerHTML = `<div class="sc ${d.server === 'player' ? 'srv' : ''}"><span>YOU</span><b>${d.you}</b></div><div class="mid">to ${d.target}<br><small>${esc(d.msg)}</small></div><div class="sc ${d.server === 'ai' ? 'srv' : ''}"><span>${esc(d.oppName.toUpperCase())}</span><b>${d.opp}</b></div>`;
    document.body.classList.add('in-match');
  }
  kitchenWarn(on) { this.$('kitchen').classList.toggle('hidden', !on); if (!on && this.$('match-hud').classList.contains('hidden')) document.body.classList.remove('in-match'); }
  debug(text) { const d = this.$('debug'); d.classList.toggle('hidden', !text); if (text) d.textContent = text; }

  // ---------------- inventory ----------------
  openInventory() {
    this.show('inventory');
    this.$('inventory').classList.toggle('is-creative', this.game.player.creative);
    this.invTab(this.currentTab || 'inv');
  }
  invTab(tab) {
    if (tab === 'creative' && !this.game.player.creative) tab = 'inv';
    this.currentTab = tab;
    this.root.querySelectorAll('.inv-tabs button[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    for (const t of ['inv', 'craft', 'creative']) this.root.querySelector('.tab-' + t).classList.toggle('hidden', t !== tab);
    this.renderInventory();
  }
  renderInventory() {
    const inv = this.game.player.inventory;
    const main = this.$('inv-main'), hot = this.$('inv-hot');
    const mkSlots = (container, from, to) => {
      if (container.children.length !== to - from) {
        container.innerHTML = '';
        for (let i = from; i < to; i++) { const s = el('div', 'slot'); s.addEventListener('click', (e) => this.slotClick(i, e.shiftKey)); s.addEventListener('contextmenu', (e) => { e.preventDefault(); this.slotClick(i, false, true); }); container.appendChild(s); }
      }
      for (let i = from; i < to; i++) this.fillSlot(container.children[i - from], inv.slots[i], i === inv.selected);
    };
    mkSlots(main, 9, 36); mkSlots(hot, 0, 9);
    if (this.currentTab === 'craft') this.renderRecipes();
    if (this.currentTab === 'creative') this.renderPalette();
    const cs = this.$('cursor-stack');
    cs.innerHTML = this.cursor ? `<img src="${iconURL(this.cursor.id)}">${this.cursor.count > 1 ? `<span>${this.cursor.count}</span>` : ''}` : '';
  }
  slotClick(i, shift, right = false) {
    const inv = this.game.player.inventory, s = inv.slots[i];
    this.game.audio.play('click');
    if (shift && s && !this.cursor) {
      const range = i < 9 ? [9, 36] : [0, 9];
      inv.slots[i] = null;
      let left = s.count;
      for (let j = range[0]; j < range[1] && left; j++) { const t = inv.slots[j]; if (t && t.id === s.id && t.count < maxStack(s.id)) { const k = Math.min(left, maxStack(s.id) - t.count); t.count += k; left -= k; } }
      for (let j = range[0]; j < range[1] && left; j++) if (!inv.slots[j]) { inv.slots[j] = { id: s.id, count: left }; left = 0; }
      if (left) inv.slots[i] = { id: s.id, count: left };
    } else if (!this.cursor) {
      if (!s) return;
      if (right && s.count > 1) { const half = Math.ceil(s.count / 2); this.cursor = { id: s.id, count: half }; s.count -= half; }
      else { this.cursor = s; inv.slots[i] = null; }
    } else if (!s) {
      if (right) { inv.slots[i] = { id: this.cursor.id, count: 1 }; this.cursor.count--; if (!this.cursor.count) this.cursor = null; }
      else { inv.slots[i] = this.cursor; this.cursor = null; }
    } else if (s.id === this.cursor.id) {
      const k = Math.min(right ? 1 : this.cursor.count, maxStack(s.id) - s.count);
      s.count += k; this.cursor.count -= k; if (!this.cursor.count) this.cursor = null;
    } else { inv.slots[i] = this.cursor; this.cursor = s; }
    inv.onChange?.();
    this.renderInventory();
  }
  dropCursor() {
    if (!this.cursor) return;
    const left = this.game.player.inventory.add(this.cursor.id, this.cursor.count);
    if (left) { const p = this.game.player.pos; this.game.mobs.drop(this.cursor.id, left, p.x, p.y + 1.2, p.z); }
    this.cursor = null;
    this.$('cursor-stack').innerHTML = '';
  }
  renderRecipes() {
    const inv = this.game.player.inventory, box = this.$('recipes');
    box.innerHTML = '';
    const creative = this.game.player.creative;
    for (const r of RECIPES) {
      const can = creative || r.in.every(([id, n]) => inv.count(id) >= n);
      const row = el('button', 'recipe' + (can ? '' : ' no'));
      row.innerHTML = `<span class="ins">${r.in.map(([id, n]) => `<span class="ing" title="${esc(itemName(id))}"><img src="${iconURL(id)}"><small>${n}</small></span>`).join('<em>+</em>')}</span><em>➜</em><span class="ing out"><img src="${iconURL(r.out[0])}"><small>${r.out[1]}</small></span><span class="rname">${esc(itemName(r.out[0]))}</span>`;
      row.addEventListener('click', () => this.game.craft(r));
      box.appendChild(row);
    }
  }
  renderPalette() {
    const box = this.$('palette');
    if (box.children.length) return;
    const ids = [...BLOCKS.filter((b) => b && b.creative).map((b) => b.id), ...Object.keys(ITEMS).map(Number)];
    for (const id of ids) {
      const s = el('div', 'slot');
      s.innerHTML = `<img src="${iconURL(id)}">`; s.title = itemName(id);
      s.addEventListener('click', () => { const inv = this.game.player.inventory; inv.slots[inv.selected] = { id, count: isBlockItem(id) ? 64 : maxStack(id) }; inv.onChange?.(); this.game.audio.play('pop'); });
      box.appendChild(s);
    }
  }

  // ---------------- dialogs ----------------
  dialog({ name, text, face = null, options }) {
    this.show('dialog');
    this.$('dlg-name').textContent = name;
    this.$('dlg-text').textContent = text;
    const f = this.$('dlg-face');
    f.innerHTML = face === 'roy' ? `<img src="${photos.royHeadURL}">` : face === 'suit' ? `<img src="${photos.suitCutoutURL}">` : '<div class="vface"><i></i><i></i><b></b></div>';
    const o = this.$('dlg-opts');
    o.innerHTML = '';
    for (const opt of options) {
      const b = el('button', '', esc(opt.label));
      b.addEventListener('click', () => { this.game.audio.play('click'); opt.fn(); });
      o.appendChild(b);
    }
  }
  death(msg, score) {
    this.show('death');
    this.$('death-msg').textContent = msg;
    this.$('death-score').textContent = score || '';
  }

  // ---------------- chat ----------------
  openChat(prefix = '') {
    const c = this.$('chat'), i = this.$('chat-input');
    c.classList.remove('hidden');
    i.value = prefix; i.focus();
    this.chatOpen = true;
  }
  closeChat() { this.$('chat').classList.add('hidden'); this.$('chat-input').blur(); this.chatOpen = false; this.game.resumeInput(); }

  // ---------------- settings ----------------
  renderSettings() {
    const s = this.game.settings, body = this.$('settings-body');
    const rows = [
      ['renderDist', 'Render distance', 'range', 2, 10, 1, (v) => `${v} chunks`],
      ['sensitivity', 'Look sensitivity', 'range', 0.2, 3, 0.1, (v) => v.toFixed(1)],
      ['fov', 'Field of view', 'range', 55, 110, 1, (v) => `${v}°`],
      ['volume', 'Volume', 'range', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`],
      ['music', 'Music', 'bool'],
      ['voices', 'Villager voices (speech)', 'bool'],
      ['difficulty', 'Pickleball opponent', 'choice', ['easy', 'normal', 'hard']],
      ['landingMarker', 'Pickleball: show landing spot', 'bool'],
      ['aimAssist', 'Pickleball: aim assist', 'bool'],
      ['autoHustle', 'Pickleball: auto-run to the ball', 'bool'],
      ['peaceful', 'Peaceful (no suit men at night)', 'bool'],
      ['creative', 'Creative mode (fly: double-jump)', 'bool'],
      ['invertY', 'Invert look', 'bool'],
      ['showFps', 'Show FPS', 'bool'],
    ];
    body.innerHTML = '';
    for (const [key, label, type, a, b, step, fmt] of rows) {
      const row = el('label', 'set-row');
      if (type === 'range') {
        row.innerHTML = `<span>${label}: <b>${fmt(s[key])}</b></span><input type="range" min="${a}" max="${b}" step="${step}" value="${s[key]}">`;
        const inp = row.querySelector('input'), lab = row.querySelector('b');
        inp.addEventListener('input', () => { s[key] = parseFloat(inp.value); lab.textContent = fmt(s[key]); this.game.applySettings(); });
      } else if (type === 'bool') {
        row.innerHTML = `<span>${label}</span><button class="toggle">${s[key] ? 'ON' : 'OFF'}</button>`;
        const btn = row.querySelector('button');
        btn.addEventListener('click', (e) => { e.preventDefault(); s[key] = !s[key]; btn.textContent = s[key] ? 'ON' : 'OFF'; this.game.applySettings(); });
      } else {
        row.innerHTML = `<span>${label}</span><button class="toggle">${s[key]}</button>`;
        const btn = row.querySelector('button');
        btn.addEventListener('click', (e) => { e.preventDefault(); s[key] = a[(a.indexOf(s[key]) + 1) % a.length]; btn.textContent = s[key]; this.game.applySettings(); });
      }
      body.appendChild(row);
    }
    const reset = el('button', 'danger', 'Reset world (deletes your builds)');
    reset.addEventListener('click', () => this.game.resetWorld(reset));
    body.appendChild(reset);
  }

  buildHelp() {
    this.$('help-body').innerHTML = `
      <h3>Controls — computer</h3>
      <p><b>WASD</b> move · <b>Mouse</b> look · <b>Space</b> jump (double-tap to fly in creative) · <b>Shift</b> sneak · <b>Ctrl</b> or double-tap W sprint<br>
      <b>Left click</b> mine / attack / swing paddle · <b>Right click</b> place / talk / eat · <b>1–9</b> or wheel: hotbar · <b>E</b> inventory &amp; crafting<br>
      <b>F</b> swing paddle · <b>V</b> or <b>F5</b> camera · <b>Q</b> drop · <b>T</b> chat · <b>/</b> commands · <b>Esc</b> pause</p>
      <h3>Controls — phone</h3>
      <p>Left stick to move (push it all the way to sprint). Drag on the right to look. <b>Tap</b> to place, talk or eat. <b>Hold</b> to mine or attack. ⬆ jumps (double-tap to fly in creative), ⬇ sneaks. During a match, hit the big <b>SWING</b> button.</p>
      <h3>Pickleball</h3>
      <p>Talk to <b>Dinkleton</b> (yellow jersey, by the court) to play. Singles, first to 11 (or 5), win by 2. Only the server scores.</p>
      <ul>
        <li><b>Aim where you look.</b> Point the crosshair at a spot on the far court, then swing when the ball is near you. Closer is better: perfect timing gives a perfect shot.</li>
        <li><b>Serve</b> diagonally, past the kitchen line, into the box opposite you.</li>
        <li><b>Two-bounce rule:</b> the serve and the return must each bounce once before anyone hits them.</li>
        <li><b>The kitchen</b> (the light blue zone by the net): you may not volley (hit before the bounce) while standing in it.</li>
        <li>Aim into the kitchen for a soft <b>dink</b>, look up for a <b>lob</b>, and hit high balls near the net for a <b>smash</b>.</li>
        <li>The yellow ring shows where the ball will land. Auto-run can chase the ball for you (Settings).</li>
        <li><b>If you lose, you will be blown up.</b> The man in the forest does not like losers.</li>
      </ul>
      <h3>Survival</h3>
      <p>Your hearts are Roys. Your hunger is pickles: eat pickles from pickle ore, pickle plants and Roy chickens. At night the suit men come out of the forest. Craft paddles, pickaxes, Roy blocks and more in the Crafting tab.</p>
      <h3>Chat commands</h3>
      <p>/help · /day · /night · /roy · /suit · /court · /creative · /survival · /seed</p>`;
  }
}
