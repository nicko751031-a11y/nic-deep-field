// 地球圖層共用驗證：不改動現有 renderer，供分塊地形與近即時衛星介接。
// 所有日期皆由來源提供；此模組不以抓取時間或電腦時間偽造觀測時間。
const MS = 1000;
export const NRT_POLICY = Object.freeze({ maxAgeMs: 90 * 60 * MS, maxClockSkewMs: 60 * MS });

export function utcMillis(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().replace('.000Z', 'Z') === value ? time : null;
}

export function latestSourceSlot(values, nowMs = Date.now()) {
  if (!Array.isArray(values) || !Number.isFinite(nowMs)) return null;
  let latest = null;
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const pieces = value.split('/');
    let t = utcMillis(pieces[0]);
    if (t === null) continue;
    if (pieces.length === 3) {
      const end = utcMillis(pieces[1]);
      const d = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(pieces[2]);
      const step = d ? (Number(d[1] || 0) * 3600 + Number(d[2] || 0) * 60 + Number(d[3] || 0)) * MS : 0;
      if (end === null || end < t || step <= 0 || !Number.isFinite(step) || t > nowMs) continue;
      t += Math.floor((Math.min(end, nowMs) - t) / step) * step;
    } else if (pieces.length !== 1) continue;
    if (t <= nowMs && (latest === null || t > latest)) latest = t;
  }
  return latest === null ? null : new Date(latest).toISOString().replace('.000Z', 'Z');
}

export function weatherGate(slot, nowMs, simMs, timeRate, policy = NRT_POLICY) {
  const time = utcMillis(slot);
  if (time === null) return { ok: false, reason: '來源未提供有效 UTC 時段' };
  if (![nowMs, simMs, timeRate, policy.maxAgeMs, policy.maxClockSkewMs].every(Number.isFinite) || policy.maxAgeMs <= 0 || policy.maxClockSkewMs < 0) return { ok: false, reason: '時間設定無效' };
  if (time > nowMs) return { ok: false, reason: '來源時段位於未來' };
  if (nowMs - time > policy.maxAgeMs) return { ok: false, reason: '資料已過期，已撤下近即時圖層' };
  if (timeRate !== 1 || Math.abs(nowMs - simMs) > policy.maxClockSkewMs) return { ok: false, reason: '模擬時間與現在不同，已暫停近即時圖層' };
  return { ok: true, ageMs: nowMs - time, productSlotUTC: slot, observationInstantUTC: null };
}

export function geoUV(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90) throw new RangeError('經緯度無效');
  const wrapped = ((longitude + 180) % 360 + 360) % 360;
  return { u: wrapped / 360, v: (latitude + 90) / 180 };
}

// 標準地心地固座標 ECEF；不是 three 世界座標，接入時仍須用既有 IAU 自轉軸轉換。
export function geodeticEcefKm(lat, lon, heightMetres, { datum = 'ellipsoid', geoidMetres = null } = {}) {
  geoUV(lat, lon);
  if (!Number.isFinite(heightMetres)) throw new RangeError('高程未知');
  if (!['ellipsoid', 'orthometric'].includes(datum)) throw new RangeError('未知高程基準');
  if (datum === 'orthometric' && !Number.isFinite(geoidMetres)) throw new RangeError('正高必須提供大地水準面轉換，不得默認為零');
  const h = (heightMetres + (datum === 'orthometric' ? geoidMetres : 0)) / 1000;
  const a = 6378.137, f = 1 / 298.257223563, e2 = f * (2 - f);
  const p = lat * Math.PI / 180, l = lon * Math.PI / 180;
  const n = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  return [(n + h) * Math.cos(p) * Math.cos(l), (n + h) * Math.cos(p) * Math.sin(l), (n * (1 - e2) + h) * Math.sin(p)];
}

export function validateHeightGrid(grid) {
  const { width, height, transform: t, samples, nodata } = grid;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || !samples || samples.length !== width * height) throw new RangeError('高程陣列尺寸錯誤');
  if (!Array.isArray(t) || t.length !== 6 || !t.every(Number.isFinite) || t[0] <= 0 || t[4] >= 0 || t[1] !== 0 || t[3] !== 0) throw new RangeError('只接受北向上、無旋轉的 EPSG:4326 格網');
  if (grid.crs !== 'EPSG:4326' || grid.unit !== 'metres' || grid.registration !== 'pixel-centre') throw new RangeError('座標、單位或像素位置規格不符');
  for (const h of samples) if (h !== nodata && (!Number.isFinite(h) || h < -12000 || h > 10000)) throw new RangeError('高程超出可驗證範圍');
  return grid;
}

export function sampleHeight(grid, lat, lon) {
  geoUV(lat, lon);
  const { width: w, height: h, transform: t, samples: v, nodata } = grid;
  // transform = [經度間距,0,西界,0,負緯度間距,北界]；採樣點在像素中心。
  if (lon < t[2] || lon > t[2] + w * t[0] || lat > t[5] || lat < t[5] + h * t[4]) return null;
  const x = Math.max(0, Math.min(w - 1, (lon - t[2]) / t[0] - 0.5));
  const y = Math.max(0, Math.min(h - 1, (lat - t[5]) / t[4] - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const a = [v[y0*w+x0], v[y0*w+x1], v[y1*w+x0], v[y1*w+x1]];
  if (a.some(n => !Number.isFinite(n) || n === nodata)) return null;
  const dx = x - x0, dy = y - y0;
  return (a[0] * (1-dx) + a[1] * dx) * (1-dy) + (a[2] * (1-dx) + a[3] * dx) * dy;
}

// 來源 adapter 必須回傳 verifiedTime=true（已確認影像對應該來源時段），
// coverageFraction 必須經影像像素／缺測檢查；HTTP 200 並不代表影像可用。
export class WeatherLayerState {
  constructor({ clock = Date.now, simulation = () => ({ nowMs: clock(), timeRate: 1 }), onChange = () => {}, policy = NRT_POLICY } = {}) {
    this.clock = clock; this.simulation = simulation; this.onChange = onChange; this.policy = policy;
    this.sequence = 0; this.frame = null; this.controller = null; this.status = 'off'; this.reason = '';
  }
  snapshot() {
    const fresh = this.frame !== null && this.status === 'ready';
    return { status: this.status, reason: this.reason, productSlotUTC: fresh ? this.frame.slot : '—', observationInstantUTC: null, provider: fresh ? this.frame.provider : null, isNearRealtime: fresh, hasFrame: fresh };
  }
  clear(status, reason = '') {
    const old = this.frame; this.frame = null; this.status = status; this.reason = reason;
    try { old?.dispose?.(); } finally { this.onChange(this.snapshot()); }
  }
  stop() { this.sequence++; this.controller?.abort(); this.clear('off'); }
  tick() {
    if (!this.frame) return;
    const sim = this.simulation();
    const gate = weatherGate(this.frame.slot, this.clock(), sim.nowMs, sim.timeRate, this.policy);
    if (!gate.ok) { this.sequence++; this.controller?.abort(); this.clear('unavailable', gate.reason); }
  }
  async refresh(load) {
    const seq = ++this.sequence;
    this.controller?.abort(); const controller = new AbortController(); this.controller = controller;
    this.clear('loading'); // 刷新或失敗時不保留舊圖冒充當前影像。
    let frame = null;
    try {
      frame = await load({ signal: controller.signal });
      if (seq !== this.sequence || controller.signal.aborted) { frame?.dispose?.(); return; }
      const sim = this.simulation();
      const gate = weatherGate(frame?.slot, this.clock(), sim.nowMs, sim.timeRate, this.policy);
      if (!gate.ok) throw new Error(gate.reason);
      if (frame.verifiedTime !== true) throw new Error('影像與來源時段尚未完成對應驗證');
      if (!Number.isFinite(frame.coverageFraction) || frame.coverageFraction <= 0 || frame.coverageFraction > 1) throw new Error('來源影像缺測或覆蓋範圍無效');
      if (typeof frame.provider !== 'string' || !frame.provider.trim()) throw new Error('來源名稱缺失');
      this.frame = frame; frame = null; this.status = 'ready'; this.reason = ''; this.onChange(this.snapshot());
    } catch (error) {
      frame?.dispose?.();
      if (seq === this.sequence && !controller.signal.aborted) this.clear('failed', error.message || '載入失敗');
    }
  }
}
