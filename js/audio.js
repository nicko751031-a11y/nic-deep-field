// 聲音：預設靜音（真空）。兩種可選：
//  1. 合成環境音景（WebAudio 濾波雜訊，純合成，不是錄音）
//  2. 資料聲化：把太陽系行星的公轉頻率升高 N 個八度到可聽範圍（1/週期 × 2^N），每顆行星一個正弦音；
//     來源為 JPL 近似軌道週期。這是「資料轉換成聲音」，不是太空的聲音。
const PERIODS_DAYS = { mercury: 87.969, venus: 224.701, earth: 365.256, mars: 686.980, jupiter: 4332.59, saturn: 10759.22, uranus: 30688.5, neptune: 60182, pluto: 90560 };

export class SpaceAudio {
  constructor() { this.ctx = null; this.mode = 'off'; this.nodes = []; }
  _ensure() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); if (this.ctx.state === 'suspended') this.ctx.resume(); }
  stopAll() { for (const n of this.nodes) { try { n.stop?.(); n.disconnect?.(); } catch (e) { /* ignore */ } } this.nodes = []; if (this.master) { try { this.master.disconnect(); } catch (e) { /* ignore */ } this.master = null; } this.mode = 'off'; }

  ambient() {
    this._ensure(); this.stopAll(); this.mode = 'ambient';
    const ctx = this.ctx; const master = ctx.createGain(); master.gain.value = 0.0; master.connect(ctx.destination); this.master = master;
    // 棕色雜訊 → 低通 → 慢速 LFO 調變
    const len = ctx.sampleRate * 4; const buf = ctx.createBuffer(1, len, ctx.sampleRate); const d = buf.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180; lp.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05; const lfoG = ctx.createGain(); lfoG.gain.value = 60; lfo.connect(lfoG); lfoG.connect(lp.frequency);
    src.connect(lp); lp.connect(g); g.connect(master); src.start(); lfo.start();
    // 兩個極低音的正弦 drone
    for (const f of [55, 82.4]) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; const og = ctx.createGain(); og.gain.value = 0.06; o.connect(og); og.connect(master); o.start(); this.nodes.push(o); }
    this.nodes.push(src, lfo);
    master.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 2);
  }

  // 聲化：回傳每顆行星的音高表供 UI 顯示
  sonify() {
    this._ensure(); this.stopAll(); this.mode = 'sonify';
    const ctx = this.ctx; const master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination); this.master = master;
    const table = [];
    for (const [k, P] of Object.entries(PERIODS_DAYS)) {
      const f0 = 1 / (P * 86400); // Hz
      let f = f0, oct = 0; while (f < 110) { f *= 2; oct++; } // 升到 ≥110 Hz
      table.push({ key: k, periodDays: P, octaves: oct, hz: f });
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.045;
      o.connect(g); g.connect(master); o.start(); this.nodes.push(o);
    }
    master.gain.linearRampToValueAtTime(0.6, ctx.currentTime + 1.5);
    return table;
  }
}
