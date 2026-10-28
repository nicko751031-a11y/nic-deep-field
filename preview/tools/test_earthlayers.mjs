// 執行：node --test tools/test_earthlayers.mjs（只用 Node 內建模組）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../js/earthlayers.js', import.meta.url), 'utf8');
const { utcMillis, latestSourceSlot, weatherGate, geoUV, geodeticEcefKm, validateHeightGrid, sampleHeight, WeatherLayerState } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const NOW = Date.parse('2026-10-27T03:00:00Z');
const SLOT = '2026-10-27T02:20:00Z';
const makeFrame = (values = {}) => ({ slot: SLOT, verifiedTime: true, coverageFraction: 0.8, provider: '測試來源（不是實際影像）', ...values });

for (const [value, valid] of [[SLOT,true],['2026-10-27',false],['2026-02-30T00:00:00Z',false],['2026-10-27T02:20:00+08:00',false],['default',false],[null,false],['2026-10-27T25:00:00Z',false]]) {
  test(`UTC 時間嚴格驗證 ${value}`, () => assert.equal(utcMillis(value) !== null, valid));
}
test('依來源區間對齊 10 分鐘，不產生假時刻', () => assert.equal(latestSourceSlot(['2026-10-27T00:00:00Z/2026-10-27T03:00:00Z/PT10M'], NOW-180000), '2026-10-27T02:50:00Z'));
test('拒絕未來時間與不完整日期', () => assert.equal(latestSourceSlot(['2026-10-28T00:00:00Z','2026-10-27'],NOW), null));
test('不以查詢時間補來源空白', () => assert.equal(latestSourceSlot([], NOW), null));
test('倒序與零週期資料不通過', () => assert.equal(latestSourceSlot(['2026-10-27T03:00:00Z/2026-10-27T02:00:00Z/PT10M','2026-10-27T00:00:00Z/2026-10-27T03:00:00Z/PT0M'],NOW), null));
test('非整除端點不冒充觀測時段', () => assert.equal(latestSourceSlot(['2026-10-27T00:00:00Z/2026-10-27T02:37:00Z/PT10M'],NOW),'2026-10-27T02:30:00Z'));
test('最近來源時段可用，但不假稱精確曝光時間', () => assert.deepEqual(weatherGate(SLOT,NOW,NOW,1),{ok:true,ageMs:2400000,productSlotUTC:SLOT,observationInstantUTC:null}));
for (const [label,slot,now,sim,rate] of [['過期','2026-10-27T00:00:00Z',NOW,NOW,1],['未來','2026-10-27T04:00:00Z',NOW,NOW,1],['暫停',SLOT,NOW,NOW,0],['時間加速',SLOT,NOW,NOW,60],['模擬回到過去',SLOT,NOW,NOW-600000,1],['未知',null,NOW,NOW,1],['非法時鐘',SLOT,NaN,NOW,1]]) test(`近即時攔截：${label}`,()=>assert.equal(weatherGate(slot,now,sim,rate).ok,false));
test('台灣 UV 與南美洲不鏡像',()=>{assert.equal(geoUV(0,0).u,.5);assert.ok(geoUV(23.7,121).u>.8);assert.ok(geoUV(-23,-46).u<.5);assert.ok(geoUV(23.7,121).v>.5);});
test('國際換日線銜接',()=>assert.deepEqual(geoUV(0,180),geoUV(0,-180)));
test('非法緯度拒絕',()=>assert.throws(()=>geoUV(91,0),RangeError));
test('公尺高程轉公里，真實 1:1 不誇大',()=>assert.ok(Math.abs(geodeticEcefKm(0,0,1000)[0]-6379.137)<1e-9));
test('正高未提供 geoid 不可當橢球高',()=>assert.throws(()=>geodeticEcefKm(23,121,3000,{datum:'orthometric'}),/大地水準面/));
test('正高加 geoid 轉為橢球高',()=>assert.deepEqual(geodeticEcefKm(0,0,1000,{datum:'orthometric',geoidMetres:25}),geodeticEcefKm(0,0,1025)));
const grid = () => ({ width:2,height:2,transform:[1,0,120,0,-1,25],samples:[100,200,300,400],nodata:-32768,crs:'EPSG:4326',unit:'metres',registration:'pixel-centre' });
test('高程格網規格',()=>assert.equal(validateHeightGrid(grid()).width,2));
test('像素中心不能被當成格網角落',()=>assert.equal(sampleHeight(grid(),24.5,120.5),100));
test('雙線性內插',()=>assert.equal(sampleHeight(grid(),24,121),250));
test('範圍之外不補假高程',()=>assert.equal(sampleHeight(grid(),20,110),null));
test('缺測不填零形成假海平面',()=>{const g=grid();g.samples[0]=-32768;assert.equal(sampleHeight(g,24,121),null);});
test('拒絕無限大高程',()=>{const g=grid();g.samples[0]=Infinity;assert.throws(()=>validateHeightGrid(g));});
test('禁止錯誤座標軸與旋轉格網',()=>{const g=grid();g.transform[4]=1;assert.throws(()=>validateHeightGrid(g));});
test('新鮮圖層成功與停止資源釋放',async()=>{let count=0;const s=new WeatherLayerState({clock:()=>NOW});await s.refresh(async()=>makeFrame({dispose:()=>count++}));assert.equal(s.snapshot().status,'ready');s.stop();assert.equal(count,1);assert.equal(s.snapshot().productSlotUTC,'—');});
test('載入失敗必須清除上一次影像與時間',async()=>{let disposed=false;const s=new WeatherLayerState({clock:()=>NOW});await s.refresh(async()=>makeFrame({dispose:()=>{disposed=true;}}));await s.refresh(async()=>{throw Error('CORS 測試');});assert.equal(disposed,true);assert.equal(s.snapshot().hasFrame,false);assert.equal(s.snapshot().productSlotUTC,'—');assert.equal(s.snapshot().status,'failed');});
test('HTTP 200 缺測圖不算成功',async()=>{const s=new WeatherLayerState({clock:()=>NOW});await s.refresh(async()=>makeFrame({coverageFraction:0}));assert.equal(s.status,'failed');});
test('WMS 時間未能驗證不得顯示近即時',async()=>{const s=new WeatherLayerState({clock:()=>NOW});await s.refresh(async()=>makeFrame({verifiedTime:false}));assert.equal(s.status,'failed');});
test('較慢的舊請求不能覆蓋新請求',async()=>{let resolveOld,count=0;const s=new WeatherLayerState({clock:()=>NOW});const old=s.refresh(()=>new Promise(r=>{resolveOld=r;}));await s.refresh(async()=>makeFrame({slot:'2026-10-27T02:40:00Z'}));resolveOld(makeFrame({dispose:()=>count++}));await old;assert.equal(s.frame.slot,'2026-10-27T02:40:00Z');assert.equal(count,1);});
test('停止後即使請求完成也不能復活圖層',async()=>{let done,disposed=0;const s=new WeatherLayerState({clock:()=>NOW});const task=s.refresh(()=>new Promise(r=>{done=r;}));s.stop();done(makeFrame({dispose:()=>disposed++}));await task;assert.equal(s.frame,null);assert.equal(disposed,1);});
test('已顯示影像過期後撤下',async()=>{let t=NOW;const s=new WeatherLayerState({clock:()=>t});await s.refresh(async()=>makeFrame());t+=3600000;s.tick();assert.equal(s.frame,null);assert.equal(s.status,'unavailable');});
test('使用者時間加速時撤下近即時圖層',async()=>{let rate=1;const s=new WeatherLayerState({clock:()=>NOW,simulation:()=>({nowMs:NOW,timeRate:rate})});await s.refresh(async()=>makeFrame());rate=60;s.tick();assert.equal(s.snapshot().hasFrame,false);});
