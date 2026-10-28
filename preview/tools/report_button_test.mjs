#!/usr/bin/env node
// 設定面板「回報問題」（AUDIT A6）：按下後文字框出現、內容為可解析的 JSON，含 caps／earthLod／shaderErrors／simTime／prefs／loadErrors；
// 不含 mailto 或電子郵件；?diag=1 的「產生／複製報告」仍可用且格式相同（同一 buildReport）；console 無錯誤。
// 用法：node tools/report_button_test.mjs [baseURL]
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process'; import path from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const base = process.argv[2] || 'http://127.0.0.1:8123/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 }, permissions: ['clipboard-read', 'clipboard-write'] }); const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push('pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/TUNNEL|Failed to load resource|favicon/.test(m.text())) errs.push(m.text().slice(0, 160)); });
await page.goto(`${base}?quality=low`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
// 1) 設定面板按鈕
const before = await page.evaluate(() => ({ hidden: document.getElementById('s-report-out').hidden, btn: !!document.getElementById('s-report') }));
ok(before.btn && before.hidden, '設定面板有「產生報告」按鈕，文字框初始隱藏');
await page.evaluate(() => document.getElementById('s-report').click());
await page.waitForFunction(() => { const v = document.getElementById('s-report-out').value; return v && v !== '產生中…'; }, null, { timeout: 30000 });
const out = await page.evaluate(() => ({ hidden: document.getElementById('s-report-out').hidden, value: document.getElementById('s-report-out').value, disabled: document.getElementById('s-report').disabled }));
ok(!out.hidden && !out.disabled, '按下後文字框顯示、按鈕恢復可用');
const firstLine = out.value.split('\n')[0]; ok(/已複製到剪貼簿|請長按／全選複製/.test(firstLine), `第一行為複製提示（${firstLine}）`);
let json = null; try { json = JSON.parse(out.value.slice(out.value.indexOf('\n') + 1)); } catch (e) { /* 留給下方斷言 */ }
ok(!!json, '內容為可解析的 JSON');
if (json) {
  ok(json.caps && typeof json.caps.renderer === 'string' && json.caps.quality === 'low', `caps.renderer=${json.caps?.renderer?.slice(0, 40)}、quality=${json.caps?.quality}`);
  ok('earthLod' in json && Array.isArray(json.shaderErrors) && typeof json.simTime === 'string' && typeof json.timeRate === 'number', 'earthLod／shaderErrors／simTime／timeRate 欄位存在');
  ok(json.prefs && typeof json.prefs.cine === 'boolean' && Array.isArray(json.loadErrors) && typeof json.safe === 'boolean', 'extra：prefs／loadErrors／safe 存在');
  ok(json.fps === null && json.nan === null, '未開診斷層時 fps／nan 為 null（不偽造數據）');
}
ok(!/mailto:|@gmail|nicko/i.test(out.value), '不含 mailto 或電子郵件');
// 2) 剪貼簿（headless 已授權）
const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => '')); ok(clip.startsWith('{') && clip.length > 200, `剪貼簿有報告（${clip.length} 字元）`);
// 3) ?diag=1 的報告仍可用、同格式
await page.goto(`${base}?quality=low&diag=1`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
await page.waitForSelector('#diag'); await page.evaluate(() => { for (const b of document.querySelectorAll('#diag button')) if (b.textContent === '產生／複製報告') b.click(); });
await page.waitForFunction(() => { const t = document.querySelector('#diag textarea'); return t && t.value.length > 100; }, null, { timeout: 15000 });
const dv = await page.evaluate(() => document.querySelector('#diag textarea').value); let dj = null; try { dj = JSON.parse(dv.replace(/^（已複製到剪貼簿）\n/, '')); } catch (e) { /* */ }
ok(dj && dj.caps && dj.fps && typeof dj.fps.avg === 'number' && dj.nan && typeof dj.nan.scans === 'number', '診斷層報告：同格式且含 fps／nan 即時數據');
ok(errs.length === 0, `console／page 錯誤 0${errs.length ? '：' + errs.join(' | ') : ''}`);
await browser.close();
console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
