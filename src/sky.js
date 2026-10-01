// Day/night cycle. The sun is Roy. The moon is also Roy, but sleepier.
import * as THREE from 'three';
import { photos, cloudTexture, canvasTexture } from './textures.js';
import { smoothstep, lerp } from './util.js';

const DAY = new THREE.Color('#8ec9ff'), NIGHT = new THREE.Color('#0b1030'), DUSK = new THREE.Color('#f08a4b');
export const DAY_LENGTH = 600; // seconds for a full day

function glowCanvas(img, tint, glow) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 40, 128, 128, 128);
  g.addColorStop(0, glow); g.addColorStop(0.55, glow.replace(/[\d.]+\)$/, '0.35)')); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  const w = 120, h = w * img.height / img.width;
  ctx.drawImage(img, 128 - w / 2, 128 - h / 2, w, h);
  if (tint) { ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = tint; ctx.fillRect(0, 0, 256, 256); }
  return c;
}

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.time = 0.08; // 0 sunrise, .25 noon, .5 sunset, .75 midnight
    this.sunSpin = 0;
    const spriteMat = (canvas) => new THREE.SpriteMaterial({ map: canvasTexture(canvas, false), fog: false, depthWrite: false, transparent: true });
    this.sun = new THREE.Sprite(spriteMat(glowCanvas(photos.royHead, null, 'rgba(255,236,120,0.95)')));
    this.sun.scale.set(70, 70, 1);
    const moonC = glowCanvas(photos.royHead, 'rgba(90,120,220,0.45)', 'rgba(200,220,255,0.7)');
    const mctx = moonC.getContext('2d'); mctx.globalCompositeOperation = 'source-over'; mctx.fillStyle = '#dfe8ff'; mctx.font = 'bold 34px monospace'; mctx.fillText('z', 180, 70); mctx.font = 'bold 24px monospace'; mctx.fillText('z', 205, 45);
    this.moon = new THREE.Sprite(spriteMat(moonC));
    this.moon.scale.set(60, 60, 1);
    this.sun.renderOrder = this.moon.renderOrder = -1;
    scene.add(this.sun, this.moon);

    // stars
    const N = 700, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      pos[i * 3] = r * Math.cos(th) * 280; pos[i * 3 + 1] = Math.abs(u) * 280; pos[i * 3 + 2] = r * Math.sin(th) * 280;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.renderOrder = -2;
    scene.add(this.stars);

    // blocky clouds
    const ct = cloudTexture(); ct.repeat.set(5, 5);
    this.cloudTex = ct;
    this.cloudMat = new THREE.MeshBasicMaterial({ map: ct, transparent: true, opacity: 0.85, fog: false, depthWrite: false, side: THREE.DoubleSide });
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), this.cloudMat);
    this.clouds.rotation.x = -Math.PI / 2;
    scene.add(this.clouds);

    this.skyColor = new THREE.Color();
    this.sunDir = new THREE.Vector3();
    this.daylight = 1;
  }

  get isNight() { return this.daylight < 0.3; }

  update(dt, camera) {
    this.time = (this.time + dt / DAY_LENGTH) % 1;
    const a = this.time * Math.PI * 2;
    this.sunDir.set(Math.cos(a), Math.sin(a), -0.5).normalize();
    const cp = camera.position;
    this.sun.position.copy(cp).addScaledVector(this.sunDir, 260);
    this.moon.position.copy(cp).addScaledVector(this.sunDir, -260);
    this.sunSpin += dt;
    this.sun.material.rotation = Math.sin(this.sunSpin * 0.6) * 0.18 + (this.spinBoost || 0);
    if (this.spinBoost) this.spinBoost = Math.max(0, this.spinBoost - dt * 2);
    this.moon.material.rotation = Math.sin(this.sunSpin * 0.3) * 0.3;
    this.stars.position.copy(cp);

    const sy = this.sunDir.y;
    this.daylight = smoothstep(-0.18, 0.22, sy);
    this.skyColor.copy(NIGHT).lerp(DAY, this.daylight);
    const dusk = Math.max(0, 1 - Math.abs(sy) / 0.25) * 0.55;
    this.skyColor.lerp(DUSK, dusk);
    this.starMat.opacity = Math.max(0, 1 - this.daylight * 1.6);

    this.clouds.position.set(cp.x, 120, cp.z);
    this.cloudTex.offset.set(cp.x / 140 + this.sunSpin * 0.002, -cp.z / 140);
    this.cloudMat.color.setScalar(lerp(0.06, 1, this.daylight));
    this.cloudMat.opacity = lerp(0.45, 0.85, this.daylight);
    return this.daylight;
  }
}
