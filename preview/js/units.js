// 單位與格式化（全部內部計算以公里、秒為單位）
export const AU_KM = 149597870.7;
export const C_KM_S = 299792.458;
export const LY_KM = 9.4607304725808e12;
export const PC_KM = 3.0856775814913673e13;
export const DEG = Math.PI / 180;
export const R_SUN_KM = 695700;
export const R_JUP_KM = 71492;
export const R_EARTH_KM = 6371.0;
export const M_SUN_KG = 1.98892e30;
export const G_SI = 6.6743e-11;

export function fmtNum(x, digits = 3) {
  if (x === null || x === undefined || Number.isNaN(x)) return '未知';
  const ax = Math.abs(x);
  if (ax >= 1e6 || (ax > 0 && ax < 1e-3)) return x.toExponential(digits - 1);
  return x.toLocaleString('zh-TW', { maximumSignificantDigits: Math.max(digits, 3) });
}

// 距離（km）→ 適合人讀的字串
export function fmtDist(km) {
  if (km === null || km === undefined || !Number.isFinite(km)) return '未知';
  const a = Math.abs(km);
  if (a < 1) return `${(km * 1000).toFixed(0)} m`;
  if (a < 1e4) return `${km.toFixed(1)} km`;
  if (a < 1e6) return `${Math.round(km).toLocaleString('zh-TW')} km`;
  if (a < 0.05 * AU_KM) return `${(km / 1e6).toFixed(2)} 百萬 km`;
  if (a < 0.02 * LY_KM) return `${(km / AU_KM).toFixed(a < 10 * AU_KM ? 3 : 1)} AU`;
  if (a < 1000 * LY_KM) return `${(km / LY_KM).toFixed(a < 100 * LY_KM ? 2 : 0)} 光年`;
  if (a < 1e6 * LY_KM) return `${(km / LY_KM / 1000).toFixed(1)} 千光年`;
  if (a < 1e9 * LY_KM) return `${(km / LY_KM / 1e6).toFixed(2)} 百萬光年`;
  return `${(km / LY_KM / 1e9).toFixed(2)} 十億光年`;
}

// 速度（km/s）→ 字串（含光速倍數）
export function fmtSpeed(kms) {
  const c = kms / C_KM_S;
  if (kms < 1) return `${(kms * 1000).toFixed(0)} m/s`;
  if (c < 0.01) return `${kms.toFixed(kms < 100 ? 1 : 0)} km/s`;
  if (c < 1) return `${kms.toFixed(0)} km/s（${(c * 100).toFixed(1)}% c）`;
  if (c < 1000) return `${c.toFixed(c < 10 ? 2 : 0)} c`;
  if (c < 1e7) return `${Math.round(c).toLocaleString('zh-TW')} c`;
  return `${c.toExponential(2)} c`;
}

export function fmtTime(sec) {
  if (sec < 60) return `${sec.toFixed(0)} 秒`;
  if (sec < 3600) return `${(sec / 60).toFixed(1)} 分`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)} 小時`;
  if (sec < 86400 * 365.25) return `${(sec / 86400).toFixed(1)} 天`;
  return `${(sec / 86400 / 365.25).toFixed(1)} 年`;
}

export function pad2(n) { return String(n).padStart(2, '0'); }

export function fmtDateTime(d, { utc = false } = {}) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '未知';
  if (utc) {
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} UTC`;
  }
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const tz = `UTC${sign}${pad2(Math.floor(Math.abs(off) / 60))}:${pad2(Math.abs(off) % 60)}`;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${tz}`;
}

export function fmtAgo(ms) {
  if (!Number.isFinite(ms)) return '未知';
  const s = ms / 1000;
  if (s < 90) return `${Math.round(s)} 秒前`;
  if (s < 5400) return `${Math.round(s / 60)} 分鐘前`;
  if (s < 86400 * 2) return `${(s / 3600).toFixed(1)} 小時前`;
  return `${(s / 86400).toFixed(1)} 天前`;
}

export function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
export function lerp(a, b, t) { return a + (b - a) * t; }
