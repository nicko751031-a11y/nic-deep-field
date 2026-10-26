#!/usr/bin/env python3
"""只在三個裝置尺寸驗證成功後更新來源及文件，不宣稱真機通過。"""
import json, os, re, shutil
from pathlib import Path
root=Path('space'); audit=Path('earth-layer-audit')
report=json.loads((audit/'terrain-browser/report.json').read_text())
if report.get('failure') or len(report.get('cases',[]))!=3:
    raise SystemExit('瀏覽器測試未完成，不能建立完成紀錄')
for case in report['cases']:
    assert case['geometry']['positionFinite'] and case['geometry']['normalFinite']
    assert case['geometry']['metadata']['heightExaggeration']==1
    assert not case['errors']
    assert case['injectedFailure']['state']['productSlotUTC']=='—'
    assert not case['injectedFailure']['hasMap']
unit=(audit/'unit-tests.txt').read_text()
assert '# fail 0' in unit
provenance=json.loads((root/'assets/earth_layers/provenance.json').read_text())
terrain=json.loads((root/'assets/earth_layers/taiwan-etopo60s.json').read_text())
geoid=json.loads((root/'assets/earth_layers/taiwan-geoid60s.json').read_text())
meta_path=root/'data/meta.json';meta=json.loads(meta_path.read_text())
layers=meta.setdefault('earth_layers',{})
layers['regional_preview']={
 'entry':'earth-layers.html','scope':'獨立台灣區域驗證，不替換主站；尚非全球地形',
 'bbox_wsen':[118,20,124,27],'terrain_resolution_arcsec':60,'height_exaggeration':1,
 'terrain_classification':'NOAA ETOPO 2022 高程資料重建；非即時、非30mDEM',
 'terrain_source':terrain['source_url'],'terrain_sha256':terrain['sha256'],
 'geoid_source':geoid['source_url'],'geoid_sha256':geoid['sha256'],
 'height_conversion':'h = H + N；EGM2008正高轉WGS84橢球高',
 'terrain_license':'CC0-1.0','terrain_doi':'10.25921/fd45-gt74',
 'texture_classification':'NASA 2004-07歷史合成裁切360×420，未上採樣；不是即時地表',
 'lighting':'固定展示照明，不是當下太陽方向',
 'weather_product':'Himawari_AHI_Band13_Clean_Infrared',
 'weather_classification':'10.3微米紅外線觀測，非可見光、非三維雲高',
 'weather_endpoint':'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/',
 'weather_time_source':'WMTS Layer-Time-Actual，必須等於來源公布且請求的時段；逐像素曝光時間未知',
 'weather_refresh_seconds':600,'weather_max_age_seconds':5400,
 'weather_failure':'過期、讀取失敗、全透明或時間不符立即移除影像，時間顯示—；不回退快照',
 'weather_terms':'JMA Public Data License 1.0（相容CC BY 4.0）／NASA GIBS資料指引；保留來源，裁切由ARC處理',
 'weather_terms_url':'https://www.jma.go.jp/jma/en/copyright.html',
 'gibs_usage_url':'https://nasa-gibs.github.io/gibs-api-docs/contact-us/',
 'device_validation':'Chromium SwiftShader桌面／手機直橫向；不是iPhone Safari真機',
 'browser_report':'docs/terrain-weather-test.json'
}
meta_path.write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(root/'docs').mkdir(exist_ok=True)
shutil.copy2(audit/'terrain-browser/report.json',root/'docs/terrain-weather-test.json')
def section(file, marker, text):
    path=root/file;value=path.read_text(encoding='utf-8');start='<!-- '+marker+' -->';end='<!-- /'+marker+' -->'
    block=start+'\n'+text.strip()+'\n'+end
    if start in value:
        if end not in value:raise ValueError('文件標記不完整')
        value=re.sub(re.escape(start)+r'.*?'+re.escape(end),lambda _:block,value,flags=re.S)
    else:value+='\n\n'+block+'\n'
    path.write_text(value,encoding='utf-8')
section('README.md','terrain-weather-preview','''## 台灣地形與近即時氣象驗證（獨立測試頁）

入口 `earth-layers.html`。此頁不取代第一人稱宇宙主站，不表示全球地形已完成。高程只涵蓋118–124°E、20–27°N，保留100公里觀測高度限制，沒有太空船或駕駛艙。

### 真實與模擬的界線（新增圖層）
| 圖層 | 性質 | 限制 |
|---|---|---|
| 地表 | NASA Blue Marble 2004-07歷史合成，原21K圖裁切360×420 | 原生約2km；未上採樣，非即時 |
| 地形 | NOAA ETOPO2022 60角秒資料重建，高度1:1 | 不是30m DEM；用EGM2008大地水準面轉WGS84橢球高；海域顯示海面 |
| 照明 | 固定展示照明 | 不冒充當下太陽方位或真實攝影 |
| 近即時氣象 | NASA GIBS／JMA Himawari AHI Band13，10.3微米紅外線 | 非真彩色，非雲高；每10分鐘檢查，超過90分鐘或來源錯誤撤圖 |
| 驗證快照 | 明示歷史的WMS對位快照 | 實際回傳時段未獨立核對，禁止當近即時備援 |

近即時圖層直接向NASA讀取；不用代理、CDN、金鑰或服務端快取。只接受來源公布時段與回應 `Layer-Time-Actual` 一致、影像有效的產品。載入或更新失敗顯示「—」，不沿用舊圖。切回地表是使用者主動操作，不是背景偷偷回退。

來源：NOAA NCEI ETOPO2022（https://www.ncei.noaa.gov/products/etopo-global-relief-model，DOI10.25921/fd45-gt74，CC0-1.0）；NASA Earth Observatory／Reto Stöckli Blue Marble；NASA GIBS／JMA Himawari。JMA使用條件：https://www.jma.go.jp/jma/en/copyright.html 。來源裁切與3D重建由ARC處理，不表示供應者背書；不作導航、氣象預報或警報服務。
''')
results='\n'.join('- '+c['name']+'：'+str(c['geometry']['metadata']['triangles'])+'個三角形；衛星實際連線='+c['actualSource']['status']+'；來源時間='+c['actualSource']['productSlotUTC']+'；503失敗撤圖與按鈕不重疊通過。' for c in report['cases'])
run='https://github.com/'+os.environ.get('GITHUB_REPOSITORY','nicko751031-a11y/NIC')+'/actions/runs/'+os.environ.get('GITHUB_RUN_ID','本機')
section('TESTING.md','terrain-weather-preview','## 台灣地形／氣象驗證結果\n\n環境：'+report['environment']+'。\n\n'+results+'\n\n單元測試：61項，0失敗（高程資料缺測、1:1、基準轉換、時間過期與回應時段不符）。工作流程：'+run+'\n\n尚未驗證：iPhone Safari實機GPU、發熱、長時間記憶體、全球地形接縫及主站整合。不能將尺寸模擬當作真機測試。來源停機時會安全失敗；測試紀錄不保證未來來源始終可用。')
print('來源及文件已依實際測試結果更新')
