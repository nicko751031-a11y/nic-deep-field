// 程序貼圖產生器：只用在「沒有可用觀測貼圖」的天體，所有結果都在 UI 標示為程序模擬
import * as THREE from 'three';

// 簡易可重現的雜訊（value noise + fbm）
function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = (t) => t * t * (3 - 2 * t);
// 在球面經緯貼圖上，x 方向需要週期性：ix 取模 period
function vnoise(x, y, period, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
  const w = (i) => ((i % period) + period) % period;
  const a = hash2(w(ix), iy, seed), b = hash2(w(ix + 1), iy, seed), c = hash2(w(ix), iy + 1, seed), d = hash2(w(ix + 1), iy + 1, seed);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}
function fbm(u, v, octaves, baseFreq, seed, gain = 0.5) {
  let amp = 1, sum = 0, norm = 0, f = baseFreq;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(u * f, v * f * 0.5, f, seed + o * 17);
    norm += amp; amp *= gain; f *= 2;
  }
  return sum / norm;
}

function canvasTexture(w, h, fill) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  fill(img.data, w, h);
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// 水星：灰色、撞擊坑密布（坑位置為隨機，非真實）
export function makeMercuryTexture(w = 2048, h = 1024) {
  const rng = makeRng(7);
  const craters = [];
  for (let i = 0; i < 5200; i++) {
    const r = Math.pow(rng(), 3.0) * 0.035 + 0.0015;
    craters.push({ u: rng(), v: rng(), r, depth: 0.3 + rng() * 0.6 });
  }
  return canvasTexture(w, h, (data) => {
    // 先畫底色與大尺度反照率變化
    const base = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      const n = fbm(u, v, 6, 6, 11) * 0.5 + fbm(u, v, 3, 40, 23) * 0.5;
      base[y * w + x] = 0.36 + (n - 0.5) * 0.22;
    }
    // 撞擊坑：環形凸起＋坑底變暗（經度方向以 cos(lat) 修正，使球面上呈圓形）
    for (const c of craters) {
      const lat = (0.5 - c.v) * Math.PI;
      const cosl = Math.max(0.15, Math.cos(lat));
      const ru = c.r / cosl, rv = c.r;
      const x0 = Math.floor((c.u - ru) * w), x1 = Math.ceil((c.u + ru) * w);
      const y0 = Math.max(0, Math.floor((c.v - rv) * h)), y1 = Math.min(h - 1, Math.ceil((c.v + rv) * h));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const du = ((x / w) - c.u) / ru, dv = ((y / h) - c.v) / rv;
        const d = Math.sqrt(du * du + dv * dv);
        if (d > 1.15) continue;
        const xi = ((x % w) + w) % w;
        let m = 1;
        if (d < 0.75) m = 1 - 0.10 * c.depth * (1 - d / 0.75) ** 0.8;        // 坑底較暗
        else if (d < 1.0) m = 1 + 0.06 * c.depth * Math.sin((d - 0.75) / 0.25 * Math.PI); // 環形山壁略亮
        else m = 1 - 0.03 * (1 - (d - 1.0) / 0.15);
        base[y * w + xi] *= m;
      }
    }
    for (let i = 0; i < w * h; i++) {
      const g = Math.max(0, Math.min(1, base[i])) * 255;
      data[i * 4] = g * 1.02; data[i * 4 + 1] = g; data[i * 4 + 2] = g * 0.97; data[i * 4 + 3] = 255;
    }
  });
}

// 金星：厚重硫酸雲，淡黃白、低對比，帶微弱的斜向條紋
export function makeVenusCloudTexture(w = 2048, h = 1024) {
  return canvasTexture(w, h, (data) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      const lat = (0.5 - v) * Math.PI;
      // 條紋沿赤道向極區呈 Y 形傾斜（紫外線影像的典型型態，可見光極弱）
      const sh = u + 0.18 * Math.sign(lat) * Math.pow(Math.abs(lat) / (Math.PI / 2), 1.5);
      const streak = fbm(sh * 2, v, 4, 3, 101) * 0.6 + fbm(u, v, 5, 12, 103) * 0.4;
      const l = 0.86 + (streak - 0.5) * 0.08 - Math.pow(Math.abs(lat) / (Math.PI / 2), 6) * 0.05;
      const i = (y * w + x) * 4;
      data[i] = Math.min(255, l * 255 * 1.0); data[i + 1] = Math.min(255, l * 255 * 0.955); data[i + 2] = Math.min(255, l * 255 * 0.85); data[i + 3] = 255;
    }
  });
}

// 天王星：均勻藍綠，極微弱緯度帶
export function makeUranusTexture(w = 1024, h = 512) {
  return canvasTexture(w, h, (data) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = y / h, u = x / w;
      const lat = (0.5 - v) * Math.PI;
      const band = 0.985 + 0.015 * Math.sin(lat * 7) + (fbm(u, v, 3, 8, 301) - 0.5) * 0.01;
      const polar = 1 + 0.04 * Math.pow(Math.abs(Math.sin(lat)), 4); // 極區稍亮（Voyager/HST 觀測到的南極帽）
      const i = (y * w + x) * 4;
      data[i] = 0.62 * 255 * band * polar; data[i + 1] = 0.80 * 255 * band * polar; data[i + 2] = 0.86 * 255 * band; data[i + 3] = 255;
    }
  });
}

// 太陽米粒組織用的 3D 雜訊改在著色器中生成，此處不需要貼圖

// 土星環：1D 徑向剖面 → RGBA（RGB 反照率、A 光學厚度）
// 半徑（km）：D 66,900–74,510；C 74,658–92,000；B 92,000–117,580；卡西尼縫 117,580–122,170；
// A 122,170–136,775（恩克縫 133,589 寬 325；基勒縫 136,505 寬 35）；F 140,180（寬 ~30–500）
export function makeSaturnRingTexture(inner, outer, n = 4096) {
  const c = document.createElement('canvas'); c.width = n; c.height = 1;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(n, 1);
  const rng = makeRng(42);
  const fine = new Float32Array(n);
  for (let i = 0; i < n; i++) fine[i] = rng();
  for (let i = 0; i < n; i++) {
    const r = inner + (outer - inner) * (i + 0.5) / n;
    let tau = 0, col = [0.80, 0.72, 0.60];
    const ring = (a, b, t0, t1, cR, cG, cB) => { if (r >= a && r < b) { const f = (r - a) / (b - a); tau = t0 + (t1 - t0) * f; col = [cR, cG, cB]; } };
    ring(66900, 74510, 0.02, 0.06, 0.6, 0.58, 0.55);      // D 環（極暗）
    ring(74658, 84000, 0.08, 0.12, 0.62, 0.60, 0.58);     // C 環內側
    ring(84000, 92000, 0.12, 0.25, 0.66, 0.63, 0.60);     // C 環外側
    ring(92000, 99000, 0.9, 1.4, 0.86, 0.78, 0.66);       // B 環內
    ring(99000, 110000, 1.4, 2.2, 0.88, 0.80, 0.68);      // B 環中（最厚）
    ring(110000, 117580, 1.6, 1.0, 0.85, 0.77, 0.64);     // B 環外
    ring(117580, 122170, 0.05, 0.12, 0.6, 0.58, 0.55);    // 卡西尼縫（含細環）
    ring(122170, 133589 - 162, 0.55, 0.65, 0.82, 0.75, 0.63); // A 環內
    ring(133589 - 162, 133589 + 162, 0.0, 0.0, 0, 0, 0);  // 恩克縫
    ring(133589 + 162, 136505 - 17, 0.6, 0.45, 0.80, 0.73, 0.61); // A 環外
    ring(136505 - 17, 136505 + 17, 0.0, 0.0, 0, 0, 0);    // 基勒縫
    ring(136505 + 17, 136775, 0.45, 0.3, 0.78, 0.71, 0.60);
    ring(136775, 139900, 0.0, 0.0, 0, 0, 0);
    ring(139900, 140500, 0.0, 0.0, 0, 0, 0);
    if (Math.abs(r - 140180) < 60) { tau = 0.25 * (1 - Math.abs(r - 140180) / 60); col = [0.75, 0.70, 0.62]; } // F 環
    // 細結構（B/A 環內的密度波與小縫）：以 1D 雜訊調變
    const k = Math.floor(i / 3), f1 = fine[k % n], f2 = fine[(k * 7 + 13) % n];
    tau *= 0.72 + 0.56 * (0.6 * f1 + 0.4 * f2);
    if (r > 92000 && r < 117580 && f2 > 0.985) tau *= 0.25; // B 環內偶發細縫
    const alpha = 1 - Math.exp(-tau);
    img.data[i * 4] = col[0] * 255; img.data[i * 4 + 1] = col[1] * 255; img.data[i * 4 + 2] = col[2] * 255; img.data[i * 4 + 3] = alpha * 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  return tex;
}

// 天王星環：暗、窄（ε 環 51,149 km 寬 20–100 km；其餘 6、5、4、α、β、η、γ、δ 環）
export function makeUranusRingTexture(inner, outer, n = 2048) {
  const c = document.createElement('canvas'); c.width = n; c.height = 1;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(n, 1);
  const rings = [[41837, 2, 0.3], [42234, 2, 0.4], [42570, 2, 0.3], [44718, 7, 0.4], [45661, 8, 0.4], [47175, 2, 0.3], [47627, 3, 0.5], [48300, 5, 0.4], [51149, 60, 0.9]];
  for (let i = 0; i < n; i++) {
    const r = inner + (outer - inner) * (i + 0.5) / n;
    let a = 0;
    for (const [rc, wdt, t] of rings) { const hw = Math.max(wdt, (outer - inner) / n * 1.5); if (Math.abs(r - rc) < hw) a = Math.max(a, t * (1 - Math.abs(r - rc) / hw)); }
    img.data[i * 4] = 60; img.data[i * 4 + 1] = 58; img.data[i * 4 + 2] = 56; img.data[i * 4 + 3] = a * 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// 系外行星：依類型生成（全部為推測外觀）
export function makeExoplanetTexture(kind, seed, w = 1024, h = 512) {
  return canvasTexture(w, h, (data) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h, lat = (0.5 - v) * Math.PI;
      let r, g, b;
      if (kind === 'hot-jupiter') {
        const band = fbm(u * 0.3, v, 4, 5, seed) * 0.5 + Math.sin(lat * 9 + fbm(u, v, 3, 6, seed + 3) * 2) * 0.25;
        r = 0.45 + band * 0.35; g = 0.25 + band * 0.2; b = 0.15 + band * 0.1;
      } else if (kind === 'gas-giant') {
        const band = fbm(u * 0.25, v, 5, 6, seed) * 0.6 + Math.sin(lat * 11 + fbm(u, v, 3, 5, seed + 5) * 2.5) * 0.2;
        r = 0.6 + band * 0.25; g = 0.55 + band * 0.22; b = 0.45 + band * 0.15;
      } else if (kind === 'ice-giant') {
        const band = (fbm(u * 0.3, v, 4, 6, seed) - 0.5) * 0.08;
        r = 0.35 + band; g = 0.55 + band; b = 0.85 + band * 0.5;
      } else if (kind === 'lava') {
        const n = fbm(u, v, 6, 8, seed);
        const crack = Math.pow(Math.max(0, 1 - Math.abs(n - 0.5) * 9), 3);
        r = 0.2 + crack * 0.9 + n * 0.1; g = 0.08 + crack * 0.35; b = 0.05 + crack * 0.05;
      } else if (kind === 'ice') {
        const n = fbm(u, v, 6, 8, seed);
        r = 0.75 + n * 0.2; g = 0.78 + n * 0.18; b = 0.85 + n * 0.12;
      } else { // rocky / unknown：中性灰褐，不暗示海洋或植被
        const n = fbm(u, v, 6, 7, seed), n2 = fbm(u, v, 4, 30, seed + 9);
        const l = 0.35 + (n - 0.5) * 0.3 + (n2 - 0.5) * 0.08;
        r = l * 1.05; g = l * 0.95; b = l * 0.85;
      }
      const i = (y * w + x) * 4;
      data[i] = Math.max(0, Math.min(255, r * 255)); data[i + 1] = Math.max(0, Math.min(255, g * 255)); data[i + 2] = Math.max(0, Math.min(255, b * 255)); data[i + 3] = 255;
    }
  });
}

// 深空天體示意（星系／星雲／星團）→ 2D sprite 貼圖，透明背景
export function makeDsoSprite(type, seed, size = 512) {
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(size, size);
  const rng = makeRng(seed);
  const spiral = type === 'G' || type === 'GPair' || type === 'GTrpl' || type === 'GGroup';
  const cluster = type === 'OCl' || type === 'GCl' || type === '*Ass';
  if (cluster) {
    const n = type === 'GCl' ? 2500 : 120;
    for (let k = 0; k < n; k++) {
      const rr = type === 'GCl' ? Math.pow(rng(), 2.5) * 0.48 : Math.pow(rng(), 0.8) * 0.45;
      const a = rng() * Math.PI * 2;
      const x = Math.floor((0.5 + rr * Math.cos(a)) * size), y = Math.floor((0.5 + rr * Math.sin(a)) * size);
      const br = type === 'GCl' ? 0.35 + rng() * 0.5 : 0.5 + rng() * 0.5;
      const rad = type === 'GCl' ? 1 : 1 + Math.floor(rng() * 2);
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const f = Math.max(0, 1 - Math.hypot(dx, dy) / (rad + 0.5)) * br;
        const i = (yy * size + xx) * 4;
        img.data[i] = Math.min(255, img.data[i] + 255 * f); img.data[i + 1] = Math.min(255, img.data[i + 1] + 245 * f);
        img.data[i + 2] = Math.min(255, img.data[i + 2] + 225 * f); img.data[i + 3] = Math.min(255, img.data[i + 3] + 255 * f);
      }
    }
  } else {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5, dy = (y + 0.5) / size - 0.5;
      const r = Math.hypot(dx, dy) * 2, ang = Math.atan2(dy, dx);
      let I = 0, cr = 1, cg = 0.95, cb = 0.9;
      if (spiral) {
        const bulge = Math.exp(-r * r * 18) * 1.2;
        const disk = Math.exp(-r * 3.2) * (r < 1 ? 1 : 0);
        const arms = 0.5 + 0.5 * Math.cos(2 * ang - 5.5 * Math.log(r + 0.08) + seed % 7);
        const n = fbm(x / size, y / size, 4, 8, seed);
        I = bulge + disk * (0.45 + 0.75 * Math.pow(arms, 2.5) * (0.5 + n)) * 0.8;
        const armness = Math.pow(arms, 2) * disk;
        cr = 1.0 - armness * 0.25; cg = 0.92 - armness * 0.1; cb = 0.8 + armness * 0.35;
      } else if (type === 'PN') {
        const shell = Math.exp(-Math.pow((r - 0.55) / 0.12, 2)) * 1.1 + Math.exp(-r * r * 30) * 0.3;
        const n = fbm(x / size, y / size, 4, 10, seed);
        I = shell * (0.6 + 0.6 * n); cr = 0.5; cg = 0.9; cb = 0.8;
      } else { // Neb / HII / Cl+N / SNR 等
        const n = fbm(x / size, y / size, 6, 6, seed), n2 = fbm(x / size, y / size, 5, 14, seed + 1);
        const env = Math.exp(-r * r * 3.5);
        I = env * Math.pow(Math.max(0, n - 0.3) * 1.6, 1.6) * 1.5 + env * n2 * 0.2;
        cr = 1.0; cg = 0.45 + n2 * 0.4; cb = 0.55 + n * 0.3;
        if (type === 'RfN') { cr = 0.6; cg = 0.75; cb = 1.0; }
      }
      const edge = Math.max(0, 1 - Math.pow(r, 6));
      I = Math.min(1, I) * edge;
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, cr * I * 255); img.data[i + 1] = Math.min(255, cg * I * 255); img.data[i + 2] = Math.min(255, cb * I * 255); img.data[i + 3] = Math.min(255, I * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 亮星／天體的點光暈 sprite
export function makeGlowSprite(size = 128) {
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.08, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.25)'); g.addColorStop(0.6, 'rgba(255,255,255,0.04)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
