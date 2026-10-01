// Particle effects: block debris, smoke and confetti (points), plus bouncing Roy-head sprites.
import * as THREE from 'three';
import { photos, canvasTexture } from './textures.js';
import { isSolid } from './blocks.js';

class PointPool {
  constructor(scene, n, size, { gravity = -18, drag = 0.98, opacity = 1, blending = THREE.NormalBlending } = {}) {
    this.n = n; this.gravity = gravity; this.drag = drag;
    this.pos = new Float32Array(n * 3).fill(-9999);
    this.col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo = g;
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size, vertexColors: true, transparent: opacity < 1, opacity, blending, depthWrite: opacity >= 1 }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  spawn(x, y, z, vx, vy, vz, r, g, b, life) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.life[i] = life;
  }
  update(dt, world) {
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -9999; continue; }
      const k = i * 3;
      this.vel[k + 1] += this.gravity * dt;
      const d = Math.pow(this.drag, dt * 60);
      this.vel[k] *= d; this.vel[k + 1] *= d; this.vel[k + 2] *= d;
      const nx = this.pos[k] + this.vel[k] * dt, ny = this.pos[k + 1] + this.vel[k + 1] * dt, nz = this.pos[k + 2] + this.vel[k + 2] * dt;
      if (world && this.gravity < 0 && isSolid(world.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz)))) {
        this.vel[k] *= 0.3; this.vel[k + 2] *= 0.3; this.vel[k + 1] = 0;
      } else { this.pos[k] = nx; this.pos[k + 1] = ny; this.pos[k + 2] = nz; }
    }
    if (any) { this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true; }
  }
}

export class Particles {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    this.debris = new PointPool(scene, 1500, 0.09, { gravity: -16 });
    this.smoke = new PointPool(scene, 600, 0.7, { gravity: 1.2, drag: 0.95, opacity: 0.42 });
    this.confetti = new PointPool(scene, 900, 0.12, { gravity: -3, drag: 0.97 });
    this.royTex = canvasTexture(photos.royHead, false);
    this.sprites = [];
  }

  blockBreak(x, y, z, rgb, n = 18) {
    for (let i = 0; i < n; i++) {
      const s = 0.75 + Math.random() * 0.45;
      this.debris.spawn(x + Math.random(), y + Math.random(), z + Math.random(), (Math.random() - 0.5) * 4, Math.random() * 4, (Math.random() - 0.5) * 4, rgb[0] / 255 * s, rgb[1] / 255 * s, rgb[2] / 255 * s, 0.6 + Math.random() * 0.5);
    }
  }
  explosion(x, y, z, radius) {
    for (let i = 0; i < 90 * radius / 3; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI - Math.PI / 2, sp = 2 + Math.random() * 6;
      const g = 0.35 + Math.random() * 0.5;
      this.smoke.spawn(x + (Math.random() - 0.5) * radius, y + Math.random() * radius * 0.6, z + (Math.random() - 0.5) * radius, Math.cos(a) * Math.cos(e) * sp, Math.abs(Math.sin(e)) * sp * 0.6, Math.sin(a) * Math.cos(e) * sp, g, g, g, 1.2 + Math.random() * 1.5);
    }
    for (let i = 0; i < 60; i++) {
      const hot = Math.random();
      this.debris.spawn(x, y + 0.5, z, (Math.random() - 0.5) * 16, Math.random() * 12, (Math.random() - 0.5) * 16, 1, 0.5 + hot * 0.5, hot * 0.3, 0.5 + Math.random() * 0.6);
    }
  }
  burst(x, y, z, n = 120, speed = 9) {
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u), sp = speed * (0.6 + Math.random() * 0.4);
      const hue = Math.random(), c = new THREE.Color().setHSL(hue, 0.9, 0.6);
      this.confetti.spawn(x, y, z, r * Math.cos(th) * sp, u * sp, r * Math.sin(th) * sp, c.r, c.g, c.b, 1.5 + Math.random() * 1.2);
    }
  }
  smokePuff(x, y, z, n = 6) {
    for (let i = 0; i < n; i++) this.smoke.spawn(x + (Math.random() - 0.5) * 0.4, y + Math.random() * 0.4, z + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5), 0.6 + Math.random(), (Math.random() - 0.5), 0.8, 0.8, 0.8, 0.8 + Math.random() * 0.5);
  }
  sparkle(x, y, z, rgb = [0.6, 1, 0.4], n = 8) {
    for (let i = 0; i < n; i++) this.confetti.spawn(x, y, z, (Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3, rgb[0], rgb[1], rgb[2], 0.5 + Math.random() * 0.4);
  }

  // A Roy head that falls, bounces and fades. Used for Roy rain and celebrations.
  roy(x, y, z, { vx = 0, vy = 0, vz = 0, size = 0.8, life = 6 } = {}) {
    if (this.sprites.length > 160) return;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.royTex, transparent: true }));
    s.scale.set(size, size * photos.royHead.height / photos.royHead.width, 1);
    s.position.set(x, y, z);
    this.scene.add(s);
    this.sprites.push({ s, v: new THREE.Vector3(vx, vy, vz), life, max: life, spin: (Math.random() - 0.5) * 6 });
  }

  update(dt) {
    this.debris.update(dt, this.world);
    this.smoke.update(dt, null);
    this.confetti.update(dt, this.world);
    for (let i = this.sprites.length - 1; i >= 0; i--) {
      const p = this.sprites[i];
      p.life -= dt;
      p.v.y -= 14 * dt;
      p.s.position.addScaledVector(p.v, dt);
      const below = this.world.getBlock(Math.floor(p.s.position.x), Math.floor(p.s.position.y - p.s.scale.y / 2), Math.floor(p.s.position.z));
      if (isSolid(below) && p.v.y < 0) { p.v.y = -p.v.y * 0.55; p.v.x *= 0.7; p.v.z *= 0.7; p.s.position.y = Math.floor(p.s.position.y - p.s.scale.y / 2) + 1 + p.s.scale.y / 2; }
      p.s.material.rotation += p.spin * dt;
      p.s.material.opacity = Math.min(1, p.life / 1.0);
      if (p.life <= 0) { this.scene.remove(p.s); p.s.material.dispose(); this.sprites.splice(i, 1); }
    }
  }
}
