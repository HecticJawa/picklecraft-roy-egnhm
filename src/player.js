// Player physics (AABB vs voxels), health and hunger. Interactions live in main.js.
import * as THREE from 'three';
import { B, isSolid } from './blocks.js';
import { clamp } from './util.js';
import { Inventory } from './inventory.js';

const HW = 0.3, HEIGHT = 1.8, EYE = 1.62;

export class Player {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.onGround = false; this.inWater = false; this.headInWater = false;
    this.flying = false; this.creative = false;
    this.health = 20; this.hunger = 20;
    this.inventory = new Inventory();
    this.fallStart = null;
    this.hurtTimer = 0; this.invuln = 0;
    this.regenTimer = 0; this.starveTimer = 0;
    this.walkDist = 0; this.stepAcc = 0;
    this.dead = false;
    this.frozen = false;   // cutscenes
    this.autoJump = false;
    this.onDamage = null; this.onDeath = null; this.onStep = null; this.onLand = null;
    this.sneaking = false; this.sprinting = false;
  }
  get eye() { return new THREE.Vector3(this.pos.x, this.pos.y + (this.sneaking ? EYE - 0.15 : EYE), this.pos.z); }
  get forward() { return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)); }
  lookDir() { return this.forward.normalize(); }

  boxAt(x, y, z) { return [x - HW, y, z - HW, x + HW, y + HEIGHT, z + HW]; }
  collides(world, x, y, z) { const b = this.boxAt(x, y, z); return world.boxHitsSolid(...b); }

  update(dt, input, world) {
    if (this.dead) return;
    const look = input.consumeLook();
    if (!this.frozen) {
      this.yaw -= look.dx; this.pitch = clamp(this.pitch - look.dy, -1.55, 1.55);
    }
    const still = this.frozen || this.lockMove;
    const mv = still ? { x: 0, z: 0 } : input.readMove();
    const jump = !still && input.jump, sneak = !still && input.sneak;
    this.sneaking = sneak && !this.flying;
    this.sprinting = input.sprint && mv.z > 0 && !this.sneaking && this.hunger > 6;

    const feet = world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.4), Math.floor(this.pos.z));
    const head = world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + EYE), Math.floor(this.pos.z));
    const wasIn = this.inWater;
    this.inWater = feet === B.WATER; this.headInWater = head === B.WATER;
    if (this.inWater && !wasIn && this.vel.y < -6) this.onSplash?.();

    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let speed = this.flying ? (this.sprinting ? 16 : 10.5) : this.sneaking ? 1.3 : this.sprinting ? 5.6 : 4.3;
    if (this.inWater && !this.flying) speed *= 0.5;
    if (this.speedBoost) speed *= this.speedBoost;
    let wx = (fx * mv.z + rx * mv.x) * speed, wz = (fz * mv.z + rz * mv.x) * speed;
    if (!mv.x && !mv.z && this.autoTarget && !still) {
      // pickleball "auto-hustle" assist: jog toward where the ball will be
      const dx = this.autoTarget.x - this.pos.x, dz = this.autoTarget.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.15) { const s = Math.min(4.6, d * 4); wx = (dx / d) * s; wz = (dz / d) * s; }
    }
    const accel = this.flying ? 10 : this.onGround ? 14 : this.inWater ? 6 : 3.2;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (wx - this.vel.x) * k;
    this.vel.z += (wz - this.vel.z) * k;

    if (this.flying) {
      const vy = (jump ? 1 : 0) - (sneak ? 1 : 0);
      this.vel.y += (vy * 8 - this.vel.y) * (1 - Math.exp(-10 * dt));
    } else if (this.inWater) {
      this.vel.y -= 9 * dt;
      if (jump) this.vel.y = Math.min(this.vel.y + 30 * dt, 3.2);
      this.vel.y *= Math.exp(-2.5 * dt);
    } else {
      this.vel.y -= 30 * dt;
      if (this.vel.y < -55) this.vel.y = -55;
      if (jump && this.onGround) this.jump();
    }
    if (this.autoJump && this.onGround && !this.flying && (mv.x || mv.z)) this.tryAutoJump(world, wx, wz, dt);

    const wasGround = this.onGround;
    this.moveAndCollide(world, dt, this.sneaking && this.onGround);
    if (!this.onGround && !this.flying && !this.inWater) { if (this.fallStart === null || this.pos.y > this.fallStart) this.fallStart = this.pos.y; }
    if (this.onGround || this.inWater || this.flying) {
      if (this.fallStart !== null && !wasGround && this.onGround) {
        const dist = this.fallStart - this.pos.y;
        if (dist > 3.4 && !this.inWater && !this.creative) this.damage(Math.floor(dist - 3), 'fell from a high place');
        this.onLand?.(dist);
      }
      this.fallStart = null;
    }

    // footsteps
    if (this.onGround) {
      const h = Math.hypot(this.vel.x, this.vel.z) * dt;
      this.walkDist += h; this.stepAcc += h;
      if (this.stepAcc > (this.sprinting ? 2.1 : 1.7)) { this.stepAcc = 0; this.onStep?.(world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.1), Math.floor(this.pos.z))); }
    }

    // survival stats
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    if (!this.creative) {
      this.hunger = Math.max(0, this.hunger - dt * (0.012 + (this.sprinting ? 0.05 : 0)));
      if (this.hunger >= 16 && this.health < 20) { this.regenTimer += dt; if (this.regenTimer > 3) { this.regenTimer = 0; this.health = Math.min(20, this.health + 1); this.hunger -= 0.4; } }
      if (this.hunger <= 0 && this.health > 1) { this.starveTimer += dt; if (this.starveTimer > 4) { this.starveTimer = 0; this.damage(1, 'forgot to eat pickles'); } }
      if (this.headInWater) { this.air = (this.air ?? 10) - dt; if (this.air < 0) { this.air = 1; this.damage(2, 'tried to breathe pickle brine'); } } else this.air = 10;
      if (this.pos.y < -20) this.damage(100, 'fell out of the world');
    } else { this.health = 20; this.hunger = 20; }
  }

  jump() { this.vel.y = 9.2; this.onGround = false; if (this.sprinting) { this.vel.x *= 1.15; this.vel.z *= 1.15; } }

  tryAutoJump(world, wx, wz, dt) {
    const len = Math.hypot(wx, wz); if (len < 0.1) return;
    const ax = this.pos.x + (wx / len) * 0.45, az = this.pos.z + (wz / len) * 0.45;
    const fy = Math.floor(this.pos.y + 0.5);
    if (isSolid(world.getBlock(Math.floor(ax), fy, Math.floor(az))) && !isSolid(world.getBlock(Math.floor(ax), fy + 1, Math.floor(az))) && !isSolid(world.getBlock(Math.floor(ax), fy + 2, Math.floor(az))) && !isSolid(world.getBlock(Math.floor(this.pos.x), fy + 2, Math.floor(this.pos.z)))) this.jump();
    void dt;
  }

  moveAndCollide(world, dt, edgeGuard) {
    const d = this.vel.clone().multiplyScalar(dt);
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(d.x), Math.abs(d.y), Math.abs(d.z)) / 0.35));
    d.divideScalar(steps);
    this.onGround = false;
    for (let s = 0; s < steps; s++) {
      // Y
      if (d.y) {
        const ny = this.pos.y + d.y;
        if (this.collides(world, this.pos.x, ny, this.pos.z)) {
          if (d.y < 0) { this.pos.y = Math.floor(ny) + 1; this.onGround = true; }
          else this.pos.y = Math.floor(ny + HEIGHT) - HEIGHT - 0.001;
          this.vel.y = 0; d.y = 0;
        } else this.pos.y = ny;
      }
      if (!this.onGround && d.y === 0 && this.vel.y === 0 && this.collides(world, this.pos.x, this.pos.y - 0.05, this.pos.z)) this.onGround = true;
      // X
      if (d.x) {
        const nx = this.pos.x + d.x;
        if (this.collides(world, nx, this.pos.y, this.pos.z)) { this.pos.x = d.x > 0 ? Math.floor(nx + HW) - HW - 0.001 : Math.floor(nx - HW) + 1 + HW + 0.001; this.vel.x = 0; d.x = 0; }
        else if (edgeGuard && !this.collides(world, nx, this.pos.y - 0.6, this.pos.z)) { this.vel.x = 0; d.x = 0; }
        else this.pos.x = nx;
      }
      // Z
      if (d.z) {
        const nz = this.pos.z + d.z;
        if (this.collides(world, this.pos.x, this.pos.y, nz)) { this.pos.z = d.z > 0 ? Math.floor(nz + HW) - HW - 0.001 : Math.floor(nz - HW) + 1 + HW + 0.001; this.vel.z = 0; d.z = 0; }
        else if (edgeGuard && !this.collides(world, this.pos.x, this.pos.y - 0.6, nz)) { this.vel.z = 0; d.z = 0; }
        else this.pos.z = nz;
      }
    }
    if (!this.onGround && this.vel.y <= 0 && this.collides(world, this.pos.x, this.pos.y - 0.02, this.pos.z)) this.onGround = true;
  }

  damage(amount, cause, from = null) {
    if (this.dead || this.creative || this.invuln > 0 || amount <= 0) return false;
    this.health = Math.max(0, this.health - amount);
    this.hurtTimer = 0.35; this.invuln = 0.5;
    if (from) {
      const dx = this.pos.x - from.x, dz = this.pos.z - from.z, d = Math.hypot(dx, dz) || 1;
      this.vel.x += (dx / d) * 6; this.vel.z += (dz / d) * 6; this.vel.y = Math.max(this.vel.y, 5);
    }
    this.onDamage?.(amount, cause);
    if (this.health <= 0) { this.dead = true; this.onDeath?.(cause); }
    return true;
  }
  eat(food, heal) {
    this.hunger = Math.min(20, this.hunger + food);
    this.health = Math.min(20, this.health + heal);
  }
  respawn(spawn) {
    this.pos.set(spawn.x, spawn.y, spawn.z);
    this.vel.set(0, 0, 0);
    this.yaw = spawn.yaw ?? 0; this.pitch = 0;
    this.health = 20; this.hunger = 20; this.dead = false; this.frozen = false; this.fallStart = null;
  }
}
