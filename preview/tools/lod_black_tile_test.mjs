#!/usr/bin/env node
// 分塊貼圖上傳驗證（A2 黑色扇形假說：貼圖在 GPU 上取樣為全黑）。以 route 把 L2_6_1 換成 2048² 全黑 PNG：
// 期望該塊判定「上傳後取樣為全黑」→ failed（退避重試），補丁 uHasTile=0 沿用 L0 底圖，地球該區不是純黑；L2_7_1 正常載入。
// 另驗：status() 有 badUploads／failReasons；console 無錯誤。用法：node tools/lod_black_tile_test.mjs [baseURL]
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process'; import path from 'node:path'; import zlib from 'node:zlib';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const base = process.argv[2] || 'http://127.0.0.1:8123/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
// 最小 PNG 編碼器：2048×2048 RGB 全黑（每列 filter 0 + 零）
function blackPng(size) {
  const crcTable = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c; }
  const crc = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(size * (1 + size * 3)); // 全 0：filter 0 + 黑像素
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const png = blackPng(2048); console.log('black png bytes', png.length);
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push('pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/TUNNEL|Failed to load resource|favicon/.test(m.text())) errs.push(m.text().slice(0, 160)); });
let req61 = 0; await page.route('**/earth_tiles/L2_6_1.jpg', (route) => { req61++; return route.fulfill({ status: 200, contentType: 'image/png', body: png }); });
await page.goto(`${base}?quality=high`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
// 相機放在 135°E 分塊邊界附近（23.7°N）、高度 600 km → L2，L2_6_1 與 L2_7_1 同時可見
await page.evaluate(async () => { const n = window.__ndf; n.controls.stop(); n.engine.breath = false; n.engine.timeRate = 0; n.engine.simTime = Date.parse('2026-10-27T04:00:00Z'); n.engine.update(0); await n.testPlaceOver(23.7, 134.8, 600); });
await page.waitForFunction(() => window.__ndf.engine.earthLod?.level === 2, null, { timeout: 90000 }).catch(() => {});
await page.waitForFunction(() => { const l = window.__ndf.engine.earthLod; const t = l.tiles.get('L2_6_1'), u = l.tiles.get('L2_7_1'); return t && t.state !== 'loading' && u && u.state !== 'loading'; }, null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(500);
const st = await page.evaluate(() => { const l = window.__ndf.engine.earthLod; const t = l.tiles.get('L2_6_1'), u = l.tiles.get('L2_7_1'); const p = (l.patches.get(2) || []).find((m) => m.userData.key === 'L2_6_1'); return { ...l.status(), t61: t ? { state: t.state, why: t.why, fails: t.fails } : null, t71: u ? { state: u.state, why: u.why } : null, hasTile61: p ? p.material.uniforms.uHasTile.value : null }; });
console.log(JSON.stringify(st));
ok(st.level === 2, `目前層級 L${st.level}`);
ok(st.t61?.state === 'failed' && /全黑/.test(st.t61.why || ''), `L2_6_1 全黑貼圖 → failed（原因「${st.t61?.why}」，請求 ${req61} 次）`);
ok(st.hasTile61 === 0, 'L2_6_1 補丁 uHasTile=0（沿用 L0 底圖，不是純黑補丁）');
ok(st.t71?.state === 'ok', `L2_7_1 正常載入（${st.t71?.state}）`);
ok(st.badUploads >= 1 && st.failReasons && Object.values(st.failReasons).some((v) => v >= 1), `status：badUploads=${st.badUploads}，failReasons=${JSON.stringify(st.failReasons)}`);
// 畫面：地球中心區域不是純黑（L2_6_1 補丁沿用 L0）
const scan = await page.evaluate(() => window.__ndf.engine.scanNonFinite(0.3)); ok(scan.bad === 0 && scan.meanLuma > 0.02, `非有限值 ${scan.bad}、平均亮度 ${scan.meanLuma.toFixed(3)}（> 0.02，不是黑畫面）`);
ok(errs.length === 0, `console／page 錯誤 0${errs.length ? '：' + errs.join(' | ') : ''}`);
await browser.close();
console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
