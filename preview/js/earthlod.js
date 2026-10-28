// 地球分塊 LOD：以靜態分塊金字塔（tools/build_earth_tiles.py 產生）提升近距離清晰度。
// 設計重點：
//  - L0 永遠是既有的 4096×2048 全球圖；L1（8192）／L2（16384）切成 2048² 的塊，依「貼圖像素／螢幕像素」選層。
//  - 層級 > 0 時，以該層的球面補丁覆蓋整顆地球；每個補丁有自己的塊貼圖，塊尚未載入或失敗時沿用 L0（同一 UV），
//    因此永遠不會出現缺塊或整顆消失，也沒有 z-fighting（補丁取代本體，不是疊在上面）。
//  - 只載入視野內且面向相機的塊；同時請求上限 4；GPU 預算超過時 LRU 釋放最久未用的塊。
//  - 雲層、夜燈、法線、粗糙度仍用既有 4K 全球圖與原 UV，對位不變。manifest 缺失 → 標示「未安裝」，不偽造。
import * as THREE from 'three';

const TILE_BYTES = 2048 * 2048 * 4 * 1.34; // RGBA + mipmaps 估算
const MAX_TRIES = 5; // 同一塊連續失敗達此次數即放棄自動重試（總等待約 2+4+8+16 秒），避免對來源形成請求風暴

export class EarthLod {
  constructor(engine, path = 'assets/textures/earth_tiles') {
    this.engine = engine; this.path = path;
    this.manifest = null; this.state = 'loading'; // loading | ready | missing | error
    this.level = 0; this.pendingLevel = 0; this.pendingFrames = 0;
    this.patches = new Map();   // level → [mesh]
    this.tiles = new Map();     // key `L1_x_y` → { tex, bytes, lastUse, state }
    this.loading = 0; this.maxConcurrent = 4; this.failed = 0; this.loadedBytes = 0; this.frame = 0;
    this.maxLevel = engine.quality === 'low' ? 1 : 2;
    this.budgetBytes = engine.quality === 'high' ? 384e6 : 128e6;
    this.loader = new THREE.TextureLoader();
    this.frustum = new THREE.Frustum(); this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3();
    this.neededNow = 0;
    fetch(`${path}/manifest.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then((m) => {
      if (!m || !Array.isArray(m.levels) || !m.levels.length) throw new Error('manifest 格式不符');
      this.manifest = m; this.state = 'ready';
      if (m.base?.file) this._loadBase(`${path}/${m.base.file}`); // 同來源 4K 底圖：各層色調一致（失敗則沿用既有底圖）
    }).catch((e) => { this.state = String(e.message) === '404' ? 'missing' : 'error'; this.error = String(e.message || e); });
  }

  _loadBase(file) {
    this.loader.load(file, (tex) => {
      const earth = this.engine.bodies.get('earth'); if (!earth) { tex.dispose(); return; }
      tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.anisotropy = this.engine.maxAniso;
      const previous = earth.mesh.material.uniforms.uDay.value;
      earth.mesh.material.uniforms.uDay.value = tex;
      for (const arr of this.patches.values()) for (const p of arr) p.material.uniforms.uDay.value = tex;
      // 釋放原 4K 底圖的 GPU 記憶體（約 45 MB）；引擎貼圖表同步指向新底圖（GPT 稽核建議）
      const basePath = earth.def.textures?.day;
      if (basePath && this.engine.textures[basePath] === previous) this.engine.textures[basePath] = tex;
      if (previous && previous !== tex) previous.dispose();
      this.baseSwapped = true;
    }, undefined, () => { this.baseSwapped = false; });
  }

  status() {
    const lv = this.manifest?.levels?.[this.level - 1];
    return { state: this.state, synthetic: !!this.manifest?.synthetic_test, baseSwapped: !!this.baseSwapped, overBudget: this.overBudget || 0, capLevel: this.capLevel ?? null, capEvents: this.capEvents || 0, level: this.level, size: lv ? lv.size[0] : 4096, needed: this.neededNow, loaded: [...this.tiles.values()].filter((t) => t.state === 'ok').length, loading: this.loading, failed: this.failed, retrying: [...this.tiles.values()].filter((t) => t.state === 'failed').length, gaveUp: [...this.tiles.values()].filter((t) => t.state === 'gaveup').length, badUploads: this.badUploads || 0, failReasons: Object.fromEntries([...this.tiles.values()].filter((t) => t.why && t.state !== 'ok').reduce((m, t) => m.set(t.why, (m.get(t.why) || 0) + 1), new Map())), bytesMB: Math.round(this.loadedBytes / 1048576), budgetMB: Math.round(this.budgetBytes / 1048576), maxLevel: this.maxLevel };
  }

  // 每幀由 engine._updateSolar 呼叫：earthEntry、相對相機位置、每弧度的裝置像素數
  update(earth, rel, pxPerRad) {
    if (this.state !== 'ready' || !earth.mesh.material.uniforms.uTile) return;
    this.frame++; const now = performance.now();
    // ---- 選層：星下點的像素足跡 ≈ 高度 / pxPerRad（km），texel ≈ 2πR / W；要 1 texel/pixel 則 W ≥ 2πR·pxPerRad / 高度
    const R = earth.def.radius; const alt = Math.max(rel.length() - R, 1);
    const need = 2 * Math.PI * R * pxPerRad / alt;
    let desired = 0;
    for (let i = 0; i < this.manifest.levels.length && i < this.maxLevel; i++) if (need > (i === 0 ? 4096 : this.manifest.levels[i - 1].size[0]) * 1.15) desired = i + 1;
    // 預算上限：某層可見塊超過預算容量時降一層，並記住當時的像素需求；需求明顯改變（拉近→可見塊變少、拉遠→本來就降層）才解除
    if (this.capLevel != null) { if (need > this.capNeed * 1.6 || need < this.capNeed * 0.6) this.capLevel = null; else desired = Math.min(desired, this.capLevel); }
    if (desired !== this.level) {
      // 遲滯：連續 12 幀一致才切換；往下切要更明顯（避免在邊界抖動）
      if (desired === this.pendingLevel) this.pendingFrames++; else { this.pendingLevel = desired; this.pendingFrames = 0; }
      const curSize = this.level === 0 ? 4096 : this.manifest.levels[this.level - 1].size[0];
      const farBelow = desired < this.level && need < curSize * 0.6; // 明顯拉遠：立即降層，不再載入本層
      if (farBelow || this.pendingFrames >= 6) this._setLevel(earth, desired);
    }
    if (this.level === 0) return;
    const downgrading = desired < this.level;
    // ---- 同步共用 uniform 到本層補丁
    const base = earth.mesh.material.uniforms;
    const patches = this.patches.get(this.level);
    const cam = this.engine.camera;
    this._m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this._m);
    earth.mesh.updateWorldMatrix(true, false);
    const mw = earth.mesh.matrixWorld; const centerW = earth.group.position;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.engine.camQuat);
    const wanted = []; let needed = 0;
    const pt = new THREE.Vector3(), nrm = new THREE.Vector3();
    // 視線（畫面中心與四角）打到地球的點所在的塊：補足「視野完全落在單一塊內」時取樣點都不在視錐內的情況
    const lv = this.manifest.levels[this.level - 1]; const hitKeys = new Set();
    const inv = this._m.copy(mw).invert();
    for (const [nx, ny] of [[0, 0], [-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
      const d = pt.set(nx, ny, 0.5).unproject(cam).normalize(); // 相機在原點
      const b = d.dot(centerW); const c = centerW.dot(centerW) - R * R; const disc = b * b - c; if (disc < 0) continue;
      const tHit = b - Math.sqrt(disc); if (tHit <= 0) continue;
      nrm.copy(d).multiplyScalar(tHit).applyMatrix4(inv).normalize(); // 物件空間單位球
      const theta = Math.acos(THREE.MathUtils.clamp(nrm.y, -1, 1)); let phi = Math.atan2(nrm.z, -nrm.x); if (phi < 0) phi += Math.PI * 2;
      hitKeys.add(`L${this.level}_${Math.min(lv.nx - 1, Math.floor(phi / (Math.PI * 2) * lv.nx))}_${Math.min(lv.ny - 1, Math.floor(theta / Math.PI * lv.ny))}`);
    }
    for (const p of patches) {
      const u = p.material.uniforms;
      for (const k of ['uSunDir', 'uAtmoColor']) u[k].value.copy(base[k].value);
      for (const k of ['uSunIntensity', 'uDetail', 'uCloudShift', 'uCloudOpacity', 'uNightBoost', 'uNormalStrength', 'uUOffset', 'uHasRings', 'uWxOn', 'uDebugFlat']) if (base[k] && u[k]) u[k].value = base[k].value;
      if (base.uWx && u.uWx) { u.uWx.value = base.uWx.value; u.uWxBox.value.copy(base.uWxBox.value); } // 近即時紅外線圖層（共用貼圖）
      // 可見：補丁中心或任一角在視錐內，且該點面向相機（相機在原點）
      let visible = hitKeys.has(p.userData.key), prio = visible ? 1 : -2;
      for (const c of p.userData.samples) {
        pt.copy(c).applyMatrix4(mw); nrm.copy(pt).sub(centerW).normalize();
        const facing = nrm.dot(this._v.copy(pt).negate().normalize()) > 0.02;
        if (facing && this.frustum.containsPoint(pt)) { visible = true; prio = Math.max(prio, this._v.copy(pt).normalize().dot(fwd)); }
      }
      const t = this.tiles.get(p.userData.key);
      if (t && t.state === 'ok') { if (u.uHasTile.value < 0.5) { u.uTile.value = t.tex; u.uHasTile.value = 1; } }
      else if (u.uHasTile.value > 0.5) { u.uHasTile.value = 0; u.uTile.value = null; }
      if (!visible) continue;
      needed++;
      if (t?.state === 'ok') t.lastUse = this.frame;
      // 未載入、或先前失敗且已到退避時間（頁面可見時）→ 排入載入；放棄的塊（連續失敗達上限）不再自動重試
      else if ((!t || (t.state === 'failed' && now >= t.retryAt)) && !downgrading && !document.hidden) wanted.push({ p, prio });
    }
    this.neededNow = needed;
    // 硬性預算（第一道）：本層可見塊 × 每塊 GPU 位元組 > 預算 → 立即降一層（低層可見塊約為 1/4），不等載入
    if (needed * TILE_BYTES > this.budgetBytes && this.level > 0) {
      this.capLevel = this.level - 1; this.capNeed = need; this.capEvents = (this.capEvents || 0) + 1;
      this._setLevel(earth, this.capLevel);
      return;
    }
    wanted.sort((a, b) => b.prio - a.prio);
    // 硬性預算（第二道）：已載入＋載入中＋本次要載入 不得超過 budgetBytes；超出的可見塊沿用 L0（不缺塊）。先釋放不可見的塊騰出空間。
    this._evict(wanted.length * TILE_BYTES);
    this.overBudget = 0;
    for (const w of wanted) {
      if (this.loading >= this.maxConcurrent) break;
      if (this.loadedBytes + (this.loading + 1) * TILE_BYTES > this.budgetBytes) { this.overBudget = wanted.length - wanted.indexOf(w); break; }
      this._load(w.p);
    }
  }

  _setLevel(earth, level) {
    if (level > 0) this._ensurePatches(earth, level);
    for (const [lv, arr] of this.patches) for (const p of arr) p.visible = lv === level;
    earth.mesh.material.visible = level === 0; // 補丁取代本體（本體仍是父物件，供子物件繼承轉換）
    this.level = level; this.pendingFrames = 0;
  }

  _ensurePatches(earth, level) {
    if (this.patches.has(level)) return;
    const lv = this.manifest.levels[level - 1]; const { nx, ny } = lv;
    const segs = Math.max(8, Math.round(this.engine.segments / nx)) ;
    const arr = [];
    for (const f of lv.files) {
      const { x, y } = f;
      const phiStart = (x / nx) * Math.PI * 2, phiLen = (Math.PI * 2) / nx, thStart = (y / ny) * Math.PI, thLen = Math.PI / ny;
      const g = new THREE.SphereGeometry(1, segs, segs, phiStart, phiLen, thStart, thLen);
      const uv = g.attributes.uv; // 改寫為全球 UV，與本體及雲層／夜燈對位
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (x + uv.getX(i)) / nx, 1 - (y + (1 - uv.getY(i))) / ny);
      uv.needsUpdate = true; g.computeBoundingSphere();
      const baseMat = earth.mesh.material;
      const uniforms = THREE.UniformsUtils.clone(baseMat.uniforms);
      for (const k of ['uDay', 'uNight', 'uBRC', 'uNormal']) uniforms[k].value = baseMat.uniforms[k].value; // 共用貼圖，不複製
      uniforms.uTile = { value: null }; uniforms.uHasTile = { value: 0 };
      uniforms.uTileOff = { value: new THREE.Vector2(x / nx, 1 - (y + 1) / ny) }; uniforms.uTileScale = { value: new THREE.Vector2(nx, ny) };
      const mat = new THREE.ShaderMaterial({ vertexShader: baseMat.vertexShader, fragmentShader: baseMat.fragmentShader, uniforms });
      const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 1; m.visible = false;
      // 取樣點（單位球面）：中心、四角、四邊中點，供可見性判斷（與 SphereGeometry 同一座標慣例）
      const dir = (phi, th) => new THREE.Vector3(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th));
      const samples = [];
      for (const a of [0, 0.5, 1]) for (const b of [0, 0.5, 1]) samples.push(dir(phiStart + a * phiLen, thStart + b * thLen));
      m.userData = { key: `L${level}_${x}_${y}`, file: `${this.path}/${f.file}`, samples };
      earth.mesh.add(m); arr.push(m);
    }
    this.patches.set(level, arr);
  }

  _load(p) {
    const key = p.userData.key;
    // 第二道硬上限也在這裡把關（update() 之外的呼叫者亦適用）：先釋放不可見的塊，額度仍不足就不發請求、沿用 L0
    const reserve = (this.loading + 1) * TILE_BYTES;
    this._evict(reserve);
    if (this.loadedBytes + reserve > this.budgetBytes) return false;
    const prev = this.tiles.get(key);
    const t = { tex: null, bytes: 0, lastUse: this.frame, state: 'loading', fails: prev?.fails || 0, retryAt: 0 }; this.tiles.set(key, t); this.loading++;
    const fail = (why) => { this.loading--; this.failed++; this._markFailed(t, why); };
    this.loader.load(p.userData.file, (tex) => {
      if (!tex.image || tex.image.width !== this.manifest.tile || tex.image.height !== this.manifest.tile) { tex.dispose(); fail('尺寸不符'); return; }
      tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.ClampToEdgeWrapping; tex.anisotropy = this.engine.maxAniso;
      // 上傳到 GPU 後驗證（A2 黑色扇形假說：iOS 記憶體不足時貼圖上傳靜默失敗，取樣為全黑，而補丁取代了本體 → 整塊純黑）。
      // 驗證失敗視同載入失敗：該塊沿用 L0 底圖（uHasTile=0），並走退避重試；原因記在 t.why 供 ?diag=1 顯示。
      const bad = this._verifyTile(tex);
      if (bad) { tex.dispose(); this.badUploads = (this.badUploads || 0) + 1; fail(bad); return; }
      this.loading--;
      t.tex = tex; t.bytes = TILE_BYTES; t.state = 'ok'; t.lastUse = this.frame; t.fails = 0; this.loadedBytes += t.bytes;
    }, undefined, () => fail('載入失敗'));
    return true;
  }

  // 把塊貼圖真的送上 GPU，檢查 GL 錯誤（GL_OUT_OF_MEMORY 等），再畫到 4×4 暫存讀回：取樣全黑就判定上傳無效。
  // 衛星影像的 4×4 縮圖不可能全為 (0,0,0)。沒有 renderer（單元測試的假引擎）時略過驗證。
  _verifyTile(tex) {
    const r = this.engine.renderer; if (!r || typeof r.initTexture !== 'function' || typeof r.readRenderTargetPixels !== 'function') return null;
    try {
      const gl = r.getContext(); while (gl.getError() !== gl.NO_ERROR) { /* 清掉先前殘留的錯誤旗標 */ }
      r.initTexture(tex);
      const err = gl.getError();
      if (err !== gl.NO_ERROR) return `GPU 上傳錯誤 0x${err.toString(16)}${err === gl.OUT_OF_MEMORY ? '（記憶體不足）' : ''}`;
      if (!this._probe) {
        this._probe = { rt: new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false, stencilBuffer: false }), scene: new THREE.Scene(), cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), mat: new THREE.MeshBasicMaterial(), buf: new Uint8Array(4 * 4 * 4) };
        this._probe.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._probe.mat); this._probe.scene.add(this._probe.mesh);
      }
      const p = this._probe; p.mat.map = tex; p.mat.needsUpdate = true;
      const prevRT = r.getRenderTarget(); const prevAuto = r.autoClear; r.autoClear = true;
      r.setRenderTarget(p.rt); r.render(p.scene, p.cam); r.readRenderTargetPixels(p.rt, 0, 0, 4, 4, p.buf); r.setRenderTarget(prevRT); r.autoClear = prevAuto;
      p.mat.map = null;
      let sum = 0; for (let i = 0; i < p.buf.length; i += 4) sum += p.buf[i] + p.buf[i + 1] + p.buf[i + 2];
      if (sum === 0) return '上傳後取樣為全黑';
      return null;
    } catch (e) { return `驗證失敗：${e && e.message ? e.message : e}`; }
  }

  // 失敗重試：指數退避 2、4、8、16、32 秒（上限 60 秒），連續失敗 MAX_TRIES 次後放棄（沿用 L0，不再打來源）；retryFailed() 可手動重置
  _markFailed(t, why) {
    t.fails = (t.fails || 0) + 1; t.why = why;
    if (t.fails >= MAX_TRIES) { t.state = 'gaveup'; t.retryAt = Infinity; return; }
    t.state = 'failed'; t.retryAt = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + Math.min(60000, 2000 * Math.pow(2, t.fails - 1));
  }
  retryFailed() { let n = 0; for (const t of this.tiles.values()) if (t.state === 'failed' || t.state === 'gaveup') { t.state = 'failed'; t.fails = 0; t.retryAt = 0; n++; } return n; }

  // 釋放最久未用（且目前不可見）的塊，直到「已載入 + 預留 reserve」低於預算
  _evict(reserve = 0) {
    if (this.loadedBytes + reserve <= this.budgetBytes) return;
    const cands = [...this.tiles.entries()].filter(([, t]) => t.state === 'ok' && t.lastUse < this.frame - 2).sort((a, b) => a[1].lastUse - b[1].lastUse);
    for (const [key, t] of cands) {
      if (this.loadedBytes + reserve <= this.budgetBytes) break;
      t.tex.dispose(); this.loadedBytes -= t.bytes; this.tiles.delete(key);
      for (const arr of this.patches.values()) for (const p of arr) if (p.userData.key === key) { p.material.uniforms.uHasTile.value = 0; p.material.uniforms.uTile.value = null; }
    }
  }
}
