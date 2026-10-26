// 聲音：預設靜音（真空）。兩種可選：
//  1. 合成環境音景（WebAudio 濾波雜訊，純合成，不是錄音）
//  2. 資料聲化：把太陽系行星的公轉頻率升高 N 個八度到可聽範圍（1/週期 × 2^N），每顆行星一個正弦音；
//     來源為 JPL 近似軌道週期。這是「資料轉換成聲音」，不是太空的聲音。
const PERIODS_DAYS = { mercury: 87.969, venus: 224.701, earth: 365.256, mars: 686.980, jupiter: 4332.59, saturn: 10759.22, uranus: 30688.5, neptune: 60182, pluto: 90560 };

export class SpaceAudio {
  constructor({ AudioContextClass } = {}) {
    this.ctx = null; this.mode = 'off'; this.nodes = []; this.seq = 0; this.onState = null;
    this.AudioContextClass = AudioContextClass || (typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null);
  }
  _ensure() {
    if (!this.ctx) {
      if (!this.AudioContextClass) throw new Error('此瀏覽器不支援 WebAudio');
      this.ctx = new this.AudioContextClass();
      // iOS 在來電、切換 App 時會把 context 變成 interrupted／suspended：通知外層把介面改回未播放
      try { this.ctx.onstatechange = () => { const s = this.ctx?.state; if (s !== 'running' && this.mode !== 'off') { this.stopAll(); this.onState?.({ ok: false, state: s, reason: '音訊被系統暫停' }); } }; } catch (e) { /* ignore */ }
    }
  }
  stopAll() { for (const n of this.nodes) { try { n.stop?.(); n.disconnect?.(); } catch (e) { /* ignore */ } } this.nodes = []; if (this.master) { try { this.master.disconnect(); } catch (e) { /* ignore */ } this.master = null; } this.mode = 'off'; }

  // 安全啟動：await resume()，只有 AudioContext 真正 running 才建立節點並回報播放中；
  // 被拒絕、逾時（3 秒）或仍 suspended 時保持 off、不留節點、不產生未處理的 Promise rejection。
  // 回傳 { ok, mode, state, reason?, table? }；較晚的呼叫會讓較早未完成的呼叫作廢（不會疊加節點）。
  async start(mode) {
    const seq = ++this.seq;
    if (mode === 'off') { this.stopAll(); return { ok: true, mode: 'off', state: this.ctx?.state || 'closed' }; }
    if (!['ambient', 'organ', 'arc', 'sonify'].includes(mode)) return { ok: false, mode: 'off', state: this.ctx?.state || 'closed', reason: '未知音景' };
    try { this._ensure(); } catch (e) { return { ok: false, mode: 'off', state: 'unsupported', reason: e.message }; }
    const ctx = this.ctx; this.stopAll();
    if (ctx.state !== 'running') {
      let reason = ''; let timer = null;
      try { await Promise.race([Promise.resolve(ctx.resume()), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('音訊啟動逾時（瀏覽器可能要求再點一次）')), 3000); })]); }
      catch (e) { reason = e?.message || '瀏覽器拒絕啟動音訊'; }
      finally { if (timer) clearTimeout(timer); } // 成功／失敗／被取代都清掉計時器
      if (seq !== this.seq) return { ok: false, mode: this.mode, state: ctx.state, reason: '已被較新的操作取代' };
      if (ctx.state !== 'running') { this.stopAll(); return { ok: false, mode: 'off', state: ctx.state, reason: reason || `音訊狀態 ${ctx.state}，尚未啟動` }; }
    }
    if (seq !== this.seq) return { ok: false, mode: this.mode, state: ctx.state, reason: '已被較新的操作取代' };
    let table; try { table = this[mode](); } catch (e) { this.stopAll(); return { ok: false, mode: 'off', state: ctx.state, reason: `建立音訊節點失敗：${e.message}` }; }
    return { ok: true, mode: this.mode, state: ctx.state, table };
  }

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

  // 合成管風琴式音景：加法合成（基音＋泛音）、微失諧合唱、極慢起伏；純合成，不是錄音，也不是任何電影配樂
  organ() {
    this._ensure(); this.stopAll(); this.mode = 'organ';
    const ctx = this.ctx; const master = ctx.createGain(); master.gain.value = 0; this.master = master;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 0.5;
    const swell = ctx.createGain(); swell.gain.value = 0.85;
    master.connect(lp); lp.connect(swell); swell.connect(ctx.destination);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 1 / 13; const lg = ctx.createGain(); lg.gain.value = 0.15; lfo.connect(lg); lg.connect(swell.gain); lfo.start(); this.nodes.push(lfo);
    const notes = [55, 82.41, 110, 164.81, 220, 329.63]; // A1 E2 A2 E3 A3 E4（純五度堆疊）
    const harm = [[1, 1], [2, 0.5], [3, 0.22], [4, 0.12], [6, 0.05]];
    for (const f of notes) for (const [h, gn] of harm) for (const det of [-3, 3]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * h; o.detune.value = det;
      const g = ctx.createGain(); g.gain.value = gn * 0.018 / Math.sqrt(h) * (f < 100 ? 1.3 : 1);
      o.connect(g); g.connect(master); o.start(); this.nodes.push(o);
    }
    const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = 27.5; const sg = ctx.createGain(); sg.gain.value = 0.08; sub.connect(sg); sg.connect(master); sub.start(); this.nodes.push(sub);
    master.gain.linearRampToValueAtTime(1.0, ctx.currentTime + 5);
  }

  // ARC 原創慢速配樂：和聲進行與節奏為本站原創，不使用電影旋律或音檔。
  // 音樂必須由使用者在設定中主動啟動；預設保持靜音。
  arc() {
    this._ensure(); this.stopAll(); this.mode = 'arc';
    const ctx = this.ctx;
    const master = ctx.createGain(); master.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -18; limiter.knee.value = 18;
    limiter.ratio.value = 4; limiter.attack.value = 0.02; limiter.release.value = 0.4;
    master.connect(limiter); limiter.connect(ctx.destination); this.master = master;
    // 四組原創開放式和弦，每 16 秒緩慢交替；避免重現任何既有配樂旋律。
    const chords = [
      [49.0, 73.42, 123.47, 185.0],
      [55.0, 82.41, 146.83, 220.0],
      [41.20, 61.74, 110.0, 164.81],
      [46.25, 69.30, 116.54, 174.61],
    ];
    const duration = 16, start = ctx.currentTime + 0.06;
    // 預先排程有限時長的和弦循環，不使用計時器或外部音訊請求。
    // 每次循環 64 秒，WebAudio 原生 loop 音訊緩衝可無縫銜接。
    const sampleRate = Math.min(ctx.sampleRate, 22050), seconds = duration * chords.length; // 降低 iPhone 長循環音訊記憶體負擔
    const buffer = ctx.createBuffer(2, Math.floor(sampleRate * seconds), sampleRate);
    const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
    const phases = chords.map(c => c.map((_,i) => (i + 1) * 0.37));
    for (let i = 0; i < left.length; i++) {
      const t = i / sampleRate, k = Math.floor(t / duration), x = (t % duration) / duration;
      const fade = Math.min(1, x * 5, (1 - x) * 5);
      let v = 0;
      for (let n = 0; n < chords[k].length; n++) {
        const f = chords[k][n];
        const a = 0.075 / (1 + n * 0.35);
        const ph = 2 * Math.PI * f * t + phases[k][n];
        v += a * (Math.sin(ph) + 0.22 * Math.sin(ph * 2) + 0.09 * Math.sin(ph * 3));
      }
      // 緩慢脈動與低音，保持音量克制；尾首均為零避免循環爆音。
      const envelope = fade * (0.77 + 0.23 * Math.sin(Math.PI * x));
      left[i] = v * envelope;
      right[i] = v * envelope * (0.98 + 0.02 * Math.sin(t * 0.31));
    }
    const src = ctx.createBufferSource(); src.buffer = buffer; src.loop = true;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1500;
    src.connect(filter); filter.connect(master); src.start(start); this.nodes.push(src);
    master.gain.setValueAtTime(0, ctx.currentTime);
    master.gain.linearRampToValueAtTime(0.62, ctx.currentTime + 6);
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
