#!/usr/bin/env node
// 著色器靜態檢查（A2 iPhone 黑色扇形根因）：GLSL 的 pow(x, y) 在 x < 0 時未定義，Apple GPU 回傳 NaN，
// 經 safeColor 歸零就是整片純黑（夜側、暗側大氣）。規則：每個 pow( 的底數必須是 max(…)/clamp(…)/abs(…)/sq(…)/正數字面值，
// 或該行帶 `pow-ok` 註記（註明為何 ≥ 0）；平方請用 sqr(x)。用法：node --test tools/test_shader_pow.mjs
import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'js', 'shaders.js'), 'utf8');
const lines = src.split('\n');
const offenders = [];
for (const [i, line] of lines.entries()) {
  if (/^\s*\/\//.test(line)) continue; // 純註解行
  const code = line.split('//')[0];
  let m; const re = /\bpow\(/g;
  while ((m = re.exec(code))) {
    const rest = code.slice(m.index + 4);
    const safe = /^\s*(max|clamp|abs|sqr)\s*\(/.test(rest) || /^\s*\d/.test(rest) || /pow-ok/.test(line) || /float sqr\(float x\)|pow\(x, y\)/.test(line);
    if (!safe) offenders.push(`${i + 1}: ${line.trim().slice(0, 110)}`);
  }
}
test('shaders.js 的 pow() 底數皆保證 ≥ 0（Apple GPU 不得產生 NaN）', () => {
  assert.deepEqual(offenders, [], `未防護的 pow 底數：\n${offenders.join('\n')}`);
});
test('夜側晨昏線用 sqr() 而非 pow(負數, 2.0)', () => {
  assert.ok(!/pow\(\s*ndl0?\s*\/\s*0\.\d+\s*,\s*2\.0\s*\)/.test(src), '仍有 pow(ndl / c, 2.0)');
  assert.ok(src.includes('float sqr(float x) { return x * x; }'), 'SAFE_GLSL 缺 sqr()');
});
