#!/usr/bin/env node
// 無頭 Chromium 實測：載入網站、執行一系列操作並截圖，記錄 console 錯誤與貼圖載入狀態。
// 用法：node space/tools/browser_test.mjs [baseUrl] [outDir] [--mobile]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
// 允許使用全域安裝的 playwright（npm root -g）
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const { chromium, devices } = pw;

const base = process.argv[2] || 'http://127.0.0.1:8123/';
const out = process.argv[3] || 'space/test-output';
const mobile = process.argv.includes('--mobile');
const landscape = process.argv.includes('--landscape');
fs.mkdirSync(out, { recursive: true });
const log = [];
const say = (s) => { log.push(s); console.log(s); };

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctxOpts = mobile ? { ...devices['Pixel 7'], viewport: landscape ? { width: 915, height: 412 } : { width: 412, height: 915 }, hasTouch: true, isMobile: true } : { viewport: { width: 1400, height: 860 } };
const context = await browser.newContext(ctxOpts);
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => errors.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
const shot = async (name) => { await page.screenshot({ path: path.join(out, `${name}.png`) }); say(`screenshot ${name}`); };
const status = async () => (await page.textContent('#status')).replace(/\s+/g, ' ');
const key = async (k, ms = 800) => { await page.keyboard.down(k); await page.waitForTimeout(ms); await page.keyboard.up(k); };

// 開場：淡入中、標題卡顯示
await page.waitForTimeout(3200); await shot(mobile ? (landscape ? 'm-land-00-opening' : 'm-port-00-opening') : '00-opening');
await page.waitForTimeout(4000);
await shot(mobile ? (landscape ? 'm-land-01-earth' : 'm-port-01-earth') : '01-earth-start');
say(`opening flare: ${await page.evaluate(() => JSON.stringify(window.__ndf.engine.flare))}`);
say(`status: ${await status()}`);
const texStatus = await page.evaluate(() => JSON.stringify(window.__ndf?.engine?.textureStatus || {}));
say(`textures: ${texStatus}`);

if (!mobile) {
  // 地球：環繞、靠近、拉遠、停止
  await page.click('#b-orbit'); await page.waitForTimeout(3000); await shot('02-earth-orbit'); say(`orbit status: ${await status()}`);
  await page.click('#b-stop');
  const near = page.locator('#b-near'); await near.dispatchEvent('mousedown'); await page.waitForTimeout(2600); await page.mouse.up(); await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup')));
  await page.waitForTimeout(500); await shot('03-earth-close'); say(`close status: ${await status()}`);
  // 再往前飛試圖穿透
  await key('KeyW', 4000); await page.waitForTimeout(600); await shot('04-earth-collision'); say(`collision status: ${await status()}`);
  const far = page.locator('#b-far'); await far.dispatchEvent('mousedown'); await page.waitForTimeout(2500); await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup')));
  await page.waitForTimeout(300); await shot('05-earth-far');
  // 鏡像檢查：把模擬時間設為台灣正午（04:00 UTC），相機放到台灣正上方並截圖
  await page.evaluate(() => { const e = window.__ndf.engine; e.simTime = Date.UTC(2026, 9, 17, 4, 0, 0); e.timeRate = 0; e.update(0); });
  await page.evaluate(() => window.__ndf.testPlaceOver(23.7, 121.0, 1800));
  await page.waitForTimeout(800); await shot('06-earth-over-taiwan-noon');
  await page.waitForTimeout(4000); say(`earth LOD over Taiwan 1800 km: ${await page.evaluate(() => JSON.stringify(window.__ndf.engine.earthLod?.status() || null))}`);
  await page.evaluate(() => window.__ndf.testPlaceOver(23.7, 121.0, 2500));
  await page.waitForTimeout(800); await shot('06-earth-over-taiwan');
  await page.evaluate(() => window.__ndf.testPlaceOver(0, 20, 9000));
  await page.waitForTimeout(800); await shot('07-earth-over-africa');
  // 九大行星切換
  for (const k of ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto', 'moon', 'sun']) {
    await page.click(`#dest-list button[data-key="${k}"]`); await page.waitForTimeout(2200); await shot(`10-${k}`); say(`${k}: ${await status()}`);
  }
  // 搜尋
  for (const q of ['M31', 'NGC 7293', '天狼星', 'TRAPPIST-1 e', 'Sgr A*', '不存在的星球XYZ']) {
    await page.fill('#q', q); await page.waitForTimeout(400);
    if (q.startsWith('Sgr')) { await page.evaluate(() => { window.__ndf.engine.bhMat.uniforms.uSteps.value = 160; window.__ndf.engine.bhMaxSteps = 160; }); }
    const txt = (await page.textContent('#results')).replace(/\s+/g, ' ').slice(0, 160); say(`search "${q}": ${txt}`);
    if (!q.startsWith('不存在')) { await page.keyboard.press('Enter'); await page.waitForTimeout(2800); await shot(`20-search-${q.replace(/[^A-Za-z0-9一-鿿]/g, '_')}`); say(`arrived: ${await status()}`); }
  }
  // 黑洞近觀：靠近（軟體渲染很慢，先降低步數）
  await page.evaluate(() => { window.__ndf.engine.bhMat.uniforms.uSteps.value = 160; window.__ndf.engine.bhMaxSteps = 160; });
  await page.waitForTimeout(1500); await shot('21-blackhole-arrive');
  await page.evaluate(() => { const c = window.__ndf.controls; c.approach = 1; }); await page.waitForTimeout(2500); await page.evaluate(() => { window.__ndf.controls.approach = 0; });
  await shot('21-blackhole-close');
  // 隱藏介面 / 恢復
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('KeyH'); await page.waitForTimeout(400); await shot('30-hidden-ui');
  const hiddenOk = await page.evaluate(() => document.getElementById('hud').classList.contains('hidden') && document.getElementById('restore').classList.contains('show'));
  say(`hide UI ok: ${hiddenOk}`);
  await page.click('#restore'); await page.waitForTimeout(300);
  // 返回地球（躍遷淡入淡出＋標題卡）+ 時間倍率
  await page.click('#b-earth'); await page.waitForTimeout(1600); await shot('31-earth-titlecard');
  await page.waitForTimeout(2000);
  await page.selectOption('#rate', '86400'); await page.waitForTimeout(2000); await shot('31-earth-timelapse'); say(`timelapse: ${await status()}`);
  await page.selectOption('#rate', '1');
  // 閒置自動淡出：4 秒無輸入 → body.idle；移動滑鼠恢復
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForTimeout(5200); const idle = await page.evaluate(() => document.body.classList.contains('idle')); await shot('32-idle-hud');
  await page.mouse.move(700, 400); await page.waitForTimeout(300); const back = await page.evaluate(() => !document.body.classList.contains('idle'));
  say(`idle hide: ${idle}, restored on input: ${back}`);
  // 寬銀幕黑邊
  await page.keyboard.press('KeyC'); await page.waitForTimeout(400); await shot('33-letterbox'); await page.keyboard.press('KeyC');
  // 真實觀測分頁
  await page.click('#tab-obs'); await page.waitForTimeout(6000); await shot('40-observe-sun');
  const obsText = (await page.textContent('#obs-body')).replace(/\s+/g, ' ').slice(0, 600); say(`observe sun: ${obsText}`);
  await page.click('.obs-tabs button[data-tab="earth"]'); await page.waitForTimeout(6000); await shot('41-observe-earth');
  await page.click('.obs-tabs button[data-tab="iss"]'); await page.waitForTimeout(5000); await shot('42-observe-iss');
  say(`observe iss: ${(await page.textContent('#obs-body')).replace(/\s+/g, ' ').slice(0, 400)}`);
  await page.click('#obs-close'); await page.waitForTimeout(500);
  // 設定面板
  await page.click('#btn-settings'); await page.waitForTimeout(500); await shot('50-settings');
  // GPU 診斷模式：重新載入 ?diag=1，記錄能力、效能與 shader 錯誤數
  await page.goto(base + (base.includes('?') ? '&' : '?') + 'diag=1', { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
  await page.waitForTimeout(4500); await shot('60-diag');
  const diag = await page.evaluate(() => window.__ndfDiag ? JSON.parse(window.__ndfDiag.report()) : null);
  say(`diag: ${diag ? JSON.stringify({ renderer: diag.caps.renderer, depthBits: diag.caps.depthBits, fragHighp: diag.caps.fragHighp, logDepth: diag.caps.logDepth, fps: diag.fps, calls: diag.frame.calls, triangles: diag.frame.triangles, textures: diag.memory.textures, programs: diag.programs, shaderErrors: diag.shaderErrors.length }) : 'diag unavailable'}`);
} else {
  // 手機：目的地按鈕、觸控搖桿、隱藏介面（先送一個輸入事件讓閒置淡出的介面恢復）
  const wake = () => page.evaluate(() => window.dispatchEvent(new Event('pointermove')));
  await wake(); await page.waitForTimeout(400);
  await shot(landscape ? 'm-land-02-ui' : 'm-port-02-ui');
  const overlap = await page.evaluate(() => {
    const rects = [...document.querySelectorAll('#hud button, #hud select, #hud input, #touch button')].filter((b) => b.offsetParent !== null).map((b) => ({ id: b.id || b.textContent.trim().slice(0, 8), r: b.getBoundingClientRect() }));
    const hits = [];
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i].r, b = rects[j].r;
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 4 && oy > 4) hits.push(`${rects[i].id}×${rects[j].id}`);
    }
    const vw = window.innerWidth, vh = window.innerHeight;
    const off = rects.filter(({ r }) => r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1).map((x) => x.id);
    return { count: rects.length, overlaps: hits, offscreen: off };
  });
  say(`mobile buttons: ${JSON.stringify(overlap)}`);
  await page.tap('#dest-list button[data-key="saturn"]'); await page.waitForTimeout(5500); await wake(); await page.waitForTimeout(300); await shot(landscape ? 'm-land-03-saturn' : 'm-port-03-saturn');
  const overlap2 = await page.evaluate(() => {
    const rects = [...document.querySelectorAll('#hud button, #touch button')].filter((b) => b.offsetParent !== null).map((b) => ({ id: b.id || b.textContent.trim().slice(0, 8), r: b.getBoundingClientRect() }));
    const hits = [];
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) { const a = rects[i].r, b = rects[j].r; const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (ox > 4 && oy > 4) hits.push(`${rects[i].id}×${rects[j].id}`); }
    return hits;
  });
  say(`overlaps with info panel open: ${JSON.stringify(overlap2)}`);
  // 觸控：右半邊拖曳環視
  const vw = ctxOpts.viewport.width, vh = ctxOpts.viewport.height;
  const q0 = await page.evaluate(() => window.__ndf.engine.camQuat.toArray().join(','));
  const ly = landscape ? vh * 0.5 : vh * 0.42;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: vw * 0.75, y: ly }] });
  for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: vw * 0.75 - i * 12, y: ly }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);
  const q1 = await page.evaluate(() => window.__ndf.engine.camQuat.toArray().join(','));
  say(`touch look changed camera: ${q0 !== q1}`);
  // 左半邊搖桿前進
  const p0 = await page.evaluate(() => window.__ndf.engine.camPos.join(','));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: vw * 0.2, y: vh * 0.7 }] });
  for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: vw * 0.2, y: vh * 0.7 - i * 10 }] }); await page.waitForTimeout(150); }
  await page.waitForTimeout(1200);
  await shot(landscape ? 'm-land-04-joystick' : 'm-port-04-joystick');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(400);
  const p1 = await page.evaluate(() => window.__ndf.engine.camPos.join(','));
  say(`touch joystick moved camera: ${p0 !== p1}`);
  await page.tap('#btn-hide'); await page.waitForTimeout(400); await shot(landscape ? 'm-land-05-hidden' : 'm-port-05-hidden');
  await page.tap('#restore'); await page.waitForTimeout(300);
  await page.tap('#q'); await page.fill('#q', 'M42'); await page.waitForTimeout(500); await shot(landscape ? 'm-land-06-search' : 'm-port-06-search');
}

say(`console errors/warnings (${errors.length}):`); for (const e of errors.slice(0, 40)) say('  ' + e);
fs.writeFileSync(path.join(out, mobile ? (landscape ? 'log-mobile-landscape.txt' : 'log-mobile-portrait.txt') : 'log-desktop.txt'), log.join('\n'));
await browser.close();
