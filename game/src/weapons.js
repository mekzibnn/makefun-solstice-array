// SOLSTICE ARRAY — weapons.js. One job: weapon behaviour.
// Fire / reload / spread / recoil math and grenade flight. Hit resolution
// lives in agents.js (rayVsAgents + applyDamage); this module calls it
// through the ctx it is given, so there are no import cycles.

import { WEAPONS, GRENADES, clamp } from './state.js';

export function makeLoadout(weaponId) {
  const w = WEAPONS[weaponId];
  return { id: weaponId, mag: w.mag, reserve: w.reserve, cooldown: 0, reloading: 0, bloom: 0, lastShot: -9 };
}
// Current spread for an agent: base + bloom + movement, reduced while aimed.
export function currentSpread(agent) {
  const w = WEAPONS[agent.loadout.id];
  const moving = Math.hypot(agent.vel.x, agent.vel.z);
  const moveF = clamp(moving / 5, 0, 1);
  let s = w.spread + agent.loadout.bloom + w.moveSpread * moveF * (agent.crouch ? 0.5 : 1);
  if (agent.aiming) s *= 0.45;
  return s;
}
export function canFire(agent, now) {
  const l = agent.loadout;
  if (l.reloading > 0 || l.cooldown > 0 || l.mag <= 0) return false;
  return true;
}
export function startReload(agent) {
  const l = agent.loadout, w = WEAPONS[l.id];
  if (l.reloading > 0 || l.mag >= w.mag || l.reserve <= 0) return false;
  l.reloading = w.id === 'flare' ? 2.6 : w.id === 'longshot' ? 3.2 : w.id === 'mirage' ? 2.4 : 1.9;
  return true;
}
export function updateReload(agent, dt) {
  const l = agent.loadout;
  if (l.reloading > 0) {
    l.reloading -= dt;
    if (l.reloading <= 0) {
      const w = WEAPONS[l.id], need = w.mag - l.mag, take = Math.min(need, l.reserve);
      l.mag += take; l.reserve -= take; l.reloading = 0;
    }
  }
  if (l.cooldown > 0) l.cooldown -= dt;
  l.bloom = Math.max(0, l.bloom - dt * 0.05);
}
// Fire one shot (or one pellet burst). ctx: {time, rng, traceRay, rayVsAgents,
// fx, audio, onShotFired}. Returns true if a shot left the barrel.
export function fireWeapon(agent, ctx) {
  const l = agent.loadout, w = WEAPONS[l.id];
  if (!canFire(agent, ctx.time)) return false;
  l.mag -= 1;
  l.cooldown = 60 / w.rpm;
  l.lastShot = ctx.time;
  l.bloom = Math.min(0.06, l.bloom + w.recoil * 0.35);
  agent.recoil += w.recoil;
  const spread = currentSpread(agent);
  const pellets = w.pellets || 1;
  const origin = ctx.muzzle(agent); // {x,y,z} world muzzle position
  let anyHit = false;
  for (let p = 0; p < pellets; p++) {
    // Direction from yaw/pitch plus gaussian-ish spread (two uniform draws).
    const sy = (ctx.rng() + ctx.rng() - 1) * spread;
    const sp = (ctx.rng() + ctx.rng() - 1) * spread;
    const yaw = agent.yaw + sy, pitch = agent.pitch + sp;
    const dx = -Math.sin(yaw) * Math.cos(pitch), dy = Math.sin(pitch), dz = -Math.cos(yaw) * Math.cos(pitch);
    const hit = ctx.rayVsAgents(origin.x, origin.y, origin.z, dx, dy, dz, w.range, agent);
    const wallD = ctx.traceRay(origin.x, origin.y, origin.z, dx, dy, dz, w.range);
    if (hit && hit.dist < wallD) {
      ctx.applyDamage(hit.agent, w.dmg * (hit.part === 'head' ? (hit.agent.helmet ? 2 : w.hs) : hit.part === 'leg' ? 0.75 : 1), hit.part, agent);
      ctx.fx.tracer(origin, hit.point, w.tracer);
      ctx.fx.impact(hit.point, hit.part === 'head');
      anyHit = true;
    } else {
      const d = Math.min(wallD, w.range);
      const end = { x: origin.x + dx * d, y: origin.y + dy * d, z: origin.z + dz * d };
      ctx.fx.tracer(origin, end, w.tracer);
      if (wallD < w.range) ctx.fx.impact(end, false);
    }
  }
  ctx.fx.muzzle(origin, agent.yaw, agent.pitch);
  ctx.audio.shot(w.id);
  ctx.onShotFired(agent);
  return anyHit;
}

// ---- grenades ------------------------------------------------------------
export class GrenadeSim {
  constructor() { this.list = []; }
  throw(agent, kind, ctx) {
    if ((agent.grenades[kind] || 0) <= 0) return false;
    agent.grenades[kind] -= 1;
    const yaw = agent.yaw, pitch = agent.pitch + 0.35;
    const dx = -Math.sin(yaw) * Math.cos(pitch), dy = Math.sin(pitch), dz = -Math.cos(yaw) * Math.cos(pitch);
    const p = ctx.eye(agent);
    this.list.push({ kind, x: p.x + dx, y: p.y - 0.1, z: p.z + dz, vx: dx * 13, vy: dy * 13 + 2.5, vz: dz * 13, t: 0, owner: agent });
    ctx.audio.throwPin();
    return true;
  }
  update(dt, ctx) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const g = this.list[i];
      g.t += dt; g.vy -= 9.8 * dt;
      g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
      if (g.y < 0.15) { g.y = 0.15; g.vy *= -0.35; g.vx *= 0.6; g.vz *= 0.6; }
      const fuse = g.kind === 'frag' ? 1.6 : g.kind === 'flash' ? 1.4 : 1.2;
      if (g.t >= fuse) {
        this.list.splice(i, 1);
        if (g.kind === 'frag') ctx.explodeFrag(g, ctx);
        else if (g.kind === 'smoke') ctx.deploySmoke(g, ctx);
        else ctx.deployFlash(g, ctx);
      }
    }
  }
}
export { GRENADES };
