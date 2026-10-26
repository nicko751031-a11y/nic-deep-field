#!/usr/bin/env node
// 黑屏閃爍排查：在多個場景位置以浮點暫存掃描非有限值（NaN／Inf）像素，並連續多幀量測最終畫面的平均亮度，
// 找出「整幀變黑」的幀。用法：node tools/nan_sweep.mjs [baseURL] [quality]
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process'; import path from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const base = process.argv[2] || 'http://127.0.0.1:8123/'; const quality = process.argv[3] || 'medium';
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1024, height: 768 } })).newPage();
const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); }); page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
await page.goto(`${base}?quality=${quality}&nolog=0`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
await page.waitForTimeout(1500);
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const scan = (label) => page.evaluate((l) => { const e = window.__ndf.engine; e.update(0); const s = e.scanNonFinite(0.5); return { l, ...s }; }, label);
// 連續 N 幀的最終畫面亮度（由 canvas 截圖的縮圖估算）：找出黑幀
const frames = async (n, label) => {
  const lumas = [];
  for (let i = 0; i < n; i++) {
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: 1024, height: 768 }, type: 'jpeg', quality: 30 });
    // 用瀏覽器端解碼估算平均亮度（避免在 Node 端引入影像庫）
    const l = await page.evaluate(async (b64) => new Promise((res) => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = 64; c.height = 48; const x = c.getContext('2d'); x.drawImage(im, 0, 0, 64, 48); const d = x.getImageData(0, 0, 64, 48).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722; res(s / (64 * 48)); }; im.src = 'data:image/jpeg;base64,' + b64; }), png.toString('base64'));
    lumas.push(Math.round(l * 10) / 10);
  }
  const min = Math.min(...lumas), max = Math.max(...lumas);
  console.log(`${label} 連續 ${n} 幀亮度 min ${min} max ${max}：${lumas.join(' ')}`);
  return { min, max, lumas };
};
const places = [
  ['開場（地球夜側）', null],
  ['地球 500 km 台灣', () => window.__ndf.testPlaceOver(23.7, 121.0, 500)],
  ['地球 300 km 北極', () => window.__ndf.testPlaceOver(89.5, 0, 300)],
  ['地球 300 km 南極', () => window.__ndf.testPlaceOver(-89.5, 0, 300)],
  ['地球 60 km 晨昏線', () => window.__ndf.testPlaceOver(0, 60, 60)],
  ['地球 20000 km', () => window.__ndf.testPlaceOver(23.7, 121.0, 20000)],
];
for (const [label, fn] of places) {
  if (fn) { await page.evaluate(fn); await page.waitForTimeout(1200); }
  const s = await scan(label); console.log(JSON.stringify(s));
  ok(s.bad === 0, `${label}：非有限值像素 ${s.bad}${s.first ? ` 首個 (${s.first.x},${s.first.y})` : ''}`);
  const f = await frames(6, label);
  ok(!(f.max > 8 && f.min < f.max * 0.25), `${label}：無黑幀（min ${f.min} / max ${f.max}）`);
}
// 目的地：土星、太陽、黑洞、系外行星、M31
for (const q of ['土星', '太陽', 'Sgr A*', 'TRAPPIST-1 e', 'M31']) {
  await page.evaluate((name) => { const c = window.__ndf.catalog; const r = c.search(name)[0]; return window.__ndf.goTo(r, { instant: true }); }, q);
  await page.waitForTimeout(2500);
  const s = await scan(q); console.log(JSON.stringify(s));
  ok(s.bad === 0, `${q}：非有限值像素 ${s.bad}${s.first ? ` 首個 (${s.first.x},${s.first.y})` : ''}`);
  const f = await frames(6, q);
  ok(!(f.max > 8 && f.min < f.max * 0.25), `${q}：無黑幀（min ${f.min} / max ${f.max}）`);
}
console.log('shaderErrors', await page.evaluate(() => window.__ndf.engine.shaderErrors.length));
console.log('errors', errs.filter((e) => !/TUNNEL|Failed to load resource|favicon/.test(e)));
await browser.close();
console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
