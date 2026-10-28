#!/usr/bin/env node
// 觸控裝置目的地列橫向捲動（負責人 2026-10-27 回報：iPhone 上滑到金星就停）。iPhone 直向、Pixel 7 橫向：
// 列表寬度不得超過視窗、內容須溢位可捲、CDP 合成的水平滑動手勢要能把 scrollLeft 推進並讓最後一個目的地（TRAPPIST-1 e）進入視窗；
// 滑動後點目的地仍可前往。用法：node tools/dest_scroll_test.mjs [baseURL]
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process'; import path from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const base = process.argv[2] || 'http://127.0.0.1:8123/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const c of [{ name: 'iphone-portrait', vp: { width: 390, height: 844 }, dpr: 3 }, { name: 'pixel7-landscape', vp: { width: 915, height: 412 }, dpr: 2.625 }]) {
  const ctx = await browser.newContext({ viewport: c.vp, deviceScaleFactor: c.dpr, isMobile: true, hasTouch: true }); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push('pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/TUNNEL|Failed to load resource|favicon/.test(m.text())) errs.push(m.text().slice(0, 160)); });
  await page.goto(`${base}?quality=low`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
  await page.waitForTimeout(500);
  const geo = () => page.evaluate(() => { const l = document.getElementById('dest-list'); const r = l.getBoundingClientRect(); const last = l.lastElementChild.getBoundingClientRect(); return { touch: document.body.classList.contains('touch'), clientWidth: l.clientWidth, scrollWidth: l.scrollWidth, left: r.left, right: r.right, innerWidth: innerWidth, scrollLeft: l.scrollLeft, lastRight: last.right, lastText: l.lastElementChild.textContent.trim(), n: l.children.length, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; });
  let g = await geo(); console.log(c.name, JSON.stringify(g));
  ok(g.touch, `${c.name}：觸控版面`);
  ok(g.right <= g.innerWidth + 1 && g.clientWidth <= g.innerWidth, `${c.name}：列表不超過視窗（右緣 ${Math.round(g.right)} ≤ ${g.innerWidth}）`);
  ok(g.scrollWidth > g.clientWidth + 40, `${c.name}：內容溢位可捲（${g.scrollWidth} > ${g.clientWidth}）`);
  ok(g.lastRight > g.innerWidth, `${c.name}：滑動前最後一個目的地「${g.lastText}」在視窗外（${Math.round(g.lastRight)}）`);
  // CDP 合成水平滑動手勢（模擬手指向左滑）
  const cdp = await ctx.newCDPSession(page);
  // 以 CDP 派發真實的 touch 事件序列（touchStart → 多個 touchMove → touchEnd）模擬手指向左滑
  const swipe = async (x0, y, dx, steps = 12) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] }); for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + dx * i / steps, y }] }); await page.waitForTimeout(16); } await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  for (let i = 0; i < 6; i++) { await swipe(Math.min(g.innerWidth - 20, Math.round(g.left + g.clientWidth * 0.8)), Math.round(g.cy), -Math.round(g.clientWidth * 0.7)); await page.waitForTimeout(250); }
  await page.waitForTimeout(400); g = await geo(); console.log(c.name, 'after swipe', JSON.stringify({ scrollLeft: g.scrollLeft, lastRight: Math.round(g.lastRight) }));
  ok(g.scrollLeft > 100, `${c.name}：滑動後 scrollLeft=${Math.round(g.scrollLeft)}`);
  ok(g.lastRight <= g.innerWidth + 1, `${c.name}：最後一個目的地已進入視窗（${Math.round(g.lastRight)} ≤ ${g.innerWidth}）`);
  // 滑動後點最後一個目的地仍可前往
  await page.evaluate(() => document.getElementById('dest-list').lastElementChild.click()); await page.waitForTimeout(2500);
  const target = await page.evaluate(() => window.__ndf.controls.target); ok(/TRAPPIST|trappist|exo/i.test(String(target)) || target !== 'earth', `${c.name}：點選後目標 ${target}`);
  ok(errs.length === 0, `${c.name}：console／page 錯誤 0${errs.length ? '：' + errs.join(' | ') : ''}`);
  await ctx.close();
}
await browser.close();
console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
