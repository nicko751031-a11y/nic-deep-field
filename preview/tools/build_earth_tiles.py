#!/usr/bin/env python3
"""離線產生地球貼圖分塊金字塔（ARC 地球 LOD 用）。

來源必須是已核對的 NASA Blue Marble 全球等距柱狀投影圖（例如 21600×10800）。
輸出：
  <out>/manifest.json                 來源、授權、各層各塊的尺寸與 SHA-256
  <out>/L1_<x>_<y>.jpg …              每塊 2048×2048（x 由西向東、y 由北向南，從 0 起算）
層級：L0 = 既有 4096×2048 單張（不在此產生）；L1 = 8192×4096（4×2 塊）；L2 = 16384×8192（8×4 塊）。
每塊 ≤ 2048² 是為了避開 iOS Safari 約 16.7 MP 的單張影像解碼上限。

用法（真實資料）：
  python3 -I tools/build_earth_tiles.py <NASA_21600x10800.jpg> --source-url <官方頁面 URL> --month 2004-12 --out assets/textures/earth_tiles
用法（合成測試資料，只供本機測試管線，不得提交、不得當作高解析）：
  python3 -I tools/build_earth_tiles.py assets/textures/earth_day_4096.jpg --synthetic --out assets/textures/earth_tiles_synthetic
需要 Pillow；網站執行時不需要 Python。
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

TILE = 2048
LEVELS = [8192, 16384]  # 每層寬度；高度 = 寬度 / 2


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open('rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('source', type=Path)
    ap.add_argument('--source-url', default='')
    ap.add_argument('--month', default='', help='NASA 月份標記 YYYY-MM')
    ap.add_argument('--out', type=Path, default=Path('assets/textures/earth_tiles'))
    ap.add_argument('--levels', default=','.join(map(str, LEVELS)), help='逗號分隔的層寬度，例如 8192,16384')
    ap.add_argument('--quality', type=int, default=88)
    ap.add_argument('--synthetic', action='store_true', help='由低解析來源放大產生「合成測試資料」：只供測試管線，manifest 會標示 synthetic_test=true')
    args = ap.parse_args()
    if not args.source.is_file():
        ap.error('來源檔不存在')
    if not args.synthetic and not args.source_url.startswith('https://'):
        ap.error('真實資料必須提供 https 的 --source-url')
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    levels = [int(x) for x in args.levels.split(',') if x]
    args.out.mkdir(parents=True, exist_ok=True)
    with Image.open(args.source) as im0:
        src_size = im0.size
        if src_size[0] != 2 * src_size[1]:
            ap.error(f'來源不是 2:1 等距柱狀投影（{src_size}）')
        if not args.synthetic and src_size[0] < max(levels):
            ap.error(f'來源寬度 {src_size[0]} 小於最高層 {max(levels)}，不得放大冒充高解析（測試請加 --synthetic）')
        src = im0.convert('RGB')
    manifest = {
        'classification': '合成測試資料（由 4K 放大，無真實細節，不得提交或當作高解析）' if args.synthetic else 'NASA 歷史觀測拼接（多日／多月合成），非即時',
        'synthetic_test': bool(args.synthetic),
        'source_file': args.source.name, 'source_url': args.source_url, 'source_month': args.month,
        'source_size': list(src_size), 'source_sha256': sha256(args.source),
        'tile': TILE, 'levels': [],
        'processing': 'Pillow LANCZOS 重新取樣後切塊；不新增或生成地形細節',
        'uv': 'x 由西（u=0）向東、y 由北向南；塊 (x,y) 覆蓋 u∈[x/nx,(x+1)/nx]、v(three, flipY)∈[1-(y+1)/ny, 1-y/ny]',
        'created_utc': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'license': '' if args.synthetic else 'NASA 影像為公眾領域；請註明 NASA Earth Observatory',
    }
    # L0：同一來源的 4096×2048 底圖（L0.jpg），讓各層色調一致；引擎在分塊可用時以它取代既有 4K 底圖
    base = src.resize((4096, 2048), Image.Resampling.LANCZOS)
    base_path = args.out / 'L0.jpg'
    base.save(base_path, 'JPEG', quality=args.quality, optimize=True, subsampling=0)
    manifest['base'] = {'file': 'L0.jpg', 'size': [4096, 2048], 'bytes': base_path.stat().st_size, 'sha256': sha256(base_path)}
    print(f'L0: 4096×2048 底圖 {base_path.stat().st_size / 1e6:.1f} MB')
    del base
    for li, W in enumerate(levels, start=1):
        H = W // 2
        nx, ny = W // TILE, H // TILE
        big = src.resize((W, H), Image.Resampling.LANCZOS)
        files = []
        for y in range(ny):
            for x in range(nx):
                tile = big.crop((x * TILE, y * TILE, (x + 1) * TILE, (y + 1) * TILE))
                name = f'L{li}_{x}_{y}.jpg'
                p = args.out / name
                tile.save(p, 'JPEG', quality=args.quality, optimize=True, subsampling=0)
                files.append({'x': x, 'y': y, 'file': name, 'bytes': p.stat().st_size, 'sha256': sha256(p)})
        manifest['levels'].append({'level': li, 'size': [W, H], 'nx': nx, 'ny': ny, 'files': files})
        total = sum(f['bytes'] for f in files)
        print(f'L{li}: {W}×{H} → {nx}×{ny} 塊，共 {total / 1e6:.1f} MB')
        del big
    (args.out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print('manifest:', args.out / 'manifest.json')


if __name__ == '__main__':
    main()
