#!/usr/bin/env node
// 以 iPhone 尺寸（390×844、DPR 3、畫質高）在錄影的時刻（2026-10-26 23:20 UTC）與高度（16,594 km）繞地球 8 個方位截圖，
// 供比對「黑色扇形」是否為正常日夜相位：輸出 docs/screens/iphone-sim-orbit-<deg>.jpg 與各角度的夜側佔比。
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process'; import path from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const base = process.argv[2] || 'http://127.0.0.1:8123/'; const out = process.argv[3] || 'docs/screens';
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
await page.goto(`${base}?quality=high`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
await page.evaluate(() => { const n = window.__ndf; n.controls.stop(); n.engine.breath = false; n.engine.timeRate = 0; n.engine.simTime = Date.parse('2026-10-26T23:20:00Z'); n.engine.update(0); document.getElementById('btn-hide').click(); document.getElementById('title-card').classList.remove('show'); });
for (let i = 0; i < 8; i++) {
  const lon = i * 45;
  await page.evaluate((l) => window.__ndf.testPlaceOver(10, l, 16594), lon); await page.waitForTimeout(1500);
  const f = path.join(out, `iphone-sim-orbit-${String(lon).padStart(3, '0')}.jpg`);
  await page.screenshot({ path: f, type: 'jpeg', quality: 70 });
  const r = await page.evaluate(() => { const e = window.__ndf.engine; const c = e.coverageSelfTest(0.3); const s = e.scanNonFinite(0.3); return { disc: c.lodPixels, holes: c.holes, luma: s.meanLuma }; });
  console.log(`lon ${lon}: disc ${r.disc} px, holes ${r.holes}, meanLuma ${r.luma.toFixed(4)} → ${f}`);
}
await browser.close();
