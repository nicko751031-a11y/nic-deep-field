#!/usr/bin/env node
// 星空背景回歸（負責人 2026-10-28「背景的星空還不夠真實」；AUDIT A13）：
//  1) 對齊：天狼星／織女星／大角星方向，Tycho 底圖最亮斑必須落在畫面中心 0.5° 內（與 HYG 星點一致；flipY 顛倒時誤差 1.7°–9°）。
//     以離屏渲染（同一相機狀態）量測，不受主迴圈幀率影響。
//  2) 可見度：曝光「星空」模式下朝銀心（RA 17.76h, Dec −29°）與反銀心（御夫座）各看一次，畫面中央帶平均亮度須達門檻；
//     北銀極（RA 12.86h, Dec +27.1°）為對照，銀河帶須明顯比它亮（對比 ≥ 2）。
//  3) 瀰漫銀河層貼圖載入成功、console／page 錯誤 0。
// 用法：node tools/sky_test.mjs [baseURL]
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process'; import path from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const base = process.argv[2] || 'http://127.0.0.1:8123/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errs = []; page.on('pageerror', (e) => errs.push('pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/TUNNEL|Failed to load resource|favicon/.test(m.text())) errs.push(m.text().slice(0, 160)); });
await page.goto(`${base}?quality=low`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
await page.waitForFunction(() => !!window.__ndf?.controls, null, { timeout: 30000 });
await page.waitForTimeout(6000); // 開場轉場結束
const tex = await page.evaluate(() => ({ status: window.__ndf.engine.textureStatus['assets/textures/milkyway_diffuse_2048.jpg'], hasMilky: !!window.__ndf.engine.skyMat.uniforms.uMilky.value, flipY: window.__ndf.engine.skyMat.uniforms.uSky.value?.flipY }));
ok(tex.status === 'ok' && tex.hasMilky, `瀰漫銀河層貼圖載入：${tex.status}`);
ok(tex.flipY === false, `Tycho 底圖 flipY=false（${tex.flipY}）`);
// ---- 1) 對齊（離屏渲染）
const STARS = [['天狼星', 6.752, -16.716], ['織女星', 18.616, 38.784], ['大角星', 14.261, 19.182]];
const align = await page.evaluate(async (STARS) => {
  const e = window.__ndf.engine, c = window.__ndf.controls; const A = await import('./js/astro.js'); const THREE = await import('three');
  c.stop(); c.enabled = false; const breath = e.breath; e.breath = false;
  const vis = []; for (const b of e.bodies.values()) { vis.push([b, b.group?.visible, b.mesh?.visible, b.atmo?.visible]); if (b.group) b.group.visible = false; if (b.mesh) b.mesh.visible = false; if (b.atmo) b.atmo.visible = false; }
  const bp = e.bodyPoints.visible; e.bodyPoints.visible = false;
  const earth = e.bodies.get('earth'); const camPos0 = e.camPos.slice(); e.camPos = [earth.pos[0], earth.pos[1] + 5e7, earth.pos[2]];
  const W = 640, H = 360; const rt = new THREE.WebGLRenderTarget(W, H); const buf = new Uint8Array(W * H * 4);
  const shoot = () => { e.renderer.setRenderTarget(rt); e.renderer.render(e.scene, e.camera); e.renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf); e.renderer.setRenderTarget(null); const L = new Float32Array(W * H); for (let k = 0; k < W * H; k++) L[k] = buf[k * 4] + buf[k * 4 + 1] + buf[k * 4 + 2]; let best = -1, bx = 0, by = 0; for (let j = 6; j < H - 6; j++) for (let i = 6; i < W - 6; i++) { let s = 0; for (let v = -4; v <= 4; v++) for (let u = -4; u <= 4; u++) s += L[(j + v) * W + i + u]; if (s > best) { best = s; bx = i; by = j; } } return { x: (bx - W / 2) / (H / 12), y: (H / 2 - 1 - (H - 1 - by)) / (H / 12) }; };
  const fov0 = e.camera.fov; const q0 = e.camQuat.clone(); const sky0 = e.skyMat.uniforms.uIntensity.value, milky0 = e.skyMat.uniforms.uMilkyIntensity.value, exp0 = e.starMat.uniforms.uExposure.value;
  const out = [];
  for (const [name, raH, decD] of STARS) {
    const ra = raH / 24 * 2 * Math.PI, dec = decD / 180 * Math.PI; const eq = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]; const ecl = A.equToEcl(eq);
    c.lookAt(new THREE.Vector3(ecl[0], ecl[2], -ecl[1])); e.camera.fov = 12; e.camera.updateProjectionMatrix();
    e.camera.quaternion.copy(e.camQuat); e.camera.updateMatrixWorld(); e.skyMat.uniforms.uInvProj.value.copy(e.camera.projectionMatrixInverse); e.skyMat.uniforms.uInvView.value.copy(e.camera.matrixWorld);
    e.stars.visible = true; e.starMat.uniforms.uExposure.value = 1.6; e.skyMat.uniforms.uIntensity.value = 0; e.skyMat.uniforms.uMilkyIntensity.value = 0; const a = shoot();
    e.stars.visible = false; e.skyMat.uniforms.uIntensity.value = 0.3; const b = shoot();
    out.push({ name, hyg: Math.hypot(a.x, a.y), tycho: Math.hypot(b.x, b.y) });
  }
  // 還原
  e.stars.visible = true; e.camera.fov = fov0; e.camera.updateProjectionMatrix(); e.camQuat.copy(q0); e.skyMat.uniforms.uIntensity.value = sky0; e.skyMat.uniforms.uMilkyIntensity.value = milky0; e.starMat.uniforms.uExposure.value = exp0;
  for (const [b, g, m, at] of vis) { if (b.group) b.group.visible = g; if (b.mesh) b.mesh.visible = m; if (b.atmo) b.atmo.visible = at; } e.bodyPoints.visible = bp; e.camPos = camPos0; e.breath = breath; c.enabled = true; rt.dispose();
  return out;
}, STARS);
for (const r of align) ok(r.hyg < 0.3 && r.tycho < 0.5, `${r.name}：HYG 星點偏離 ${r.hyg.toFixed(2)}°、Tycho 底圖亮斑偏離 ${r.tycho.toFixed(2)}°（須 < 0.5°）`);
// ---- 2) 可見度（整頁截圖，曝光「星空」）
const settle = async (n = 3) => { const f0 = await page.evaluate(() => window.__ndf.engine.renderer.info.render.frame); await page.waitForFunction((f) => window.__ndf.engine.renderer.info.render.frame >= f, f0 + n, { timeout: 120000 }); };
const aim = (raH, decD) => page.evaluate(async ([raH, decD]) => {
  const e = window.__ndf.engine, c = window.__ndf.controls; const A = await import('./js/astro.js'); const THREE = await import('three');
  c.stop(); e.exposureMode = 'stars'; e.showLabels = false; document.getElementById('hud').style.visibility = 'hidden'; document.getElementById('labels').style.display = 'none';
  const earth = e.bodies.get('earth'); const r = 6371 + 400000; const ra = raH / 24 * 2 * Math.PI, dec = decD / 180 * Math.PI;
  const eq = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]; const ecl = A.equToEcl(eq); const w = [ecl[0], ecl[2], -ecl[1]];
  e.camPos = [earth.pos[0] + w[0] * r, earth.pos[1] + w[1] * r, earth.pos[2] + w[2] * r]; // 地球在相機背後
  c.lookAt(new THREE.Vector3(w[0], w[1], w[2]));
}, [raH, decD]);
const measure = async () => { const buf = await page.screenshot({ type: 'png' }); return page.evaluate(async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const x = cv.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, cv.width, cv.height).data; let sum = 0, n = 0, csum = 0, cn = 0; for (let j = 0; j < cv.height; j++) for (let i = 0; i < cv.width; i++) { if (i > 540 && j < 150) continue; const k = (j * cv.width + i) * 4; const l = (d[k] + d[k + 1] + d[k + 2]) / 3; sum += l; n++; if (i >= cv.width * 0.33 && i < cv.width * 0.67) { csum += l; cn++; } } return { mean: sum / n, centre: csum / cn }; }, buf.toString('base64')); };
await aim(17.76, -29); await settle(4); const gc = await measure();
await aim(5.76, 28.9); await settle(4); const anti = await measure();
await aim(12.86, 27.1); await settle(4); const pole = await measure();
ok(gc.centre >= 8, `銀心方向中央帶平均亮度 ${gc.centre.toFixed(1)}（須 ≥ 8；修正前約 1）`);
ok(anti.centre >= 6, `反銀心方向中央帶平均亮度 ${anti.centre.toFixed(1)}（須 ≥ 6）`);
ok(gc.centre >= 2 * pole.centre && anti.centre >= 2 * pole.centre, `北銀極中央帶 ${pole.centre.toFixed(1)}：銀河帶對比 ≥ 2（銀心 ${(gc.centre / Math.max(pole.centre, 0.1)).toFixed(1)}×、反銀心 ${(anti.centre / Math.max(pole.centre, 0.1)).toFixed(1)}×）`);
ok(errs.length === 0, `console／page 錯誤 0${errs.length ? '：' + errs.join(' | ') : ''}`);
await browser.close();
console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
