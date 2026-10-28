// 太陽系天體定義：物理量來自 NASA Planetary Fact Sheet（nssdc.gsfc.nasa.gov）與 IAU 2015 標稱值
// textures.src 標示每張貼圖的來源與性質：
//   observed   = 實際觀測影像拼接（NASA/JPL/USGS 等）
//   procedural = 程序模擬（沒有可用的觀測貼圖，依已知顏色／型態生成）
//   radar      = 雷達地形（非肉眼可見）
export const AU = 149597870.7;

export const BODIES = [
  {
    key: 'sun', zh: '太陽', en: 'Sun', type: 'star', classZh: '恆星（G2V 黃矮星）',
    radius: 695700, flattening: 0, mass: 1.9885e30, rotKey: 'sun',
    rotationPeriodZh: '約 25.4 天（赤道，恆星）', orbitZh: '—',
    minAltitude: 150000, // 觀測邊界：表面上方 15 萬 km（真實太空船無法如此靠近）
    textures: { kind: 'sun', src: 'procedural',
      note: '光球為程序模擬的米粒組織與臨邊昏暗；非 SDO 影像。真實的太陽近即時影像請切換到「真實觀測」。' },
    facts: { 表面溫度: '5,772 K', 質量: '1.989 × 10³⁰ kg（太陽系 99.86%）', 半徑: '695,700 km（地球的 109 倍）', 距地球: '1 AU ≈ 1.496 億 km（光行 8 分 19 秒）', 年齡: '約 46 億年' },
    H: -26.7,
  },
  {
    key: 'mercury', zh: '水星', en: 'Mercury', type: 'planet', classZh: '類地行星',
    radius: 2439.7, flattening: 0, mass: 3.301e23, rotKey: 'mercury', orbitKey: 'mercury',
    rotationPeriodZh: '58.65 天（3:2 自轉軌道共振）', orbitZh: '87.97 天，a = 0.387 AU',
    minAltitude: 15,
    textures: { kind: 'rocky', src: 'procedural', color: [0.42, 0.40, 0.39],
      note: '建置環境無法取得 MESSENGER 全球拼接圖，表面為「程序模擬的撞擊地形」，僅表現灰色、無大氣、密布撞擊坑的已知特徵，坑洞位置並非真實。' },
    facts: { 表面溫度: '−180 ~ 430 °C', 大氣: '極稀薄外逸層', 衛星: '0', 探測: 'Mariner 10、MESSENGER（2011–2015 環繞）、BepiColombo（2026 進入軌道）' },
    H: -0.613,
  },
  {
    key: 'venus', zh: '金星', en: 'Venus', type: 'planet', classZh: '類地行星',
    radius: 6051.8, flattening: 0, mass: 4.867e24, rotKey: 'venus', orbitKey: 'venus',
    rotationPeriodZh: '243.0 天（逆行）', orbitZh: '224.7 天，a = 0.723 AU',
    minAltitude: 120, // 雲頂約 65–70 km，不可穿入
    textures: { kind: 'venus', src: 'procedural', radarMap: 'assets/textures/venus_magellan_radar_1440.jpg',
      note: '可見光外觀為「程序模擬的厚重硫酸雲層」（淡黃白、低對比、Y 形紫外線條紋僅作微弱暗示）。另可切換顯示 NASA Magellan 雷達地形圖，但那不是肉眼可見的樣子。' },
    atmosphere: { color: [1.0, 0.93, 0.78], height: 90, density: 0.6 },
    facts: { 表面溫度: '約 465 °C', 表面氣壓: '92 bar', 大氣: 'CO₂ 96.5%，硫酸雲', 衛星: '0', 探測: 'Venera、Magellan（雷達）、Venus Express、Akatsuki' },
    H: -4.384,
  },
  {
    key: 'earth', zh: '地球', en: 'Earth', type: 'planet', classZh: '類地行星（你的家）',
    radius: 6378.137, flattening: 1 / 298.257, mass: 5.972e24, rotKey: 'earth', orbitKey: 'earth',
    rotationPeriodZh: '23 小時 56 分 4 秒（恆星日）', orbitZh: '365.256 天，a = 1.000 AU',
    minAltitude: 100, // 卡門線
    textures: { kind: 'earth', src: 'observed',
      day: 'assets/textures/earth_day_4096.jpg', night: 'assets/textures/earth_night_4096.jpg',
      brc: 'assets/textures/earth_bump_roughness_clouds_4096.jpg', normal: 'assets/textures/earth_normal_2048.jpg',
      note: '日間：NASA Blue Marble；已安裝的高解析分塊為 BMNG 2004年7月歷史合成（最高16384×8192，依視野載入），缺塊回退4K，實際狀態見設定；夜間城市燈光：NASA Black Marble（Suomi NPP VIIRS）；雲層：NASA Blue Marble 雲層合成（固定快照，非當前雲圖）。三者皆為多日／多月合成，不是即時影像。經 three.js 倉庫取得。' },
    atmosphere: { color: [0.45, 0.65, 1.0], height: 100, density: 1.0 },
    facts: { 表面溫度: '平均 15 °C', 大氣: 'N₂ 78%、O₂ 21%', 衛星: '1（月球）', 海洋覆蓋: '71%' },
    H: -3.99,
  },
  {
    key: 'moon', zh: '月球', en: 'Moon', type: 'moon', classZh: '地球的天然衛星', parent: 'earth',
    radius: 1737.4, flattening: 0, mass: 7.346e22, rotKey: 'moon', orbitKey: 'moon',
    rotationPeriodZh: '27.32 天（同步自轉）', orbitZh: '27.32 天，平均 384,400 km',
    minAltitude: 10,
    textures: { kind: 'rocky', src: 'observed', map: 'assets/textures/moon_1024.jpg', color: [0.5, 0.5, 0.5],
      note: 'NASA 月面拼接圖（1024×512，經 three.js 倉庫取得）。解析度有限，低軌道高度會模糊。' },
    facts: { 表面溫度: '−173 ~ 127 °C', 大氣: '無', 探測: 'Apollo 11–17 載人登陸、LRO 持續繞月' },
    H: 0.21,
  },
  {
    key: 'mars', zh: '火星', en: 'Mars', type: 'planet', classZh: '類地行星',
    radius: 3396.2, flattening: 0.00589, mass: 6.417e23, rotKey: 'mars', orbitKey: 'mars',
    rotationPeriodZh: '24 小時 37 分', orbitZh: '686.98 天，a = 1.524 AU',
    minAltitude: 30,
    textures: { kind: 'rocky', src: 'observed', map: 'assets/textures/mars_nasa_1440.jpg', color: [0.6, 0.4, 0.3],
      note: 'NASA/JPL Solar System Simulator 火星全球圖（Viking 軌道器影像，USGS 處理；1440×720，經 NASA-3D-Resources 倉庫取得）。極冠為拍攝季節的狀態。' },
    atmosphere: { color: [0.85, 0.65, 0.5], height: 60, density: 0.12 },
    facts: { 表面溫度: '−140 ~ 20 °C', 大氣: 'CO₂ 95%，0.006 bar', 衛星: '2（火衛一、火衛二）', 探測: 'Viking、MRO、Curiosity、Perseverance' },
    H: -1.601,
  },
  {
    key: 'jupiter', zh: '木星', en: 'Jupiter', type: 'planet', classZh: '氣態巨行星',
    radius: 71492, flattening: 0.06487, mass: 1.898e27, rotKey: 'jupiter', orbitKey: 'jupiter',
    rotationPeriodZh: '9 小時 55 分（System III）', orbitZh: '11.86 年，a = 5.203 AU',
    minAltitude: 1500, // 1 bar 層上方；氣態行星沒有可站立表面
    textures: { kind: 'gas', src: 'observed', map: 'assets/textures/jupiter_nasa_720.jpg', color: [0.75, 0.65, 0.5], desat: 0.12,
      note: 'NASA/JPL 木星全球圖（Cassini ISS 影像拼接，720×360，經 NASA-3D-Resources 倉庫取得）。雲帶與大紅斑有觀測依據，但為拍攝當時（2000 年）的樣貌；大紅斑的當前經度未同步。解析度低，近距離會模糊。' },
    facts: { 雲頂溫度: '約 −110 °C', 大氣: 'H₂ 90%、He 10%', 衛星: '95 顆已確認', 大紅斑: '風暴，直徑約 1.6 萬 km（持續縮小中）' },
    H: -9.395,
  },
  {
    key: 'saturn', zh: '土星', en: 'Saturn', type: 'planet', classZh: '氣態巨行星（有顯著星環）',
    radius: 60268, flattening: 0.09796, mass: 5.683e26, rotKey: 'saturn', orbitKey: 'saturn',
    rotationPeriodZh: '10 小時 33 分', orbitZh: '29.46 年，a = 9.537 AU',
    minAltitude: 1500,
    textures: { kind: 'gas', src: 'observed', map: 'assets/textures/saturn_nasa_720.jpg', color: [0.85, 0.75, 0.55], desat: 0.35, // 720 px 圖色彩過濃；實際為淡奶油色
      note: 'NASA/JPL 土星全球圖（720×360，經 NASA-3D-Resources 倉庫取得）。星環為「依已知環帶半徑程序重建」：C 環 74,658–92,000 km、B 環 92,000–117,580 km、卡西尼縫 117,580–122,170 km、A 環 122,170–136,775 km（恩克縫 133,589 km）、F 環 140,180 km；環內細節非影像。' },
    rings: { inner: 66900, outer: 140500, src: 'procedural' },
    facts: { 雲頂溫度: '約 −140 °C', 大氣: 'H₂ 96%、He 3%', 衛星: '146 顆已確認', 星環厚度: '多數不到 1 km' },
    H: -8.914,
  },
  {
    key: 'uranus', zh: '天王星', en: 'Uranus', type: 'planet', classZh: '冰巨行星',
    radius: 25559, flattening: 0.02293, mass: 8.681e25, rotKey: 'uranus', orbitKey: 'uranus',
    rotationPeriodZh: '17 小時 14 分（逆行，自轉軸傾斜 97.8°）', orbitZh: '84.01 年，a = 19.19 AU',
    minAltitude: 1200,
    textures: { kind: 'gas', src: 'procedural', color: [0.62, 0.80, 0.86],
      note: 'Voyager 2（1986）所見的天王星幾乎沒有可見特徵，呈均勻藍綠色。此處為「程序模擬」：均勻藍綠色球體加極微弱的緯度帶，無真實雲圖。星環（ε 環等）為依已知半徑的程序示意，極暗。' },
    rings: { inner: 41800, outer: 51200, src: 'procedural', faint: true },
    facts: { 雲頂溫度: '約 −195 °C', 大氣: 'H₂、He、CH₄（甲烷造成藍綠色）', 衛星: '28 顆已確認', 探測: '僅 Voyager 2 飛掠' },
    H: -7.11,
  },
  {
    key: 'neptune', zh: '海王星', en: 'Neptune', type: 'planet', classZh: '冰巨行星',
    radius: 24764, flattening: 0.01708, mass: 1.024e26, rotKey: 'neptune', orbitKey: 'neptune',
    rotationPeriodZh: '16 小時 6 分', orbitZh: '164.8 年，a = 30.07 AU',
    minAltitude: 1200,
    textures: { kind: 'gas', src: 'observed', map: 'assets/textures/neptune_nasa_720.jpg', color: [0.25, 0.4, 0.9],
      note: 'NASA/JPL 海王星全球圖（Voyager 2 1989 年影像為基礎，720×360，經 NASA-3D-Resources 倉庫取得）。大暗斑等風暴早已消散，此為歷史樣貌。' },
    facts: { 雲頂溫度: '約 −200 °C', 風速: '最高約 2,100 km/h（太陽系最強）', 衛星: '16 顆已確認', 探測: '僅 Voyager 2 飛掠' },
    H: -7.0,
  },
  {
    key: 'pluto', zh: '冥王星', en: 'Pluto', type: 'dwarf', classZh: '矮行星（2006 年起由 IAU 重新分類；傳統九大行星之一）',
    radius: 1188.3, flattening: 0, mass: 1.303e22, rotKey: 'pluto', orbitKey: 'pluto',
    rotationPeriodZh: '6.39 天（逆行）', orbitZh: '247.9 年，a = 39.48 AU，e = 0.249',
    minAltitude: 10,
    textures: { kind: 'rocky', src: 'observed', map: 'assets/textures/pluto_nasa_720.jpg', color: [0.7, 0.6, 0.5], uOffset: 0.5,
      note: 'NASA/JHUAPL/SwRI New Horizons 全球圖（2015 飛掠，720×360，經 NASA-3D-Resources 倉庫取得）。飛掠時背向的半球只有低解析度資料，貼圖上模糊區域即為缺測區。' },
    facts: { 表面溫度: '約 −230 °C', 大氣: '極稀薄 N₂（約 1 Pa）', 衛星: '5（冥衛一 Charon 最大）', 探測: '僅 New Horizons 飛掠（2015）' },
    H: -0.4,
  },
];

export const BODY_BY_KEY = Object.fromEntries(BODIES.map((b) => [b.key, b]));
export const NINE_PLANETS = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
