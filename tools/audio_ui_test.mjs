#!/usr/bin/env node
// 音樂按鈕與設定選單的狀態一致性（無頭 Chromium）：以 init script 把 AudioContext 換成可控假物件，
// 模擬「resume 被拒絕」「resume 成功」「系統暫停」三種情況，驗證介面只在真正 running 時顯示播放中。
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process'; import path from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const base = process.argv[2] || 'http://127.0.0.1:8123/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push('pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
await page.addInitScript(() => {
  class P { constructor(v) { this.value = v; } linearRampToValueAtTime() {} setValueAtTime() {} }
  class N { constructor() { this.gain = new P(1); this.frequency = new P(440); this.detune = new P(0); this.Q = new P(1); this.threshold = new P(0); this.knee = new P(0); this.ratio = new P(1); this.attack = new P(0); this.release = new P(0); } connect() { return this; } disconnect() {} start() { window.__audioLive++; } stop() { window.__audioLive--; } }
  window.__audioLive = 0; window.__audioPolicy = 'reject';
  class FakeCtx {
    constructor() { this.state = 'suspended'; this.sampleRate = 44100; this.currentTime = 0; this.destination = {}; window.__fakeCtx = this; }
    resume() { if (window.__audioPolicy === 'reject') return Promise.reject(new DOMException('NotAllowedError', 'NotAllowedError')); if (window.__audioPolicy === 'hang') return new Promise(() => {}); if (window.__audioPolicy === 'delay') return new Promise((res) => setTimeout(() => { this.state = 'running'; res(); }, 1200)); if (window.__audioPolicy === 'manual') return new Promise((res) => { (window.__resumers ||= []).push(() => { this.state = 'running'; res(); }); }); this.state = 'running'; return Promise.resolve(); }
    createGain() { return new N(); } createOscillator() { return new N(); } createBufferSource() { return new N(); } createBiquadFilter() { return new N(); } createDynamicsCompressor() { return new N(); }
    createBuffer(ch, len, sr) { return { getChannelData: () => new Float32Array(len), length: len, sampleRate: sr }; }
  }
  window.AudioContext = FakeCtx; window.webkitAudioContext = FakeCtx;
});
await page.goto(`${base}?quality=low`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
const ui = () => page.evaluate(() => ({ pressed: document.getElementById('btn-music').getAttribute('aria-pressed'), icon: document.getElementById('btn-music').textContent, sel: document.getElementById('s-audio')?.value, live: window.__audioLive, toast: document.getElementById('toast').textContent, state: window.__fakeCtx?.state }));
// 1) resume 被拒絕：按鈕保持未播放，無節點，toast 說明
await page.click('#btn-music'); await page.waitForTimeout(600);
let s = await ui(); console.log(JSON.stringify(s));
ok(s.pressed === 'false' && s.icon === '♫' && s.live === 0 && /音訊未啟動/.test(s.toast), `resume 拒絕 → 未播放、無節點、提示原因（${s.toast.slice(0, 40)}）`);
// 2) resume 成功：播放中
await page.evaluate(() => { window.__audioPolicy = 'ok'; }); await page.click('#btn-music'); await page.waitForTimeout(600);
s = await ui(); ok(s.pressed === 'true' && s.icon === '♪' && s.live > 0 && s.state === 'running', `resume 成功 → 播放中（節點 ${s.live}）`);
// 3) 設定選單切換到管風琴：播放中、節點數換成新音景；再切靜音：節點 0、按鈕未播放
await page.evaluate(() => { const i = document.getElementById('s-audio'); i.value = 'organ'; i.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(600);
s = await ui(); ok(s.pressed === 'true' && s.live > 0, `選單切管風琴 → 播放中（節點 ${s.live}）`);
await page.evaluate(() => { const i = document.getElementById('s-audio'); i.value = 'off'; i.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(400);
s = await ui(); ok(s.pressed === 'false' && s.live === 0, `選單靜音 → 未播放、節點 0`);
// 4) 系統暫停（iOS interrupted）：介面回到未播放
await page.click('#btn-music'); await page.waitForTimeout(500);
await page.evaluate(() => { window.__fakeCtx.state = 'interrupted'; window.__fakeCtx.onstatechange?.(); }); await page.waitForTimeout(300);
s = await ui(); ok(s.pressed === 'false' && s.live === 0 && s.sel === 'off', `系統暫停 → 未播放、選單回到靜音`);
// 5) 連按 20 次：節點不堆積
await page.evaluate(() => { window.__fakeCtx.state = 'suspended'; });
for (let i = 0; i < 20; i++) { await page.click('#btn-music'); await page.waitForTimeout(120); }
await page.waitForTimeout(500); s = await ui(); ok(s.live <= 6, `連按 20 次後存活節點 ${s.live}（單一音景 ≤ 6）`);
// 6) resume 延遲 1.2 秒：按播放後立刻再按（取消）→ 最終未播放、節點 0，逾時後不會突然播放
await page.evaluate(() => { window.__audioPolicy = 'delay'; window.__fakeCtx.state = 'suspended'; });
await page.click('#btn-music'); await page.waitForTimeout(200); await page.click('#btn-music'); await page.waitForTimeout(2000);
s = await ui(); ok(s.pressed === 'false' && s.live === 0 && s.sel === 'off', `延遲 resume 時播放→取消 → 未播放、節點 ${s.live}`);
// 7) resume 延遲時 ambient→設定改選 organ → 最後只播 organ（節點數為管風琴的 62，而非 ambient 的 4）
await page.evaluate(() => { window.__fakeCtx.state = 'suspended'; });
await page.click('#btn-music'); await page.waitForTimeout(200);
await page.evaluate(() => { const i = document.getElementById('s-audio'); i.value = 'organ'; i.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(2500);
s = await ui(); const organNodes = s.live; ok(s.pressed === 'true' && s.sel === 'organ' && s.live > 10, `延遲 resume 時 ambient→organ → 只播 organ（節點 ${s.live}）`);
// 8) 延遲 resume 下快速切換 20 次（按鈕／選單交錯）：最後一個操作獲勝、無多重音源
await page.evaluate(() => { window.__fakeCtx.state = 'suspended'; });
for (let i = 0; i < 20; i++) { if (i % 2) await page.click('#btn-music'); else await page.evaluate((m) => { const el = document.getElementById('s-audio'); el.value = m; el.dispatchEvent(new Event('change', { bubbles: true })); }, ['ambient', 'organ', 'arc', 'off'][(i / 2) % 4]); await page.waitForTimeout(60); }
await page.waitForTimeout(2500); s = await ui();
ok((s.pressed === 'true') === (s.live > 0) && s.live <= Math.max(organNodes, 70), `快速切換 20 次後狀態一致：pressed=${s.pressed}，節點 ${s.live}，選單 ${s.sel}`);
await page.evaluate(() => { const i = document.getElementById('s-audio'); i.value = 'off'; i.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(300);
s = await ui(); ok(s.live === 0 && s.pressed === 'false', '最後靜音 → 節點 0');
// 9) ABA（GPT 第三次稽核）：A ambient 等待 → B off → C ambient 等待 → 只放行 A（舊）→ 第四次按鈕必須是取消（off），最終靜音、節點 0
await page.evaluate(() => { window.__audioPolicy = 'manual'; window.__resumers = []; window.__fakeCtx.state = 'suspended'; });
await page.click('#btn-music'); await page.waitForTimeout(150); // A
await page.click('#btn-music'); await page.waitForTimeout(150); // B = off（取消）
await page.evaluate(() => { window.__fakeCtx.state = 'suspended'; });
await page.click('#btn-music'); await page.waitForTimeout(150); // C = ambient（等待）
await page.evaluate(() => { const r = window.__resumers.shift(); window.__fakeCtx.state = 'suspended'; r && r(); }); await page.waitForTimeout(300); // 放行 A（舊），注意 A 的 resolver 把 state 設 running；C 仍待放行
await page.evaluate(() => { window.__fakeCtx.state = 'suspended'; });
await page.click('#btn-music'); await page.waitForTimeout(200); // 第四次：應為取消 C
await page.evaluate(() => { for (const r of window.__resumers.splice(0)) r(); }); await page.waitForTimeout(500); // 放行其餘
s = await ui(); ok(s.pressed === 'false' && s.live === 0 && s.sel === 'off', `ABA 錯序：第四次按鈕為取消，最終未播放、節點 ${s.live}、選單 ${s.sel}`);
// 10) 反向：A 等待 → B off → C 等待 → 先放行 C → 再放行 A：C 的播放狀態不被舊 A 蓋掉
await page.evaluate(() => { window.__resumers = []; window.__fakeCtx.state = 'suspended'; });
await page.click('#btn-music'); await page.waitForTimeout(150); await page.click('#btn-music'); await page.waitForTimeout(150);
await page.evaluate(() => { window.__fakeCtx.state = 'suspended'; }); await page.click('#btn-music'); await page.waitForTimeout(150);
await page.evaluate(() => { const rs = window.__resumers; const c = rs.pop(); c && c(); }); await page.waitForTimeout(300);
await page.evaluate(() => { for (const r of window.__resumers.splice(0)) r(); }); await page.waitForTimeout(400);
s = await ui(); ok(s.pressed === 'true' && s.live > 0 && s.sel === 'ambient', `反向完成序：最新操作（C 播放）保持，pressed=${s.pressed}、節點 ${s.live}`);
await page.evaluate(() => { const i = document.getElementById('s-audio'); i.value = 'off'; i.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(300);
const real = errs.filter((e) => !/TUNNEL|Failed to load resource|favicon/.test(e)); ok(real.length === 0, `console／page 錯誤 0${real.length ? '：' + real.join(' | ') : ''}`);
await browser.close();
console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
