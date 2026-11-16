// SOLSTICE ARRAY — main.js. One job: wire the game together.
// Boot, fixed-step loop, phase machine (menu/buy/live/roundend/matchend),
// round economy, buy rules, pointer lock, spectating, and the ?shot=
// staging hooks the screenshots use (real renders of this same code).

import * as THREE from 'three';
import { S, TEAMS, SITES, WEAPONS, GRENADES, GEAR, ECON, ROUND, clamp, logEvent, pushKillfeed, pushRadio, mulberry32, freshMatch } from './state.js';
import { buildWorld, traceRay } from './world.js';
import { createAgents, resetRound, updatePlayer, updateBot, rayVsAgents, applyDamage, agentEye, agentMuzzle, aliveCount, syncMeshes, explodeFrag, deploySmoke, deployFlash, viewmodelGun } from './agents.js';
import { FX } from './fx.js';
import { AudioSys } from './audio.js';
import { HUD } from './hud.js';
import { GrenadeSim, makeLoadout, startReload, fireWeapon, updateReload } from './weapons.js';

const params = new URLSearchParams(location.search);
const SEED = parseInt(params.get('seed') || '1', 10);
const SHOT = params.get('shot') || '';
const DEMO = params.get('demo') === '1';
const rng = mulberry32(SEED);
S.seed = SEED;

// ---- renderer / scene ----------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.1, 400);
const world = buildWorld(scene, SEED);
const fx = new FX(scene);
const audio = new AudioSys();
const hud = new HUD(document);
const grenades = new GrenadeSim();
const agents = createAgents(scene);
S.agents = agents;
const player = agents[0];
player._stepSound = () => audio.step();
const viewmodel = viewmodelGun();
camera.add(viewmodel);
scene.add(camera);

// ---- shared ctx ----------------------------------------------------------
const smokeClouds = [];
S.smokeClouds = smokeClouds;
const seen = new Map(); // enemy id -> last time the player saw them
const ctx = {
  time: 0, rng, agents, traceRay, fx, audio, smokeClouds,
  rayVsAgents: (ox, oy, oz, dx, dy, dz, max, shooter) => rayVsAgents(ox, oy, oz, dx, dy, dz, max, shooter, agents),
  muzzle: (a) => agentMuzzle(a),
  eye: (a) => agentEye(a),
  applyDamage: (v, d, part, at) => applyDamage(v, d, part, at, ctx),
  explodeFrag: (g, c) => explodeFrag(g, c),
  deploySmoke: (g, c) => deploySmoke(g, c),
  deployFlash: (g, c) => deployFlash(g, c),
  hudHitmark: (head) => hud.hitmark(head),
  hudDamage: () => hud.damageFlash(),
  hudFlash: (t) => hud.blind(t),
  onKill: (victim, attacker) => {
    if (victim.isPlayer) startSpectate();
    checkElimination();
  },
  onRoundEnd: (team, reason) => endRound(team, reason),
  onShotFired: (shooter) => {
    // Gunfire noise: bots within 26 m investigate.
    for (const a of agents) {
      if (!a.bot || !a.alive || a === shooter) continue;
      const d = Math.hypot(a.x - shooter.x, a.z - shooter.z);
      if (d < 26) a.ai.noise = { x: shooter.x, z: shooter.z, t: ctx.time };
    }
  },
};

// ---- input ---------------------------------------------------------------
const input = { keys: {}, mdx: 0, mdy: 0, mouseL: false, mouseR: false, mouseLPressed: false, reloadPressed: false };
let locked = false;
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  input.keys[e.code] = true;
  if (e.code === 'KeyR') input.reloadPressed = true;
  if (e.code === 'KeyB' && S.phase === 'buy') hud.showBuy(hud.el.buy.hidden, player);
  if (e.code === 'Digit1') switchWeapon('primary');
  if (e.code === 'Digit2') switchWeapon('sidearm');
  if (e.code === 'KeyG') throwGrenade('frag');
  if (e.code === 'KeyQ') cycleGrenade();
  if (e.code === 'Tab') { e.preventDefault(); if (S.phase === 'live' || S.phase === 'buy') hud.showScoreboard(true); }
});
addEventListener('keyup', (e) => {
  input.keys[e.code] = false;
  if (e.code === 'Tab') hud.showScoreboard(false);
});
addEventListener('mousedown', (e) => {
  if (!locked || S.phase !== 'live') return;
  if (e.button === 0) { input.mouseL = true; input.mouseLPressed = true; }
  if (e.button === 2) input.mouseR = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) input.mouseL = false;
  if (e.button === 2) input.mouseR = false;
});
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousemove', (e) => {
  if (!locked) return;
  input.mdx += e.movementX; input.mdy += e.movementY;
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (!locked && S.phase === 'live' && !SHOT && !DEMO && player.alive) {
    S.paused = true;
    hud.showOverlay('paused', 'Paused', 'Pointer lock lost — the match is frozen. Click to resume.', 'Resume');
  } else if (locked && S.paused) {
    S.paused = false; hud.showOverlay(null);
  }
});
renderer.domElement.addEventListener('click', () => {
  if (S.phase === 'menu') return; // the Play button handles it
  if (!locked) renderer.domElement.requestPointerLock();
});
hud.onPlayClick = () => {
  audio.ensure();
  if (S.phase === 'menu' || S.phase === 'matchend') startMatch();
  else if (S.paused) { renderer.domElement.requestPointerLock(); }
  else renderer.domElement.requestPointerLock();
};
hud.onBuy = (id) => buyItem(id);

function switchWeapon(slot) {
  if (S.phase !== 'live' && S.phase !== 'buy') return;
  const cur = player.loadout;
  if (slot === 'sidearm' && player.sidearm.id !== cur.id) {
    player.loadout = player.sidearm; player.sidearm = cur;
  } else if (slot === 'primary' && player.sidearm.id === cur.id) {
    // primary is in the sidearm slot after a swap; swap back
    player.loadout = player.sidearm; player.sidearm = cur;
  }
  audio.reload();
}
let grenadeSel = 'frag';
function cycleGrenade() { grenadeSel = grenadeSel === 'frag' ? 'smoke' : grenadeSel === 'smoke' ? 'flash' : 'frag'; }
function throwGrenade(kind) {
  if (S.phase !== 'live' || !player.alive) return;
  const k = kind === 'frag' ? grenadeSel : kind;
  if (grenades.throw(player, k, ctx)) logEvent(`player threw ${k}`);
}

// ---- match / rounds ------------------------------------------------------
function startMatch() {
  const keep = freshMatch();
  Object.assign(S, keep, { seed: SEED });
  S.agents = agents; S.smokeClouds = smokeClouds;
  for (const a of agents) {
    a.cash = ECON.startCash; a.kills = 0; a.assists = 0; a.deaths = 0; a.headshots = 0; a.damage = 0;
    a.loadout = makeLoadout('sidewinder'); a.sidearm = makeLoadout('sidewinder');
    a.armour = 0; a.helmet = false; a.kit = false; a.grenades = { frag: 0, smoke: 0, flash: 0 };
  }
  smokeClouds.length = 0; seen.clear();
  window.__gameLog = S.log;
  hud.showOverlay(null); hud.showScoreboard(false);
  startRound();
  logEvent('match start');
}
function startRound() {
  resetRound(agents, rng, S.round);
  S.phase = 'buy'; S.phaseT = 0; S.buyTime = ROUND.buyTime; S.roundTime = ROUND.roundTime;
  hud.showBuy(true, player);
  hud.announce(`ROUND ${S.round}`, S.round === 1 ? 'HELIOS attack — plant the charge at A or B' : 'Buy phase — spend your cash');
  pushRadio('Command', 'HQ', S.round === 1 ? 'Take Mirror Field or the Spire. Plant the charge.' : 'Buy up. Same plan.');
  audio.roundStart();
  logEvent(`round ${S.round} buy`);
}
function endRound(team, reason) {
  if (S.phase !== 'live') return;
  S.phase = 'roundend'; S.phaseT = 0;
  S.score[team] += 1; S.roundWins.push(team === 'HELIOS' ? 'H' : 'U');
  for (const a of agents) {
    if (!a.alive) continue;
    a.cash += a.team === team ? ECON.win : ECON.loss;
    a.channel = null;
  }
  const names = { elim: 'team eliminated', plant: 'charge detonated', defuse: 'charge defused', time: 'time expired' };
  hud.announce(`${TEAMS[team].name} WIN THE ROUND`, names[reason] || reason);
  hud.showBuy(false); hud.showScoreboard(false);
  pushRadio('Command', 'HQ', `${TEAMS[team].name} take round ${S.round} — ${names[reason] || reason}.`);
  audio.horn(team === player.team);
  logEvent(`round ${S.round} end: ${team} (${reason}) score ${S.score.HELIOS}-${S.score.UMBRA}`);
  if (S.score[team] >= ROUND.winsTo || S.round >= ROUND.maxRounds) {
    setTimeout(() => endMatch(team), 2600);
  } else {
    setTimeout(() => { S.round += 1; startRound(); }, 4200);
  }
}
function endMatch(team) {
  S.phase = 'matchend'; S.phaseT = 0; S.winner = team; S.winReason = 'match';
  hud.showBuy(false);
  hud.renderScoreboard();
  hud.showScoreboard(true);
  hud.announce(`${TEAMS[team].name} WIN THE MATCH`, `${S.score.HELIOS} – ${S.score.UMBRA}`);
  logEvent(`match end: ${team} ${S.score.HELIOS}-${S.score.UMBRA}`);
}
function checkElimination() {
  if (S.phase !== 'live') return;
  const h = aliveCount(agents, 'HELIOS'), u = aliveCount(agents, 'UMBRA');
  if (h === 0) endRound('UMBRA', 'elim');
  else if (u === 0) {
    if (S.bomb.state === 'planted') return; // fuse still decides it
    endRound('HELIOS', 'elim');
  }
}
let spectateTarget = null;
function startSpectate() {
  spectateTarget = agents.find(a => a.alive && a.team === player.team && !a.isPlayer) || null;
  hud._specName = spectateTarget ? spectateTarget.name : '';
}

// ---- buy -----------------------------------------------------------------
function buyItem(id) {
  if (S.phase !== 'buy') return;
  const w = WEAPONS[id], g = GRENADES[id], k = GEAR[id];
  if (w) {
    if (player.loadout.id === id || player.sidearm.id === id) return;
    if (player.cash < w.price) return;
    player.cash -= w.price;
    const old = player.loadout;
    player.loadout = makeLoadout(id);
    if (old.id !== 'sidewinder') player.sidearm = old;
    else player.sidearm = makeLoadout('sidewinder');
    if (w.cat === 'sidearms') { const tmp = player.loadout; player.loadout = player.sidearm; player.sidearm = tmp; }
    audio.buy();
  } else if (g) {
    if (player.grenades[id] >= 2 || player.cash < g.price) return;
    player.cash -= g.price; player.grenades[id] += 1; audio.buy();
  } else if (k) {
    if (id === 'armour') { if (player.armour >= 100 || player.cash < k.price) return; player.cash -= k.price; player.armour = 100; }
    if (id === 'helmet') { if (player.helmet || player.cash < k.price) return; player.cash -= k.price; player.helmet = true; }
    if (id === 'kit') { if (player.kit || player.team !== 'UMBRA' || player.cash < k.price) return; player.cash -= k.price; player.kit = true; }
    audio.buy();
  }
  hud.renderBuy(player);
}

// ---- fixed-step loop -----------------------------------------------------
let last = performance.now(), acc = 0;
const STEP = 1 / 60;
let frames = 0;
function tick(now) {
  requestAnimationFrame(tick);
  let dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (document.hidden) return;
  if (!S.frozen && !S.paused) {
    acc += dt;
    let n = 0;
    const cap = DEMO ? 30 : 5;
    while (acc >= STEP && n < cap) { step(STEP); acc -= STEP; n += 1; }
  }
  render();
}
function step(dt) {
  S.time += dt; ctx.time = S.time; S.tick += 1;
  if (S.phase === 'buy') {
    S.buyTime -= dt;
    if (S.buyTime <= 0) {
      S.phase = 'live'; S.phaseT = 0;
      hud.showBuy(false);
      hud.announce('GO', 'Plant the charge — A Mirror Field, B Control Spire');
      logEvent(`round ${S.round} live`);
    }
  } else if (S.phase === 'live') {
    S.roundTime -= dt;
    // Bomb fuse.
    if (S.bomb.state === 'planted') {
      S.bomb.timer -= dt;
      if (Math.ceil(S.bomb.timer) !== Math.ceil(S.bomb.timer + dt)) audio.beep(S.bomb.timer < 10);
      if (S.bomb.timer <= 0) { S.bomb.state = 'detonated'; fx.blast({ x: SITES[S.bomb.site].pos[0], y: 1, z: SITES[S.bomb.site].pos[1] }); audio.explosion(); endRound('HELIOS', 'plant'); return; }
    } else if (S.roundTime <= 0) { endRound('UMBRA', 'time'); return; }
    // Dropped charge pickup by the player.
    if (S.bomb.state === 'dropped' && player.alive && S.bomb.dropPos &&
        Math.hypot(player.x - S.bomb.dropPos[0], player.z - S.bomb.dropPos[1]) < 1.6) {
      S.bomb.state = 'carried'; S.bomb.carrier = player; player.hasCharge = true;
      pushRadio('You', 'Attack', 'Charge recovered.');
    }
  } else if (S.phase === 'roundend' || S.phase === 'matchend') {
    S.phaseT += dt;
  }
  // Agents.
  const live = S.phase === 'live';
  for (const a of agents) {
    if (!a.alive) continue;
    if (a.isPlayer) {
      if (live) updatePlayer(a, input, dt, ctx);
      else { updateReload(a, dt); if (a.channel) a.channel = null; }
    } else if (live) updateBot(a, dt, ctx);
    else updateReload(a, dt);
  }
  // Demo mode: drive the player with bot AI.
  if (DEMO && player.alive && live) {
    if (!player.ai) player.ai = { state: 'route', path: [], pathIdx: 0, holdT: 0, target: null, lastSeen: null, reactT: 0, burst: 0, burstPause: 0, strafe: 1, strafeT: 0, role: 'push', site: rng() < 0.6 ? 'A' : 'B', thinkT: 0, hasCharge: player.hasCharge, noise: null, destNode: 0 };
    player.ai.hasCharge = player.hasCharge;
    updateBot(player, dt, ctx);
  }
  // Grenades + smoke lifetimes.
  grenades.update(dt, ctx);
  for (let i = smokeClouds.length - 1; i >= 0; i--) {
    smokeClouds[i].t += dt;
    if (smokeClouds[i].t > 14) smokeClouds.splice(i, 1);
  }
  fx.update(dt);
  // Player vision -> minimap "seen" markers.
  for (const a of agents) {
    if (!a.alive || a.team === player.team || a.isPlayer) continue;
    const dx = a.x - player.x, dz = a.z - player.z;
    if (Math.hypot(dx, dz) < 55) {
      const ae = agentEye(player), be = agentEye(a);
      if (traceRay(ae.x, ae.y, ae.z, (be.x - ae.x) / 55, (be.y - ae.y) / 55, (be.z - ae.z) / 55, 55) >= Math.hypot(be.x - ae.x, be.y - ae.y, be.z - ae.z) - 0.1) seen.set(a.id, S.time);
    }
  }
  for (const [id, t] of seen) if (S.time - t > 3) seen.delete(id);
  // Camera.
  updateCamera(dt);
  hud.update(dt, player, seen);
  // Beacon pulse.
  world.beaconGlow.material.opacity = 0.6 + Math.sin(S.time * 4) * 0.4;
}
function updateCamera(dt) {
  if (!player.alive && spectateTarget && spectateTarget.alive) {
    const t = spectateTarget;
    const bx = t.x + Math.sin(t.yaw) * 2.6, bz = t.z + Math.cos(t.yaw) * 2.6;
    camera.position.set(bx, t.y + 2.6, bz);
    camera.lookAt(t.x, t.y + 1.4, t.z);
    return;
  }
  const e = agentEye(player);
  camera.position.set(e.x, e.y, e.z);
  const recoil = player.recoilPitch;
  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch + recoil;
  camera.rotation.z = 0;
  // Viewmodel bob + recoil kick.
  viewmodel.position.y = -0.26 + Math.sin(player.walkPhase * 2) * 0.006 * Math.min(1, Math.hypot(player.vel.x, player.vel.z) / 4);
  viewmodel.position.z = -0.55 + player.recoil * 0.35;
  viewmodel.visible = player.alive;
  // Aim zoom.
  const targetFov = player.aiming ? 74 / (WEAPONS[player.loadout.id].zoom || 1) : 74;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
  camera.updateProjectionMatrix();
}
function render() {
  frames += 1;
  renderer.render(scene, camera);
  if (frames === 3) window.__ready = true;
}

// ---- menu ----------------------------------------------------------------
hud.showOverlay('menu', 'SOLSTICE ARRAY',
  'A tactical FPS at a desert solar farm, golden hour. HELIOS attack vs UMBRA defend — plant the charge at Mirror Field (A) or Control Spire (B). 12 rounds, first to 7. Click to play.',
  'Click to play');
hud.announce('SOLSTICE ARRAY', 'HELIOS vs UMBRA — Mirror Field · Control Spire');

// ---- ?shot= staging (screenshots: real renders of this same code) --------
function stageShot(name) {
  audio.enabled = false;
  startMatch();
  hud.showOverlay(null);
  hud.showBuy(false);
  if (name === 'buy') {
    S.round = 2; player.cash = 4650;
    player.loadout = makeLoadout('sunlance');
    hud.showBuy(true, player);
    hud.announce('ROUND 2', 'Buy phase — 5 categories');
    positionCameraForShot([0, 18], Math.PI);
  } else if (name === 'objective') {
    S.phase = 'live'; S.roundTime = 62;
    player.x = -11; player.z = -9; player.yaw = 1.14; player.pitch = -0.01;
    player.hasCharge = true; S.bomb.carrier = player;
    player.loadout = makeLoadout('sunlance');
    player.channel = { kind: 'plant', t: 1.86, dur: 3, site: 'A' };
    S.bomb.progress = 0.62;
    const foe = agents.find(a => a.team === 'UMBRA');
    foe.x = -26; foe.z = -12; foe.yaw = Math.PI * 0.9; foe.alive = true;
    const mate = agents.find(a => a.team === 'HELIOS' && a.bot);
    mate.x = -26; mate.z = -6; mate.yaw = -0.6;
    fx.smoke({ x: -26, y: 0.4, z: -16 });
    pushRadio('Sol', 'Attack', 'Cover me — arming at Mirror Field.');
    pushRadio('Kiran', 'Attack', 'Spire side clear, moving to you.');
    pushKillfeed('Ember  [Sunlance AR]  Vesper', false);
    updateCamera(0.016);
  } else if (name === 'end') {
    S.phase = 'matchend'; S.winner = 'HELIOS'; S.round = 12;
    S.score = { HELIOS: 7, UMBRA: 5 }; S.roundWins = ['H', 'U', 'H', 'H', 'U', 'H', 'U', 'H', 'U', 'H', 'U', 'H'];
    const stats = [[7, 2, 3, 4, 2140, 4650], [5, 3, 4, 2, 1480, 3100], [4, 1, 5, 1, 1230, 2800], [3, 4, 4, 1, 980, 2400],
      [5, 2, 6, 3, 1790, 1950], [4, 3, 5, 2, 1310, 2200], [3, 1, 6, 0, 870, 1750], [2, 2, 7, 1, 640, 1500]];
    agents.forEach((a, i) => {
      const [k, as, d, hs, dmg, cash] = stats[i];
      a.kills = k; a.assists = as; a.deaths = d; a.headshots = hs; a.damage = dmg; a.cash = cash; a.alive = i < 4;
    });
    hud.renderScoreboard(); hud.showScoreboard(true);
    positionCameraForShot([0, 18], Math.PI);
  } else { // combat (default, incl. ?shot=combat)
    S.phase = 'live'; S.roundTime = 78;
    player.x = 4; player.z = 16; player.yaw = 0.2; player.pitch = -0.01;
    player.loadout = makeLoadout('sunlance'); player.armour = 100; player.helmet = true;
    const foe = agents.find(a => a.name === 'Noct');
    foe.x = 2; foe.z = 6; foe.yaw = Math.PI; foe.alive = true;
    foe.loadout = makeLoadout('dune');
    const foe2 = agents.find(a => a.name === 'Mira');
    foe2.x = -8; foe2.z = 4; foe2.yaw = Math.PI * 0.8;
    const mate = agents.find(a => a.team === 'HELIOS' && a.bot);
    mate.x = -6; mate.z = 18; mate.yaw = -0.3;
    // A real exchange: the enemy fires at the player (real tracer + flash),
    // the player returns fire into the enemy's chest (body hit, he stays up),
    // and a smoke cloud hangs mid-field.
    const foeCtx = { ...ctx };
    foe.yaw = Math.atan2(-(player.x - foe.x), -(player.z - foe.z));
    foe.pitch = 0;
    fireWeapon(foe, foeCtx);
    player.yaw = Math.atan2(-(foe.x - player.x), -(foe.z - player.z));
    player.pitch = Math.atan2(1.0 - 1.62, Math.hypot(foe.x - player.x, foe.z - player.z));
    fireWeapon(player, foeCtx);
    fx.smoke({ x: 7, y: 0.4, z: 9 });
    pushKillfeed('Ember  [Sunlance AR]  Vesper', false);
    pushRadio('Sol', 'Attack', 'Contact mid — one down, pushing A.');
    pushRadio('Ember', 'Support', 'Smoke out. Keep the lane.');
    updateCamera(0.016);
  }
  syncMeshes(agents, 0);
  hud.update(0.016, player, seen);
  renderer.render(scene, camera);
  S.frozen = true; // hold the frame for the screenshot
  window.__staged = name;
}
function positionCameraForShot([x, z], yaw) {
  player.x = x; player.z = z; player.yaw = yaw; player.pitch = 0;
  updateCamera(0.016);
  syncMeshes(agents, 0);
  hud.update(0.016, player, seen);
  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Expose for the playtest / capture harness.
window.__game = { S, agents, player, ctx, hud, fireWeapon };
window.__gameLog = S.log;

// Boot.
if (SHOT) {
  // Let one frame settle, then stage.
  requestAnimationFrame(() => requestAnimationFrame(() => stageShot(SHOT)));
  requestAnimationFrame(tick);
} else if (DEMO) {
  hud.showOverlay(null);
  startMatch();
  requestAnimationFrame(tick);
} else {
  requestAnimationFrame(tick);
}
