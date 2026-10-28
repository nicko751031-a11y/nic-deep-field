#!/usr/bin/env python3
"""由 index.html 產生 Claude Artifact 用的 artifact.html（不含 doctype/html/head/body 外殼；標題與 import map 放最前面）。"""
import re, sys, pathlib
src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'space/index.html').read_text(encoding='utf-8')
head = re.search(r'<head>(.*?)</head>', src, re.S).group(1)
body = re.search(r'<body>(.*?)</body>', src, re.S).group(1)
title = re.search(r'<title>.*?</title>', head).group(0)
link = re.search(r'<link rel="stylesheet"[^>]*>', head).group(0)
importmap = re.search(r'<script type="importmap">.*?</script>', head, re.S).group(0)
out = f"""{title}
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="ARC：第一人稱、真實比例、可自由飛行的網頁 3D 宇宙探索（測試版）。">
{link}
<style>:root{{padding:0 !important}} body{{background:#000}}</style>
{importmap}
{body}"""
dst = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else 'space/artifact.html')
dst.write_text(out, encoding='utf-8')
print('wrote', dst, len(out), 'bytes')
