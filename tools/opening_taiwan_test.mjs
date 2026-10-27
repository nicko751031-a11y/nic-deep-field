#!/usr/bin/env node
// 開場鏡頭驗證：每次載入都以看得到台灣為起始（負責人 2026-10-27 指示）。
// 在桌面 1400×860 與 iPhone 390×844（DPR 3）兩種視窗、三個不同模擬時刻載入頁面，驗證：
//  1) 鏡頭正下方（nadir）的經緯度 = 台灣（23.7°N, 121°E，容許 0.5°）；2) 鏡頭朝向地心、北極朝上；
//  3) 距地心依長寬比 2.4–3.6 R（盤面佔較窄方向視角 85%）；4) 台灣投影落在畫面中央；5) 自動環繞中；6) 無 console／page 錯誤。並存一張開場截圖。
// 用法：node tools/opening_taiwan_test.mjs [baseURL]
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process'; import path from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const base = process.argv[2] || 'http://127.0.0.1:8123/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const cases = [
  { name: 'desktop', ctx: { viewport: { width: 1400, height: 860 } } },
  { name: 'iphone', ctx: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
];
// 用不同的「現在」載入（台灣白天／夜晚／晨昏），確認與時刻無關
const clocks = ['2026-10-27T04:00:00Z', '2026-10-27T16:00:00Z', '2026-01-15T22:30:00Z'];
for (const c of cases) for (const clock of clocks) {
  const ctx = await browser.newContext(c.ctx); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push('pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/TUNNEL|Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 160)); });
  await page.clock.setSystemTime(clock);
  await page.goto(`${base}?quality=low`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
  const r = await page.evaluate(async () => {
    const n = window.__ndf; const e = n.engine.bodies.get('earth'); const cam = n.engine.camPos;
    const rel = [cam[0] - e.pos[0], cam[1] - e.pos[1], cam[2] - e.pos[2]]; const d = Math.hypot(...rel); const u = rel.map((x) => x / d);
    const dot = (a, b) => a[0] * b.x + a[1] * b.y + a[2] * b.z;
    const lx = dot(u, e.axes.xb), ly = dot(u, e.axes.yb), lz = dot(u, e.axes.zb);
    const lat = Math.asin(Math.max(-1, Math.min(1, ly))) * 180 / Math.PI, lon = Math.atan2(-lz, lx) * 180 / Math.PI;
    // 鏡頭朝向：-Z／+Y 轉到世界座標
    const THREE = await import('three'); const q = n.engine.camQuat;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q), U = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const toCenter = -(f.x * u[0] + f.y * u[1] + f.z * u[2]);
    const northUp = U.dot(e.axes.yb);
    // 預期距離：盤面佔較窄方向視角 85%，限制 2.4–3.6 R
    const halfV = n.engine.camera.fov * Math.PI / 360, halfH = Math.atan(Math.tan(halfV) * n.engine.camera.aspect);
    const want = Math.min(3.6, Math.max(2.4, 1 / Math.sin(Math.min(halfV, halfH) * 0.85)));
    return { lat, lon, distR: d / 6371.0, want, aspect: n.engine.camera.aspect, toCenter, northUp, orbit: !!n.controls.orbit, orbitKey: n.controls.orbit?.key, locked: n.controls.orbit?.lookLocked !== false, timeRate: n.engine.timeRate };
  });
  // 台灣地表點在畫面上的位置：以 three 的 project 在頁面內算
  const proj = await page.evaluate(async () => {
    const A = await import('./js/astro.js'); const THREE = await import('three');
    const n = window.__ndf; const e = n.engine.bodies.get('earth'); const ax = { xb: e.axes.xb.toArray(), yb: e.axes.yb.toArray(), zb: e.axes.zb.toArray() };
    const d = A.geoToWorldDir(ax, 23.7, 121.0); const R = 6371.0; const cam = n.engine.camPos;
    const p = new THREE.Vector3(e.pos[0] + d[0] * R - cam[0], e.pos[1] + d[1] * R - cam[1], e.pos[2] + d[2] * R - cam[2]);
    const camera = n.engine.camera.clone(); camera.position.set(0, 0, 0); camera.quaternion.copy(n.engine.camQuat); camera.updateMatrixWorld();
    p.project(camera); return { x: p.x, y: p.y, z: p.z };
  });
  const tag = `${c.name} @${clock}`;
  console.log(tag, JSON.stringify({ lat: +r.lat.toFixed(2), lon: +r.lon.toFixed(2), distR: +r.distR.toFixed(3), toCenter: +r.toCenter.toFixed(4), northUp: +r.northUp.toFixed(3), proj: { x: +proj.x.toFixed(3), y: +proj.y.toFixed(3) } }));
  ok(Math.abs(r.lat - 23.7) < 0.5 && Math.abs(((r.lon - 121 + 540) % 360) - 180) < 0.5, `${tag}：鏡頭正下方 = 台灣（${r.lat.toFixed(2)}°, ${r.lon.toFixed(2)}°）`);
  ok(r.toCenter > 0.9999, `${tag}：鏡頭朝向地心（cos ${r.toCenter.toFixed(5)}）`);
  ok(r.northUp > 0.85, `${tag}：北極朝上（${r.northUp.toFixed(3)}）`);
  ok(Math.abs(r.distR - r.want) < 0.02, `${tag}：距地心 ${r.distR.toFixed(3)} R（長寬比 ${r.aspect.toFixed(2)} 預期 ${r.want.toFixed(3)} R）`);
  ok(Math.abs(proj.x) < 0.05 && Math.abs(proj.y) < 0.05 && proj.z < 1, `${tag}：台灣投影在畫面中央（${proj.x.toFixed(3)}, ${proj.y.toFixed(3)}）`);
  ok(r.orbit && r.orbitKey === 'earth' && r.locked, `${tag}：自動環繞地球、鏡頭鎖定地心`);
  ok(r.timeRate === 1, `${tag}：時間倍率 = 即時`);
  if (clock === clocks[0]) { await page.waitForTimeout(9000); await page.screenshot({ path: `docs/screens/00-opening${c.name === 'iphone' ? '-iphone' : ''}.jpg`, type: 'jpeg', quality: 80 }); } // 淡入（軟體繪圖下較慢）後再存參考截圖
  ok(errs.length === 0, `${tag}：console／page 錯誤 0${errs.length ? '：' + errs.join(' | ') : ''}`);
  await ctx.close();
}
await browser.close();
console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
