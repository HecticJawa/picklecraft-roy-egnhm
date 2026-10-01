// Picklecraft: game bootstrap, main loop, interactions, events and persistence.
import * as THREE from 'three';
import { loadPhotos, buildAtlas, photos, crackTextures, signCanvas, canvasTexture } from './textures.js';
import { World, GROUND, CS } from './world.js';
import { BLOCKS, B, AIR, isSolid } from './blocks.js';
import { I, ITEMS, itemName, isBlockItem, itemDamage, RECIPES } from './items.js';
import { buildStructures } from './structures.js';
import { Sky } from './sky.js';
import { Particles } from './particles.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { UI } from './ui.js';
import { Mobs, Villager, CreeperMan, ChickenRoy } from './mobs.js';
import { Match } from './pickleball.js';
import { makeRoy, makePaddle, makeItemMesh, makePicture } from './models.js';
import { clamp, lerp, pick, rand, angleDiff, isTouchDevice } from './util.js';

const SAVE_KEY = 'picklecraft.save.v1';
const SETTINGS_KEY = 'picklecraft.settings.v1';
const ROY_SAYS = ['I am watching you dink.', 'Have you eaten a pickle today?', 'Remember to bend your knees.', 'The kitchen is a state of mind.', 'I believe in you. Mostly.', 'Do not lose. You know what happens.', 'I am the sun now.', 'Nice block. Very square.', 'Hydrate. With brine.', 'Roy sees all. Roy dinks all.'];
const ROY_VOICE = { name: '☀ Roy', pitch: 0.35, rate: 0.85, hrmmPitch: 0.6 };
const SUIT_VOICE = { name: 'Big Suit', pitch: 0.05, rate: 0.6, hrmmPitch: 0.4 };

class Game {
  constructor() {
    this.touch = isTouchDevice() || new URLSearchParams(location.search).has('touch');
    this.settings = Object.assign({
      renderDist: this.touch ? 4 : 6, sensitivity: 1, fov: 75, volume: 0.8, music: true, voices: true,
      difficulty: 'normal', landingMarker: true, aimAssist: true, autoHustle: this.touch, peaceful: false,
      creative: false, invertY: false, showFps: false,
    }, readJSON(SETTINGS_KEY) || {});
    this.stats = { wins: 0, losses: 0, deaths: 0, achievements: {}, playTime: 0 };
    this.clock = new THREE.Clock();
    this.state = 'loading';
    this.cameraMode = 0; // 0 first person, 1 behind, 2 in front
    this.trauma = 0;
    this.lastChatter = 0;
    this.useCooldown = 0; this.attackCooldown = 0;
    this.mining = null;
    this.cutscene = null;
    this.royTimer = rand(200, 360); this.royRainTimer = rand(420, 800); this.royRain = 0;
  }

  // ---------------------------------------------------------------- setup
  async init() {
    const canvas = document.getElementById('game');
    this.canvas = canvas;
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio, this.touch ? 1.25 : 1.5));
    r.setSize(innerWidth, innerHeight, false);
    r.autoClear = false;
    this.renderer = r;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.06, 600);
    this.camera.rotation.order = 'YXZ';
    this.ambient = new THREE.AmbientLight(0xffffff, 0.75);
    this.sunLight = new THREE.DirectionalLight(0xffffff, 0.9);
    this.scene.add(this.ambient, this.sunLight);
    addEventListener('resize', () => this.resize());

    this.audio = new Audio(this.settings);
    await loadPhotos(); // the UI and atlas use the photos, so load them first
    const atlas = buildAtlas();
    this.ui = new UI(this);
    this.ui.show('loading');
    this.audio.onCaption = (n, t) => this.ui.caption(n, t);
    await nextFrame();

    this.materials = {
      solid: new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true, alphaTest: 0.5 }),
      water: new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide }),
      glow: new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true }),
    };
    this.world = new World(this.scene, this.materials);
    this.world.prepareRoymore();
    this.meta = buildStructures(this.world);
    this.spawn = this.meta.spawn;
    const save = readJSON(SAVE_KEY);
    if (save?.edits) this.world.loadEdits(save.edits);
    this.world.onBlockChanged = (x, y, z, old, id) => this.onBlockChanged(x, y, z, old, id);

    this.sky = new Sky(this.scene);
    this.particles = new Particles(this.scene, this.world);
    this.player = new Player();
    this.player.autoJump = this.touch;
    this.player.respawn(this.spawn);
    this.input = new Input(canvas, this.ui.root, this.settings);
    this.input.onAction = (a, arg) => this.onAction(a, arg);
    this.mobs = new Mobs(this);
    this.applySettings(false);

    // load the area around spawn before showing the title
    const tips = ['Roy is pickling the terrain.', 'Teaching villagers to say hrmm.', 'Ironing the suits.', 'Painting the kitchen line.', 'Carving Mount Roymore.', 'Inflating pickleballs.'];
    let i = 0;
    while (this.world.pendingNear(0, 0, Math.min(3, this.settings.renderDist))) {
      this.world.update(0, 0, 30);
      if (++i % 3 === 0) { this.ui.loadingTip(tips[(i / 3) % tips.length | 0]); await nextFrame(); }
    }
    this.buildDecor();
    this.spawnPeople();
    this.match = new Match(this, this.meta);
    this.buildHand();
    this.buildSelection();
    this.playerModel = makeRoy();
    this.scene.add(this.playerModel.root);
    this.playerPaddle = makePaddle(); this.playerPaddle.position.set(0, -0.72, 0.06); this.playerPaddle.rotation.x = Math.PI / 2;
    this.playerModel.armR.add(this.playerPaddle);

    // player state from the save
    this.player.inventory.onChange = () => { this.ui.updateHotbar(); this.rebuildHand(); };
    if (save?.player) {
      const p = save.player;
      this.player.pos.set(p.pos[0], p.pos[1], p.pos[2]); this.player.yaw = p.yaw; this.player.pitch = p.pitch;
      this.player.health = p.health ?? 20; this.player.hunger = p.hunger ?? 20;
      this.player.inventory.load(p.inv);
      this.sky.time = save.time ?? this.sky.time;
      Object.assign(this.stats, save.stats || {});
      this.hasSave = true;
    } else {
      this.player.inventory.add(I.PADDLE, 1);
      this.player.inventory.add(I.PICKLE, 5);
      this.player.inventory.add(B.ROY, 16);
      this.player.inventory.add(I.WOOD_PICK, 1);
    }
    this.ui.updateHotbar(); this.ui.updateStats();
    this.wirePlayer();

    this.state = 'title';
    this.ui.show('title');
    this.match.drawScoreboard();
    setInterval(() => { if (this.state === 'playing') this.save(); }, 15000);
    addEventListener('pagehide', () => { if (this.state === 'playing') this.save(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') { this.save(); this.pause(); } });
    this.renderer.setAnimationLoop(() => this.frame());
  }

  wirePlayer() {
    const p = this.player;
    p.onDamage = (amt) => { this.ui.hurtFlash(); this.audio.play('hurt'); this.ui.updateStats(); this.shake(Math.min(0.5, amt * 0.05)); };
    p.onDeath = (cause) => this.onDeath(cause);
    p.onStep = (id) => { if (id) this.audio.play('step', { mat: BLOCKS[id]?.sound || 'stone', vol: 0.6 }); };
    p.onLand = (d) => { if (d > 1.5) this.audio.play('step', { mat: 'stone', vol: 1 }); };
    p.onSplash = () => this.audio.play('splash');
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    if (this.handCam) { this.handCam.aspect = innerWidth / innerHeight; this.handCam.updateProjectionMatrix(); }
  }

  applySettings(persist = true) {
    const s = this.settings;
    this.world.renderDist = s.renderDist;
    this.camera.fov = s.fov; this.camera.updateProjectionMatrix();
    const far = (s.renderDist + 0.5) * CS;
    this.scene.fog = this.scene.fog || new THREE.Fog(0x8ec9ff, 20, 80);
    this.scene.fog.near = far * 0.6; this.scene.fog.far = far;
    this.audio.applyVolumes();
    if (this.player) {
      if (this.player.creative !== s.creative) { this.player.creative = s.creative; if (!s.creative) this.player.flying = false; this.ui?.updateStats(); }
    }
    if (!s.voices) this.audio.hush();
    if (s.peaceful && this.mobs) this.mobs.clearHostiles();
    if (persist) localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  }

  // Signs, posters, paintings and the golden statue.
  buildDecor() {
    const add = (obj, d) => { obj.position.set(d.x, d.y, d.z); obj.rotation.y = d.rotY || 0; this.scene.add(obj); return obj; };
    for (const s of this.meta.signs) add(makePicture(signCanvas(s.lines, { w: 320, h: 160, font: 'bold 22px monospace' }), s.w, s.h), s);
    for (const p of this.meta.posters) {
      const c = document.createElement('canvas'); c.width = 320; c.height = 400;
      const x = c.getContext('2d');
      if (p.kind === 'roy') {
        const g = x.createLinearGradient(0, 0, 0, 400); g.addColorStop(0, '#ffe14a'); g.addColorStop(1, '#f08a4b');
        x.fillStyle = g; x.fillRect(0, 0, 320, 400);
        x.drawImage(photos.royHead, 40, 20, 240, 300);
        x.fillStyle = '#2a1a08'; x.font = 'bold 22px monospace'; x.textAlign = 'center';
        const words = p.caption.split(': '); x.fillText(words[0] + ':', 160, 350); x.fillText(words[1], 160, 380);
      } else {
        x.fillStyle = '#f2ecd8'; x.fillRect(0, 0, 320, 400);
        x.fillStyle = '#7a1010'; x.font = 'bold 24px monospace'; x.textAlign = 'center'; x.fillText(p.caption, 160, 34);
        x.drawImage(photos.suitCutout, 30, 48, 260, 262);
        x.fillStyle = '#222'; x.font = 'bold 17px monospace'; x.fillText(p.sub, 160, 340); x.fillText('Reward: 1 pickle', 160, 372);
      }
      add(makePicture(c, p.w, p.h, { frame: 0x3a2a1a, border: 0.12 }), p);
    }
    for (const pt of this.meta.paintings) {
      const c = document.createElement('canvas'); c.width = 128; c.height = 128;
      const x = c.getContext('2d');
      x.fillStyle = pick(['#3d5a80', '#9a3b3b', '#4c8a2a', '#6b4a8a', '#c98a2a']); x.fillRect(0, 0, 128, 128);
      x.drawImage(photos.royHead, 24, 8, 80, 108);
      add(makePicture(c, pt.w, pt.h, { frame: 0xb38b4d }), pt);
    }
    // golden Roy statue on the fountain
    const st = this.meta.statue, roy = makeRoy({ gold: true });
    roy.root.scale.setScalar(st.scale);
    roy.armR.rotation.x = -2.7; roy.armL.rotation.z = -0.3;
    const pad = makePaddle(); pad.scale.setScalar(1.3); pad.position.set(0, -0.72, 0.06); pad.rotation.x = Math.PI / 2; roy.armR.add(pad);
    add(roy.root, st);
    this.statue = { pos: new THREE.Vector3(st.x, st.y, st.z), h: 2 * st.scale, hw: 0.4 * st.scale, model: roy };
  }

  spawnPeople() {
    const m = this.meta, S = GROUND + 1;
    const V = (x, z, o) => this.mobs.add(new Villager(this, x, S, z, o));
    this.dinkleton = V(-2.5, 11.5, { name: 'Dinkleton', outfit: 'pro', mode: 'player', paddle: true, role: 'stand', pitch: 1.9, rate: 1.2, lines: ['Hrmm! Fancy a game? Right-click me!', 'I have never lost. Well. Once. Hrmm.', 'My serve is legendary. Hrmm.', 'Want to play pickleball? Hrmm?'] });
    this.dinkleton.faceYaw = Math.atan2(this.spawn.x + 2.5, this.spawn.z - 11.5);
    this.dinkleton.home = { x: -2.5, z: 11.5, r: 0 };
    this.referee = V(m.refSpot.x, m.refSpot.z, { name: 'Referee Hrmmbert', outfit: 'referee', role: 'ref', seat: m.refSpot, pitch: 1.6, rate: 1.05, lines: ['I call them like I smell them. Hrmm.', 'Stripes are slimming.', 'No volleys in the kitchen!'] });
    const fanNames = ['Volleyanne', 'Sir Kitchen', 'Lobbert', 'Paddleton', 'Brinella', 'Gherk', 'Dilliam'];
    const fanOutfits = ['fan', 'plain', 'farmer', 'fan', 'librarian', 'priest', 'fan'];
    m.seats.forEach((seat, i) => {
      let sign = null;
      if (i % 3 === 0) { sign = makePicture(photos.royHead, 0.55, 0.7, { frame: 0xffffff, border: 0.04 }); }
      V(seat.x, seat.z, { name: fanNames[i % fanNames.length], outfit: fanOutfits[i % fanOutfits.length], role: 'sit', seat: { ...seat, yaw: -Math.PI / 2 }, sign });
    });
    const names = ['Nasal Steve', 'Hrmmeline', 'Picklebert', 'Sourdough Sam', 'Cornichon Carl', 'Bread-and-Butter Barb', 'Professor Hrmmington'];
    const outfits = ['farmer', 'plain', 'fan', 'farmer', 'plain', 'librarian', 'librarian'];
    m.houses.forEach((h, i) => V(h.door.x, h.door.z + (h.door.z < 0 ? 2 : -2), { name: names[i % names.length], outfit: outfits[i % outfits.length], home: { x: h.door.x, z: h.door.z < 0 ? -4 : 4, r: 9 } }));
    this.priest = V(46.5, 5.5, { name: 'Brother Brine', outfit: 'priest', home: { x: 46.5, z: 6.5, r: 3 }, pitch: 1.3, rate: 0.95, lines: ['Roy giveth. Roy dinketh.', 'Bless this pickle.', 'Kneel before the golden Roy. Or don\'t. Hrmm.'] });
    for (let i = 0; i < 5; i++) this.mobs.add(new ChickenRoy(this, rand(m.farm.x0 + 3, m.farm.x1 - 3), S + 1, rand(m.farm.z0 + 3, m.farm.z1 - 3), m.farm));
  }

  // ---------------------------------------------------------------- first-person hand & selection
  buildHand() {
    this.handScene = new THREE.Scene();
    this.handCam = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 10);
    this.handScene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dl = new THREE.DirectionalLight(0xffffff, 0.7); dl.position.set(1, 2, 1); this.handScene.add(dl);
    this.hand = new THREE.Group();
    this.handScene.add(this.hand);
    const skin = new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${photos.roySkin})`) });
    const sleeve = new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${photos.royShirt})`) });
    this.arm = new THREE.Group();
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.6), skin); a.position.z = 0.1;
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.22), sleeve); s.position.z = 0.32;
    this.arm.add(a, s);
    this.arm.position.set(0.42, -0.42, -0.55); this.arm.rotation.set(0.2, -0.25, 0.1);
    this.hand.add(this.arm);
    this.heldMesh = null; this.handSwing = 0; this.heldKey = null;
    this.rebuildHand();
  }
  rebuildHand() {
    if (!this.hand) return;
    const id = this.player.inventory.heldId;
    if (this.heldKey === id) return;
    this.heldKey = id;
    if (this.heldMesh) this.hand.remove(this.heldMesh);
    this.heldMesh = null;
    this.arm.visible = !id;
    if (!id) return;
    let m;
    if (id === I.PADDLE) { m = makePaddle(); m.scale.setScalar(1.05); m.position.set(0.5, -0.5, -0.72); m.rotation.set(-0.15, -0.45, 0.2); }
    else if (isBlockItem(id) && !BLOCKS[id].cross) { m = makeItemMesh(id, 0.32); m.position.set(0.48, -0.42, -0.7); m.rotation.set(0.1, 0.8, 0); }
    else { m = makeItemMesh(id, 0.4); m.position.set(0.44, -0.36, -0.62); m.rotation.set(0, -1.2, 0.2); }
    this.heldMesh = m;
    this.hand.add(m);
    this.playerPaddle && (this.playerPaddle.visible = id === I.PADDLE);
  }
  swingHand() { this.handSwing = 1; }

  buildSelection() {
    const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    this.selBox = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 }));
    this.selBox.visible = false;
    this.scene.add(this.selBox);
    this.cracks = crackTextures();
    this.crackMat = new THREE.MeshBasicMaterial({ map: this.cracks[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.crackBox = new THREE.Mesh(new THREE.BoxGeometry(1.002, 1.002, 1.002), this.crackMat);
    this.crackBox.visible = false;
    this.scene.add(this.crackBox);
  }

  // ---------------------------------------------------------------- flow
  startPlaying() {
    this.audio.unlock();
    this.state = 'playing';
    this.ui.hideAll();
    this.resumeInput();
    if (this.touch) { try { document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {}); } catch { /* not supported */ } }
    if (!this.stats.achievements.start) {
      setTimeout(() => {
        this.achieve('start', 'Welcome to Picklecraft', 'Spawned next to a pickleball court. Roy is watching.');
        this.dinkleton.say('Hrmm! Welcome to Picklecraft! Come talk to me if you want to play pickleball!');
      }, 1200);
    }
  }
  resumeInput() {
    if (this.state !== 'playing' || this.ui.screen || this.ui.chatOpen) return;
    this.input.enabled = true;
    if (!this.touch) this.input.lock();
  }
  pause() {
    if (this.state !== 'playing' || this.player.dead) return;
    this.input.enabled = false;
    this.input.unlock();
    this.ui.show('pause');
    this.paused = true; this.pausedAt = performance.now();
  }
  unpause() { this.paused = false; this.ui.hideAll(); this.resumeInput(); }

  uiAction(act, btn) {
    switch (act) {
      case 'play': this.startPlaying(); break;
      case 'resume': this.unpause(); break;
      case 'help': this.prevScreen = this.ui.screen; this.ui.show('help'); break;
      case 'settings': this.prevScreen = this.ui.screen; this.ui.renderSettings(); this.ui.show('settings'); break;
      case 'back': this.ui.show(this.prevScreen || (this.state === 'playing' ? 'pause' : 'title')); break;
      case 'close': this.closeMenus(); break;
      case 'respawn': this.respawn(); break;
      case 'forfeit': this.paused = false; this.ui.hideAll(); this.resumeInput(); this.match.forfeit(); break;
      case 'quit':
        if (this.match.active) this.match.stop();
        this.endCutscene();
        if (this.player.dead) this.player.respawn(this.spawn);
        this.save(); this.state = 'title'; this.paused = false; this.input.enabled = false; this.input.unlock();
        this.ui.show('title'); break;
    }
    void btn;
  }
  closeMenus() { this.ui.dropCursor(); this.ui.hideAll(); this.resumeInput(); }

  onAction(a, arg) {
    if (this.state !== 'playing') return;
    const p = this.player;
    if (a === 'unlocked') { if (!this.ui.screen && !this.ui.chatOpen && !p.dead && !this.suppressPause) this.pause(); this.suppressPause = false; return; }
    if (a === 'pause') { if (this.ui.screen === 'pause') this.unpause(); else if (!this.ui.screen) this.pause(); return; }
    if (a === 'escape') {
      const s = this.ui.screen;
      if (s === 'inventory' || s === 'dialog') this.closeMenus();
      else if (s === 'settings' || s === 'help') this.uiAction('back');
      else if (s === 'pause' && performance.now() - this.pausedAt > 400) this.unpause();
      return;
    }
    if (a === 'inventory') {
      if (this.ui.screen === 'inventory') { this.closeMenus(); return; }
      if (this.ui.screen || p.dead || this.ui.chatOpen) return;
      this.suppressPause = true; this.input.enabled = false; this.input.unlock();
      this.ui.openInventory(); return;
    }
    if (!this.input.enabled || p.dead) return;
    switch (a) {
      case 'hotbar': p.inventory.select(arg); break;
      case 'hotbar-scroll': p.inventory.select(p.inventory.selected + arg); break;
      case 'chat': this.suppressPause = true; this.input.enabled = false; this.input.unlock(); this.ui.openChat(arg); break;
      case 'camera': this.cameraMode = (this.cameraMode + 1) % 3; break;
      case 'toggleFly': if (p.creative) { p.flying = !p.flying; p.vel.y = 0; } break;
      case 'drop': { const h = p.inventory.held; if (h) { const f = p.lookDir(); const d = this.mobs.drop(h.id, 1, p.pos.x + f.x, p.pos.y + 1.4, p.pos.z + f.z); d.age = -0.6; d.vel.set(f.x * 5, 3, f.z * 5); p.inventory.takeHeld(1); } break; }
      case 'swing': if (this.match.active) this.match.playerSwing(); else this.swingHand(); break;
      case 'attack': this.primary(); break;
      case 'use': this.secondary(); break;
      case 'tap': if (this.match.active) this.match.playerSwing(); else this.secondary(true); break;
      case 'pick': { const t = this.target; if (t?.block && p.creative) { const inv = p.inventory; inv.slots[inv.selected] = { id: t.block.id, count: 64 }; inv.onChange(); } break; }
    }
  }

  // ---------------------------------------------------------------- interactions
  updateTarget() {
    const p = this.player, eye = p.eye, dir = p.lookDir(), reach = p.creative ? 7 : 5;
    const ent = this.mobs.raycast(eye, dir, reach);
    const blk = this.world.raycast(eye, dir, reach);
    let statue = null;
    if (this.statue) {
      const s = this.statue, t = rayBox(eye, dir, s.pos.x - s.hw, s.pos.y, s.pos.z - s.hw, s.pos.x + s.hw, s.pos.y + s.h, s.pos.z + s.hw, reach + 3);
      if (t !== null) statue = t;
    }
    if (statue !== null && (!blk || statue < blk.dist) && (!ent || statue < ent.dist)) this.target = { statue: true, dist: statue };
    else if (ent && (!blk || ent.dist < blk.dist)) this.target = { entity: ent.entity, dist: ent.dist };
    else if (blk) this.target = { block: blk, dist: blk.dist };
    else this.target = null;
  }

  primary() {
    const p = this.player;
    this.swingHand();
    if (this.match.active) { this.match.playerSwing(); return; }
    const t = this.target;
    if (t?.entity && this.attackCooldown <= 0) {
      this.attackCooldown = 0.45;
      const dmg = itemDamage(p.inventory.heldId) * (p.vel.y < -1 ? 1.5 : 1);
      t.entity.hurt(dmg, p.pos);
      this.audio.play('hurt', { pos: t.entity.pos, vol: 0.6 });
      if (t.entity instanceof ChickenRoy) this.audio.play('cluck', { pos: t.entity.pos });
    }
  }

  secondary(fromTap = false) {
    const p = this.player, t = this.target, held = p.inventory.held;
    if (this.useCooldown > 0 && !fromTap) return;
    this.useCooldown = 0.22;
    if (t?.statue) { this.talkToStatue(); return; }
    if (t?.entity) {
      if (t.entity.isVillager) { this.talkTo(t.entity); return; }
      if (fromTap) { this.attackCooldown = 0; this.primary(); return; }
    }
    if (held && !isBlockItem(held.id) && ITEMS[held.id]?.food) {
      if (p.hunger < 20 || p.health < 20) { this.audio.play('eat'); p.eat(ITEMS[held.id].food, ITEMS[held.id].heal || 0); p.inventory.takeHeld(1); this.ui.updateStats(); this.achieve('eat', 'Brined', 'Ate a pickle.'); this.particles.sparkle(p.pos.x, p.pos.y + 1.4, p.pos.z, [0.5, 0.9, 0.3]); }
      return;
    }
    if (t?.block) {
      const b = t.block;
      if (b.id === B.CRAFTING_TABLE) { this.onAction('inventory'); this.ui.invTab('craft'); return; }
      if (!held || !isBlockItem(held.id)) return;
      let x = b.x + b.nx, y = b.y + b.ny, z = b.z + b.nz;
      const tb = BLOCKS[b.id];
      if (tb.cross && !BLOCKS[held.id].cross) { x = b.x; y = b.y; z = b.z; } // replace grass tufts
      const cur = this.world.getBlock(x, y, z);
      if (cur !== AIR && cur !== B.WATER && !BLOCKS[cur].cross) return;
      const nb = BLOCKS[held.id];
      if (nb.cross && !isSolid(this.world.getBlock(x, y - 1, z))) return;
      if (nb.solid && this.blockOverlapsBodies(x, y, z)) return;
      if (this.world.setBlock(x, y, z, held.id)) {
        this.audio.play('place', { mat: nb.sound });
        this.swingHand();
        if (!p.creative) p.inventory.takeHeld(1);
        if (held.id === B.ROY) this.achieve('roy-block', 'Roy Builder', 'Placed a Roy block. There can never be too many.');
      }
    }
  }
  blockOverlapsBodies(x, y, z) {
    const bodies = [{ pos: this.player.pos, hw: 0.3, h: 1.8 }, ...this.mobs.list.filter((e) => !e.dead && e.h > 0.3)];
    return bodies.some((e) => e.pos.x + e.hw > x && e.pos.x - e.hw < x + 1 && e.pos.z + e.hw > z && e.pos.z - e.hw < z + 1 && e.pos.y + e.h > y && e.pos.y < y + 1);
  }

  updateMining(dt) {
    const p = this.player, t = this.target;
    const active = this.input.attackHeld && this.input.enabled && !this.match.active && t?.block && !p.dead;
    if (!active) { this.mining = null; this.crackBox.visible = false; return; }
    const b = t.block, def = BLOCKS[b.id];
    if (!this.mining || this.mining.x !== b.x || this.mining.y !== b.y || this.mining.z !== b.z) this.mining = { x: b.x, y: b.y, z: b.z, progress: 0, soundT: 0 };
    const m = this.mining;
    if (def.protected || def.hardness === Infinity) {
      if (!this.protectedWarned || performance.now() - this.protectedWarned > 4000) {
        this.protectedWarned = performance.now();
        if (def.protected) this.referee.say(pick(['Hrmm! That court is protected by the Pickleball Commission!', 'Do not touch my court. Hrmm.', 'The court is sacred! Hrmm!']));
      }
      return;
    }
    let time;
    if (p.creative) time = 0.12;
    else {
      const it = ITEMS[p.inventory.heldId];
      const power = it?.tool && it.tool === def.tool ? it.power : 1;
      time = Math.max(0.05, def.hardness * 1.2 / power);
      if (def.tool === 'pick' && !(it?.tool === 'pick')) time *= 2.2;
    }
    m.progress += dt / time;
    m.soundT -= dt;
    if (m.soundT <= 0) { m.soundT = 0.22; this.audio.play('dig', { mat: def.sound, vol: 0.6 }); this.swingHand(); }
    this.crackBox.visible = true;
    this.crackBox.position.set(b.x + 0.5, b.y + 0.5, b.z + 0.5);
    this.crackMat.map = this.cracks[clamp(Math.floor(m.progress * 10), 0, 9)];
    if (m.progress >= 1) {
      this.world.setBlock(b.x, b.y, b.z, AIR);
      this.audio.play('dig', { mat: def.sound });
      const rgb = blockColor(b.id);
      this.particles.blockBreak(b.x, b.y, b.z, rgb);
      if (!p.creative && def.drop) this.mobs.drop(def.drop, 1, b.x + 0.5, b.y + 0.3, b.z + 0.5);
      if (b.id === B.PICKLE_ORE) this.achieve('pickle-ore', 'Pickle Miner', 'Mined pickle ore. Pickles grow in rocks here.');
      if (b.id === B.ROY) this.audio.say(ROY_VOICE, pick(['Ow.', 'Hey.', 'Rude.', 'Why.']), { hrmm: false });
      this.mining = null; this.crackBox.visible = false;
    }
  }

  onBlockChanged(x, y, z, old, id) {
    // water does not flow, but breaking a block next to water lets it fill in (one level only)
    if (id === AIR && y <= 26) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (this.world.getBlock(x + dx, y, z + dz) === B.WATER) { setTimeout(() => this.world.getBlock(x, y, z) === AIR && this.world.setBlock(x, y, z, B.WATER), 300); break; }
    }
    void old;
  }

  craft(r) {
    const inv = this.player.inventory;
    if (!this.player.creative && !r.in.every(([id, n]) => inv.count(id) >= n)) { this.audio.play('click'); return; }
    if (!this.player.creative) for (const [id, n] of r.in) inv.remove(id, n);
    const left = inv.add(r.out[0], r.out[1]);
    if (left) this.mobs.drop(r.out[0], left, this.player.pos.x, this.player.pos.y + 1, this.player.pos.z);
    this.audio.play('pop');
    if (r.out[0] === I.PADDLE) this.achieve('craft-paddle', 'Paddle Your Own Pickle', 'Crafted a Roy Paddle.');
    if (r.out[0] === I.ROY_SWORD) this.achieve('roy-sword', 'The Roy-al Treatment', 'Crafted the Roy-al Sword.');
    this.ui.renderInventory();
  }

  // ---------------------------------------------------------------- conversations
  canChatter() { const t = performance.now(); if (t - this.lastChatter < 9000) return false; this.lastChatter = t; return true; }

  openDialog(opts) { this.suppressPause = true; this.input.enabled = false; this.input.unlock(); this.ui.dialog(opts); }

  talkTo(v) {
    const done = () => this.closeMenus();
    const sayAndClose = (text) => { v.say(text); done(); };
    if (this.match.active && (v === this.dinkleton || v === this.referee)) return;
    v.lookTarget = null;
    this.audio.hrmm({ pitch: v.voice.hrmmPitch, kind: 'question', pos: v.pos });
    if (v === this.dinkleton) {
      const text = this.stats.losses > this.stats.wins ? 'Hrmm. Back for more? Same rules as always: lose, and the forest gets you.' : 'Hrmm! Fancy a game of pickleball? First to eleven, win by two. The loser... hrmm. You will see.';
      v.say(text);
      this.openDialog({ name: v.name, text, options: [
        { label: '🏓 Play! (first to 11)', fn: () => { done(); this.startMatch(11); } },
        { label: '⚡ Quick game (first to 5)', fn: () => { done(); this.startMatch(5); } },
        { label: '❓ What are the rules?', fn: () => { const t = 'Serve underhand, diagonally, past the kitchen. The serve and the return must bounce. No volleys from the kitchen. Only the server scores. Aim where you look, swing when the ball is close.'; v.say(t); this.ui.dialog({ name: v.name, text: t, options: [{ label: 'Got it. Let\'s play! (to 11)', fn: () => { done(); this.startMatch(11); } }, { label: 'Quick game (to 5)', fn: () => { done(); this.startMatch(5); } }, { label: 'Bye', fn: done }] }); } },
        { label: '🕴 Who lives in the forest?', fn: () => sayAndClose('Big Suit. He loves pickleball. He hates losers. He is very, very big. Hrmm.') },
        { label: 'Bye', fn: done },
      ] });
      return;
    }
    if (v === this.referee) {
      const text = 'I am Referee Hrmmbert. I have the stripes, so I am always right. Hrmm.';
      v.say(text);
      this.openDialog({ name: v.name, text, options: [{ label: 'Start a match (to 11)', fn: () => { done(); this.startMatch(11); } }, { label: 'Why are you nasal?', fn: () => sayAndClose('I am not nasal. You are nasal. Hrmm.') }, { label: 'Bye', fn: done }] });
      return;
    }
    if (v === this.priest) {
      const text = 'Hrmm. Do you seek the blessing of Roy?';
      v.say(text);
      this.openDialog({ name: v.name, text, options: [{ label: '🙏 Yes, bless me', fn: () => { done(); v.say('By the power of Roy... let it rain!'); this.startRoyRain(10); this.achieve('blessed', 'Roy-ally Blessed', 'It rained Roys.'); } }, { label: 'No thanks', fn: done }] });
      return;
    }
    if (v.outfit === 'farmer' || v.name === 'Nasal Steve') {
      const text = 'Hrmm! Want to trade? We use pickles here. Emeralds are a myth.';
      v.say(text);
      const inv = this.player.inventory;
      const trades = [
        { give: [B.COBBLE, 8], get: [I.PICKLE, 1] }, { give: [B.DIRT, 16], get: [I.PICKLE, 1] }, { give: [I.PINK_TIE, 1], get: [I.PICKLE, 5] },
        { give: [I.PICKLE, 3], get: [I.PADDLE, 1] }, { give: [I.PICKLE, 10], get: [I.DIAMOND, 1] }, { give: [I.PICKLE, 2], get: [B.ROY, 8] },
      ];
      const tradeOpts = trades.map((t) => ({ label: `${t.give[1]} ${itemName(t.give[0])} → ${t.get[1]} ${itemName(t.get[0])}${inv.count(t.give[0]) >= t.give[1] || this.player.creative ? '' : ' (need more)'}`, fn: () => {
        if (!this.player.creative && inv.count(t.give[0]) < t.give[1]) { v.say('Hrmm. You do not have enough.'); return; }
        if (!this.player.creative) inv.remove(t.give[0], t.give[1]);
        inv.add(t.get[0], t.get[1]); this.audio.play('levelup'); v.say(pick(['Hrmm! Pleasure doing business.', 'Hrmm-hrmm!', 'Enjoy your pickle.']));
        this.achieve('trade', 'Pickle Economy', 'Traded with a villager.'); done();
      } }));
      this.openDialog({ name: v.name, text, options: [...tradeOpts, { label: 'Bye', fn: done }] });
      return;
    }
    const lore = ['Roy fell from the sky one day. Some say Roy IS the sky.', 'The mountain carved itself. We woke up and there was Roy.', 'The chickens on the farm have Roy\'s face. We do not talk about it.', 'Big Suit has never lost a game of pickleball. He has never played one, either.', 'Long ago we used emeralds. Then Roy brought pickles.'];
    const line = pick(v.lines === undefined ? lore : [...v.lines, ...lore]);
    v.say(line);
    this.openDialog({ name: v.name, text: line, options: [{ label: 'Tell me more', fn: () => { const l = pick(lore); v.say(l); this.ui.dialog({ name: v.name, text: l, options: [{ label: 'Hrmm. Bye.', fn: done }] }); } }, { label: 'Bye', fn: done }] });
  }

  talkToStatue() {
    this.achieve('statue', 'Golden Boy', 'Spoke with the golden statue of Roy.');
    const line = pick(['I am Roy. Dink responsibly.', 'Bow before my paddle.', 'Yes, I am solid gold. Yes, I am also the sun.', 'You look like you need a pickle.']);
    this.audio.say(ROY_VOICE, line, { hrmm: false, priority: true });
    this.statue.model.root.rotation.z = 0.05;
    setTimeout(() => (this.statue.model.root.rotation.z = 0), 300);
  }

  startMatch(target) {
    if (this.match.active || this.cutscene) return;
    this.dinkleton.role = 'scripted';
    this.match.start({ opponent: this.dinkleton, referee: this.referee, target, difficulty: this.settings.difficulty });
  }

  // ---------------------------------------------------------------- match results
  onMatchOver(won, final, opp) {
    const fans = this.mobs.villagers.filter((v) => v.role === 'sit');
    opp.role = 'stand'; opp.pos.set(-2.5, GROUND + 1, 11.5);
    if (won) {
      this.stats.wins++;
      this.audio.play('fanfare');
      this.audio.play('cheer');
      for (const f of fans) f.cheer = 4;
      this.referee.say(`Game! The winner is... you! ${final}! Hrmm!`, { priority: true });
      this.ui.toast('YOU WIN!', `Final score ${final}. Roy is proud.`, 'roy', 6);
      this.player.inventory.add(I.GOLDEN_ROY, 1);
      this.achieve('win', 'Pickle Champion', 'Won a pickleball match. Have a Golden Roy.');
      this.sky.spinBoost = 12;
      for (let i = 0; i < 6; i++) setTimeout(() => { this.particles.burst(rand(-5, 5), GROUND + 9 + rand(0, 4), rand(-6, 6)); this.audio.play('pop', { vol: 0.8 }); }, i * 450);
      this.startRoyRain(6);
      setTimeout(() => this.audio.say(ROY_VOICE, 'Nice dinks.', { hrmm: false }), 2500);
      setTimeout(() => opp.say('Hrmm. Rematch? Talk to me any time.'), 6000);
    } else {
      this.stats.losses++;
      this.startBigSuit(final);
    }
    this.match.drawScoreboard();
    this.save();
  }

  startBigSuit(final) {
    const p = this.player;
    this.cutscene = { t: 0, phase: 0, final };
    p.frozen = true; p.autoTarget = null; p.lockMove = false;
    this.mobs.clearHostiles();
    this.audio.play('gasp');
    this.audio.play('doom');
    this.referee.say('Oh no. Hrmm. You lost. You know the rule.', { priority: true });
    this.ui.toast('YOU LOST', `Final score ${final}. The forest stirs...`, 'suit', 6);
    for (const v of this.mobs.villagers) v.lookTarget = new THREE.Vector3(this.meta.bigSuitStart.x, GROUND + 4, this.meta.bigSuitStart.z);
  }
  updateCutscene(dt) {
    const c = this.cutscene; if (!c) return;
    const p = this.player, start = this.meta.bigSuitStart;
    c.t += dt;
    const look = (tx, ty, tz, rate = 2.5) => {
      const e = p.eye, dx = tx - e.x, dy = ty - e.y, dz = tz - e.z;
      const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
      p.yaw += angleDiff(p.yaw, yaw) * Math.min(1, rate * dt); p.pitch += (pitch - p.pitch) * Math.min(1, rate * dt);
    };
    if (c.phase === 0 && c.t > 1.8) { c.phase = 1; this.audio.play('rustle', { pos: { x: -27, y: GROUND + 4, z: 0 }, vol: 1.5 }); for (let i = 0; i < 40; i++) this.particles.debris.spawn(-27 + rand(-1, 1), GROUND + rand(3, 8), rand(-4, 4), rand(0, 3), rand(0, 3), rand(-2, 2), 0.2, 0.5, 0.15, 1.5); }
    if (c.phase >= 1 && c.phase < 3) look(-27, GROUND + 4, start.z);
    if (c.phase === 1 && c.t > 3.0) {
      c.phase = 2;
      const y = this.world.baseHeight(Math.floor(start.x), Math.floor(start.z)) + 1;
      const big = new CreeperMan(this, start.x, y, start.z, { scale: 3.6, big: true });
      big.mode = 'walk'; big.speed = 5.2; big.yaw = Math.PI / 2;
      big.onFuse = () => { this.audio.say(SUIT_VOICE, 'Good game.', { hrmm: false, priority: true }); this.ui.bubble(big, 'Good game.'); };
      this.mobs.add(big);
      c.big = big;
      this.audio.play('scream');
      for (const v of this.mobs.villagers) { if (v.role === 'sit' || v.role === 'ref') continue; v.fleeFrom = { x: start.x, z: start.z }; v.fleeTimer = 8; }
      for (const v of this.mobs.villagers) if (v.role === 'sit') v.cheer = 0;
    }
    if (c.big && !c.big.dead) {
      const b = c.big;
      if (c.phase === 2 && b.mode !== 'walk') c.phase = 3;
      look(b.pos.x, b.pos.y + b.h * 0.8, b.pos.z, c.phase === 3 ? 4 : 2);
      // bulldoze trees on the way out of the forest
      c.crushT = (c.crushT || 0) - dt;
      if (c.crushT <= 0) {
        c.crushT = 0.15;
        for (let y = 0; y < 7; y++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const bx = Math.floor(b.pos.x) + dx, by = Math.floor(b.pos.y) + y, bz = Math.floor(b.pos.z) + dz, id = this.world.getBlock(bx, by, bz);
          if (id === B.LEAVES || id === B.LOG || id === B.TALL_GRASS || id === B.FLOWER_RED || id === B.FLOWER_YELLOW) { this.world.setBlock(bx, by, bz, AIR); if (Math.random() < 0.3) this.particles.blockBreak(bx, by, bz, blockColor(id), 6); }
        }
      }
    }
    if (c.phase >= 2 && c.big?.dead && !p.dead) p.kill('was blown up by Big Suit for losing at pickleball');
  }
  endCutscene() {
    if (!this.cutscene) return;
    if (this.cutscene.big && !this.cutscene.big.dead) this.cutscene.big.remove();
    this.cutscene = null;
    this.player.frozen = false;
    for (const v of this.mobs.villagers) { v.lookTarget = null; v.fleeTimer = 0; }
  }

  // ---------------------------------------------------------------- damage, death
  explosion(x, y, z, radius, source) {
    const changed = this.world.explode(x, y, z, radius);
    this.particles.explosion(x, y, z, radius);
    this.audio.play('explosion', { pos: { x, y, z }, vol: radius > 4 ? 2 : 1 });
    const p = this.player;
    const d = Math.hypot(p.pos.x - x, p.pos.y + 0.9 - y, p.pos.z - z);
    this.shake(clamp(1.2 - d / (radius * 4), 0.2, 1.2));
    if (d < radius * 1.2) this.ui.whiteFlash(radius > 4 ? 2.5 : 0.6);
    const cause = source === 'Big Suit' ? 'was blown up by Big Suit for losing at pickleball' : `was blown up by ${source}`;
    if (d < radius * 2) p.damage(Math.round((1 - d / (radius * 2)) * (radius > 4 ? 80 : 26)), cause, { x, z });
    for (const e of this.mobs.list) {
      if (e.dead) continue;
      const ed = Math.hypot(e.pos.x - x, e.pos.y - y, e.pos.z - z);
      if (ed < radius * 2 && !e.big) e.hurt(Math.round((1 - ed / (radius * 2)) * 20), { x, z });
    }
    let n = 0;
    for (const [bx, by, bz, id] of changed) {
      if (Math.random() < 0.18 && n < 30 && BLOCKS[id].drop && radius < 5) { this.mobs.drop(BLOCKS[id].drop, 1, bx + 0.5, by + 0.5, bz + 0.5); n++; }
    }
  }
  onDeath(cause) {
    this.stats.deaths++;
    this.input.enabled = false; this.input.unlock();
    this.audio.play('hurt');
    if (this.match.active) this.match.stop();
    const lostMatch = cause.includes('pickleball');
    if (lostMatch) this.achieve('lose', 'Dinked to Death', 'Lost at pickleball. Got exploded. Classic.');
    setTimeout(() => {
      this.ui.death(`Roy ${cause}.`, lostMatch ? `Final score: ${this.cutscene?.final || ''} · Record: ${this.stats.wins}W - ${this.stats.losses}L` : `Record: ${this.stats.wins}W - ${this.stats.losses}L`);
    }, lostMatch ? 1400 : 700);
  }
  respawn() {
    this.endCutscene();
    this.player.respawn(this.spawn);
    this.dinkleton.role = 'stand'; this.dinkleton.pos.set(-2.5, GROUND + 1, 11.5);
    this.ui.hideAll(); this.ui.updateStats();
    this.resumeInput();
    if (this.stats.losses && Math.random() < 0.8) setTimeout(() => this.dinkleton.say(pick(['Hrmm. Rematch?', 'You exploded beautifully. Hrmm.', 'Big Suit says hi.'])), 1500);
  }
  shake(a) { this.trauma = Math.min(1.5, this.trauma + a); }

  achieve(id, title, desc) {
    if (this.stats.achievements[id]) return;
    this.stats.achievements[id] = Date.now();
    this.ui.toast('Achievement get!', `${title} — ${desc}`, 'roy', 5);
    this.audio.play('levelup');
  }

  startRoyRain(seconds = 12) {
    this.royRain = seconds;
    this.ui.toast('It\'s raining Roys!', 'Hallelujah.', 'roy', 4);
  }

  // ---------------------------------------------------------------- chat
  chatCommand(text) {
    const p = this.player;
    if (!text.startsWith('/')) {
      this.ui.chatLog(`<b>&lt;You&gt;</b> ${text.replace(/</g, '&lt;')}`);
      const near = this.mobs.villagers.filter((v) => v.pos.distanceTo(p.pos) < 12).sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos))[0];
      if (near) setTimeout(() => near.say(`${text}? Hrmm.`), 500);
      else setTimeout(() => this.audio.say(ROY_VOICE, `${text}.`, { hrmm: false }), 500);
      return;
    }
    const [cmd, ...args] = text.slice(1).split(/\s+/);
    const msg = (m) => this.ui.chatLog(m);
    switch (cmd.toLowerCase()) {
      case 'help': msg('/day /night /roy /suit /court /creative /survival /seed /give pickle'); break;
      case 'day': this.sky.time = 0.1; msg('Roy has risen.'); break;
      case 'night': this.sky.time = 0.58; msg('Roy is sleepy.'); break;
      case 'roy': this.startRoyRain(12); break;
      case 'suit': { const f = p.lookDir(); this.mobs.add(new CreeperMan(this, p.pos.x + f.x * 8, p.pos.y + 1, p.pos.z + f.z * 8)); msg('A suit appears. He looks hungry for a game.'); break; }
      case 'court': p.pos.set(this.spawn.x, this.spawn.y, this.spawn.z); p.vel.set(0, 0, 0); msg('Teleported to the court.'); break;
      case 'creative': this.settings.creative = true; this.applySettings(); msg('Creative mode. Double-tap jump to fly.'); break;
      case 'survival': this.settings.creative = false; this.applySettings(); msg('Survival mode.'); break;
      case 'seed': msg('Seed: 20261001 (Roy\'s favourite number).'); break;
      case 'give': { const key = (args[0] || '').toUpperCase(); const id = I[key] ?? B[key]; if (id) { p.inventory.add(id, +args[1] || (isBlockItem(id) ? 64 : 1)); msg(`Gave ${itemName(id)}.`); } else msg('Unknown item.'); break; }
      default: msg('Unknown command. Try /help');
    }
  }

  // ---------------------------------------------------------------- persistence
  save() {
    try {
      const p = this.player;
      localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, edits: this.world.serializeEdits(), time: this.sky.time, stats: this.stats, player: { pos: [p.pos.x, p.pos.y, p.pos.z], yaw: p.yaw, pitch: p.pitch, health: p.health, hunger: p.hunger, inv: p.inventory.toJSON() } }));
    } catch (e) { console.warn('save failed', e); }
  }
  resetWorld(btn) {
    if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'Click again to delete your world'; return; }
    localStorage.removeItem(SAVE_KEY);
    this.state = 'resetting';
    location.reload();
  }

  // ---------------------------------------------------------------- frame
  frame() {
    const rawDt = Math.min(this.clock.getDelta(), 0.1);
    const p = this.player, cam = this.camera;
    const playing = this.state === 'playing' && !this.paused;
    const dt = playing ? rawDt : 0;

    if (this.state === 'title') {
      // slow orbit around the court for the title background
      const t = performance.now() / 1000 * 0.05;
      cam.position.set(Math.sin(t) * 24, GROUND + 11, 12 + Math.cos(t) * 18);
      cam.lookAt(0, GROUND + 6, -14);
      this.world.update(cam.position.x, cam.position.z, 4);
      this.sky.update(rawDt * 0.3, cam);
      this.applyDaylight();
      this.mobs.update(rawDt * 0.0001);
      this.renderer.clear();
      this.renderer.render(this.scene, cam);
      return;
    }

    if (playing) {
      this.stats.playTime += dt;
      this.useCooldown -= dt; this.attackCooldown -= dt;
      p.update(dt, this.input, this.world);
      if (!this.world.isLoaded(Math.floor(p.pos.x), Math.floor(p.pos.z))) { p.vel.y = Math.max(p.vel.y, 0); }
      this.world.update(p.pos.x, p.pos.z, this.touch ? 4 : 6);
      this.updateTarget();
      this.updateMining(dt);
      if (this.input.useHeld && this.useCooldown <= 0 && !this.match.active) this.secondary();
      this.mobs.update(dt);
      this.match.update(dt);
      this.updateCutscene(dt);
      this.sky.update(dt, cam);
      this.particles.update(dt);
      this.audio.update(dt, this.match.active);
      this.events(dt);
    }
    this.applyDaylight();

    // camera
    const eye = p.eye;
    const shake = this.trauma * this.trauma;
    this.trauma = Math.max(0, this.trauma - rawDt * 1.4);
    const sx = (Math.random() - 0.5) * shake * 0.6, sy = (Math.random() - 0.5) * shake * 0.6;
    cam.rotation.set(p.pitch + sy * 0.2, p.yaw + sx * 0.2, 0);
    const bob = p.onGround && !p.flying ? Math.sin(p.walkDist * 2.2) * 0.05 * Math.min(1, Math.hypot(p.vel.x, p.vel.z) / 4) : 0;
    if (this.cameraMode === 0) cam.position.set(eye.x, eye.y + bob + sy, eye.z);
    else {
      const f = p.lookDir(), sign = this.cameraMode === 1 ? -1 : 1;
      let dist = 4;
      for (let d = 0.3; d <= 4; d += 0.2) { if (isSolid(this.world.getBlock(Math.floor(eye.x + f.x * d * sign), Math.floor(eye.y + f.y * d * sign), Math.floor(eye.z + f.z * d * sign)))) { dist = d - 0.3; break; } }
      cam.position.set(eye.x + f.x * dist * sign, eye.y + f.y * dist * sign, eye.z + f.z * dist * sign);
      if (this.cameraMode === 2) cam.lookAt(eye);
    }
    this.audio.listener = cam.position;

    // player model (third person) and hand (first person)
    const pm = this.playerModel;
    pm.root.visible = this.cameraMode !== 0;
    pm.root.position.copy(p.pos); pm.root.rotation.y = p.yaw + Math.PI;
    pm.head.rotation.x = -p.pitch;
    const sw = Math.sin(p.walkDist * 2.2) * Math.min(1, Math.hypot(p.vel.x, p.vel.z) / 4) * 0.8;
    pm.legL.rotation.x = sw; pm.legR.rotation.x = -sw; pm.armL.rotation.x = -sw;
    this.handSwing = Math.max(0, this.handSwing - rawDt * 4);
    const hs = Math.sin((1 - this.handSwing) * Math.PI) * (this.handSwing > 0 ? 1 : 0);
    pm.armR.rotation.x = sw - hs * 2;
    this.hand.visible = this.cameraMode === 0 && !p.dead;
    this.hand.position.set(Math.sin(p.walkDist * 1.1) * 0.03 * (p.onGround ? 1 : 0), bob * 0.6 - hs * 0.15, 0);
    this.hand.rotation.set(-hs * 1.1, hs * 0.4, 0);

    // selection box
    const t = this.target;
    this.selBox.visible = !!(t?.block) && playing && !this.match.active && this.cameraMode === 0;
    if (this.selBox.visible) this.selBox.position.set(t.block.x + 0.5, t.block.y + 0.5, t.block.z + 0.5);

    this.ui.updateBubbles(rawDt, cam);
    this.ui.updateStats();
    this.ui.underwater(p.headInWater && this.cameraMode === 0);
    this.updateDebug(rawDt);

    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    if (this.hand.visible) { this.renderer.clearDepth(); this.renderer.render(this.handScene, this.handCam); }
  }

  applyDaylight() {
    const d = this.sky.daylight, sc = this.sky.skyColor;
    const blockLight = lerp(0.2, 1, d);
    this.materials.solid.color.setScalar(blockLight);
    this.materials.water.color.setScalar(blockLight);
    this.match && (this.match.courtMat.color.setScalar(Math.max(0.35, blockLight)), this.match.netMat.color.setScalar(blockLight));
    this.ambient.intensity = lerp(0.18, 0.78, d);
    this.sunLight.intensity = lerp(0.05, 0.85, d);
    this.sunLight.position.copy(this.sky.sunDir).multiplyScalar(10);
    this.scene.background = sc;
    this.scene.fog.color.copy(sc);
    if (this.player.headInWater && this.cameraMode === 0) { this.scene.fog.color.set(0x1a3a8a); }
  }

  events(dt) {
    const p = this.player;
    // Roy occasionally speaks from the sky
    this.royTimer -= dt;
    if (this.royTimer <= 0) { this.royTimer = rand(240, 420); if (!this.match.active && !this.cutscene) this.audio.say(ROY_VOICE, pick(ROY_SAYS), { hrmm: false }); }
    // random Roy showers
    this.royRainTimer -= dt;
    if (this.royRainTimer <= 0) { this.royRainTimer = rand(600, 1100); if (!this.match.active) this.startRoyRain(10); }
    if (this.royRain > 0) {
      this.royRain -= dt;
      this.royRainAcc = (this.royRainAcc || 0) + dt;
      while (this.royRainAcc > 0.08) {
        this.royRainAcc -= 0.08;
        const a = Math.random() * Math.PI * 2, r = rand(3.5, 16); // never right on top of the camera
        this.particles.roy(p.pos.x + Math.cos(a) * r, p.pos.y + rand(14, 22), p.pos.z + Math.sin(a) * r, { vy: -4, size: rand(0.6, 1.4) });
      }
    }
    // achievements by exploring
    if (p.pos.z < -37 && p.pos.y > GROUND + 40) this.achieve('roymore', 'Mount Roymore', 'Climbed to the top of Roy.');
    if (this.sky.isNight) this.achieve('night', 'Roy Goes to Sleep', 'Survived until the moon came out. The moon is also Roy.');
    if (!this.chickenSeen && this.mobs.list.some((e) => e instanceof ChickenRoy && e.pos.distanceTo(p.pos) < 3)) { this.chickenSeen = true; this.achieve('chicken', 'Why Did Roy Cross the Road', 'Met a chicken with Roy\'s face.'); }
  }

  updateDebug(dt) {
    if (!this.settings.showFps) { if (this.dbgOn) { this.ui.debug(null); this.dbgOn = false; } return; }
    this.dbgOn = true;
    this.fpsAcc = (this.fpsAcc || 0) + dt; this.fpsN = (this.fpsN || 0) + 1;
    if (this.fpsAcc > 0.5) {
      const p = this.player.pos;
      this.ui.debug(`${Math.round(this.fpsN / this.fpsAcc)} fps · ${this.world.chunks.size} chunks · ${this.renderer.info.render.calls} draws\nxyz ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`);
      this.fpsAcc = 0; this.fpsN = 0;
    }
  }
}

// Player.kill bypasses creative mode (for the Big Suit gag).
Player.prototype.kill = function (cause) { this.creative = false; this.invuln = 0; this.damage(999, cause); this.creative = game.settings.creative; };

function readJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
// Yield to the browser; falls back to a timer when the tab is hidden (rAF pauses there).
function nextFrame() { return new Promise((r) => { requestAnimationFrame(() => r()); setTimeout(r, 40); }); }
function blockColor(id) {
  const c = BLOCKS[id]?.color;
  if (c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  const map = { [B.GRASS]: [94, 157, 52], [B.DIRT]: [134, 96, 67], [B.STONE]: [127, 127, 127], [B.COBBLE]: [110, 110, 110], [B.SAND]: [219, 206, 160], [B.LOG]: [104, 82, 50], [B.LEAVES]: [58, 122, 34], [B.PLANKS]: [162, 130, 78], [B.ROY]: [220, 170, 140], [B.PICKLE_ORE]: [88, 184, 58], [B.PICKLE_BLOCK]: [96, 146, 46] };
  return map[id] || [140, 140, 140];
}
function rayBox(o, d, x0, y0, z0, x1, y1, z1, max) {
  let tmin = 0, tmax = max;
  for (const [oo, dd, a, b] of [[o.x, d.x, x0, x1], [o.y, d.y, y0, y1], [o.z, d.z, z0, z1]]) {
    if (Math.abs(dd) < 1e-8) { if (oo < a || oo > b) return null; continue; }
    let t1 = (a - oo) / dd, t2 = (b - oo) / dd; if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) return null;
  }
  return tmin;
}

const game = new Game();
window.game = game; // handy for debugging from the console
game.init().catch((e) => {
  console.error(e);
  document.getElementById('ui').innerHTML = `<div style="padding:20px;font:16px monospace;background:#300;color:#fff;pointer-events:auto">Picklecraft failed to start: ${String(e.message || e)}</div>`;
});
