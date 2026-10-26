#!/usr/bin/env node
// 離線單元測試：地球分塊 LOD 的經度索引與 UV 對應（不需 GPU）。
// 1) 補丁改寫後的全球 UV 必須等於完整 SphereGeometry 在同一位置的 UV（U = phi/2π，V = 1 - theta/π）。
// 2) 來源圖分塊慣例：x = floor(((lon+180)/360)·nx)；台灣 121°E → L2 x=6、東京 139.7°E → 7、聖保羅 46.6°W → 2。
// 3) 由球面點反推的塊索引（earthlod.update 的 hitKeys 公式）必須與 (2) 一致，含 ±180° 接縫與 0°。
// 用法：node tools/test_earthlod_index.mjs
import * as THREE from '../vendor/three/three.module.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const TWO_PI = Math.PI * 2;

// --- (1) 補丁全球 UV 與完整球面一致
const full = new THREE.SphereGeometry(1, 64, 32);
const fp = full.attributes.position, fu = full.attributes.uv;
for (const [nx, ny, segs] of [[4, 2, 16], [8, 4, 8]]) {
  let maxErr = 0, n = 0;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const phiStart = (x / nx) * TWO_PI, phiLen = TWO_PI / nx, thStart = (y / ny) * Math.PI, thLen = Math.PI / ny;
    const g = new THREE.SphereGeometry(1, segs, segs, phiStart, phiLen, thStart, thLen);
    const uv = g.attributes.uv, pos = g.attributes.position;
    for (let i = 0; i < uv.count; i++) {
      const ug = (x + uv.getX(i)) / nx, vg = 1 - (y + (1 - uv.getY(i))) / ny; // earthlod._ensurePatches 的改寫
      // 解析值：SphereGeometry 的 x=-cos(phi)sin(th), z=sin(phi)sin(th), y=cos(th)；完整球面 uv = (phi/2π, 1-th/π)
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
      const th = Math.acos(Math.max(-1, Math.min(1, py)));
      if (Math.sin(th) < 1e-6) { continue; } // 極點 U 不定
      let phi = Math.atan2(pz, -px); if (phi < 0) phi += TWO_PI;
      let du = Math.abs(ug - phi / TWO_PI); du = Math.min(du, 1 - du); // 接縫 0/1 等價
      const dv = Math.abs(vg - (1 - th / Math.PI));
      maxErr = Math.max(maxErr, du, dv); n++;
    }
  }
  ok(maxErr < 1e-5, `補丁全球 UV 與完整球面一致（${nx}×${ny}，${n} 個頂點，最大誤差 ${maxErr.toExponential(2)}）`);
}
// 完整球面本身：U = phi/2π（不是 1 - phi/2π）
{
  let maxErr = 0;
  for (let i = 0; i < fu.count; i++) {
    const px = fp.getX(i), py = fp.getY(i), pz = fp.getZ(i); const th = Math.acos(Math.max(-1, Math.min(1, py))); if (Math.sin(th) < 1e-6) continue;
    let phi = Math.atan2(pz, -px); if (phi < 0) phi += TWO_PI;
    let du = Math.abs(fu.getX(i) - phi / TWO_PI); du = Math.min(du, 1 - du); maxErr = Math.max(maxErr, du);
  }
  ok(maxErr < 1e-5, `three.js SphereGeometry：U = phi/2π（最大誤差 ${maxErr.toExponential(2)}）`);
}

// --- (2) 來源圖慣例：等距柱狀 U = (lon+180)/360；塊 x 由西向東
const tileX = (lon, nx) => Math.min(nx - 1, Math.floor(((lon + 180) / 360) * nx));
ok(tileX(121.0, 8) === 6, '台灣 121°E → L2 x=6');
ok(tileX(139.7, 8) === 7, '東京 139.7°E → L2 x=7');
ok(tileX(-46.6, 8) === 2, '聖保羅 46.6°W → L2 x=2');
ok(tileX(121.0, 4) === 3 && tileX(-46.6, 4) === 1, 'L1 對應 x=3／x=1');

// --- (3) 由球面點反推（earthlod.update 的 hitKeys）：點的經度 lon 在物件空間對應 phi = 2π·U（U=(lon+180)/360）
// 地球貼圖 U=(lon+180)/360 貼在 phi=2π·U 的子午線上（與 (1) 的 U=phi/2π 一致），因此由 phi 反推必得同一塊
const hitX = (lon, nx) => { const U = (lon + 180) / 360; const phi = TWO_PI * U; const px = -Math.cos(phi), pz = Math.sin(phi); let p = Math.atan2(pz, -px); if (p < 0) p += TWO_PI; return Math.min(nx - 1, Math.floor(p / TWO_PI * nx)); };
for (const [lon, name] of [[121.0, '台灣'], [139.7, '東京'], [-46.6, '聖保羅'], [0, '格林威治'], [179.9, '179.9°E'], [-179.9, '179.9°W'], [-180, '180°W'], [45, '45°E'], [-90, '90°W']]) {
  ok(hitX(lon, 8) === tileX(lon, 8), `視線命中反推 ${name}（${lon}°）→ x=${hitX(lon, 8)} 與來源塊一致`);
}
ok(tileX(179.9, 8) === 7 && tileX(-179.9, 8) === 0, '±180° 接縫分屬 x=7 與 x=0');

console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
