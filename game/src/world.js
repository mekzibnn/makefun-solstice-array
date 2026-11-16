// SOLSTICE ARRAY — world.js. One job: build the map.
// Desert solar farm at golden hour: mirrored panel arrays, Control Spire,
// Mirror Field, sand, dunes, crates and walls. Also owns the colliders
// (AABBs), the ray-vs-wall trace, and the bot waypoint graph.

import * as THREE from 'three';
import { MAP, SITES, mulberry32 } from './state.js';

// ---- canvas textures (generated at runtime, no files, no network) ---------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function sandTexture(rng) {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#c98f4e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5200; i++) {
      const x = rng() * w, y = rng() * h, r = 0.6 + rng() * 2.2;
      g.fillStyle = rng() < 0.5 ? 'rgba(160,105,55,0.25)' : 'rgba(235,190,120,0.22)';
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    // wind ripples
    g.strokeStyle = 'rgba(150,95,45,0.20)'; g.lineWidth = 2;
    for (let i = 0; i < 26; i++) {
      const y = rng() * h; g.beginPath();
      for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 5);
      g.stroke();
    }
  });
}
function panelTexture() {
  return canvasTex(256, 160, (g, w, h) => {
    g.fillStyle = '#0e1a2e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#16345c';
    for (let y = 6; y < h - 6; y += 22) for (let x = 6; x < w - 6; x += 32) g.fillRect(x, y, 26, 16);
    g.strokeStyle = 'rgba(255,190,90,0.55)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, h); g.lineTo(w, 0); g.stroke();
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.stroke();
  });
}
function signTexture(letter, sub) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#1c130a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffb03a'; g.lineWidth = 10; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#ffb03a'; g.font = 'bold 150px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(letter, w / 2, h / 2 - 18);
    g.font = 'bold 26px system-ui, sans-serif'; g.fillText(sub, w / 2, h - 52);
  });
}
function glowTexture() {
  return canvasTex(128, 128, (g, w, h) => {
    const r = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    r.addColorStop(0, 'rgba(255,220,150,1)'); r.addColorStop(0.35, 'rgba(255,170,70,0.55)');
    r.addColorStop(1, 'rgba(255,150,50,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  });
}

// ---- colliders -----------------------------------------------------------
// AABB: {x0,z0,x1,z1,y0,y1}. Ray trace + circle resolve use these only.
export const colliders = [];
function addBox(x, z, w, d, h, y0 = 0) {
  colliders.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y0, y1: y0 + h });
}
// Ray vs AABBs, slab test. Returns nearest hit distance or Infinity.
export function traceRay(ox, oy, oz, dx, dy, dz, maxDist) {
  let best = maxDist;
  for (const c of colliders) {
    let t0 = 0, t1 = best, ok = true;
    const o = [ox, oy, oz], d = [dx, dy, dz];
    const mn = [c.x0, c.y0, c.z0], mx = [c.x1, c.y1, c.z1];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) { ok = false; break; } continue; }
      let a = (mn[i] - o[i]) / d[i], b = (mx[i] - o[i]) / d[i];
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) t0 = a; if (b < t1) t1 = b;
      if (t0 > t1) { ok = false; break; }
    }
    if (ok && t0 > 0.001 && t0 < best) best = t0;
  }
  return best;
}
// Circle (agent) vs AABBs: push position out. Returns corrected x,z.
export function resolveCircle(x, z, r, y = 0.9) {
  for (const c of colliders) {
    if (y > c.y1 || y + 1.6 < c.y0) continue;
    const cx = Math.max(c.x0, Math.min(x, c.x1)), cz = Math.max(c.z0, Math.min(z, c.z1));
    const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-8) { const d = Math.sqrt(d2); x = cx + dx / d * r; z = cz + dz / d * r; }
      else { // inside: push out along smallest penetration axis
        const pl = x - c.x0, pr = c.x1 - x, pt = z - c.z0, pb = c.z1 - z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) x = c.x0 - r; else if (m === pr) x = c.x1 + r;
        else if (m === pt) z = c.z0 - r; else z = c.z1 + r;
      }
    }
  }
  const h = MAP.half - 0.6;
  x = Math.max(-h, Math.min(h, x)); z = Math.max(-h, Math.min(h, z));
  return [x, z];
}
export function losClear(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.01) return true;
  return traceRay(ax, ay, az, dx / len, dy / len, dz / len, len - 0.05) >= len - 0.05;
}

// ---- waypoint graph ------------------------------------------------------
export const waypoints = []; // {x, z, edges: [idx]}
function buildWaypoints() {
  const pts = [
    // HELIOS spawn + exits
    [0, 27], [-8, 24], [8, 24], [-14, 18], [0, 20], [14, 18],
    // west lane to A
    [-20, 12], [-26, 6], [-24, -2], [-26, -10], [-22, -14],
    // mid lane
    [-6, 12], [6, 12], [-6, 4], [6, 4], [0, -2], [-6, -8], [6, -8], [0, -14],
    // east lane to B
    [20, 12], [26, 6], [24, -2], [26, -10], [22, -14],
    // sites + north
    [-14, -18], [-28, -20], [14, -18], [28, -20], [-8, -24], [8, -24], [0, -26],
    // flank pockets
    [-28, 14], [28, 14], [-30, -2], [30, -2],
  ];
  for (const [x, z] of pts) waypoints.push({ x, z, edges: [] });
  for (let i = 0; i < waypoints.length; i++) for (let j = i + 1; j < waypoints.length; j++) {
    const a = waypoints[i], b = waypoints[j];
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (d < 13 && losClear(a.x, 1.0, a.z, b.x, 1.0, b.z)) { a.edges.push(j); b.edges.push(i); }
  }
}
export function nearestWaypoint(x, z) {
  let bi = 0, bd = 1e9;
  for (let i = 0; i < waypoints.length; i++) {
    const d = (waypoints[i].x - x) ** 2 + (waypoints[i].z - z) ** 2;
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}
// BFS path of waypoint indices from a to b.
export function findPath(a, b) {
  if (a === b) return [a];
  const prev = new Array(waypoints.length).fill(-1), q = [a];
  prev[a] = a;
  while (q.length) {
    const n = q.shift();
    for (const e of waypoints[n].edges) {
      if (prev[e] === -1) { prev[e] = n; if (e === b) { const p = [b]; let c = b; while (c !== a) { c = prev[c]; p.unshift(c); } return p; } q.push(e); }
    }
  }
  return [a];
}

// ---- map build -----------------------------------------------------------
export function buildWorld(scene, seed = 1) {
  const rng = mulberry32(seed);
  colliders.length = 0; waypoints.length = 0;
  const glowTex = glowTexture();

  // Golden-hour sky: gradient dome + low sun disc + warm fog.
  scene.fog = new THREE.Fog(0xe89a52, 55, 190);
  const skyTex = canvasTex(16, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#2c3a6e'); gr.addColorStop(0.45, '#7a5a8a');
    gr.addColorStop(0.62, '#e0703c'); gr.addColorStop(0.75, '#ffb35c'); gr.addColorStop(1, '#ffd9a0');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(220, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }));
  scene.add(sky);
  const sunSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffd9a0, fog: false, depthWrite: false }));
  sunSpr.position.set(-90, 26, -160); sunSpr.scale.set(70, 70, 1); scene.add(sunSpr);

  const hemi = new THREE.HemisphereLight(0xffc890, 0x8a5a30, 0.85); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb36b, 2.6);
  sun.position.set(-60, 34, 42); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
  sun.shadow.camera.far = 200; sun.shadow.bias = -0.0006;
  scene.add(sun); scene.add(sun.target);

  // Sand ground with a subtle dune rise at the edges.
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(240, 240),
    new THREE.MeshStandardMaterial({ map: sandTexture(rng), roughness: 1, metalness: 0 }));
  sand.material.map.repeat.set(6, 6); sand.material.map.wrapS = sand.material.map.wrapT = THREE.RepeatWrapping;
  sand.rotation.x = -Math.PI / 2; sand.receiveShadow = true; scene.add(sand);
  // Perimeter dunes (visual, outside the wall).
  const duneMat = new THREE.MeshStandardMaterial({ color: 0xb97a3e, roughness: 1 });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rng() * 0.2, r = 46 + rng() * 14;
    const d = new THREE.Mesh(new THREE.SphereGeometry(9 + rng() * 7, 12, 8), duneMat);
    d.scale.y = 0.22; d.position.set(Math.cos(a) * r, -0.4, Math.sin(a) * r);
    scene.add(d);
  }

  // Perimeter walls (sandstone) — the playfield boundary.
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xa8763f, roughness: 0.95 });
  const wallGeo = new THREE.BoxGeometry(70, MAP.wallH, 1.2);
  const mkWall = (x, z, ry) => {
    const m = new THREE.Mesh(wallGeo, wallMat);
    m.position.set(x, MAP.wallH / 2, z); m.rotation.y = ry;
    m.castShadow = true; m.receiveShadow = true; scene.add(m);
  };
  mkWall(0, -MAP.half, 0); mkWall(0, MAP.half, 0); mkWall(-MAP.half, 0, Math.PI / 2); mkWall(MAP.half, 0, Math.PI / 2);
  addBox(0, -MAP.half, 70, 1.2, MAP.wallH); addBox(0, MAP.half, 70, 1.2, MAP.wallH);
  addBox(-MAP.half, 0, 1.2, 70, MAP.wallH); addBox(MAP.half, 0, 1.2, 70, MAP.wallH);

  // ---- Solar panel arrays: the landmark. Two big fields + mid rows. ----
  const panelTex = panelTexture();
  const panelMat = new THREE.MeshStandardMaterial({ map: panelTex, roughness: 0.35, metalness: 0.3 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x6b5a44, roughness: 0.8, metalness: 0.4 });
  const panelGeo = new THREE.BoxGeometry(3.4, 0.1, 2.1);
  const postGeo = new THREE.BoxGeometry(0.22, 1.1, 0.22);
  const panelSpots = [];
  // West field (Mirror Field, site A) and east field (site B approach), plus mid rows.
  for (const [cx, cz, cols, rows, tilt] of [[-22, -6, 4, 3, -0.42], [22, -6, 4, 3, -0.42], [-10, 6, 3, 2, -0.42], [10, 6, 3, 2, -0.42], [-24, 8, 3, 2, -0.42], [24, 8, 3, 2, -0.42]]) {
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++)
      panelSpots.push([cx + (i - (cols - 1) / 2) * 4.2, cz + (j - (rows - 1) / 2) * 3.4, tilt]);
  }
  const panels = new THREE.InstancedMesh(panelGeo, panelMat, panelSpots.length);
  const posts = new THREE.InstancedMesh(postGeo, postMat, panelSpots.length * 2);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  panelSpots.forEach(([x, z, tilt], i) => {
    e.set(tilt, 0, 0); q.setFromEuler(e); v.set(x, 1.35, z);
    m4.compose(v, q, s); panels.setMatrixAt(i, m4);
    panels.getMatrixAt(i, m4); // keep
    for (const dx of [-1.2, 1.2]) {
      e.set(0, 0, 0); q.setFromEuler(e); v.set(x + dx, 0.55, z - 0.35);
      m4.compose(v, q, s); posts.setMatrixAt(i * 2 + (dx > 0 ? 1 : 0), m4);
    }
    addBox(x, z, 3.4, 2.1, 1.5); // panels block movement at body height
  });
  panels.castShadow = true; panels.receiveShadow = true;
  panels.instanceMatrix.needsUpdate = true; posts.instanceMatrix.needsUpdate = true;
  scene.add(panels); scene.add(posts);

  // ---- Control Spire (site B landmark): tower + dish + beacon. ----
  const spire = new THREE.Group();
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x8a8f98, roughness: 0.5, metalness: 0.6 });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, 16, 10), towerMat);
  tower.position.y = 8; tower.castShadow = true; spire.add(tower);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.0, 0.35, 10, 24), new THREE.MeshStandardMaterial({ color: 0xffb03a, roughness: 0.4, metalness: 0.5, emissive: 0x442200 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 15.2; spire.add(ring);
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 2.6, 2.2, 12), new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.35, metalness: 0.7 }));
  dish.position.y = 17; spire.add(dish);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff5a3c }));
  beacon.position.y = 18.6; spire.add(beacon);
  const beaconGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff6a3c, depthWrite: false }));
  beaconGlow.scale.set(4, 4, 1); beaconGlow.position.y = 18.6; spire.add(beaconGlow);
  spire.position.set(22, 0, -22); scene.add(spire);
  addBox(22, -22, 6.4, 6.4, 16);
  // Spire base platform + stairs blocks (cover).
  const plat = new THREE.Mesh(new THREE.BoxGeometry(9, 0.6, 9), new THREE.MeshStandardMaterial({ color: 0x9a7a4a, roughness: 0.9 }));
  plat.position.set(22, 0.3, -22); plat.receiveShadow = true; scene.add(plat);

  // ---- Mirror Field (site A): heliostat mirrors on posts + A sign. ----
  const mirrorMat = new THREE.MeshStandardMaterial({ color: 0xe8f4fa, roughness: 0.18, metalness: 0.35, emissive: 0x334455 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, x = -22 + Math.cos(a) * 4.6, z = -14 + Math.sin(a) * 4.6;
    const mir = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.4, 0.08), mirrorMat);
    mir.position.set(x, 1.6, z); mir.rotation.y = -a + Math.PI / 2; mir.rotation.x = -0.25;
    mir.castShadow = true; scene.add(mir);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.2, 8), postMat);
    pole.position.set(x, 0.6, z); scene.add(pole);
  }
  // Site signs: floating A / B boards.
  for (const [key, site] of Object.entries(SITES)) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4),
      new THREE.MeshBasicMaterial({ map: signTexture(site.short, site.name.toUpperCase()), transparent: true, side: THREE.DoubleSide }));
    sign.position.set(site.pos[0], 4.6, site.pos[1]); scene.add(sign);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4.6, 8), postMat);
    pole.position.set(site.pos[0], 2.3, site.pos[1]); scene.add(pole);
    // Site ground ring (painted).
    const ringM = new THREE.Mesh(new THREE.RingGeometry(site.radius - 0.35, site.radius, 40),
      new THREE.MeshBasicMaterial({ color: 0xffb03a, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
    ringM.rotation.x = -Math.PI / 2; ringM.position.set(site.pos[0], 0.03, site.pos[1]); scene.add(ringM);
  }

  // ---- Cover: crates, barriers, low walls (lanes + sightlines). ----
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x7a5c34, roughness: 0.9 });
  const crateMat2 = new THREE.MeshStandardMaterial({ color: 0x4a5a52, roughness: 0.9 });
  const crateGeo = new THREE.BoxGeometry(1.6, 1.6, 1.6);
  const crates = [
    [-6, 10, 0], [6, 10, 0], [-12, 2, 0], [12, 2, 0], [0, -4, 1], [-4, -12, 0], [4, -12, 0],
    [-16, -20, 1], [16, -20, 1], [-28, 2, 0], [28, 2, 0], [-10, 20, 1], [10, 20, 1],
    [0, 16, 0], [-20, -22, 0], [20, -22, 0], [-2, -20, 1], [2, -20, 1],
  ];
  for (const [x, z, alt] of crates) {
    const m = new THREE.Mesh(crateGeo, alt ? crateMat2 : crateMat);
    m.position.set(x, 0.8, z); m.rotation.y = (x * 7 + z * 3) % 0.6;
    m.castShadow = true; m.receiveShadow = true; scene.add(m);
    addBox(x, z, 1.7, 1.7, 1.6);
    if ((x + z) % 5 === 0) { // stacked second crate
      const m2 = new THREE.Mesh(crateGeo, crateMat2);
      m2.position.set(x + 0.2, 2.4, z - 0.2); m2.rotation.y = 0.4; m2.castShadow = true; scene.add(m2);
      addBox(x, z, 1.7, 1.7, 3.2);
    }
  }
  // Low sandbag walls mid-lane.
  const bagMat = new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 1 });
  for (const [x, z, w, ry] of [[-6, -2, 4, 0], [6, -2, 4, 0], [0, 6, 5, Math.PI / 2], [-14, 4, 4, Math.PI / 2], [14, 4, 4, Math.PI / 2]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, 0.8), bagMat);
    m.position.set(x, 0.55, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; scene.add(m);
    addBox(x, z, ry === 0 ? w : 0.8, ry === 0 ? 0.8 : w, 1.1);
  }
  // Inverter sheds (small buildings) flanking mid.
  for (const [x, z] of [[-16, -6], [16, -6]]) {
    const shed = new THREE.Mesh(new THREE.BoxGeometry(5, 3.2, 3.4), new THREE.MeshStandardMaterial({ color: 0xcfd6da, roughness: 0.6, metalness: 0.3 }));
    shed.position.set(x, 1.6, z); shed.castShadow = true; shed.receiveShadow = true; scene.add(shed);
    addBox(x, z, 5, 3.4, 3.2);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.25, 3.8), new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.5, metalness: 0.5 }));
    roof.position.set(x, 3.3, z); scene.add(roof);
  }

  buildWaypoints();
  return { sun, beaconGlow, spirePos: [22, -22] };
}
