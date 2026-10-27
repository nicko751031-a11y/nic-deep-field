#!/usr/bin/env node
// 量測模組載入瀑布（AUDIT B4）：讀 Resource Timing，列出各 js 模組的 fetchStart 相對 main.js 的時間，
// 並算出「發現層數」（fetchStart 相差 > 20 ms 視為下一層）。用法：node tools/preload_timing.mjs [baseURL]
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process'; import path from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const base = process.argv[2] || 'http://127.0.0.1:8123/';
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
await page.goto(`${base}?quality=low`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
const r = await page.evaluate(() => {
  const es = performance.getEntriesByType('resource').filter((e) => /\/js\/[\w-]+\.js$|three\.module\.js$/.test(e.name)).map((e) => ({ name: e.name.replace(/^.*\/(js|vendor\/three)\//, ''), start: e.fetchStart, end: e.responseEnd })).sort((a, b) => a.start - b.start);
  const t0 = es[0]?.start || 0; let levels = 1; for (let i = 1; i < es.length; i++) if (es[i].start - es[i - 1].start > 20) levels++;
  return { modules: es.map((e) => `${e.name} @${(e.start - t0).toFixed(0)}ms`), levels, lastStart: ((es[es.length - 1]?.start || 0) - t0).toFixed(0), lastEnd: (Math.max(...es.map((e) => e.end)) - t0).toFixed(0), preload: document.querySelectorAll('link[rel=modulepreload]').length };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
