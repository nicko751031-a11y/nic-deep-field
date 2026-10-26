#!/usr/bin/env python3
"""來源連線驗證：只讀公開 NASA／NOAA，產物不是即時備援。"""
import json, pathlib, sys, hashlib, urllib.request, xml.etree.ElementTree as ET
from datetime import datetime, timezone
import numpy as np
import rasterio
from rasterio.windows import from_bounds
from PIL import Image
from io import BytesIO

OUT = pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'earth-layer-audit')
NS = {'w':'http://www.opengis.net/wmts/1.0','o':'http://www.opengis.net/ows/1.1'}

def write(name, data):
    (OUT/name).write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False)+'\n', encoding='utf-8')

def weather():
    root=ET.parse(OUT/'gibs-capabilities.xml')
    layer=next((l for l in root.findall('.//w:Layer',NS) if l.findtext('o:Identifier','',NS)=='Himawari_AHI_Band13_Clean_Infrared'),None)
    if layer is None: raise ValueError('來源沒有指定紅外線產品')
    dim=next((d for d in layer.findall('w:Dimension',NS) if d.findtext('o:Identifier','',NS).lower()=='time'),None)
    if dim is None: raise ValueError('來源沒有時間維度')
    from audit_earth_layers import latest_slot
    latest=latest_slot([x.text for x in dim.findall('w:Value',NS)],datetime.now(timezone.utc))
    if latest is None: raise ValueError('來源未提供有效 UTC 時段')
    slot=latest.strftime('%Y-%m-%dT%H:%M:%SZ')
    base='https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/Himawari_AHI_Band13_Clean_Infrared/default/'
    reports=[]
    for tag, time in [('published',slot),('invalid_future','2099-01-01T00:00:00Z')]:
        url=base+time+'/2km/5/7/33.png'
        try:
            request=urllib.request.Request(url,headers={'Origin':'https://nicko751031-a11y.github.io','User-Agent':'ARC-source-audit/2'})
            with urllib.request.urlopen(request,timeout=60) as r:
                data=r.read(4000001); headers=dict(r.headers); status=r.status
            if len(data)>4000000: raise ValueError('影像過大')
            with Image.open(BytesIO(data)) as im:
                a=np.asarray(im.convert('RGBA'));size=list(im.size);coverage=float(np.mean(a[:,:,3]>0))
            (OUT/('wmts-'+tag+'.png')).write_bytes(data)
            reports.append({'tag':tag,'url':url,'requested':time,'status':status,'headers':headers,'size':size,'coverage':coverage,'sha256':hashlib.sha256(data).hexdigest()})
        except Exception as e: reports.append({'tag':tag,'url':url,'requested':time,'error':type(e).__name__+': '+str(e)})
    write('wmts-time-probe.json',reports)
    print('WMTS',json.dumps(reports,ensure_ascii=False))

def geoid():
    meta=json.loads((OUT/'taiwan-etopo60s.json').read_text())
    url='https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/60s/60s_geoid_gtif/ETOPO_2022_v1_60s_N90W180_geoid.tif'
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',GDAL_HTTP_TIMEOUT='60',CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif'):
        with rasterio.open(url) as ds:
            w=from_bounds(118,20,124,27,ds.transform).round_offsets().round_lengths()
            g=ds.read(1,window=w,masked=True)
            if g.shape!=(meta['height'],meta['width']) or g.count()!=g.size: raise ValueError('大地水準面缺測或格網不一致')
            if abs(float(g.max()))>200 or abs(float(g.min()))>200: raise ValueError('大地水準面值異常')
            raw=np.asarray(g,dtype='<f4').tobytes();(OUT/'taiwan-geoid60s.f32').write_bytes(raw)
            m={'source_url':url,'transform':list(ds.window_transform(w))[:6],'width':g.shape[1],'height':g.shape[0],'unit':'metres','encoding':'float32-little-endian','min_metres':float(g.min()),'max_metres':float(g.max()),'sha256':hashlib.sha256(raw).hexdigest(),'conversion':'h = H + N；H 為 EGM2008 正高，N 為大地水準面起伏，h 為 WGS84 橢球高','status':'sampled','source_tags':ds.tags()}
            write('taiwan-geoid60s.json',m);print('GEOID',json.dumps(m,ensure_ascii=False))

OUT.mkdir(parents=True,exist_ok=True)
for name,fn in [('wmts',weather),('geoid',geoid)]:
    try:fn()
    except Exception as e:write(name+'-failed.json',{'status':'failed','reason':type(e).__name__+': '+str(e)});print(name,'FAILED',type(e).__name__,str(e))
