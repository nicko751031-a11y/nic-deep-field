#!/usr/bin/env python3
"""由 NASA Tycho 全天圖取出「瀰漫銀河成分」，產生 assets/textures/milkyway_diffuse_2048.jpg。

Tycho 全天圖（2880×1440，赤道座標等距圓柱投影）的銀河其實是密集星點的集合，整張圖又極暗
（平均 4/255），直接當背景幾乎看不見。本工具：
  1. 中值濾波（7 px）去掉個別星點，留下星點密度形成的瀰漫帶；
  2. 高斯模糊：6 px（≈ 0.75°，保留星雲與暗帶結構）與 16 px（整體光暈）各半混合，避免棉絮狀斑塊；
  3. 減去底噪 FLOOR（銀河帶以外的零星星點殘留，否則 γ 壓縮後整個天空蒙一層灰霧）、
     亮度壓縮 γ=0.75（壓低星團斑塊與暗隙的對比，接近長曝光照片的平滑銀河），
     色度另以 40 px 大範圍模糊後再合回（去掉 JPEG 來源的彩色雜訊，只留銀河整體的暖色），
     再乘以固定增益 GAIN（避免 8 位元 JPEG 量化成 0–27 的色階斷層），著色器再除回；
  4. 縮到 2048×1024、JPEG 品質 92、不做色度抽樣。
來源仍是 NASA 的觀測資料（公眾領域），分類為「實際觀測影像處理」，不是程序生成。
用法：python3 -I tools/build_milkyway.py [--src assets/textures/tycho_skymap_2880.jpg] [--out assets/textures/milkyway_diffuse_2048.jpg]
"""
import argparse, hashlib, json, os, sys
from PIL import Image, ImageFilter
import numpy as np

GAIN = 6.0
MEDIAN = 7
BLUR = 6.0
BLUR2 = 16.0
GAMMA = 0.75
FLOOR = 1.5
CHROMA_BLUR = 40.0
SIZE = (2048, 1024)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default='assets/textures/tycho_skymap_2880.jpg')
    ap.add_argument('--out', default='assets/textures/milkyway_diffuse_2048.jpg')
    a = ap.parse_args()
    im = Image.open(a.src).convert('RGB')
    med = im.filter(ImageFilter.MedianFilter(MEDIAN))
    a1 = np.asarray(med.filter(ImageFilter.GaussianBlur(BLUR)), dtype=np.float32)
    a2 = np.asarray(med.filter(ImageFilter.GaussianBlur(BLUR2)), dtype=np.float32)
    arr = 0.5 * a1 + 0.5 * a2
    lum = arr.mean(axis=2)
    # 色度：大範圍模糊後的顏色比例（避免彩色雜訊），再乘回亮度
    chroma_src = Image.fromarray(np.clip(arr * 4, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(CHROMA_BLUR))
    cb = np.asarray(chroma_src, dtype=np.float32); cl = cb.mean(axis=2, keepdims=True) + 1e-3
    chroma = np.clip(cb / cl, 0.6, 1.6)
    lum = np.maximum(lum - FLOOR, 0.0)
    lum = np.power(np.clip(lum / 255.0, 0, 1), GAMMA) * 255.0
    out_arr = lum[:, :, None] * chroma
    boosted = np.clip(out_arr * GAIN, 0, 255).astype(np.uint8)
    out = Image.fromarray(boosted).resize(SIZE, Image.LANCZOS)
    os.makedirs(os.path.dirname(a.out) or '.', exist_ok=True)
    out.save(a.out, quality=92, subsampling=0)
    L = np.asarray(out.convert('L'), dtype=np.float32)
    sha = hashlib.sha256(open(a.out, 'rb').read()).hexdigest()
    print(json.dumps({
        'src': a.src, 'out': a.out, 'size': SIZE, 'gain': GAIN, 'median': MEDIAN, 'blur': BLUR, 'blur2': BLUR2, 'gamma': GAMMA, 'floor': FLOOR, 'chroma_blur': CHROMA_BLUR,
        'bytes': os.path.getsize(a.out), 'sha256': sha,
        'luma_p50': float(np.percentile(L, 50)), 'luma_p90': float(np.percentile(L, 90)), 'luma_p99': float(np.percentile(L, 99)), 'luma_max': float(L.max()),
    }, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    sys.exit(main())
