# ARC 地表、地形與氣象分層

## 本版實際完成的範圍

沿用 Claude PR #19 的 EarthLod，不另建引擎。NASA 原圖已實際取得，產生同來源 L0 4096×2048、L1 8192×4096（8塊）、L2 16384×8192（32塊）。每塊2048×2048；不是將4K放大。來源為2004年7月月合成，未來即時氣象必須有獨立的來源與時間，不能改地表的分類。

「地表檢視」只讓使用者隱藏既有歷史雲圖及其陰影，方便看到較高解析地表。預設保留雲層；關閉時持續顯示「歷史雲層已隱藏，非即時晴空」。不新增地形或假雲，不影響100km觀測邊界。

`js/earthlayers.js` 已實作且可獨立測試：嚴格UTC時間解析、來源時段選擇、近即時有效期限、模擬時間與現在一致性、過期／失敗清空、取消舊請求防止競態、地理UV、WGS84高程換算、缺測高程處理。此模組不是已啟用的即時圖層。

## 可驗證來源

### 歷史地表
- NASA Earth Observatory / Reto Stöckli，Blue Marble Next Generation 2004-07。
- 原始檔：https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/july/world.200407.3x21600x10800.jpg
- 來源介紹：https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/
- 原圖 SHA-256：`dea8b4dc8a4f93f5f8bce0c8c85a508a178e7901e9ed8e6bf86e6ce7ef6d61e2`。
- 使用規範：https://www.nasa.gov/nasa-brand-center/images-and-media/ ，保留NASA Earth Observatory署名，不表示NASA背書。
- 官方21K全球圖是約2km網格的產品，不是另提供的500m原生分塊；本版尚未取得500m全球分塊。16K只是輸出像素尺寸，不等於公尺級地形。
- 原圖的去雲、海洋底色、月合成均屬資料處理限制；不能宣稱是現在的地球。

### 地形候選（未接入3D）
- NOAA NCEI ETOPO2022，https://www.ncei.noaa.gov/products/etopo-global-relief-model ，DOI `10.25921/fd45-gt74`。
- 已取樣60角秒原生格網，範圍西118°、南20°、東124°、北27°，360×420；實際來源CRS為EPSG:9518（WGS84水平座標＋EGM2008高程），不是單純EPSG:4326。
- 正高不能直接當橢球高。`geodeticEcefKm` 對 orthometric 必須提供 geoidMetres，未知就拒絕，不能假設0。回傳是ECEF公里，不是three世界座標；接入時仍需既有IAU自轉軸轉換。
- 高程原生約60角秒不是30m；本版不誇大山高（1:1）、不將缺測填成海平面。
- 格網像素中心與左上角不可混用；內插只能在有效區域，範圍外回傳null。海岸、海面遮蓋、區域邊界與LOD接縫尚待驗證，因此 `enabled=false`。

### 氣象候選（未接入3D）
- NASA GIBS： https://nasa-gibs.github.io/gibs-api-docs/access-basics/
- 實際驗證的產品是 `Himawari_AHI_Band13_Clean_Infrared`（10.3µm紅外線），不是肉眼真彩色，也不是三維雲高。不能把紅外線灰階直接當雲高度或透明度。
- capabilities 的時間維度識別字為 `Time`；介接需不分大小寫。使用來源列出的UTC區間與PT10M時序，不用本機時間捏造影像時間。
- 已取得台灣區域768×896影像及`Access-Control-Allow-Origin: *`。這只證明來源回應與HTTP層級跨來源標頭存在，不代表iPhone WebGL可用或時段已精確驗證。
- GIBS WMS `nearestValue=1` 可能吸附時間。程式不將requested TIME、HTTP Date或下載時間當作實際曝光時間；來源回應與時段未完成驗證時 `verifiedTime=false`，不得發布為近即時。
- `productSlotUTC` 是來源產品時段，`observationInstantUTC` 未知則null。紅外線與真彩色、歷史與近即時必須在畫面分開標示。
- 專案保守有效期限為90分鐘（不是來源保證）；超過期限、CORS／斷線、全透明缺測、未知時間都撤圖並顯示「—」。重新整理時不保留舊圖冒充目前。
- 暫停、加速或回到過去時，近即時層暫停，不把現在天氣貼到模擬過去。
- 測試快照只留私有驗證產物，不部署成「即時氣象」。保留NASA GIBS、Himawari原供應者署名與資料條款。

## 手機記憶體

每個高解析塊以RGBA+mipmap估算約21.4MiB。載入前將已載入與排隊中的塊一併計入預算；額度不足時不發新請求，保留4K回退。只有不在當前視野的舊塊可以釋放。同來源L0取代舊4K後會釋放舊貼圖。

128／384MB只計算高解析塊快取，不代表整個網站GPU／RAM使用量；雲圖、夜燈、底圖、後處理緩衝仍需另計。2048²是保守設計選擇，不將舊版iOS的限制誤稱為所有裝置共同上限。

## 可重現驗證

```sh
python3 -I tools/apply_earth_surface_view.py
node --test tools/test_earthlayers.mjs
node --test tools/test_earthlod_budget.mjs
python3 -I tools/audit_earth_layers.py --out ../earth-layer-audit
python3 -I tools/build_earth_tiles.py ../earth-layer-audit/world.200407.3x21600x10800.jpg --source-url https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/july/world.200407.3x21600x10800.jpg --month 2004-07 --out assets/textures/earth_tiles
python3 -m http.server 8123 --bind 127.0.0.1
# 另一個終端：
node tools/earth_layers_browser_test.mjs http://127.0.0.1:8123/ ../earth-layer-audit/browser
```

41項地形氣象測試與8項快取測試可離線執行。瀏覽器測試使用真正NASA分塊，涵蓋桌面、手機直橫向、極區預算、缺塊回退、歷史雲層開關與拉遠降級。

CI只在全部測試通過後，將准許清單內的素材與程式保存到開發分支；不直接合併main、不部署公開鏡像。私有根目錄及其他專案不打包。完整函式與檔案皆在PR及候選版檔案中，沒有省略程式碼。

## 仍須完成

地形垂直基準轉換及實際網格整合；氣象回應時段驗證及球面覆蓋遮罩；iPhone Safari真機GPU、FPS、發熱、音訊與全站回歸。通過無頭瀏覽器測試不能宣稱以上項目完成，更不能宣稱品質滿分。
