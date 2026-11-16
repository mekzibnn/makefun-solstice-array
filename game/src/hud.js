// SOLSTICE ARRAY — hud.js. One job: every DOM surface of the game.
// Minimap, scores + round pips, timer, kill feed, radio log, health / armour /
// cash, weapon slots + grenades, ammo, plant bar, buy menu, scoreboard,
// overlays (menu / round end / match end / paused). No game logic here.

import { S, TEAMS, SITES, WEAPONS, GRENADES, GEAR, ROUND, ECON } from './state.js';

export class HUD {
  constructor(doc) {
    this.d = doc;
    this.el = {};
    for (const id of ['hud', 'crosshair', 'hitmarker', 'dmgflash', 'blind', 'announce', 'timer', 'roundlabel',
      'score-h', 'score-u', 'pips-h', 'pips-u', 'minimap', 'killfeed', 'radio', 'health', 'armour', 'cash',
      'ammo-mag', 'ammo-reserve', 'weapon-name', 'slots', 'grenades', 'plantbar', 'plantfill', 'plantlabel',
      'buy', 'buy-cash', 'buy-timer', 'buy-grid', 'board', 'board-body', 'board-title', 'overlay', 'overlay-title',
      'overlay-copy', 'overlay-btn', 'roundbanner', 'bombstate', 'spectate', 'fps']) this.el[id] = doc.getElementById(id);
    this.mapCtx = this.el.minimap.getContext('2d');
    this.mapT = 0; this.lastAmmo = ''; this.lastHp = '';
    this._buildBuy();
    this.el['overlay-btn'].addEventListener('click', () => this.onPlayClick && this.onPlayClick());
    this.el.buy.addEventListener('click', (e) => {
      const b = e.target.closest('[data-buy]');
      if (b) this.onBuy && this.onBuy(b.dataset.buy);
    });
  }
  _buildBuy() {
    const grid = this.el['buy-grid'];
    const cats = [
      ['sidearms', 'SIDEARMS', ['sidewinder']],
      ['close', 'CLOSE RANGE', ['dune', 'flare']],
      ['rifles', 'RIFLES', ['sunlance', 'mirage', 'longshot']],
      ['gear', 'GEAR', ['armour', 'helmet', 'kit']],
      ['grenades', 'GRENADES', ['frag', 'smoke', 'flash']],
    ];
    let html = '';
    for (const [cat, label, ids] of cats) {
      html += `<div class="buy-cat"><h3>${label}</h3>`;
      for (const id of ids) {
        const w = WEAPONS[id] || GRENADES[id] || GEAR[id];
        const stats = WEAPONS[id] ? `<div class="buy-stats"><span>DMG ${WEAPONS[id].dmg}</span><span>RPM ${WEAPONS[id].rpm}</span><span>MAG ${WEAPONS[id].mag}</span></div>` : '';
        html += `<button class="buy-item" data-buy="${id}">
          <span class="buy-name">${w.name}</span><span class="buy-desc">${w.desc}</span>${stats}
          <span class="buy-price">$${w.price}</span><span class="buy-owned" data-owned="${id}"></span>
        </button>`;
      }
      html += '</div>';
    }
    grid.innerHTML = html;
  }
  renderBuy(player) {
    const owned = new Set();
    owned.add(player.loadout.id); owned.add(player.sidearm.id);
    if (player.armour > 0) owned.add('armour');
    if (player.helmet) owned.add('helmet');
    if (player.kit) owned.add('kit');
    for (const el of this.el['buy-grid'].querySelectorAll('[data-owned]')) {
      el.textContent = owned.has(el.dataset.owned) ? 'OWNED' : '';
    }
    for (const b of this.el['buy-grid'].querySelectorAll('.buy-item')) {
      const id = b.dataset.buy;
      const price = (WEAPONS[id] || GRENADES[id] || GEAR[id]).price;
      b.classList.toggle('cant', player.cash < price && !owned.has(id));
    }
    this.el['buy-cash'].textContent = '$' + player.cash;
  }
  showBuy(open, player) {
    this.el.buy.hidden = !open;
    if (open && player) this.renderBuy(player);
  }
  showScoreboard(open) {
    this.el.board.hidden = !open;
    if (open) this.renderScoreboard();
  }
  renderScoreboard() {
    const rows = (team) => S.agents.filter(a => a.team === team)
      .sort((a, b) => b.kills - a.kills || b.damage - a.damage)
      .map(a => `<tr class="${a.isPlayer ? 'me' : ''}"><td>${a.name}${a.isPlayer && a.name !== 'You' ? ' (You)' : ''}</td><td>${a.kills}</td><td>${a.assists}</td><td>${a.deaths}</td><td>${a.headshots}</td><td>${a.damage}</td><td>$${a.cash}</td></tr>`).join('');
    this.el['board-body'].innerHTML =
      `<tr class="teamrow"><td colspan="7">HELIOS — ATTACK — ${S.score.HELIOS}</td></tr>${rows('HELIOS')}
       <tr class="teamrow"><td colspan="7">UMBRA — DEFEND — ${S.score.UMBRA}</td></tr>${rows('UMBRA')}`;
    this.el['board-title'].textContent = S.phase === 'matchend'
      ? (S.winner ? `${S.winner} take the match ${S.score.HELIOS}–${S.score.UMBRA}` : 'Match over')
      : `Round ${S.round} — ${S.score.HELIOS} : ${S.score.UMBRA}`;
  }
  showOverlay(kind, title, copy, btn) {
    const o = this.el.overlay;
    if (!kind) { o.hidden = true; return; }
    o.hidden = false;
    this.el['overlay-title'].textContent = title;
    this.el['overlay-copy'].textContent = copy;
    this.el['overlay-btn'].textContent = btn;
    this.el['overlay-btn'].style.display = btn ? '' : 'none';
  }
  announce(text, sub = '') {
    this.el.announce.innerHTML = `<b>${text}</b>${sub ? `<span>${sub}</span>` : ''}`;
    this.el.announce.style.opacity = 1;
    clearTimeout(this._annT);
    this._annT = setTimeout(() => { this.el.announce.style.opacity = 0; }, 3200);
  }
  hitmark(head) {
    const h = this.el.hitmarker;
    h.classList.add('on'); h.style.color = head ? '#ff5a4a' : '#ffb03a';
    clearTimeout(this._hmT); this._hmT = setTimeout(() => h.classList.remove('on'), 110);
  }
  damageFlash() {
    const d = this.el.dmgflash; d.style.opacity = 0.55;
    setTimeout(() => { d.style.opacity = 0; }, 160);
  }
  blind(t) { this.el.blind.style.opacity = t > 0 ? Math.min(0.95, t) : 0; }
  update(dt, player, seen) {
    const p = player;
    // Timer + round.
    const t = S.phase === 'buy' ? Math.ceil(S.buyTime) : S.phase === 'live' ? Math.ceil(S.roundTime) : 0;
    this.el.timer.textContent = S.phase === 'live' || S.phase === 'buy'
      ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : '—';
    if (!this.el.buy.hidden) {
      this.el['buy-timer'].textContent = String(Math.max(0, Math.ceil(S.buyTime)));
      const br = this.d.getElementById('buy-round');
      if (br) br.textContent = String(S.round);
    }
    this.el.roundlabel.textContent = `ROUND ${S.round} / ${ROUND.maxRounds}`;
    this.el['score-h'].textContent = S.score.HELIOS;
    this.el['score-u'].textContent = S.score.UMBRA;
    this.el['pips-h'].textContent = S.roundWins.map(w => w === 'H' ? '●' : '○').join(' ');
    this.el['pips-u'].textContent = S.roundWins.map(w => w === 'U' ? '●' : '○').join(' ');
    // Health / armour / cash.
    const hp = `${Math.max(0, Math.ceil(p.hp))}`;
    if (hp !== this.lastHp) { this.el.health.textContent = hp; this.lastHp = hp; }
    this.el.armour.textContent = Math.ceil(p.armour);
    this.el.cash.textContent = '$' + p.cash;
    // Ammo + weapon.
    const l = p.loadout, w = WEAPONS[l.id];
    const ammo = `${l.mag} / ${l.reserve}`;
    if (ammo !== this.lastAmmo) { this.el['ammo-mag'].textContent = l.mag; this.el['ammo-reserve'].textContent = '/ ' + l.reserve; this.lastAmmo = ammo; }
    this.el['ammo-mag'].parentElement.classList.toggle('empty', l.mag === 0);
    this.el['weapon-name'].textContent = w.name + (l.reloading > 0 ? ' — RELOADING' : '');
    this.el.slots.innerHTML = `<span class="${p.loadout.id === p.sidearm.id ? '' : 'active'}">1 ${WEAPONS[p.loadout.id].name}</span><span>2 ${WEAPONS[p.sidearm.id].name}</span>`;
    this.el.grenades.innerHTML = `<span>Frag ×${p.grenades.frag}</span><span>Smoke ×${p.grenades.smoke}</span><span>Flash ×${p.grenades.flash}</span><span class="hint">G throw · 3 cycle</span>`;
    // Crosshair spread.
    const spread = 10 + (p.loadout.bloom * 900) + (Math.hypot(p.vel.x, p.vel.z) * 2.2) + (p.aiming ? -5 : 0);
    this.el.crosshair.style.setProperty('--gap', Math.max(3, spread) + 'px');
    this.el.crosshair.style.opacity = p.alive && (S.phase === 'live') ? 1 : 0;
    // Bomb state line.
    const b = S.bomb;
    this.el.bombstate.textContent =
      b.state === 'planted' ? `CHARGE ARMED — ${Math.ceil(b.timer)}s` :
      b.state === 'carried' ? `CHARGE: ${b.carrier ? b.carrier.name : '?'}` :
      b.state === 'dropped' ? 'CHARGE DROPPED — recover it' :
      b.state === 'defused' ? 'CHARGE DEFUSED' : '';
    this.el.bombstate.className = b.state === 'planted' ? 'bomb hot' : 'bomb';
    // Plant progress.
    const ch = p.channel;
    if (ch && S.phase === 'live') {
      this.el.plantbar.hidden = false;
      this.el.plantfill.style.width = `${(ch.t / ch.dur) * 100}%`;
      this.el.plantlabel.textContent = ch.kind === 'plant' ? 'Arming the charge…' : 'Defusing the charge…';
    } else if (b.state === 'planted') {
      this.el.plantbar.hidden = false;
      this.el.plantfill.style.width = `${(1 - b.timer / ROUND.fuseTime) * 100}%`;
      this.el.plantlabel.textContent = `Charge fuse — ${Math.ceil(b.timer)}s`;
    } else this.el.plantbar.hidden = true;
    // Kill feed + radio.
    this.el.killfeed.innerHTML = S.killfeed.map(k => `<div>${k.text}${k.hs ? ' <b class="hs">HEADSHOT</b>' : ''}</div>`).join('');
    this.el.radio.innerHTML = S.radio.map(r => `<div><b>${r.who}</b> <i>${r.role}</i>: ${r.text}</div>`).join('');
    // Spectate line.
    this.el.spectate.hidden = p.alive;
    if (!p.alive && this._specName) this.el.spectate.textContent = `Spectating ${this._specName} — next round to rejoin`;
    // Minimap (throttled).
    this.mapT -= dt;
    if (this.mapT <= 0) { this.mapT = 0.12; this.drawMinimap(player, seen); }
    // Blind overlay decay is driven by main via blind().
    if (p.flashT > 0) this.blind(p.flashT);
    else this.blind(0);
  }
  drawMinimap(player, seen) {
    const c = this.mapCtx, W = 180, H = 180;
    const toMap = (x, z) => [((x + 34) / 68) * W, ((z + 34) / 68) * H];
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(20,14,8,0.82)'; c.fillRect(0, 0, W, H);
    // Panel arrays.
    c.fillStyle = 'rgba(90,140,190,0.55)';
    for (const [cx, cz] of [[-22, -6], [22, -6], [-10, 6], [10, 6], [-24, 8], [24, 8]]) {
      const [mx, my] = toMap(cx, cz); c.fillRect(mx - 8, my - 4, 16, 8);
    }
    // Spire.
    const [sx, sy] = toMap(22, -22);
    c.fillStyle = '#8a8f98'; c.beginPath(); c.arc(sx, sy, 4, 0, 7); c.fill();
    // Sites.
    for (const [key, s] of Object.entries(SITES)) {
      const [mx, my] = toMap(s.pos[0], s.pos[1]);
      c.strokeStyle = '#ffb03a'; c.lineWidth = 1.5;
      c.beginPath(); c.arc(mx, my, 11, 0, 7); c.stroke();
      c.fillStyle = '#ffb03a'; c.font = 'bold 12px system-ui'; c.textAlign = 'center';
      c.fillText(key, mx, my + 4);
      c.font = '9px system-ui'; c.fillText(s.name, mx, my + 22);
    }
    // Smoke clouds.
    c.fillStyle = 'rgba(220,200,160,0.5)';
    for (const sm of S.smokeClouds || []) { const [mx, my] = toMap(sm.x, sm.z); c.beginPath(); c.arc(mx, my, 8, 0, 7); c.fill(); }
    // Bomb.
    const b = S.bomb;
    if (b.state === 'planted' && b.site) {
      const [mx, my] = toMap(SITES[b.site].pos[0], SITES[b.site].pos[1]);
      c.fillStyle = '#ff5a3c'; c.beginPath(); c.arc(mx, my, 4, 0, 7); c.fill();
    } else if (b.state === 'dropped' && b.dropPos) {
      const [mx, my] = toMap(b.dropPos[0], b.dropPos[1]);
      c.fillStyle = '#ff8a3c'; c.beginPath(); c.arc(mx, my, 4, 0, 7); c.fill();
    }
    // Agents.
    for (const a of S.agents) {
      if (!a.alive) continue;
      const [mx, my] = toMap(a.x, a.z);
      if (a.isPlayer) {
        c.fillStyle = '#ffffff';
        c.save(); c.translate(mx, my); c.rotate(Math.atan2(-Math.sin(a.yaw), -Math.cos(a.yaw)) + Math.PI / 2);
        c.beginPath(); c.moveTo(0, -6); c.lineTo(4.5, 5); c.lineTo(-4.5, 5); c.closePath(); c.fill(); c.restore();
      } else if (a.team === player.team) {
        c.fillStyle = TEAMS[a.team].css; c.beginPath(); c.arc(mx, my, 3.5, 0, 7); c.fill();
      } else if (seen && seen.has(a.id)) {
        c.fillStyle = '#ff4a3c'; c.beginPath(); c.arc(mx, my, 3.5, 0, 7); c.fill();
      }
    }
  }
}
