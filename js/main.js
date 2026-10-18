// 入口：載入、組裝、主迴圈
import * as THREE from 'three';
import { Engine } from './engine.js';
import { Controls } from './controls.js';
import { Catalog } from './catalog.js';
import { UI } from './ui.js';
import { ObservePanel } from './observe.js';
import { SpaceAudio } from './audio.js';
import { C_KM_S, clamp } from './units.js';
import { BODY_BY_KEY } from './bodies.js';

const $ = (id) => document.getElementById(id);
const V3 = THREE.Vector3;

function detectQuality() {
  const saved = localStorage.getItem('ndf-quality'); if (saved) return saved;
  const small = Math.min(window.innerWidth, window.innerHeight) < 600 || window.matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  if (small) return cores >= 6 ? 'medium' : 'low';
  return cores >= 4 ? 'high' : 'medium';
}

async function boot() {
  const canvas = $('gl'); const lmsg = $('lmsg'); const lerrs = $('lerrs'); const bar = $('bar');
  const errors = [];
  const report = (m) => { errors.push(m); lerrs.innerHTML = errors.map((e) => `• ${e}`).join('<br>'); };
  window.addEventListener('error', (e) => { if (errors.length < 8) report(`錯誤：${e.message}`); });
  window.addEventListener('unhandledrejection', (e) => { if (errors.length < 8) report(`錯誤：${e.reason?.message || e.reason}`); });

  const quality = detectQuality();
  let engine;
  try { engine = new Engine(canvas, { quality }); }
  catch (e) { lmsg.textContent = '無法建立 WebGL 環境。請改用支援 WebGL2 的瀏覽器（Chrome / Edge / Firefox / Safari 16+）。'; report(String(e.message || e)); return; }

  const catalog = new Catalog();
  let texDone = 0, texTotal = 1, dataDone = 0, dataTotal = 5;
  const prog = () => { const f = (texDone / texTotal) * 0.6 + (dataDone / dataTotal) * 0.4; bar.style.width = `${Math.round(f * 100)}%`; };
  lmsg.textContent = '載入 NASA 貼圖與星表…';
  await Promise.all([
    engine.loadTextures((d, t, p, ok) => { texDone = d; texTotal = t; prog(); if (!ok) report(`貼圖載入失敗：${p}（將以單色球體代替）`); lmsg.textContent = `載入貼圖 ${d}/${t}：${p.split('/').pop()}`; }),
    catalog.load((d, t, f) => { dataDone = d; dataTotal = t; prog(); lmsg.textContent = `載入星表 ${d}/${t}：${f}`; }),
  ]);
  if (catalog.loadErrors) for (const e of catalog.loadErrors) report(`星表載入失敗：${e}`);
  if (catalog.starsBin) engine.setStars(catalog.starsBin);
  else { engine.setStars(new Float32Array(0)); report('恆星資料缺失：星空只剩背景星圖'); }

  const ui = new UI(); const controls = new Controls(engine, canvas); const audio = new SpaceAudio();
  const observe = new ObservePanel($('observe'), engine, (iss) => { engine.earthMarker = iss; $('observe').classList.remove('open'); goToEarthMarker(iss); });
  if (controls.isTouchDevice()) { document.body.classList.add('touch'); setTimeout(() => ui.toast('左半邊拖曳＝移動 · 右半邊拖曳＝環視 · 雙指縮放＝靠近／拉遠 · 右上 ◻ 可隱藏介面', 7000), 1500); }

  // ---------------- 狀態 ----------------
  let currentEntry = null; let frameNote = ''; let jumping = false; let warp = false;
  const fx = $('fx'); const fctx = fx.getContext('2d'); let fxLevel = 0;
  const resizeFx = () => { fx.width = window.innerWidth; fx.height = window.innerHeight; }; resizeFx(); window.addEventListener('resize', resizeFx);

  function entryForKey(key) {
    if (engine.frame.type === 'solar') return catalog.entries.find((e) => e.kind === 'body' && e.id === key);
    return currentEntry;
  }

  // ---------------- 前往 ----------------
  async function goTo(entry, { instant = false } = {}) {
    if (!entry || jumping) return;
    const dest = catalog.destination(entry, engine); if (!dest) return;
    currentEntry = entry;
    controls.stop(); controls.target = dest.target; engine.anchorKey = dest.target; engine.prevAnchorPos = null;
    const apply = () => {
      const needFrame = dest.frame.type !== 'solar' || engine.frame.type !== 'solar';
      if (needFrame) engine.setFrame(dest.frame);
      if (dest.camPos) { engine.camPos = dest.camPos.slice(); }
      // 更新一次以取得天體位置
      const nearest = engine.update(0);
      if (!dest.camPos) {
        // 系外行星：放在行星受光面 approachFactor 倍半徑處
        const e = engine.extraBodies.find((x) => x.key === dest.target);
        if (e) {
          const toStar = new V3(-e.pos[0], -e.pos[1], -e.pos[2]).normalize();
          const dir = toStar.clone().applyAxisAngle(new V3(0, 1, 0), 0.7);
          const d = e.radius * (dest.approachFactor || 4);
          engine.camPos = [e.pos[0] + dir.x * d, e.pos[1] + dir.y * d, e.pos[2] + dir.z * d];
          dest.lookAtPos = e.pos;
        }
      }
      void nearest;
      const look = new V3(dest.lookAtPos[0] - engine.camPos[0], dest.lookAtPos[1] - engine.camPos[1], dest.lookAtPos[2] - engine.camPos[2]);
      controls.lookAt(look, dest.up || new V3(0, 1, 0));
      frameNote = dest.frame.type !== 'solar' && dest.frame.distKnown === false ? '距離未知，暫置於 100 pc 以供觀看' : '';
      const info = catalog.info(entry);
      ui.showInfo(info, [
        ['◎ 環繞', () => { controls.setOrbit(dest.target, !controls.orbit); }],
        ['⟲ 重設視角', () => resetView()],
        ...(entry.kind === 'body' && entry.id === 'venus' ? [['切換雷達／雲層', () => { engine.setVenusRadar(!engine.venusRadar); $('s-venus').checked = engine.venusRadar; }]] : []),
      ]);
      if (dest.frame.type !== 'solar') ui.toast(`已抵達 ${dest.label}（躍遷為模擬功能，真實距離 ${entry.kind === 'bh' ? '' : ''}見資訊面板）`);
      else ui.toast(`已抵達 ${dest.label}`);
    };
    if (instant) { apply(); return; }
    jumping = true; controls.enabled = false;
    await jumpFx(apply);
    controls.enabled = true; jumping = false;
  }

  function jumpFx(midFn) {
    return new Promise((resolve) => {
      const t0 = performance.now(); let mid = false;
      const step = () => {
        const t = (performance.now() - t0) / 1000;
        fxLevel = t < 0.5 ? t / 0.5 : Math.max(0, 1 - (t - 0.5) / 0.6);
        if (!mid && t >= 0.5) { mid = true; midFn(); }
        if (t < 1.1) requestAnimationFrame(step); else { fxLevel = 0; resolve(); }
      };
      step();
    });
  }

  // 光速／躍遷視覺：放射狀星光拉絲（純視覺效果）
  const streaks = Array.from({ length: 220 }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random(), l: 0.2 + Math.random() * 0.8 }));
  function drawFx(level) {
    fctx.clearRect(0, 0, fx.width, fx.height);
    if (level <= 0.01) return;
    const cx = fx.width / 2, cy = fx.height / 2, R = Math.hypot(cx, cy);
    fctx.fillStyle = `rgba(0,0,0,${0.35 * level})`; fctx.fillRect(0, 0, fx.width, fx.height);
    fctx.lineWidth = 1.2;
    for (const s of streaks) {
      s.r += 0.012 * level * (0.5 + s.l); if (s.r > 1) s.r = 0.02;
      const r0 = s.r * R, r1 = (s.r + 0.08 * level * s.l) * R;
      fctx.strokeStyle = `rgba(200,220,255,${0.55 * level * s.r})`;
      fctx.beginPath(); fctx.moveTo(cx + Math.cos(s.a) * r0, cy + Math.sin(s.a) * r0); fctx.lineTo(cx + Math.cos(s.a) * r1, cy + Math.sin(s.a) * r1); fctx.stroke();
    }
  }

  function resetView() {
    const nearest = engine.update(0);
    const t = controls.target;
    let rel = null, up = new V3(0, 1, 0);
    if (engine.frame.type === 'solar') { const e = engine.bodies.get(t || nearest?.key); if (e) { rel = new V3(e.pos[0] - engine.camPos[0], e.pos[1] - engine.camPos[1], e.pos[2] - engine.camPos[2]); if (e.axes) up = e.axes.yb; } }
    else { const e = engine.extraBodies.find((x) => x.key === t) || engine.extraBodies[0]; if (e) rel = new V3(e.pos[0] - engine.camPos[0], e.pos[1] - engine.camPos[1], e.pos[2] - engine.camPos[2]); }
    if (rel) controls.lookAt(rel, up);
  }
  function goToEarth() { goTo(catalog.entries.find((e) => e.kind === 'body' && e.id === 'earth')); }
  function goToEarthMarker(iss) {
    const earthEntry = catalog.entries.find((e) => e.kind === 'body' && e.id === 'earth');
    const dest = catalog.destination(earthEntry, engine);
    goTo(earthEntry, { instant: true });
    // 移到 ISS 上方 1500 km 處俯視
    const e = engine.bodies.get('earth'); if (!e?.axes) return;
    const ax = { xb: e.axes.xb.toArray(), yb: e.axes.yb.toArray(), zb: e.axes.zb.toArray() };
    import('./astro.js').then((A) => {
      const d = A.geoToWorldDir(ax, iss.lat, iss.lon); const r = BODY_BY_KEY.earth.radius + iss.altKm + 1500;
      engine.camPos = [e.pos[0] + d[0] * r, e.pos[1] + d[1] * r, e.pos[2] + d[2] * r];
      controls.lookAt(new V3(-d[0], -d[1], -d[2]), e.axes.yb);
      ui.toast(`ISS 位置標記（${iss.lat.toFixed(1)}°, ${iss.lon.toFixed(1)}°，${iss.altKm.toFixed(0)} km）— 位置同步，非即時攝影`);
    });
    void dest;
  }

  // ---------------- UI 綁定 ----------------
  ui.buildDestinations(catalog, (e) => goTo(e));
  ui.bindSearch(catalog, (e) => goTo(e));
  $('b-stop').addEventListener('click', () => { controls.stop(); ui.toast('已停止，懸浮中'); });
  $('b-orbit').addEventListener('click', () => { controls.setOrbit(controls.target || engine.update(0)?.key, !controls.orbit); ui.toast(controls.orbit ? '自動環繞中（任何移動輸入會退出）' : '停止環繞'); });
  const hold = (id, v) => { const b = $(id); const on = (e) => { e.preventDefault(); controls.approach = v; }; const off = () => { controls.approach = 0; }; b.addEventListener('mousedown', on); b.addEventListener('touchstart', on, { passive: false }); window.addEventListener('mouseup', off); b.addEventListener('touchend', off); b.addEventListener('touchcancel', off); };
  hold('b-near', 1); hold('b-far', -1);
  $('b-reset').addEventListener('click', resetView);
  $('b-earth').addEventListener('click', goToEarth);
  $('b-slow').addEventListener('click', () => controls.changeSpeed(-1));
  $('b-fast').addEventListener('click', () => controls.changeSpeed(1));
  $('b-auto').addEventListener('click', () => controls.setAutoSpeed(true));
  $('b-warp').addEventListener('click', () => { controls.autoSpeed = false; controls.speedLevel = 11; controls.manualSpeed = 1000 * C_KM_S; controls.onSpeedChange?.(); ui.toast('超光速巡航 ×1000 c（模擬效果，真實宇宙無法如此）'); });
  controls.onSpeedChange = () => { $('b-auto').classList.toggle('active', controls.autoSpeed); };
  $('rate').addEventListener('change', (e) => { engine.timeRate = parseFloat(e.target.value); });
  $('b-now').addEventListener('click', () => { engine.simTime = Date.now(); engine.timeRate = 1; $('rate').value = '1'; ui.toast('時間已回到現在'); });
  $('btn-hide').addEventListener('click', () => ui.setHidden(true));
  $('restore').addEventListener('click', () => ui.setHidden(false));
  $('btn-full').addEventListener('click', toggleFullscreen);
  $('btn-settings').addEventListener('click', () => { $('settings').classList.toggle('open'); ui.fillCatalogInfo(catalog, engine); });
  $('tab-obs').addEventListener('click', () => { observe.build(); $('observe').classList.add('open'); controls.exitPointerLock(); });
  $('tab-3d').addEventListener('click', () => $('observe').classList.remove('open'));
  // 觸控升降
  const tHold = (id, v) => { const b = $(id); b.addEventListener('touchstart', (e) => { e.preventDefault(); controls.vertical = v; }, { passive: false }); const off = () => { controls.vertical = 0; }; b.addEventListener('touchend', off); b.addEventListener('touchcancel', off); };
  tHold('t-up', 1); tHold('t-down', -1);
  controls.onTouchJoystick = (m) => { const j = $('joy'); if (!m) { j.style.display = 'none'; return; } j.style.display = 'block'; j.style.left = `${m.x0 - 55}px`; j.style.top = `${m.y0 - 55}px`; const dx = clamp(m.x - m.x0, -40, 40), dy = clamp(m.y - m.y0, -40, 40); $('knob').style.transform = `translate(${dx}px, ${dy}px)`; };
  controls.onCollide = (n) => { if (!controls._collideToast || performance.now() - controls._collideToast > 4000) { controls._collideToast = performance.now(); ui.toast(`已到達 ${n.def.zh} 的觀測邊界（${n.def.minAltitude >= 1000 ? '氣態行星／恆星沒有可站立表面' : '最低安全高度'}）`); } };
  controls.onKey = (code) => {
    if (code === 'KeyH') ui.setHidden(!ui.hidden);
    if (code === 'KeyO') $('b-orbit').click();
    if (code === 'KeyV') resetView();
    if (code === 'KeyB') goToEarth();
    if (code === 'KeyG') toggleFullscreen();
    if (code === 'KeyT') { engine.timeRate = engine.timeRate === 0 ? 1 : 0; $('rate').value = String(engine.timeRate); }
    if (code === 'Slash') { $('q').focus(); }
  };
  function toggleFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => ui.toast('此裝置不支援全螢幕；iOS 可用 Safari「加入主畫面」取得全螢幕體驗'));
    else if (document.fullscreenElement) document.exitFullscreen();
    else ui.toast('此裝置不支援全螢幕 API；iOS 可用 Safari「加入主畫面」取得全螢幕體驗');
  }
  ui.buildSettings({
    quality,
    onExposure: (v) => { engine.exposureMode = v; },
    onLabels: (v) => { engine.showLabels = v; ui.labels.style.display = v ? '' : 'none'; },
    onVenus: (v) => engine.setVenusRadar(v),
    onSens: (v) => { controls.sensitivity = 0.0022 * v; },
    onInvert: (v) => { controls.invertY = v; },
    onFov: (v) => { engine.camera.fov = v; engine.camera.updateProjectionMatrix(); },
    onAudio: (v) => { if (v === 'off') audio.stopAll(); else if (v === 'ambient') audio.ambient(); else { const t = audio.sonify(); $('s-audio-note').innerHTML += '<br>目前音高：' + t.map((x) => `${BODY_BY_KEY[x.key].zh} ${x.hz.toFixed(1)} Hz（週期 ${x.periodDays} 天，升 ${x.octaves} 個八度）`).join('；'); } },
  });


  // 測試鉤子（瀏覽器自動化用）
  window.__ndf = {
    engine, controls, catalog, goTo,
    testPlaceOver(lat, lon, altKm) {
      const e = engine.bodies.get('earth'); if (!e?.axes) return false;
      const ax = { xb: e.axes.xb.toArray(), yb: e.axes.yb.toArray(), zb: e.axes.zb.toArray() };
      return import('./astro.js').then((A) => {
        const d = A.geoToWorldDir(ax, lat, lon); const r = BODY_BY_KEY.earth.radius + altKm;
        engine.camPos = [e.pos[0] + d[0] * r, e.pos[1] + d[1] * r, e.pos[2] + d[2] * r];
        controls.stop(); controls.lookAt(new V3(-d[0], -d[1], -d[2]), e.axes.yb); return true;
      });
    },
  };

  // ---------------- 開始 ----------------
  goTo(catalog.entries.find((e) => e.kind === 'body' && e.id === 'earth'), { instant: true });
  $('loading').classList.add('done');
  if (errors.length) ui.toast(`有 ${errors.length} 項資源載入失敗，詳見設定 → 載入狀態`, 6000);

  // 主迴圈
  let last = performance.now(); let frames = 0, fpsT = last, fps = 0, uiT = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    if ($('observe').classList.contains('open')) return; // 真實觀測分頁開啟時暫停渲染，省電
    const nearest = engine.update(dt);
    controls.update(dt, nearest);
    engine.render();
    // 黑洞光線追蹤自適應步數：掉幀就減步數，流暢就逐步加回
    if (engine.frame.type === 'bh') {
      const u = engine.bhMat.uniforms.uSteps; const maxSteps = engine.bhMaxSteps || (engine.bhMaxSteps = u.value);
      if (dt > 0.05) u.value = Math.max(120, Math.floor(u.value * 0.85)); else if (dt < 0.022) u.value = Math.min(maxSteps, Math.floor(u.value * 1.04) + 1);
    }
    // 光速效果
    warp = controls.moving && controls.velocity.length() > 0.3 * C_KM_S;
    const lvl = Math.max(fxLevel, warp ? clamp(Math.log10(controls.velocity.length() / (0.3 * C_KM_S)) * 0.25 + 0.25, 0.25, 0.8) : 0);
    drawFx(lvl);
    frames++; if (now - fpsT > 1000) { fps = frames; frames = 0; fpsT = now; }
    uiT += dt;
    if (uiT > 0.12) {
      uiT = 0;
      if (engine.showLabels) ui.updateLabels(engine.labelTargets, engine, (key) => { const e = entryForKey(key); if (e) goTo(e); });
      const tgt = engine.frame.type === 'solar' ? engine.bodies.get(controls.target) : engine.extraBodies.find((x) => x.key === controls.target);
      const rel = tgt ? Math.hypot(tgt.pos[0] - engine.camPos[0], tgt.pos[1] - engine.camPos[1], tgt.pos[2] - engine.camPos[2]) : null;
      const radius = tgt ? (tgt.def?.radius ?? tgt.radius) : null;
      ui.setStatus({
        speed: controls.autoSpeed ? controls.currentSpeed : controls.manualSpeed, autoSpeed: controls.autoSpeed,
        target: tgt ? (tgt.def?.zh ?? tgt.zh) : null, dist: rel, altitude: rel != null && radius != null && engine.frame.type !== 'bh' ? rel - radius : null,
        simTime: engine.simTime, rate: engine.timeRate,
        frameLabel: engine.frame.type === 'solar' ? '太陽系（真實比例與星曆）' : engine.frame.label, frameNote,
        mode: controls.orbit ? '自動環繞' : controls.moving ? '飛行中' : '懸浮', fps, warp,
      });
    }
  }
  requestAnimationFrame(loop);
}

boot().catch((e) => { $('lmsg').textContent = `啟動失敗：${e.message || e}`; console.error(e); });
