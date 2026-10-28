#!/usr/bin/env node
// 分塊載入失敗後的退避重試（無頭 Chromium，route 注入失敗）：
// (a) 台灣 L2 分塊第一次 503，之後恢復 → 不重整頁面，退避後自動載回 16K；(b) 另一塊持續 404 → 最多 MAX_TRIES 次後放棄，不形成請求風暴。
// 用法：node tools/lod_retry_test.mjs [baseURL]
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process'; import path from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const base = process.argv[2] || 'http://127.0.0.1:8123/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push('pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/503|404|Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 160)); });
// 相機放在 135°E 分塊邊界附近（23.7°N），L2_6_1 與 L2_7_1 同時可見；前者一次性 503，後者持續 404
let transientLeft = 1; let req61 = 0, req71 = 0;
await page.route('**/earth_tiles/L2_6_1.jpg', (route) => { req61++; if (transientLeft > 0) { transientLeft--; return route.fulfill({ status: 503, body: 'down' }); } return route.continue(); });
await page.route('**/earth_tiles/L2_7_1.jpg', (route) => { req71++; return route.fulfill({ status: 404, body: 'gone' }); });
await page.goto(`${base}?quality=high`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
await page.evaluate(async () => { const n = window.__ndf; n.controls.stop(); n.engine.breath = false; n.engine.timeRate = 0; n.engine.update(0); await n.testPlaceOver(23.7, 134.8, 600); });
const st = () => page.evaluate(() => { const l = window.__ndf.engine.earthLod; const t = l.tiles.get('L2_6_1'), u = l.tiles.get('L2_7_1'); return { ...l.status(), t61: t ? { state: t.state, fails: t.fails } : null, t71: u ? { state: u.state, fails: u.fails } : null }; });
// 等待第一次失敗被記錄
await page.waitForFunction(() => { const t = window.__ndf.engine.earthLod.tiles.get('L2_6_1'); return t && t.state !== 'loading'; }, null, { timeout: 90000 }).catch(() => {});
let s = await st(); console.log('after first attempt', JSON.stringify({ level: s.level, t61: s.t61, t71: s.t71, failed: s.failed }));
ok(s.t61?.state === 'failed' && s.t61.fails === 1, `L2_6_1 第一次 503 → failed（fails=${s.t61?.fails}），沿用 L0`);
// 退避 2 秒後應自動重試並成功（不重整頁面）
await page.waitForFunction(() => window.__ndf.engine.earthLod.tiles.get('L2_6_1')?.state === 'ok', null, { timeout: 40000 }).catch(() => {});
s = await st(); console.log('after retry', JSON.stringify({ t61: s.t61, req61, loaded: s.loaded }));
ok(s.t61?.state === 'ok' && req61 === 2, `L2_6_1 來源恢復後自動載回（請求 ${req61} 次，state=${s.t61?.state}）`);
// 持續 404 的塊：等到放棄（2+4+8+16 秒 ≈ 30 秒）
await page.waitForFunction(() => window.__ndf.engine.earthLod.tiles.get('L2_7_1')?.state === 'gaveup', null, { timeout: 90000 }).catch(() => {});
s = await st(); console.log('gaveup', JSON.stringify({ t71: s.t71, req71, retrying: s.retrying, gaveUp: s.gaveUp }));
ok(s.t71?.state === 'gaveup' && req71 === 5, `L2_7_1 持續 404 → 5 次後放棄（請求 ${req71} 次），gaveUp=${s.gaveUp}`);
await page.waitForTimeout(8000);
ok(req71 === 5, `放棄後 8 秒內無新請求（仍 ${req71} 次）`);
// 手動重試：重置後再試一次（仍 404）→ 計數 +1
await page.evaluate(() => window.__ndf.engine.earthLod.retryFailed());
await page.waitForTimeout(6000); ok(req71 >= 6, `retryFailed() 後重新嘗試（請求 ${req71} 次）`);
const scan = await page.evaluate(() => window.__ndf.engine.scanNonFinite(0.3)); ok(scan.bad === 0, `非有限值像素 ${scan.bad}`);
s = await st(); ok(s.bytesMB <= s.budgetMB, `預算 ${s.bytesMB}/${s.budgetMB} MB`);
console.log('shaderErrors', await page.evaluate(() => window.__ndf.engine.shaderErrors.length));
ok(errs.length === 0, `console／page 錯誤 0${errs.length ? '：' + errs.join(' | ') : ''}`);
await browser.close();
console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
