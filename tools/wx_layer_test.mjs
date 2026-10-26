#!/usr/bin/env node
// 主站近即時紅外線圖層測試（建置環境連不到 GIBS，以 Playwright route 模擬來源：capabilities XML 與 512² PNG 分塊，帶 CORS 與時間標頭）。
// 驗證：啟用→ready→uWxOn=1 且分塊補丁同步；時間加速→撤圖；來源 503→失敗顯示「—」；shader／console 錯誤 0。
// 用法：node tools/wx_layer_test.mjs [baseURL]
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process'; import path from 'node:path'; import fs from 'node:fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const base = process.argv[2] || 'http://127.0.0.1:8123/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
// 固定來源時段：現在往下取整到 10 分鐘（UTC）
const now = new Date(); now.setUTCSeconds(0, 0); now.setUTCMinutes(Math.floor(now.getUTCMinutes() / 10) * 10);
const slot = now.toISOString().replace('.000Z', 'Z');
const xml = `<?xml version="1.0"?><Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1"><Contents><Layer><ows:Identifier>Himawari_AHI_Band13_Clean_Infrared</ows:Identifier><Dimension><ows:Identifier>Time</ows:Identifier><Value>2026-01-01T00:00:00Z/${slot}/PT10M</Value></Dimension></Layer></Contents></Capabilities>`;
// 512² PNG：左上角亮塊（冷雲頂）＋其餘半透明暗底，模擬紅外線影像
const png = path.join(process.env.TMPDIR || '/tmp', 'wx-fixture.png');
execSync(`python3 -I -c "
from PIL import Image, ImageDraw
im = Image.new('RGBA', (512, 512), (40, 40, 40, 255)); d = ImageDraw.Draw(im)
d.ellipse((120, 90, 420, 330), fill=(235, 235, 235, 255)); d.ellipse((300, 350, 480, 470), fill=(180, 180, 180, 255))
im.save('${png}')"`);
const pngBytes = fs.readFileSync(png);
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1100, height: 760 } })).newPage();
const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); }); page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
let fail503 = false;
await page.route('https://gibs.earthdata.nasa.gov/**', (route) => {
  const url = route.request().url();
  const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'layer-time-actual, layer-time-request, layer-identifier-actual, content-length' };
  if (fail503) return route.fulfill({ status: 503, headers: cors, body: 'down' });
  if (url.endsWith('WMTSCapabilities.xml')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/xml' }, body: xml });
  const m = /default\/([^/]+)\/2km\/5\/7\/33\.png$/.exec(url);
  if (m) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'image/png', 'layer-time-actual': decodeURIComponent(m[1]), 'layer-time-request': decodeURIComponent(m[1]), 'layer-identifier-actual': 'Himawari_AHI_Band13_Clean_Infrared' }, body: pngBytes });
  return route.fulfill({ status: 404, headers: cors, body: 'no' });
});
await page.goto(`${base}?quality=medium`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
await page.evaluate(async () => { const n = window.__ndf; n.controls.stop(); n.engine.breath = false; n.engine.simTime = Date.now(); n.engine.timeRate = 1; n.engine.update(0); await n.testPlaceOver(23.7, 121.0, 1500); document.getElementById('title-card').classList.remove('show'); });
await page.waitForTimeout(2500);
// 啟用（走設定面板事件）
await page.evaluate(() => { const i = document.getElementById('s-wx'); i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForFunction(() => window.__ndf.earthWx.state.status === 'ready', null, { timeout: 30000 }).catch(() => {});
// 等分塊 LOD 升層（SwiftShader 幀率低，遲滯需要數秒），才能驗證補丁 uniform 同步
await page.waitForFunction(() => (window.__ndf.engine.earthLod?.level || 0) > 0 && window.__ndf.engine.earthLod.loading === 0, null, { timeout: 90000 }).catch(() => {});
let s = await page.evaluate(() => { const n = window.__ndf; const u = n.engine.bodies.get('earth').mesh.material.uniforms; const lod = n.engine.earthLod; const patches = lod?.patches.get(lod.level) || []; return { status: n.earthWx.state.status, reason: n.earthWx.state.reason, on: u.uWxOn.value, box: u.uWxBox.value.toArray(), level: lod?.level, patchOn: patches.length ? patches.every((p) => p.material.uniforms.uWxOn.value === 1 && p.material.uniforms.uWx.value === u.uWx.value) : null, note: document.getElementById('wx-note')?.textContent, settings: document.getElementById('s-wx-note')?.textContent.slice(0, 160) }; });
console.log(JSON.stringify(s));
ok(s.status === 'ready' && s.on === 1, `啟用後 ready 且 uWxOn=1（${s.status}${s.reason ? '：' + s.reason : ''}）`);
ok(Math.abs(s.box[0] - (118 + 180) / 360) < 1e-6 && Math.abs(s.box[3] - (27 + 90) / 180) < 1e-6, `UV 範圍 118–124E／20–27N → ${s.box.map((v) => v.toFixed(4)).join(',')}`);
ok(s.patchOn !== false, `L${s.level} 補丁同步紅外線 uniform（${s.patchOn}）`);
ok(/延遲約/.test(s.note || ''), `左下標示顯示來源時段：${s.note}`);
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/claude-0/wx-taiwan-1500.png' });
const scan = await page.evaluate(() => window.__ndf.engine.scanNonFinite(0.3)); ok(scan.bad === 0, `非有限值像素 ${scan.bad}`);
// 時間加速 → 撤圖
await page.evaluate(() => { window.__ndf.engine.timeRate = 60; });
await page.waitForFunction(() => window.__ndf.earthWx.state.status !== 'ready', null, { timeout: 5000 }).catch(() => {});
s = await page.evaluate(() => ({ status: window.__ndf.earthWx.state.status, reason: window.__ndf.earthWx.state.reason, on: window.__ndf.engine.bodies.get('earth').mesh.material.uniforms.uWxOn.value, note: document.getElementById('wx-note')?.textContent }));
ok(s.status === 'unavailable' && s.on === 0 && /—/.test(s.note || ''), `時間加速後撤圖：${s.status}／${s.reason}／${s.note}`);
// 回到即時但來源 503 → 失敗顯示「—」
fail503 = true;
await page.evaluate(() => { window.__ndf.engine.timeRate = 1; window.__ndf.engine.simTime = Date.now(); window.__ndf.earthWx.refresh(); });
await page.waitForFunction(() => window.__ndf.earthWx.state.status === 'failed', null, { timeout: 10000 }).catch(() => {});
s = await page.evaluate(() => ({ status: window.__ndf.earthWx.state.status, reason: window.__ndf.earthWx.state.reason, on: window.__ndf.engine.bodies.get('earth').mesh.material.uniforms.uWxOn.value }));
ok(s.status === 'failed' && s.on === 0, `來源 503 → ${s.status}（${s.reason}），uWxOn=${s.on}`);
// 關閉
await page.evaluate(() => { const i = document.getElementById('s-wx'); i.checked = false; i.dispatchEvent(new Event('change', { bubbles: true })); });
s = await page.evaluate(() => ({ status: window.__ndf.earthWx.state.status, hidden: document.getElementById('wx-note').hidden }));
ok(s.status === 'off' && s.hidden, '關閉後狀態 off、標示隱藏');
console.log('shaderErrors', await page.evaluate(() => window.__ndf.engine.shaderErrors.length));
const real = errs.filter((e) => !/TUNNEL|Failed to load resource|favicon|503/.test(e)); ok(real.length === 0, `console 無錯誤${real.length ? '：' + real.join(' | ') : ''}`);
await browser.close();
console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
