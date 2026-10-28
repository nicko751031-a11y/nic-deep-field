// 星曆與座標：全部以 J2000 黃道座標為世界座標（x 指春分點，z 指黃道北極）
// 來源：
//  - 行星位置：JPL「Keplerian Elements for Approximate Positions of the Major Planets」(Standish 1992，1800–2050 表)，精度約角分等級
//  - 月球位置：Astronomical Almanac 低精度公式（黃經誤差約 0.3°、距離約 0.2 地球半徑）
//  - 自轉軸與本初子午線：IAU WGCCRE 2009/2015 報告（月球含主要天平動項）
//  - 地球自轉：由 W = 190.147 + 360.9856235 d（等同格林威治恆星時）
import { AU_KM, DEG } from './units.js';

export const OBLIQUITY_J2000 = 23.43928 * DEG;
const J2000 = 2451545.0;

export function jdFromDate(date) { return date.getTime() / 86400000 + 2440587.5; }
export function dateFromJd(jd) { return new Date((jd - 2440587.5) * 86400000); }
// 近似 TT−UTC（秒）：2000–2030 年約 64–70 秒；此處固定 69 秒（對角分級精度無影響）
export function jdTT(jdUTC) { return jdUTC + 69.2 / 86400; }

const norm360 = (x) => ((x % 360) + 360) % 360;

// 赤道 → 黃道（J2000）
export function equToEcl(v) {
  const c = Math.cos(OBLIQUITY_J2000), s = Math.sin(OBLIQUITY_J2000);
  return [v[0], c * v[1] + s * v[2], -s * v[1] + c * v[2]];
}
export function eclToEqu(v) {
  const c = Math.cos(OBLIQUITY_J2000), s = Math.sin(OBLIQUITY_J2000);
  return [v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]];
}
export function raDecToEqu(raDeg, decDeg, r = 1) {
  const ra = raDeg * DEG, dec = decDeg * DEG;
  return [r * Math.cos(dec) * Math.cos(ra), r * Math.cos(dec) * Math.sin(ra), r * Math.sin(dec)];
}
export function raDecToEcl(raDeg, decDeg, r = 1) { return equToEcl(raDecToEqu(raDeg, decDeg, r)); }

// ----------------------------------------------------------------- 行星軌道根數
// a[AU], e, I[deg], L[deg], varpi[deg], Omega[deg]；每儒略世紀變率
const ELEMENTS = {
  mercury: { el: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
             rate: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081] },
  venus:   { el: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
             rate: [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418] },
  emb:     { el: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
             rate: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0] },
  mars:    { el: [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
             rate: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343] },
  jupiter: { el: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
             rate: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106] },
  saturn:  { el: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
             rate: [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794] },
  uranus:  { el: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503],
             rate: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589] },
  neptune: { el: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
             rate: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664] },
  pluto:   { el: [39.48211675, 0.24882730, 17.14001206, 238.92903833, 224.06891629, 110.30393684],
             rate: [-0.00031596, 0.00005170, 0.00004818, 145.20780515, -0.04062942, -0.01183482] },
};

// 回傳日心黃道 J2000 位置（km）
export function keplerPosition(key, jd) {
  const T = (jd - J2000) / 36525;
  const E = ELEMENTS[key];
  const a = E.el[0] + E.rate[0] * T;
  const e = E.el[1] + E.rate[1] * T;
  const I = (E.el[2] + E.rate[2] * T) * DEG;
  const L = E.el[3] + E.rate[3] * T;
  const varpi = E.el[4] + E.rate[4] * T;
  const Omega = (E.el[5] + E.rate[5] * T) * DEG;
  const omega = varpi * DEG - Omega;
  let M = norm360(L - varpi) * DEG;
  if (M > Math.PI) M -= 2 * Math.PI;
  // 解克卜勒方程
  let Ea = M + e * Math.sin(M);
  for (let i = 0; i < 12; i++) {
    const dE = (M - (Ea - e * Math.sin(Ea))) / (1 - e * Math.cos(Ea));
    Ea += dE;
    if (Math.abs(dE) < 1e-9) break;
  }
  const xp = a * (Math.cos(Ea) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(Ea);
  const cw = Math.cos(omega), sw = Math.sin(omega), cO = Math.cos(Omega), sO = Math.sin(Omega), cI = Math.cos(I), sI = Math.sin(I);
  const x = (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp;
  const y = (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp;
  const z = (sw * sI) * xp + (cw * sI) * yp;
  return [x * AU_KM, y * AU_KM, z * AU_KM];
}

// 月球地心位置（黃道 J2000 近似為當日黃道；km）
export function moonGeocentric(jd) {
  const T = (jd - J2000) / 36525;
  const s = (deg) => Math.sin(deg * DEG), c = (deg) => Math.cos(deg * DEG);
  const lam = 218.32 + 481267.881 * T
    + 6.29 * s(135.0 + 477198.87 * T) - 1.27 * s(259.3 - 413335.36 * T) + 0.66 * s(235.7 + 890534.22 * T)
    + 0.21 * s(269.9 + 954397.74 * T) - 0.19 * s(357.5 + 35999.05 * T) - 0.11 * s(186.5 + 966404.03 * T);
  const beta = 5.13 * s(93.3 + 483202.02 * T) + 0.28 * s(228.2 + 960400.89 * T)
    - 0.28 * s(318.3 + 6003.15 * T) - 0.17 * s(217.6 - 407332.21 * T);
  const par = 0.9508 + 0.0518 * c(135.0 + 477198.87 * T) + 0.0095 * c(259.3 - 413335.36 * T)
    + 0.0078 * c(235.7 + 890534.22 * T) + 0.0028 * c(269.9 + 954397.74 * T);
  const r = 6378.14 / Math.sin(par * DEG);
  const l = lam * DEG, b = beta * DEG;
  return [r * Math.cos(b) * Math.cos(l), r * Math.cos(b) * Math.sin(l), r * Math.sin(b)];
}

// 地月質量比 → 地球相對地月質心位移
const MOON_EARTH_MASS_RATIO = 1 / 81.30056;
export function earthHeliocentric(jd) {
  const emb = keplerPosition('emb', jd);
  const m = moonGeocentric(jd);
  const f = MOON_EARTH_MASS_RATIO / (1 + MOON_EARTH_MASS_RATIO);
  return [emb[0] - m[0] * f, emb[1] - m[1] * f, emb[2] - m[2] * f];
}

// ----------------------------------------------------------------- 自轉（IAU）
// 回傳 { ra, dec, W }（度），d = 自 J2000 TT 起算日數
const POLES = {
  sun:     (d, T) => ({ ra: 286.13, dec: 63.87, W: 84.176 + 14.1844000 * d }),
  mercury: (d, T) => ({ ra: 281.0103 - 0.0328 * T, dec: 61.4155 - 0.0049 * T, W: 329.5988 + 6.1385108 * d }),
  venus:   (d, T) => ({ ra: 272.76, dec: 67.16, W: 160.20 - 1.4813688 * d }),
  earth:   (d, T) => ({ ra: 0.00 - 0.641 * T, dec: 90.00 - 0.557 * T, W: 190.147 + 360.9856235 * d }),
  moon: (d, T) => {
    const E1 = (125.045 - 0.0529921 * d) * DEG, E2 = (250.089 - 0.1059842 * d) * DEG;
    const E3 = (260.008 + 13.0120009 * d) * DEG, E4 = (176.625 + 13.3407154 * d) * DEG;
    return {
      ra: 269.9949 + 0.0031 * T - 3.8787 * Math.sin(E1) - 0.1204 * Math.sin(E2) + 0.0700 * Math.sin(E3) - 0.0172 * Math.sin(E4),
      dec: 66.5392 + 0.0130 * T + 1.5419 * Math.cos(E1) + 0.0239 * Math.cos(E2) - 0.0278 * Math.cos(E3) + 0.0068 * Math.cos(E4),
      W: 38.3213 + 13.17635815 * d + 3.5610 * Math.sin(E1) + 0.1208 * Math.sin(E2) - 0.0642 * Math.sin(E3) + 0.0158 * Math.sin(E4),
    };
  },
  mars:    (d, T) => ({ ra: 317.68143 - 0.1061 * T, dec: 52.88650 - 0.0609 * T, W: 176.630 + 350.89198226 * d }),
  jupiter: (d, T) => ({ ra: 268.056595 - 0.006499 * T, dec: 64.495303 + 0.002413 * T, W: 284.95 + 870.5360000 * d }),
  saturn:  (d, T) => ({ ra: 40.589 - 0.036 * T, dec: 83.537 - 0.004 * T, W: 38.90 + 810.7939024 * d }),
  uranus:  (d, T) => ({ ra: 257.311, dec: -15.175, W: 203.81 - 501.1600928 * d }),
  neptune: (d, T) => {
    const N = (357.85 + 52.316 * T) * DEG;
    return { ra: 299.36 + 0.70 * Math.sin(N), dec: 43.46 - 0.51 * Math.cos(N), W: 253.18 + 536.3128492 * d - 0.48 * Math.sin(N) };
  },
  pluto:   (d, T) => ({ ra: 132.993, dec: -6.163, W: 302.695 + 56.3625225 * d }),
};

// 回傳本體座標軸（黃道 J2000 世界座標）：xb = 本初子午線方向、yb = 北極、zb = xb × yb
export function bodyAxes(key, jdUTC) {
  const jd = jdTT(jdUTC);
  const d = jd - J2000, T = d / 36525;
  const P = POLES[key];
  if (!P) return null;
  const { ra, dec, W } = P(d, T);
  const a = ra * DEG, de = dec * DEG;
  const p = [Math.cos(de) * Math.cos(a), Math.cos(de) * Math.sin(a), Math.sin(de)]; // 赤道座標
  const q = [-Math.sin(a), Math.cos(a), 0]; // 本體赤道與 ICRF 赤道的升交點方向（RA = α0 + 90°）
  const pxq = cross(p, q);
  const w = norm360(W) * DEG;
  const xb = [q[0] * Math.cos(w) + pxq[0] * Math.sin(w), q[1] * Math.cos(w) + pxq[1] * Math.sin(w), q[2] * Math.cos(w) + pxq[2] * Math.sin(w)];
  const yb = p;
  const zb = cross(xb, yb);
  return { xb: equToEcl(xb), yb: equToEcl(yb), zb: equToEcl(zb), W: norm360(W), ra, dec };
}

function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

// 格林威治平恆星時（度），用於顯示與自我檢查
export function gmstDeg(jdUT) {
  const T = (jdUT - J2000) / 36525;
  return norm360(280.46061837 + 360.98564736629 * (jdUT - J2000) + 0.000387933 * T * T - T * T * T / 38710000);
}

// 地球上某經緯度（度）在世界座標中的方向（單位向量）＝ 用於標記 ISS 位置等
export function geoToWorldDir(axes, latDeg, lonDeg) {
  const lat = latDeg * DEG, lon = lonDeg * DEG;
  // 本體座標：x = 本初子午線、y = 北、-z = 東經 90°
  const lx = Math.cos(lat) * Math.cos(lon), ly = Math.sin(lat), lz = -Math.cos(lat) * Math.sin(lon);
  return [
    axes.xb[0] * lx + axes.yb[0] * ly + axes.zb[0] * lz,
    axes.xb[1] * lx + axes.yb[1] * ly + axes.zb[1] * lz,
    axes.xb[2] * lx + axes.yb[2] * ly + axes.zb[2] * lz,
  ];
}

// 太陽地心黃經（度）＝ 用於自我檢查
export function sunEclipticLongitude(jd) {
  const e = earthHeliocentric(jd);
  return norm360(Math.atan2(-e[1], -e[0]) / DEG);
}
export function eclipticLongitude(v) { return norm360(Math.atan2(v[1], v[0]) / DEG); }
