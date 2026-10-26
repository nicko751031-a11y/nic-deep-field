#!/usr/bin/env python3
"""將通過來源驗證的測試產物整理成靜態地形預覽；氣象僅保留標明時間的驗證快照。"""
import argparse,hashlib,json,shutil
from pathlib import Path
from PIL import Image

def build(source:Path,out:Path):
    out.mkdir(parents=True,exist_ok=True)
    for name,file,datum in [('taiwan-etopo60s','taiwan-etopo60s.i16','EGM2008'),('taiwan-geoid60s','taiwan-geoid60s.f32','EGM2008-undulation')]:
        meta=json.loads((source/(name+'.json')).read_text());raw=(source/file).read_bytes()
        if hashlib.sha256(raw).hexdigest()!=meta['sha256']:raise ValueError('高程雜湊不符')
        if (meta['width'],meta['height'])!=(360,420):raise ValueError('採樣範圍不符')
        meta.update(file=file,heightDatum=datum,crs='EPSG:4326',registration='pixel-centre',nodata=-32768,sourceResolutionArcsec=60)
        (out/file).write_bytes(raw);(out/(name+'.json')).write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    original=source/'world.200407.3x21600x10800.jpg'
    digest=hashlib.sha256(original.read_bytes()).hexdigest()
    if digest!='dea8b4dc8a4f93f5f8bce0c8c85a508a178e7901e9ed8e6bf86e6ce7ef6d61e2':raise ValueError('NASA 來源不符')
    Image.MAX_IMAGE_PIXELS=240000000
    with Image.open(original) as im:
        if im.size!=(21600,10800):raise ValueError('原圖尺寸錯誤')
        im.crop((17880,3780,18240,4200)).save(out/'taiwan-nasa-200407.jpg',quality=95,subsampling=0)
    weather=json.loads((source/'report.json').read_text())['layers']['weather']
    weather.update(displayMode='archive-test-snapshot',isNearRealtime=False,warning='歷史驗證快照；WMS 實際對應時段未獨立驗證，不能標示即時或自動回退至此圖')
    file=source/'himawari-audit-snapshot.png'
    if hashlib.sha256(file.read_bytes()).hexdigest()!=weather['sha256']:raise ValueError('氣象快照雜湊錯誤')
    shutil.copyfile(file,out/'himawari-audit-snapshot.png');(out/'weather-snapshot.json').write_text(json.dumps(weather,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (out/'provenance.json').write_text(json.dumps({'classification':'資料重建驗證，非即時','terrain':'NOAA ETOPO2022 60角秒、EGM2008轉WGS84橢球高，高度1:1，海域顯示海面','texture':'NASA Blue Marble 2004-07真實來源裁切360×420，未上採樣或AI補細節','source_sha256':digest,'texture_sha256':hashlib.sha256((out/'taiwan-nasa-200407.jpg').read_bytes()).hexdigest(),'bbox_wsen':[118,20,124,27],'license':'NOAA ETOPO CC0-1.0；NASA Earth Observatory影像使用條件與Reto Stöckli署名'},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('out',type=Path);a=p.parse_args();build(a.source,a.out)
