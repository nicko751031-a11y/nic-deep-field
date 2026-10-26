// WebAudio 啟動狀態測試（node --test tools/test_audio.mjs）：以可控的假 AudioContext 驗證
// resume() 成功／拒絕／持續 suspended／逾時、切換與停止時節點釋放、連續切換 20 次無堆積、無未處理 rejection。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpaceAudio } from '../js/audio.js';

class Param { constructor(v = 0) { this.value = v; } linearRampToValueAtTime() {} setValueAtTime() {} }
class Node { constructor(ctx) { this.ctx = ctx; this.gain = new Param(1); this.frequency = new Param(440); this.detune = new Param(0); this.Q = new Param(1); this.threshold = new Param(); this.knee = new Param(); this.ratio = new Param(); this.attack = new Param(); this.release = new Param(); this.started = false; this.stopped = false; this.connected = 0; }
  connect() { this.connected++; return this; } disconnect() { this.connected = 0; } start() { this.started = true; this.ctx.live++; } stop() { if (this.started && !this.stopped) { this.stopped = true; this.ctx.live--; } } }
function makeCtx({ state = 'suspended', resume } = {}) {
  const ctx = { state, sampleRate: 44100, currentTime: 0, destination: {}, live: 0, created: 0, onstatechange: null };
  const mk = () => { ctx.created++; return new Node(ctx); };
  ctx.createGain = mk; ctx.createOscillator = mk; ctx.createBufferSource = mk; ctx.createBiquadFilter = mk; ctx.createDynamicsCompressor = mk;
  ctx.createBuffer = (ch, len, sr) => ({ getChannelData: () => new Float32Array(len), length: len, sampleRate: sr });
  ctx.resume = resume || (() => { ctx.state = 'running'; return Promise.resolve(); });
  return ctx;
}
const make = (opts) => { const ctx = makeCtx(opts); const a = new SpaceAudio({ AudioContextClass: function () { return ctx; } }); return { a, ctx }; };
let unhandled = 0; process.on('unhandledRejection', () => { unhandled++; });

test('resume 成功：running 才回報播放中，節點已建立', async () => {
  const { a, ctx } = make(); const r = await a.start('ambient');
  assert.equal(r.ok, true); assert.equal(r.mode, 'ambient'); assert.equal(ctx.state, 'running'); assert.ok(a.nodes.length > 0); assert.ok(ctx.live > 0);
});
test('resume 被拒絕：保持 off、無節點、無未處理 rejection', async () => {
  const { a, ctx } = make({ resume: () => Promise.reject(new Error('NotAllowedError')) });
  const r = await a.start('ambient');
  assert.equal(r.ok, false); assert.equal(a.mode, 'off'); assert.equal(a.nodes.length, 0); assert.equal(ctx.live, 0); assert.match(r.reason, /NotAllowedError/);
});
test('resume 解析但仍 suspended：不回報播放中', async () => {
  const { a } = make({ resume: () => Promise.resolve() });
  const r = await a.start('organ'); assert.equal(r.ok, false); assert.equal(r.state, 'suspended'); assert.equal(a.mode, 'off'); assert.equal(a.nodes.length, 0);
});
test('resume 永不解析：3 秒逾時回報失敗（以假計時測試邏輯：延遲 3.2 秒）', { timeout: 6000 }, async () => {
  const { a } = make({ resume: () => new Promise(() => {}) });
  const t0 = Date.now(); const r = await a.start('arc'); assert.equal(r.ok, false); assert.match(r.reason, /逾時/); assert.ok(Date.now() - t0 >= 2900); assert.equal(a.nodes.length, 0);
});
test('切換音景與停止：舊節點全部停止釋放，連續切換 20 次無堆積', async () => {
  const { a, ctx } = make();
  const modes = ['ambient', 'organ', 'arc', 'sonify'];
  let maxLive = 0;
  for (let i = 0; i < 20; i++) { const r = await a.start(modes[i % 4]); assert.equal(r.ok, true); maxLive = Math.max(maxLive, ctx.live); }
  const liveAfterLast = ctx.live; assert.ok(liveAfterLast > 0 && liveAfterLast <= 80, `目前存活節點 ${liveAfterLast}`);
  assert.ok(maxLive <= 80, `切換過程存活節點峰值 ${maxLive} 應不超過單一音景`);
  await a.start('off'); assert.equal(ctx.live, 0); assert.equal(a.mode, 'off'); assert.equal(a.nodes.length, 0);
});
test('較晚的啟動取代較早未完成的啟動：不疊加節點', async () => {
  let resolveFirst; let n = 0;
  const { a, ctx } = make({ resume: () => { n++; return n === 1 ? new Promise((res) => { resolveFirst = () => { ctx.state = 'running'; res(); }; }) : (ctx.state = 'running', Promise.resolve()); } });
  const p1 = a.start('ambient'); const p2 = a.start('organ'); resolveFirst();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1.ok, false); assert.equal(r2.ok, true); assert.equal(a.mode, 'organ');
});
test('系統把 context 暫停（iOS interrupted）：回到 off 並通知', async () => {
  const { a, ctx } = make(); const events = []; a.onState = (s) => events.push(s);
  await a.start('ambient'); ctx.state = 'interrupted'; ctx.onstatechange();
  assert.equal(a.mode, 'off'); assert.equal(ctx.live, 0); assert.equal(events.length, 1); assert.equal(events[0].ok, false);
});
test('沒有 WebAudio：回報不支援', async () => { const a = new SpaceAudio({ AudioContextClass: null }); const r = await a.start('ambient'); assert.equal(r.ok, false); assert.equal(r.state, 'unsupported'); });
test('整體沒有未處理的 Promise rejection', async () => { await new Promise((r) => setTimeout(r, 50)); assert.equal(unhandled, 0); });

// --- GPT 稽核補充：resume 等待期間的取消／切換（直接呼叫 start()）
const delayed = (ctx, ms) => () => new Promise((res) => setTimeout(() => { ctx.state = 'running'; res(); }, ms));
test('resume 延遲時「播放→停止」最終 off、節點 0，逾時後不會突然播放', async () => {
  const ctx = makeCtx(); ctx.resume = delayed(ctx, 300); const a = new SpaceAudio({ AudioContextClass: function () { return ctx; } });
  const p = a.start('ambient'); await new Promise((r) => setTimeout(r, 50)); const r2 = await a.start('off');
  const r1 = await p; await new Promise((r) => setTimeout(r, 400));
  assert.equal(r2.ok, true); assert.equal(r1.ok, false); assert.equal(a.mode, 'off'); assert.equal(ctx.live, 0); assert.equal(a.nodes.length, 0);
});
test('resume 延遲時「ambient→organ」最後只播 organ', async () => {
  const ctx = makeCtx(); ctx.resume = delayed(ctx, 300); const a = new SpaceAudio({ AudioContextClass: function () { return ctx; } });
  const p1 = a.start('ambient'); await new Promise((r) => setTimeout(r, 50)); const p2 = a.start('organ');
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1.ok, false); assert.equal(r2.ok, true); assert.equal(a.mode, 'organ'); assert.ok(ctx.live > 10 && ctx.live <= 80);
});
test('resume 延遲時快速切換 20 次：最後一個獲勝、無多重音源', async () => {
  const ctx = makeCtx(); ctx.resume = delayed(ctx, 200); const a = new SpaceAudio({ AudioContextClass: function () { return ctx; } });
  const modes = ['ambient', 'organ', 'arc', 'sonify', 'off']; const ps = [];
  for (let i = 0; i < 20; i++) { ps.push(a.start(modes[i % 5])); await new Promise((r) => setTimeout(r, 5)); }
  const rs = await Promise.all(ps); await new Promise((r) => setTimeout(r, 300));
  assert.equal(rs.filter((r) => r.ok).length >= 1, true); assert.equal(a.mode, 'off'); assert.equal(ctx.live, 0); assert.equal(a.nodes.length, 0);
});
