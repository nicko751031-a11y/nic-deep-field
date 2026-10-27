// 入口：載入、組裝、主迴圈
import * as THREE from 'three';
import { Engine } from './engine.js';
import { Controls } from './controls.js';
import { Catalog } from './catalog.js';
import { UI } from './ui.js';
import { ObservePanel } from './observe.js';
import { SpaceAudio } from './audio.js';
import { EarthSurfaceView } from './earthview.js';
import { EarthWeatherLayer } from './earthwx.js';
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

  // 網址參數（診斷用）：?quality=low|medium|high 覆蓋畫質、?nolog=1 關閉對數深度緩衝、?diag=1 顯示 GPU 診斷、?safe=1 安全模式
  const params = new URLSearchParams(location.search);
  const quality = ['low', 'medium', 'high'].includes(params.get('quality')) ? params.get('quality') : detectQuality();
  // 安全模式：關閉後處理（Bloom／電影後製）、對數深度與鏡頭呼吸，像素比 1；用來判斷黑屏閃爍是否來自這些功能
  const safe = params.has('safe');
  let engine;
  // ?nolod=1 關閉地球分塊 LOD；?tiles=<路徑> 指定分塊目錄（測試用，例如 assets/textures/earth_tiles_synthetic）
  try { engine = new Engine(canvas, { quality, logDepth: !params.has('nolog') && !safe, post: !safe, maxPixelRatio: safe ? 1 : undefined, earthLod: !params.has('nolod'), tilesPath: /^[\w./-]+$/.test(params.get('tiles') || '') ? params.get('tiles') : undefined }); }
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
  const musicButton = $('btn-music');
  // 音訊狀態只以 AudioContext 真正 running 為準（audio.start() 會 await resume）；失敗或被系統暫停時介面回到未播放並說明原因
  const syncAudioUI = (r) => {
    const playing = audio.mode !== 'off';
    if (musicButton) { musicButton.textContent = playing ? '♪' : '♫'; musicButton.setAttribute('aria-pressed', String(playing)); musicButton.title = playing ? '關閉音景' : '開啟合成低頻音景'; }
    const sel = $('s-audio'); if (sel && sel.value !== audio.mode) sel.value = audio.mode;
    if (r && !r.ok && r.reason !== '已被較新的操作取代') ui.toast(`音訊未啟動：${r.reason}。請再點一次，iPhone 請確認未開靜音切換鍵`, 6000);
  };
  audio.onState = syncAudioUI;
  // 最後操作優先：resume 等待期間再按停止或改選音景，直接交給 audio.start()（內部 seq 讓舊啟動作廢，不疊加節點）；
  // 按鈕在等待期間顯示「啟動中」，點擊視為取消（off）
  // 每次操作有唯一序號：只有最後一次操作可以清除 pending 與回寫介面（避免同模式 A→off→A 的 ABA 競態：舊 A 完成不得清掉新 A 的 pending）
  let audioSeq = 0; let audioPending = null; // audioPending = { seq, mode } 或 null
  const startAudio = async (mode) => {
    const my = ++audioSeq; audioPending = { seq: my, mode };
    if (musicButton) musicButton.title = mode === 'off' ? '停止中' : '音訊啟動中（再點一次取消）';
    const r = await audio.start(mode);
    if (my !== audioSeq) return r; // 已被更新的操作取代：不動 pending、不回寫介面
    audioPending = null; syncAudioUI(r); return r;
  };
  musicButton?.addEventListener('click', () => { startAudio(audioPending && audioPending.mode !== 'off' ? 'off' : audio.mode === 'off' ? 'ambient' : 'off'); });
  const observe = new ObservePanel($('observe'), engine, (iss) => { engine.earthMarker = iss; $('observe').classList.remove('open'); goToEarthMarker(iss); });
  const isTouch = controls.isTouchDevice();
  if (isTouch) { document.body.classList.add('touch'); setTimeout(() => ui.toast('左半邊拖曳＝移動 · 右半邊拖曳＝環視 · 雙指縮放＝靠近／拉遠', 7000), 6000); }

  // 電影式偏好（localStorage）
  // 尊重系統「減少動態效果」：預設關閉鏡頭呼吸與顆粒／色差（使用者仍可在設定開啟）
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let prefs = { cine: !reduceMotion, bars: false, breath: !reduceMotion, autohide: true };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem('ndf-cine') || '{}') }; } catch (e) { /* ignore */ }
  const savePrefs = () => { try { localStorage.setItem('ndf-cine', JSON.stringify(prefs)); } catch (e) { /* ignore */ } };
  const applyPrefs = () => { engine.setCine(prefs.cine); engine.breath = prefs.breath; document.body.classList.toggle('cine', prefs.bars); if (!prefs.autohide) document.body.classList.remove('idle'); };
  engine.camera.fov = 50; engine.camera.updateProjectionMatrix();
  if (safe) { prefs.breath = false; prefs.cine = false; }
  applyPrefs();
  // 顯示晶片重置（記憶體不足等）：引擎已自動降級，向使用者說明；連續發生則建議安全模式
  engine.onContextRestored = (level) => { ui.toast(level >= 2 ? '顯示晶片連續重置，已關閉泛光並降低解析度；若仍閃爍請在設定開啟「安全模式」' : '顯示晶片重置，已自動降低解析度以維持穩定', 7000); };

  // ---------------- 狀態 ----------------
  let currentEntry = null; let frameNote = ''; let jumping = false; let warp = false;
  const fx = $('fx'); const fctx = fx.getContext('2d'); let fxLevel = 0, fadeLevel = 0;
  const resizeFx = () => { fx.width = window.innerWidth; fx.height = window.innerHeight; }; resizeFx(); window.addEventListener('resize', resizeFx);

  // 介面閒置自動淡出：4 秒沒有輸入就淡出 HUD 與標籤，任何輸入立即恢復
  let lastInput = performance.now();
  const poke = () => { lastInput = performance.now(); if (document.body.classList.contains('idle')) document.body.classList.remove('idle'); };
  for (const ev of ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'touchmove', 'pointermove']) window.addEventListener(ev, poke, { passive: true });
  const idleTick = () => {
    const busy = ui.hidden || $('settings').classList.contains('open') || $('observe').classList.contains('open') || document.activeElement === $('q') || jumping;
    if (prefs.autohide && !busy && performance.now() - lastInput > 4000) document.body.classList.add('idle');
  };

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
        ['環繞', () => { controls.setOrbit(dest.target, !controls.orbit); }],
        ['重設視角', () => resetView()],
        ...(entry.kind === 'body' && entry.id === 'venus' ? [['切換雷達／雲層', () => { engine.setVenusRadar(!engine.venusRadar); $('s-venus').checked = engine.venusRadar; }]] : []),
      ]);
      ui.markDestination(entry.kind === 'body' ? entry.id : `${entry.kind}:${entry.id}`);
      if (!instant) {
        // 標題卡：主名稱放大字，括號內的別名／編號與英文名放第二行
        const m = /^(.*?)（(.*)）\s*$/.exec(dest.label); const zh = m ? m[1] : dest.label;
        let en = entry.kind === 'body' ? entry.data.en : entry.kind === 'bh' ? entry.data.en : (entry.sub || '');
        if (m) en = [m[2], en].filter(Boolean).join(' · ');
        const sub = dest.frame.type !== 'solar' ? '躍遷為模擬功能 · 真實距離見資訊面板' : '';
        ui.titleCard(zh, en, sub, 3200);
      }
    };
    if (instant) { apply(); return; }
    jumping = true; controls.enabled = false;
    await jumpFx(apply);
    controls.enabled = true; jumping = false;
  }

  // 躍遷：星光拉絲 → 淡入全黑 → 切換場景 → 由黑緩慢淡出
  function jumpFx(midFn) {
    return new Promise((resolve) => {
      const t0 = performance.now(); let mid = false;
      const step = () => {
        const t = (performance.now() - t0) / 1000;
        fxLevel = t < 0.6 ? t / 0.6 : Math.max(0, 1 - (t - 0.6) / 0.5);
        fadeLevel = t < 0.3 ? 0 : t < 0.7 ? (t - 0.3) / 0.4 : t < 0.95 ? 1 : Math.max(0, 1 - (t - 0.95) / 1.5);
        if (!mid && t >= 0.72) { mid = true; midFn(); }
        if (t < 2.5) requestAnimationFrame(step); else { fxLevel = 0; fadeLevel = 0; resolve(); }
      };
      step();
    });
  }

  // 鏡頭眩光：太陽／主星的柔光、變形鏡頭式橫向光斑與鬼影（純視覺效果；被天體遮住時依邊緣平滑消失）
  function drawFlare(f) {
    const W = fx.width, H = fx.height; const I = f.intensity; if (I <= 0.01) return;
    const { x, y } = f;
    fctx.globalCompositeOperation = 'lighter';
    const rg = Math.max(W, H) * (0.06 + 0.12 * I);
    const g = fctx.createRadialGradient(x, y, 0, x, y, rg);
    g.addColorStop(0, `rgba(255,246,228,${0.5 * I})`); g.addColorStop(0.25, `rgba(255,232,196,${0.16 * I})`); g.addColorStop(1, 'rgba(255,220,180,0)');
    fctx.fillStyle = g; fctx.fillRect(x - rg, y - rg, rg * 2, rg * 2);
    const L = W * (0.16 + 0.22 * I);
    for (const [h, a, c] of [[1.2, 0.42, '170,205,255'], [5, 0.12, '140,180,255'], [20, 0.04, '120,160,255']]) {
      const sg = fctx.createLinearGradient(x - L, y, x + L, y);
      sg.addColorStop(0, `rgba(${c},0)`); sg.addColorStop(0.5, `rgba(${c},${a * I})`); sg.addColorStop(1, `rgba(${c},0)`);
      fctx.fillStyle = sg; fctx.fillRect(x - L, y - h / 2, L * 2, h);
    }
    const cx = W / 2, cy = H / 2;
    for (const [k, r, a, c] of [[-0.4, 0.018, 0.12, '255,200,160'], [-0.85, 0.03, 0.07, '180,220,255'], [-1.5, 0.05, 0.05, '255,230,200'], [0.45, 0.01, 0.14, '200,230,255'], [1.25, 0.04, 0.045, '255,210,180']]) {
      const gx = cx + (cx - x) * k, gy = cy + (cy - y) * k; const rr = Math.max(W, H) * r;
      const gg = fctx.createRadialGradient(gx, gy, rr * 0.55, gx, gy, rr);
      gg.addColorStop(0, `rgba(${c},0)`); gg.addColorStop(0.8, `rgba(${c},${a * I})`); gg.addColorStop(1, `rgba(${c},0)`);
      fctx.fillStyle = gg; fctx.beginPath(); fctx.arc(gx, gy, rr, 0, Math.PI * 2); fctx.fill();
    }
    fctx.globalCompositeOperation = 'source-over';
  }

  // 光速／躍遷視覺：放射狀星光拉絲（純視覺效果）
  const streaks = Array.from({ length: 220 }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random(), l: 0.2 + Math.random() * 0.8 }));
  let fxDirty = true;
  function drawFx(level, fade) {
    // 沒有眩光、拉絲、淡黑時不重畫整張 2D 畫布（行動裝置每幀 clearRect 全螢幕很耗電）
    const flareOn = engine.flare && prefs.cine && !engine.flareDisabled && engine.flare.intensity > 0.01;
    const need = flareOn || level > 0.01 || fade > 0.005;
    if (!need) { if (fxDirty) { fctx.clearRect(0, 0, fx.width, fx.height); fxDirty = false; } return; }
    fxDirty = true;
    fctx.clearRect(0, 0, fx.width, fx.height);
    if (flareOn) drawFlare(engine.flare);
    if (level > 0.01) {
      const cx = fx.width / 2, cy = fx.height / 2, R = Math.hypot(cx, cy);
      fctx.fillStyle = `rgba(0,0,0,${0.3 * level})`; fctx.fillRect(0, 0, fx.width, fx.height);
      fctx.lineWidth = 1.2;
      for (const s of streaks) {
        s.r += 0.012 * level * (0.5 + s.l); if (s.r > 1) s.r = 0.02;
        const r0 = s.r * R, r1 = (s.r + 0.08 * level * s.l) * R;
        fctx.strokeStyle = `rgba(200,220,255,${0.55 * level * s.r})`;
        fctx.beginPath(); fctx.moveTo(cx + Math.cos(s.a) * r0, cy + Math.sin(s.a) * r0); fctx.lineTo(cx + Math.cos(s.a) * r1, cy + Math.sin(s.a) * r1); fctx.stroke();
      }
    }
    if (fade > 0.005) { fctx.fillStyle = `rgba(0,0,0,${Math.min(1, fade)})`; fctx.fillRect(0, 0, fx.width, fx.height); }
  }

  // 開場鏡頭（負責人 2026-10-27 13:xx 指示：改回上一版的角度，必須保有「星際效應」的美感）：
  // 地球夜側、晨昏線上方，太陽正要從地平邊緣升起（大氣邊緣受光＋鏡頭眩光），並極慢速環繞（鏡頭不鎖定，太陽緩緩自邊緣升起）。
  // 鏡頭位置以太陽方向為準而非台灣，因此開場畫面與載入時刻無關；要看台灣請用搜尋或「返回地球」。
  function openingView() {
    const e = engine.bodies.get('earth'); if (!e?.axes) return;
    const pos = e.pos; const R = BODY_BY_KEY.earth.radius;
    const sunDir = new V3(-pos[0], -pos[1], -pos[2]).normalize(); const up = e.axes.yb.clone();
    const side = sunDir.clone().applyAxisAngle(up, 2.62).normalize(); // 距太陽方向約 150°：深夜側，太陽剛好在邊緣外
    const d = R * 2.4;
    engine.camPos = [pos[0] + side.x * d, pos[1] + side.y * d, pos[2] + side.z * d];
    const limb = sunDir.clone().sub(side.clone().multiplyScalar(sunDir.dot(side))).normalize(); // 太陽方向在視平面上的分量 → 受光邊緣
    const look = new V3(pos[0] + limb.x * R * 0.9 + up.x * R * 0.1 - engine.camPos[0], pos[1] + limb.y * R * 0.9 + up.y * R * 0.1 - engine.camPos[1], pos[2] + limb.z * R * 0.9 + up.z * R * 0.1 - engine.camPos[2]);
    controls.lookAt(look, up);
    controls.setOrbit('earth', true, 900); controls.orbit.lookLocked = false;
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

  // 設定重載時保留位置（AUDIT D6）：畫質／安全模式切換會整頁重載。重載前把目前目的地、相對目標天體的位置、朝向、
  // 時間與環繞狀態寫到 sessionStorage（只在同一分頁、120 秒內有效），載入後還原，不再回到開場。
  // 位置存「相對目標天體」而非絕對座標：重載期間天體仍照星曆移動，還原時才不會漂移。
  // 時間存「模擬時刻＋速率」兩個維度（GPT 03:16 稽核：速率＝1 不代表模擬時刻＝現在，快轉後切回即時再重載不可跳回現在）：
  // 還原為 simTime + 重載經過的秒數 × timeRate —— 即時保留原本的時間偏移並連續前進、暫停不動、加速按速率進時，不會瞬間跳數天。
  const RESUME_KEY = 'ndf-resume';
  function saveResume() {
    try {
      const q = engine.camQuat; const body = engine.frame.type === 'solar' ? engine.bodies.get(controls.target) : null;
      const rel = body ? [engine.camPos[0] - body.pos[0], engine.camPos[1] - body.pos[1], engine.camPos[2] - body.pos[2]] : null;
      sessionStorage.setItem(RESUME_KEY, JSON.stringify({
        t: Date.now(), entry: currentEntry ? { kind: currentEntry.kind, id: currentEntry.id } : null, target: controls.target,
        camPos: engine.camPos.slice(), rel, camQuat: [q.x, q.y, q.z, q.w], simTime: engine.simTime, timeRate: engine.timeRate,
        orbit: controls.orbit ? { key: controls.orbit.key, period: 2 * Math.PI / controls.orbit.omega } : null,
      }));
    } catch (e) { /* 無法寫入（隱私模式等）就只是回到開場 */ }
  }
  function readResume() {
    try {
      const raw = sessionStorage.getItem(RESUME_KEY); sessionStorage.removeItem(RESUME_KEY); if (!raw) return null;
      const r = JSON.parse(raw); const v3 = (a) => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
      if (!r || !Number.isFinite(r.t) || Date.now() - r.t > 120000 || !v3(r.camPos) || (r.rel && !v3(r.rel)) || !r.entry) return null;
      return r;
    } catch (e) { return null; }
  }
  function applyResume(r) {
    const entry = catalog.entries.find((e) => e.kind === r.entry.kind && e.id === r.entry.id); if (!entry) return false;
    goTo(entry, { instant: true });
    if (Number.isFinite(r.timeRate) && Number.isFinite(r.simTime)) {
      engine.simTime = r.simTime + Math.max(0, Date.now() - r.t) * r.timeRate; engine.timeRate = r.timeRate;
      const sel = $('rate'); if ([...sel.options].some((o) => o.value === String(r.timeRate))) sel.value = String(r.timeRate);
    }
    engine.update(0);
    const body = engine.frame.type === 'solar' && r.rel ? engine.bodies.get(r.target) : null;
    engine.camPos = body ? [body.pos[0] + r.rel[0], body.pos[1] + r.rel[1], body.pos[2] + r.rel[2]] : r.camPos.slice();
    if (Array.isArray(r.camQuat) && r.camQuat.length === 4 && r.camQuat.every(Number.isFinite)) engine.camQuat.set(r.camQuat[0], r.camQuat[1], r.camQuat[2], r.camQuat[3]).normalize();
    controls.stop(); if (r.orbit && r.orbit.key && Number.isFinite(r.orbit.period) && r.orbit.period > 0) controls.setOrbit(r.orbit.key, true, r.orbit.period);
    engine.update(0); return true;
  }
  // 重設所有設定（AUDIT D7）：清掉所有 ndf-* localStorage 與還原資料，去掉網址參數（?safe=1、?quality=）以預設值重新載入
  function resetAllSettings() {
    try { for (const k of Object.keys(localStorage)) if (k.startsWith('ndf-')) localStorage.removeItem(k); } catch (e) { /* ignore */ }
    try { sessionStorage.removeItem(RESUME_KEY); } catch (e) { /* ignore */ }
    location.href = location.pathname;
  }
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
  $('btn-settings').addEventListener('click', () => { const open = $('settings').classList.toggle('open'); document.body.classList.toggle('settings-open', open); ui.fillCatalogInfo(catalog, engine); });
  $('tab-obs').addEventListener('click', () => { observe.build(); $('observe').classList.add('open'); controls.exitPointerLock(); });
  $('tab-3d').addEventListener('click', () => $('observe').classList.remove('open'));
  // 觸控升降
  const tHold = (id, v) => { const b = $(id); b.addEventListener('touchstart', (e) => { e.preventDefault(); controls.vertical = v; }, { passive: false }); const off = () => { controls.vertical = 0; }; b.addEventListener('touchend', off); b.addEventListener('touchcancel', off); };
  tHold('t-up', 1); tHold('t-down', -1);
  controls.onTouchJoystick = (m) => { const j = $('joy'); if (!m) { j.style.display = 'none'; return; } j.style.display = 'block'; j.style.left = `${m.x0 - 55}px`; j.style.top = `${m.y0 - 55}px`; const dx = clamp(m.x - m.x0, -40, 40), dy = clamp(m.y - m.y0, -40, 40); $('knob').style.transform = `translate(${dx}px, ${dy}px)`; };
  controls.onCollide = (n) => { if (!controls._collideToast || performance.now() - controls._collideToast > 4000) { controls._collideToast = performance.now(); ui.toast(`已到達 ${n.def.zh} 的觀測邊界（${n.def.minAltitude >= 1000 ? '氣態行星／恆星沒有可站立表面' : '最低安全高度'}）`); } };
  controls.onKey = (code) => {
    if (code === 'KeyH') ui.setHidden(!ui.hidden);
    if (code === 'KeyC') { prefs.bars = !prefs.bars; savePrefs(); applyPrefs(); const el = $('s-bars'); if (el) el.checked = prefs.bars; }
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
    quality, safe, ...prefs,
    onCine: (v) => { prefs.cine = v; savePrefs(); applyPrefs(); },
    onBars: (v) => { prefs.bars = v; savePrefs(); applyPrefs(); },
    onBreath: (v) => { prefs.breath = v; savePrefs(); applyPrefs(); },
    onAutohide: (v) => { prefs.autohide = v; savePrefs(); applyPrefs(); },
    onExposure: (v) => { engine.exposureMode = v; },
    onLabels: (v) => { engine.showLabels = v; ui.labels.style.display = v ? '' : 'none'; },
    onVenus: (v) => engine.setVenusRadar(v),
    onWx: (v) => { earthWx.setEnabled(v); if (v && engine.timeRate !== 1) ui.toast('近即時紅外線只在「時間＝即時」時顯示；請把時間倍率設回即時'); },
    onSens: (v) => { controls.sensitivity = 0.0022 * v; },
    onInvert: (v) => { controls.invertY = v; },
    onFov: (v) => { engine.camera.fov = v; engine.camera.updateProjectionMatrix(); },
    onBeforeReload: saveResume, onResetAll: resetAllSettings,
    onReport: async () => { const d = await import('./diag.js'); return d.quickReport(engine, { quality, extra: { safe, prefs, loadErrors: errors.slice(0, 20), target: controls.target, audio: audio.mode } }); },
    onAudio: async (v) => { const r = await startAudio(v); if (r?.ok && v === 'sonify' && r.table) $('s-audio-note').innerHTML += '<br>目前音高：' + r.table.map((x) => `${BODY_BY_KEY[x.key].zh} ${x.hz.toFixed(1)} Hz（週期 ${x.periodDays} 天，升 ${x.octaves} 個八度）`).join('；'); },
  });
  syncAudioUI(); // 開頁時音訊為 off：選單與按鈕都顯示未播放，不預先顯示音景已選


  const earthView = new EarthSurfaceView(engine, controls, ui);
  const earthWx = new EarthWeatherLayer(engine, { onStatus: (s) => ui.setWeatherStatus(s) });

  // 測試鉤子（瀏覽器自動化用）
  if (params.has('diag')) import('./diag.js').then((m) => m.initDiag(engine, controls, { quality })).catch((e) => console.error('診斷模式載入失敗', e));
  window.__ndf = {
    engine, controls, catalog, goTo, earthView, earthWx,
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

  // ---------------- 開始（開場） ----------------
  const resume = readResume();
  const resumed = !!(resume && applyResume(resume));
  if (!resumed) {
    engine.simTime = Date.now(); // 載入貼圖期間時鐘未推進，開場時把「即時」對齊現在（B6）
    goTo(catalog.entries.find((e) => e.kind === 'body' && e.id === 'earth'), { instant: true });
    openingView();
  }
  fadeLevel = 1;
  $('loading').classList.add('done');
  if (resumed) setTimeout(() => ui.toast('設定已套用，已回到重載前的位置', 3500), 600);
  else setTimeout(() => ui.titleCard('ARC', '第一人稱 · 真實比例 · 測試版', '任何輸入即可開始飛行', 5200), 900);
  const openT0 = performance.now();
  if (errors.length) setTimeout(() => ui.toast(`有 ${errors.length} 項資源載入失敗，詳見設定 → 載入狀態`, 6000), 6500);

  // 主迴圈
  let last = performance.now(); let frames = 0, fpsT = last, fps = 0, uiT = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    if ($('observe').classList.contains('open')) return; // 真實觀測分頁開啟時暫停渲染，省電
    const nearest = engine.update(dt);
    controls.update(dt, nearest);
    engine.render();
    earthView.update(); earthWx.update();
    // 黑洞光線追蹤自適應步數：掉幀就減步數，流暢就逐步加回
    if (engine.frame.type === 'bh') {
      const u = engine.bhMat.uniforms.uSteps; const maxSteps = engine.bhMaxSteps || (engine.bhMaxSteps = u.value);
      if (dt > 0.05) u.value = Math.max(120, Math.floor(u.value * 0.85)); else if (dt < 0.022) u.value = Math.min(maxSteps, Math.floor(u.value * 1.04) + 1);
    }
    // 光速效果、開場淡入、眩光
    warp = controls.moving && controls.velocity.length() > 0.3 * C_KM_S;
    const lvl = Math.max(fxLevel, warp ? clamp(Math.log10(controls.velocity.length() / (0.3 * C_KM_S)) * 0.25 + 0.25, 0.25, 0.8) : 0);
    if (!jumping && fadeLevel > 0) fadeLevel = Math.max(0, 1 - (now - openT0) / 3200);
    drawFx(lvl, fadeLevel);
    frames++; if (now - fpsT > 1000) { fps = frames; frames = 0; fpsT = now; }
    uiT += dt;
    if (uiT > 0.12) {
      uiT = 0; idleTick();
      if (engine.showLabels) ui.updateLabels(engine.labelTargets, engine, (key) => { const e = entryForKey(key); if (e) goTo(e); });
      const tgt = engine.frame.type === 'solar' ? engine.bodies.get(controls.target) : engine.extraBodies.find((x) => x.key === controls.target);
      const rel = tgt ? Math.hypot(tgt.pos[0] - engine.camPos[0], tgt.pos[1] - engine.camPos[1], tgt.pos[2] - engine.camPos[2]) : null;
      const radius = tgt ? (tgt.def?.radius ?? tgt.radius) : null;
      ui.setStatus({
        speed: controls.autoSpeed || controls.boost ? controls.currentSpeed : controls.manualSpeed, autoSpeed: controls.autoSpeed, boost: controls.boost,
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
