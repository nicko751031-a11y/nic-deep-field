#!/usr/bin/env node
// 搜尋結果無障礙（AUDIT F2）：combobox／listbox／option 角色、aria-expanded、aria-activedescendant、aria-selected 隨鍵盤選擇更新；
// Enter 前往所選、Escape 關閉；無結果時以 role="status" 說明。用法：node tools/search_aria_test.mjs [baseURL]
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process'; import path from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const base = process.argv[2] || 'http://127.0.0.1:8123/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push('pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/TUNNEL|Failed to load resource|favicon/.test(m.text())) errs.push(m.text().slice(0, 160)); });
await page.goto(`${base}?quality=low`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
const aria = () => page.evaluate(() => { const q = document.getElementById('q'), r = document.getElementById('results'); const opts = [...r.querySelectorAll('[role="option"]')]; return { qRole: q.getAttribute('role'), qLabel: q.getAttribute('aria-label'), auto: q.getAttribute('aria-autocomplete'), controls: q.getAttribute('aria-controls'), expanded: q.getAttribute('aria-expanded'), active: q.getAttribute('aria-activedescendant'), listRole: r.getAttribute('role'), open: r.classList.contains('open'), n: opts.length, ids: opts.map((o) => o.id), selected: opts.map((o) => o.getAttribute('aria-selected')), status: r.querySelector('[role="status"]')?.textContent || '' }; });
let s = await aria();
ok(s.qRole === 'combobox' && s.auto === 'list' && s.controls === 'results' && s.listRole === 'listbox' && !!s.qLabel, `靜態角色：input=combobox（aria-label「${s.qLabel}」）、results=listbox`);
ok(s.expanded === 'false' && !s.active, '未搜尋：aria-expanded=false、無 activedescendant');
await page.click('#q'); await page.keyboard.type('M4'); await page.waitForTimeout(400);
s = await aria(); console.log(JSON.stringify(s));
ok(s.open && s.expanded === 'true' && s.n > 0 && s.ids.every((id, i) => id === `r-${i}`), `輸入「M4」：展開、${s.n} 個 option（id r-0…）`);
ok(s.selected.every((v) => v === 'false') && !s.active, '尚未用鍵盤選擇：全部 aria-selected=false、無 activedescendant');
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(100); s = await aria();
ok(s.active === 'r-0' && s.selected[0] === 'true' && s.selected.slice(1).every((v) => v === 'false'), '↓ 一次：activedescendant=r-0、只有 r-0 aria-selected=true');
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(100); s = await aria();
ok(s.n < 2 || (s.active === 'r-1' && s.selected[1] === 'true' && s.selected[0] === 'false'), '↓ 兩次：activedescendant=r-1');
await page.keyboard.press('ArrowUp'); await page.waitForTimeout(100); s = await aria();
ok(s.active === 'r-0' && s.selected[0] === 'true', '↑：回到 r-0');
await page.keyboard.press('Escape'); await page.waitForTimeout(200); s = await aria();
ok(!s.open && s.expanded === 'false' && !s.active, 'Escape：收合、aria-expanded=false、無 activedescendant');
// Enter 前往第一筆（木星）
await page.click('#q'); await page.fill('#q', '木星'); await page.waitForTimeout(400); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(2500);
const target = await page.evaluate(() => window.__ndf.controls.target); ok(target === 'jupiter', `Enter 前往所選：目標 ${target}`);
s = await aria(); ok(!s.open && s.expanded === 'false', '前往後結果已收合');
// 無結果：role=status 說明
await page.click('#q'); await page.fill('#q', 'zzzzqqq'); await page.waitForTimeout(400); s = await aria();
ok(s.open && s.n === 0 && /未收錄/.test(s.status) && s.expanded === 'true', `無結果：role=status「${s.status.slice(0, 16)}…」`);
await page.keyboard.press('Escape');
ok(errs.length === 0, `console／page 錯誤 0${errs.length ? '：' + errs.join(' | ') : ''}`);
await browser.close();
console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
