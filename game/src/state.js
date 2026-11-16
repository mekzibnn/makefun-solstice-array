// SOLSTICE ARRAY — a three.js tactical FPS (make.fun threejs-fps-01).
// Desert solar farm at golden hour. HELIOS (attack) vs UMBRA (defend).
// Sites: A Mirror Field / B Control Spire. 12 rounds, first to 7.
// Plant/defuse objective, round economy, 6 weapons + 3 grenades, 4v4 bots.
// Central state + constants + small utilities. One job: hold the match state.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const TAU = Math.PI * 2;

// ---- teams ---------------------------------------------------------------
export const TEAMS = {
  HELIOS: { name: 'HELIOS', label: 'ATTACK', color: 0xffb03a, css: '#ffb03a', spawn: [0, 26] },
  UMBRA: { name: 'UMBRA', label: 'DEFEND', color: 0x4fc3ff, css: '#4fc3ff', spawn: [0, -26] },
};
export const SITES = {
  A: { name: 'Mirror Field', short: 'A', pos: [-22, -14], radius: 6.5 },
  B: { name: 'Control Spire', short: 'B', pos: [22, -14], radius: 6.5 },
};
export const MAP = { half: 34, wallH: 5 };

// ---- weapons -------------------------------------------------------------
// dmg = body damage per bullet (pellet for Flare). spread in radians (standing,
// aimed). recoil = camera kick per shot. All original names, no borrowed names.
export const WEAPONS = {
  sidewinder: { name: 'Sidewinder', cat: 'sidearms', price: 0, dmg: 34, hs: 4, rpm: 320, mag: 12, reserve: 36, auto: false, spread: 0.011, moveSpread: 0.030, recoil: 0.011, range: 60, tracer: 0xffd27a, zoom: 1.0, desc: 'Reliable sidearm. Free.' },
  dune: { name: 'Dune SMG', cat: 'close', price: 1500, dmg: 26, hs: 4, rpm: 750, mag: 30, reserve: 90, auto: true, spread: 0.016, moveSpread: 0.042, recoil: 0.008, range: 55, tracer: 0xffc46b, zoom: 1.0, desc: 'Fast close-range spray.' },
  sunlance: { name: 'Sunlance AR', cat: 'rifles', price: 2700, dmg: 33, hs: 4, rpm: 600, mag: 30, reserve: 90, auto: true, spread: 0.009, moveSpread: 0.030, recoil: 0.012, range: 90, tracer: 0xffe9a8, zoom: 1.15, desc: 'Balanced assault rifle.' },
  mirage: { name: 'Mirage DMR', cat: 'rifles', price: 3500, dmg: 68, hs: 4, rpm: 150, mag: 10, reserve: 30, auto: false, spread: 0.004, moveSpread: 0.022, recoil: 0.028, range: 120, tracer: 0xfff2c0, zoom: 1.6, desc: 'Precise marksman rifle.' },
  flare: { name: 'Flare Shotgun', cat: 'close', price: 1800, dmg: 12, hs: 3, rpm: 70, mag: 6, reserve: 24, auto: false, spread: 0.055, moveSpread: 0.070, recoil: 0.045, range: 26, pellets: 8, tracer: 0xff9a3d, zoom: 1.0, desc: 'Eight-pellet burst up close.' },
  longshot: { name: 'Longshot', cat: 'rifles', price: 4750, dmg: 110, hs: 4, rpm: 55, mag: 5, reserve: 15, auto: false, spread: 0.001, moveSpread: 0.014, recoil: 0.055, range: 140, tracer: 0xffffff, zoom: 2.2, desc: 'One shot, one silhouette.' },
};
export const GRENADES = {
  frag: { name: 'Frag Grenade', price: 300, desc: 'Explodes after 1.6 s. Radius 6 m.' },
  smoke: { name: 'Smoke Grenade', price: 300, desc: 'Thick golden smoke for 14 s.' },
  flash: { name: 'Flash Grenade', price: 200, desc: 'Blinds anyone facing it.' },
};
export const GEAR = {
  armour: { name: 'Kevlar Vest', price: 650, desc: 'Halves body damage.' },
  helmet: { name: 'Helmet', price: 350, desc: 'Headshots deal x2 instead of x4.' },
  kit: { name: 'Defuse Kit', price: 400, desc: 'Defuse in 2.5 s instead of 5 s. UMBRA only.' },
};
export const ECON = { kill: 300, win: 3250, loss: 1900, plant: 300, defuse: 300, startCash: 800 };
export const ROUND = { maxRounds: 12, winsTo: 7, buyTime: 20, roundTime: 100, plantTime: 3, defuseTime: 5, fuseTime: 40 };

// ---- match state ---------------------------------------------------------
export function freshMatch() {
  return {
    phase: 'menu', // menu | buy | live | roundend | matchend
    phaseT: 0, round: 1,
    score: { HELIOS: 0, UMBRA: 0 },
    roundWins: [], // 'H' | 'U' per round, for pips
    roundTime: ROUND.roundTime,
    buyTime: ROUND.buyTime,
    bomb: { state: 'carried', site: null, timer: 0, carrier: null, planter: null, defuser: null, progress: 0 },
    agents: [], // filled by agents.js
    killfeed: [], // {text, hs, t}
    radio: [], // {who, role, text, t}
    log: [], // internal event log for playtests: {t, msg}
    winner: null, winReason: '',
    time: 0, tick: 0,
    paused: false, frozen: false, // frozen = staged screenshot hold
    seed: 1,
  };
}
export const S = freshMatch();

export function logEvent(msg) {
  S.log.push({ t: +S.time.toFixed(2), msg });
  if (S.log.length > 400) S.log.shift();
}
export function pushKillfeed(text, hs) {
  S.killfeed.unshift({ text, hs: !!hs, t: S.time });
  if (S.killfeed.length > 5) S.killfeed.pop();
}
export function pushRadio(who, role, text) {
  S.radio.unshift({ who, role, text, t: S.time });
  if (S.radio.length > 3) S.radio.pop();
}
