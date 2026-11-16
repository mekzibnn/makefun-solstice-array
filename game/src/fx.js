// SOLSTICE ARRAY — fx.js. One job: transient visuals, pooled, no per-frame
// allocation in the hot loop. Tracers, muzzle flash, impacts, smoke, blasts.

import * as THREE from 'three';

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  r.addColorStop(0, 'rgba(255,230,170,1)'); r.addColorStop(0.4, 'rgba(255,170,70,0.5)');
  r.addColorStop(1, 'rgba(255,150,50,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function smokeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const x = 20 + Math.random() * 88, y = 20 + Math.random() * 88, r = 12 + Math.random() * 22;
    const gr = g.createRadialGradient(x, y, 1, x, y, r);
    gr.addColorStop(0, 'rgba(230,205,160,0.55)'); gr.addColorStop(1, 'rgba(230,205,160,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.glowTex = glowTexture();
    this.smokeTex = smokeTexture();
    // Pooled tracers: 24 lines, reused round-robin.
    this.tracerGeo = new THREE.BufferGeometry();
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 6), 3));
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tracerLines = new THREE.LineSegments(this.tracerGeo, this.tracerMat);
    this.tracerLines.frustumCulled = false; this.scene.add(this.tracerLines);
    this.tracerAge = new Float32Array(24); this.tracerNext = 0;
    // Pooled muzzle sprites + one light.
    this.flashes = [];
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffc46b, transparent: true, opacity: 0, depthWrite: false }));
      s.scale.set(0.7, 0.7, 1); this.scene.add(s);
      this.flashes.push({ s, t: 0 });
    }
    this.flashLight = new THREE.PointLight(0xffb35c, 0, 9, 2); this.scene.add(this.flashLight);
    // Pooled impact sparks (small additive sprites).
    this.sparks = [];
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false }));
      s.scale.set(0.5, 0.5, 1); this.scene.add(s);
      this.sparks.push({ s, t: 0, vx: 0, vy: 0, vz: 0 });
    }
    // Smoke clouds: each a group of sprites that grows and fades.
    this.smokes = [];
    // Explosion flash pool.
    this.blasts = [];
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xff8a3c, transparent: true, opacity: 0, depthWrite: false }));
      s.scale.set(6, 6, 1); this.scene.add(s);
      this.blasts.push({ s, t: 0 });
    }
  }
  tracer(a, b, color) {
    const i = this.tracerNext; this.tracerNext = (this.tracerNext + 1) % 24;
    const p = this.tracerGeo.attributes.position.array;
    p[i * 6] = a.x; p[i * 6 + 1] = a.y; p[i * 6 + 2] = a.z;
    p[i * 6 + 3] = b.x; p[i * 6 + 4] = b.y; p[i * 6 + 5] = b.z;
    this.tracerGeo.attributes.position.needsUpdate = true;
    this.tracerMat.color.setHex(color);
    this.tracerAge[i] = 0.09;
  }
  muzzle(origin, yaw, pitch) {
    const f = this.flashes.find(f => f.t <= 0) || this.flashes[0];
    const dx = -Math.sin(yaw) * Math.cos(pitch), dy = Math.sin(pitch), dz = -Math.cos(yaw) * Math.cos(pitch);
    f.s.position.set(origin.x + dx * 0.4, origin.y + dy * 0.4, origin.z + dz * 0.4);
    f.s.material.opacity = 1; f.t = 0.06;
    this.flashLight.position.copy(f.s.position);
    this.flashLight.intensity = 6;
  }
  impact(p, head) {
    const s = this.sparks.find(s => s.t <= 0) || this.sparks[0];
    s.s.position.set(p.x, p.y, p.z);
    s.s.material.opacity = 1; s.s.material.color.setHex(head ? 0xff5a4a : 0xffd27a);
    s.t = 0.18; s.vx = (Math.random() - 0.5) * 2; s.vy = 1.5; s.vz = (Math.random() - 0.5) * 2;
  }
  blast(p) {
    const b = this.blasts.find(b => b.t <= 0) || this.blasts[0];
    b.s.position.set(p.x, p.y + 0.6, p.z); b.s.material.opacity = 1; b.t = 0.5;
    this.flashLight.position.set(p.x, p.y + 1, p.z); this.flashLight.intensity = 30;
  }
  smoke(p, duration = 14) {
    const group = new THREE.Group();
    const sprites = [];
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, opacity: 0.85, depthWrite: false }));
      s.position.set((Math.random() - 0.5) * 3.4, 0.4 + Math.random() * 1.8, (Math.random() - 0.5) * 3.4);
      const sc = 2.2 + Math.random() * 1.6; s.scale.set(sc, sc, 1);
      group.add(s); sprites.push(s);
    }
    group.position.set(p.x, p.y, p.z); this.scene.add(group);
    this.smokes.push({ group, sprites, t: 0, duration });
  }
  update(dt) {
    // Tracers fade by collapsing aged segments to a point.
    const p = this.tracerGeo.attributes.position.array;
    let dirty = false;
    for (let i = 0; i < 24; i++) {
      if (this.tracerAge[i] > 0) {
        this.tracerAge[i] -= dt;
        if (this.tracerAge[i] <= 0) { p[i * 6 + 3] = p[i * 6]; p[i * 6 + 4] = p[i * 6 + 1]; p[i * 6 + 5] = p[i * 6 + 2]; dirty = true; }
      }
    }
    if (dirty) this.tracerGeo.attributes.position.needsUpdate = true;
    for (const f of this.flashes) if (f.t > 0) { f.t -= dt; f.s.material.opacity = Math.max(0, f.t / 0.06); }
    if (this.flashLight.intensity > 0) this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 260);
    for (const s of this.sparks) if (s.t > 0) {
      s.t -= dt; s.s.material.opacity = Math.max(0, s.t / 0.18);
      s.s.position.x += s.vx * dt; s.s.position.y += s.vy * dt; s.s.position.z += s.vz * dt; s.vy -= 6 * dt;
    }
    for (const b of this.blasts) if (b.t > 0) {
      b.t -= dt; b.s.material.opacity = Math.max(0, b.t / 0.5);
      const k = 1 + (0.5 - b.t) * 4; b.s.scale.set(6 * k, 6 * k, 1);
    }
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const sm = this.smokes[i]; sm.t += dt;
      const life = sm.t / sm.duration;
      if (life >= 1) { this.scene.remove(sm.group); this.smokes.splice(i, 1); continue; }
      const grow = 1 + life * 1.6, fade = life < 0.8 ? 0.85 : 0.85 * (1 - (life - 0.8) / 0.2);
      for (const s of sm.sprites) { s.scale.set(s.scale.x * (1 + dt * 0.25), s.scale.y * (1 + dt * 0.25), 1); s.material.opacity = fade; }
      sm.group.scale.setScalar(grow);
    }
  }
}
