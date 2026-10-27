#!/usr/bin/env node
// 即時模式的模擬時鐘以牆鐘差推進（AUDIT B6）：無頭 Chromium／SwiftShader 約 1 fps、每幀 dt 上限 0.1 秒，
// 修正前「即時」每秒落後牆鐘約 0.9 秒；修正後 6 秒內偏移變化 < 1 秒。另驗：暫停時刻不動、×60 持續前進、
// 快轉後切回即時仍保留偏移（連續，不跳回現在）。用法：node tools/realtime_clock_test.mjs [baseURL]
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process'; import path from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const base = process.argv[2] || 'http://127.0.0.1:8123/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push('pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/TUNNEL|Failed to load resource|favicon/.test(m.text())) errs.push(m.text().slice(0, 160)); });
await page.goto(`${base}?quality=low`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
const clock = () => page.evaluate(() => ({ off: window.__ndf.engine.simTime - Date.now(), sim: window.__ndf.engine.simTime, rate: window.__ndf.engine.timeRate, fps: 0 }));
const setRate = (v) => page.evaluate((v) => { const el = document.getElementById('rate'); el.value = String(v); el.dispatchEvent(new Event('change', { bubbles: true })); }, v);
// 1) 即時：6 秒內偏移變化 < 1 秒
await setRate(1); await page.waitForTimeout(1000);
const a = await clock(); await page.waitForTimeout(6000); const b = await clock();
console.log('realtime', JSON.stringify({ off0: a.off, off1: b.off, drift: b.off - a.off }));
ok(a.rate === 1 && Math.abs(b.off - a.off) < 1000, `即時 6 秒：偏移變化 ${((b.off - a.off) / 1000).toFixed(2)} 秒（< 1 秒；修正前軟體繪圖約 −5 秒）`);
ok(Math.abs(b.off) < 3000, `即時偏移絕對值 ${(b.off / 1000).toFixed(2)} 秒（< 3 秒）`);
// 2) 暫停：時刻不動
await setRate(0); await page.waitForTimeout(300); const p0 = await clock(); await page.waitForTimeout(2000); const p1 = await clock();
ok(p0.rate === 0 && p1.sim === p0.sim, `暫停 2 秒：模擬時刻不動（差 ${p1.sim - p0.sim} ms）`);
// 3) ×60：持續前進（以 dt×60 推進）
await setRate(60); await page.waitForTimeout(300); const q0 = await clock(); await page.waitForTimeout(2000); const q1 = await clock();
ok(q0.rate === 60 && q1.sim - q0.sim > 2000, `×60 兩秒：前進 ${((q1.sim - q0.sim) / 1000).toFixed(1)} 模擬秒（> 2）`);
// 4) 快轉後切回即時：偏移保留且不再漂移
await setRate(86400); await page.waitForTimeout(2000); await setRate(1); await page.waitForTimeout(500);
const r0 = await clock(); await page.waitForTimeout(4000); const r1 = await clock();
console.log('after fast-forward', JSON.stringify({ off0: r0.off, off1: r1.off }));
ok(r0.off > 60000 && Math.abs(r1.off - r0.off) < 1000, `快轉後切回即時：偏移 ${(r0.off / 3600000).toFixed(2)} 小時保留，4 秒內變化 ${((r1.off - r0.off) / 1000).toFixed(2)} 秒`);
// 5) 「現在」：回到現在並維持
await page.evaluate(() => document.getElementById('b-now').click()); await page.waitForTimeout(3000); const n1 = await clock();
ok(Math.abs(n1.off) < 1500 && n1.rate === 1, `按「現在」3 秒後偏移 ${(n1.off / 1000).toFixed(2)} 秒（< 1.5 秒）`);
ok(errs.length === 0, `console／page 錯誤 0${errs.length ? '：' + errs.join(' | ') : ''}`);
await browser.close();
console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
