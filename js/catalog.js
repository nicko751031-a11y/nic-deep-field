// 天文目錄：載入資料、搜尋、產生目的地（frame + 相機位置）
import * as THREE from 'three';
import { AU_KM, PC_KM, LY_KM, R_SUN_KM, R_JUP_KM, R_EARTH_KM, fmtDist, fmtNum } from './units.js';
import * as ASTRO from './astro.js';
import { BODIES, BODY_BY_KEY } from './bodies.js';
import { eclToWorld, bvToTemp, Engine } from './engine.js';

const V3 = THREE.Vector3;

// 黑洞（手動整理；質量與距離為文獻值）
export const BLACK_HOLES = [
  { id: 'sgra', zh: '人馬座 A*（銀河系中心黑洞）', en: 'Sagittarius A*', alias: ['Sgr A*', 'SgrA*', 'Sgr A', '人馬座A*', '銀河系中心'], massMsun: 4.297e6, distPc: 8178, ra: 266.41683, dec: -29.00781, kind: '超大質量黑洞',
    src: '質量／距離：GRAVITY Collaboration 2019；影像：EHT 2022（事件視界望遠鏡首張 Sgr A* 影像）', disk: true, note: 'EHT 影像顯示環狀亮度結構；此處吸積盤為示意，亮度與結構並非 EHT 資料。' },
  { id: 'm87', zh: 'M87*（室女座 A 中心黑洞）', en: 'M87*', alias: ['M87 black hole', 'Virgo A black hole', '室女座A黑洞'], massMsun: 6.5e9, distPc: 16.8e6, ra: 187.70593, dec: 12.39112, kind: '超大質量黑洞',
    src: 'EHT Collaboration 2019（首張黑洞影像）', disk: true, note: '2019 年 EHT 影像中的亮環直徑約 42 微角秒；此處為物理近似渲染，非該影像。' },
  { id: 'cygx1', zh: '天鵝座 X-1', en: 'Cygnus X-1', alias: ['Cyg X-1', '天鵝座X1'], massMsun: 21.2, distPc: 2220, ra: 299.59032, dec: 35.20161, kind: '恆星質量黑洞（X 射線雙星）',
    src: 'Miller-Jones et al. 2021', disk: true, note: '真實系統有來自藍超巨星伴星的吸積盤；伴星未繪製。' },
  { id: 'gaiabh1', zh: 'Gaia BH1', en: 'Gaia BH1', massMsun: 9.62, distPc: 480, ra: 262.17120, dec: -0.58109, kind: '恆星質量黑洞（寧靜雙星，最近的已知黑洞）',
    src: 'El-Badry et al. 2023', disk: false, note: '此黑洞沒有偵測到吸積盤（寧靜），因此此處只顯示重力透鏡效果；伴星（類太陽恆星）未繪製。' },
  { id: 'v404', zh: 'V404 天鵝座', en: 'V404 Cygni', massMsun: 9.0, distPc: 2390, ra: 306.01596, dec: 33.86742, kind: '恆星質量黑洞（X 射線新星）',
    src: 'Miller-Jones et al. 2009（視差距離）', disk: true, note: '吸積盤為示意。' },
  { id: 'grs1915', zh: 'GRS 1915+105', en: 'GRS 1915+105', massMsun: 12.4, distPc: 8600, ra: 288.79815, dec: 10.94576, kind: '恆星質量黑洞（微類星體）',
    src: 'Reid et al. 2014', disk: true, note: '吸積盤為示意。' },
  { id: 'm31', zh: 'M31*（仙女座星系中心黑洞）', en: 'M31*', massMsun: 1.4e8, distPc: 765e3, ra: 10.68471, dec: 41.26875, kind: '超大質量黑洞',
    src: 'Bender et al. 2005', disk: true, note: '吸積極微弱；吸積盤為示意。' },
  { id: 'ton618', zh: 'TON 618', en: 'TON 618', alias: ['TON618'], massMsun: 4.07e10, distPc: 3.18e9, ra: 190.98983, dec: 31.42658, kind: '超大質量黑洞（類星體）',
    src: '質量：Shemmer et al. 2004（估計值，不確定度大）；紅移 z=2.219，光行距離約 104 億光年', disk: true, note: '距離以光行距離表示；真實類星體的吸積盤亮度極高，此處為示意。' },
];

const GREEK = { alp: 'α', bet: 'β', gam: 'γ', del: 'δ', eps: 'ε', zet: 'ζ', eta: 'η', the: 'θ', iot: 'ι', kap: 'κ', lam: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omi: 'ο', pi: 'π', rho: 'ρ', sig: 'σ', tau: 'τ', ups: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', ome: 'ω' };
const GREEK_FULL = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω' };
const CON_ZH = { And: '仙女座', Ant: '唧筒座', Aps: '天燕座', Aqr: '寶瓶座', Aql: '天鷹座', Ara: '天壇座', Ari: '白羊座', Aur: '御夫座', Boo: '牧夫座', Cae: '雕具座', Cam: '鹿豹座', Cnc: '巨蟹座', CVn: '獵犬座', CMa: '大犬座', CMi: '小犬座', Cap: '摩羯座', Car: '船底座', Cas: '仙后座', Cen: '半人馬座', Cep: '仙王座', Cet: '鯨魚座', Cha: '蝘蜓座', Cir: '圓規座', Col: '天鴿座', Com: '后髮座', CrA: '南冕座', CrB: '北冕座', Crv: '烏鴉座', Crt: '巨爵座', Cru: '南十字座', Cyg: '天鵝座', Del: '海豚座', Dor: '劍魚座', Dra: '天龍座', Equ: '小馬座', Eri: '波江座', For: '天爐座', Gem: '雙子座', Gru: '天鶴座', Her: '武仙座', Hor: '時鐘座', Hya: '長蛇座', Hyi: '水蛇座', Ind: '印第安座', Lac: '蝎虎座', Leo: '獅子座', LMi: '小獅座', Lep: '天兔座', Lib: '天秤座', Lup: '豺狼座', Lyn: '天貓座', Lyr: '天琴座', Men: '山案座', Mic: '顯微鏡座', Mon: '麒麟座', Mus: '蒼蠅座', Nor: '矩尺座', Oct: '南極座', Oph: '蛇夫座', Ori: '獵戶座', Pav: '孔雀座', Peg: '飛馬座', Per: '英仙座', Phe: '鳳凰座', Pic: '繪架座', Psc: '雙魚座', PsA: '南魚座', Pup: '船尾座', Pyx: '羅盤座', Ret: '網罟座', Sge: '天箭座', Sgr: '人馬座', Sco: '天蠍座', Scl: '玉夫座', Sct: '盾牌座', Ser: '巨蛇座', Sex: '六分儀座', Tau: '金牛座', Tel: '望遠鏡座', Tri: '三角座', TrA: '南三角座', Tuc: '杜鵑座', UMa: '大熊座', UMi: '小熊座', Vel: '船帆座', Vir: '室女座', Vol: '飛魚座', Vul: '狐狸座' };
const TYPE_ZH = { G: '星系', GPair: '星系對', GTrpl: '三重星系', GGroup: '星系群', OCl: '疏散星團', GCl: '球狀星團', 'Cl+N': '星團＋星雲', PN: '行星狀星雲', Neb: '星雲', HII: '電離氫區', RfN: '反射星雲', EmN: '發射星雲', DrkN: '暗星雲', SNR: '超新星殘骸', '*': '恆星', '**': '雙星', '*Ass': '星協', Nova: '新星', Other: '其他' };

function norm(s) { return s.toLowerCase().replace(/[\s\-_’'·]/g, '').replace(/^messier/, 'm'); }

export class Catalog {
  constructor() { this.entries = []; this.meta = null; this.ready = false; }

  async load(onProgress) {
    const files = ['data/meta.json', 'data/stars_index.json', 'data/dso.json', 'data/exoplanets.json', 'data/stars.json'];
    let done = 0; const results = {};
    for (const f of files) {
      try {
        const r = await fetch(f); if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
        results[f] = await r.json();
      } catch (e) { results[f] = null; this.loadErrors = this.loadErrors || []; this.loadErrors.push(String(e.message || e)); }
      done++; onProgress?.(done, files.length, f);
    }
    this.meta = results['data/meta.json'];
    this.starsBin = results['data/stars.json'] ? new Float32Array(results['data/stars.json']) : null;
    this.starIndex = results['data/stars_index.json'] || [];
    this.dso = results['data/dso.json'] || [];
    this.exo = results['data/exoplanets.json'] || [];
    this._buildIndex();
    this.ready = true;
  }

  _buildIndex() {
    const E = this.entries;
    for (const b of BODIES) E.push({ kind: 'body', id: b.key, zh: b.zh, en: b.en, sub: b.classZh, keys: [b.zh, b.en, b.key], data: b, rank: 0 });
    for (const bh of BLACK_HOLES) E.push({ kind: 'bh', id: bh.id, zh: bh.zh, en: bh.en, sub: bh.kind, keys: [bh.zh, bh.en, ...(bh.alias || []), '黑洞', 'black hole'], data: bh, rank: 1 });
    for (const s of this.starIndex) {
      const keys = [];
      if (s.n) keys.push(s.n); if (s.zh) keys.push(s.zh);
      if (s.b) { keys.push(s.b); const [g, c] = s.b.split(' '); const gl = GREEK[g.toLowerCase().replace(/[0-9]/g, '')]; if (gl && c) { keys.push(`${gl} ${c}`, `${gl}${c}`); const full = Object.entries(GREEK_FULL).find(([, v]) => v === gl); if (full) keys.push(`${full[0]} ${c}`); } }
      if (s.hip) keys.push(`HIP ${s.hip}`); if (s.hd) keys.push(`HD ${s.hd}`); if (s.hr) keys.push(`HR ${s.hr}`); if (s.gl) keys.push(s.gl);
      const name = s.zh ? `${s.zh}（${s.n}）` : s.n || s.b || (s.hip ? `HIP ${s.hip}` : `HD ${s.hd}`);
      E.push({ kind: 'star', id: `star:${s.id}`, zh: name, en: s.n || s.b || '', sub: `恆星 ${s.sp || ''} ${s.con ? CON_ZH[s.con] || s.con : ''}`.trim(), keys, data: s, rank: s.n ? 2 : 4 });
    }
    for (const d of this.dso) {
      const keys = [d.id, d.id.replace(/^(NGC|IC)0*/, '$1 '), d.id.replace(/^(NGC|IC)0*/, '$1')];
      if (d.m) keys.push(`M${d.m}`, `M ${d.m}`, `Messier ${d.m}`);
      if (d.ngc) keys.push(`NGC ${d.ngc}`); if (d.ic) keys.push(`IC ${d.ic}`);
      if (d.n) keys.push(...d.n); if (d.zh) keys.push(d.zh); if (d.alt) keys.push(...d.alt);
      const label = d.zh ? `${d.zh}（${d.m ? 'M' + d.m + '，' : ''}${d.id.replace(/^(NGC|IC)0*/, '$1 ')}）` : d.m ? `M${d.m}（${d.id.replace(/^(NGC|IC)0*/, '$1 ')}）${d.n ? ' ' + d.n[0] : ''}` : `${d.id.replace(/^(NGC|IC)0*/, '$1 ')}${d.n ? '（' + d.n[0] + '）' : ''}`;
      E.push({ kind: 'dso', id: `dso:${d.id}`, zh: label, en: d.n ? d.n[0] : d.id, sub: `${TYPE_ZH[d.t] || d.t} ${d.con ? CON_ZH[d.con] || d.con : ''}`.trim(), keys, data: d, rank: d.m ? 2 : d.n ? 3 : 5 });
    }
    // 系外行星依主星分組
    this.exoSystems = new Map();
    for (const p of this.exo) {
      const host = p.n.replace(/\s+[a-z]$/i, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (!this.exoSystems.has(host)) this.exoSystems.set(host, { host, ra: p.ra, dec: p.dec, d: p.d, sm: p.sm, sr: p.sr, sT: p.sT, planets: [] });
      this.exoSystems.get(host).planets.push(p);
      E.push({ kind: 'exo', id: `exo:${p.n}`, zh: p.n, en: p.n, sub: `系外行星 ${p.dm || ''} ${p.dy || ''}`.trim(), keys: [p.n, host], data: p, host, rank: 3 });
    }
  }

  search(query, limit = 30) {
    const q = norm(query.trim()); if (!q) return [];
    const out = [];
    for (const e of this.entries) {
      let best = 0;
      for (const k of e.keys) { const nk = norm(k); if (nk === q) { best = 3; break; } if (nk.startsWith(q)) best = Math.max(best, 2); else if (nk.includes(q) && q.length >= 2) best = Math.max(best, 1); }
      if (best) out.push({ e, score: best * 10 - e.rank });
    }
    out.sort((a, b) => b.score - a.score || a.e.zh.length - b.e.zh.length);
    return out.slice(0, limit).map((o) => o.e);
  }

  // 世界座標位置（pc）由 RA/Dec/距離
  static worldPc(ra, dec, distPc) { return eclToWorld(ASTRO.raDecToEcl(ra, dec, distPc)); }

  // 回傳 { frame, camPos, lookAt, info, target }
  destination(entry, engine) {
    const k = entry.kind;
    if (k === 'body') {
      const b = entry.data; const jd = ASTRO.jdFromDate(new Date(engine.simTime));
      const P = engine.computeSolarPositions(jd);
      const pos = P[b.key];
      const sunDir = b.key === 'sun' ? new V3(0, 0, 1) : new V3(-pos[0], -pos[1], -pos[2]).normalize();
      // 從受光面稍偏（約 35°）看，能同時看到日夜交界
      const axes = ASTRO.bodyAxes(b.rotKey, jd);
      const up = axes ? new V3(...eclToWorld(axes.yb)) : new V3(0, 1, 0);
      const dir = sunDir.clone().applyAxisAngle(up, 0.6).normalize();
      const dist = b.key === 'sun' ? b.radius * 12 : b.key === 'saturn' ? b.radius * 5.5 : b.radius * 3.6;
      const camPos = [pos[0] + dir.x * dist, pos[1] + dir.y * dist, pos[2] + dir.z * dist];
      return { frame: { type: 'solar' }, camPos, lookAtPos: pos, up, target: b.key, label: b.zh };
    }
    if (k === 'star') {
      const s = entry.data;
      const T = bvToTemp(s.ci ?? 0.65);
      const distPc = s.d ?? null;
      const originPc = Catalog.worldPc(s.ra, s.dec, distPc ?? 100); // 未知距離暫以 100 pc 放置並標示
      const Rsun = Engine.estimateStarRadius(s.lum, T);
      const frame = { type: 'star', originPc, star: { name: s.n || s.b || `HIP ${s.hip}`, zh: entry.zh, T, lum: s.lum, radiusRsun: Rsun, mass: Math.pow(s.lum || 1, 1 / 3.5) }, system: null, label: entry.zh, distKnown: distPc != null };
      // 若此恆星有已知系外行星（以名稱比對）
      const sys = this._findSystemForStar(s);
      if (sys) frame.system = sys;
      const dist = Rsun * R_SUN_KM * 40;
      return { frame, camPos: [dist * 0.3, dist * 0.25, dist * 0.92], lookAtPos: [0, 0, 0], target: 'host', label: entry.zh };
    }
    if (k === 'exo') {
      const p = entry.data; const sys = this.exoSystems.get(entry.host);
      const distPc = sys.d ?? null;
      const originPc = Catalog.worldPc(sys.ra, sys.dec, distPc ?? 100);
      const T = sys.sT || 5772; const lum = sys.sr && sys.sT ? Math.pow(sys.sr, 2) * Math.pow(sys.sT / 5772, 4) : (sys.sm ? Math.pow(sys.sm, 3.5) : 1);
      const frame = { type: 'exo', originPc, star: { name: sys.host, zh: sys.host, T, lum, radiusRsun: sys.sr || null, mass: sys.sm || 1 }, system: sys, label: entry.zh, distKnown: distPc != null };
      const idx = sys.planets.indexOf(p);
      return { frame, camPos: null, lookAtPos: null, target: `exo${idx}`, label: p.n, approachFactor: 4.5 };
    }
    if (k === 'dso') {
      const d = entry.data;
      const distKpc = d.dk ?? null;
      const distPc = (distKpc ?? 1000) * 1000;
      const originPc = Catalog.worldPc(d.ra, d.dec, distPc);
      const distKm = distPc * PC_KM;
      const seed = [...d.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 3);
      const frame = { type: 'dso', originPc, dso: d, distKm, seed, label: entry.zh, distKnown: distKpc != null };
      const sizeKm = Math.max(1e9, (d.maj || 5) / 60 * Math.PI / 180 * distKm);
      // 從太陽系方向看過去（與目錄的投影形狀一致），距離 2.5 倍尺寸
      const toSun = new V3(-originPc[0], -originPc[1], -originPc[2]).normalize();
      const dist = sizeKm * 2.5;
      return { frame, camPos: [toSun.x * dist, toSun.y * dist, toSun.z * dist], lookAtPos: [0, 0, 0], target: 'dso', label: entry.zh };
    }
    if (k === 'bh') {
      const bh = entry.data;
      const originPc = Catalog.worldPc(bh.ra, bh.dec, bh.distPc);
      const frame = { type: 'bh', originPc, bh, label: entry.zh, distKnown: true };
      const rs = 2 * 6.6743e-11 * bh.massMsun * 1.98892e30 / Math.pow(299792458, 2) / 1000;
      const dist = rs * 22;
      return { frame, camPos: [0, dist * Math.sin(0.2), dist * Math.cos(0.2)], lookAtPos: [0, 0, 0], target: 'bh', label: entry.zh };
    }
    return null;
  }

  _findSystemForStar(s) {
    const names = [s.n, s.b, s.hip ? `HIP ${s.hip}` : null, s.hd ? `HD ${s.hd}` : null, s.gl].filter(Boolean);
    for (const n of names) { if (this.exoSystems.has(n)) return this.exoSystems.get(n); }
    // 常見別名
    const alias = { 'Rigil Kentaurus': 'alf Cen', 'Proxima Centauri': 'Proxima Centauri', 'Fomalhaut': 'Fomalhaut', 'Pollux': 'Pollux', 'Aldebaran': 'Aldebaran' };
    if (s.n && alias[s.n] && this.exoSystems.has(alias[s.n])) return this.exoSystems.get(alias[s.n]);
    return null;
  }

  // 資訊列（給面板）
  info(entry) {
    const rows = [];
    const unk = '未知';
    const k = entry.kind;
    if (k === 'body') {
      const b = entry.data;
      rows.push(['類型', b.classZh], ['半徑', `${b.radius.toLocaleString('zh-TW')} km`], ['質量', `${b.mass.toExponential(3)} kg`], ['自轉', b.rotationPeriodZh], ['公轉', b.orbitZh]);
      for (const [kk, v] of Object.entries(b.facts)) rows.push([kk, v]);
      rows.push(['貼圖', `${b.textures.src === 'observed' ? '實際觀測影像拼接' : b.textures.src === 'procedural' ? '程序模擬（非實景）' : b.textures.src}`]);
      return { title: `${b.zh}　${b.en}`, rows, note: b.textures.note, provenance: b.textures.src === 'observed' ? 'observed' : 'procedural', source: 'NASA Planetary Fact Sheet；IAU 2015；JPL 近似軌道根數' };
    }
    if (k === 'star') {
      const s = entry.data;
      rows.push(['類型', `恆星${s.sp ? '，光譜型 ' + s.sp : ''}`], ['星座', s.con ? `${CON_ZH[s.con] || ''} ${s.con}` : unk],
        ['距離', s.d != null ? `${fmtNum(s.d)} pc（${fmtNum(s.d * 3.2616)} 光年）` : unk], ['視星等', s.m], ['絕對星等', s.am ?? unk],
        ['光度', s.lum != null ? `${fmtNum(s.lum)} L☉` : unk], ['估計半徑', s.lum ? `${fmtNum(Engine.estimateStarRadius(s.lum, bvToTemp(s.ci ?? 0.65)))} R☉（由光度與色指數推估）` : unk],
        ['色溫（由 B−V）', `${Math.round(bvToTemp(s.ci ?? 0.65))} K`], ['座標 J2000', `RA ${(s.ra / 15).toFixed(3)}h，Dec ${s.dec.toFixed(2)}°`]);
      if (s.hip) rows.push(['HIP', s.hip]); if (s.hd) rows.push(['HD', s.hd]); if (s.hr) rows.push(['HR', s.hr]);
      const sys = this._findSystemForStar(s);
      if (sys) rows.push(['已知系外行星', sys.planets.map((p) => p.n).join('、')]);
      return { title: entry.zh, rows, note: '恆星近景為「由光度與色溫推估的半徑與顏色」加上程序模擬的表面，並非觀測影像。', provenance: 'inferred', source: 'HYG v4.1（Hipparcos / Yale BSC / Gliese）' };
    }
    if (k === 'dso') {
      const d = entry.data;
      const dsrc = { lit: '文獻值', parallax: '視差', redshift: '紅移粗估（H0=70）' }[d.ds];
      rows.push(['類型', TYPE_ZH[d.t] || d.t], ['星座', d.con ? `${CON_ZH[d.con] || ''} ${d.con}` : unk],
        ['距離', d.dk != null ? `${d.dk >= 1000 ? fmtNum(d.dk / 1000) + ' Mpc（' + fmtNum(d.dk / 1000 * 3.2616) + ' 百萬光年）' : fmtNum(d.dk) + ' kpc（' + fmtNum(d.dk * 3261.6) + ' 光年）'}　來源：${dsrc}` : unk],
        ['視大小', d.maj ? `${d.maj}′ × ${d.min || d.maj}′${d.pa != null ? '，方位角 ' + d.pa + '°' : ''}` : unk],
        ['實際大小（由視大小×距離）', d.maj && d.dk ? fmtDist(d.maj / 60 * Math.PI / 180 * d.dk * 1000 * PC_KM) : unk],
        ['視星等 V', d.vm ?? unk], ['B 星等', d.bm ?? unk], ['哈伯分類', d.hub || unk], ['紅移 z', d.z ?? unk],
        ['座標 J2000', `RA ${(d.ra / 15).toFixed(3)}h，Dec ${d.dec.toFixed(2)}°`]);
      if (d.m) rows.push(['梅西耶', `M${d.m}`]); if (d.ngc) rows.push(['NGC', d.ngc]); if (d.ic) rows.push(['IC', d.ic]); if (d.alt) rows.push(['其他編號', d.alt.join('、')]);
      return { title: entry.zh, rows, note: '深空天體的近景是「依目錄類型、視大小與方位角生成的型態示意」，不是影像，也不是立體結構重建。', provenance: 'schematic', source: 'OpenNGC（CC BY-SA 4.0）' };
    }
    if (k === 'exo') {
      const p = entry.data; const sys = this.exoSystems.get(entry.host);
      rows.push(['類型', '系外行星'], ['主星', entry.host], ['發現', `${p.dm || unk} ${p.dy || ''}`],
        ['距離', p.d != null ? `${fmtNum(p.d)} pc（${fmtNum(p.d * 3.2616)} 光年）` : unk],
        ['質量', p.mj != null ? `${fmtNum(p.mj)} M♃（${fmtNum(p.mj * 317.8)} M⊕）` : unk], ['半徑', p.rj != null ? `${fmtNum(p.rj)} R♃（${fmtNum(p.rj * 11.21)} R⊕）` : `${unk}（近景半徑由質量推估）`],
        ['公轉週期', p.p != null ? `${fmtNum(p.p)} 天` : unk], ['軌道半長軸', p.a != null ? `${fmtNum(p.a)} AU` : unk], ['離心率', p.e ?? unk], ['平衡溫度', p.T != null ? `${p.T} K` : unk],
        ['主星質量', sys.sm != null ? `${sys.sm} M☉` : unk], ['主星半徑', sys.sr != null ? `${sys.sr} R☉` : unk], ['主星溫度', sys.sT != null ? `${sys.sT} K` : unk],
        ['同系統行星', sys.planets.map((x) => x.n).join('、')], ['座標 J2000', `RA ${(p.ra / 15).toFixed(3)}h，Dec ${p.dec.toFixed(2)}°`]);
      return { title: p.n, rows, note: '系外行星只有軌道、質量／半徑等資料，沒有任何表面影像。近景外觀（顏色、雲帶、地貌）全部是「推測」，軌道相位也未知。', provenance: 'speculative', source: 'Open Exoplanet Catalogue' };
    }
    if (k === 'bh') {
      const bh = entry.data;
      const rs = 2 * 6.6743e-11 * bh.massMsun * 1.98892e30 / Math.pow(299792458, 2) / 1000;
      rows.push(['類型', bh.kind], ['質量', `${bh.massMsun.toExponential(2)} M☉`], ['史瓦西半徑', fmtDist(rs)], ['距離', bh.distPc >= 1e6 ? `${fmtNum(bh.distPc / 1e6)} Mpc（${fmtNum(bh.distPc / 1e6 * 3.2616)} 百萬光年）` : bh.distPc >= 1000 ? `${fmtNum(bh.distPc / 1000)} kpc（${fmtNum(bh.distPc * 3.2616 / 1000)} 千光年）` : `${fmtNum(bh.distPc)} pc（${fmtNum(bh.distPc * 3.2616)} 光年）`],
        ['座標 J2000', `RA ${(bh.ra / 15).toFixed(3)}h，Dec ${bh.dec.toFixed(2)}°`], ['資料來源', bh.src]);
      return { title: `${bh.zh}　${bh.en}`, rows, note: `渲染方式：史瓦西（無自轉）黑洞的光線測地線數值積分（Binet 方程、RK2），含光線偏折、重力透鏡、光子球陰影；吸積盤為幾何薄盤＋近似都卜勒射束與重力紅移（藝術化配色）。未考慮黑洞自轉（克爾度規）與完整輻射轉移。${bh.note}`, provenance: 'physics-approx', source: bh.src };
    }
    return { title: entry.zh, rows, note: '' };
  }
}
