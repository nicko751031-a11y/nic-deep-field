#!/usr/bin/env node
// 黑洞畫面的軟體繪圖 fps（相對比較用）：固定視角、速度 0、HUD 隱藏，數 rAF 幀數 / 秒。用法：node bhfps.mjs <baseURL> [秒] [寬 高] [quality]
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process'; import path from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const base = process.argv[2]; const secs = +(process.argv[3] || 30); const W = +(process.argv[4] || 640), H = +(process.argv[5] || 360); const q = process.argv[6] || 'medium'; const fixedSteps = +(process.argv[7] || 0);
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.goto(`${base}?quality=${q}`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done') && !!window.__ndf?.controls, null, { timeout: 180000 });
await page.waitForTimeout(3000);
await page.evaluate(async () => { const cat = window.__ndf.catalog; await window.__ndf.goTo(cat.entries.find((x) => x.kind === 'bh'), { instant: true }); window.__ndf.controls.stop(); document.getElementById('hud').style.visibility = 'hidden'; document.getElementById('title-card')?.classList.remove('show'); });
await page.waitForTimeout(6000);
if (fixedSteps) await page.evaluate((n) => { const u = window.__ndf.engine.bhMat.uniforms.uSteps; Object.defineProperty(u, 'value', { get: () => n, set: () => {} }); }, fixedSteps);
await page.waitForTimeout(3000);
const r = await page.evaluate(async (secs) => { let n = 0; const orig = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => orig((t) => { n++; cb(t); }); const t0 = performance.now(); await new Promise((res) => setTimeout(res, secs * 1000)); const dt = (performance.now() - t0) / 1000; return { rafFrames: n, secs: +dt.toFixed(1), fps: +(n / dt).toFixed(2), msPerFrame: +(dt * 1000 / Math.max(n, 1)).toFixed(0) }; }, secs);
console.log(JSON.stringify({ base, W, H, q, fixedSteps, ...r }));
await browser.close();
