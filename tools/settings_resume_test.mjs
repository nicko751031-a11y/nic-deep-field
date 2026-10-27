#!/usr/bin/env node
// 設定重載保留位置（AUDIT D6）與重設所有設定（AUDIT D7）的無頭 Chromium 驗證。
// 1) 飛到台灣上空 500 km、暫停時間 → 切畫質（整頁重載）→ 仍在台灣上空 500 km、時間仍暫停、網址上的 ?quality= 已移除、新畫質生效；
// 2) 開安全模式（重載、?safe=1）→ 位置仍保留、後處理關閉；3) 「重設所有設定」→ localStorage 無 ndf-*、網址無參數、回到開場（台灣上空 2.4–3.6 R）；
// 4) sessionStorage 內是壞資料或過期資料 → 無錯誤、正常開場。用法：node tools/settings_resume_test.mjs [baseURL]
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process'; import path from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const base = process.argv[2] || 'http://127.0.0.1:8123/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } }); const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push('pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/TUNNEL|Failed to load resource|favicon/.test(m.text())) errs.push(m.text().slice(0, 160)); });
page.on('dialog', (d) => d.accept());
const loaded = () => page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
const where = () => page.evaluate(() => {
  const n = window.__ndf; const e = n.engine.bodies.get('earth'); const cam = n.engine.camPos;
  const rel = [cam[0] - e.pos[0], cam[1] - e.pos[1], cam[2] - e.pos[2]]; const d = Math.hypot(...rel); const u = rel.map((x) => x / d);
  const dot = (a, b) => a[0] * b.x + a[1] * b.y + a[2] * b.z;
  const lat = Math.asin(dot(u, e.axes.yb)) * 180 / Math.PI, lon = Math.atan2(-dot(u, e.axes.zb), dot(u, e.axes.xb)) * 180 / Math.PI;
  return { lat, lon, alt: d - 6371, distR: d / 6371, quality: n.engine.quality, post: n.engine.postOn, timeRate: n.engine.timeRate, orbit: !!n.controls.orbit, target: n.controls.target, url: location.search, toast: document.getElementById('toast').textContent, ls: Object.keys(localStorage).filter((k) => k.startsWith('ndf-')) };
});
const nearTaiwan = (w, alt) => Math.abs(w.lat - 23.7) < 0.3 && Math.abs(w.lon - 121) < 0.3 && Math.abs(w.alt - alt) < 5; // 碰撞邊界會把 500 km 推到約 507 km，以重載前的實際高度為準
// 設定面板平時收合（元素不可見），比照 audio_ui_test 直接設值並派發事件
const setSel = (id, v) => page.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
const setChk = (id, v) => page.evaluate(([id, v]) => { const el = document.getElementById(id); el.checked = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);

await page.goto(`${base}?quality=low`, { waitUntil: 'load' }); await loaded();
await page.evaluate(() => { const n = window.__ndf; n.engine.timeRate = 0; document.getElementById('rate').value = '0'; return n.testPlaceOver(23.7, 121, 500); }); await page.waitForTimeout(600);
let w = await where(); console.log('before', JSON.stringify({ lat: +w.lat.toFixed(2), lon: +w.lon.toFixed(2), alt: +w.alt.toFixed(1), q: w.quality }));
const alt0 = w.alt; ok(Math.abs(w.lat - 23.7) < 0.3 && Math.abs(w.lon - 121) < 0.3 && Math.abs(alt0 - 500) < 15 && w.quality === 'low', `起點：台灣上空 ${alt0.toFixed(0)} km，畫質低`);
// 1) 切畫質 → 重載 → 位置保留
await setSel('s-quality', 'medium'); await page.waitForURL((u) => !u.searchParams.has('quality'), { timeout: 30000 }); await loaded(); await page.waitForTimeout(1500);
w = await where(); console.log('after quality', JSON.stringify({ lat: +w.lat.toFixed(2), lon: +w.lon.toFixed(2), alt: +w.alt.toFixed(1), q: w.quality, rate: w.timeRate, url: w.url, toast: w.toast }));
ok(nearTaiwan(w, alt0), `切畫質重載後仍在台灣上空（${w.lat.toFixed(2)}°, ${w.lon.toFixed(2)}°, ${w.alt.toFixed(0)} km）`);
ok(w.quality === 'medium' && w.url === '', `新畫質生效（${w.quality}），網址已無 ?quality=`);
ok(w.timeRate === 0, '時間倍率（暫停）保留');
ok(w.target === 'earth' && !w.orbit, '目標＝地球、未環繞');
ok(/位置/.test(w.toast), `提示「已回到重載前的位置」（${w.toast.slice(0, 30)}）`);
ok(await page.evaluate(() => sessionStorage.getItem('ndf-resume') === null), '還原資料用後即清除');
// 2) 安全模式 → 重載 → 位置保留、後處理關
await setChk('s-safe', true); await page.waitForURL((u) => u.searchParams.get('safe') === '1', { timeout: 30000 }); await loaded(); await page.waitForTimeout(1500);
w = await where(); console.log('after safe', JSON.stringify({ lat: +w.lat.toFixed(2), lon: +w.lon.toFixed(2), alt: +w.alt.toFixed(1), post: w.post, url: w.url }));
ok(nearTaiwan(w, alt0), `安全模式重載後仍在台灣上空（${w.alt.toFixed(0)} km）`);
ok(w.post === false && w.url === '?safe=1', '安全模式生效（後處理關閉、?safe=1）');
// 3) 重設所有設定 → 無 ndf-*、無網址參數、回到開場
ok(w.ls.includes('ndf-quality'), `重設前 localStorage 有 ${w.ls.join('、')}`);
await page.evaluate(() => document.getElementById('s-reset').click()); await page.waitForURL((u) => u.search === '', { timeout: 30000 }); await loaded(); await page.waitForTimeout(1500);
w = await where(); console.log('after reset', JSON.stringify({ lat: +w.lat.toFixed(2), lon: +w.lon.toFixed(2), distR: +w.distR.toFixed(2), ls: w.ls, url: w.url, post: w.post }));
ok(w.ls.length === 0, 'localStorage 無 ndf-* 鍵');
ok(w.url === '' && w.post === true, '網址無參數、安全模式解除');
ok(Math.abs(w.lat - 23.7) < 0.5 && Math.abs(w.lon - 121) < 0.5 && w.distR > 2.3 && w.distR < 3.7 && w.orbit, `回到開場（台灣上空 ${w.distR.toFixed(2)} R、環繞中）`);
// 4) 壞資料／過期資料不影響開場
await page.evaluate(() => sessionStorage.setItem('ndf-resume', '{not json')); await page.reload({ waitUntil: 'load' }); await loaded(); await page.waitForTimeout(800);
w = await where(); ok(w.distR > 2.3 && w.distR < 3.7 && w.orbit, '壞資料 → 正常開場');
await page.evaluate(() => sessionStorage.setItem('ndf-resume', JSON.stringify({ t: Date.now() - 600000, entry: { kind: 'body', id: 'earth' }, target: 'earth', camPos: [1, 2, 3], rel: [0, 0, 7000], camQuat: [0, 0, 0, 1] })));
await page.reload({ waitUntil: 'load' }); await loaded(); await page.waitForTimeout(800);
w = await where(); ok(w.distR > 2.3 && w.distR < 3.7 && w.orbit, '過期資料（10 分鐘前）→ 正常開場');
ok(errs.length === 0, `console／page 錯誤 0${errs.length ? '：' + errs.join(' | ') : ''}`);
await browser.close();
console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
