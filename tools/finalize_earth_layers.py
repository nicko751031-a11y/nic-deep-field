#!/usr/bin/env python3
"""在測試成功後更新候選版文件；不把來源探測當成真機或正式上線驗證。"""
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AUDIT = ROOT.parent / 'earth-layer-audit'
report = json.loads((AUDIT / 'browser/report.json').read_text())
assert 'failure' not in report and len(report['cases']) == 5, '瀏覽器案例未完整通過'
for case in report['cases']:
    assert not case['errors'] and not case['near']['shaderErrors']
    assert case['near']['cacheBytes'] <= case['near']['budgetBytes']
    assert case['near']['lod']['synthetic'] is False
    assert case['surface']['cloudOpacity'] == 0 and case['far']['level'] == 0
for filename, expected in [('unit-tests.txt', 41), ('budget-tests.txt', 8)]:
    text = (AUDIT / filename).read_text()
    assert f'# pass {expected}' in text and '# fail 0' in text, filename

readme = ROOT / 'README.md'
text = readme.read_text(encoding='utf-8')
marker = '| 地球高解析分塊（BMNG 2004-07） |'
if marker not in text:
    at = '|---|---|---|\n'
    rows = ('| 地球高解析分塊（BMNG 2004-07） | 歷史觀測拼接 | NASA 21600×10800 原圖重新取樣為 4K／8K／16K，40 張 2048² 分塊；不是即時、不是 500m 原生分塊，也不是高程網格 |\n'
            '| 地表檢視（隱藏歷史雲層） | 人工顯示設定 | 只為查看地表細節；不代表當下晴空；畫面持續標示非即時晴空 |\n'
            '| 地形與 GIBS 氣象候選層 | 尚未接入 3D | 已取樣 NOAA 60角秒高程與 Himawari 紅外線；高程基準轉換及回應時段驗證尚未完成，不以測試快照冒充即時 |\n')
    assert at in text
    text = text.replace(at, at + rows, 1)
if '## 地表分層候選版操作' not in text:
    text += '''\n\n## 地表分層候選版操作

設定 →「顯示歷史雲層」預設開啟；關閉後可檢查 NASA 地表分塊細節，畫面會持續標示「非即時晴空」。拉遠沿用4K，靠近按畫面像素需求載入8K／16K。缺塊或記憶體額度不足時保留4K，不生成假地形、不穿透黑洞。

來源：NASA Earth Observatory / Reto Stöckli，Blue Marble Next Generation 2004-07。原圖與每塊 SHA-256 在 `assets/textures/earth_tiles/manifest.json`，其他來源狀態在 `data/meta.json` 的 `earth_layers`。來源：https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/ 。NASA 使用規範：https://www.nasa.gov/nasa-brand-center/images-and-media/ 。海洋底色、去雲與月合成屬原資料處理限制。

2048²是本專案的保守分塊選擇，不代表所有iOS都有固定相同的圖片解碼上限。128／384MB僅是高解析分塊快取估算預算，不是整個網站GPU／RAM佔用；還有底圖、雲圖、夜燈與渲染緩衝。實機仍須測試。

地形與近即時氣象原型、失敗撤圖規則及未完成項目詳見 `docs/EARTH_LAYERS.md`。維持原有100km觀測邊界、km／JD座標與全部真實性標示。
'''
readme.write_text(text, encoding='utf-8')

# 天體資訊要說清楚動態分塊來源，不能仍只顯示舊4K說明。
bodies = ROOT / 'js/bodies.js'
text = bodies.read_text(encoding='utf-8')
old = '日間：NASA Blue Marble（MODIS 合成，4096×2048）；'
new = '日間：NASA Blue Marble；已安裝的高解析分塊為 BMNG 2004年7月歷史合成（最高16384×8192，依視野載入），缺塊回退4K，實際狀態見設定；'
if old in text:
    bodies.write_text(text.replace(old, new, 1), encoding='utf-8')

run_id = os.environ.get('GITHUB_RUN_ID', '本機')
run_url = f'https://github.com/nicko751031-a11y/NIC/actions/runs/{run_id}'
section = f'''\n\n## 真實 NASA 分塊／地表檢視驗證（{run_id}）

- 驗證紀錄：{run_url}；瀏覽器：{report.get('browserVersion', '詳見產物')}，Chromium + SwiftShader；不是 iPhone Safari 真機，不是硬體GPU效能測試。
- 真實素材：2004-07 NASA 21600×10800，來源 SHA-256 `dea8b4dc8a4f93f5f8bce0c8c85a508a178e7901e9ed8e6bf86e6ce7ef6d61e2`；40張真實分塊＋L0，不使用合成放大測試圖。
- 41項地形／氣象狀態測試、8項分塊記憶體測試通過。
- 5個瀏覽器情境：桌面、手機直向、手機橫向、手機極區多分塊、刻意404分塊。近距離L2、拉遠L0、雲層開關、來源提示、分塊快取預算均通過；shader及非預期console錯誤0。
- 新修正：計入尚在下載的貼圖預算；額度不夠保留4K；底圖替換後釋放舊圖；地表檢視同步所有LOD材質的雲層／雲影開關。
- 證據：私有artifact內 `browser/*.png`、`browser/report.json`、`unit-tests.txt`、`budget-tests.txt`、`tile-verification.json`。各圖是本次候選版截圖，不是電腦生成的示意參考圖。
- 未驗證：iPhone Safari真機FPS、發熱、音訊、全站完整回歸；不可把本節當作全部bug修復或正式部署證明。
- 地形與近即時氣象保持未接入3D：NOAA正高轉橢球高、WMS吸附時段仍有未完成驗證；測試影像不可當即時發布。
'''
testing = ROOT / 'TESTING.md'
text = testing.read_text(encoding='utf-8')
if f'## 真實 NASA 分塊／地表檢視驗證（{run_id}）' not in text:
    testing.write_text(text + section, encoding='utf-8')
print('已根據通過的實際報告更新文件與來源說明')
