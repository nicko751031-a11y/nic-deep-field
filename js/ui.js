// DOM 介面：目的地、搜尋、資訊面板、狀態列、設定、提示
import { fmtDist, fmtSpeed, fmtDateTime, fmtNum } from './units.js';
import { BODIES } from './bodies.js';

const PROV_LABEL = { observed: '實際觀測影像', procedural: '程序模擬', schematic: '型態示意', speculative: '推測外觀', inferred: '資料推估', 'physics-approx': '物理近似' };
const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.hud = $('hud'); this.restore = $('restore'); this.info = $('info'); this.status = $('status'); this.results = $('results'); this.q = $('q');
    this.toastEl = $('toast'); this.settings = $('settings'); this.labels = $('labels');
    this.hidden = false; this.selIndex = -1; this.lastResults = [];
    this.labelEls = new Map();
  }

  buildDestinations(catalog, onPick) {
    const list = $('dest-list'); list.innerHTML = '';
    const order = ['earth', 'moon', 'sun', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
    for (const k of order) {
      const b = BODIES.find((x) => x.key === k);
      const btn = document.createElement('button'); btn.innerHTML = `<span>${b.zh}</span><small>${b.en}</small>`; btn.dataset.key = k;
      btn.addEventListener('click', () => onPick(catalog.entries.find((e) => e.kind === 'body' && e.id === k)));
      list.appendChild(btn);
    }
    const extras = [['bh', 'sgra', '人馬座 A*', '黑洞'], ['dso', 'dso:NGC0224', 'M31 仙女座星系', '星系'], ['dso', 'dso:NGC1976', 'M42 獵戶座大星雲', '星雲'], ['star', 'Proxima Centauri', '比鄰星', '恆星'], ['exo', 'exo:TRAPPIST-1 e', 'TRAPPIST-1 e', '系外行星']];
    for (const [kind, id, zh, sub] of extras) {
      const e = kind === 'star' ? catalog.entries.find((x) => x.kind === 'star' && x.data.n === id) : catalog.entries.find((x) => x.kind === kind && x.id === id);
      if (!e) continue;
      const btn = document.createElement('button'); btn.innerHTML = `<span>${zh}</span><small>${sub}</small>`;
      btn.addEventListener('click', () => onPick(e)); list.appendChild(btn);
    }
  }

  bindSearch(catalog, onPick) {
    const render = (items, query) => {
      this.lastResults = items; this.selIndex = -1; this.results.innerHTML = '';
      if (!query) { this.results.classList.remove('open'); return; }
      if (!items.length) {
        const c = catalog.meta?.counts || {};
        this.results.innerHTML = `<div class="empty">未收錄：「${escapeHtml(query)}」。目前收錄 ${fmtNum(c.stars_searchable || 0)} 顆可搜尋恆星、${fmtNum(c.dso || 0)} 個 NGC/IC 深空天體、${fmtNum(c.exoplanets || 0)} 顆系外行星、${catalog.entries.filter((e) => e.kind === 'bh').length} 個黑洞與太陽系 11 個天體。不會虛構天體。</div>`;
        this.results.classList.add('open'); return;
      }
      for (const [i, e] of items.entries()) {
        const d = document.createElement('div'); d.className = 'r'; d.innerHTML = `<span>${escapeHtml(e.zh)}</span><small>${escapeHtml(e.sub)}</small>`;
        d.addEventListener('mousedown', (ev) => { ev.preventDefault(); onPick(e); this.closeResults(); });
        d.addEventListener('touchend', (ev) => { ev.preventDefault(); onPick(e); this.closeResults(); });
        this.results.appendChild(d); void i;
      }
      this.results.classList.add('open');
    };
    let timer = null;
    this.q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => render(catalog.search(this.q.value), this.q.value.trim()), 80); });
    this.q.addEventListener('focus', () => { if (this.q.value.trim()) render(catalog.search(this.q.value), this.q.value.trim()); });
    this.q.addEventListener('blur', () => setTimeout(() => this.closeResults(), 150));
    this.q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { this.selIndex = Math.min(this.selIndex + 1, this.lastResults.length - 1); this._hl(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { this.selIndex = Math.max(this.selIndex - 1, 0); this._hl(); e.preventDefault(); }
      else if (e.key === 'Enter') { const pick = this.lastResults[this.selIndex >= 0 ? this.selIndex : 0]; if (pick) { onPick(pick); this.closeResults(); this.q.blur(); } }
      else if (e.key === 'Escape') { this.closeResults(); this.q.blur(); }
      e.stopPropagation();
    });
  }
  _hl() { [...this.results.children].forEach((c, i) => c.classList.toggle('sel', i === this.selIndex)); }
  closeResults() { this.results.classList.remove('open'); }

  showInfo(info, actions) {
    this.info.style.display = '';
    const badge = `<span class="badge badge-${info.provenance || 'inferred'}">${PROV_LABEL[info.provenance] || info.provenance || ''}</span>`;
    const touch = document.body.classList.contains('touch');
    this.info.classList.toggle('collapsed', touch);
    this.info.innerHTML = `<button class="close" id="info-close" aria-label="關閉">×</button>${touch ? '<button class="toggle" id="info-toggle">詳情</button>' : ''}<h2>${escapeHtml(info.title)}</h2>${badge}<span class="hint">${escapeHtml(info.source || '')}</span>
      <dl>${info.rows.map(([k, v]) => `<dt>${escapeHtml(String(k))}</dt><dd>${escapeHtml(String(v ?? '未知'))}</dd>`).join('')}</dl>
      ${info.note ? `<div class="note">${escapeHtml(info.note)}</div>` : ''}
      <div class="actions" id="info-actions"></div>`;
    $('info-close').addEventListener('click', () => { this.info.style.display = 'none'; });
    $('info-toggle')?.addEventListener('click', () => { const c = this.info.classList.toggle('collapsed'); $('info-toggle').textContent = c ? '詳情' : '收合'; });
    const box = $('info-actions');
    for (const [label, fn] of actions || []) { const b = document.createElement('button'); b.textContent = label; b.addEventListener('click', fn); box.appendChild(b); }
  }

  setStatus({ speed, autoSpeed, target, dist, altitude, simTime, rate, frameLabel, frameNote, mode, fps, warp }) {
    this.status.innerHTML = [
      `速度 <b>${fmtSpeed(speed)}</b>${autoSpeed ? '（自動）' : '（手動）'}${warp ? ' <span style="color:var(--warn)">超光速為模擬效果</span>' : ''}`,
      target ? `目標 <b>${escapeHtml(target)}</b> 距中心 <b>${fmtDist(dist)}</b>${altitude != null ? ` · 高度 <b>${fmtDist(altitude)}</b>` : ''}` : '',
      `模擬時間 <b>${fmtDateTime(new Date(simTime))}</b> ${rate === 0 ? '<span style="color:var(--warn)">暫停</span>' : rate === 1 ? '即時' : `×${fmtNum(rate)}`}`,
      frameLabel ? `所在 <b>${escapeHtml(frameLabel)}</b>${frameNote ? ` <span style="color:var(--warn)">${escapeHtml(frameNote)}</span>` : ''}` : '',
      mode ? `${escapeHtml(mode)}` : '',
      fps ? `${fps} fps` : '',
    ].filter(Boolean).map((s) => `<span>${s}</span>`).join('');
  }

  toast(msg, ms = 3200) {
    this.toastEl.textContent = msg; this.toastEl.classList.add('show');
    clearTimeout(this._tt); this._tt = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  setHidden(h) {
    this.hidden = h; this.hud.classList.toggle('hidden', h); this.restore.classList.toggle('show', h);
    this.labels.style.display = h ? 'none' : '';
    if (h) this.settings.classList.remove('open');
  }

  updateLabels(targets, engine, onPick) {
    if (this.hidden) return;
    const seen = new Set();
    for (const t of targets) {
      const p = engine.project(t.rel);
      let el = this.labelEls.get(t.key);
      if (!p) { if (el) el.style.display = 'none'; continue; }
      if (!el) { el = document.createElement('div'); el.className = 'lbl'; el.addEventListener('click', () => onPick?.(t.key)); this.labels.appendChild(el); this.labelEls.set(t.key, el); }
      const angR = Math.atan2(t.radius, t.dist);
      const pxR = angR * engine.height / (2 * Math.tan(engine.camera.fov * Math.PI / 360));
      el.style.display = '';
      el.style.left = `${p.x}px`; el.style.top = `${p.y - Math.min(pxR, engine.height)}px`;
      el.innerHTML = `${escapeHtml(t.zh)} <small>${fmtDist(t.dist)}</small>`;
      seen.add(t.key);
    }
    for (const [k, el] of this.labelEls) if (!seen.has(k)) el.style.display = 'none';
  }

  buildSettings(opts) {
    const s = this.settings;
    const row = (label, inner) => `<label><span>${label}</span>${inner}</label>`;
    s.innerHTML = `<h3>設定</h3>
      ${row('畫質', `<select id="s-quality"><option value="high">高</option><option value="medium">中</option><option value="low">低（手機）</option></select>`)}
      ${row('曝光', `<select id="s-exposure"><option value="auto">自動（靠近亮天體時星空變暗）</option><option value="stars">星空優先</option><option value="bodies">天體優先</option></select>`)}
      ${row('顯示天體標籤', `<input type="checkbox" id="s-labels" checked>`)}
      ${row('金星顯示 Magellan 雷達地形（非肉眼所見）', `<input type="checkbox" id="s-venus">`)}
      ${row('滑鼠靈敏度', `<input type="range" id="s-sens" min="0.5" max="3" step="0.1" value="1">`)}
      ${row('反轉上下', `<input type="checkbox" id="s-invert">`)}
      ${row('視野（FOV）', `<input type="range" id="s-fov" min="25" max="100" step="1" value="60">`)}
      ${row('聲音', `<select id="s-audio"><option value="off">靜音（真空，預設）</option><option value="ambient">合成環境音景（純合成）</option><option value="sonify">資料聲化：行星公轉頻率</option></select>`)}
      <div class="sub" id="s-audio-note">合成音景＝WebAudio 濾波雜訊，不是任何錄音。資料聲化＝把各行星公轉頻率（1/週期）升高若干八度到可聽範圍，每顆一個正弦音；來源 JPL 軌道週期。宇宙中沒有可被錄下的「太空聲音」，這兩者都不是真實錄音。</div>
      <details><summary>目錄收錄範圍與資料來源</summary><div id="s-catalog"></div></details>
      <details><summary>貼圖與影像來源／載入狀態</summary><div id="s-textures"></div></details>
      <details><summary>已知限制（測試版）</summary><ul style="font-size:12px;color:var(--muted);padding-left:18px">
        <li>所有 3D 畫面皆為模擬；行星貼圖是歷史拼接圖，不是當下樣貌；地球雲層為固定快照。</li>
        <li>水星、天王星、金星可見光外觀、太陽表面、系外行星、深空天體近景、黑洞吸積盤皆為程序模擬或示意，已逐一標示。</li>
        <li>貼圖解析度有限（多數 720–4096 px），近距離會模糊；程序細節只調變亮度，不是真實地形。</li>
        <li>相對論效果（光行差、都卜勒）未在飛行時模擬；「光速」只是視覺特效與壓縮旅行時間。</li>
        <li>真實觀測來源由瀏覽器直接讀取，部分來源可能因 CORS 或停機失敗；失敗時會明示，不會以舊圖冒充。</li>
      </ul></details>`;
    $('s-quality').value = opts.quality;
    $('s-quality').addEventListener('change', (e) => { localStorage.setItem('ndf-quality', e.target.value); location.reload(); });
    $('s-exposure').addEventListener('change', (e) => opts.onExposure(e.target.value));
    $('s-labels').addEventListener('change', (e) => opts.onLabels(e.target.checked));
    $('s-venus').addEventListener('change', (e) => opts.onVenus(e.target.checked));
    $('s-sens').addEventListener('input', (e) => opts.onSens(parseFloat(e.target.value)));
    $('s-invert').addEventListener('change', (e) => opts.onInvert(e.target.checked));
    $('s-fov').addEventListener('input', (e) => opts.onFov(parseFloat(e.target.value)));
    $('s-audio').addEventListener('change', (e) => opts.onAudio(e.target.value));
  }
  fillCatalogInfo(catalog, engine) {
    const m = catalog.meta; const box = $('s-catalog'); if (!box) return;
    if (!m) { box.innerHTML = `<div class="sub">目錄資料載入失敗：${(catalog.loadErrors || []).join('；')}</div>`; return; }
    const c = m.counts;
    box.innerHTML = `<table>
      <tr><td>建置時間</td><td>${m.built}</td></tr>
      <tr><td>可渲染恆星</td><td>${fmtNum(c.stars_rendered)}（HYG 共 ${fmtNum(c.stars_total_in_hyg)} 顆，收錄 ≤ 8 等或有專名者）</td></tr>
      <tr><td>可搜尋恆星</td><td>${fmtNum(c.stars_searchable)}（< 6.5 等或有專名）</td></tr>
      <tr><td>深空天體</td><td>${fmtNum(c.dso)}（NGC/IC；含梅西耶 ${c.messier}；有距離者 ${fmtNum(c.dso_with_distance)}）</td></tr>
      <tr><td>系外行星</td><td>${fmtNum(c.exoplanets)}（已確認）</td></tr>
      <tr><td>黑洞</td><td>8（手動整理）</td></tr>
      <tr><td>太陽系</td><td>太陽、月球、傳統九大行星（冥王星標示為矮行星）；尚未收錄其他衛星、小行星、彗星</td></tr>
      ${Object.values(m.sources).map((s) => `<tr><td>${s.name}</td><td><a href="${s.url}" target="_blank" rel="noopener">${s.url}</a><br>${s.license}；上游版本 ${s.commit ? s.commit.slice(0, 10) : '?'}（${s.commit_date || '?'}）</td></tr>`).join('')}
      ${m.notes.map((n) => `<tr><td>備註</td><td>${n}</td></tr>`).join('')}
    </table>`;
    const tb = $('s-textures');
    tb.innerHTML = `<table>${BODIES.map((b) => `<tr><td>${b.zh}</td><td>${b.textures.src === 'observed' ? '<span class="badge badge-observed">實際觀測</span>' : '<span class="badge badge-procedural">程序模擬</span>'}${escapeHtml(b.textures.note)}</td></tr>`).join('')}
      <tr><td>全天背景</td><td><span class="badge badge-observed">實際觀測</span>NASA Tycho 星表全天圖（2880×1440，含銀河），經 NASA-3D-Resources 倉庫取得；另疊加 HYG 星表的星點。</td></tr>
      <tr><td>載入狀態</td><td>${Object.entries(engine.textureStatus).map(([p, st]) => `${p.split('/').pop()}：${st === 'ok' ? '<span style="color:var(--ok)">成功</span>' : '<span style="color:var(--err)">失敗</span>'}`).join('<br>')}</td></tr></table>`;
  }
}

export function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
