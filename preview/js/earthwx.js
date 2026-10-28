// 主站地球的近即時紅外線雲圖層（NASA GIBS／JMA Himawari AHI Band 13，台灣區域）。
// 來源時段、過期、時間倍率、失敗撤圖的規則全部沿用 earthlayers.js（WeatherLayerState／weatherGate）與 earthweather.js（loadHimawariTaiwan）：
// - 只在「模擬時間＝現在、倍率＝即時」時顯示；加速、暫停、回到過去即撤圖
// - 顯示的是來源公布的產品時段（UTC），不是逐像素曝光時刻；過 90 分鐘未更新即撤圖
// - 失敗（CORS、停機、尺寸不符、全透明）一律顯示「—」，不用舊圖或快照冒充
// 影像為 10.3 µm 紅外線：冷雲頂亮、地表暗；不是真彩色，也不是三維雲高。
import * as THREE from 'three';
import { WeatherLayerState, NRT_POLICY } from './earthlayers.js';
import { loadHimawariTaiwan, WEATHER_SOURCE } from './earthweather.js';

export class EarthWeatherLayer {
  constructor(engine, { onStatus = () => {} } = {}) {
    this.engine = engine; this.onStatus = onStatus;
    this.enabled = false; this.texture = null; this.lastRefresh = 0; this.lastTick = 0;
    this.state = new WeatherLayerState({
      simulation: () => ({ nowMs: engine.simTime, timeRate: engine.timeRate }),
      onChange: (s) => this._apply(s),
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.enabled) this._maybeRefresh(true); });
  }
  get uniforms() { return this.engine.bodies.get('earth')?.mesh.material.uniforms || null; }
  get available() { const u = this.uniforms; return !!(u && u.uWx); }

  setEnabled(on) {
    this.enabled = !!on && this.available;
    if (!this.enabled) { this.state.stop(); this.onStatus({ status: 'off', text: '未開啟' }); return; }
    this.wasValid = this.timeValid;
    if (this.wasValid) this._maybeRefresh(true); else this.onStatus({ status: 'unavailable', reason: '模擬時間與現在不同，請把時間倍率設回即時', text: '時間：— · 模擬時間與現在不同，請把時間倍率設回即時' });
  }
  refresh() { if (this.enabled) this._maybeRefresh(true); }

  // 時間閘門是否成立：倍率＝即時且模擬時間在現在 ±60 秒內（與 earthlayers.weatherGate 同一條件）
  get timeValid() { return this.engine.timeRate === 1 && Math.abs(Date.now() - this.engine.simTime) <= NRT_POLICY.maxClockSkewMs; }

  // 主迴圈每幀呼叫；內部每秒檢查一次：過期撤圖、每 10 分鐘更新（頁面在背景時不更新）。
  // 時間閘門由不成立→成立（例如按「回到現在」）時立即重驗一次，不受 10 分鐘節流；但兩次重驗至少間隔 5 秒，避免反覆切換倍率造成請求風暴
  update() {
    if (!this.enabled) return;
    const now = performance.now(); if (now - this.lastTick < 1000) return; this.lastTick = now;
    this.state.tick();
    const valid = this.timeValid; const recovered = valid && !this.wasValid; this.wasValid = valid;
    if (document.hidden || !valid) return;
    if ((recovered || this.pendingForce) && this.state.status !== 'loading') this._maybeRefresh(true);
    else this._maybeRefresh(false);
  }
  _maybeRefresh(force) {
    const now = Date.now(); const since = now - this.lastRefresh;
    if (!force && since < WEATHER_SOURCE.cadenceMs) return;
    if (force && this.state.status === 'loading') { this.pendingForce = true; return; } // 已在驗證中：記下，完成後再驗
    if (force && this.lastForced && now - this.lastForced < 5000) { this.pendingForce = true; return; } // 5 秒內只允許一次強制重驗，其餘延後（不丟失）
    this.pendingForce = false;
    this.lastRefresh = now; if (force) this.lastForced = now;
    this.requests = (this.requests || 0) + 1;
    this.state.refresh(loadHimawariTaiwan).catch(() => {});
  }
  _apply(s) {
    const u = this.uniforms; if (!u) return;
    if (this.texture) { this.texture.dispose(); this.texture = null; }
    if (s.status === 'ready' && this.state.frame) {
      const f = this.state.frame; const [w, so, e, no] = f.bbox; // 西、南、東、北（度）
      this.texture = new THREE.CanvasTexture(f.canvas);
      this.texture.colorSpace = THREE.NoColorSpace; this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping; this.texture.anisotropy = 1;
      u.uWx.value = this.texture; u.uWxBox.value.set((w + 180) / 360, (so + 90) / 180, (e + 180) / 360, (no + 90) / 180); u.uWxOn.value = 1;
      const age = Math.max(0, Math.round((Date.now() - Date.parse(f.slot)) / 60000));
      this.onStatus({ status: 'ready', slot: f.slot, ageMin: age, provider: f.provider, text: `來源時段 ${f.slot.replace('T', ' ').replace('Z', ' UTC')}（延遲約 ${age} 分）· ${WEATHER_SOURCE.classification}` });
    } else {
      u.uWx.value = null; u.uWxOn.value = 0;
      this.onStatus({ status: s.status, reason: s.reason, text: s.status === 'loading' ? '讀取來源時段與影像…' : `時間：— · ${s.reason || '不可用'}` });
    }
  }
}
