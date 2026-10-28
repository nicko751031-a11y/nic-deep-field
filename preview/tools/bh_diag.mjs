#!/usr/bin/env node
// 黑洞細環成因分離（GPT 第四輪審查用）：同一視角、速度 0，依序截圖「現況／時間凍結 0 秒／凍結 300 秒／關吸積盤／關 Bloom」，
// 並記錄每幀時間（軟體繪圖下不代表真機）、JS heap、GPU 字串。用法：node tools/bh_diag.mjs <baseURL> <輸出目錄> [寬 高 DPR] [all|now] [low|medium|high]
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process'; import path from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const base = process.argv[2]; const out = process.argv[3]; const W = +(process.argv[4] || 1280), H = +(process.argv[5] || 720); const dpr = +(process.argv[6] || 1);
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: dpr });
page.on('console', (m) => { if (m.type() === 'error') console.log('console.error', m.text().slice(0, 200)); });
await page.goto(`${base}?quality=${process.argv[8] || "medium"}`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done') && !!window.__ndf?.controls, null, { timeout: 180000 });
await page.waitForTimeout(4000);
await page.evaluate(async () => { const cat = window.__ndf.catalog; await window.__ndf.goTo(cat.entries.find((x) => x.kind === 'bh'), { instant: true }); window.__ndf.controls.stop(); document.getElementById('hud').style.visibility = 'hidden'; document.getElementById('title-card')?.classList.remove('show'); });
await page.waitForTimeout(3000);
const settle = async (n = 4) => { const f0 = await page.evaluate(() => window.__ndf.engine.renderer.info.render.frame); await page.waitForFunction((f) => window.__ndf.engine.renderer.info.render.frame >= f, f0 + n, { timeout: 180000 }); };
// 每幀時間：量 3 幀的牆鐘時間（軟體繪圖，只供相對比較）；記憶體取 performance.memory（Chromium 專有）
const frameMs = () => page.evaluate(async () => { const r = window.__ndf.engine.renderer; const f0 = r.info.render.frame, t0 = performance.now(); await new Promise((res) => { const tick = () => (r.info.render.frame >= f0 + 3 ? res() : setTimeout(tick, 50)); tick(); }); const ms = (performance.now() - t0) / 3; const m = performance.memory; return { ms: +ms.toFixed(0), heapMB: m ? +(m.usedJSHeapSize / 1048576).toFixed(0) : null, gpu: r.getContext().getParameter(r.getContext().getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL || 0x1F01) }; });
const shot = async (name) => { await settle(); await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 92, timeout: 240000 }); console.log('shot', name, JSON.stringify(await page.evaluate(() => ({ t: +window.__ndf.engine.elapsed.toFixed(1), quality: window.__ndf.engine.quality }))), JSON.stringify(await frameMs())); };
const mode = process.argv[7] || "all";
await shot('bh-now');
if (mode === 'all') {
  // 時間凍結在 0：排除克卜勒剪切纏繞
  await page.evaluate(() => { const e = window.__ndf.engine; e.__bhFreeze = true; const u = e.bhMat.uniforms; Object.defineProperty(u.uTime, 'value', { get: () => 0, set: () => {} }); });
  await shot('bh-t0');
  // 時間凍結在 300 秒：剪切纏繞到極限
  await page.evaluate(() => { const u = window.__ndf.engine.bhMat.uniforms; Object.defineProperty(u.uTime, 'value', { get: () => 300, set: () => {} }); });
  await shot('bh-t300');
  // 盤面關閉：只剩光子環與背景
  await page.evaluate(() => { const u = window.__ndf.engine.bhMat.uniforms; Object.defineProperty(u.uTime, 'value', { get: () => 0, set: () => {} }); u.uDiskOn.value = 0; });
  await shot('bh-nodisk');
  await page.evaluate(() => { const u = window.__ndf.engine.bhMat.uniforms; u.uDiskOn.value = 1; window.__ndf.engine.bloom.enabled = false; });
  await shot('bh-nobloom');
}
await browser.close();
