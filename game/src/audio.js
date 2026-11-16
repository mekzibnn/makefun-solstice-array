// SOLSTICE ARRAY — audio.js. One job: synthesized sound, no audio files.
// Every sound is built from oscillators + filtered noise through WebAudio,
// so the game ships zero audio assets and makes zero network requests.

export class AudioSys {
  constructor() {
    this.ctx = null; this.master = null; this.noiseBuf = null; this.enabled = true;
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch { this.ctx = null; }
  }
  _noise(dur, filterFreq, gain, type = 'lowpass', when = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }
  _tone(freq, dur, gain, type = 'sine', slideTo = 0, when = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  shot(id) {
    if (!this.ctx) return;
    const crack = { sidewinder: [1400, 0.32], dune: [1700, 0.26], sunlance: [1100, 0.4], mirage: [900, 0.5], flare: [700, 0.55], longshot: [600, 0.7] }[id] || [1200, 0.35];
    this._noise(0.09, crack[0], crack[1]);
    this._tone(160, 0.08, 0.25, 'square', 60);
  }
  dry() { this._tone(900, 0.04, 0.12, 'square'); }
  reload() { this._tone(500, 0.05, 0.15, 'square'); this._tone(700, 0.05, 0.15, 'square', 0, 0.18); }
  step() { this._noise(0.06, 500, 0.07); }
  hit() { this._tone(1200, 0.05, 0.2, 'sine', 900); }
  headshot() { this._tone(1600, 0.06, 0.25, 'sine', 1100); }
  hurt() { this._tone(220, 0.15, 0.3, 'sawtooth', 120); }
  throwPin() { this._tone(800, 0.04, 0.12, 'square'); }
  explosion() {
    this._noise(0.7, 300, 0.9); this._tone(90, 0.6, 0.6, 'sine', 35);
  }
  beep(final = false) { this._tone(final ? 1400 : 1000, 0.09, 0.22, 'sine'); }
  plant() { this._tone(700, 0.1, 0.2, 'sine'); this._tone(1050, 0.1, 0.2, 'sine', 0, 0.14); }
  defuse() { this._tone(1050, 0.1, 0.2, 'sine'); this._tone(700, 0.1, 0.2, 'sine', 0, 0.14); }
  horn(win) {
    this._tone(win ? 523 : 392, 0.5, 0.25, 'triangle');
    this._tone(win ? 659 : 494, 0.5, 0.25, 'triangle', 0, 0.12);
  }
  buy() { this._tone(880, 0.07, 0.18, 'sine'); this._tone(1320, 0.09, 0.18, 'sine', 0, 0.08); }
  roundStart() { this._tone(440, 0.15, 0.2, 'triangle'); this._tone(660, 0.2, 0.2, 'triangle', 0, 0.16); }
}
