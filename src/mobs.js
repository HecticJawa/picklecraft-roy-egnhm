// Entities: villagers, suit creeper-men, Roy chickens and item drops.
import * as THREE from 'three';
import { isSolid, B, BLOCKS } from './blocks.js';
import { I, isBlockItem } from './items.js';
import { makeVillager, makeCreeperMan, makeChickenRoy, makeItemMesh, makePaddle } from './models.js';
import { clamp, rand, pick, angleDiff } from './util.js';
import { GROUND, FOREST, PLAZA } from './world.js';

// Move an axis-aligned body through the voxel world. Returns { onGround, blocked }.
function moveBody(world, e, dt) {
  const { hw, h } = e;
  const hits = (x, y, z) => world.boxHitsSolid(x - hw, y, z - hw, x + hw, y + h, z + hw);
  const d = e.vel.clone().multiplyScalar(dt);
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(d.x), Math.abs(d.y), Math.abs(d.z)) / 0.35));
  d.divideScalar(steps);
  let onGround = false, blocked = false;
  for (let s = 0; s < steps; s++) {
    if (d.y) {
      const ny = e.pos.y + d.y;
      if (hits(e.pos.x, ny, e.pos.z)) { if (d.y < 0) { e.pos.y = Math.floor(ny) + 1; onGround = true; } else e.pos.y = Math.floor(ny + h) - h - 0.001; e.vel.y = 0; d.y = 0; }
      else e.pos.y = ny;
    }
    if (d.x) { const nx = e.pos.x + d.x; if (hits(nx, e.pos.y, e.pos.z)) { blocked = true; e.vel.x = 0; d.x = 0; } else e.pos.x = nx; }
    if (d.z) { const nz = e.pos.z + d.z; if (hits(e.pos.x, e.pos.y, nz)) { blocked = true; e.vel.z = 0; d.z = 0; } else e.pos.z = nz; }
  }
  if (!onGround && e.vel.y <= 0 && hits(e.pos.x, e.pos.y - 0.03, e.pos.z)) onGround = true;
  return { onGround, blocked };
}

class Entity {
  constructor(game, x, y, z, { hw = 0.3, h = 1.8, health = 20 } = {}) {
    this.game = game;
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.headYaw = 0;
    this.hw = hw; this.h = h;
    this.health = health; this.maxHealth = health;
    this.onGround = false; this.blocked = false;
    this.walkPhase = 0; this.dead = false; this.hurtTimer = 0;
    this.gravity = true;
  }
  get world() { return this.game.world; }
  physics(dt) {
    if (!this.world.isLoaded(Math.floor(this.pos.x), Math.floor(this.pos.z))) return; // wait for terrain
    if (this.gravity) this.vel.y = Math.max(this.vel.y - 28 * dt, -50);
    const inWater = this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.3), Math.floor(this.pos.z)) === B.WATER;
    if (inWater) { this.vel.y = Math.min(this.vel.y + 40 * dt, 2.5); }
    const r = moveBody(this.world, this, dt);
    this.onGround = r.onGround; this.blocked = r.blocked;
    if (this.pos.y < -30) this.remove();
  }
  walkToward(tx, tz, speed, dt, turnRate = 8) {
    const dx = tx - this.pos.x, dz = tz - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.05) { this.vel.x *= 0.5; this.vel.z *= 0.5; return d; }
    const want = Math.atan2(dx, dz);
    this.yaw += angleDiff(this.yaw, want) * Math.min(1, turnRate * dt);
    const s = Math.min(speed, d / Math.max(dt, 1e-3));
    this.vel.x = Math.sin(want) * s; this.vel.z = Math.cos(want) * s;
    if (this.blocked && this.onGround) this.vel.y = 8.2; // hop up a block
    return d;
  }
  stop() { this.vel.x = 0; this.vel.z = 0; }
  animateLegs(dt, parts) {
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.walkPhase += dt * sp * 4.5;
    const sw = Math.sin(this.walkPhase) * Math.min(1, sp / 2) * 0.8;
    if (parts.legL) { parts.legL.rotation.x = sw; parts.legR.rotation.x = -sw; }
    return sw;
  }
  hurt(amount, from) {
    if (this.dead) return;
    this.health -= amount; this.hurtTimer = 0.3;
    if (from) { const dx = this.pos.x - from.x, dz = this.pos.z - from.z, d = Math.hypot(dx, dz) || 1; this.vel.x += (dx / d) * 7; this.vel.z += (dz / d) * 7; this.vel.y = 5; }
    if (this.health <= 0) this.die();
  }
  die() { this.remove(); }
  remove() { this.dead = true; if (this.parts) this.game.scene.remove(this.parts.root); }
  // ray vs this entity's box
  rayHit(o, d, max) {
    const x0 = this.pos.x - this.hw - 0.1, x1 = this.pos.x + this.hw + 0.1, y0 = this.pos.y, y1 = this.pos.y + this.h, z0 = this.pos.z - this.hw - 0.1, z1 = this.pos.z + this.hw + 0.1;
    let tmin = 0, tmax = max;
    for (const [oo, dd, a, b] of [[o.x, d.x, x0, x1], [o.y, d.y, y0, y1], [o.z, d.z, z0, z1]]) {
      if (Math.abs(dd) < 1e-8) { if (oo < a || oo > b) return null; continue; }
      let t1 = (a - oo) / dd, t2 = (b - oo) / dd; if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) return null;
    }
    return tmin;
  }
}

// ---------------- villagers ----------------
export const VILLAGER_LINES = [
  'Hrmm. Have you met Roy? He is the sun.',
  'Hrmm, hrmm. Hrmmm.',
  'I traded my house for one pickle. Worth it.',
  'Do not go into the forest. The suit man lives there.',
  'The kitchen is not for cooking. Hrmm.',
  'Dink responsibly.',
  'Roy is watching. Roy is always watching.',
  'Nice paddle. Is that Roy on it?',
  'I lost at pickleball once. Then I exploded. Hrmm.',
  'Hrmm? Hrmmm!',
  'Pickles are not a vegetable. Pickles are a lifestyle.',
  'Two bounce rule! Two! Bounce!',
  'My cousin is a chicken with Roy\'s face. Long story.',
  'Kitchen violation! Sorry. Reflex.',
  'The moon is also Roy. He is sleeping. Shh.',
  'Have you tried the mountain? It has a face.',
  'I am not nasal. You are nasal.',
  'Hrmm. Emeralds? Never heard of them. We use pickles.',
];

export class Villager extends Entity {
  constructor(game, x, y, z, o) {
    super(game, x, y, z, { hw: 0.3, h: 1.9, health: 20 });
    this.name = o.name;
    this.outfit = o.outfit || 'plain';
    this.voice = { name: o.name, pitch: o.pitch ?? rand(1.45, 2), rate: o.rate ?? rand(1.05, 1.3), hrmmPitch: o.hrmmPitch ?? rand(0.9, 1.5) };
    this.role = o.role || 'wander';
    this.home = o.home || { x, z, r: 6 };
    this.seat = o.seat || null;
    this.parts = makeVillager({ outfit: this.outfit, mode: o.mode || 'crossed' });
    this.parts.root.userData.entity = this;
    game.scene.add(this.parts.root);
    this.target = null; this.idle = rand(1, 4);
    this.chatTimer = rand(6, 20);
    this.cheer = 0; this.sad = 0;
    this.lookTarget = null;
    this.swing = 0;
    this.speed = 1.3;
    this.fleeFrom = null; this.fleeTimer = 0;
    this.lines = o.lines || VILLAGER_LINES;
    this.isVillager = true;
    if (o.paddle) this.givePaddle();
    if (o.sign) this.giveSign(o.sign);
  }
  givePaddle() {
    if (this.paddle || !this.parts.armR) return;
    this.paddle = makePaddle();
    this.paddle.position.set(0, -0.72, 0.06);
    this.paddle.rotation.x = Math.PI / 2;
    this.parts.armR.add(this.paddle);
  }
  // A fan's Roy sign: held up on a stick beside and above the head, so it never covers the face.
  giveSign(mesh) {
    const holder = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.95, 0.04), new THREE.MeshLambertMaterial({ color: 0x6b4f2a }));
    stick.position.set(0, 0.47, 0);
    mesh.position.set(0, 0.95 + 0.36, 0);
    holder.add(stick, mesh);
    holder.position.set(0.3, 0.95, 0.2); // right of the body, rising from the hands
    this.parts.model.add(holder);
    this.signMesh = holder;
  }
  say(text, opts = {}) {
    this.game.audio.say(this.voice, text, { pos: this.pos, ...opts });
    this.game.ui.bubble(this, text);
  }
  hurt(amount, from) {
    // villagers are protected by the Pickleball Commission: knockback only
    if (from) { const dx = this.pos.x - from.x, dz = this.pos.z - from.z, d = Math.hypot(dx, dz) || 1; this.vel.x += (dx / d) * 5; this.vel.z += (dz / d) * 5; this.vel.y = 4; }
    this.hurtTimer = 0.3;
    if (this.role === 'wander' || this.role === 'stand') { this.fleeFrom = from ? { x: from.x, z: from.z } : null; this.fleeTimer = 2; }
    if (Math.random() < 0.6) this.say(pick(['Hrmm! Rude!', 'Ow. Hrmm.', 'I am telling Roy.', 'Hrmmph!']));
  }
  update(dt) {
    const g = this.game, p = g.player;
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    const toPlayer = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    let lookAt = this.lookTarget || (toPlayer < 8 ? p.eye : null);

    if (this.fleeTimer > 0 && this.fleeFrom) {
      this.fleeTimer -= dt;
      const dx = this.pos.x - this.fleeFrom.x, dz = this.pos.z - this.fleeFrom.z, d = Math.hypot(dx, dz) || 1;
      this.walkToward(this.pos.x + dx / d * 4, this.pos.z + dz / d * 4, 4.2, dt);
    } else if (this.role === 'sit' && this.seat) {
      this.pos.set(this.seat.x, this.seat.y - 0.62, this.seat.z); this.vel.set(0, 0, 0);
      this.yaw = this.seat.yaw ?? -Math.PI / 2;
    } else if (this.role === 'ref' && this.seat) {
      this.pos.set(this.seat.x, this.seat.y, this.seat.z); this.vel.set(0, 0, 0);
      this.yaw = Math.PI / 2;
    } else if (this.role === 'scripted') {
      // position driven by the pickleball match (this.target set every frame)
      if (this.target) this.walkToward(this.target.x, this.target.z, this.target.speed ?? 4.5, dt, 14);
      else this.stop();
      if (this.faceYaw !== undefined && Math.hypot(this.vel.x, this.vel.z) < 0.5) this.yaw += angleDiff(this.yaw, this.faceYaw) * Math.min(1, 6 * dt);
    } else if (this.role === 'stand') {
      this.stop();
      if (this.faceYaw !== undefined) this.yaw += angleDiff(this.yaw, this.faceYaw) * Math.min(1, 4 * dt);
    } else {
      // wander around home
      if (!this.target) {
        this.idle -= dt; this.stop();
        if (this.idle <= 0) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * this.home.r;
          this.target = { x: this.home.x + Math.cos(a) * r, z: this.home.z + Math.sin(a) * r, t: 12 };
        }
      } else {
        this.target.t -= dt;
        const d = this.walkToward(this.target.x, this.target.z, this.speed, dt);
        if (d < 0.4 || this.target.t <= 0) { this.target = null; this.idle = rand(2, 7); }
      }
      if (toPlayer < 3 && !this.target) lookAt = p.eye;
    }

    // ambient chatter near the player
    this.chatTimer -= dt;
    if (this.chatTimer <= 0) {
      this.chatTimer = rand(14, 30);
      if (toPlayer < 7 && !g.match?.active && !g.cutscene && g.canChatter()) this.say(pick(this.lines));
      else if (toPlayer < 14 && Math.random() < 0.4) g.audio.hrmm({ pitch: this.voice.hrmmPitch, pos: this.pos, vol: 0.5 });
    }

    // cheering / sulking
    if (this.cheer > 0) { this.cheer -= dt; if (this.onGround && this.role !== 'sit') this.vel.y = 6; }
    if (this.role !== 'sit' && this.role !== 'ref') this.physics(dt);
    else if (this.cheer > 0) this.parts.model.position.y = Math.abs(Math.sin(this.cheer * 12)) * 0.4;
    else this.parts.model.position.y = 0;

    // model
    const P = this.parts;
    P.root.position.copy(this.pos);
    P.root.rotation.y = this.yaw;
    if (this.role === 'sit') { P.legL.rotation.x = P.legR.rotation.x = -Math.PI / 2; }
    else this.animateLegs(dt, P);
    if (lookAt) {
      const dx = lookAt.x - this.pos.x, dz = lookAt.z - this.pos.z, dy = lookAt.y - (this.pos.y + 1.6);
      const want = clamp(angleDiff(this.yaw, Math.atan2(dx, dz)), -1.1, 1.1);
      this.headYaw += (want - this.headYaw) * Math.min(1, 8 * dt);
      P.head.rotation.x = clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.6, 0.6);
    } else { this.headYaw *= 1 - Math.min(1, 4 * dt); P.head.rotation.x *= 0.9; }
    P.head.rotation.y = this.headYaw;
    P.head.rotation.z = this.sad > 0 ? 0.25 : 0;
    if (this.sad > 0) this.sad -= dt;
    if (P.armR) {
      this.swing = Math.max(0, this.swing - dt * 4);
      const sw = this.swing > 0 ? Math.sin((1 - this.swing) * Math.PI) : 0;
      P.armR.rotation.x = -0.4 - sw * 1.8;
      P.armR.rotation.z = sw * 0.6;
      P.armL.rotation.x = Math.sin(this.walkPhase) * 0.5;
      if (this.cheer > 0) { P.armL.rotation.x = P.armR.rotation.x = -2.8 + Math.sin(this.cheer * 20) * 0.3; }
    }
  }
}

// ---------------- suit creeper-men ----------------
export class CreeperMan extends Entity {
  constructor(game, x, y, z, { scale = 1, big = false } = {}) {
    super(game, x, y, z, { hw: 0.32 * scale, h: 1.75 * scale, health: big ? 999 : 20 });
    this.scale = scale; this.big = big;
    this.parts = makeCreeperMan();
    this.parts.root.scale.setScalar(scale);
    this.parts.root.userData.entity = this;
    game.scene.add(this.parts.root);
    this.fuse = 0; this.fuseTime = big ? 2.2 : 1.5;
    this.hissed = false;
    this.wanderT = 0; this.wanderTarget = null;
    this.isCreeper = true;
    this.radius = big ? 7 : 3.2;
    this.speed = big ? 4.6 : 2.9;
    this.scripted = big;
  }
  update(dt) {
    const g = this.game, p = g.player;
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z, dist = Math.hypot(dx, dz, (p.pos.y - this.pos.y) * 0.5);
    let chasing = false;
    if (this.scripted) {
      // Big Suit: walk to the player, then explode. Driven by main.js cutscene.
      if (this.mode === 'walk') {
        this.walkToward(p.pos.x, p.pos.z, this.speed, dt, 3);
        // speak well before the boom: iOS can mute Web Audio while speech is playing
        if (!this.spoke && dist < 17) { this.spoke = true; this.onNear?.(); }
        if (dist < 5.5) { this.mode = 'fuse'; this.stop(); }
        this.stompT = (this.stompT || 0) - dt;
        if (this.stompT <= 0 && Math.hypot(this.vel.x, this.vel.z) > 0.5) { this.stompT = 0.42; g.audio.play('stomp', { pos: this.pos, vol: 1.3 }); g.shake(0.35); }
      } else if (this.mode === 'fuse') {
        this.stop();
        this.yaw += angleDiff(this.yaw, Math.atan2(dx, dz)) * Math.min(1, 5 * dt);
        if (!this.hissed) { this.hissed = true; g.audio.play('hiss', { pos: this.pos, vol: 1.5 }); this.onFuse?.(); }
        this.fuse += dt;
      }
    } else {
      const avoidCourt = g.match?.active && Math.hypot(this.pos.x, this.pos.z) < 26;
      if (avoidCourt) { this.remove(); g.particles.smokePuff(this.pos.x, this.pos.y + 1, this.pos.z, 12); return; }
      if (!p.dead && !p.creative && dist < 18) {
        chasing = true;
        if (dist > 2.2) this.walkToward(p.pos.x, p.pos.z, this.speed, dt);
        else { this.stop(); this.yaw += angleDiff(this.yaw, Math.atan2(dx, dz)) * Math.min(1, 6 * dt); }
        if (dist < 2.8) {
          if (!this.hissed) { this.hissed = true; g.audio.play('hiss', { pos: this.pos }); }
          this.fuse += dt;
        } else if (dist > 6 || this.fuse > 0) {
          this.fuse = Math.max(0, this.fuse - dt * (dist > 6 ? 1 : 0.4));
          if (this.fuse === 0) this.hissed = false;
        }
      } else {
        this.fuse = Math.max(0, this.fuse - dt);
        this.wanderT -= dt;
        if (this.wanderT <= 0) { this.wanderT = rand(3, 8); this.wanderTarget = Math.random() < 0.6 ? { x: this.pos.x + rand(-8, 8), z: this.pos.z + rand(-8, 8) } : null; }
        if (this.wanderTarget) { if (this.walkToward(this.wanderTarget.x, this.wanderTarget.z, 1.1, dt) < 0.5) this.wanderTarget = null; }
        else this.stop();
      }
      if (dist > 80) { this.remove(); return; }
    }
    if (this.fuse >= this.fuseTime) { this.explode(); return; }
    if (this.big) {
      // Big Suit wades through trees and follows the terrain
      this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
      const gy = Math.max(this.world.baseHeight(Math.floor(this.pos.x), Math.floor(this.pos.z)) + 1, GROUND + 1);
      this.pos.y += (gy - this.pos.y) * Math.min(1, 6 * dt);
    } else this.physics(dt);
    const P = this.parts;
    P.root.position.copy(this.pos);
    P.root.rotation.y = this.yaw;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.walkPhase += dt * sp * 5 / this.scale;
    const sw = Math.sin(this.walkPhase) * Math.min(1, sp) * 0.6;
    P.legs[0].rotation.x = sw; P.legs[3].rotation.x = sw; P.legs[1].rotation.x = -sw; P.legs[2].rotation.x = -sw;
    const f = this.fuse / this.fuseTime;
    const swell = 1 + f * 0.25 + (f > 0 ? Math.sin(this.fuse * 30) * 0.03 * f : 0);
    P.model.scale.set(swell, 1 + f * 0.12, swell);
    P.flashMat.color.set(this.hurtTimer > 0 ? 0xff3030 : 0xffffff);
    P.flashMat.opacity = this.hurtTimer > 0 ? 0.45 : f > 0 ? (Math.sin(this.fuse * (8 + f * 20)) > 0 ? 0.65 * f : 0) : 0;
    P.head.rotation.x = chasing ? -0.15 : 0;
  }
  explode() {
    const g = this.game;
    this.remove();
    if (this.big) g.audio.hush(); // nothing talking over (or muting) the boom
    g.explosion(this.pos.x, this.pos.y + 0.8 * this.scale, this.pos.z, this.radius, this.big ? 'Big Suit' : 'a Suit');
  }
  die() {
    super.die();
    this.game.particles.smokePuff(this.pos.x, this.pos.y + 1, this.pos.z, 14);
    this.game.mobs.drop(I.PINK_TIE, 1, this.pos.x, this.pos.y + 0.5, this.pos.z);
    this.game.audio.play('pop', { pos: this.pos });
    this.game.stats.suitsDefeated = (this.game.stats.suitsDefeated || 0) + 1;
    this.game.achieve('tie', 'Hostile Takeover', 'Defeated a suit. Took his tie.');
  }
}

// ---------------- Roy chickens ----------------
export class ChickenRoy extends Entity {
  constructor(game, x, y, z, area) {
    super(game, x, y, z, { hw: 0.2, h: 0.7, health: 4 });
    this.parts = makeChickenRoy();
    this.parts.root.userData.entity = this;
    game.scene.add(this.parts.root);
    this.area = area; this.t = rand(1, 4); this.target = null;
    this.layTimer = rand(40, 90); this.cluckT = rand(3, 10);
  }
  update(dt) {
    this.t -= dt;
    if (this.t <= 0) { this.t = rand(2, 6); this.target = Math.random() < 0.6 ? { x: rand(this.area.x0, this.area.x1), z: rand(this.area.z0, this.area.z1) } : null; }
    if (this.target) { if (this.walkToward(this.target.x, this.target.z, 1.1, dt) < 0.3) this.target = null; } else this.stop();
    this.physics(dt);
    if (!this.onGround && this.vel.y < 0) this.vel.y = Math.max(this.vel.y, -3); // flap
    this.cluckT -= dt;
    if (this.cluckT <= 0) { this.cluckT = rand(4, 14); this.game.audio.play('cluck', { pos: this.pos }); }
    this.layTimer -= dt;
    if (this.layTimer <= 0) { this.layTimer = rand(60, 120); this.game.mobs.drop(I.PICKLE, 1, this.pos.x, this.pos.y + 0.3, this.pos.z); this.game.audio.play('pop', { pos: this.pos, vol: 0.6 }); }
    const P = this.parts;
    P.root.position.copy(this.pos); P.root.rotation.y = this.yaw;
    this.animateLegs(dt, P);
    const flap = this.onGround ? 0 : Math.sin(performance.now() / 40) * 0.8;
    P.wingL.rotation.z = -flap; P.wingR.rotation.z = flap;
    P.head.rotation.x = Math.sin(this.walkPhase * 2) * 0.15;
  }
  die() {
    super.die();
    this.game.particles.blockBreak(this.pos.x - 0.5, this.pos.y, this.pos.z - 0.5, [240, 240, 240], 20);
    this.game.mobs.drop(I.PICKLE, 2, this.pos.x, this.pos.y + 0.3, this.pos.z);
    this.game.audio.play('cluck', { pos: this.pos, vol: 1.5 });
  }
}

// ---------------- item drops ----------------
export class ItemDrop extends Entity {
  constructor(game, id, count, x, y, z) {
    super(game, x, y, z, { hw: 0.12, h: 0.25, health: 1 });
    this.id = id; this.count = count;
    this.mesh = makeItemMesh(id, isBlockItem(id) && !BLOCKS[id].cross ? 0.25 : 0.3);
    this.parts = { root: new THREE.Group() };
    this.parts.root.add(this.mesh);
    game.scene.add(this.parts.root);
    this.age = 0;
    this.vel.set(rand(-1.5, 1.5), 4, rand(-1.5, 1.5));
  }
  update(dt) {
    this.age += dt;
    const p = this.game.player;
    const dx = p.pos.x - this.pos.x, dy = p.pos.y + 0.8 - this.pos.y, dz = p.pos.z - this.pos.z, d = Math.hypot(dx, dy, dz);
    if (this.age > 0.6 && d < 2.2 && !p.dead) {
      this.vel.set(dx / d * 9, dy / d * 9, dz / d * 9); this.gravity = false;
      if (d < 0.6) {
        const left = p.inventory.add(this.id, this.count);
        this.game.audio.play('pop', { vol: 0.5 });
        if (left <= 0) { this.remove(); return; }
        this.count = left; this.gravity = true;
      }
      this.pos.addScaledVector(this.vel, dt);
    } else { this.gravity = true; this.vel.x *= 0.92; this.vel.z *= 0.92; this.physics(dt); }
    if (this.age > 300) { this.remove(); return; }
    this.parts.root.position.set(this.pos.x, this.pos.y + 0.18 + Math.sin(this.age * 3) * 0.06, this.pos.z);
    this.mesh.rotation.y += dt * 1.8;
  }
  hurt() {}
}

// ---------------- manager ----------------
export class Mobs {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.spawnTimer = 5;
  }
  add(e) { this.list.push(e); return e; }
  drop(id, count, x, y, z) { if (id) return this.add(new ItemDrop(this.game, id, count, x, y, z)); }
  get villagers() { return this.list.filter((e) => e.isVillager && !e.dead); }
  get creepers() { return this.list.filter((e) => e.isCreeper && !e.dead); }
  update(dt) {
    for (const e of this.list) if (!e.dead) e.update(dt);
    this.list = this.list.filter((e) => !e.dead);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) { this.spawnTimer = 6; this.trySpawnCreeper(); }
  }
  trySpawnCreeper() {
    const g = this.game, p = g.player;
    if (g.settings.peaceful || g.match?.active || g.cutscene) return;
    const night = g.sky.isNight;
    const inForest = p.pos.x < FOREST.x1 + 12;
    const max = night ? 6 : inForest ? 3 : 0;
    if (this.creepers.filter((c) => !c.big).length >= max) return;
    for (let tries = 0; tries < 8; tries++) {
      const a = Math.random() * Math.PI * 2, r = rand(20, 38);
      const x = Math.floor(p.pos.x + Math.cos(a) * r), z = Math.floor(p.pos.z + Math.sin(a) * r);
      if (!night && !(x < FOREST.x1)) continue;
      if (x > PLAZA.x0 - 4 && x < PLAZA.x1 + 4 && z > PLAZA.z0 - 4 && z < PLAZA.z1 + 4) continue; // never inside the village/court
      if (!g.world.isLoaded(x, z)) continue;
      const y = g.world.surfaceY(x, z);
      if (y < 0) continue;
      const top = g.world.getBlock(x, y, z);
      if (top === B.WATER || top === B.LEAVES || !isSolid(top)) continue;
      this.add(new CreeperMan(g, x + 0.5, y + 1, z + 0.5));
      return;
    }
  }
  raycast(origin, dir, maxDist) {
    let best = null, bd = maxDist;
    for (const e of this.list) {
      if (e.dead || e instanceof ItemDrop) continue;
      const t = e.rayHit(origin, dir, bd);
      if (t !== null && t < bd) { bd = t; best = e; }
    }
    return best ? { entity: best, dist: bd } : null;
  }
  clearHostiles() { for (const c of this.creepers) if (!c.big) c.remove(); }
}

export { Entity, moveBody, GROUND };
