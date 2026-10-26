#!/usr/bin/env python3
"""僅取得公開素材作離線驗證；不部署、不將快照當即時。
python3 -I tools/audit_earth_layers.py --out earth-layer-audit
需要 Pillow、numpy、rasterio、pyproj（只用於離線處理）。
"""
import argparse
import hashlib
import io
import json
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from pathlib import Path

NASA_URL = 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/july/world.200407.3x21600x10800.jpg'
NASA_SHA = 'dea8b4dc8a4f93f5f8bce0c8c85a508a178e7901e9ed8e6bf86e6ce7ef6d61e2'
CAP_URL = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml'
WMS_URL = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi'
DEM_URL = 'https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/60s/60s_surface_elev_gtif/ETOPO_2022_v1_60s_N90W180_surface.tif'
NS = {'w': 'http://www.opengis.net/wmts/1.0', 'o': 'http://www.opengis.net/ows/1.1'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def get(url, limit=45000000):
    host = urllib.parse.urlparse(url).hostname or ''
    if not (host.endswith('.nasa.gov') or host.endswith('.noaa.gov')):
        raise ValueError('拒絕非 NASA／NOAA 來源')
    request = urllib.request.Request(url, headers={'User-Agent': 'ARC-source-audit/1.0', 'Origin': 'https://nicko751031-a11y.github.io'})
    with urllib.request.urlopen(request, timeout=90) as response:
        payload = response.read(limit + 1)
        if len(payload) > limit:
            raise ValueError('回應超過驗證大小上限')
        return payload, {k.lower():v for k,v in response.headers.items()}, response.url


def save_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def nasa(out):
    from PIL import Image
    data, headers, resolved = get(NASA_URL)
    if sha(data) != NASA_SHA:
        raise ValueError('NASA 來源雜湊改變，停止並要求重新查核')
    Image.MAX_IMAGE_PIXELS = 240000000
    with Image.open(io.BytesIO(data)) as image:
        if image.size != (21600, 10800) or image.mode != 'RGB':
            raise ValueError('NASA 原圖尺寸／色彩不符')
        image.verify()
    target = out / 'world.200407.3x21600x10800.jpg'
    target.write_bytes(data)
    return {'status': 'verified', 'file': target.name, 'source_url': NASA_URL, 'resolved_url': resolved, 'sha256': sha(data), 'size': [21600, 10800], 'source_month': '2004-07', 'classification': 'NASA 歷史合成，非即時', 'credit': 'NASA Earth Observatory / Reto Stöckli', 'usage_url': 'https://www.nasa.gov/nasa-brand-center/images-and-media/'}


def parse_time(value):
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', value):
        return None
    try:
        return datetime.strptime(value, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def latest_slot(values, now):
    times = []
    for value in values:
        parts = value.split('/')
        start = parse_time(parts[0])
        if start is None or start > now:
            continue
        if len(parts) == 1:
            times.append(start)
        elif len(parts) == 3:
            end = parse_time(parts[1])
            duration = re.fullmatch(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', parts[2])
            seconds = sum(int(n or 0)*factor for n,factor in zip(duration.groups(), [3600,60,1])) if duration else 0
            if end is not None and end >= start and seconds > 0:
                times.append(start + timedelta(seconds=((min(end,now)-start).total_seconds()//seconds)*seconds))
    return max(times) if times else None


def weather(out):
    from PIL import Image
    import numpy as np
    data, headers, resolved = get(CAP_URL, 25000000)
    (out / 'gibs-capabilities.xml').write_bytes(data)
    root = ET.fromstring(data)
    candidates = []
    for layer in root.findall('.//w:Layer', NS):
        identifier = layer.findtext('o:Identifier', '', NS)
        title = layer.findtext('o:Title', '', NS)
        if 'himawari' not in (identifier + title).lower():
            continue
        dims = [d for d in layer.findall('w:Dimension', NS) if d.findtext('o:Identifier', '', NS).lower() == 'time']
        if not dims:
            continue
        dim = dims[0]
        ranges = [v.text for v in dim.findall('w:Value', NS) if v.text]
        candidates.append({'id': identifier, 'title': title, 'default': dim.findtext('w:Default', '', NS), 'time_ranges': ranges, 'formats': [f.text for f in layer.findall('w:Format', NS)], 'matrix_sets': [m.findtext('w:TileMatrixSet', '', NS) for m in layer.findall('w:TileMatrixSetLink', NS)]})
    save_json(out / 'gibs-himawari-products.json', candidates)
    # 首輪驗證選已發佈的 10.3µm 紅外線產品，不杜撰不存在的 Himawari 真彩色圖層。
    preferred = [c for c in candidates if c['id'] == 'Himawari_AHI_Band13_Clean_Infrared']
    options = [(latest_slot(c['time_ranges'], datetime.now(timezone.utc)), c) for c in preferred]
    options = [(t,c) for t,c in options if t is not None]
    if not options:
        return {'status': 'unavailable', 'reason': '來源未提供可用的 Himawari 紅外線 UTC 時段', 'candidate_count': len(candidates), 'time': None}
    t, c = max(options, key=lambda x: x[0])
    slot = t.strftime('%Y-%m-%dT%H:%M:%SZ')
    params = {'SERVICE': 'WMS', 'VERSION': '1.1.1', 'REQUEST': 'GetMap', 'LAYERS': c['id'], 'STYLES': '', 'SRS': 'EPSG:4326', 'BBOX': '118,20,124,27', 'WIDTH': '768', 'HEIGHT': '896', 'FORMAT': 'image/png', 'TRANSPARENT': 'TRUE', 'TIME': slot}
    image_url = WMS_URL + '?' + urllib.parse.urlencode(params)
    image_data, image_headers, final = get(image_url, 8000000)
    with Image.open(io.BytesIO(image_data)) as image:
        if image.size != (768, 896):
            raise ValueError('氣象影像尺寸錯誤')
        rgba = np.asarray(image.convert('RGBA'))
        coverage = float(np.mean(rgba[:, :, 3] > 0))
        if coverage == 0:
            raise ValueError('來源回傳全透明缺測圖，不能算載入成功')
    (out / 'himawari-audit-snapshot.png').write_bytes(image_data)
    age = (datetime.now(timezone.utc) - t).total_seconds()
    return {'status': 'fresh-at-audit' if age <= 5400 else 'stale-not-live', 'layer': c['id'], 'title': c['title'], 'classification': '10.3 微米紅外線氣象觀測，非肉眼真彩色、非三維雲高', 'product_slot_utc': slot, 'observation_instant_utc': None, 'time_note': '產品時段來自 capabilities；不等同每個像素精確曝光時刻。此檔僅為驗證快照，不得標示即時。', 'age_seconds_at_audit': age, 'coverage_fraction': coverage, 'bbox_wsen': [118,20,124,27], 'source_url': image_url, 'sha256': sha(image_data), 'capabilities_sha256': sha(data), 'capabilities_cors': headers.get('access-control-allow-origin'), 'image_cors': image_headers.get('access-control-allow-origin'), 'expose_headers': image_headers.get('access-control-expose-headers'), 'response_time_headers': {k:v for k,v in image_headers.items() if 'time' in k or k in ['date','last-modified']}, 'live_texture_safe': False, 'limitation': 'WMS nearestValue 可能吸附到其他時段；正式串流需補實際來源時間驗證及瀏覽器 CORS 測試'}


def terrain(out):
    import rasterio
    from rasterio.windows import from_bounds
    from pyproj import CRS
    import numpy as np
    # 只以 HTTP Range 取台灣區域，不下載全球大檔，不上採樣宣稱高精度。
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', GDAL_HTTP_TIMEOUT='60', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif'):
        with rasterio.open(DEM_URL) as dataset:
            if dataset.crs is None:
                raise ValueError('來源未提供座標基準')
            crs = CRS.from_wkt(dataset.crs.to_wkt())
            save_json(out / 'terrain-source-crs.json', {'wkt': crs.to_wkt(), 'epsg': crs.to_epsg(), 'transform': list(dataset.transform)[:6]})
            horizontal = crs.sub_crs_list[0] if crs.is_compound else crs
            if horizontal.to_2d().to_epsg() != 4326:
                raise ValueError('來源水平座標不是 WGS84 經緯度')
            window = from_bounds(118,20,124,27, dataset.transform).round_offsets().round_lengths()
            heights = dataset.read(1, window=window, masked=True)
            transform = dataset.window_transform(window)
            if heights.count() == 0 or heights.shape[0] * heights.shape[1] > 200000:
                raise ValueError('高程範圍或有效樣本不符')
            if float(heights.min()) < -12000 or float(heights.max()) > 10000:
                raise ValueError('來源高程或單位超出可驗證範圍')
            samples = np.asarray(np.rint(heights.filled(-32768)), dtype='<i2')
            raw = samples.tobytes()
            (out / 'taiwan-etopo60s.i16').write_bytes(raw)
            meta = {'status': 'sampled', 'classification': 'NOAA ETOPO 2022 高程資料重建，非即時；60 角秒，不是 30m DEM', 'source_url': DEM_URL, 'dataset_page': 'https://www.ncei.noaa.gov/products/etopo-global-relief-model', 'source_resolution_arcsec': [abs(transform.a) * 3600, abs(transform.e) * 3600], 'crs': 'EPSG:4326', 'source_crs_wkt': crs.to_wkt(), 'source_crs_epsg': crs.to_epsg(), 'transform': list(transform)[:6], 'width': samples.shape[1], 'height': samples.shape[0], 'unit': 'metres', 'encoding': 'int16-little-endian', 'quantization': '原生網格四捨五入至 1 公尺，未上採樣', 'nodata': -32768, 'origin': 'north-west', 'registration': 'pixel-centre', 'height_datum': 'source-orthometric-requires-geoid-conversion', 'render_height_exaggeration': 1, 'min_metres': float(heights.min()), 'max_metres': float(heights.max()), 'sha256': sha(raw), 'source_tags': dataset.tags(), 'license': 'CC0-1.0；NOAA NCEI ETOPO 2022，非導航用途', 'geometry_enabled': False, 'limitation': '尚未轉換成橢球高、未完成海岸與 LOD 接縫測試，不啟用正式地形'}
    save_json(out / 'taiwan-etopo60s.json', meta)
    return meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    report = {'checked_at_utc': datetime.now(timezone.utc).isoformat(), 'purpose': '私有測試產物，非正式部署', 'layers': {}}
    for name, fn in [('surface', nasa), ('weather', weather), ('terrain', terrain)]:
        try:
            report['layers'][name] = fn(args.out)
        except Exception as exc:
            report['layers'][name] = {'status': 'failed', 'reason': str(exc), 'time': None}
        print(name, json.dumps(report['layers'][name], ensure_ascii=False), flush=True)
        save_json(args.out / 'report.json', report)
    if report['layers']['surface']['status'] != 'verified':
        raise SystemExit('NASA 素材驗證失敗，停止建立高解析分塊')

if __name__ == '__main__':
    main()
