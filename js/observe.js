// 真實觀測：接入官方公開影像來源，嚴格區分 直播／近即時／歷史／模擬，並顯示來源、拍攝時間、更新頻率、延遲與狀態。
// 注意：本面板的所有時間都盡量取自來源提供的機器可讀時間；取不到時明確標示「無法取得」，絕不用網頁載入時間冒充拍攝時間。
import { fmtDateTime, fmtAgo } from './units.js';

const KIND_LABEL = { live: '直播', nrt: '近即時', archive: '歷史／延遲發布', sim: '模擬', sync: '位置同步（非攝影）' };

async function fetchJson(url, timeoutMs = 12000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try { const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
  finally { clearTimeout(t); }
}
function loadImage(url, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const t = setTimeout(() => { img.src = ''; reject(new Error('載入逾時')); }, timeoutMs);
    img.onload = () => { clearTimeout(t); resolve(img); };
    img.onerror = () => { clearTimeout(t); reject(new Error('影像載入失敗（來源中斷、網址變更或瀏覽器阻擋）')); };
    img.referrerPolicy = 'no-referrer';
    img.src = url;
  });
}
const pad = (n) => String(n).padStart(2, '0');

// ---- 來源定義 ----------------------------------------------------------------
export const SOURCES = [
  {
    id: 'sdo171', group: 'sun', title: 'SDO AIA 171 Å（日冕，約 100 萬 K）', kind: 'nrt', provider: 'NASA Solar Dynamics Observatory（GSFC）',
    cadence: '約每 15 分鐘更新一張「最新」影像', timeSource: 'Helioviewer API（getClosestImage，sourceId 10）',
    async run() {
      const img = `https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_0171.jpg?x=${Date.now()}`;
      const meta = await safe(() => fetchJson(`https://api.helioviewer.org/v2/getClosestImage/?date=${new Date().toISOString()}&sourceId=10`));
      return { imageUrl: img, captured: meta?.date ? parseUtc(meta.date) : null, timeNote: meta?.date ? 'Helioviewer 回報最接近現在的 AIA 171 影像時間（與左圖「最新」影像可能相差一兩張）' : '時間 API 無法連線；SDO「latest」影像本身不帶機器可讀時間戳，拍攝時間無法取得', credit: 'NASA/SDO and the AIA science team' };
    },
  },
  {
    id: 'sdo304', group: 'sun', title: 'SDO AIA 304 Å（色球／過渡區）', kind: 'nrt', provider: 'NASA SDO（GSFC）', cadence: '約每 15 分鐘', timeSource: 'Helioviewer API（sourceId 13）',
    async run() {
      const img = `https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_0304.jpg?x=${Date.now()}`;
      const meta = await safe(() => fetchJson(`https://api.helioviewer.org/v2/getClosestImage/?date=${new Date().toISOString()}&sourceId=13`));
      return { imageUrl: img, captured: meta?.date ? parseUtc(meta.date) : null, timeNote: meta?.date ? 'Helioviewer 回報時間' : '拍攝時間無法取得', credit: 'NASA/SDO and the AIA science team' };
    },
  },
  {
    id: 'hmi', group: 'sun', title: 'SDO HMI 連續譜（可見光光球，黑子）', kind: 'nrt', provider: 'NASA SDO（GSFC）', cadence: '約每 15 分鐘', timeSource: 'Helioviewer API（sourceId 18）',
    async run() {
      const img = `https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_HMIIC.jpg?x=${Date.now()}`;
      const meta = await safe(() => fetchJson(`https://api.helioviewer.org/v2/getClosestImage/?date=${new Date().toISOString()}&sourceId=18`));
      return { imageUrl: img, captured: meta?.date ? parseUtc(meta.date) : null, timeNote: meta?.date ? 'Helioviewer 回報時間' : '拍攝時間無法取得', credit: 'NASA/SDO and the HMI science team' };
    },
  },
  {
    id: 'lascoc2', group: 'sun', title: 'SOHO LASCO C2 日冕儀（日冕物質拋射）', kind: 'nrt', provider: 'ESA/NASA SOHO', cadence: '約每 12 分鐘拍攝，網站約每小時更新', timeSource: '影像右下角內嵌的 UTC 時間戳（本站無法機器讀取）',
    async run() {
      return { imageUrl: `https://soho.nascom.nasa.gov/data/realtime/c2/512/latest.jpg?x=${Date.now()}`, captured: null, timeNote: '拍攝時間請看影像內嵌時間戳（UTC）；本站無法取得機器可讀時間', credit: 'ESA/NASA SOHO/LASCO' };
    },
  },
  {
    id: 'goes', group: 'earth', title: 'GOES-East 全盤 GeoColor（西半球）', kind: 'nrt', provider: 'NOAA NESDIS STAR', cadence: '每 10 分鐘', timeSource: '影像底部內嵌 UTC 時間戳',
    async run() {
      return { imageUrl: `https://cdn.star.nesdis.noaa.gov/GOES19/ABI/FD/GEOCOLOR/1808x1808.jpg?x=${Date.now()}`, captured: null, timeNote: '拍攝時間請看影像底部黑條（UTC）；GeoColor 夜側為 NOAA 以紅外線＋靜態城市燈光合成，非真實夜間可見光', credit: 'NOAA/NESDIS/STAR' };
    },
  },
  {
    id: 'himawari', group: 'earth', title: 'Himawari-9 全盤真彩（東亞／台灣上空）', kind: 'nrt', provider: 'JMA 氣象衛星，影像由日本 NICT 提供', cadence: '每 10 分鐘', timeSource: 'NICT latest.json 的拍攝時間',
    async run() {
      const meta = await fetchJson(`https://himawari8.nict.go.jp/img/D531106/latest.json?x=${Date.now()}`);
      // date 格式 "YYYY-MM-DD HH:MM:SS"（UTC）
      const d = parseUtc(meta.date);
      const u = `https://himawari8.nict.go.jp/img/D531106/1d/550/${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}_0_0.png`;
      return { imageUrl: u, captured: d, timeNote: 'NICT 回報的最新全盤影像時間（UTC）', credit: 'JMA / NICT' };
    },
  },
  {
    id: 'epic', group: 'earth', title: 'DSCOVR EPIC 全日照地球（距地 150 萬 km）', kind: 'archive', provider: 'NASA EPIC（GSFC）', cadence: '每日數張，通常延遲 1–3 天發布', timeSource: 'EPIC API 的影像時間',
    async run() {
      const list = await fetchJson(`https://epic.gsfc.nasa.gov/api/natural?x=${Date.now()}`);
      if (!Array.isArray(list) || !list.length) throw new Error('EPIC API 無資料');
      const last = list[list.length - 1]; const d = parseUtc(last.date);
      const u = `https://epic.gsfc.nasa.gov/archive/natural/${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/png/${last.image}.png`;
      return { imageUrl: u, captured: d, timeNote: `EPIC API 回報拍攝時間；當日共 ${list.length} 張，此為最後一張`, credit: 'NASA EPIC Team', extra: last.caption };
    },
  },
];

async function safe(fn) { try { return await fn(); } catch (e) { return null; } }
function parseUtc(s) { if (!s) return null; const t = s.replace(' ', 'T'); return new Date(t.endsWith('Z') ? t : t + 'Z'); }

// ---- 面板 ------------------------------------------------------------------
export class ObservePanel {
  constructor(root, engine, onMarkIss) {
    this.root = root; this.engine = engine; this.onMarkIss = onMarkIss; this.results = {}; this.built = false;
  }
  build() {
    if (this.built) return; this.built = true;
    this.root.innerHTML = `
      <div class="obs-head">
        <div class="obs-title">真實觀測</div>
        <div class="obs-tabs">
          <button data-tab="sun" class="active">太陽</button><button data-tab="earth">地球</button><button data-tab="iss">國際太空站</button><button data-tab="sync">天體位置同步</button>
        </div>
        <button class="obs-close" id="obs-close" aria-label="回到 3D 探索">← 回到 3D 探索</button>
      </div>
      <div class="obs-notice">
        以下影像均來自官方公開來源，由你的瀏覽器直接向來源讀取。本站只顯示來源提供的拍攝時間；取不到時會寫「無法取得」。
        <b>直播</b>＝即時串流；<b>近即時</b>＝通常數分鐘至一小時內；<b>歷史／延遲發布</b>＝數小時至數天前；任何 3D 畫面都是<b>模擬</b>。
        本站無法在宇宙任意位置取得當下的真實近景；固定攝影機影像也不會變成任意視角的即時 3D 全景。
      </div>
      <div class="obs-body" id="obs-body"></div>`;
    const host = location.hostname;
    if (/claude\.ai$|claudeusercontent\.com$|anthropic/.test(host)) {
      const warn = document.createElement('div'); warn.className = 'obs-notice'; warn.style.borderLeftColor = 'var(--err)';
      warn.textContent = '注意：目前的托管環境（Claude Artifact）以安全政策封鎖所有外部影像與 API 連線，因此此分頁的真實觀測來源在這個網址一定會顯示失敗。這不是來源中斷；請改用正式網址（見 README）。';
      this.root.querySelector('.obs-head').after(warn);
    }
    this.root.querySelectorAll('.obs-tabs button').forEach((b) => b.addEventListener('click', () => this.showTab(b.dataset.tab)));
    this.root.querySelector('#obs-close').addEventListener('click', () => this.root.classList.remove('open'));
    this.showTab('sun');
  }
  showTab(tab) {
    this.root.querySelectorAll('.obs-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const body = this.root.querySelector('#obs-body'); body.innerHTML = '';
    if (tab === 'sun' || tab === 'earth') {
      for (const s of SOURCES.filter((x) => x.group === tab)) body.appendChild(this._tile(s));
    } else if (tab === 'iss') body.appendChild(this._issTile());
    else body.appendChild(this._syncTile());
  }

  _tile(src) {
    const el = document.createElement('div'); el.className = 'obs-tile';
    el.innerHTML = `
      <div class="obs-tile-head"><span class="badge badge-${src.kind}">${KIND_LABEL[src.kind]}</span><b>${src.title}</b></div>
      <div class="obs-img"><div class="obs-status">載入中…</div></div>
      <dl class="obs-meta">
        <dt>來源</dt><dd>${src.provider}</dd>
        <dt>更新頻率</dt><dd>${src.cadence}</dd>
        <dt>拍攝時間</dt><dd class="cap">—</dd>
        <dt>資料延遲</dt><dd class="lag">—</dd>
        <dt>時間來源</dt><dd>${src.timeSource}</dd>
        <dt>本機最後成功載入</dt><dd class="loaded">—（這不是拍攝時間）</dd>
        <dt>狀態</dt><dd class="st">載入中</dd>
      </dl>
      <div class="obs-actions"><button class="refresh">重新讀取</button><a class="open" target="_blank" rel="noopener">在新分頁開啟原始影像</a></div>`;
    const run = async () => {
      const imgBox = el.querySelector('.obs-img'); const st = el.querySelector('.st'); const cap = el.querySelector('.cap'); const lag = el.querySelector('.lag'); const loaded = el.querySelector('.loaded');
      imgBox.innerHTML = '<div class="obs-status">載入中…</div>'; st.textContent = '載入中'; st.className = 'st';
      try {
        const r = await src.run();
        el.querySelector('.open').href = r.imageUrl.split('?')[0];
        const img = await loadImage(r.imageUrl);
        imgBox.innerHTML = ''; imgBox.appendChild(img);
        if (r.captured && !Number.isNaN(r.captured.getTime())) {
          cap.textContent = `${fmtDateTime(r.captured, { utc: true })}｜本地 ${fmtDateTime(r.captured)}`;
          lag.textContent = `${fmtAgo(Date.now() - r.captured.getTime())}（以本機時鐘計算）`;
        } else { cap.textContent = `無法取得（${r.timeNote}）`; lag.textContent = '無法判定'; }
        const note = document.createElement('div'); note.className = 'obs-note'; note.textContent = `${r.timeNote}。影像版權／致謝：${r.credit}${r.extra ? '。' + r.extra : ''}`; imgBox.appendChild(note);
        loaded.textContent = `${fmtDateTime(new Date())}（這不是拍攝時間）`;
        st.textContent = '已載入'; st.className = 'st ok';
      } catch (e) {
        imgBox.innerHTML = `<div class="obs-status err">來源中斷或無法連線：${e.message || e}<br>不顯示舊影像以免誤導。</div>`;
        st.textContent = `失敗：${e.message || e}`; st.className = 'st err'; cap.textContent = '—'; lag.textContent = '—';
      }
    };
    el.querySelector('.refresh').addEventListener('click', run);
    run();
    return el;
  }

  _issTile() {
    const el = document.createElement('div'); el.className = 'obs-tile wide';
    el.innerHTML = `
      <div class="obs-tile-head"><span class="badge badge-sync">位置同步（非攝影）</span><b>國際太空站目前位置</b></div>
      <dl class="obs-meta">
        <dt>來源</dt><dd>Where the ISS at? API（api.wheretheiss.at，基於 NORAD/CelesTrak TLE 推算）</dd>
        <dt>位置時間</dt><dd class="cap">—</dd>
        <dt>緯度／經度／高度</dt><dd class="pos">—</dd>
        <dt>速度</dt><dd class="vel">—</dd>
        <dt>狀態</dt><dd class="st">載入中</dd>
      </dl>
      <div class="obs-actions"><button class="refresh">重新讀取</button><button class="mark">在 3D 地球上標示並前往</button></div>
      <div class="obs-tile-head" style="margin-top:14px"><span class="badge badge-live">直播（外部連結）</span><b>NASA 官方直播</b></div>
      <div class="obs-note">太空站的即時影像由 NASA 透過 YouTube／NASA+ 直播，本站不嵌入、不轉播，以免把舊錄影誤當直播。是否正在播出、播的是不是太空站鏡頭、延遲多少，皆由 NASA 決定，本站無法判定。</div>
      <div class="obs-actions">
        <a target="_blank" rel="noopener" href="https://www.youtube.com/@NASA/streams">NASA YouTube 直播列表</a>
        <a target="_blank" rel="noopener" href="https://plus.nasa.gov/scheduled-video/iss-live-stream/">NASA+ ISS Live（含排程）</a>
        <a target="_blank" rel="noopener" href="https://eol.jsc.nasa.gov/ESRS/HDEV/">NASA HDEV 計畫頁（歷史說明）</a>
      </div>`;
    const run = async () => {
      const st = el.querySelector('.st');
      try {
        const j = await fetchJson(`https://api.wheretheiss.at/v1/satellites/25544?x=${Date.now()}`);
        const t = new Date(j.timestamp * 1000);
        el.querySelector('.cap').textContent = `${fmtDateTime(t, { utc: true })}｜本地 ${fmtDateTime(t)}（${fmtAgo(Date.now() - t.getTime())}）`;
        el.querySelector('.pos').textContent = `${j.latitude.toFixed(3)}°，${j.longitude.toFixed(3)}°，${j.altitude.toFixed(1)} km`;
        el.querySelector('.vel').textContent = `${j.velocity.toFixed(0)} km/h`;
        st.textContent = '已載入'; st.className = 'st ok';
        this.iss = { lat: j.latitude, lon: j.longitude, altKm: j.altitude, time: t };
      } catch (e) { st.textContent = `失敗：${e.message || e}`; st.className = 'st err'; this.iss = null; }
    };
    el.querySelector('.refresh').addEventListener('click', run);
    el.querySelector('.mark').addEventListener('click', () => { if (this.iss) this.onMarkIss?.(this.iss); else alert('尚未取得 ISS 位置'); });
    run();
    return el;
  }

  _syncTile() {
    const el = document.createElement('div'); el.className = 'obs-tile wide';
    const now = new Date(this.engine.simTime);
    el.innerHTML = `
      <div class="obs-tile-head"><span class="badge badge-sync">位置同步（非攝影）</span><b>3D 場景的天體位置依據</b></div>
      <div class="obs-note">3D 畫面中的行星、月球位置與自轉相位，由星曆公式依「模擬時間」計算，不是攝影，也不是即時觀測。模擬時間預設為你裝置的現在時間，可在底部調整倍率或暫停。</div>
      <dl class="obs-meta">
        <dt>模擬時間</dt><dd>${fmtDateTime(now, { utc: true })}｜本地 ${fmtDateTime(now)}</dd>
        <dt>行星位置</dt><dd>JPL「Keplerian Elements for Approximate Positions of the Major Planets」（Standish，1800–2050 表），精度約角分等級</dd>
        <dt>月球位置</dt><dd>Astronomical Almanac 低精度公式（黃經誤差約 0.3°、距離約 0.2 地球半徑）</dd>
        <dt>自轉軸與自轉相位</dt><dd>IAU WGCCRE 2009/2015 自轉模型；地球相位等同格林威治恆星時（已驗證台北日夜）；其他行星貼圖的本初子午線對齊未經逐一驗證</dd>
        <dt>自我檢查（建置時）</dt><dd>2020-09-22 秋分太陽黃經 179.72°；2020-12-21 木土大合黃經差 0.05°；2020-10-13 火星衝 180.01°；2000-01-06 新月距角 0.04°</dd>
      </dl>`;
    return el;
  }
}
