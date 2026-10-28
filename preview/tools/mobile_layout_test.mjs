#!/usr/bin/env node
// 手機版面整合回歸（PR #47 標準字 + #48 觀感 + #50 手機頂列）：直向 320／375／390／430、橫向 844／915 CSS px，
// 檢查 #btn-music、#q、.topright、.brand、目的地列、觸控鈕、資訊卡與 safe area 不重疊且不出框；
// 搜尋結果開合、音樂鈕啟停（aria-pressed）、H 隱藏介面→#restore→恢復、閒置淡出→輸入恢復；console／page 錯誤 0。
// 用法：node tools/mobile_layout_test.mjs [baseURL] [截圖目錄]
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process'; import path from 'node:path'; import fs from 'node:fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const base = process.argv[2] || 'http://127.0.0.1:8123/'; const out = process.argv[3] || ''; if (out) fs.mkdirSync(out, { recursive: true });
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const SIZES = [[320, 700], [375, 812], [390, 844], [430, 932], [812, 375], [844, 390], [915, 412], [956, 440]];
// 橫向另測左右 safe-area（iPhone 瀏海側 59 px）：以 :root 的 --sal／--sar 覆寫 env()，與 GPT 夾具同一假設
const SAFE = [['none', 0, 0], ['left59', 59, 0], ['right59', 0, 59]];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
// 幾何：可見元素的矩形、兩兩相交、出框
const geometry = () => page.evaluate(() => {
  // 比對的是可互動／可讀的元素本身（目的地列的每個按鈕、資訊卡的關閉／詳情鈕與標題），不是容器外框：
  // 容器（#info、#dest）在手機上橫跨整個寬度，外框與觸控鈕相交但內容已留白，不算重疊。
  const sel = ['.brand', '#q', '.topright', '#btn-music', '#dest-list button', '#info button', '#info h2', '#restore', '#touch button', '#joy', '.status', '#wx-note'];
  const vw = window.innerWidth, vh = window.innerHeight;
  const vis = (el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const items = [];
  for (const s of sel) for (const el of document.querySelectorAll(s)) {
    if (!vis(el)) continue;
    // 標題 h2 是整行寬的區塊，實際文字只佔左側；用文字 Range 的矩形（關閉／詳情鈕絕對定位在同一行右端）
    const r = s === '#info h2' ? (() => { const rg = document.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect(); })() : el.getBoundingClientRect();
    // 目的地列可橫向捲動：捲出可視範圍（被 #dest 裁掉）的按鈕不算
    if (s === '#dest-list button') { const c = document.getElementById('dest').getBoundingClientRect(); if (r.right <= c.left + 0.5 || r.left >= c.right - 0.5) continue; }
    items.push({ id: el.id || (el.dataset?.key ? `dest:${el.dataset.key}` : s), x: Math.max(r.left, 0), y: r.top, w: r.width, h: r.height });
  }
  const inter = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5;
  const hits = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (inter(a, b)) hits.push(`${a.id}×${b.id}`);
  }
  const off = items.filter((r) => !r.id.startsWith('dest:') && (r.x < -0.5 || r.y < -0.5 || r.x + r.w > vw + 0.5 || r.y + r.h > vh + 0.5)).map((r) => `${r.id}(${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)}×${Math.round(r.h)})`);
  const music = document.getElementById('btn-music').getBoundingClientRect(), q = document.getElementById('q').getBoundingClientRect();
  return { n: items.length, hits, off, music: { x: Math.round(music.left), y: Math.round(music.top), w: Math.round(music.width), h: Math.round(music.height) }, q: { x: Math.round(q.left), y: Math.round(q.top), w: Math.round(q.width), h: Math.round(q.height), fs: getComputedStyle(document.getElementById('q')).fontSize } };
});
let page;
const wake = async (W, H) => { await page.touchscreen.tap(W / 2, H / 2); await page.waitForFunction(() => !document.body.classList.contains('idle'), null, { timeout: 3000 }).catch(() => {}); await page.waitForTimeout(1300); };
const diagLabels = () => page.evaluate(() => {
  const vis = (el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const R = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const inter = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5;
  const zones = [['top', document.querySelector('#hud .top')], ['bottom', document.querySelector('#hud .bottom')], ['music', document.getElementById('btn-music')], ['info', document.getElementById('info')], ...[...document.querySelectorAll('#touch button, #joy')].map((b) => [b.id || 'touch', b])].filter(([, el]) => el && vis(el)).map(([n, el]) => [n, R(el)]);
  const labels = [...document.querySelectorAll('#labels .lbl')].filter(vis).map((el) => ({ name: el.textContent.trim().slice(0, 12), r: R(el) }));
  const hits = []; for (const l of labels) for (const [n, z] of zones) if (inter(l.r, z)) hits.push(`${l.name}(${Math.round(l.r.x)},${Math.round(l.r.y)},${Math.round(l.r.w)}×${Math.round(l.r.h)})×${n}(${Math.round(z.y)}–${Math.round(z.y + z.h)})`);
  return { labels: labels.length, hits };
});
const diagToast = () => page.evaluate(() => {
  const t = document.getElementById('toast'); if (!t || !t.classList.contains('show')) return null;
  const R = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const inter = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5;
  const tr = R(t); const vs = (el) => el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
  const zones = [['status', document.querySelector('.status')], ['bottom', document.querySelector('#hud .bottom')], ['info', document.getElementById('info')], ['joy', document.getElementById('joy')], ['t-up', document.getElementById('t-up')], ['t-down', document.getElementById('t-down')]].filter(([, el]) => vs(el)).map(([n, el]) => [n, R(el)]);
  return { toast: tr, infoOpen: vs(document.getElementById('info')), hits: zones.filter(([, z]) => inter(tr, z)).map(([n, z]) => `${n}(${z.x},${z.y},${z.w}×${z.h})`) };
});
for (const [W, H] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push('pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/TUNNEL|Failed to load resource|favicon/.test(m.text())) errs.push(m.text().slice(0, 160)); });
  await page.goto(`${base}?quality=low`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done') && !!window.__ndf?.controls, null, { timeout: 180000 });
  await page.waitForTimeout(2500);
  // 讓開場標題卡過去、HUD 可見
  await page.evaluate(() => { document.getElementById('title-card')?.classList.remove('show'); });
  await page.mouse.move(W / 2, H / 2); await page.waitForTimeout(300);
  const tag = `${W}x${H}`;
  // 觸控提示（main.js：觸控裝置載入後 6 秒 toast 7 秒）vs 狀態列／資訊卡：定量診斷（交 GPT 決定視覺策略，不當守門）
  let toastSeen = false;
  try { await page.waitForSelector('#toast.show', { timeout: 9000 }); toastSeen = true; } catch {}
  if (toastSeen) {
    let d = await diagToast(); console.log(`${tag} 診斷 觸控提示 ${JSON.stringify(d?.toast)} 資訊卡${d?.infoOpen ? '開' : '關'}：${d?.hits.length ? '與 ' + d.hits.join('、') + ' 相交' : '無相交'}`);
    if (d?.infoOpen) { await page.evaluate(() => { document.getElementById('info').style.display = 'none'; }); await page.waitForTimeout(200); d = await diagToast(); if (d) console.log(`${tag} 診斷 觸控提示 ${JSON.stringify(d.toast)} 資訊卡關：${d.hits.length ? '與 ' + d.hits.join('、') + ' 相交' : '無相交'}`); if (out && W >= 760) { await wake(W, H); await page.screenshot({ path: `${out}/int-${tag}-toast.jpg`, type: 'jpeg', quality: 85 }); } await page.evaluate(() => { document.getElementById('info').style.display = ''; }); }
    await page.waitForSelector('#toast:not(.show)', { timeout: 9000 }).catch(() => {});
  } else console.log(`${tag} 診斷 觸控提示 9 秒內未出現`);
  let g = await geometry();
  console.log(`${tag}: ${g.n} 個元素，music=${JSON.stringify(g.music)} q=${JSON.stringify(g.q)}`);
  ok(g.hits.length === 0, `${tag} HUD 不重疊${g.hits.length ? '：' + g.hits.join(', ') : ''}`);
  ok(g.off.length === 0, `${tag} 不出框${g.off.length ? '：' + g.off.join(', ') : ''}`);
  if (W <= 760) { ok(g.q.h >= 44 && parseFloat(g.q.fs) >= 16, `${tag} 搜尋欄高 ${g.q.h} ≥ 44、字體 ${g.q.fs} ≥ 16px（PR #50）`); ok(g.music.y < g.q.y, `${tag} 音樂鈕（y=${g.music.y}）在搜尋欄（y=${g.q.y}）上方的頂列`); }
  if (out) { await wake(W, H); await page.screenshot({ path: `${out}/int-${tag}.jpg`, type: 'jpeg', quality: 85 }); }
  if (W > H) {
    for (const [sn, sl, sr0] of SAFE) {
      await page.evaluate(([l, r]) => { document.documentElement.style.setProperty('--sal', l + 'px'); document.documentElement.style.setProperty('--sar', r + 'px'); }, [sl, sr0]);
      await page.waitForTimeout(150);
      // 目的地列捲到最後（♫ 不得蓋住最後一個按鈕）
      await page.evaluate(() => { const l = document.querySelector('.dest .list'); if (l) l.scrollLeft = l.scrollWidth; });
      await page.waitForTimeout(150);
      const gs = await geometry();
      ok(gs.hits.length === 0 && gs.off.length === 0, `${tag} safe-area ${sn}、目的地列捲到最後：不重疊、不出框${gs.hits.length ? '：' + gs.hits.join(', ') : ''}${gs.off.length ? '；出框 ' + gs.off.join(', ') : ''}（♫ x=${gs.music.x}）`);
      if (out && sn !== 'none') { await wake(W, H); await page.screenshot({ path: `${out}/int-${tag}-${sn}.jpg`, type: 'jpeg', quality: 85 }); }
      await page.evaluate(() => { const l = document.querySelector('.dest .list'); if (l) l.scrollLeft = 0; });
    }
    await page.evaluate(() => { document.documentElement.style.removeProperty('--sal'); document.documentElement.style.removeProperty('--sar'); });
    const dl = await diagLabels(); console.log(`${tag} 診斷 天體標籤 ${dl.labels} 個，與 HUD 相交 ${dl.hits.length} 個${dl.hits.length ? '：' + dl.hits.join('；') : ''}`);
  }
  // 搜尋：點入、輸入、結果展開；結果列表不出框；Escape 收合
  await page.tap('#q'); await page.keyboard.type('M31'); await page.waitForTimeout(500);
  const sr = await page.evaluate(() => { const r = document.getElementById('results').getBoundingClientRect(); return { open: document.getElementById('results').classList.contains('open'), n: document.querySelectorAll('#results [role="option"]').length, inside: r.right <= window.innerWidth + 0.5 && r.left >= -0.5, bottom: Math.round(r.bottom), vh: window.innerHeight }; });
  ok(sr.open && sr.n > 0 && sr.inside, `${tag} 搜尋「M31」展開 ${sr.n} 筆、結果列在視窗內（底 ${sr.bottom}/${sr.vh}）`);
  if (out && W === 390) { await wake(W, H); await page.screenshot({ path: `${out}/int-${tag}-search.jpg`, type: 'jpeg', quality: 85 }); }
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  ok(await page.evaluate(() => !document.getElementById('results').classList.contains('open')), `${tag} Escape 收合搜尋`);
  // 音樂鈕：點一下 aria-pressed=true（可能因自動播放政策 pending，但按鈕狀態要反映），再點回 false
  await page.tap('#btn-music'); await page.waitForTimeout(600);
  const p1 = await page.getAttribute('#btn-music', 'aria-pressed');
  await page.tap('#btn-music'); await page.waitForTimeout(400);
  const p2 = await page.getAttribute('#btn-music', 'aria-pressed');
  ok(p1 === 'true' && p2 === 'false', `${tag} 音樂鈕可點：${p1} → ${p2}`);
  // 資訊卡開啟時不與觸控鈕／目的地列重疊
  await page.evaluate(async () => { const cat = window.__ndf.catalog; await window.__ndf.goTo(cat.entries.find((x) => x.key === 'saturn'), { instant: true }); });
  await page.waitForTimeout(1500);
  g = await geometry();
  const infoShown = await page.evaluate(() => getComputedStyle(document.getElementById('info')).display !== 'none');
  ok(infoShown && g.hits.length === 0 && g.off.length === 0, `${tag} 資訊卡開啟（${infoShown}）：不重疊、不出框${g.hits.length ? '：' + g.hits.join(', ') : ''}${g.off.length ? '；出框 ' + g.off.join(', ') : ''}`);
  if (out && (W === 390 || W === 844)) { await wake(W, H); await page.screenshot({ path: `${out}/int-${tag}-info.jpg`, type: 'jpeg', quality: 85 }); }
  // 隱藏介面 → #restore → 恢復
  await page.keyboard.press('h'); await page.waitForTimeout(400);
  const hid = await page.evaluate(() => document.getElementById('hud').classList.contains('hidden') && getComputedStyle(document.getElementById('restore')).display !== 'none');
  await page.tap('#restore'); await page.waitForTimeout(400);
  const back = await page.evaluate(() => !document.getElementById('hud').classList.contains('hidden'));
  ok(hid && back, `${tag} H 隱藏介面（${hid}）→ 點「介面」恢復（${back}）`);
  // 閒置淡出 → 觸控恢復
  await page.waitForTimeout(5500);
  const idle = await page.evaluate(() => document.body.classList.contains('idle'));
  await page.touchscreen.tap(W / 2, H / 2); await page.waitForTimeout(400);
  const woke = await page.evaluate(() => !document.body.classList.contains('idle'));
  ok(idle && woke, `${tag} 閒置淡出（${idle}）→ 觸控恢復（${woke}）`);
  ok(errs.length === 0, `${tag} console／page 錯誤 0${errs.length ? '：' + errs.join(' | ') : ''}`);
  await ctx.close();
}
await browser.close();
console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
