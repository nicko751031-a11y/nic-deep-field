#!/usr/bin/env node
// index.html 的 <link rel="modulepreload"> 清單必須與 main.js 的靜態 import 圖一致（AUDIT B4）：
// 少了會回到逐層瀑布，多了會下載沒用到的檔案或 404。動態 import（diag.js）不在清單內。用法：node --test tools/test_modulepreload.mjs
import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
function importGraph(entry) {
  const seen = new Set(); const stack = [entry];
  while (stack.length) {
    const f = stack.pop(); if (seen.has(f)) continue; seen.add(f);
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of src.matchAll(/^\s*import[^'"]*['"](\.\/[\w./-]+\.js)['"]/gm)) {
      const dep = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1])); if (!seen.has(dep)) stack.push(dep);
    }
  }
  seen.delete(entry); return [...seen].sort();
}
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const links = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]).sort();
const expected = ['vendor/three/three.module.js', ...importGraph('js/main.js')].sort();
test('modulepreload 清單 = main.js 靜態 import 圖 + three.module.js', () => {
  assert.deepEqual(links, expected, `清單與 import 圖不一致\n多出：${links.filter((l) => !expected.includes(l)).join(', ') || '—'}\n缺少：${expected.filter((e) => !links.includes(e)).join(', ') || '—'}`);
});
test('每個預載檔案都存在', () => {
  for (const l of links) assert.ok(fs.existsSync(path.join(root, l)), `找不到 ${l}`);
});
test('importmap 位於所有預載標籤之前（否則快取命中時裸名 three 解析失敗、頁面停在初始化）', () => {
  assert.ok(html.indexOf('<script type="importmap">') < html.indexOf('rel="modulepreload"'));
});
