#!/usr/bin/env node
// 畫面觀感量測（負責人 2026-10-28「要《星際效應》的真實感」；GPT 審查 PR #48 要求局部 ROI 與手機尺寸）：
// 固定六個視角截圖並量測亮度分布，再加局部檢查——黑洞中心（事件視界）必須黑、地球邊緣不可變成白描邊、
// 黑洞截圖須在速度 0、躍遷特效結束後拍。另以 iPhone 直向（390×844、中畫質、顯示 HUD）補三張。
// 門檻為「不要退步」的守門值，不是美術標準；美術驗收仍由 GPT 看圖。
// 用法：node tools/look_test.mjs [baseURL] [outDir]   （outDir 預設 docs/screens，檔名 look-*.jpg、look-m-*.jpg）
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process'; import path from 'node:path'; import fs from 'node:fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const base = process.argv[2] || 'http://127.0.0.1:8123/'; const outDir = process.argv[3] || 'docs/screens'; fs.mkdirSync(outDir, { recursive: true });
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await pw.chromium.launch({ args: GL });
const errs = [];
const hook = (page) => { page.on('pageerror', (e) => errs.push('pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/TUNNEL|Failed to load resource|favicon/.test(m.text())) errs.push(m.text().slice(0, 160)); }); };
const loaded = (page) => page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done') && !!window.__ndf?.controls, null, { timeout: 180000 });
const settle = async (page, n = 4) => { const f0 = await page.evaluate(() => window.__ndf.engine.renderer.info.render.frame); await page.waitForFunction((f) => window.__ndf.engine.renderer.info.render.frame >= f, f0 + n, { timeout: 240000 }); };
const hideUi = (page) => page.evaluate(() => { document.getElementById('hud').style.visibility = 'hidden'; document.getElementById('labels').style.display = 'none'; const l = document.getElementById('loading'); if (l) l.style.display = 'none'; window.__ndf.engine.showLabels = false; });
// 截圖＋量測：全畫面統計與可選的 ROI（圓心／半徑以 CSS px 計）
const measure = async (page, name, roi = null) => {
  const file = path.join(outDir, `look-${name}.jpg`); await page.screenshot({ path: file, type: 'jpeg', quality: 84, timeout: 180000 });
  if (roi) roi = { ...roi, vw: page.viewportSize().width };
  const buf = fs.readFileSync(file).toString('base64');
  const m = await page.evaluate(async ([b64, roi]) => {
    const img = new Image(); img.src = 'data:image/jpeg;base64,' + b64; await img.decode();
    const W = img.width, H = img.height; const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, W, H).data;
    const L = (i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    let sum = 0, hi = 0, lo = 0, n = 0, sat = 0;
    for (let i = 0; i < d.length; i += 16) { const l = L(i); sum += l; n++; if (l > 240) hi++; if (l < 6) lo++; const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); if (mx > 40) sat += (mx - mn) / mx; }
    const out = { mean: sum / n, hi: hi / n, lo: lo / n, sat: sat / n };
    if (roi) { // roi: { cx, cy, r, ring: [r0, r1] }（CSS px）：中心圓內平均、環帶平均；截圖為裝置像素，依 DPR 縮放
      const k = W / roi.vw; const cx = roi.cx * k, cy = roi.cy * k, r = roi.r * k, ring = roi.ring ? roi.ring.map((v) => v * k) : null;
      let cs = 0, cn = 0, rs = 0, rn = 0;
      for (let j = 0; j < H; j += 2) for (let i = 0; i < W; i += 2) { const dd = Math.hypot(i - cx, j - cy); const k = (j * W + i) * 4; if (dd < r) { cs += L(k); cn++; } if (ring && dd >= ring[0] && dd <= ring[1]) { rs += L(k); rn++; } }
      out.centre = cn ? cs / cn : null; out.ring = rn ? rs / rn : null;
    }
    return out;
  }, [buf, roi]);
  console.log(`${name.padEnd(12)} 平均 ${m.mean.toFixed(1)}  過曝 ${(m.hi * 100).toFixed(2)}%  深黑 ${(m.lo * 100).toFixed(1)}%  飽和度 ${m.sat.toFixed(3)}${m.centre != null ? `  中心 ${m.centre.toFixed(1)}` : ''}${m.ring != null ? `  環帶 ${m.ring.toFixed(1)}` : ''}`);
  return m;
};
const go = async (page, key) => page.evaluate(async (key) => { const cat = window.__ndf.catalog; const ent = key === 'bh' ? cat.entries.find((x) => x.kind === 'bh') : cat.entries.find((x) => x.kind === 'body' && x.id === key); await window.__ndf.goTo(ent, { instant: true }); }, key);
const earthDay = (page) => page.evaluate(() => { const e = window.__ndf.engine, c = window.__ndf.controls; c.stop(); const earth = e.bodies.get('earth'); const sun = [-earth.pos[0], -earth.pos[1], -earth.pos[2]]; const Ls = Math.hypot(...sun); const s = sun.map((v) => v / Ls); const up = [0, 1, 0]; const side = [s[0] * 0.85 + up[0] * 0.5, s[1] * 0.85 + up[1] * 0.5, s[2] * 0.85 + up[2] * 0.5]; const l2 = Math.hypot(...side); const d = 6371 * 3.2; e.camPos = [earth.pos[0] + side[0] / l2 * d, earth.pos[1] + side[1] / l2 * d, earth.pos[2] + side[2] / l2 * d]; c.lookAt(new (c.velocity.constructor)(-side[0], -side[1], -side[2])); c.target = 'earth'; });
// 黑洞：到達後停止、等躍遷特效（2.5 秒）結束，並回報速度，確保截圖不是飛行拉絲
const fxPixels = () => { const c = document.getElementById('fx'); const x = c.getContext('2d'); const w = Math.min(c.width, 256), h = Math.min(c.height, 256); const d = x.getImageData(0, 0, w, h).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++; return n; };
const bhSettle = async (page) => {
  await page.evaluate(() => { window.__ndf.controls.stop(); }); await page.waitForTimeout(3500); await settle(page, 6);
  // 等 2D 特效畫布（躍遷拉絲）清空，最多 12 秒；清不掉就回報（會讓「速度 0」那項連同 fx 像素數一起顯示）
  await page.waitForFunction(fxPixels.toString().replace('const fxPixels = ', '') ? `(${fxPixels.toString()})() === 0` : 'true', null, { timeout: 12000 }).catch(() => {});
  return page.evaluate(`(() => { const c = window.__ndf.controls; return { v: c.velocity.length(), moving: c.moving, fx: (${fxPixels.toString()})() }; })()`);
};

// ---------- 桌面 1280×720、高畫質、隱藏 HUD
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); hook(page);
await page.goto(`${base}?quality=high`, { waitUntil: 'load' }); await loaded(page);
await page.waitForTimeout(7000); await hideUi(page); await settle(page); const opening = await measure(page, 'opening');
await earthDay(page); await settle(page, 6);
// 地球盤面：相機 3.2 R、垂直視角 50° → 盤面半徑約 254 px；中心圓 r<200 與邊緣環帶 240–262 對照
const earth = await measure(page, 'earth-day', { cx: 640, cy: 360, r: 200, ring: [240, 262] });
const goShot = async (key, name, roi) => { await go(page, key); await page.waitForTimeout(1500); await hideUi(page); await settle(page, 8); return measure(page, name, roi); };
const saturn = await goShot('saturn', 'saturn'); const jupiter = await goShot('jupiter', 'jupiter'); const sun = await goShot('sun', 'sun', { cx: 640, cy: 360, r: 30, ring: [90, 110] });
await go(page, 'bh'); await page.waitForTimeout(1500); await hideUi(page); const bhv = await bhSettle(page);
// 事件視界陰影在畫面中心略偏上（吸積盤近側從下方穿過），ROI 取 46% 高度處
const bh = await measure(page, 'blackhole', { cx: 640, cy: Math.round(720 * 0.46), r: 22, ring: [60, 90] });
console.log(`blackhole    速度 ${bhv.v.toExponential(2)} km/s、moving=${bhv.moving}、特效畫布非透明像素 ${bhv.fx}（左上 256×256）`);
await page.close();
// ---------- 手機直向 390×844、中畫質、顯示 HUD（GPT 審查：構圖與 HUD 一起看）
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const mp = await mctx.newPage(); hook(mp);
await mp.goto(`${base}?quality=medium`, { waitUntil: 'load' }); await loaded(mp); await mp.waitForTimeout(7000); await settle(mp); await mp.touchscreen.tap(195, 500); await mp.waitForTimeout(300);
const mOpening = await measure(mp, 'm-opening');
await earthDay(mp); await settle(mp, 6); const mEarth = await measure(mp, 'm-earth-day');
await go(mp, 'bh'); await mp.waitForTimeout(1500); await bhSettle(mp); const mBh = await measure(mp, 'm-blackhole', { cx: 195, cy: Math.round(844 * 0.46), r: 14 });
await mctx.close();
// ---------- 守門（不退步）
ok(earth.hi < 0.12 && earth.mean > 25, `地球日側：過曝 ${(earth.hi * 100).toFixed(1)}% < 12%、平均 ${earth.mean.toFixed(1)} > 25`);
ok(earth.ring != null && earth.ring < 215 && earth.ring < earth.centre * 1.6, `地球邊緣環帶 ${earth.ring?.toFixed(1)} 不是白描邊（< 215 且 < 中心 ${earth.centre?.toFixed(1)} 的 1.6 倍）`);
ok(saturn.hi < 0.08 && saturn.mean > 8, `土星：過曝 ${(saturn.hi * 100).toFixed(1)}% < 8%、平均 ${saturn.mean.toFixed(1)} > 8`);
ok(jupiter.hi < 0.08 && jupiter.mean > 8, `木星：過曝 ${(jupiter.hi * 100).toFixed(1)}% < 8%、平均 ${jupiter.mean.toFixed(1)} > 8`);
ok(sun.hi > 0.002 && sun.hi < 0.35, `太陽：過曝 ${(sun.hi * 100).toFixed(2)}%（0.2%–35%：有刺眼的白盤，但不是整片）`);
ok(sun.centre > 230 && sun.ring < sun.centre * 0.8, `太陽日盤中心 ${sun.centre?.toFixed(0)} 亮、盤外環帶 ${sun.ring?.toFixed(0)} 明顯較暗（邊界可辨識）`);
ok(bh.hi > 0.0005 && bh.mean > 4, `黑洞：有高光（過曝 ${(bh.hi * 100).toFixed(2)}%）、平均 ${bh.mean.toFixed(1)} > 4`);
ok(bh.centre != null && bh.centre < 14, `黑洞中心（事件視界）平均 ${bh.centre?.toFixed(1)} < 14（必須黑，Bloom 不可擴散進去）`);
ok(bhv.v < 1 && !bhv.moving && bhv.fx === 0, `黑洞截圖時速度 0 且無躍遷拉絲殘留（${bhv.v.toExponential(1)} km/s，moving=${bhv.moving}，fx 像素 ${bhv.fx}）`);
ok(opening.lo > 0.3, `開場：深黑比例 ${(opening.lo * 100).toFixed(1)}% > 30%（夜側與太空真的黑）`);
ok(mBh.centre != null && mBh.centre < 14, `手機黑洞中心 ${mBh.centre?.toFixed(1)} < 14`);
ok(mEarth.hi < 0.15 && mOpening.lo > 0.25, `手機：地球日側過曝 ${(mEarth.hi * 100).toFixed(1)}% < 15%、開場深黑 ${(mOpening.lo * 100).toFixed(1)}% > 25%`);
ok(errs.length === 0, `console／page 錯誤 0${errs.length ? '：' + errs.join(' | ') : ''}`);
await browser.close();
console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
