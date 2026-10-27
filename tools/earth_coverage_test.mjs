#!/usr/bin/env node
// 地球球面覆蓋自檢（回應 iPhone 錄影「黑色扇形／缺面」A2）：以 iPhone 尺寸（390×844、DPR 3、畫質高）在多個軌道方位、
// 兩個高度（16,594 km＝錄影條件、2,000 km）量測「目前 LOD 層補丁」對「L0 本體」的白色像素比值；缺塊會使比值明顯 < 1。
// 另在相同方位比對 ?nolod=1。純幾何量測，不受日夜相位影響。用法：node tools/earth_coverage_test.mjs [baseURL]
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process'; import path from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const base = process.argv[2] || 'http://127.0.0.1:8123/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push('pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/TUNNEL|Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 160)); });
await page.goto(`${base}?quality=high`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
await page.evaluate(() => { const n = window.__ndf; n.controls.stop(); n.engine.breath = false; n.engine.timeRate = 0; n.engine.simTime = Date.parse('2026-10-26T23:20:00Z'); n.engine.update(0); });
const pr = await page.evaluate(() => window.__ndf.engine.renderer.getPixelRatio()); console.log('pixelRatio', pr);
const views = [];
for (const alt of [16594, 2000]) for (let i = 0; i < 12; i++) views.push({ alt, lat: [0, 35, -35, 70][i % 4], lon: i * 30 });
let minRatio = 1, worst = null; const rows = [];
for (const v of views) {
  await page.evaluate(([lat, lon, alt]) => window.__ndf.testPlaceOver(lat, lon, alt), [v.lat, v.lon, v.alt]);
  await page.waitForTimeout(800);
  // 等 LOD 穩定（載入完成）
  await page.waitForFunction(() => { const l = window.__ndf.engine.earthLod; return !l || l.loading === 0; }, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => { const e = window.__ndf.engine; e.update(0); return e.coverageSelfTest(0.3); });
  rows.push({ ...v, ...r }); if (r && r.ratio < minRatio) { minRatio = r.ratio; worst = { ...v, ...r }; }
  console.log(`alt ${v.alt} lat ${v.lat} lon ${v.lon}: L${r.level} lod ${r.lodPixels} base ${r.basePixels} ratio ${r.ratio.toFixed(3)} holes ${r.holes}`);
}
const maxHole = Math.max(...rows.map((r) => r.holeFraction || 0)); ok(maxHole < 0.005, `24 個方位盤面內黑洞像素最高 ${(maxHole * 100).toFixed(2)}%（凸形掃描）`);
ok(minRatio >= 0.98, `24 個方位最低覆蓋比值 ${minRatio.toFixed(3)}${worst ? `（高度 ${worst.alt} km，lat ${worst.lat}，lon ${worst.lon}，L${worst.level}）` : ''}`);
const lv = rows.filter((r) => r.alt === 16594).map((r) => r.level); ok(lv.every((l) => l === lv[0]), `16,594 km 各方位層級一致（L${lv[0]}）`);
await page.evaluate(() => window.__ndf.testPlaceOver(23.7, 121, 16594)); await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/claude-0/coverage-iphone-16594.png' });
const scan = await page.evaluate(() => window.__ndf.engine.scanNonFinite(0.3)); ok(scan.bad === 0, `非有限值像素 ${scan.bad}`);
console.log('shaderErrors', await page.evaluate(() => window.__ndf.engine.shaderErrors.length));
ok(errs.length === 0, `console／page 錯誤 0${errs.length ? '：' + errs.join(' | ') : ''}`);
await browser.close();
console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
