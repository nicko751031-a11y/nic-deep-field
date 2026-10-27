#!/usr/bin/env node
// 「真實觀測」面板的重新讀取競態（無頭 Chromium，route 控制 SOHO LASCO C2 影像來源，該卡不需時間 API）：
// A 慢成功→B 快失敗：最終「失敗／—」；A 慢失敗→B 快成功：最終影像保留；連按 20 次：只有最後一次寫入、無未處理 Promise。
// 用法：node tools/observe_race_test.mjs [baseURL]
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process'; import path from 'node:path'; import fs from 'node:fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const base = process.argv[2] || 'http://127.0.0.1:8123/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const png = path.join(process.env.TMPDIR || '/tmp', 'obs-fixture.png');
execSync(`python3 -I -c "from PIL import Image; Image.new('RGB', (64, 64), (200, 120, 40)).save('${png}')"`);
const img = fs.readFileSync(png);
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1100, height: 760 } })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
// 來源行為由測試逐次指定：queue 的每一項 {delay, status}
const plan = []; let served = 0;
await page.route('**/soho.nascom.nasa.gov/**', async (route) => { const p = plan.shift() || { delay: 0, status: 200 }; served++; await new Promise((r) => setTimeout(r, p.delay)); if (p.status !== 200) return route.fulfill({ status: p.status, body: 'down' }); return route.fulfill({ status: 200, headers: { 'content-type': 'image/png', 'access-control-allow-origin': '*' }, body: img }); });
await page.route(/sdo\.gsfc\.nasa\.gov|api\.helioviewer\.org/, (route) => route.fulfill({ status: 503, body: 'off' })); // 其他太陽卡快速失敗，不干擾
await page.goto(`${base}?quality=low`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
plan.push({ delay: 0, status: 503 }); // 初次載入：先讓它失敗，之後由測試控制
await page.click('#tab-obs'); await page.waitForTimeout(1500);
const tile = () => page.evaluate(() => { const t = [...document.querySelectorAll('.obs-tile')].find((x) => /LASCO/.test(x.textContent)); return { st: t.querySelector('.st').textContent, cap: t.querySelector('.cap').textContent, hasImg: !!t.querySelector('.obs-img img'), imgs: t.querySelectorAll('.obs-img img').length }; });
const refresh = () => page.evaluate(() => { [...document.querySelectorAll('.obs-tile')].find((x) => /LASCO/.test(x.textContent)).querySelector('.refresh').click(); });
let s = await tile(); console.log('initial', JSON.stringify(s));
// 情境 1：A 慢成功（3 秒）→ 按刷新 → B 立即 503 → 最終失敗，A 完成後不得蓋回
plan.push({ delay: 3000, status: 200 }, { delay: 0, status: 503 });
await refresh(); await page.waitForTimeout(300); await refresh(); await page.waitForTimeout(4500);
s = await tile(); console.log('scenario1', JSON.stringify(s));
ok(/失敗/.test(s.st) && !s.hasImg && s.cap === '—', `A 慢成功→B 快失敗：最終 ${s.st}，影像 ${s.hasImg}`);
// 情境 2：A 慢失敗（3 秒 503）→ 按刷新 → B 立即成功 → 最終影像保留、狀態已載入
plan.push({ delay: 3000, status: 503 }, { delay: 0, status: 200 });
await refresh(); await page.waitForTimeout(300); await refresh(); await page.waitForTimeout(4500);
s = await tile(); console.log('scenario2', JSON.stringify(s));
ok(/已載入/.test(s.st) && s.hasImg && s.imgs === 1, `A 慢失敗→B 快成功：最終 ${s.st}，影像 ${s.imgs} 張`);
// 情境 3：連按 20 次（前 19 次慢、最後一次快成功）→ 只有最後一次寫入
for (let i = 0; i < 19; i++) plan.push({ delay: 1500 + i * 50, status: i % 2 ? 503 : 200 }); plan.push({ delay: 0, status: 200 });
const before = served;
for (let i = 0; i < 20; i++) { await refresh(); await page.waitForTimeout(40); }
await page.waitForTimeout(4000);
s = await tile(); console.log('scenario3', JSON.stringify({ ...s, served: served - before }));
ok(/已載入/.test(s.st) && s.imgs === 1, `連按 20 次：最終 ${s.st}，影像 ${s.imgs} 張（來源收到 ${served - before} 次請求）`);
ok(errs.length === 0, `page 錯誤／未處理 rejection 0${errs.length ? '：' + errs.join(' | ') : ''}`);
await browser.close();
console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
