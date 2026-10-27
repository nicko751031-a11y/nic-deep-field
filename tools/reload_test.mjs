#!/usr/bin/env node
// 第二次造訪／重新整理回歸：模組已在快取時（modulepreload 命中）頁面仍須完成初始化。
// 2026-10-27 事故：importmap 放在 modulepreload 之後，快取命中時預載模組先解析、裸名「three」解析失敗，
// 第二次造訪停在「初始化…」（首次造訪因下載較慢而僥倖通過，所以單次載入測試抓不到）。
// 用法：node tools/reload_test.mjs [baseURL]
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process'; import path from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const base = process.argv[2] || 'http://127.0.0.1:8123/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errs = []; page.on('pageerror', (e) => errs.push('pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/TUNNEL|Failed to load resource|favicon/.test(m.text())) errs.push(m.text().slice(0, 160)); });
const loaded = async (label) => {
  const t0 = Date.now();
  const done = await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 90000 }).then(() => true, () => false);
  const txt = done ? '' : await page.evaluate(() => document.getElementById('loading')?.innerText?.replace(/\n/g, ' ').slice(0, 60));
  ok(done, `${label}：${((Date.now() - t0) / 1000).toFixed(1)} s 完成初始化${done ? '' : '（停在「' + txt + '」）'}`);
};
await page.goto(`${base}?quality=low`, { waitUntil: 'load' }); await loaded('首次造訪');
await page.reload({ waitUntil: 'load' }); await loaded('重新整理（快取命中）');
await page.goto(`${base}?quality=low&diag=1`, { waitUntil: 'load' }); await loaded('同頁再導向 ?diag=1');
ok(await page.waitForSelector('#diag', { timeout: 30000 }).then(() => true, () => false), '診斷層存在（動態載入 diag.js）');
await page.goto(`${base}`, { waitUntil: 'load' }); await loaded('無參數再造訪');
ok(errs.length === 0, `console／page 錯誤 0${errs.length ? '：' + errs.join(' | ') : ''}`);
await browser.close();
console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
