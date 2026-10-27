#!/usr/bin/env node
// 開場構圖的投影／viewport 量測（回應 GPT 2026-10-27 02:12 稽核：手機直向盤面被 maxR 鉗制而裁切、「85%」文案不符）。
// 對多種視窗（桌面、iPhone 直／橫、Pixel 7 直／橫、iPad 直向）載入開場，量測：
//  - 距地心距離（R）、地球視半徑、盤面投影在螢幕窄邊／寬邊的占比（>100% 即被裁切）、左右／上下輪廓是否入鏡；
//  - 台灣地表點是否在畫面中央且未被 HUD 元素蓋住（elementFromPoint）；
//  - 存每個視窗的開場截圖到 docs/screens/opening-frame-<名稱>.jpg 供 GPT 決策。
// 只斷言「台灣在中央且可見、無錯誤」；盤面占比只量測並列印（完整盤面或刻意裁切由 GPT 決定規格後再加斷言）。
// 用法：node tools/opening_frame_test.mjs [baseURL]
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process'; import path from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const base = process.argv[2] || 'http://127.0.0.1:8123/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const mobile = (w, h, dpr) => ({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
const cases = [
  { name: 'desktop-1400x860', ctx: { viewport: { width: 1400, height: 860 } } },
  { name: 'iphone-portrait-390x844', ctx: mobile(390, 844, 3) },
  { name: 'iphone-landscape-844x390', ctx: mobile(844, 390, 3) },
  { name: 'pixel7-portrait-412x915', ctx: mobile(412, 915, 2.625) },
  { name: 'pixel7-landscape-915x412', ctx: mobile(915, 412, 2.625) },
  { name: 'ipad-portrait-820x1180', ctx: mobile(820, 1180, 2) },
];
const rows = [];
for (const c of cases) {
  const ctx = await browser.newContext(c.ctx); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push('pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/TUNNEL|Failed to load resource|favicon/.test(m.text())) errs.push(m.text().slice(0, 160)); });
  await page.clock.setSystemTime('2026-10-27T04:00:00Z'); // 台灣正午，盤面受光便於目視
  await page.goto(`${base}?quality=low`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
  const r = await page.evaluate(async () => {
    const THREE = await import('three'); const A = await import('./js/astro.js');
    const n = window.__ndf; const e = n.engine.bodies.get('earth'); const cam = n.engine.camPos; const R = 6371.0;
    const rel = new THREE.Vector3(e.pos[0] - cam[0], e.pos[1] - cam[1], e.pos[2] - cam[2]); const d = rel.length();
    const camera = n.engine.camera.clone(); camera.position.set(0, 0, 0); camera.quaternion.copy(n.engine.camQuat); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
    const proj = (v) => { const p = v.clone().project(camera); return { x: p.x, y: p.y, z: p.z }; };
    // 地球輪廓（切線圓）：從相機看的視半徑 α = asin(R/d)，輪廓點位於相機到地心方向偏 α 的錐面上
    const alpha = Math.asin(R / d); const axis = rel.clone().normalize();
    const anyV = Math.abs(axis.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(axis, anyV).normalize(); const v = new THREE.Vector3().crossVectors(axis, u).normalize();
    let maxX = 0, maxY = 0; const limbD = Math.sqrt(d * d - R * R);
    for (let i = 0; i < 360; i++) { const t = i * Math.PI / 180; const dir = axis.clone().multiplyScalar(Math.cos(alpha)).add(u.clone().multiplyScalar(Math.sin(alpha) * Math.cos(t))).add(v.clone().multiplyScalar(Math.sin(alpha) * Math.sin(t))); const p = proj(dir.multiplyScalar(limbD)); maxX = Math.max(maxX, Math.abs(p.x)); maxY = Math.max(maxY, Math.abs(p.y)); }
    const ax = { xb: e.axes.xb.toArray(), yb: e.axes.yb.toArray(), zb: e.axes.zb.toArray() };
    const td = A.geoToWorldDir(ax, 23.7, 121.0); const tw = proj(new THREE.Vector3(e.pos[0] + td[0] * R - cam[0], e.pos[1] + td[1] * R - cam[1], e.pos[2] + td[2] * R - cam[2]));
    const W = innerWidth, H = innerHeight; const px = (W / 2) * (1 + tw.x), py = (H / 2) * (1 - tw.y);
    const el = document.elementFromPoint(px, py); const covered = el && el.tagName !== 'CANVAS' ? `${el.tagName.toLowerCase()}#${el.id || ''}.${[...el.classList].join('.')}` : null;
    const aspect = W / H; const halfV = camera.fov * Math.PI / 360, halfH = Math.atan(Math.tan(halfV) * aspect);
    return { W, H, aspect, fov: camera.fov, distR: d / R, alphaDeg: alpha * 180 / Math.PI, discX: maxX, discY: maxY, discNarrow: aspect < 1 ? maxX : maxY, needFullR: 1 / Math.sin(Math.min(halfV, halfH) * 0.85), taiwan: { x: tw.x, y: tw.y }, covered, hudOpaque: covered && getComputedStyle(el).pointerEvents !== 'none' };
  });
  rows.push({ name: c.name, ...r });
  console.log(c.name, JSON.stringify({ aspect: +r.aspect.toFixed(3), fov: r.fov, distR: +r.distR.toFixed(2), alphaDeg: +r.alphaDeg.toFixed(1), discNarrowPct: Math.round(r.discNarrow * 100), discWidePct: Math.round((r.aspect < 1 ? r.discY : r.discX) * 100), need85R: +r.needFullR.toFixed(2), taiwan: { x: +r.taiwan.x.toFixed(3), y: +r.taiwan.y.toFixed(3) }, covered: r.covered }));
  ok(Math.abs(r.taiwan.x) < 0.05 && Math.abs(r.taiwan.y) < 0.05, `${c.name}：台灣在畫面中央`);
  ok(!r.covered || !r.hudOpaque, `${c.name}：台灣未被會攔截點擊的 HUD 元素蓋住${r.covered ? `（上方元素 ${r.covered}，pointer-events none）` : ''}`);
  await page.waitForTimeout(9000); await page.screenshot({ path: `docs/screens/opening-frame-${c.name}.jpg`, type: 'jpeg', quality: 75 });
  ok(errs.length === 0, `${c.name}：console／page 錯誤 0${errs.length ? '：' + errs.join(' | ') : ''}`);
  await ctx.close();
}
console.log('\n| 視窗 | 長寬比 | 距地心 | 視半徑 | 盤面／窄邊 | 盤面／寬邊 | 85% 完整盤面需要 |');
console.log('|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.name} | ${r.aspect.toFixed(2)} | ${r.distR.toFixed(2)} R | ${r.alphaDeg.toFixed(1)}° | ${Math.round(r.discNarrow * 100)}% | ${Math.round((r.aspect < 1 ? r.discY : r.discX) * 100)}% | ${r.needFullR.toFixed(2)} R |`);
await browser.close();
console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
