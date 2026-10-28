// GPU 診斷模式（網址加 ?diag=1 啟用）：顯示 GPU／WebGL 能力、即時效能、shader 錯誤，並提供逐項關閉視覺效果的開關，
// 用來在真機（iPhone／Android）上隔離破圖成因。純工程工具，不改變任何天文資料或標示。
// 其他網址參數：?quality=low|medium|high（覆蓋畫質）、?nolog=1（關閉對數深度緩衝，需重新載入）
const $ = (id) => document.getElementById(id);

// GPU／WebGL 能力表（診斷覆蓋層與設定面板「回報問題」共用）
export function collectCaps(engine, quality) {
  const gl = engine.renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const prec = (sh, t) => { const f = gl.getShaderPrecisionFormat(sh, t); return f ? `${f.precision}b [${f.rangeMin},${f.rangeMax}]` : '?'; };
  return {
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '（瀏覽器未揭露）', vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : '',
    webgl: gl.getParameter(gl.VERSION), glsl: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    depthBits: gl.getParameter(gl.DEPTH_BITS), maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE), maxVarying: gl.getParameter(gl.MAX_VARYING_VECTORS), maxFragUniforms: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
    fragHighp: prec(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT), fragMediump: prec(gl.FRAGMENT_SHADER, gl.MEDIUM_FLOAT), vertHighp: prec(gl.VERTEX_SHADER, gl.HIGH_FLOAT),
    halfFloatRT: !!gl.getExtension('EXT_color_buffer_half_float') || !!gl.getExtension('EXT_color_buffer_float'), aniso: engine.maxAniso,
    dpr: window.devicePixelRatio, pixelRatio: engine.renderer.getPixelRatio(), drawingBuffer: `${gl.drawingBufferWidth}×${gl.drawingBufferHeight}`,
    quality, logDepth: engine.renderer.capabilities.logarithmicDepthBuffer, cores: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory ?? '?', ua: navigator.userAgent,
  };
}

// 報告內容（JSON）：診斷覆蓋層的「產生／複製報告」與設定面板的「回報問題」共用；state／flags 沒有診斷層時為空
export function buildReport(engine, { caps, state = {}, flags = null, extra = {} } = {}) {
  return JSON.stringify({ time: new Date().toISOString(), url: location.href, caps, flags, fps: state.fps !== undefined ? { avg: state.fps, min: state.fpsMin } : null, earthLod: engine.earthLod?.status() || null, frame: engine.renderer.info.render, memory: engine.renderer.info.memory, programs: engine.renderer.info.programs?.length, jsHeapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, contextLost: state.lost ?? null, engineContextLost: engine.contextLost, degrade: engine.degrade, pixelRatioNow: engine.renderer.getPixelRatio(), post: engine.postOn, nan: state.nanScans !== undefined ? { scans: state.nanScans, pixels: state.nanPixels, first: state.nanFirst || null } : null, blackFrames: state.blackFrames ?? null, coverage: state.coverage || null, lumaMax: state.lumaMax ?? null, shaderErrors: state.errors || engine.shaderErrors || [], consoleErrors: state.consoleErrors || [], frameType: engine.frame.type, camPos: engine.camPos.map((v) => Math.round(v)), simTime: new Date(engine.simTime).toISOString(), timeRate: engine.timeRate, ...extra }, null, 1);
}

// 設定面板「回報問題」（AUDIT A6）：不開診斷覆蓋層，直接產生報告並嘗試複製到剪貼簿；回傳 { text, copied }
export async function quickReport(engine, { quality, extra } = {}) {
  const text = buildReport(engine, { caps: collectCaps(engine, quality), extra });
  let copied = false; try { await navigator.clipboard.writeText(text); copied = true; } catch (e) { /* iOS 可能拒絕，由文字框手動複製 */ }
  return { text, copied };
}

export function initDiag(engine, controls, { quality } = {}) {
  const gl = engine.renderer.getContext();
  const caps = collectCaps(engine, quality);
  const state = { lost: 0, errors: engine.shaderErrors || [], consoleErrors: [], fps: 0, fpsMin: 999, frame: 0, t0: performance.now(), samples: [], nanPixels: 0, nanScans: 0, blackFrames: 0, lumaMax: 0, lumaLast: 0 };
  engine.canvas.addEventListener('webglcontextlost', () => { state.lost++; }, false);
  const origErr = console.error.bind(console);
  console.error = (...a) => { state.consoleErrors.push(a.map((x) => String(x?.message || x)).join(' ').slice(0, 400)); if (state.consoleErrors.length > 20) state.consoleErrors.shift(); origErr(...a); };

  // ---- 覆蓋層
  const box = document.createElement('div'); box.id = 'diag';
  box.style.cssText = 'position:fixed;left:8px;top:calc(60px + env(safe-area-inset-top,0px));z-index:60;max-width:min(92vw,420px);max-height:70vh;overflow:auto;background:rgba(0,0,0,.86);color:#dfe7f2;font:11px/1.5 monospace;padding:8px 10px;border:1px solid rgba(255,255,255,.2);letter-spacing:0;pointer-events:auto';
  document.body.appendChild(box);
  const btn = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.style.cssText = 'font:11px monospace;margin:2px 4px 2px 0;padding:3px 6px;border:1px solid rgba(255,255,255,.3);color:#fff;background:rgba(255,255,255,.08)'; b.addEventListener('click', fn); return b; };
  const live = document.createElement('pre'); live.style.cssText = 'margin:6px 0;white-space:pre-wrap;word-break:break-all';
  const head = document.createElement('div'); head.innerHTML = `<b>ARC GPU 診斷</b> · ${escape(caps.renderer)}<br>WebGL ${escape(caps.webgl)} · 深度 ${caps.depthBits} bit · 貼圖上限 ${caps.maxTex} · frag highp ${caps.fragHighp} · mediump ${caps.fragMediump}<br>DPR ${caps.dpr} → 像素比 ${caps.pixelRatio} · 緩衝 ${caps.drawingBuffer} · 畫質 ${quality} · 對數深度 ${caps.logDepth} · 半浮點 RT ${caps.halfFloatRT}`;
  box.appendChild(head); box.appendChild(live);

  // ---- 逐項開關（即時生效；對數深度與畫質需重新載入）
  const earth = engine.bodies.get('earth');
  const toggles = document.createElement('div');
  const flags = { cine: engine.cineOn !== false, bloom: !!engine.bloom && engine.bloom.enabled !== false, normal: true, atmo: true, breath: engine.breath, aniso: true, flare: true };
  const refresh = () => { for (const [k, b] of Object.entries(tbtns)) b.style.background = flags[k] ? 'rgba(80,160,80,.4)' : 'rgba(160,60,60,.4)'; };
  const tbtns = {
    cine: btn('電影後製', () => { flags.cine = !flags.cine; engine.setCine(flags.cine); refresh(); }),
    bloom: btn('Bloom', () => { flags.bloom = !flags.bloom; if (engine.bloom) engine.bloom.enabled = flags.bloom; refresh(); }),
    normal: btn('地球法線貼圖', () => { flags.normal = !flags.normal; const u = earth?.mesh.material.uniforms; if (u?.uNormalStrength) { if (!flags.normal) { u._ns = u.uNormalStrength.value; u.uNormalStrength.value = 0; } else u.uNormalStrength.value = u._ns ?? 0.22; } refresh(); }),
    atmo: btn('大氣殼', () => { flags.atmo = !flags.atmo; for (const e of engine.bodies.values()) if (e.atmo) e.atmo.visible = flags.atmo; refresh(); }),
    breath: btn('鏡頭呼吸', () => { flags.breath = !flags.breath; engine.breath = flags.breath; refresh(); }),
    aniso: btn('各向異性過濾', () => { flags.aniso = !flags.aniso; for (const t of Object.values(engine.textures || {})) { if (t) { t.anisotropy = flags.aniso ? engine.maxAniso : 1; t.needsUpdate = true; } } refresh(); }),
    flare: btn('眩光', () => { flags.flare = !flags.flare; engine.flareDisabled = !flags.flare; refresh(); }),
    post: btn('後處理（整組）', () => { flags.post = !flags.post; engine.setPost(flags.post); refresh(); }),
  };
  flags.post = engine.postOn !== false;
  for (const b of Object.values(tbtns)) toggles.appendChild(b);
  toggles.appendChild(btn('球面覆蓋自檢', () => { const r = engine.coverageSelfTest?.(); live.textContent += r ? `\n覆蓋自檢：L${r.level} 像素 ${r.lodPixels}／L0 像素 ${r.basePixels}，比值 ${r.ratio.toFixed(3)}，盤面內黑洞像素 ${r.holes}（${(r.holeFraction * 100).toFixed(2)}%）${r.ratio < 0.98 || r.holeFraction > 0.005 ? '（⚠ 球面有缺塊／缺面）' : '（完整）'}，高度 ${r.altitudeKm} km` : '\n覆蓋自檢：無地球'; state.coverage = r; }));
  toggles.appendChild(btn('重試失敗分塊', () => { const n = engine.earthLod?.retryFailed?.() ?? 0; live.textContent += `\n已重置 ${n} 個失敗分塊`; }));
  toggles.appendChild(btn('像素比 1', () => { engine.maxPixelRatio = 1; engine.resize(); }));
  toggles.appendChild(btn('安全模式（重載）', () => { const u = new URL(location.href); u.searchParams.set('safe', '1'); location.href = u.toString(); }));
  toggles.appendChild(btn(caps.logDepth ? '關閉對數深度（重載）' : '開啟對數深度（重載）', () => { const u = new URL(location.href); if (caps.logDepth) u.searchParams.set('nolog', '1'); else u.searchParams.delete('nolog'); location.href = u.toString(); }));
  for (const q of ['low', 'medium', 'high']) toggles.appendChild(btn(`畫質 ${q}（重載）`, () => { const u = new URL(location.href); u.searchParams.set('quality', q); location.href = u.toString(); }));
  toggles.appendChild(btn('前往地球', () => { const e = window.__ndf?.catalog.entries.find((x) => x.kind === 'body' && x.id === 'earth'); if (e) window.__ndf.goTo(e, { instant: true }); }));
  toggles.appendChild(btn('前往土星', () => { const e = window.__ndf?.catalog.entries.find((x) => x.kind === 'body' && x.id === 'saturn'); if (e) window.__ndf.goTo(e, { instant: true }); }));
  box.appendChild(toggles); refresh();

  // ---- 報告（複製到剪貼簿 ＋ 文字框）
  const ta = document.createElement('textarea'); ta.style.cssText = 'width:100%;height:90px;font:10px monospace;background:#000;color:#9fd9b4;border:1px solid rgba(255,255,255,.2);margin-top:6px'; ta.readOnly = true;
  const report = () => buildReport(engine, { caps, state, flags });
  box.appendChild(btn('產生／複製報告', async () => { const r = report(); ta.value = r; ta.style.display = ''; try { await navigator.clipboard.writeText(r); ta.value = '（已複製到剪貼簿）\n' + r; } catch (e) { /* iOS 可能拒絕，改由文字框手動複製 */ } }));
  box.appendChild(btn('隱藏診斷', () => { box.style.display = 'none'; }));
  ta.style.display = 'none'; box.appendChild(ta);

  // ---- 即時數據
  let last = performance.now(), acc = 0, n = 0;
  const tick = (now) => {
    const dt = now - last; last = now; acc += dt; n++;
    if (acc >= 1000) { state.fps = Math.round(n * 1000 / acc); if (state.frame > 3) state.fpsMin = Math.min(state.fpsMin, state.fps); state.frame++; acc = 0; n = 0;
      const r = engine.renderer.info.render, m = engine.renderer.info.memory;
      const lod = engine.earthLod?.status();
      const lodLine = lod ? `\n地球分塊 ${lod.state === 'ready' ? `L${lod.level}（${lod.size}px）· 視野內 ${lod.needed} · 已載入 ${lod.loaded} · 載入中 ${lod.loading} · 失敗 ${lod.failed}（退避重試中 ${lod.retrying ?? 0}、已放棄 ${lod.gaveUp ?? 0}、上傳無效 ${lod.badUploads ?? 0}${lod.failReasons && Object.keys(lod.failReasons).length ? '：' + Object.entries(lod.failReasons).map(([k, v]) => `${k}×${v}`).join('、') : ''}） · ${lod.bytesMB}/${lod.budgetMB} MB${lod.synthetic ? ' · ⚠ 合成測試資料' : ''}` : lod.state === 'missing' ? '未安裝（沿用 4K）' : lod.state}` : '';
      // 每秒掃描一次場景輸出（低解析）：非有限值像素數與平均亮度；亮度突然掉到峰值 3% 以下視為黑幀
      try {
        const s = engine.scanNonFinite(0.08); state.nanScans++; state.nanPixels += s.bad; if (s.bad && !state.nanFirst) state.nanFirst = { ...s.first, frame: engine.frame.type, camPos: engine.camPos.map((v) => Math.round(v)) };
        state.lumaLast = s.meanLuma; if (state.lumaMax > 0.005 && s.meanLuma < state.lumaMax * 0.03) state.blackFrames++; state.lumaMax = Math.max(state.lumaMax * 0.995, s.meanLuma);
      } catch (e) { state.scanError = String(e.message || e); }
      live.textContent = `FPS ${state.fps}（最低 ${state.fpsMin === 999 ? '—' : state.fpsMin}） · 繪製 ${r.calls} 次 · 三角形 ${r.triangles.toLocaleString()} · 貼圖 ${m.textures} · 幾何 ${m.geometries} · 程式 ${engine.renderer.info.programs?.length ?? '?'}\nframe ${engine.frame.type} · 黑洞步數 ${engine.frame.type === 'bh' ? engine.bhMat.uniforms.uSteps.value : '—'} · context lost ${state.lost}（引擎 ${engine.contextLost}，降級 ${engine.degrade}）· 像素比 ${engine.renderer.getPixelRatio()} · 後處理 ${engine.postOn ? '開' : '關'}\n非有限值像素 ${state.nanPixels}／${state.nanScans} 次掃描${state.nanFirst ? `（首見 ${state.nanFirst.frame} (${state.nanFirst.x},${state.nanFirst.y})）` : ''} · 黑幀 ${state.blackFrames} · 亮度 ${state.lumaLast.toFixed(4)}（峰 ${state.lumaMax.toFixed(4)}）${state.scanError ? ' · 掃描錯誤 ' + state.scanError : ''}${lodLine}\nshader 錯誤 ${state.errors.length}${state.errors.length ? '\n' + state.errors.map((e) => '  ' + e.slice(0, 220)).join('\n') : ''}${state.consoleErrors.length ? '\nconsole 錯誤 ' + state.consoleErrors.length + '：' + state.consoleErrors[state.consoleErrors.length - 1].slice(0, 160) : ''}`;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__ndfDiag = { caps, flags, state, report };
  return window.__ndfDiag;
}

function escape(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
