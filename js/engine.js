// 3D 引擎：真實比例（km）、浮動原點（相機永遠在原點，世界相對相機移動）、對數深度緩衝
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { AU_KM, PC_KM, R_SUN_KM, R_JUP_KM, R_EARTH_KM, G_SI, M_SUN_KG, C_KM_S, clamp, lerp } from './units.js';
import * as ASTRO from './astro.js';
import { BODIES, BODY_BY_KEY } from './bodies.js';
import * as SH from './shaders.js';
import * as TX from './textures.js';
import { EarthLod } from './earthlod.js';

const V3 = THREE.Vector3;
// 黃道 J2000 [x,y,z] → three 世界座標（x, z, -y）
export const eclToWorld = (v) => [v[0], v[2], -v[1]];
const toV3 = (a) => new V3(a[0], a[1], a[2]);

function bbColor(T) { // 黑體近似色（線性空間近似）
  const t = clamp(T, 2000, 40000) / 100;
  const r = t <= 66 ? 1 : clamp(1.2929 * Math.pow(t - 60, -0.1332), 0, 1);
  const g = t <= 66 ? clamp(0.39 * Math.log(t) - 0.6318, 0, 1) : clamp(1.1298 * Math.pow(t - 60, -0.0755), 0, 1);
  const b = t >= 66 ? 1 : (t <= 19 ? 0 : clamp(0.5432 * Math.log(t - 10) - 1.1963, 0, 1));
  return new THREE.Color(r, g, b);
}
export function bvToTemp(bv) { return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62)); }

export class Engine {
  // post=false：安全模式，不經 EffectComposer（無 Bloom／電影後製），直接畫到畫布；maxPixelRatio：像素比上限（安全模式 1）
  constructor(canvas, { quality = 'high', logDepth = true, post = true, maxPixelRatio, earthLod = true, tilesPath = 'assets/textures/earth_tiles' } = {}) {
    this.canvas = canvas;
    this.quality = quality;
    this.opts = { earthLod, tilesPath };
    this.postOn = post;
    // 經後處理時場景畫在 composer 的暫存上，畫布本身的 MSAA 不會作用在場景，只浪費記憶體（iPad 容易觸發 context lost），改由 composer 暫存做 MSAA
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !post && quality !== 'low', logarithmicDepthBuffer: logDepth, powerPreference: 'high-performance' });
    // WebGL context 遺失／恢復：preventDefault 讓瀏覽器可以恢復；每次遺失自動降一級（像素比、Bloom），避免反覆遺失造成黑屏閃爍
    this.contextLost = 0; this.degrade = 0;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.contextLost++; this.onContextLost?.(this.contextLost); }, false);
    canvas.addEventListener('webglcontextrestored', () => { this.degrade = Math.min(3, this.degrade + 1); if (this._scanRT) { this._scanRT.dispose(); this._scanRT = null; } this.resize(); this.onContextRestored?.(this.degrade); }, false);
    this.maxPixelRatio = maxPixelRatio ?? (quality === 'high' ? 2 : 1.25);
    // shader 編譯／連結錯誤：保留摘要供診斷模式顯示（仍照常輸出到 console）
    this.shaderErrors = [];
    this.renderer.debug.onShaderError = (gl, program, vs, fs) => {
      const msg = `${gl.getProgramInfoLog(program) || ''} | VS: ${(gl.getShaderInfoLog(vs) || '').trim()} | FS: ${(gl.getShaderInfoLog(fs) || '').trim()}`.replace(/\s+/g, ' ');
      this.shaderErrors.push(msg.slice(0, 600));
      console.error('THREE.WebGLProgram: Shader Error', msg);
    };
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxPixelRatio));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.maxAniso = this.renderer.capabilities.getMaxAnisotropy();

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 1e19);
    this.camera.position.set(0, 0, 0);

    // 相機狀態（雙精度，單位 km，所屬 frame）
    this.camPos = [0, 0, 0];
    this.camQuat = new THREE.Quaternion();
    this.frame = { type: 'solar' };
    this.simTime = Date.now();
    this.timeRate = 1;
    this.sunIntensity = 1.0;
    this.exposureMode = 'auto'; // auto | stars | bodies
    this.starExposure = 1.0;
    this.bodyExposure = 1.0;
    this.showLabels = true;
    this.showOrbits = false;
    this.venusRadar = false;
    this.earthMarker = null;
    this.textureStatus = {}; // path → ok | error
    this.labelTargets = [];
    this.elapsed = 0;
    this.frameOriginKm = [0, 0, 0];
    this.renderScale = 1; // 每個渲染單位代表的公里數（遠距 frame 放大以避免 GPU 精度問題）
    this.anchorKey = null; this.prevAnchorPos = null; // 相機錨定的天體：天體移動時相機跟著移動
    this.breath = true;   // 鏡頭呼吸：極小幅度的緩慢擺動（只影響渲染用相機，不影響飛行狀態）
    this.flare = null;    // 鏡頭眩光來源（太陽／主星）：{ x, y, intensity, angR } 或 null

    this.segments = quality === 'high' ? 128 : quality === 'medium' ? 80 : 48;
    this._initPost();
    this._initSky();
    this.bodies = new Map();
    this.unitSphere = new THREE.SphereGeometry(1, this.segments, this.segments / 2);
    this.glowTex = TX.makeGlowSprite();
    this.sunDirWorld = new V3(1, 0, 0);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  // ------------------------------------------------------------- 後處理
  _initPost() {
    const size = this.renderer.getSize(new THREE.Vector2());
    // 場景暫存：半浮點（Bloom 需要 HDR）；高畫質用 4× MSAA（WebGL2），中低畫質不用以省記憶體
    const pr = this.renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x * pr), Math.max(1, size.y * pr), { type: THREE.HalfFloatType, samples: this.quality === 'high' ? 4 : 0 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.useBloom = this.quality !== 'low';
    if (this.useBloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.75, 0.65, 1.0);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    // 電影式後處理（色差、調色、暗角、顆粒）
    this.cine = new ShaderPass(new THREE.ShaderMaterial({
      vertexShader: SH.CINE_VERT, fragmentShader: SH.CINE_FRAG,
      uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.045 }, uVignette: { value: 0.45 }, uAberration: { value: 0.012 }, uGrade: { value: 1.0 }, uRes: { value: new THREE.Vector2(size.x, size.y) } },
    }));
    this.composer.addPass(this.cine);
    this.setCine(true);
  }
  setCine(on) {
    this.cineOn = on; const u = this.cine.material.uniforms;
    u.uGrain.value = on ? (this.quality === 'low' ? 0 : 0.025) : 0; u.uVignette.value = on ? 0.32 : 0; u.uAberration.value = on ? (this.quality === 'low' ? 0 : 0.003) : 0; u.uGrade.value = on ? 1 : 0;
  }

  // 像素比：受畫質上限、總像素上限（高 4.6 MP／中 2.6 MP／低 1.6 MP，避免大尺寸 iPad 的暫存超出 GPU 記憶體）與 context lost 降級限制
  pixelRatioFor(w, h) {
    const cap = (this.quality === 'high' ? 4.6e6 : this.quality === 'medium' ? 2.6e6 : 1.6e6) * Math.pow(0.6, this.degrade);
    const pr = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio, Math.sqrt(cap / Math.max(1, w * h)));
    return Math.max(0.5, Math.round(pr * 100) / 100);
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    const pr = this.pixelRatioFor(w, h); if (Math.abs(pr - this.renderer.getPixelRatio()) > 0.001) this.renderer.setPixelRatio(pr);
    if (this.bloom && this.degrade >= 2) this.bloom.enabled = false; // 連續兩次 context lost：關閉 Bloom
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.width = w; this.height = h;
    if (this.cine) this.cine.material.uniforms.uRes.value.set(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio());
  }

  // ------------------------------------------------------------- 天空（Tycho 星圖 + HYG 星點）
  _initSky() {
    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SH.SKY_VERT, fragmentShader: SH.SKY_FRAG + '',
      uniforms: { uSky: { value: null }, uIntensity: { value: 0.0 }, uInvProj: { value: new THREE.Matrix4() }, uInvView: { value: new THREE.Matrix4() } },
      depthTest: false, depthWrite: false,
    });
    this.skyMesh = new THREE.Mesh(quad, this.skyMat);
    this.skyMesh.frustumCulled = false; this.skyMesh.renderOrder = -10;
    this.scene.add(this.skyMesh);

    // 黑洞全螢幕著色器（同一個三角形，需要時切換）
    this.bhMat = new THREE.ShaderMaterial({
      vertexShader: SH.SKY_VERT, fragmentShader: SH.BH_FRAG,
      uniforms: {
        uCamPos: { value: new V3(0, 0, 30) }, uSky: { value: null }, uSkyIntensity: { value: 1.0 },
        uDiskInner: { value: 3.0 }, uDiskOuter: { value: 14.0 }, uTime: { value: 0 }, uSteps: { value: this.quality === 'high' ? 900 : this.quality === 'medium' ? 600 : 380 },
        uDiskOn: { value: 1 }, uDiskNormal: { value: new V3(0, 1, 0) },
        uInvProj: { value: new THREE.Matrix4() }, uInvView: { value: new THREE.Matrix4() },
      }, depthTest: false, depthWrite: false,
    });
    this.bhMesh = new THREE.Mesh(quad, this.bhMat);
    this.bhMesh.frustumCulled = false; this.bhMesh.renderOrder = -9; this.bhMesh.visible = false;
    this.scene.add(this.bhMesh);
  }

  setSkyTexture(tex) {
    tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.anisotropy = this.maxAniso;
    this.skyMat.uniforms.uSky.value = tex; this.skyMat.uniforms.uIntensity.value = 0.55;
    this.bhMat.uniforms.uSky.value = tex;
  }

  // stars: Float32Array [x,y,z(pc), mag, ci, id] × N ；最後附加太陽
  setStars(buf) {
    const n = buf.length / 6;
    const pos = new Float32Array((n + 1) * 3), mag = new Float32Array(n + 1), ci = new Float32Array(n + 1);
    for (let i = 0; i < n; i++) {
      const x = buf[i * 6], y = buf[i * 6 + 1], z = buf[i * 6 + 2];
      const e = ASTRO.equToEcl([x, y, z]); const w = eclToWorld(e);
      pos[i * 3] = w[0] * PC_KM; pos[i * 3 + 1] = w[1] * PC_KM; pos[i * 3 + 2] = w[2] * PC_KM;
      mag[i] = buf[i * 6 + 3]; ci[i] = buf[i * 6 + 4];
    }
    // 太陽（在非太陽系 frame 時以恆星顯示）
    pos[n * 3] = 0; pos[n * 3 + 1] = 0; pos[n * 3 + 2] = 0; mag[n] = 4.83; ci[n] = 0.656;
    this.starCount = n; this.starMagBase = mag; this.starPos = pos;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMagAttr = new THREE.BufferAttribute(mag.slice(), 1);
    g.setAttribute('aMag', this.starMagAttr);
    g.setAttribute('aCi', new THREE.BufferAttribute(ci, 1));
    g.computeBoundingSphere();
    this.starMat = new THREE.ShaderMaterial({
      vertexShader: SH.STAR_VERT, fragmentShader: SH.STAR_FRAG,
      uniforms: { uPixelRatio: { value: this.renderer.getPixelRatio() }, uExposure: { value: 1.0 }, uSizeScale: { value: 1.0 } },
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.frustumCulled = false; this.stars.renderOrder = -8;
    this.scene.add(this.stars);
    // 行星等近距天體在遠處的點光
    const bpos = new Float32Array(BODIES.length * 3), bmag = new Float32Array(BODIES.length), bci = new Float32Array(BODIES.length);
    const bg = new THREE.BufferGeometry();
    this.bodyPointPos = new THREE.BufferAttribute(bpos, 3); this.bodyPointMag = new THREE.BufferAttribute(bmag, 1);
    bg.setAttribute('position', this.bodyPointPos); bg.setAttribute('aMag', this.bodyPointMag); bg.setAttribute('aCi', new THREE.BufferAttribute(bci, 1));
    BODIES.forEach((b, i) => { bci[i] = b.key === 'sun' ? 0.65 : b.key === 'mars' ? 1.4 : b.key === 'neptune' ? 0.4 : b.key === 'uranus' ? 0.55 : 0.8; });
    this.bodyPoints = new THREE.Points(bg, this.starMat);
    this.bodyPoints.frustumCulled = false; this.bodyPoints.renderOrder = -7;
    this.scene.add(this.bodyPoints);
  }

  // ------------------------------------------------------------- 貼圖載入
  loadTextures(onProgress) {
    const manager = new THREE.LoadingManager();
    const loader = new THREE.TextureLoader(manager);
    const want = new Set();
    for (const b of BODIES) for (const k of ['day', 'night', 'brc', 'normal', 'map', 'radarMap']) if (b.textures[k]) want.add(b.textures[k]);
    want.add('assets/textures/tycho_skymap_2880.jpg');
    const total = want.size; let done = 0;
    this.textures = {};
    manager.onProgress = () => { };
    const promises = [...want].map((p) => new Promise((resolve) => {
      loader.load(p, (t) => {
        t.anisotropy = this.maxAniso; t.wrapS = THREE.RepeatWrapping;
        const linear = p.includes('brc') || p.includes('normal');
        t.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
        this.textures[p] = t; this.textureStatus[p] = 'ok'; done++; onProgress?.(done, total, p, true); resolve(t);
      }, undefined, () => { this.textureStatus[p] = 'error'; done++; onProgress?.(done, total, p, false); resolve(null); });
    }));
    return Promise.all(promises).then(() => {
      const sky = this.textures['assets/textures/tycho_skymap_2880.jpg'];
      if (sky) this.setSkyTexture(sky);
      this._buildSolarSystem();
      // 地球分塊 LOD（靜態分塊金字塔；manifest 不存在時標示「未安裝」，維持 4K）
      if (this.opts.earthLod !== false && this.bodies.get('earth')?.mesh.material.uniforms.uTile) this.earthLod = new EarthLod(this, this.opts.tilesPath || 'assets/textures/earth_tiles');
    });
  }

  // ------------------------------------------------------------- 太陽系天體建立
  _makeRingMesh(b, mesh) {
    const inner = b.rings.inner, outer = b.rings.outer;
    const tex = b.key === 'saturn' ? TX.makeSaturnRingTexture(inner, outer) : TX.makeUranusRingTexture(inner, outer);
    const g = new THREE.RingGeometry(inner, outer, 256, 1);
    const mat = new THREE.ShaderMaterial({
      vertexShader: SH.RING_VERT, fragmentShader: SH.RING_FRAG + '',
      uniforms: {
        uRingMap: { value: tex }, uInner: { value: inner }, uOuter: { value: outer }, uRp: { value: b.radius },
        uSunDir: { value: new V3(1, 0, 0) }, uCenter: { value: new V3() }, uNormal: { value: new V3(0, 1, 0) }, uSunIntensity: { value: 1 }, uFaint: { value: b.rings.faint ? 1 : 0 },
      }, transparent: true, side: THREE.DoubleSide, depthWrite: false,
    });
    const ring = new THREE.Mesh(g, mat);
    ring.rotation.x = -Math.PI / 2; // RingGeometry 在 xy 平面 → 轉到本體赤道面（本體 y 為極軸）
    ring.renderOrder = 2;
    return { ring, tex };
  }

  _buildSolarSystem() {
    for (const b of BODIES) {
      const T = b.textures;
      let mat;
      const common = { uSunDir: { value: new V3(1, 0, 0) }, uSunIntensity: { value: 1 }, uDetail: { value: 0 }, uUOffset: { value: T.uOffset || 0 } };
      if (T.kind === 'earth') {
        mat = new THREE.ShaderMaterial({
          vertexShader: SH.PLANET_VERT, fragmentShader: SH.EARTH_FRAG,
          uniforms: { ...common, uDay: { value: this.textures[T.day] }, uNight: { value: this.textures[T.night] }, uBRC: { value: this.textures[T.brc] }, uNormal: { value: this.textures[T.normal] },
            uCloudShift: { value: 0 }, uCloudOpacity: { value: 1 }, uNightBoost: { value: 1.0 }, uNormalStrength: { value: this.quality === 'high' ? 0.22 : 0.0 }, uAtmoColor: { value: new THREE.Color(...b.atmosphere.color) }, uHasRings: { value: 0 },
            uTile: { value: null }, uHasTile: { value: 0 }, uTileOff: { value: new THREE.Vector2() }, uTileScale: { value: new THREE.Vector2(1, 1) },
            uWx: { value: null }, uWxBox: { value: new THREE.Vector4(0, 0, 1, 1) }, uWxOn: { value: 0 }, uDebugFlat: { value: 0 } },
        });
        if (!this.textures[T.day]) mat = this._fallbackMat(b, common);
      } else if (T.kind === 'sun') {
        mat = new THREE.ShaderMaterial({ vertexShader: SH.SUN_VERT, fragmentShader: SH.SUN_FRAG, uniforms: { uTime: { value: 0 }, uIntensity: { value: 1.3 } } });
      } else {
        let map = T.map ? this.textures[T.map] : null;
        if (T.kind === 'venus') map = TX.makeVenusCloudTexture();
        else if (b.key === 'mercury') map = TX.makeMercuryTexture();
        else if (b.key === 'uranus') map = TX.makeUranusTexture();
        if (map) map.anisotropy = this.maxAniso;
        mat = new THREE.ShaderMaterial({
          vertexShader: SH.PLANET_VERT, fragmentShader: SH.PLANET_FRAG,
          uniforms: { ...common, uMap: { value: map }, uHasMap: { value: map ? 1 : 0 }, uColor: { value: new THREE.Color(...(T.color || [0.5, 0.5, 0.5])) },
            uLimb: { value: T.kind === 'gas' ? 0.75 : T.kind === 'venus' ? 0.6 : 0.25 },
            uAtmoColor: { value: new THREE.Color(...(b.atmosphere?.color || [1, 1, 1])) }, uAtmoStrength: { value: b.atmosphere ? b.atmosphere.density : 0 },
            uHasRings: { value: b.rings ? 1 : 0 }, uRingMap: { value: null }, uRingInner: { value: b.rings?.inner || 0 }, uRingOuter: { value: b.rings?.outer || 0 },
            uRingNormal: { value: new V3(0, 1, 0) }, uBodyCenter: { value: new V3() } },
        });
        if (T.kind === 'venus') { this.venusCloudMap = map; this.venusRadarMap = this.textures[T.radarMap] || null; }
      }
      const mesh = new THREE.Mesh(this.unitSphere, mat);
      mesh.scale.set(b.radius, b.radius * (1 - (b.flattening || 0)), b.radius);
      mesh.frustumCulled = false;
      const group = new THREE.Group();
      group.add(mesh);
      const entry = { def: b, mesh, group, pos: [0, 0, 0], axes: null, visible: true };
      if (b.rings) {
        const { ring, tex } = this._makeRingMesh(b, mesh);
        group.add(ring); entry.ring = ring;
        if (mat.uniforms.uRingMap) mat.uniforms.uRingMap.value = tex;
      }
      if (b.atmosphere && b.key !== 'mars') {
        const Ra = b.radius + b.atmosphere.height * 1.6;
        const amat = new THREE.ShaderMaterial({
          vertexShader: SH.ATMO_VERT, fragmentShader: SH.ATMO_FRAG,
          uniforms: { uCenter: { value: new V3() }, uRp: { value: b.radius }, uRa: { value: Ra }, uSunDir: { value: new V3(1, 0, 0) }, uColor: { value: new THREE.Color(...b.atmosphere.color) }, uDensity: { value: b.atmosphere.density }, uSunIntensity: { value: 1 } },
          transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
        });
        const atmo = new THREE.Mesh(this.unitSphere, amat);
        atmo.scale.setScalar(Ra); atmo.frustumCulled = false; atmo.renderOrder = 3;
        group.add(atmo); entry.atmo = atmo;
      }
      if (b.key === 'sun') {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xfff1d0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
        sprite.renderOrder = 4; group.add(sprite); entry.glow = sprite;
      }
      this.scene.add(group);
      this.bodies.set(b.key, entry);
    }
    // 地球標記（ISS 等）
    const mk = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0x66ffcc, transparent: true, depthTest: false, depthWrite: false }));
    mk.visible = false; mk.renderOrder = 6; this.scene.add(mk); this.markerSprite = mk;
    this.solarGroupsVisible = true;
  }

  _fallbackMat(b, common) {
    return new THREE.ShaderMaterial({ vertexShader: SH.PLANET_VERT, fragmentShader: SH.PLANET_FRAG, uniforms: { ...common, uMap: { value: null }, uHasMap: { value: 0 }, uColor: { value: new THREE.Color(0.2, 0.3, 0.5) }, uLimb: { value: 0.3 }, uAtmoColor: { value: new THREE.Color(0.5, 0.7, 1) }, uAtmoStrength: { value: 1 }, uHasRings: { value: 0 }, uRingMap: { value: null }, uRingInner: { value: 0 }, uRingOuter: { value: 0 }, uRingNormal: { value: new V3(0, 1, 0) }, uBodyCenter: { value: new V3() } } });
  }

  setVenusRadar(on) {
    this.venusRadar = on;
    const e = this.bodies.get('venus'); if (!e) return;
    const u = e.mesh.material.uniforms;
    u.uMap.value = on && this.venusRadarMap ? this.venusRadarMap : this.venusCloudMap;
    u.uLimb.value = on ? 0.25 : 0.6;
    if (e.atmo) e.atmo.visible = !on;
  }

  // ------------------------------------------------------------- 位置計算（太陽系，黃道 J2000 → 世界）
  computeSolarPositions(jd) {
    const out = {};
    out.sun = [0, 0, 0];
    const earth = ASTRO.earthHeliocentric(jd);
    out.earth = eclToWorld(earth);
    const moon = ASTRO.moonGeocentric(jd);
    out.moon = eclToWorld([earth[0] + moon[0], earth[1] + moon[1], earth[2] + moon[2]]);
    for (const k of ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto']) out[k] = eclToWorld(ASTRO.keplerPosition(k, jd));
    return out;
  }

  // 世界座標中某 frame 天體的位置（km）→ 給 UI 顯示用
  getBodyPosition(key) { const e = this.bodies.get(key); return e ? e.pos : null; }
  getBodyRadius(key) { return BODY_BY_KEY[key]?.radius || 0; }

  // ------------------------------------------------------------- frame 切換
  // frame: { type: 'solar' } | { type:'star', star } | { type:'exo', system } | { type:'dso', dso } | { type:'bh', bh }
  setFrame(frame) {
    this.frame = frame;
    this._clearExtras();
    const solar = frame.type === 'solar';
    for (const e of this.bodies.values()) e.group.visible = solar;
    this.bodyPoints.visible = solar;
    this.bhMesh.visible = frame.type === 'bh';
    this.skyMesh.visible = frame.type !== 'bh';
    if (this.stars) this.stars.visible = frame.type !== 'bh'; // 黑洞 frame 的星空由黑洞著色器（含透鏡偏折）繪製
    // 恆星點：太陽在太陽系 frame 隱藏（mesh 代替）
    const magArr = this.starMagAttr.array;
    magArr[this.starCount] = solar ? 99 : 4.83;
    this.starMagAttr.needsUpdate = true;
    // frame 原點（pc，赤道座標→世界）
    this.frameOriginKm = [0, 0, 0];
    if (frame.type !== 'solar') {
      const o = frame.originPc; // 世界座標 pc
      this.frameOriginKm = [o[0] * PC_KM, o[1] * PC_KM, o[2] * PC_KM];
    }
    // 渲染比例：深空天體尺寸極大（10^13–10^18 km），把它縮到數千單位內
    this.renderScale = 1;
    if (frame.type === 'dso') { const d = frame.dso; const sizeKm = Math.max(1e9, (d.maj || 5) / 60 * Math.PI / 180 * frame.distKm); this.renderScale = Math.max(1, sizeKm / 2000); }
    if (frame.type === 'star' || frame.type === 'exo') this._buildStarSystem(frame);
    else if (frame.type === 'dso') this._buildDso(frame);
    else if (frame.type === 'bh') this._buildBlackHole(frame);
  }

  _clearExtras() {
    if (this.extras) { for (const o of this.extras) { this.scene.remove(o); o.traverse?.((c) => { c.geometry?.dispose?.(); if (c.material && c.material.dispose && c.material !== this.starMat) c.material.dispose(); }); } }
    this.extras = []; this.extraBodies = [];
    this.labelTargets = [];
  }

  // 恆星半徑估計（R☉）：由光度與色溫，L = 4πR²σT⁴
  static estimateStarRadius(lum, T) { if (!lum || !T) return 1; return Math.sqrt(lum) * Math.pow(5772 / T, 2); }

  _makeStarMesh(radiusKm, T, intensity = 1.3) {
    const col = bbColor(T);
    const mat = new THREE.ShaderMaterial({ vertexShader: SH.SUN_VERT, fragmentShader: SH.SUN_FRAG.replace('vec3 base = vec3(1.0, 0.86, 0.62);', 'vec3 base = uBase;').replace('uniform float uTime;', 'uniform float uTime; uniform vec3 uBase;'), uniforms: { uTime: { value: 0 }, uIntensity: { value: intensity }, uBase: { value: col } } });
    const m = new THREE.Mesh(this.unitSphere, mat); m.scale.setScalar(radiusKm / this.renderScale); m.frustumCulled = false;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    sprite.renderOrder = 4;
    const g = new THREE.Group(); g.add(m); g.add(sprite);
    return { group: g, mesh: m, glow: sprite, mat };
  }

  _buildStarSystem(frame) {
    const s = frame.star; // { T, lum, radiusRsun, name, planets:[...] }
    const Rkm = (s.radiusRsun || Engine.estimateStarRadius(s.lum, s.T) || 1) * R_SUN_KM;
    const star = this._makeStarMesh(Rkm, s.T || 5772);
    this.scene.add(star.group); this.extras.push(star.group);
    this.extraBodies.push({ key: 'host', zh: s.zh || s.name, pos: [0, 0, 0], radius: Rkm, minAltitude: Rkm * 0.25, group: star.group, mesh: star.mesh, glow: star.glow, isStar: true, lum: s.lum || 1 });
    const planets = frame.system?.planets || [];
    planets.forEach((p, i) => {
      // 半徑：有觀測半徑用觀測值；否則由質量估計（Chen & Kipping 2017 冪律，標為推測）
      let Rp = p.rj ? p.rj * R_JUP_KM : null; let rSrc = p.rj ? 'observed' : 'estimated';
      if (!Rp) {
        const me = (p.mj || 0.003) * 317.8;
        const re = me < 2 ? Math.pow(me, 0.28) : me < 130 ? Math.pow(2, 0.28) * Math.pow(me / 2, 0.59) : 11.2 * Math.pow(me / 130, -0.04);
        Rp = Math.max(0.3, re) * R_EARTH_KM;
      }
      const T = p.T || (p.a && s.lum ? 278 * Math.pow(s.lum, 0.25) / Math.sqrt(p.a) : 300);
      let kind = 'rocky';
      const mj = p.mj || (p.rj ? Math.pow(p.rj, 2) : 0.003);
      if (Rp > 0.5 * R_JUP_KM) kind = T > 1000 ? 'hot-jupiter' : 'gas-giant';
      else if (Rp > 2.2 * R_EARTH_KM) kind = 'ice-giant';
      else if (T > 1200) kind = 'lava';
      else if (T < 180) kind = 'ice';
      const seed = [...p.n].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
      const map = TX.makeExoplanetTexture(kind, seed);
      const mat = new THREE.ShaderMaterial({ vertexShader: SH.PLANET_VERT, fragmentShader: SH.PLANET_FRAG, uniforms: { uSunDir: { value: new V3(1, 0, 0) }, uSunIntensity: { value: 1 }, uDetail: { value: 0 }, uUOffset: { value: 0 }, uMap: { value: map }, uHasMap: { value: 1 }, uColor: { value: new THREE.Color(0.5, 0.5, 0.5) }, uLimb: { value: kind.includes('giant') || kind === 'hot-jupiter' ? 0.7 : 0.3 }, uAtmoColor: { value: new THREE.Color(0.7, 0.8, 1) }, uAtmoStrength: { value: kind === 'rocky' || kind === 'ice' ? 0.15 : 0.4 }, uHasRings: { value: 0 }, uRingMap: { value: null }, uRingInner: { value: 0 }, uRingOuter: { value: 0 }, uRingNormal: { value: new V3(0, 1, 0) }, uBodyCenter: { value: new V3() } } });
      const mesh = new THREE.Mesh(this.unitSphere, mat); mesh.scale.setScalar(Rp / this.renderScale); mesh.frustumCulled = false;
      const group = new THREE.Group(); group.add(mesh); this.scene.add(group); this.extras.push(group);
      // 軌道：a 已知用 a；否則由週期與主星質量推（克卜勒第三定律）
      let aKm = p.a ? p.a * AU_KM : null;
      if (!aKm && p.p && s.mass) aKm = Math.cbrt(G_SI * s.mass * M_SUN_KG * Math.pow(p.p * 86400, 2) / (4 * Math.PI * Math.PI)) / 1000;
      if (!aKm) aKm = (i + 1) * 0.1 * AU_KM;
      const period = p.p ? p.p * 86400 : 2 * Math.PI * Math.sqrt(Math.pow(aKm * 1000, 3) / (G_SI * (s.mass || 1) * M_SUN_KG));
      const phase0 = (seed % 1000) / 1000 * Math.PI * 2;
      const orbitRadius = aKm;
      // 軌道線
      const pts = []; for (let k = 0; k <= 180; k++) { const a = k / 180 * Math.PI * 2; pts.push(new V3(Math.cos(a) * aKm, 0, Math.sin(a) * aKm).divideScalar(this.renderScale)); }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x3a5a7a, transparent: true, opacity: 0.5 }));
      line.frustumCulled = false; this.scene.add(line); this.extras.push(line);
      this.extraBodies.push({ key: 'exo' + i, zh: p.n, pos: [0, 0, 0], radius: Rp, minAltitude: Rp * 0.02 + 20, group, mesh, orbit: { a: aKm, e: p.e || 0, period, phase0 }, line, data: p, kind, rSrc, T, rotPeriod: Math.max(period, 86400 * 0.5) });
    });
  }

  _buildDso(frame) {
    const d = frame.dso; // { t, maj(arcmin), min, pa, distKm, seed }
    const distKm = frame.distKm;
    const sizeKm = Math.max(1e9, (d.maj || 5) / 60 * Math.PI / 180 * distKm);
    const sizeMinKm = Math.max(1e9, (d.min || d.maj || 5) / 60 * Math.PI / 180 * distKm);
    const tex = TX.makeDsoSprite(d.t, frame.seed || 1);
    const geom = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.scale.set(sizeKm / this.renderScale, sizeMinKm / this.renderScale, 1);
    // 讓盤面朝向太陽系方向（從地球看到的投影），再依方位角旋轉
    const toSun = toV3(this.frameOriginKm).multiplyScalar(-1).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), toSun);
    mesh.quaternion.copy(q);
    mesh.rotateZ((d.pa || 0) * Math.PI / 180);
    mesh.frustumCulled = false;
    const group = new THREE.Group(); group.add(mesh);
    this.scene.add(group); this.extras.push(group);
    this.extraBodies.push({ key: 'dso', zh: frame.label, pos: [0, 0, 0], radius: sizeKm / 2, minAltitude: 0, group, mesh, isDso: true, noCollide: true });
  }

  _buildBlackHole(frame) {
    const bh = frame.bh; // { massMsun }
    this.rsKm = 2 * G_SI * bh.massMsun * M_SUN_KG / Math.pow(C_KM_S * 1000, 2) / 1000;
    this.bhMat.uniforms.uDiskOn.value = bh.disk === false ? 0 : 1;
    this.extraBodies.push({ key: 'bh', zh: frame.label, pos: [0, 0, 0], radius: this.rsKm, minAltitude: this.rsKm * 0.3, isBH: true });
  }

  // ------------------------------------------------------------- 每幀更新
  // dt：真實秒；回傳 nearest body 資訊供 UI 與控制使用
  update(dt) {
    this.elapsed += dt;
    if (this.timeRate !== 0) this.simTime += dt * 1000 * this.timeRate;
    const jd = ASTRO.jdFromDate(new Date(this.simTime));
    const cam = this.camPos;
    this.camera.quaternion.copy(this.camQuat);
    if (this.breath) {
      // 鏡頭呼吸：三個不可通約週期的極小擺動（約 0.05°），只作用在渲染相機
      const t = this.elapsed; const a = 0.0009;
      const bq = new THREE.Quaternion().setFromEuler(new THREE.Euler(a * Math.sin(t * 0.53) + a * 0.5 * Math.sin(t * 1.37), a * Math.sin(t * 0.41 + 1.3) + a * 0.5 * Math.sin(t * 1.11), a * 0.4 * Math.sin(t * 0.29)));
      this.camera.quaternion.multiply(bq);
    }
    this.camera.updateMatrixWorld();
    // 天空矩陣
    this.camera.updateProjectionMatrix();
    const invProj = this.camera.projectionMatrixInverse; const invView = this.camera.matrixWorld;
    this.skyMat.uniforms.uInvProj.value.copy(invProj); this.skyMat.uniforms.uInvView.value.copy(invView);
    this.bhMat.uniforms.uInvProj.value.copy(invProj); this.bhMat.uniforms.uInvView.value.copy(invView);
    // 星點：以 frame 原點為基準（視差正確）
    const rs = this.renderScale;
    this.stars.position.set((-this.frameOriginKm[0] - cam[0]) / rs, (-this.frameOriginKm[1] - cam[1]) / rs, (-this.frameOriginKm[2] - cam[2]) / rs);

    let nearest = null;
    if (this.frame.type === 'solar') nearest = this._updateSolar(jd, dt);
    else if (this.frame.type === 'bh') nearest = this._updateBH();
    else nearest = this._updateExtras(dt);
    this._updateExposure(nearest);
    return nearest;
  }

  _updateSolar(jd, dt) {
    const P = this.computeSolarPositions(jd);
    const cam = this.camPos;
    this._applyAnchor(this.anchorKey && P[this.anchorKey]);
    let nearest = null;
    const sunRel = new V3(P.sun[0] - cam[0], P.sun[1] - cam[1], P.sun[2] - cam[2]);
    const pr = this.renderer.getPixelRatio();
    const pxPerRad = this.height / (2 * Math.tan(this.camera.fov * Math.PI / 360));
    this.labelTargets = [];
    const bp = this.bodyPointPos.array, bm = this.bodyPointMag.array;
    BODIES.forEach((b, i) => {
      const e = this.bodies.get(b.key); if (!e) return;
      const p = P[b.key]; e.pos = p;
      const rel = new V3(p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]);
      const dist = rel.length();
      e.group.position.copy(rel);
      // 自轉與極軸
      const ax = ASTRO.bodyAxes(b.rotKey, jd);
      if (ax) {
        const xb = toV3(eclToWorld(ax.xb)), yb = toV3(eclToWorld(ax.yb)), zb = toV3(eclToWorld(ax.zb));
        const m = new THREE.Matrix4().makeBasis(xb, yb, zb);
        e.mesh.quaternion.setFromRotationMatrix(m);
        e.axes = { xb, yb, zb, raw: ax };
        if (e.ring) { e.ring.quaternion.copy(e.mesh.quaternion); e.ring.rotateX(-Math.PI / 2); }
      }
      // 光照方向（指向太陽）
      const sunDir = b.key === 'sun' ? new V3(1, 0, 0) : new V3(P.sun[0] - p[0], P.sun[1] - p[1], P.sun[2] - p[2]).normalize();
      const u = e.mesh.material.uniforms;
      if (u.uSunDir) u.uSunDir.value.copy(sunDir);
      if (u.uSunIntensity) u.uSunIntensity.value = this.sunIntensity * this.bodyExposure;
      if (u.uTime) u.uTime.value = this.elapsed;
      if (u.uBodyCenter) u.uBodyCenter.value.copy(rel);
      if (u.uRingNormal && e.axes) u.uRingNormal.value.copy(e.axes.yb);
      if (u.uCloudShift) u.uCloudShift.value = (this.simTime / 1000 / 86400) * 0.0025 % 1; // 雲層相對地表緩慢漂移（示意）
      // 近距離細節：只在很近時啟用
      const angR = Math.atan2(b.radius, dist);
      if (u.uDetail) u.uDetail.value = clamp((angR - 0.6) / 1.0, 0, 1) * 0.35;
      if (e.ring) { const ru = e.ring.material.uniforms; ru.uSunDir.value.copy(sunDir); ru.uCenter.value.copy(rel); ru.uNormal.value.copy(e.axes?.yb || new V3(0, 1, 0)); ru.uSunIntensity.value = this.sunIntensity * this.bodyExposure; }
      if (e.atmo) { const au = e.atmo.material.uniforms; au.uCenter.value.copy(rel); au.uSunDir.value.copy(sunDir); au.uSunIntensity.value = this.sunIntensity * this.bodyExposure; }
      if (e.glow) {
        const s = clamp(dist * 0.0035, b.radius * 2.2, dist * 0.35);
        e.glow.scale.set(s, s, 1); e.glow.material.opacity = 0.85 * this.bodyExposure;
      }
      // 太小就改畫點光
      const px = angR * pxPerRad;
      const showMesh = px > 0.8;
      e.group.visible = showMesh;
      if (b.key === 'earth' && this.earthLod && showMesh) this.earthLod.update(e, rel, pxPerRad * pr);
      // 視星等（近似：H + 5 log10(r Δ) + 相位修正）
      let mag = 99;
      if (!showMesh) {
        if (b.key === 'sun') mag = -26.74 + 5 * Math.log10(dist / AU_KM);
        else {
          const rSun = Math.hypot(p[0], p[1], p[2]) / AU_KM; const delta = dist / AU_KM;
          const cosA = clamp(sunDir.dot(rel.clone().multiplyScalar(-1).normalize()), -1, 1); const alpha = Math.acos(cosA) * 180 / Math.PI;
          mag = b.H + 5 * Math.log10(Math.max(rSun * delta, 1e-6)) + 0.026 * alpha + 4e-9 * Math.pow(alpha, 4);
          if (b.key === 'moon') mag = 0.21 + 5 * Math.log10(Math.max(rSun * delta, 1e-6)) + 0.026 * alpha + 4e-9 * Math.pow(alpha, 4);
        }
      }
      bp[i * 3] = rel.x; bp[i * 3 + 1] = rel.y; bp[i * 3 + 2] = rel.z; bm[i] = mag;
      // 標籤
      this.labelTargets.push({ key: b.key, zh: b.zh, rel, dist, radius: b.radius });
      const bound = b.radius + b.minAltitude;
      if (!nearest || dist - bound < nearest.distToBoundary) nearest = { key: b.key, def: b, dist, distToBoundary: dist - bound, altitude: dist - b.radius, rel, radius: b.radius, bound, pos: p, axes: e.axes };
    });
    this.bodyPointPos.needsUpdate = true; this.bodyPointMag.needsUpdate = true;
    this.sunDirWorld.copy(sunRel).normalize();
    this.flare = this._computeFlare(sunRel, BODY_BY_KEY.sun.radius, [...this.bodies.values()].filter((e) => e.def.key !== 'sun').map((e) => ({ rel: e.group.position, radius: e.def.radius })));
    // 地球標記
    if (this.markerSprite) {
      const em = this.earthMarker, e = this.bodies.get('earth');
      if (em && e && e.axes) {
        const d = ASTRO.geoToWorldDir({ xb: e.axes.xb.toArray(), yb: e.axes.yb.toArray(), zb: e.axes.zb.toArray() }, em.lat, em.lon);
        const r = BODY_BY_KEY.earth.radius + (em.altKm || 0);
        this.markerSprite.position.set(e.group.position.x + d[0] * r, e.group.position.y + d[1] * r, e.group.position.z + d[2] * r);
        const md = this.markerSprite.position.length();
        this.markerSprite.scale.setScalar(md * 0.012); this.markerSprite.visible = true;
      } else this.markerSprite.visible = false;
    }
    return nearest;
  }

  // 鏡頭眩光來源：光源的螢幕位置與強度；被其他天體遮住時依「光源角半徑 vs 邊緣距離」平滑消失（日出／日落時從邊緣露出）
  _computeFlare(srcRel, srcRadius, occluders) {
    const dist = srcRel.length(); if (!(dist > 0)) return null;
    const p = this.project(srcRel); if (!p) return null;
    const dir = srcRel.clone().divideScalar(dist);
    const angR = Math.atan2(srcRadius, dist);
    let vis = 1;
    for (const o of occluders) {
      const t = o.rel.dot(dir); if (t <= 0 || t >= dist) continue;
      const perp = o.rel.clone().addScaledVector(dir, -t).length();
      const srcR = angR * t; // 光源在遮蔽者距離處的投影半徑
      vis *= clamp((perp - (o.radius - srcR)) / Math.max(2 * srcR, 1e-9), 0, 1);
      if (vis <= 0) return null;
    }
    // 螢幕外 15% 以上就不畫；視野佔比太大（極近）時減弱，避免整片眩光
    const ex = Math.max(-p.x, p.x - this.width, 0) / this.width, ey = Math.max(-p.y, p.y - this.height, 0) / this.height;
    const edge = 1 - clamp(Math.max(ex, ey) / 0.15, 0, 1); if (edge <= 0) return null;
    const size = clamp(angR / 0.004, 0.35, 1) * (1 - clamp((angR - 0.25) / 0.4, 0, 1));
    return { x: p.x, y: p.y, intensity: vis * edge * size * this.bodyExposure, angR };
  }

  _applyAnchor(pos) {
    if (!pos) { this.prevAnchorPos = null; return; }
    if (this.prevAnchorPos) { const c = this.camPos; c[0] += pos[0] - this.prevAnchorPos[0]; c[1] += pos[1] - this.prevAnchorPos[1]; c[2] += pos[2] - this.prevAnchorPos[2]; }
    this.prevAnchorPos = pos.slice();
  }

  _updateExtras(dt) {
    const cam = this.camPos; let nearest = null;
    const star = this.extraBodies.find((e) => e.isStar);
    this.labelTargets = [];
    let anchorPos = null;
    for (const e of this.extraBodies) {
      if (e.orbit) {
        const t = this.simTime / 1000;
        const M = e.orbit.phase0 + 2 * Math.PI * t / e.orbit.period;
        // 簡化：橢圓參數式（e 小時近似）
        const a = e.orbit.a, ec = e.orbit.e;
        let E = M; for (let k = 0; k < 6; k++) E = M + ec * Math.sin(E);
        const x = a * (Math.cos(E) - ec), z = a * Math.sqrt(1 - ec * ec) * Math.sin(E);
        e.pos = [x, 0, z];
        e.mesh.rotation.y = 2 * Math.PI * t / e.rotPeriod;
      }
      if (e.key === this.anchorKey) { anchorPos = e.pos; this._applyAnchor(anchorPos); }
      const rel = new V3(e.pos[0] - cam[0], e.pos[1] - cam[1], e.pos[2] - cam[2]);
      const dist = rel.length();
      const rsc = this.renderScale;
      if (e.group) e.group.position.copy(rel).divideScalar(rsc);
      if (e.line) { e.line.position.set(-cam[0] / rsc, -cam[1] / rsc, -cam[2] / rsc); e.line.visible = dist > e.radius * 60; }
      if (e.mesh?.material?.uniforms) {
        const u = e.mesh.material.uniforms;
        if (u.uTime) u.uTime.value = this.elapsed;
        if (u.uSunDir) u.uSunDir.value.copy(new V3(-e.pos[0], -e.pos[1], -e.pos[2]).normalize());
        if (u.uSunIntensity) {
          // 主星光度 / 距離²，相對地球日照；過亮過暗以軟限制壓縮
          const aAU = Math.max(Math.hypot(...e.pos) / AU_KM, 1e-4);
          const I = (star?.lum || 1) / (aAU * aAU);
          u.uSunIntensity.value = clamp(Math.pow(I, 0.35), 0.25, 2.2) * this.bodyExposure;
        }
        if (u.uBodyCenter) u.uBodyCenter.value.copy(rel).divideScalar(rsc);
      }
      if (e.glow) { const s = clamp(dist * 0.0035, e.radius * 2.2, dist * 0.35) / rsc; e.glow.scale.set(s, s, 1); e.glow.material.opacity = 0.85 * this.bodyExposure; }
      if (e.isDso && e.mesh) { e.mesh.material.opacity = this.bodyExposure; }
      this.labelTargets.push({ key: e.key, zh: e.zh, rel, dist, radius: e.radius });
      if (e.noCollide) continue;
      const bound = e.radius + e.minAltitude;
      if (!nearest || dist - bound < nearest.distToBoundary) nearest = { key: e.key, def: { zh: e.zh, radius: e.radius, minAltitude: e.minAltitude, key: e.key }, dist, distToBoundary: dist - bound, altitude: dist - e.radius, rel, radius: e.radius, bound, pos: e.pos, extra: e };
    }
    this.flare = star ? this._computeFlare(new V3(-cam[0], -cam[1], -cam[2]), star.radius, this.extraBodies.filter((e) => e.mesh && !e.isStar && !e.isDso).map((e) => ({ rel: e.group.position.clone().multiplyScalar(this.renderScale), radius: e.radius }))) : null;
    return nearest;
  }

  _updateBH() {
    const cam = this.camPos; const rs = this.rsKm;
    const dist = Math.hypot(cam[0], cam[1], cam[2]);
    this.bhMat.uniforms.uCamPos.value.set(cam[0] / rs, cam[1] / rs, cam[2] / rs);
    this.bhMat.uniforms.uTime.value = this.elapsed;
    this.bhMat.uniforms.uSkyIntensity.value = 1.2 * this.starExposure;
    this.labelTargets = []; this.flare = null;
    const e = this.extraBodies[0];
    const bound = rs * 1.3;
    return { key: 'bh', def: { zh: e.zh, radius: rs, minAltitude: bound - rs, key: 'bh' }, dist, distToBoundary: dist - bound, altitude: dist - rs, rel: new V3(-cam[0], -cam[1], -cam[2]), radius: rs, bound, pos: [0, 0, 0], extra: e };
  }

  _updateExposure(nearest) {
    // 自動曝光：鄰近受光天體佔視野比例越大，星空越暗（相機對亮天體曝光）
    let coverage = 0;
    if (nearest && nearest.key !== 'bh') {
      const angR = Math.atan2(nearest.radius, Math.max(nearest.dist, nearest.radius * 1.0001));
      const half = this.camera.fov * Math.PI / 360;
      coverage = clamp(Math.pow(angR / half, 1.4), 0, 1);
      if (this.frame.type === 'solar' && nearest.key !== 'sun') {
        // 相位：背光面不會壓暗星空
        const sunDir = new V3(-nearest.pos[0], -nearest.pos[1], -nearest.pos[2]).normalize();
        const toCam = nearest.rel.clone().multiplyScalar(-1).normalize();
        const phase = clamp((sunDir.dot(toCam) + 1) / 2, 0, 1);
        coverage *= 0.15 + 0.85 * phase;
      }
      if (nearest.extra?.isDso) coverage *= 0.25;
    }
    let star = 1, body = 1;
    if (this.exposureMode === 'auto') { star = lerp(1.0, 0.05, Math.sqrt(coverage)); body = 1; }
    else if (this.exposureMode === 'stars') { star = 1.6; body = 0.55; }
    else { star = 0.08; body = 1.0; }
    this.starExposure = lerp(this.starExposure, star, 0.08);
    this.bodyExposure = lerp(this.bodyExposure, body, 0.08);
    this.starMat.uniforms.uExposure.value = this.starExposure;
    this.skyMat.uniforms.uIntensity.value = 0.55 * this.starExposure;
    this.coverage = coverage;
    // 依鄰近天體視角大小微調光暈（遠離時 0.75、貼近受光天體時 0.45，避免行星邊緣過度泛光）；不改變天文資料及光照來源。
    if (this.bloom) {
      const target = 0.75 - 0.3 * Math.sqrt(coverage);
      this.bloom.strength = lerp(this.bloom.strength, target, 0.045);
    }
  }

  render() {
    this.cine.material.uniforms.uTime.value = this.elapsed;
    this.renderer.info.autoReset = false; this.renderer.info.reset(); // 讓 info 統計整個 composer 幀（多個 pass），供診斷模式讀取
    if (this.postOn) this.composer.render();
    else { this.renderer.setRenderTarget(null); this.renderer.render(this.scene, this.camera); }
  }
  setPost(on) { this.postOn = !!on; }

  // 診斷：把場景（不含後處理）畫到浮點暫存並讀回，統計非有限值（NaN／Inf）像素與平均亮度。
  // NaN 進入 Bloom 的降採樣鏈會把大片畫面染黑並逐幀變化（黑屏閃爍）；此掃描用來定位來源。
  scanNonFinite(scale = 0.5) {
    const pr = this.renderer.getPixelRatio();
    const w = Math.max(8, Math.floor(this.width * pr * scale)), h = Math.max(8, Math.floor(this.height * pr * scale));
    if (!this._scanRT) this._scanRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, depthBuffer: true, stencilBuffer: false });
    else if (this._scanRT.width !== w || this._scanRT.height !== h) this._scanRT.setSize(w, h);
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this._scanRT); this.renderer.render(this.scene, this.camera);
    const buf = new Float32Array(w * h * 4);
    this.renderer.readRenderTargetPixels(this._scanRT, 0, 0, w, h, buf);
    this.renderer.setRenderTarget(prev);
    let bad = 0, sum = 0, maxV = 0, first = null;
    for (let i = 0; i < w * h; i++) {
      const r = buf[i * 4], g = buf[i * 4 + 1], b = buf[i * 4 + 2];
      if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) { bad++; if (!first) first = { x: i % w, y: h - 1 - Math.floor(i / w) }; continue; }
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b; sum += l; if (l > maxV) maxV = l;
    }
    return { w, h, bad, first, meanLuma: sum / (w * h), maxLuma: maxV };
  }

  // 診斷：地球球面覆蓋自檢。把地球（本體＋分塊補丁）畫成純白、隱藏大氣，讀回畫面統計白色像素；
  // 分別量「目前 LOD 層」與「強制 L0 本體」兩種，回傳比值：補丁若有缺塊或剔除錯誤，ratio 會明顯 < 1（純幾何量測，不受日夜相位影響）。
  coverageSelfTest(scale = 0.35) {
    const e = this.bodies.get('earth'); if (!e) return null;
    const lod = this.earthLod; const mats = [e.mesh.material]; if (lod) for (const arr of lod.patches.values()) for (const p of arr) mats.push(p.material);
    const setFlat = (v) => { for (const m of mats) if (m.uniforms?.uDebugFlat) m.uniforms.uDebugFlat.value = v; };
    const atmoVis = e.atmo ? e.atmo.visible : null; if (e.atmo) e.atmo.visible = false;
    const starsVis = this.stars ? this.stars.visible : null; if (this.stars) this.stars.visible = false;
    const skyI = this.skyMat.uniforms.uIntensity.value; this.skyMat.uniforms.uIntensity.value = 0;
    const count = () => { const s = this.scanNonFinite(scale); return s; };
    const white = (scale2) => {
      const pr = this.renderer.getPixelRatio(); const w = Math.max(8, Math.floor(this.width * pr * scale2)), h = Math.max(8, Math.floor(this.height * pr * scale2));
      this.renderer.setRenderTarget(this._scanRT); this.renderer.render(this.scene, this.camera);
      const buf = new Float32Array(w * h * 4); this.renderer.readRenderTargetPixels(this._scanRT, 0, 0, w, h, buf); this.renderer.setRenderTarget(null);
      // 白色像素數＋「洞」偵測：球面投影（含被視窗裁切）是凸形，每一列白像素應為單一連續段；列內首尾白像素之間的黑像素即為缺塊／缺面
      let n = 0, holes = 0;
      for (let y = 0; y < h; y++) {
        let first = -1, last = -1;
        for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (buf[i] > 0.5 && buf[i + 1] > 0.5) { n++; if (first < 0) first = x; last = x; } }
        if (first >= 0) for (let x = first; x <= last; x++) { const i = (y * w + x) * 4; if (!(buf[i] > 0.5 && buf[i + 1] > 0.5)) holes++; }
      }
      lastHoles = holes; return n;
    };
    let lastHoles = 0;
    let result = null;
    try {
      setFlat(1); count(); // 確保 _scanRT 尺寸正確
      const level = lod ? lod.level : 0;
      const withLod = white(scale); const lodHoles = lastHoles;
      let base = withLod;
      if (lod && level > 0) { for (const arr of lod.patches.values()) for (const p of arr) p.visible = false; e.mesh.material.visible = true; base = white(scale); for (const [lv, arr] of lod.patches) for (const p of arr) p.visible = lv === level; e.mesh.material.visible = level === 0; }
      result = { level, lodPixels: withLod, basePixels: base, ratio: base ? withLod / base : 1, holes: lodHoles, holeFraction: withLod ? lodHoles / withLod : 0, altitudeKm: Math.round(e.group.position.length() - e.def.radius) };
    } finally {
      setFlat(0); if (e.atmo) e.atmo.visible = atmoVis; if (this.stars) this.stars.visible = starsVis; this.skyMat.uniforms.uIntensity.value = skyI;
    }
    return result;
  }

  // 投影到螢幕（給 HTML 標籤）
  project(rel) {
    const v = rel.clone().normalize().multiplyScalar(1e6).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    // 檢查是否在相機前方
    const fwd = new V3(0, 0, -1).applyQuaternion(this.camQuat);
    if (fwd.dot(rel) <= 0) return null;
    return { x: (v.x + 1) / 2 * this.width, y: (1 - v.y) / 2 * this.height };
  }
}
