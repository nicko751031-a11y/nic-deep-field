#!/usr/bin/env node
// 鍵盤移動時按住 Shift ＝ 光速（負責人 2026-10-27 需求）：W 前進為自動速度（遠低於 c）；按住 Shift 後速度升到 ≥ 0.9 c、
// 狀態列顯示「光速，按住 Shift」與模擬標示；放開 Shift 後降回 < 0.3 c；只按 Shift（無移動輸入）不會移動也不會加速。
// 用法：node tools/boost_test.mjs [baseURL]
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process'; import path from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const base = process.argv[2] || 'http://127.0.0.1:8123/';
const C = 299792.458;
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errs = []; page.on('pageerror', (e) => errs.push('pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/TUNNEL|Failed to load resource|favicon/.test(m.text())) errs.push(m.text().slice(0, 160)); });
await page.goto(`${base}?quality=low`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
await page.waitForFunction(() => !!window.__ndf?.controls, null, { timeout: 30000 });
const state = () => page.evaluate(() => { const c = window.__ndf.controls; return { v: c.velocity.length(), boost: c.boost, moving: c.moving, auto: c.autoSpeed, cur: c.currentSpeed, manual: c.manualSpeed, speedText: document.querySelector('#status .s-speed')?.textContent || '' }; });
const waitFor = (fn, ms) => page.waitForFunction(fn, null, { timeout: ms }).then(() => true, () => false);
// 手動 10 km/s（自動模式的速度隨離天體距離成長，放開後的「原速」不定，故主要流程用手動速度）
await page.evaluate(() => { const c = window.__ndf.controls; c.stop(); c.autoSpeed = false; c.speedLevel = 3; c.manualSpeed = 10; c.onSpeedChange?.(); });
// 1) 只按 W：手動 10 km/s，遠低於光速
await page.keyboard.down('KeyW'); await page.waitForTimeout(2500);
let s = await state();
ok(s.moving && !s.boost && s.v <= 10.5 && s.cur === 10, `W 前進：移動中、未加速、速度 ${s.v.toFixed(2)} km/s（手動 10 km/s）`);
// 2) 加按 Shift：升到光速
await page.keyboard.down('ShiftLeft');
const up = await waitFor(() => { const c = window.__ndf.controls; return c.boost && c.velocity.length() >= 0.9 * 299792.458; }, 40000);
s = await state();
ok(up, `按住 Shift：boost=${s.boost}、速度 ${(s.v / C).toFixed(2)} c（≥ 0.9 c）`);
ok(s.cur === C && !s.auto && s.manual === 10, `目標速度 ${(s.cur / C).toFixed(2)} c；手動速度仍是 10 km/s（放開後回復）`);
await page.waitForTimeout(1200); s = await state();
ok(/光速，按住 Shift/.test(s.speedText) && /光速為模擬效果/.test(s.speedText), `狀態列：「${s.speedText.trim()}」`);
// 3) 放開 Shift：降回原速
await page.keyboard.up('ShiftLeft');
const down = await waitFor(() => { const c = window.__ndf.controls; return !c.boost && c.currentSpeed === 10 && c.velocity.length() < 0.3 * 299792.458; }, 40000);
s = await state();
ok(down, `放開 Shift：boost=${s.boost}、目標 ${s.cur} km/s、速度 ${(s.v / C).toFixed(3)} c（< 0.3 c，持續衰減）`);
await page.waitForTimeout(1200); s = await state();
ok(/（手動）/.test(s.speedText) && !/Shift/.test(s.speedText), `狀態列回復：「${s.speedText.trim()}」`);
await page.keyboard.up('KeyW');
await waitFor(() => !window.__ndf.controls.moving, 40000);
// 4) 自動模式也能加速：目標 ≥ 1 c、自動旗標不變
await page.evaluate(() => { const c = window.__ndf.controls; c.stop(); c.setAutoSpeed(true); });
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft'); await page.waitForTimeout(1500); s = await state();
await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
ok(s.boost && s.cur >= C && s.auto, `自動模式＋Shift：目標 ${(s.cur / C).toFixed(2)} c、仍為自動`);
await waitFor(() => !window.__ndf.controls.moving, 40000);
// 5) 只按 Shift（無移動輸入）：不動、不加速
await page.evaluate(() => window.__ndf.controls.stop());
await page.keyboard.down('ShiftLeft'); await page.waitForTimeout(2500); s = await state(); await page.keyboard.up('ShiftLeft');
ok(!s.moving && !s.boost && s.v === 0, `只按 Shift：不移動（原本的上升別名已移除）、boost=${s.boost}`);
ok(errs.length === 0, `console／page 錯誤 0${errs.length ? '：' + errs.join(' | ') : ''}`);
await browser.close();
console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
