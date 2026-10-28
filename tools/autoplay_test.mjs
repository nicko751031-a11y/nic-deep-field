#!/usr/bin/env node
// 開頁自動播放背景音景（負責人 2026-10-28；GPT 審查 PR #49 的兩個競態）。
// 無頭 Chromium 一開頁就有使用者啟用（navigator.userActivation.hasBeenActive=true），--autoplay-policy 旗標擋不住 WebAudio，
// 所以「被政策擋下」的情境用可控的 AudioContext 模擬：state 被強制為 suspended、resume() 第一次呼叫永遠不解決，
// 直到「手勢內的第二次 resume()」或測試主動解決／拒絕；這正是真實瀏覽器被擋下時的行為。
//  A) 允許自動播放：載入後未操作即播放、按鈕 ♪、不跳「請再點一次」。
//  B) 被擋下：載入後保持靜音且無錯誤提示；第一次點擊畫布後自動播放。
//  C) 按 ♫ 關閉 → 偏好 off → 重新整理不再自動播放；再按開啟 → 偏好 ambient。
//  D) 安全模式 ?safe=1 不自動播放。
//  E) 錯序：第一個手勢早於首次嘗試的失敗 → 手勢內的新嘗試成功，舊嘗試稍後失敗不影響，只有一組音源節點。
//  F) 錯序：首次嘗試等待期間按 ♫ 關閉 → 之後舊嘗試失敗、再多次點畫布 → 仍靜音、偏好 off、節點 0。
//  G) 錯序：首次嘗試等待期間在設定切到 organ → 舊 ambient 失敗不影響，最終 organ。
//  H) 被擋下時第一次操作就是按 ♫：視為「開啟」而不是取消，結果播放中。
//  I) 連續 20 次點畫布：節點只有一組、無 page 錯誤／unhandled rejection。
// 用法：node tools/autoplay_test.mjs [baseURL]
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process'; import path from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const base = process.argv[2] || 'http://127.0.0.1:8123/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const loadDone = (page) => page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
const state = (page) => page.evaluate(() => ({ ...(window.__ndf?.audioState?.() || {}), btn: document.getElementById('btn-music')?.textContent, pressed: document.getElementById('btn-music')?.getAttribute('aria-pressed'), toast: document.getElementById('toast')?.textContent || '', pref: localStorage.getItem('ndf-audio'), calls: window.__resume?.calls }));
const waitPressed = (page, v, ms = 10000) => page.waitForFunction((v) => document.getElementById('btn-music')?.getAttribute('aria-pressed') === v, v, { timeout: ms }).then(() => true, () => false);
const errsOf = (page) => { const errs = []; page.on('pageerror', (e) => errs.push('pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/TUNNEL|Failed to load resource|favicon/.test(m.text())) errs.push(m.text().slice(0, 120)); }); return errs; };
// 模擬「被政策擋下」：state 強制 suspended；第 1 次 resume() 永遠 pending（由測試 res/rej）；第 2 次起視為手勢內的呼叫 → 解除強制並真正 resume
const BLOCKED = `(() => {
  const P = (window.AudioContext || window.webkitAudioContext)?.prototype; if (!P) return;
  const origResume = P.resume;
  let proto = P, stateDesc = null; while (proto && !(stateDesc = Object.getOwnPropertyDescriptor(proto, 'state'))) proto = Object.getPrototypeOf(proto); // state 定義在 BaseAudioContext.prototype
  const R = window.__resume = { calls: 0, pending: [], forced: true };
  Object.defineProperty(P, 'state', { configurable: true, get() { return R.forced ? 'suspended' : stateDesc.get.call(this); } });
  P.resume = function () { R.calls++;
    if (R.calls === 1) return new Promise((res, rej) => { R.pending.push({ res: () => { R.forced = false; origResume.call(this).then(res); }, rej: () => rej(new Error('blocked')) }); });
    R.forced = false; return origResume.call(this); };
})();`;
const open = async (args, init) => { const browser = await pw.chromium.launch({ args: [...GL, ...args] }); const page = await browser.newPage({ viewport: { width: 900, height: 600 } }); const errs = errsOf(page); if (init) await page.addInitScript(init); return { browser, page, errs }; };
// ---- A／C／D：允許自動播放（無頭 Chromium 本來就允許）
{
  const { browser, page, errs } = await open([]);
  await page.goto(`${base}?quality=low`, { waitUntil: 'load' }); await loadDone(page);
  await waitPressed(page, 'true', 15000); let s = await state(page);
  ok(s.pressed === 'true' && s.btn === '♪' && s.nodes > 0, `A 允許自動播放：載入後未操作即播放（按鈕 ${s.btn}、節點 ${s.nodes}）`);
  ok(!/音訊未啟動/.test(s.toast), `A 無「音訊未啟動」提示`);
  await page.click('#btn-music'); await page.waitForTimeout(800); s = await state(page);
  ok(s.pressed === 'false' && s.pref === 'off' && s.nodes === 0, `C 按鈕關閉：aria-pressed ${s.pressed}、偏好 ${s.pref}、節點 ${s.nodes}`);
  await page.reload({ waitUntil: 'load' }); await loadDone(page); await page.waitForTimeout(4000); s = await state(page);
  ok(s.pressed === 'false' && s.nodes === 0, `C 偏好 off 時重新整理不自動播放（aria-pressed ${s.pressed}）`);
  await page.click('#btn-music'); await waitPressed(page, 'true'); s = await state(page);
  ok(s.pressed === 'true' && s.pref === 'ambient', `C 再按開啟：aria-pressed ${s.pressed}、偏好 ${s.pref}`);
  await page.goto(`${base}?quality=low&safe=1`, { waitUntil: 'load' }); await loadDone(page); await page.waitForTimeout(4000); s = await state(page);
  ok(s.pressed === 'false' && s.nodes === 0, `D 安全模式不自動播放（aria-pressed ${s.pressed}）`);
  ok(errs.length === 0, `A/C/D page 錯誤 0${errs.length ? '：' + errs.join(' | ') : ''}`);
  await browser.close();
}
// ---- 被擋下的情境（BLOCKED 模擬）
const blocked = async (label, run) => {
  const { browser, page, errs } = await open([], BLOCKED);
  await page.goto(`${base}?quality=low`, { waitUntil: 'load' }); await loadDone(page);
  await page.waitForFunction(() => window.__resume && window.__resume.calls >= 1, null, { timeout: 15000 });
  await run(page);
  ok(errs.length === 0, `${label} page 錯誤／unhandled rejection 0${errs.length ? '：' + errs.join(' | ') : ''}`);
  await browser.close();
};
await blocked('B/I', async (page) => {
  await page.waitForTimeout(4500); let s = await state(page); // 超過 3 秒逾時：首次嘗試已失敗
  ok(s.pressed === 'false' && s.nodes === 0 && !/音訊未啟動/.test(s.toast), `B 被擋下：保持靜音、不跳錯誤提示（aria-pressed ${s.pressed}，toast「${s.toast.slice(0, 20)}」）`);
  await page.mouse.click(450, 300); const started = await waitPressed(page, 'true'); s = await state(page);
  ok(started && s.nodes > 0 && s.calls >= 2, `B 第一次點擊畫布後自動播放（aria-pressed ${s.pressed}、節點 ${s.nodes}、resume 呼叫 ${s.calls}）`);
  for (let i = 0; i < 20; i++) await page.mouse.click(400 + (i % 5) * 20, 320 + (i % 3) * 10);
  await page.waitForTimeout(1500); const s20 = await state(page);
  ok(s20.nodes === s.nodes && s20.pressed === 'true', `I 連續 20 次點畫布：節點仍 ${s20.nodes}（不疊加）、播放中`);
});
await blocked('E', async (page) => {
  let s = await state(page); ok(s.pending && s.pending.auto === true && s.nodes === 0, `E 首次自動嘗試等待中（pending auto、節點 0）`);
  await page.mouse.click(450, 300); // 第一個手勢早於首次嘗試失敗
  const started = await waitPressed(page, 'true'); s = await state(page);
  ok(started && s.nodes > 0, `E 手勢內的新嘗試成功（節點 ${s.nodes}）`);
  await page.evaluate(() => window.__resume.pending.forEach((p) => p.rej())); await page.waitForTimeout(1200); s = await state(page);
  ok(s.pressed === 'true' && s.nodes > 0, `E 舊嘗試稍後失敗不影響（仍播放，節點 ${s.nodes}）`);
});
await blocked('F', async (page) => {
  await page.click('#btn-music'); await page.waitForTimeout(600); let s = await state(page);
  // 自動嘗試等待中按 ♫ ＝ 開啟（H 的規則）；再按一次 ＝ 關閉
  await page.click('#btn-music'); await page.waitForTimeout(600); s = await state(page);
  ok(s.pressed === 'false' && s.pref === 'off', `F 等待期間按 ♫ 兩次（開→關）：aria-pressed ${s.pressed}、偏好 ${s.pref}`);
  await page.evaluate(() => window.__resume.pending.forEach((p) => p.rej())); await page.waitForTimeout(800);
  for (let i = 0; i < 5; i++) await page.mouse.click(450 + i * 10, 300);
  await page.waitForTimeout(1500); s = await state(page);
  ok(s.pressed === 'false' && s.pref === 'off' && s.nodes === 0 && s.mode === 'off', `F 之後多次點畫布仍靜音（mode ${s.mode}、節點 ${s.nodes}、偏好 ${s.pref}）`);
});
await blocked('G', async (page) => {
  await page.click('#btn-settings'); await page.waitForTimeout(300);
  await page.selectOption('#s-audio', 'organ'); const started = await waitPressed(page, 'true'); let s = await state(page);
  ok(started && s.mode === 'organ' && s.pref === 'organ', `G 等待期間切 organ：mode ${s.mode}、偏好 ${s.pref}`);
  await page.evaluate(() => window.__resume.pending.forEach((p) => p.rej())); await page.waitForTimeout(1200); s = await state(page);
  ok(s.mode === 'organ' && s.nodes > 0, `G 舊 ambient 失敗後仍為 organ（節點 ${s.nodes}）`);
});
await blocked('H', async (page) => {
  await page.click('#btn-music'); const h = await waitPressed(page, 'true'); const s = await state(page);
  ok(h && s.pressed === 'true' && s.nodes > 0 && s.pref === 'ambient', `H 被擋下時第一次操作是按 ♫：視為開啟，結果播放中（aria-pressed ${s.pressed}、偏好 ${s.pref}）`);
});
console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
