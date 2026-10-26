#!/usr/bin/env node
// 地球分塊 LOD 記憶體預算壓力測試（Playwright 無頭 Chromium）。
// 情境：quality=medium（預算 128 MB）、極區（8 塊匯聚）、低軌 8+ 可見塊、台灣⇄深空來回 10 趟。
// 全程每 200 ms 取樣：bytesMB 不得超過 budgetMB、WebGL context 不得遺失、無著色器錯誤。
// 用法：node tools/lod_stress.mjs [baseURL]   （先在 space/ 啟動 python3 -m http.server 8123）
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process'; import path from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const base = process.argv[2] || 'http://127.0.0.1:8123/';
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };

for (const quality of ['medium', 'high']) {
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
  const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); }); page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  await page.goto(`${base}?quality=${quality}&nolog=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
  await page.evaluate(() => {
    const e = window.__ndf.engine; e.simTime = Date.UTC(2026, 9, 17, 4, 0, 0); e.timeRate = 0; e.update(0);
    window.__lodLog = { maxMB: 0, overBudget: 0, ctxLost: 0, samples: 0, maxTex: 0 };
    e.renderer.domElement.addEventListener('webglcontextlost', () => window.__lodLog.ctxLost++);
    setInterval(() => {
      const s = e.earthLod?.status(); if (!s) return; const L = window.__lodLog; L.samples++;
      L.maxMB = Math.max(L.maxMB, s.bytesMB); if (s.bytesMB > s.budgetMB) L.overBudget++;
      L.maxTex = Math.max(L.maxTex, e.renderer.info.memory.textures);
    }, 200);
  });
  const st = () => page.evaluate(() => { const e = window.__ndf.engine; return { ...e.earthLod.status(), textures: e.renderer.info.memory.textures }; });
  const fps = () => page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(f); else res(Math.round(n / ((performance.now() - t0) / 1000))); }; requestAnimationFrame(f); }));
  const go = async (lat, lon, alt, ms = 5000) => { await page.evaluate(([a, b, c]) => window.__ndf.testPlaceOver(a, b, c), [lat, lon, alt]); await page.waitForTimeout(ms); };
  const s0 = await st(); console.log(`\n== quality=${quality} 預算 ${s0.budgetMB} MB，state=${s0.state}`);
  ok(s0.state === 'ready' && !s0.synthetic, '分塊 manifest 已載入（真實資料）');

  await go(23.7, 121.0, 400); let s = await st(); console.log('台灣 400 km', JSON.stringify(s), 'fps', await fps());
  ok(s.level >= 1, `台灣 400 km 進入 L${s.level}`);
  await go(23.7, 121.0, 1500, 6000); s = await st(); console.log('台灣 1500 km', JSON.stringify(s));
  await go(88.0, 10.0, 1200, 7000); s = await st(); console.log('北極 88°N 1200 km', JSON.stringify(s));
  ok(s.bytesMB <= s.budgetMB, `極區：bytes ${s.bytesMB} MB ≤ 預算 ${s.budgetMB} MB（needed ${s.needed}、loaded ${s.loaded}、capLevel ${s.capLevel}）`);
  await go(-88.0, 100.0, 1200, 7000); s = await st(); console.log('南極 88°S 1200 km', JSON.stringify(s));
  ok(s.bytesMB <= s.budgetMB, `南極：bytes ${s.bytesMB} MB ≤ 預算`);
  // 低軌斜視：可見塊最多的角度（赤道 700 km，視線掠過多塊）
  await go(0.0, 60.0, 700, 7000); s = await st(); console.log('赤道 700 km', JSON.stringify(s), 'fps', await fps());
  ok(s.bytesMB <= s.budgetMB, `赤道：bytes ${s.bytesMB} MB ≤ 預算（needed ${s.needed}）`);
  // 來回 10 趟
  for (let i = 0; i < 10; i++) {
    await go(23.7 + (i % 3) * 20, 121.0 - i * 30, 400 + i * 100, 2500); const a = await st();
    await go(23.7, 121.0, 30000, 1500); const b = await st();
    console.log(`來回 ${i + 1}: 近 L${a.level} needed ${a.needed} loaded ${a.loaded} ${a.bytesMB}MB tex ${a.textures} | 遠 L${b.level} loaded ${b.loaded} ${b.bytesMB}MB tex ${b.textures}`);
  }
  await go(23.7, 121.0, 400, 6000); s = await st(); console.log('最終 台灣 400 km', JSON.stringify(s), 'fps', await fps());
  ok(s.level >= 1 && s.loaded >= 1, `十趟後仍能回到 L${s.level} 並載入 ${s.loaded} 塊`);
  const log = await page.evaluate(() => window.__lodLog);
  const shader = await page.evaluate(() => window.__ndf.engine.shaderErrors.length);
  console.log('取樣', JSON.stringify(log), 'shaderErrors', shader);
  ok(log.overBudget === 0, `全程 ${log.samples} 次取樣無超出預算（峰值 ${log.maxMB} MB，GPU 貼圖數峰值 ${log.maxTex}）`);
  ok(log.ctxLost === 0, 'WebGL context 未遺失');
  ok(shader === 0, '無著色器錯誤');
  const real = errs.filter((e) => !/TUNNEL|Failed to load resource|favicon/.test(e)); ok(real.length === 0, `console 無錯誤${real.length ? '：' + real.join(' | ') : ''}`);
  await page.close();
}
await browser.close();
console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
