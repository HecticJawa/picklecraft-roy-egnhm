// Pickleball: court visuals, ball physics, singles rules (side-out scoring, two-bounce rule, kitchen),
// the villager opponent's AI, the referee and the scoreboard.
import * as THREE from 'three';
import { GROUND } from './world.js';
import { photos, canvasTexture } from './textures.js';
import { makeBall } from './models.js';
import { I } from './items.js';
import { clamp, rand, pick, lerp } from './util.js';

export const COURT_Y = GROUND + 1;
const HX = 3.05, HZ = 6.7, KZ = 2.13, NET_H = 0.89, POST_X = 3.35;
const G = 9.0, R = 0.13;
const SIDE = { player: 1, ai: -1 };
const other = (w) => (w === 'player' ? 'ai' : 'player');
const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const say = (n) => NUM[n] ?? String(n);

export const DIFFICULTY = {
  easy: { speed: 3.5, reach: 1.15, err: 0.2, errScale: 0.9, judge: 0.45, react: 0.22 },
  normal: { speed: 4.3, reach: 1.3, err: 0.11, errScale: 0.6, judge: 0.75, react: 0.14 },
  hard: { speed: 5.1, reach: 1.45, err: 0.05, errScale: 0.35, judge: 0.92, react: 0.07 },
};

export class Match {
  constructor(game, meta) {
    this.game = game;
    this.meta = meta;
    this.active = false;
    this.state = 'idle';
    this.score = { player: 0, ai: 0 };
    this.server = 'player';
    this.ball = { pos: new THREE.Vector3(0, COURT_Y + 1, 0), vel: new THREE.Vector3(), live: false, held: null, lastHitter: null, bounces: 0, shot: 0, netted: false, prevZ: 0 };
    this.timer = 0;
    this.swingT = 0;
    this.rallyLen = 0;
    this.stats = { aces: 0, longest: 0 };
    this.buildCourt();
    this.buildScoreboard();
    this.ballMesh = makeBall(R);
    this.ballMesh.visible = false;
    game.scene.add(this.ballMesh);
    const sh = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.visible = false; sh.renderOrder = 3;
    this.shadow = sh; game.scene.add(sh);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.32, 24), new THREE.MeshBasicMaterial({ color: 0xffe14a, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.visible = false; ring.renderOrder = 3;
    this.marker = ring; game.scene.add(ring);
  }

  // ---------------- visuals ----------------
  buildCourt() {
    const PPM = 50, W = 12, L = 20;
    const c = document.createElement('canvas'); c.width = W * PPM; c.height = L * PPM;
    const ctx = c.getContext('2d');
    const X = (x) => (x + W / 2) * PPM, Z = (z) => (z + L / 2) * PPM;
    ctx.fillStyle = '#3e8456'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#2e60ac'; ctx.fillRect(X(-HX), Z(-HZ), 2 * HX * PPM, 2 * HZ * PPM);
    ctx.fillStyle = '#3d78c9'; ctx.fillRect(X(-HX), Z(-KZ), 2 * HX * PPM, 2 * KZ * PPM);
    ctx.fillStyle = '#fff';
    const line = (x0, z0, x1, z1) => { const w = 4; ctx.fillRect(Math.min(X(x0), X(x1)) - w / 2, Math.min(Z(z0), Z(z1)) - w / 2, Math.abs(X(x1) - X(x0)) + w, Math.abs(Z(z1) - Z(z0)) + w); };
    line(-HX, -HZ, HX, -HZ); line(-HX, HZ, HX, HZ); line(-HX, -HZ, -HX, HZ); line(HX, -HZ, HX, HZ);
    line(-HX, -KZ, HX, -KZ); line(-HX, KZ, HX, KZ); line(0, KZ, 0, HZ); line(0, -KZ, 0, -HZ);
    ctx.font = 'bold 34px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('PICKLECRAFT', X(0), Z(8.9));
    ctx.save(); ctx.translate(X(0), Z(-8.9)); ctx.rotate(Math.PI); ctx.fillText('PICKLECRAFT', 0, 0); ctx.restore();
    ctx.globalAlpha = 0.9;
    for (const [x, z] of [[-4.6, 8.3], [4.6, 8.3], [-4.6, -8.3], [4.6, -8.3]]) ctx.drawImage(photos.royHead, X(x) - 30, Z(z) - 40, 60, 80);
    ctx.globalAlpha = 1;
    const tex = canvasTexture(c, false);
    tex.anisotropy = 4;
    this.courtMat = new THREE.MeshBasicMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(W, L), this.courtMat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(0, COURT_Y + 0.003, 0);
    this.game.scene.add(plane);

    // net
    const nc = document.createElement('canvas'); nc.width = 256; nc.height = 40;
    const n = nc.getContext('2d');
    n.strokeStyle = 'rgba(20,20,20,0.9)'; n.lineWidth = 1;
    for (let x = 0; x <= 256; x += 4) { n.beginPath(); n.moveTo(x, 4); n.lineTo(x, 40); n.stroke(); }
    for (let y = 4; y <= 40; y += 4) { n.beginPath(); n.moveTo(0, y); n.lineTo(256, y); n.stroke(); }
    n.fillStyle = '#f4f4f4'; n.fillRect(0, 0, 256, 5);
    const netTex = canvasTexture(nc, false); netTex.wrapS = THREE.RepeatWrapping; netTex.repeat.x = 3;
    this.netMat = new THREE.MeshBasicMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const net = new THREE.Mesh(new THREE.PlaneGeometry(POST_X * 2, NET_H), this.netMat);
    net.position.set(0, COURT_Y + NET_H / 2, 0);
    this.game.scene.add(net);
    const postMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    for (const x of [-POST_X, POST_X]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, NET_H + 0.06, 0.08), postMat); p.position.set(x, COURT_Y + (NET_H + 0.06) / 2, 0); this.game.scene.add(p); }
  }

  buildScoreboard() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    this.sbCanvas = c;
    this.sbTex = canvasTexture(c, false);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 3.3), new THREE.MeshBasicMaterial({ map: this.sbTex }));
    const s = this.meta.scoreboard;
    m.position.set(s.x - 0.5, s.y, s.z);
    this.sbMat = m.material;
    this.game.scene.add(m);
    const back = new THREE.Mesh(new THREE.BoxGeometry(6.9, 3.6, 0.15), new THREE.MeshLambertMaterial({ color: 0x2a1e10 }));
    back.position.set(s.x - 0.5, s.y, s.z - 0.1);
    this.game.scene.add(back);
    this.drawScoreboard();
  }
  drawScoreboard() {
    const c = this.sbCanvas, x = c.getContext('2d');
    x.fillStyle = '#0d1a0d'; x.fillRect(0, 0, 512, 256);
    x.strokeStyle = '#9ad13b'; x.lineWidth = 8; x.strokeRect(4, 4, 504, 248);
    x.fillStyle = '#9ad13b'; x.font = 'bold 30px monospace'; x.textAlign = 'center';
    x.fillText('PICKLECRAFT OPEN', 256, 44);
    x.drawImage(photos.royHead, 14, 12, 48, 64); x.drawImage(photos.royHead, 450, 12, 48, 64);
    const opp = this.opponent?.name || 'Dinkleton';
    x.font = 'bold 26px monospace'; x.fillStyle = '#fff';
    x.fillText('YOU', 128, 100); x.fillText(opp.toUpperCase().slice(0, 10), 384, 100);
    x.font = 'bold 96px monospace'; x.fillStyle = '#ffe14a';
    x.fillText(String(this.score.player), 128, 200); x.fillText(String(this.score.ai), 384, 200);
    x.fillStyle = '#9ad13b'; x.font = 'bold 22px monospace';
    if (this.active) x.fillText('● SERVE', this.server === 'player' ? 128 : 384, 236);
    else x.fillText(`W ${this.game.stats.wins || 0}  -  L ${this.game.stats.losses || 0}`, 256, 236);
    x.fillStyle = '#fff'; x.font = 'bold 40px monospace'; x.fillText('-', 256, 180);
    this.sbTex.needsUpdate = true;
  }

  // ---------------- match flow ----------------
  start({ opponent, referee, target = 11, difficulty = 'normal' }) {
    const g = this.game;
    this.active = true;
    this.opponent = opponent; this.referee = referee;
    this.target = target; this.diff = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.difficulty = difficulty;
    this.score = { player: 0, ai: 0 };
    this.server = Math.random() < 0.5 ? 'player' : 'ai';
    this.rallyLen = 0; this.stats = { aces: 0, longest: 0, faults: 0 };
    opponent.role = 'scripted'; opponent.givePaddle();
    g.player.inventory.equip(I.PADDLE);
    g.mobs.clearHostiles();
    this.state = 'intro'; this.timer = 4.2;
    this.ballMesh.visible = true;
    this.ball.live = false; this.ball.held = null;
    this.ball.pos.set(0, COURT_Y + 1.2, 0);
    referee.say(`Welcome to the Picklecraft Open! First to ${say(target)}, win by two. ${this.server === 'player' ? 'You serve first.' : opponent.name + ' serves first.'}`, { priority: true });
    g.ui.toast('PICKLEBALL!', `First to ${target}, win by 2. ${this.server === 'player' ? 'You serve.' : opponent.name + ' serves.'}`, 'roy');
    this.drawScoreboard();
    this.updateHud();
  }

  stop() {
    this.active = false; this.state = 'idle';
    this.ballMesh.visible = false; this.shadow.visible = false; this.marker.visible = false;
    this.game.player.frozen = false; this.game.player.autoTarget = null;
    if (this.opponent) { this.opponent.role = 'stand'; this.opponent.target = null; }
    this.game.ui.matchHud(null);
    this.drawScoreboard();
  }

  serverSpot(who) {
    const side = SIDE[who], even = this.score[who] % 2 === 0;
    const sx = (even ? 1 : -1) * side * 1.5;
    return { x: sx, z: side * 7.25 };
  }
  setupPoint() {
    const g = this.game, p = g.player, opp = this.opponent;
    const sv = this.serverSpot(this.server);
    const rv = { x: -sv.x, z: -Math.sign(sv.z) * 7.0 };
    const pSpot = this.server === 'player' ? sv : rv, aSpot = this.server === 'ai' ? sv : rv;
    p.pos.set(pSpot.x, COURT_Y, pSpot.z); p.vel.set(0, 0, 0);
    // face the box you serve into (or the server, when receiving)
    const fx = this.server === 'player' ? -Math.sign(sv.x) * 1.5 : aSpot.x, fz = this.server === 'player' ? -4.4 : aSpot.z;
    const dx = fx - pSpot.x, dz = fz - pSpot.z;
    p.yaw = Math.atan2(-dx, -dz); p.pitch = -Math.atan2(1.62, Math.hypot(dx, dz));
    p.frozen = false; p.lockMove = true;
    opp.pos.set(aSpot.x, COURT_Y, aSpot.z); opp.vel.set(0, 0, 0);
    opp.target = null; opp.yaw = 0; opp.faceYaw = 0;
    this.serveTarget = { xs: -Math.sign(sv.x) || 1, side: -SIDE[this.server] };
    this.ball.live = false; this.ball.held = this.server; this.ball.lastHitter = null;
    this.ball.bounces = 0; this.ball.shot = 0; this.ball.netted = false;
    this.rallyLen = 0;
    this.aiPlan = null;
    const sc = this.server === 'player' ? [this.score.player, this.score.ai] : [this.score.ai, this.score.player];
    const call = `${say(sc[0])}, ${say(sc[1])}.`;
    const gp = this.isGamePoint(this.server);
    this.referee.say(gp ? `${call} ${this.server === 'player' ? 'Match point!' : 'Game point, hrmm.'}` : call, { priority: true });
    this.state = 'serve';
    this.timer = this.server === 'ai' ? rand(1.6, 2.4) : 0.5; // player: short pause before the serve is allowed
    if (this.server === 'ai') this.ball.pos.copy(this.handPos(opp));
    else { const f = p.forward; this.ball.pos.set(p.pos.x + f.x * 0.55, COURT_Y + 0.75, p.pos.z + f.z * 0.55); }
    this.updateHud(this.server === 'player' ? 'Your serve: aim, then swing' : `${opp.name} serves...`);
    this.drawScoreboard();
  }
  isGamePoint(who) { return this.score[who] + 1 >= this.target && this.score[who] + 1 - this.score[other(who)] >= 2; }

  endRally(winner, reason) {
    if (this.state !== 'rally' && this.state !== 'serve') return;
    const g = this.game;
    this.state = 'point'; this.timer = 2.4;
    this.ball.live = false;
    this.marker.visible = false;
    g.player.autoTarget = null;
    this.stats.longest = Math.max(this.stats.longest, this.rallyLen);
    const serverWon = winner === this.server;
    let call = reason;
    if (serverWon) this.score[winner]++;
    else { call += ' Side out!'; this.server = winner; }
    this.referee.say(call, { priority: true });
    const fans = g.mobs.villagers.filter((v) => v.role === 'sit');
    if (winner === 'player') { g.audio.play('cheer', { pos: { x: 8, y: COURT_Y, z: 0 } }); for (const f of fans) f.cheer = 1.2; this.opponent.sad = 1.5; }
    else { g.audio.play('gasp', { pos: { x: 8, y: COURT_Y, z: 0 } }); this.opponent.cheer = 0.8; }
    if (this.rallyLen >= 8) setTimeout(() => pick(fans)?.say(pick(['What a rally! Hrmm!', 'My nose is sweating!', 'Roy would be proud!'])), 900);
    g.ui.toast(winner === 'player' ? 'POINT!' : 'Lost the rally', reason, winner === 'player' ? 'roy' : null, 1.6);
    // game over?
    const s = this.score;
    for (const who of ['player', 'ai']) if (s[who] >= this.target && s[who] - s[other(who)] >= 2) { this.state = 'over'; this.winner = who; this.timer = 1.8; }
    this.updateHud(reason);
    this.drawScoreboard();
  }

  // ---------------- per-frame ----------------
  update(dt) {
    if (!this.active) return;
    const g = this.game, p = g.player, opp = this.opponent;
    this.timer -= dt;
    this.swingT = Math.max(0, this.swingT - dt);

    // walking away forfeits
    const away = Math.hypot(p.pos.x, p.pos.z * 0.7);
    if (away > 14) { this.forfeitT = (this.forfeitT || 0) + dt; if (this.forfeitT > 0.1 && !this.warned) { this.warned = true; g.ui.toast('Come back!', 'Leave the court and you forfeit.', null, 2); } if (this.forfeitT > 4) return this.forfeit(); }
    else { this.forfeitT = 0; this.warned = false; }

    if (this.state === 'intro') { if (this.timer <= 0) this.setupPoint(); }
    else if (this.state === 'serve') {
      if (this.ball.held === 'ai') {
        const h = this.handPos(opp); this.ball.pos.copy(h);
        if (this.timer <= 0) this.aiServe();
      } else if (this.ball.held === 'player') {
        const f = p.forward; this.ball.pos.set(p.pos.x + f.x * 0.55, COURT_Y + 0.75 + Math.sin(performance.now() / 300) * 0.05, p.pos.z + f.z * 0.55);
      }
    } else if (this.state === 'rally') {
      this.stepBall(dt);
      if (this.state === 'rally') this.aiThink(dt);
      if (this.swingT > 0) this.tryPlayerHit();
      this.assist();
      p.lockMove = false;
    } else if (this.state === 'point') {
      this.stepBall(dt, true);
      if (this.timer <= 0) this.setupPoint();
    } else if (this.state === 'over') {
      this.stepBall(dt, true);
      if (this.timer <= 0) this.finish();
    }
    if (this.state === 'serve' || this.state === 'intro') { opp.target = null; }

    // ball visuals
    const b = this.ball;
    this.ballMesh.position.copy(b.pos);
    if (b.live) { this.ballMesh.rotation.x += b.vel.z * dt * 4; this.ballMesh.rotation.z -= b.vel.x * dt * 4; }
    this.shadow.visible = this.ballMesh.visible && Math.abs(b.pos.x) < 8 && Math.abs(b.pos.z) < 12;
    const hgt = Math.max(0, b.pos.y - COURT_Y);
    this.shadow.position.set(b.pos.x, COURT_Y + 0.012, b.pos.z);
    this.shadow.scale.setScalar(clamp(1.1 - hgt * 0.15, 0.4, 1.1));
    this.shadow.material.opacity = clamp(0.45 - hgt * 0.06, 0.12, 0.45);
    // kitchen warning
    g.ui.kitchenWarn(this.state === 'rally' && p.pos.z > 0 && p.pos.z < KZ && Math.abs(p.pos.x) < HX + 0.5);
  }

  handPos(v) { const s = Math.sin(v.yaw), c = Math.cos(v.yaw); return new THREE.Vector3(v.pos.x + s * 0.45 + c * 0.3, COURT_Y + 0.85, v.pos.z + c * 0.45 - s * 0.3); }

  stepBall(dt, dead = false) {
    const b = this.ball;
    if (b.held) return;
    const sub = Math.ceil(dt / (1 / 240));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) {
      b.prevZ = b.pos.z;
      b.vel.y -= G * h;
      b.pos.addScaledVector(b.vel, h);
      // net
      if (Math.sign(b.prevZ) !== Math.sign(b.pos.z) && b.prevZ !== 0) {
        if (Math.abs(b.pos.x) <= POST_X && b.pos.y - R < COURT_Y + NET_H) {
          b.pos.z = Math.sign(b.prevZ) * (R + 0.02);
          b.vel.z *= -0.15; b.vel.x *= 0.3; b.vel.y *= 0.2;
          b.netted = true;
          this.game.audio.play('net', { pos: b.pos });
        }
      }
      // ground
      if (b.pos.y - R <= COURT_Y && b.vel.y < 0) {
        b.pos.y = COURT_Y + R;
        const impact = -b.vel.y;
        b.vel.y = impact * 0.66; b.vel.x *= 0.82; b.vel.z *= 0.82;
        if (impact > 1.2) this.game.audio.play('bounce', { pos: b.pos, vol: clamp(impact / 6, 0.2, 1) });
        if (impact < 0.6) b.vel.y = 0;
        if (!dead && b.live) this.onBounce(b.pos.x, b.pos.z);
      }
    }
    if (!dead && b.live && (Math.abs(b.pos.x) > 11 || Math.abs(b.pos.z) > 16)) {
      // left the area: if it already bounced in, the receiver just never reached it
      if (b.bounces >= 1) this.endRally(b.lastHitter, 'Point!');
      else this.endRally(other(b.lastHitter), 'Out!');
    }
  }

  onBounce(x, z) {
    const b = this.ball;
    const side = z > 0 ? 1 : -1, hitter = b.lastHitter, hs = SIDE[hitter];
    if (side === hs) return this.endRally(other(hitter), b.netted ? 'Into the net!' : 'Fault!');
    if (b.bounces === 0) {
      let ok, why = 'Out!';
      const az = Math.abs(z), inLines = Math.abs(x) <= HX + 0.04 && az <= HZ + 0.04;
      if (b.shot === 1) {
        ok = inLines && az > KZ + 0.02 && x * this.serveTarget.xs >= -0.04;
        if (inLines && az <= KZ + 0.02) why = 'Short serve! That is the kitchen.';
        else if (inLines) why = 'Wrong service court!';
      } else ok = inLines;
      if (!ok) return this.endRally(other(hitter), why);
      b.bounces = 1;
      if (this.aiPlan) this.aiReplan = true;
    } else {
      // second bounce: the receiver never got it back
      const lines = b.shot === 1 ? ['Ace! Hrmm!', 'Ace!'] : ['Point!', 'Too slow! Point!', 'Double bounce. Point!'];
      if (b.shot === 1 && hitter === 'player') { this.stats.aces++; this.game.achieve('ace', 'Ace of Pickles', 'Served an ace.'); }
      this.endRally(hitter, pick(lines));
    }
  }

  // Ballistic launch from `from` to land at `target` (on the court) in time t, lifting the arc to clear the net.
  solve(from, tx, tz, t, clearance = 0.18) {
    const v = new THREE.Vector3();
    for (let k = 0; k < 30; k++) {
      v.set((tx - from.x) / t, (COURT_Y + R - from.y + 0.5 * G * t * t) / t, (tz - from.z) / t);
      if (clearance === null || Math.sign(from.z) === Math.sign(tz) || !v.z) break;
      const tn = -from.z / v.z;
      if (tn <= 0 || tn >= t) break;
      const yn = from.y + v.y * tn - 0.5 * G * tn * tn;
      if (yn - R >= COURT_Y + NET_H + clearance) break;
      t += 0.06;
    }
    return v;
  }

  launch(who, vel) {
    const b = this.ball;
    b.vel.copy(vel); b.held = null; b.live = true;
    b.lastHitter = who; b.shot++; b.bounces = 0; b.netted = false;
    this.rallyLen++;
    this.game.audio.play('pock', { pos: b.pos });
    this.aiPlan = null;
    this.state = 'rally';
  }

  // ---------------- serving ----------------
  aiServe() {
    const d = this.diff, b = this.ball, opp = this.opponent;
    const from = this.handPos(opp);
    b.pos.copy(from);
    let tx = this.serveTarget.xs * rand(0.5, 2.6), tz = this.serveTarget.side * rand(3.8, 6.2);
    if (Math.random() < d.err * 0.45) { if (Math.random() < 0.5) tz = this.serveTarget.side * rand(6.9, 7.6); else tx = this.serveTarget.xs * rand(3.2, 3.8); }
    opp.swing = 1;
    this.launch('ai', this.solve(from, tx, tz, rand(1.05, 1.3)));
    this.game.player.lockMove = false;
    this.updateHud();
  }
  playerSwing() {
    if (!this.active) return;
    const g = this.game, p = g.player;
    g.swingHand();
    if (this.state === 'serve' && this.ball.held === 'player') {
      if (this.timer > 0) return;
      const aim = this.aimPoint(true);
      const from = this.ball.pos.clone();
      const err = 0.25;
      const v = this.solve(from, aim.x + rand(-err, err), aim.z + rand(-err, err), 1.15);
      this.launch('player', v);
      p.lockMove = false;
      this.updateHud();
      return;
    }
    if (this.state === 'rally') { this.swingT = 0.34; g.audio.play('whoosh', { vol: 0.6 }); }
  }
  // Where the crosshair points on the opponent's half (with optional aim assist).
  aimPoint(serve = false) {
    const g = this.game, p = g.player, eye = p.eye, dir = p.lookDir();
    let x, z;
    if (dir.y < -0.02) { const t = (COURT_Y - eye.y) / dir.y; x = eye.x + dir.x * t; z = eye.z + dir.z * t; }
    if (x === undefined || z > -0.4 || t2far(z)) {
      const fl = Math.hypot(dir.x, dir.z) || 1;
      const dist = Math.max(4, p.pos.z + 4.5);
      x = p.pos.x + (dir.x / fl) * dist; z = -4.5;
    }
    let minZ = 0.7, maxZ = HZ - 0.55, minX = -HX + 0.5, maxX = HX - 0.5;
    if (serve) { minZ = KZ + 0.7; if (this.serveTarget.xs > 0) minX = 0.5; else maxX = -0.5; }
    if (g.settings.aimAssist) {
      // keep the aim inside the lines; the shot error can still miss
      x = clamp(x, minX, maxX); z = -clamp(-z, minZ, maxZ);
    }
    return { x, z };
    function t2far(zz) { return zz < -12; }
  }

  tryPlayerHit() {
    const g = this.game, p = g.player, b = this.ball;
    if (!b.live || b.lastHitter !== 'ai') return;
    const dx = b.pos.x - p.pos.x, dz = b.pos.z - p.pos.z, hd = Math.hypot(dx, dz), hy = b.pos.y - COURT_Y;
    const reach = 1.8;
    if (hd > reach || hy > 2.7 || hy < 0.02 || b.pos.z < -0.25) return;
    // rules (with aim assist on, an illegal swing just whiffs instead of faulting)
    const twoBounce = b.shot <= 2 && b.bounces === 0;
    const kitchen = b.bounces === 0 && p.pos.z < KZ && p.pos.z > -0.5;
    if ((twoBounce || kitchen) && g.settings.aimAssist) {
      if (!this.hinted || performance.now() - this.hinted > 1500) { this.hinted = performance.now(); g.ui.pop(twoBounce ? 'LET IT BOUNCE!' : 'KITCHEN! LET IT BOUNCE'); }
      return;
    }
    this.swingT = 0;
    if (twoBounce) return this.endRally('ai', 'Two-bounce rule! You must let it bounce.');
    if (kitchen) return this.endRally('ai', 'Kitchen violation! No volleys in the kitchen.');
    const q = clamp(1 - hd / reach, 0, 1);
    const aim = this.aimPoint();
    const err = g.settings.aimAssist ? 0.1 + (1 - q) * 0.55 : 0.15 + (1 - q) * 1.0;
    let tx = aim.x + rand(-err, err), tz = aim.z + rand(-err, err) * 0.8;
    let t;
    const dist = Math.hypot(tx - b.pos.x, tz - b.pos.z);
    if (Math.abs(tz) < KZ) t = rand(1.05, 1.3);                          // dink
    else if (hy > 1.5 && p.pos.z < 4.5) t = rand(0.42, 0.55);            // smash
    else if (p.pitch > 0.35) t = 1.9;                                    // lob
    else t = dist / 12 + 0.32;                                           // drive
    const v = this.solve(b.pos, tx, tz, t, 0.12);
    this.launch('player', v);
    if (q > 0.72) g.ui.pop('PERFECT!');
    else if (t < 0.6) g.ui.pop('SMASH!');
    if (t < 0.6 && hy > 1.5) g.shake(0.15);
  }

  // ---------------- opponent AI ----------------
  predict(maxT = 3) {
    const b = this.ball, p = b.pos.clone(), v = b.vel.clone();
    let bounces = b.bounces;
    const out = [];
    const h = 1 / 60;
    for (let t = 0; t < maxT; t += h) {
      v.y -= G * h; p.addScaledVector(v, h);
      if (p.y - R <= COURT_Y && v.y < 0) { p.y = COURT_Y + R; v.y = -v.y * 0.66; v.x *= 0.82; v.z *= 0.82; bounces++; out.push({ t, x: p.x, y: p.y, z: p.z, bounces, bounce: true }); if (bounces >= 2) break; continue; }
      out.push({ t, x: p.x, y: p.y, z: p.z, bounces });
    }
    return out;
  }
  firstBounce() { return this.predict().find((s) => s.bounce) || null; }

  aiThink(dt) {
    const opp = this.opponent, b = this.ball, d = this.diff;
    const incoming = b.lastHitter === 'player';
    if (!incoming) {
      // recover: shade toward the ball, come up to the kitchen line after the return
      const atNet = this.rallyLen >= 2 && this.difficulty !== 'easy';
      opp.target = { x: clamp(b.pos.x * 0.45, -1.8, 1.8), z: atNet ? -2.7 : -6.4, speed: d.speed * 0.8 };
      opp.faceYaw = 0;
      return;
    }
    if (!this.aiPlan || this.aiReplan) {
      const leave = this.aiPlan?.leave ?? null;
      this.aiPlan = { react: this.aiReplan ? 0 : d.react };
      this.aiReplan = false;
      const fb = this.firstBounce();
      const willBeOut = fb && b.bounces === 0 && (Math.abs(fb.x) > HX + 0.05 || Math.abs(fb.z) > HZ + 0.05 || fb.z > 0);
      this.aiPlan.leave = leave ?? (willBeOut && Math.random() < d.judge);
      if (b.bounces > 0) this.aiPlan.leave = false;
      const mustBounce = b.shot <= 2; // the serve and the return of serve must bounce
      const samples = this.predict();
      let best = null;
      for (const s of samples) {
        if (s.z > -0.4) continue;
        const hy = s.y - COURT_Y;
        if (hy < 0.2 || hy > 1.5) continue;
        if (s.bounces === 0 && (mustBounce || Math.abs(s.z) < KZ + 0.35)) continue;
        if (s.bounces >= 2) break;
        const need = Math.hypot(s.x - opp.pos.x, s.z - opp.pos.z) - d.reach * 0.7;
        if (need / d.speed <= s.t + 0.05) { best = s; break; }
        if (!best || s.t - need / d.speed > best.slack) { best = { ...s, slack: s.t - need / d.speed }; }
      }
      this.aiPlan.spot = best;
      if (this.aiPlan.leave && leave === null) opp.say(pick(['Out! Hrmm.', 'That is going out.', 'Hrmm, out!']));
    }
    const plan = this.aiPlan;
    plan.react -= dt;
    if (plan.react > 0) return;
    if (plan.leave) { opp.target = { x: opp.pos.x + (b.pos.x > opp.pos.x ? -0.6 : 0.6), z: opp.pos.z, speed: 2 }; return; }
    if (plan.spot) {
      // stand slightly beside the ball (paddle side)
      opp.target = { x: plan.spot.x - 0.35, z: plan.spot.z - 0.25, speed: d.speed };
      opp.faceYaw = 0;
    }
    // hit if the ball is in reach right now and the hit is legal
    const hd = Math.hypot(b.pos.x - opp.pos.x, b.pos.z - opp.pos.z), hy = b.pos.y - COURT_Y;
    if (b.pos.z < -0.2 && hd < d.reach && hy > 0.12 && hy < 1.9) {
      const mustBounce = b.shot <= 2 && b.bounces === 0;
      const inKitchen = opp.pos.z > -KZ;
      if (mustBounce || (b.bounces === 0 && inKitchen)) return; // wait for it
      this.aiHit();
    }
  }

  aiHit() {
    const opp = this.opponent, b = this.ball, d = this.diff, p = this.game.player;
    const hy = b.pos.y - COURT_Y;
    const nearNet = opp.pos.z > -4;
    let tx, tz, t, clearance = 0.15;
    const r = Math.random();
    if (hy > 1.35 && nearNet && r < 0.7) { tx = rand(-2.6, 2.6); tz = rand(3.5, 6.0); t = rand(0.45, 0.6); }          // smash
    else if (nearNet && hy < 0.7 && r < 0.65) { tx = rand(-2.4, 2.4); tz = rand(0.7, 2.0); t = rand(1.0, 1.25); }         // dink
    else if (p.pos.z < 3 && r < 0.25) { tx = rand(-2.2, 2.2); tz = rand(5.2, 6.3); t = 1.85; }                            // lob over a net-rusher
    else {
      // drive: often angled toward the sideline away from the player
      const away = -Math.sign(p.pos.x || 1);
      tx = Math.random() < 0.65 ? away * rand(1.4, 2.8) : rand(-2.6, 2.6);
      tz = rand(3.6, 6.3);
      t = Math.hypot(tx - b.pos.x, tz - b.pos.z) / rand(10, 14) + 0.28;
    }
    tx += rand(-1, 1) * d.errScale * 0.6; tz += rand(-1, 1) * d.errScale * 0.6;
    const pace = b.vel.length();
    const pressure = Math.max(0, this.rallyLen - 4) * 0.012; // long rallies wear villagers down
    if (Math.random() < d.err + pressure + Math.max(0, pace - 12) * 0.02) {
      const kind = Math.random();
      if (kind < 0.4) clearance = -0.5;                    // into the net
      else if (kind < 0.7) tz = rand(7.0, 8.2);            // long
      else tx = Math.sign(tx || 1) * rand(3.3, 4.2);       // wide
    }
    opp.swing = 1;
    this.launch('ai', this.solve(b.pos, tx, tz, t, clearance));
  }

  // Assist: landing marker + optional auto-positioning for the player.
  assist() {
    const g = this.game, b = this.ball, p = g.player;
    const incoming = b.lastHitter === 'ai' && b.live;
    if (incoming && g.settings.landingMarker) {
      const fb = this.firstBounce();
      if (fb && b.bounces === 0) { this.marker.visible = true; this.marker.position.set(fb.x, COURT_Y + 0.015, fb.z); }
      else this.marker.visible = false;
    } else this.marker.visible = false;
    if (incoming && g.settings.autoHustle) {
      const mustBounce = b.shot <= 2 && b.bounces === 0;
      const s = this.predict().find((q) => q.z > 0.3 && q.y - COURT_Y > 0.25 && q.y - COURT_Y < 1.6 && (q.bounces > 0 || (!mustBounce && q.z > KZ + 0.4)));
      p.autoTarget = s ? { x: s.x + 0.5, z: s.z + 0.35 } : null;
    } else p.autoTarget = null;
  }

  forfeit() {
    if (!this.active) return;
    this.game.ui.toast('FORFEIT', 'You walked off the court. That counts as a loss.', null, 3);
    this.winner = 'ai';
    this.referee.say('Forfeit! Oh no. You know what happens now.', { priority: true });
    this.finish();
  }

  finish() {
    const won = this.winner === 'player';
    const g = this.game;
    const final = `${this.score.player}-${this.score.ai}`;
    this.stop();
    g.onMatchOver(won, final, this.opponent);
  }

  updateHud(msg) {
    this.game.ui.matchHud({ you: this.score.player, opp: this.score.ai, oppName: this.opponent?.name || '', server: this.server, target: this.target, msg: msg || '' });
  }
}
