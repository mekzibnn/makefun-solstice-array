// SOLSTICE ARRAY — agents.js (part 1). One job: the fighters.
// Player FPS controller + bot AI + hit resolution + plant/defuse.
// Bots route on the waypoint graph, hold sites, react to sight and gunfire
// noise, strafe in duels, plant and defuse. Aim is nerfed so duels are winnable.

import * as THREE from 'three';
import { S, TEAMS, SITES, WEAPONS, ECON, ROUND, clamp, logEvent, pushKillfeed, pushRadio, mulberry32 } from './state.js';
import { resolveCircle, losClear, waypoints, nearestWaypoint, findPath, traceRay } from './world.js';
import { makeLoadout, currentSpread, fireWeapon, startReload, updateReload, canFire } from './weapons.js';

const BOT_NAMES = {
  HELIOS: ['Kiran', 'Sol', 'Ember'],
  UMBRA: ['Vesper', 'Noct', 'Shade', 'Mira'],
};
const EYE = 1.62, RADIUS = 0.42;

function agentMesh(team, isPlayer) {
  const g = new THREE.Group();
  const col = TEAMS[team].color;
  const suit = new THREE.MeshStandardMaterial({ color: col, roughness: 0.7, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.9 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), suit);
  torso.position.y = 1.05; torso.castShadow = true; g.add(torso);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.4, 0.4), dark);
  vest.position.y = 1.12; g.add(vest);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), dark);
  head.position.y = 1.62; head.castShadow = true; g.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.05),
    new THREE.MeshStandardMaterial({ color: team === 'HELIOS' ? 0xffc46b : 0x7ad4ff, emissive: team === 'HELIOS' ? 0x664400 : 0x003344, roughness: 0.2 }));
  visor.position.set(0, 1.64, 0.18); g.add(visor);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.68, 0.26), dark); legL.position.set(-0.16, 0.36, 0); g.add(legL);
  const legR = legL.clone(); legR.position.x = 0.16; g.add(legR);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.85), new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.4, metalness: 0.7 }));
  gun.position.set(0.3, 1.18, 0.3); g.add(gun);
  if (isPlayer) g.visible = false; // first person: viewmodel only
  return g;
}
function viewmodelGun() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.62), new THREE.MeshStandardMaterial({ color: 0x232120, roughness: 0.35, metalness: 0.75 }));
  g.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0x111010, roughness: 0.3, metalness: 0.8 }));
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.42); g.add(barrel);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.1), new THREE.MeshStandardMaterial({ color: 0x2e2a26, roughness: 0.5 }));
  mag.position.set(0, -0.14, -0.05); g.add(mag);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.12), new THREE.MeshStandardMaterial({ color: 0xffb03a, emissive: 0x442200, roughness: 0.4 }));
  sight.position.set(0, 0.09, -0.1); g.add(sight);
  g.position.set(0.3, -0.28, -0.62);
  g.scale.setScalar(0.72);
  return g;
}

export function makeAgent(id, name, team, bot, scene, isPlayer) {
  const a = {
    id, name, team, bot, isPlayer,
    x: 0, z: 0, y: 0, vy: 0, yaw: 0, pitch: 0,
    vel: { x: 0, z: 0 }, hp: 100, armour: 0, helmet: false, kit: false,
    alive: true, cash: ECON.startCash,
    loadout: makeLoadout('sidewinder'), sidearm: makeLoadout('sidewinder'),
    grenades: { frag: 0, smoke: 0, flash: 0 },
    kills: 0, assists: 0, deaths: 0, headshots: 0, damage: 0,
    crouch: false, aiming: false, onGround: true,
    recoil: 0, recoilPitch: 0, flashT: 0, hasCharge: false, channel: null, // {kind:'plant'|'defuse', t, dur}
    lastDamager: null, lastDamageT: -99, damagers: {},
    mesh: agentMesh(team, isPlayer),
    ai: bot ? { state: 'route', path: [], pathIdx: 0, holdT: 0, target: null, lastSeen: null, reactT: 0, burst: 0, burstPause: 0, strafe: 1, strafeT: 0, role: 'push', site: 'A', thinkT: Math.random() * 0.15, hasCharge: false, noise: null, destNode: 0 } : null,
    walkPhase: 0, stepT: 0,
  };
  scene.add(a.mesh);
  return a;
}

export function createAgents(scene) {
  const agents = [];
  agents.push(makeAgent(0, 'You', 'HELIOS', false, scene, true));
  BOT_NAMES.HELIOS.forEach((n, i) => agents.push(makeAgent(1 + i, n, 'HELIOS', true, scene, false)));
  BOT_NAMES.UMBRA.forEach((n, i) => agents.push(makeAgent(4 + i, n, 'UMBRA', true, scene, false)));
  return agents;
}
export function aliveCount(agents, team) { return agents.filter(a => a.alive && a.team === team).length; }
export function agentEye(a) { return { x: a.x, y: a.y + (a.crouch ? 1.15 : EYE), z: a.z }; }
export function agentMuzzle(a) {
  const e = agentEye(a);
  return { x: e.x - Math.sin(a.yaw) * 0.5, y: e.y - 0.16, z: e.z - Math.cos(a.yaw) * 0.5 };
}

// ---- hit resolution ------------------------------------------------------
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return Infinity;
  return tca - Math.sqrt(r * r - d2);
}
// Nearest agent hit by a ray. Returns {agent, part, dist, point} or null.
export function rayVsAgents(ox, oy, oz, dx, dy, dz, maxDist, shooter, agents) {
  let best = null;
  for (const a of agents) {
    if (!a.alive || a === shooter) continue;
    const tests = [
      ['head', a.x, a.y + 1.56, a.z, 0.27],
      ['body', a.x, a.y + 0.98, a.z, 0.5],
      ['leg', a.x, a.y + 0.42, a.z, 0.44],
    ];
    for (const [part, cx, cy, cz, r] of tests) {
      const d = raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r);
      if (d < maxDist && (!best || d < best.dist)) {
        best = { agent: a, part, dist: d, point: { x: ox + dx * d, y: oy + dy * d, z: oz + dz * d } };
      }
    }
  }
  return best;
}

export function applyDamage(victim, rawDmg, part, attacker, ctx) {
  if (!victim.alive || S.phase !== 'live') return;
  let dmg = rawDmg;
  if (victim.armour > 0) { const absorbed = dmg * 0.5; victim.armour = Math.max(0, victim.armour - absorbed); dmg -= absorbed; }
  dmg = Math.round(dmg);
  victim.hp -= dmg;
  victim.lastDamager = attacker; victim.lastDamageT = ctx.time;
  if (attacker) { attacker.damage += dmg; victim.damagers[attacker.id] = ctx.time; }
  if (victim.isPlayer) { ctx.audio.hurt(); ctx.hudDamage(); }
  else if (attacker && attacker.isPlayer) { ctx.audio[part === 'head' ? 'headshot' : 'hit'](); ctx.hudHitmark(part === 'head'); }
  if (victim.hp <= 0) {
    victim.hp = 0; victim.alive = false; victim.deaths += 1; victim.channel = null;
    victim.mesh.rotation.x = -Math.PI / 2; victim.mesh.position.y = 0.25;
    if (attacker && attacker !== victim) {
      attacker.kills += 1;
      if (part === 'head') attacker.headshots += 1;
      attacker.cash += ECON.kill;
      pushKillfeed(`${attacker.name}  [${WEAPONS[attacker.loadout.id].name}]  ${victim.name}`, part === 'head');
      // Assist: anyone else who damaged the victim in the last 5 s.
      for (const a of ctx.agents) {
        if (a !== attacker && a !== victim && victim.damagers[a.id] !== undefined && ctx.time - victim.damagers[a.id] < 5) a.assists += 1;
      }
    }
    if (victim.hasCharge) { // charge drops where the carrier fell
      S.bomb.state = 'dropped'; S.bomb.carrier = null; victim.hasCharge = false;
      S.bomb.dropPos = [victim.x, victim.z];
      pushRadio('Command', 'HQ', 'Charge dropped — pick it up.');
    }
    logEvent(`kill ${attacker ? attacker.name : '?'} -> ${victim.name} (${part})`);
    ctx.onKill(victim, attacker);
  }
}

// ---- movement ------------------------------------------------------------
function moveAgent(a, ix, iz, dt, speed) {
  // ix/iz: wish direction in world space (already normalized-ish).
  const accel = 42, friction = 10;
  a.vel.x += ix * accel * dt; a.vel.z += iz * accel * dt;
  const sp = Math.hypot(a.vel.x, a.vel.z);
  const max = speed;
  if (sp > max) { a.vel.x *= max / sp; a.vel.z *= max / sp; }
  // Friction when no input.
  if (ix === 0 && iz === 0) {
    const f = Math.max(0, 1 - friction * dt);
    a.vel.x *= f; a.vel.z *= f;
  }
  let nx = a.x + a.vel.x * dt, nz = a.z + a.vel.z * dt;
  [nx, nz] = resolveCircle(nx, nz, RADIUS, a.y + 0.9);
  a.x = nx; a.z = nz;
  // Gravity / jump.
  if (!a.onGround) { a.vy -= 22 * dt; a.y += a.vy * dt; if (a.y <= 0) { a.y = 0; a.vy = 0; a.onGround = true; } }
  // Footstep sounds + walk bob phase.
  const moving = Math.hypot(a.vel.x, a.vel.z);
  if (moving > 1 && a.onGround) {
    a.walkPhase += dt * moving * 1.6;
    a.stepT -= dt;
    if (a.stepT <= 0) { a.stepT = 0.38; if (a.isPlayer) a._stepSound && a._stepSound(); }
  }
}

// ---- vision --------------------------------------------------------------
// Can a see b? FOV + distance + wall LOS + smoke. Returns 'head'|'body'|null.
export function canSee(a, b, ctx, fovCos = -0.1) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 62) return null;
  // Facing check (bots only; the player sees everything in front of the camera).
  if (a.bot) {
    const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
    if ((dx * fx + dz * fz) / (dist || 1) < fovCos) return null;
  }
  const ae = agentEye(a), be = agentEye(b);
  if (!losClear(ae.x, ae.y, ae.z, be.x, be.y, be.z)) return null;
  // Smoke blocks: segment passes through any live cloud?
  for (const c of ctx.smokeClouds) {
    if (segmentHitsSphere(ae.x, ae.y, ae.z, be.x, be.y, be.z, c.x, 1.2, c.z, c.r)) return null;
  }
  return dist < 26 ? 'body' : 'body';
}
function segmentHitsSphere(ax, ay, az, bx, by, bz, cx, cy, cz, r) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz || 1;
  let t = ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / len2;
  t = clamp(t, 0, 1);
  const px = ax + dx * t - cx, py = ay + dy * t - cy, pz = az + dz * t - cz;
  return px * px + py * py + pz * pz < r * r;
}
function nearestEnemy(a, ctx) {
  let best = null, bd = 1e9;
  for (const o of ctx.agents) {
    if (!o.alive || o.team === a.team) continue;
    const d = Math.hypot(o.x - a.x, o.z - a.z);
    if (d < bd) { bd = d; best = o; }
  }
  return { enemy: best, dist: bd };
}

// ---- player --------------------------------------------------------------
export function updatePlayer(a, input, dt, ctx) {
  if (!a.alive) return;
  // Look.
  a.yaw -= input.mdx * 0.0022; a.pitch = clamp(a.pitch - input.mdy * 0.0022, -1.45, 1.45);
  input.mdx = 0; input.mdy = 0;
  // Recoil recovery.
  a.recoilPitch = Math.max(0, a.recoilPitch - dt * 0.09);
  a.recoil = Math.max(0, a.recoil - dt * 0.25);
  a.crouch = !!input.keys['ControlLeft'] || !!input.keys['KeyC'];
  a.aiming = !!input.mouseR && a.loadout.id !== 'flare';
  const speed = a.crouch ? 2.6 : a.aiming ? 3.4 : 5.4;
  let ix = 0, iz = 0;
  const k = input.keys;
  const fwd = (k['KeyW'] ? 1 : 0) - (k['KeyS'] ? 1 : 0);
  const str = (k['KeyD'] ? 1 : 0) - (k['KeyA'] ? 1 : 0);
  if (fwd || str) {
    const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
    ix = -sy * fwd + cy * str; iz = -cy * fwd - sy * str;
    const l = Math.hypot(ix, iz) || 1; ix /= l; iz /= l;
  }
  if (k['Space'] && a.onGround) { a.vy = 7.2; a.onGround = false; }
  moveAgent(a, ix, iz, dt, speed);
  updateReload(a, dt);
  if (input.mouseL) {
    const w = WEAPONS[a.loadout.id];
    if (w.auto) { if (canFire(a, ctx.time)) fireWeapon(a, ctx); }
    else if (input.mouseLPressed) { if (canFire(a, ctx.time)) fireWeapon(a, ctx); }
  }
  input.mouseLPressed = false;
  if (input.reloadPressed) { if (startReload(a)) ctx.audio.reload(); input.reloadPressed = false; }
  // Channel plant/defuse while E is held.
  updateChannel(a, input.keys['KeyE'], dt, ctx);
  if (a.flashT > 0) a.flashT -= dt;
}

function siteAt(x, z) {
  for (const [key, s] of Object.entries(SITES)) {
    if (Math.hypot(x - s.pos[0], z - s.pos[1]) <= s.radius) return key;
  }
  return null;
}
export function updateChannel(a, holdingE, dt, ctx) {
  const site = siteAt(a.x, a.z);
  const bomb = S.bomb;
  if (!holdingE || !site || S.phase !== 'live') { if (a.channel) { a.channel = null; } return; }
  if (a.team === 'HELIOS' && bomb.state === 'carried' && bomb.carrier === a) {
    if (!a.channel || a.channel.kind !== 'plant') a.channel = { kind: 'plant', t: 0, dur: ROUND.plantTime, site };
    a.channel.t += dt;
    bomb.progress = a.channel.t / a.channel.dur;
    if (a.channel.t >= a.channel.dur) {
      bomb.state = 'planted'; bomb.site = site; bomb.timer = ROUND.fuseTime; bomb.planter = a; bomb.progress = 0;
      a.channel = null; a.cash += ECON.plant;
      pushRadio(a.name, a.team === 'HELIOS' ? 'Attack' : 'Defend', `Charge armed at ${SITES[site].name}. 40 seconds.`);
      ctx.audio.plant(); logEvent(`plant ${a.name} site ${site}`);
    }
  } else if (a.team === 'UMBRA' && bomb.state === 'planted' && bomb.site === site) {
    if (!a.channel || a.channel.kind !== 'defuse') a.channel = { kind: 'defuse', t: 0, dur: a.kit ? 2.5 : ROUND.defuseTime, site };
    a.channel.t += dt;
    bomb.progress = a.channel.t / a.channel.dur;
    if (a.channel.t >= a.channel.dur) {
      bomb.state = 'defused'; bomb.progress = 0; a.channel = null; a.cash += ECON.defuse;
      pushRadio(a.name, 'Defend', 'Charge defused. Site clear.');
      ctx.audio.defuse(); logEvent(`defuse ${a.name}`);
      ctx.onRoundEnd('UMBRA', 'defuse');
    }
  } else if (a.channel) a.channel = null;
}

// ---- bots ----------------------------------------------------------------
function botThink(a, dt, ctx) {
  const ai = a.ai;
  ai.thinkT -= dt;
  if (ai.thinkT > 0) return;
  ai.thinkT = 0.15 + ctx.rng() * 0.1;
  const bomb = S.bomb;
  // Acquire a target.
  const { enemy, dist } = nearestEnemy(a, ctx);
  if (enemy && canSee(a, enemy, ctx, 0.05) && a.flashT <= 0) {
    if (!ai.target) { ai.reactT = 0.35 + ctx.rng() * 0.45; ai.burst = 0; }
    ai.target = enemy; ai.lastSeen = { x: enemy.x, z: enemy.z, t: ctx.time };
  } else if (ai.target && (!ai.target.alive || ctx.time - (ai.lastSeen?.t || 0) > 2.5)) {
    ai.target = null;
  }
  // Role behaviour.
  if (bomb.state === 'planted') {
    if (a.team === 'UMBRA') { ai.state = 'route'; setDest(a, siteNode(bomb.site)); }
    else { ai.state = 'hold'; }
  } else if (a.team === 'UMBRA') {
    if (ai.noise && ctx.time - ai.noise.t < 6 && !ai.target) {
      ai.state = 'route'; setDest(a, nearestWaypoint(ai.noise.x, ai.noise.z));
      if (Math.hypot(a.x - ai.noise.x, a.z - ai.noise.z) < 4) ai.noise = null;
    } else if (ai.state === 'route' && ai.pathIdx >= ai.path.length) ai.state = 'hold';
  } else {
    // HELIOS: push the assigned site; carrier plants when there.
    const site = ai.site;
    if (bomb.state === 'dropped' && !a.hasCharge) {
      const d = S.bomb.dropPos ? Math.hypot(a.x - S.bomb.dropPos[0], a.z - S.bomb.dropPos[1]) : 1e9;
      if (d < 1.6) { a.hasCharge = true; bomb.state = 'carried'; bomb.carrier = a; pushRadio(a.name, 'Attack', 'I have the charge.'); }
      else if (ai.state !== 'route') { ai.state = 'route'; setDest(a, nearestWaypoint(S.bomb.dropPos[0], S.bomb.dropPos[1])); }
    } else if (siteAt(a.x, a.z) === site && a.hasCharge && !ai.target) {
      ai.state = 'plant';
    } else if (ai.state !== 'route' && ai.state !== 'plant') {
      ai.state = 'route'; setDest(a, siteNode(site));
    }
    if (ai.state === 'route' && ai.pathIdx >= ai.path.length) ai.state = 'hold';
  }
  // Hold: pick a nearby look direction; occasionally reposition.
  if (ai.state === 'hold' && ctx.rng() < 0.06) {
    const n = waypoints[Math.floor(ctx.rng() * waypoints.length)];
    if (Math.hypot(n.x - a.x, n.z - a.z) < 14) { ai.state = 'route'; setDest(a, nearestWaypoint(n.x, n.z)); }
  }
}
function siteNode(site) { const s = SITES[site]; return nearestWaypoint(s.pos[0], s.pos[1]); }
function setDest(a, node) {
  const from = nearestWaypoint(a.x, a.z);
  a.ai.path = findPath(from, node); a.ai.pathIdx = 0; a.ai.destNode = node;
}

export function updateBot(a, dt, ctx) {
  if (!a.alive) return;
  const ai = a.ai;
  botThink(a, dt, ctx);
  if (a.flashT > 0) { a.flashT -= dt; return; } // blinded: frozen
  // Combat: face target, strafe, fire bursts.
  if (ai.target && ai.target.alive) {
    const t = ai.target;
    const dx = t.x - a.x, dz = t.z - a.z;
    const wantYaw = Math.atan2(-dx, -dz);
    let dy = wantYaw - a.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    a.yaw += clamp(dy, -3.2 * dt, 3.2 * dt);
    const dist = Math.hypot(dx, dz);
    a.pitch = clamp(Math.atan2(1.2 - 1.56, dist) + (Math.random() - 0.5) * 0.02, -0.4, 0.4);
    // Strafe.
    ai.strafeT -= dt;
    if (ai.strafeT <= 0) { ai.strafe = Math.random() < 0.5 ? -1 : 1; ai.strafeT = 0.5 + Math.random() * 0.9; }
    const strafeX = Math.cos(a.yaw) * ai.strafe, strafeZ = -Math.sin(a.yaw) * ai.strafe;
    const approach = dist > 16 ? 0.7 : dist < 7 ? -0.5 : 0;
    const fwdX = -Math.sin(a.yaw) * approach, fwdZ = -Math.cos(a.yaw) * approach;
    moveAgent(a, strafeX * 0.7 + fwdX, strafeZ * 0.7 + fwdZ, dt, 3.6);
    // Fire bursts after reaction time.
    ai.reactT -= dt;
    if (ai.reactT <= 0) {
      if (ai.burst > 0) {
        // Aim with error: nerfed so the player can win duels.
        const w = WEAPONS[a.loadout.id];
        const err = 0.022 + dist * 0.0009 + Math.hypot(t.vel.x, t.vel.z) * 0.006;
        const aimYaw = a.yaw + (ctx.rng() + ctx.rng() - 1) * err * 1.6;
        const aimPitch = a.pitch + (ctx.rng() + ctx.rng() - 1) * err * 1.2;
        const saveYaw = a.yaw, savePitch = a.pitch;
        a.yaw = aimYaw; a.pitch = aimPitch;
        if (canFire(a, ctx.time)) { fireWeapon(a, ctx); ai.burst -= 1; }
        a.yaw = saveYaw; a.pitch = savePitch;
      } else {
        ai.burstPause -= dt;
        if (ai.burstPause <= 0) { ai.burst = 3 + Math.floor(ctx.rng() * 4); ai.burstPause = 0.5 + ctx.rng() * 0.7; }
      }
    }
    updateReload(a, dt);
    if (a.loadout.mag === 0) startReload(a);
    return;
  }
  // Plant channel.
  if (ai.state === 'plant' && a.hasCharge) {
    updateChannel(a, true, dt, ctx);
    if (S.bomb.state === 'planted') { a.hasCharge = false; ai.state = 'hold'; }
    return;
  }
  // Defuse channel when the bomb is planted and the bot is on site.
  if (S.bomb.state === 'planted' && a.team === 'UMBRA' && siteAt(a.x, a.z) === S.bomb.site) {
    const { enemy } = nearestEnemy(a, ctx);
    if (!enemy || !canSee(a, enemy, ctx, 0.2)) { updateChannel(a, true, dt, ctx); return; }
  }
  // Movement along path.
  if (ai.state === 'route' && ai.path.length) {
    const node = waypoints[ai.path[Math.min(ai.pathIdx, ai.path.length - 1)]];
    const dx = node.x - a.x, dz = node.z - a.z, d = Math.hypot(dx, dz);
    if (d < 1.2) { ai.pathIdx += 1; if (ai.pathIdx >= ai.path.length) ai.state = 'hold'; }
    else {
      const wantYaw = Math.atan2(-dx, -dz);
      let dy = wantYaw - a.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      a.yaw += clamp(dy, -3.5 * dt, 3.5 * dt);
      moveAgent(a, -Math.sin(a.yaw), -Math.cos(a.yaw), dt, 4.2);
    }
  } else {
    // Hold: slow scan.
    a.yaw += Math.sin(ctx.time * 0.4 + a.id) * 0.25 * dt;
    moveAgent(a, 0, 0, dt, 4.2);
  }
  updateReload(a, dt);
  if (a.loadout.mag === 0) startReload(a);
  if (a.channel) a.channel = null;
}

// ---- grenade effects on agents -------------------------------------------
export function explodeFrag(g, ctx) {
  ctx.fx.blast(g);
  ctx.audio.explosion();
  for (const a of ctx.agents) {
    if (!a.alive) continue;
    const d = Math.hypot(a.x - g.x, a.z - g.z);
    if (d > 6.5) continue;
    if (!losClear(g.x, g.y, g.z, a.x, a.y + 1, a.z)) continue;
    applyDamage(a, Math.round(120 - d * 16), 'body', g.owner, ctx);
  }
  logEvent(`frag at ${g.x.toFixed(0)},${g.z.toFixed(0)}`);
}
export function deploySmoke(g, ctx) {
  ctx.fx.smoke({ x: g.x, y: 0.4, z: g.z });
  ctx.smokeClouds.push({ x: g.x, z: g.z, r: 4.5, t: 0 });
}
export function deployFlash(g, ctx) {
  ctx.fx.blast(g);
  ctx.audio.beep(true);
  for (const a of ctx.agents) {
    if (!a.alive) continue;
    const dx = g.x - a.x, dz = g.z - a.z, d = Math.hypot(dx, dz);
    if (d > 26) continue;
    if (!losClear(g.x, g.y, g.z, a.x, a.y + 1.5, a.z)) continue;
    const facing = (-Math.sin(a.yaw) * dx + -Math.cos(a.yaw) * dz) / (d || 1);
    if (facing < -0.2) continue; // looking away
    a.flashT = Math.max(a.flashT, clamp(3.2 - d * 0.09, 0.6, 3.2) * (a.isPlayer ? 1 : 0.8));
    if (a.isPlayer) ctx.hudFlash(a.flashT);
  }
}

// ---- round setup -----------------------------------------------------------
export function resetRound(agents, rng, roundNum) {
  const spawnsH = [[-6, 27], [0, 29], [6, 27], [-2, 25]];
  const spawnsU = [[-6, -27], [0, -29], [6, -27], [2, -25]];
  const sitePick = rng() < 0.6 ? 'A' : 'B';
  agents.forEach((a, i) => {
    const sp = a.team === 'HELIOS' ? spawnsH[i % 4] : spawnsU[i % 4];
    a.x = sp[0]; a.z = sp[1]; a.y = 0; a.vy = 0; a.vel.x = 0; a.vel.z = 0;
    a.yaw = a.team === 'HELIOS' ? Math.PI : 0; a.pitch = 0;
    a.hp = 100; a.alive = true; a.channel = null; a.flashT = 0; a.damagers = {};
    a.mesh.visible = !a.isPlayer; a.mesh.rotation.x = 0; a.mesh.position.y = 0;
    if (a.bot) {
      a.ai.state = 'route'; a.ai.target = null; a.ai.path = []; a.ai.pathIdx = 0;
      a.ai.noise = null; a.ai.burst = 0; a.hasCharge = false;
      a.ai.site = a.team === 'HELIOS' ? sitePick : (i % 2 === 0 ? 'A' : 'B');
      if (a.team === 'UMBRA') { a.ai.holdSite = a.ai.site; setDest(a, siteNode(a.ai.site)); }
      else setDest(a, siteNode(sitePick));
    }
  });
  // Carrier: first HELIOS bot (or the player in round 1).
  const carrier = roundNum === 1 ? agents[0] : agents.find(a => a.team === 'HELIOS' && a.bot);
  carrier.hasCharge = true;
  S.bomb = { state: 'carried', site: null, timer: 0, carrier, planter: null, defuser: null, progress: 0, dropPos: null };
  // Bots buy: simple loadout by cash.
  for (const a of agents) {
    if (!a.bot) continue;
    const picks = [['sunlance', 2700], ['dune', 1500], ['mirage', 3500], ['flare', 1800]];
    const [w, price] = picks[Math.floor(rng() * picks.length)];
    if (a.cash >= price) { a.cash -= price; a.loadout = makeLoadout(w); }
    else a.loadout = makeLoadout('sidewinder');
    if (a.cash >= 1000) { a.cash -= 1000; a.armour = 100; a.helmet = true; }
    else if (a.cash >= 650) { a.cash -= 650; a.armour = 100; }
    a.grenades = { frag: rng() < 0.5 ? 1 : 0, smoke: rng() < 0.5 ? 1 : 0, flash: rng() < 0.4 ? 1 : 0 };
  }
  return carrier;
}

// Sync meshes with agent state (called every frame from main).
export function syncMeshes(agents, time) {
  for (const a of agents) {
    if (a.isPlayer) continue;
    a.mesh.position.set(a.x, a.y, a.z);
    a.mesh.rotation.y = a.yaw;
    if (a.alive) {
      // Walk swing on the legs.
      const moving = Math.hypot(a.vel.x, a.vel.z);
      a.walkPhase += moving * 0.02;
      const swing = Math.sin(a.walkPhase * 6) * clamp(moving / 4, 0, 1) * 0.5;
      a.mesh.children[4].rotation.x = swing; a.mesh.children[5].rotation.x = -swing;
      a.mesh.position.y = a.y + Math.abs(Math.sin(a.walkPhase * 6)) * 0.03 * clamp(moving / 4, 0, 1);
    }
  }
}
export { viewmodelGun };
