// All sound is synthesized with Web Audio (no audio files). Villagers talk through the browser's
// speech synthesis, pitched up, each line preceded by a synthesized nasal "hrmm".
import { clamp, pick } from './util.js';

export class Audio {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.listener = { x: 0, y: 0, z: 0 };
    this.voiceQueue = [];
    this.speaking = false;
    this.voice = null;
    this.onCaption = null; // (speaker, text) => void
    this.musicTimer = 0;
    this.musicNodes = [];
    this.matchMusic = null;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;
      // compressor: keeps stacked explosions from clipping and lifts quiet layers on small phone speakers
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -18; this.comp.knee.value = 12; this.comp.ratio.value = 6;
      this.comp.attack.value = 0.003; this.comp.release.value = 0.25;
      this.comp.connect(c.destination);
      this.master = c.createGain(); this.master.connect(this.comp);
      // soft-clip curve: turns sub-bass booms into harmonics that phone speakers can actually play
      this.driveCurve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; this.driveCurve[i] = Math.tanh(x * 6); }
      // iOS can interrupt or suspend the context (calls, speech, backgrounding): resume on the next touch/key
      const resume = () => { if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); };
      for (const ev of ['touchstart', 'touchend', 'pointerdown', 'keydown']) addEventListener(ev, resume, { passive: true });
      c.onstatechange = () => { if (c.state !== 'running' && c.state !== 'closed') setTimeout(resume, 200); };
      this.sfx = c.createGain(); this.sfx.connect(this.master);
      this.music = c.createGain(); this.music.connect(this.master);
      // shared reverb for music and big moments
      this.reverb = c.createConvolver();
      const len = c.sampleRate * 2.5, ir = c.createBuffer(2, len, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
      this.reverb.buffer = ir;
      this.reverbGain = c.createGain(); this.reverbGain.gain.value = 0.5;
      this.reverb.connect(this.reverbGain); this.reverbGain.connect(this.master);
      const nlen = c.sampleRate * 2; this.noise = c.createBuffer(1, nlen, c.sampleRate);
      const nd = this.noise.getChannelData(0); for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    // iOS only allows speech that starts inside a user gesture; prime it once.
    if (window.speechSynthesis && !this.primed) {
      this.primed = true;
      const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u);
      this.pickVoice();
      speechSynthesis.onvoiceschanged = () => this.pickVoice();
    }
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    this.master.gain.value = s.volume;
    this.sfx.gain.value = 1;
    this.music.gain.value = s.music ? 0.32 : 0;
  }

  pickVoice() {
    const vs = window.speechSynthesis?.getVoices() || [];
    const en = vs.filter((v) => /^en/i.test(v.lang));
    const prefs = [/david/i, /guy/i, /mark/i, /daniel/i, /fred/i, /alex/i, /male/i, /zira/i, /samantha/i, /google us/i];
    for (const p of prefs) { const v = en.find((x) => p.test(x.name)); if (v) { this.voice = v; return; } }
    this.voice = en[0] || vs[0] || null;
  }

  // ---------- spatial helper ----------
  gainFor(pos, range = 28) {
    if (!pos) return 1;
    const dx = pos.x - this.listener.x, dy = pos.y - this.listener.y, dz = pos.z - this.listener.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return clamp(1 - d / range, 0, 1) ** 1.5;
  }

  // ---------- primitives ----------
  env(g, t, attack, peak, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }
  tone({ f = 440, f2 = null, type = 'sine', dur = 0.2, vol = 0.3, attack = 0.005, at = 0, dest = null, filter = null, drive = false }) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    let node = o;
    if (drive) { const ws = c.createWaveShaper(); ws.curve = this.driveCurve; ws.oversample = '2x'; node.connect(ws); node = ws; }
    if (filter) { const fl = c.createBiquadFilter(); fl.type = filter.type || 'lowpass'; fl.frequency.value = filter.f; fl.Q.value = filter.q || 0.7; node.connect(fl); node = fl; }
    node.connect(g); g.connect(dest || this.sfx);
    this.env(g, t, attack, vol, dur);
    o.start(t); o.stop(t + attack + dur + 0.05);
  }
  noiseHit({ dur = 0.1, f = 1000, q = 1, type = 'bandpass', vol = 0.3, attack = 0.003, at = 0, f2 = null, dest = null }) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + at;
    const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = c.createGain();
    s.connect(fl); fl.connect(g); g.connect(dest || this.sfx);
    this.env(g, t, attack, vol, dur);
    s.start(t, Math.random() * 1.5); s.stop(t + attack + dur + 0.05);
  }

  // ---------- sound effects ----------
  play(name, { pos = null, vol = 1, mat = 'stone', range = 28 } = {}) {
    if (!this.ctx || this.settings.volume <= 0) return;
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    if (name === 'explosion' || name === 'stomp') range = Math.max(range, vol > 1.2 ? 80 : 40); // big sounds carry
    const v = vol * this.gainFor(pos, range);
    if (v <= 0.01) return;
    const r = 1 + (Math.random() - 0.5) * 0.15;
    switch (name) {
      case 'dig': case 'place': case 'step': {
        const m = mat, k = name === 'step' ? 0.35 : name === 'place' ? 0.9 : 0.7;
        if (m === 'grass') this.noiseHit({ f: 900 * r, q: 0.6, dur: 0.12, vol: 0.5 * k * v });
        else if (m === 'gravel') this.noiseHit({ f: 600 * r, q: 0.8, dur: 0.12, vol: 0.55 * k * v });
        else if (m === 'sand') this.noiseHit({ f: 2600 * r, type: 'highpass', dur: 0.14, vol: 0.35 * k * v });
        else if (m === 'wood') { this.tone({ f: 260 * r, type: 'triangle', dur: 0.08, vol: 0.4 * k * v }); this.noiseHit({ f: 1300, dur: 0.06, vol: 0.25 * k * v }); }
        else if (m === 'glass') { this.tone({ f: 2400 * r, dur: 0.12, vol: 0.2 * k * v }); this.tone({ f: 3300 * r, dur: 0.1, vol: 0.15 * k * v }); }
        else if (m === 'cloth') this.noiseHit({ f: 500, type: 'lowpass', dur: 0.1, vol: 0.5 * k * v });
        else if (m === 'roy') { this.tone({ f: 170 * r, f2: 95, type: 'sawtooth', dur: 0.18, vol: 0.35 * k * v, filter: { f: 700 } }); }
        else { this.noiseHit({ f: 1700 * r, q: 1.2, dur: 0.08, vol: 0.5 * k * v }); this.tone({ f: 140 * r, dur: 0.05, vol: 0.2 * k * v }); }
        break;
      }
      case 'break': this.noiseHit({ f: 800 * r, q: 0.5, dur: 0.2, vol: 0.6 * v }); break;
      case 'pock': // the pickleball sound
        this.tone({ f: 1350 * r, dur: 0.045, vol: 0.55 * v }); this.tone({ f: 880 * r, type: 'triangle', dur: 0.05, vol: 0.35 * v });
        this.noiseHit({ f: 2600, q: 2, dur: 0.025, vol: 0.4 * v }); break;
      case 'bounce': this.tone({ f: 520 * r, f2: 320, dur: 0.05, vol: 0.4 * v }); this.noiseHit({ f: 900, dur: 0.03, vol: 0.2 * v }); break;
      case 'net': this.noiseHit({ f: 400, q: 0.5, dur: 0.25, vol: 0.4 * v }); break;
      case 'whoosh': this.noiseHit({ f: 700, f2: 2400, q: 0.8, dur: 0.15, vol: 0.18 * v }); break;
      case 'explosion': {
        const big = vol > 1.2, d = big ? 2.8 : 1.5;
        // sub-bass rumble (big speakers)
        this.noiseHit({ f: 1400, f2: 90, type: 'lowpass', dur: d, vol: 0.5 * v, attack: 0.01 });
        this.tone({ f: 70, f2: 28, dur: d * 0.85, vol: 0.45 * v, attack: 0.01 });
        // mid-range body and crunch (what phone speakers can reproduce)
        this.tone({ f: 110, f2: 40, type: 'sawtooth', dur: d * 0.7, vol: 0.8 * v, attack: 0.005, drive: true, filter: { f: 2400 } });
        this.noiseHit({ f: 1000, f2: 300, q: 0.5, dur: d * 0.75, vol: 1.6 * v, attack: 0.004 });
        this.noiseHit({ f: 2600, type: 'highpass', dur: 0.3, vol: 0.8 * v, attack: 0.002 });
        for (let i = 0; i < (big ? 18 : 10); i++) this.noiseHit({ f: 1200 + Math.random() * 2800, q: 2.5, dur: 0.06, vol: 0.5 * v, at: 0.08 + Math.random() * d * 0.6 });
        this.noiseHit({ f: 3000, f2: 300, q: 0.4, dur: 0.5, vol: 0.5 * v, dest: this.reverb });
        break;
      }
      case 'hiss': this.noiseHit({ f: 3800, f2: 5000, type: 'highpass', dur: 1.5, attack: 1.2, vol: 0.35 * v }); break;
      case 'hurt': this.tone({ f: 330, f2: 150, type: 'square', dur: 0.16, vol: 0.22 * v, filter: { f: 1400 } }); break;
      case 'eat': for (let i = 0; i < 3; i++) this.noiseHit({ f: 1500 + i * 300, q: 1.5, dur: 0.06, vol: 0.4 * v, at: i * 0.13 }); break;
      case 'pop': this.tone({ f: 600, f2: 1300, dur: 0.07, vol: 0.3 * v }); break;
      case 'click': this.tone({ f: 1800, dur: 0.03, vol: 0.15 * v }); break;
      case 'splash': this.noiseHit({ f: 1200, q: 0.4, dur: 0.35, vol: 0.4 * v }); break;
      case 'cluck': this.tone({ f: 900 * r, f2: 500, type: 'square', dur: 0.06, vol: 0.12 * v, filter: { f: 2000, type: 'bandpass', q: 3 } }); this.tone({ f: 800 * r, f2: 650, type: 'square', dur: 0.05, vol: 0.1 * v, at: 0.09, filter: { f: 1800, type: 'bandpass', q: 3 } }); break;
      case 'levelup': [523, 659, 784, 1047].forEach((f, i) => this.tone({ f, type: 'square', dur: 0.15, vol: 0.12 * v, at: i * 0.09, filter: { f: 3000 } })); break;
      case 'fanfare': [392, 523, 659, 784, 659, 784, 1047].forEach((f, i) => this.tone({ f, type: 'square', dur: i === 6 ? 0.8 : 0.16, vol: 0.14 * v, at: i * 0.14, filter: { f: 3500 } })); break;
      case 'doom': {
        this.tone({ f: 55, type: 'sawtooth', dur: 4, attack: 0.5, vol: 0.4 * v, filter: { f: 300 } });
        this.tone({ f: 58, type: 'sawtooth', dur: 4, attack: 0.5, vol: 0.3 * v, filter: { f: 260 } });
        [196, 185, 175, 147].forEach((f, i) => {
          this.tone({ f, type: 'triangle', dur: 0.9, vol: 0.2 * v, at: i * 0.7, dest: this.reverb });
          this.tone({ f, type: 'sawtooth', dur: 0.8, vol: 0.12 * v, at: i * 0.7, filter: { f: 1600 } }); // harmonics for phone speakers
        });
        break;
      }
      case 'stomp':
        this.tone({ f: 60, f2: 35, dur: 0.35, vol: 0.4 * v, attack: 0.005 });                                     // sub thud
        this.tone({ f: 95, f2: 48, type: 'square', dur: 0.28, vol: 0.75 * v, drive: true, filter: { f: 1400 } }); // audible "boom" harmonics
        this.noiseHit({ f: 500, q: 0.8, dur: 0.26, vol: 1.4 * v, attack: 0.003 });                                // body
        this.noiseHit({ f: 1700, q: 1.3, dur: 0.08, vol: 0.6 * v });                                              // ground crunch
        break;
      case 'rustle': for (let i = 0; i < 4; i++) this.noiseHit({ f: 2500, q: 0.5, dur: 0.18, vol: 0.25 * v, at: i * 0.12 }); break;
      case 'cheer': {
        for (let i = 0; i < 5; i++) this.noiseHit({ f: 1100 + Math.random() * 900, q: 0.8, dur: 1.2, attack: 0.15, vol: 0.12 * v, at: i * 0.05 });
        for (let i = 0; i < 6; i++) this.hrmm({ pitch: 1 + Math.random() * 0.8, kind: 'happy', vol: 0.5 * v, at: Math.random() * 0.8 });
        break;
      }
      case 'gasp': for (let i = 0; i < 5; i++) this.hrmm({ pitch: 0.9 + Math.random() * 0.6, kind: 'sad', vol: 0.5 * v, at: Math.random() * 0.5 }); break;
      case 'scream': for (let i = 0; i < 6; i++) this.hrmm({ pitch: 1.6 + Math.random() * 0.8, kind: 'question', vol: 0.7 * v, at: i * 0.12 }); break;
    }
  }

  // A villager "hrmm": buzzy glottal source through a nasal filter bank.
  hrmm({ pitch = 1, kind = 'neutral', vol = 0.6, pos = null, at = 0 } = {}) {
    const c = this.ctx; if (!c) return;
    const v = vol * this.gainFor(pos);
    if (v < 0.01) return;
    const t = c.currentTime + at, dur = kind === 'happy' ? 0.28 : 0.38;
    const f0 = 135 * pitch;
    const o = c.createOscillator(); o.type = 'sawtooth';
    const contour = { neutral: [1, 1.08, 0.82], question: [0.9, 0.95, 1.35], happy: [1.1, 1.3, 1.0], sad: [1.0, 0.9, 0.68] }[kind] || [1, 1, 0.8];
    o.frequency.setValueAtTime(f0 * contour[0], t);
    o.frequency.linearRampToValueAtTime(f0 * contour[1], t + dur * 0.35);
    o.frequency.linearRampToValueAtTime(f0 * contour[2], t + dur);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    const nasal = c.createBiquadFilter(); nasal.type = 'peaking'; nasal.frequency.value = 270; nasal.gain.value = 16; nasal.Q.value = 1.6;
    const anti = c.createBiquadFilter(); anti.type = 'notch'; anti.frequency.value = 950; anti.Q.value = 1.8;
    const buzz = c.createBiquadFilter(); buzz.type = 'peaking'; buzz.frequency.value = 2500; buzz.gain.value = 7; buzz.Q.value = 2;
    const g = c.createGain();
    o.connect(lp); lp.connect(nasal); nasal.connect(anti); anti.connect(buzz); buzz.connect(g); g.connect(this.sfx);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25 * v, t + 0.05);
    g.gain.setValueAtTime(0.25 * v, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.05);
    this.noiseHit({ f: 1600, q: 0.7, dur: 0.07, vol: 0.12 * v, at });
  }

  // ---------- speech ----------
  /**
   * Speak a line. who: { name, pitch, rate, kind } . Captions always show, even with voices off.
   */
  say(who, text, { pos = null, priority = false, hrmm = true } = {}) {
    this.onCaption?.(who.name, text);
    const v = this.gainFor(pos, 40);
    if (hrmm) this.hrmm({ pitch: who.hrmmPitch ?? 1.2, kind: text.endsWith('?') ? 'question' : text.endsWith('!') ? 'happy' : 'neutral', pos, vol: 0.7 });
    if (!this.settings.voices || !window.speechSynthesis || v < 0.05) return;
    const item = { who, text, vol: Math.max(0.35, v) };
    if (priority) { this.voiceQueue = [item]; speechSynthesis.cancel(); this.speaking = false; }
    else { if (this.voiceQueue.length >= 2) this.voiceQueue.shift(); this.voiceQueue.push(item); }
    this.pump();
  }
  pump() {
    if (this.speaking || !this.voiceQueue.length) return;
    const { who, text, vol } = this.voiceQueue.shift();
    const u = new SpeechSynthesisUtterance(text.replace(/hrm+/gi, 'hrrm'));
    if (this.voice) u.voice = this.voice;
    u.pitch = clamp(who.pitch ?? 1.8, 0, 2);
    u.rate = clamp(who.rate ?? 1.15, 0.5, 2);
    u.volume = clamp(vol * this.settings.volume * 1.4, 0, 1);
    this.speaking = true;
    const done = () => {
      this.speaking = false;
      if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); // iOS may pause Web Audio during speech
      setTimeout(() => this.pump(), 60);
    };
    u.onend = done; u.onerror = done;
    setTimeout(() => { if (this.speaking && !speechSynthesis.speaking) done(); }, 6000);
    speechSynthesis.speak(u);
  }
  hush() {
    this.voiceQueue = []; if (window.speechSynthesis) speechSynthesis.cancel(); this.speaking = false;
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  // ---------- music ----------
  update(dt, inMatch) {
    if (!this.ctx || !this.settings.music) { this.stopMatchMusic(); return; }
    if (inMatch) { this.startMatchMusic(); return; }
    this.stopMatchMusic();
    this.musicTimer -= dt;
    if (this.musicTimer <= 0) { this.musicTimer = 100 + Math.random() * 120; this.ambientPiece(); }
  }
  pianoNote(f, at, dur = 2.6, vol = 0.12) {
    const c = this.ctx, t = c.currentTime + at;
    for (const [mult, type, v] of [[1, 'sine', 1], [2, 'sine', 0.25], [3, 'triangle', 0.08]]) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = f * mult;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol * v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.music); g.connect(this.reverb);
      o.start(t); o.stop(t + dur + 0.1);
    }
  }
  ambientPiece() {
    const roots = [261.63, 220, 174.61, 196];
    const scale = [0, 2, 4, 7, 9, 12, 14, 16];
    const root = pick(roots);
    let at = 0.5;
    for (let i = 0; i < 26; i++) {
      const n = scale[Math.floor(Math.random() * scale.length)];
      this.pianoNote(root * Math.pow(2, n / 12), at, 3, 0.09);
      if (i % 6 === 0) { this.pianoNote(root / 2, at, 4, 0.07); this.pianoNote(root / 2 * 1.5, at, 4, 0.05); }
      at += pick([0.6, 0.9, 1.2, 1.8]);
    }
  }
  startMatchMusic() {
    if (this.matchMusic) return;
    const c = this.ctx, bpm = 132, beat = 60 / bpm;
    const bass = [130.81, 130.81, 196, 196, 174.61, 174.61, 196, 220];
    const mel = [523, 0, 659, 784, 659, 0, 587, 523, 440, 0, 523, 587, 659, 0, 784, 0];
    let step = 0, next = c.currentTime + 0.1;
    const tick = () => {
      while (next < c.currentTime + 0.3) {
        const b = bass[Math.floor(step / 2) % bass.length];
        if (step % 2 === 0) this.tone({ f: b, type: 'square', dur: beat * 0.8, vol: 0.06, at: next - c.currentTime, dest: this.music, filter: { f: 900 } });
        const m = mel[step % mel.length];
        if (m && Math.floor(step / 16) % 2 === 1) this.tone({ f: m, type: 'square', dur: beat * 0.4, vol: 0.035, at: next - c.currentTime, dest: this.music, filter: { f: 2500 } });
        if (step % 4 === 2) this.noiseHit({ f: 6000, type: 'highpass', dur: 0.03, vol: 0.05, at: next - c.currentTime, dest: this.music });
        next += beat / 2; step++;
      }
    };
    this.matchMusic = setInterval(tick, 100);
  }
  stopMatchMusic() { if (this.matchMusic) { clearInterval(this.matchMusic); this.matchMusic = null; } }
}
