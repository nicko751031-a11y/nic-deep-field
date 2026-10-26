import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const terrainSource=fs.readFileSync(new URL('../js/earthterrain.js',import.meta.url),'utf8')
 .replace("'three'",JSON.stringify(new URL('../vendor/three/three.module.js',import.meta.url).href))
 .replace("'./earthlayers.js'",JSON.stringify(new URL('../js/earthlayers.js',import.meta.url).href));
const {createTerrainGeometry}=await import('data:text/javascript;base64,'+Buffer.from(terrainSource).toString('base64'));
const {verifyWeatherHeaders,WEATHER_SOURCE}=await import('../js/earthweather.js');
const grid=(datum,height=10)=>({width:3,height:3,transform:[.1,0,120.85,0,-.1,23.65],samples:new Float32Array(9).fill(height),nodata:-32768,unit:'metres',registration:'pixel-centre',crs:'EPSG:4326',heightDatum:datum,sourceResolutionArcsec:60});
const surface=()=>grid('EGM2008'), geoid=()=>grid('EGM2008-undulation',20);
test('真實高度與曲率輸出有限座標／法線、正面向上',()=>{const g=createTerrainGeometry(surface(),geoid(),{centerLat:23.5,centerLon:121,stride:1});assert.equal(g.index.count,24);assert.equal(g.userData.heightExaggeration,1);for(const n of g.attributes.position.array)assert.ok(Number.isFinite(n));for(let i=1;i<g.attributes.normal.array.length;i+=3)assert.ok(g.attributes.normal.array[i]>.99);g.dispose();});
test('高度增加1000公尺，中心幾何只增加1公里',()=>{const opts={centerLat:23.5,centerLon:121,stride:1};const a=createTerrainGeometry(grid('EGM2008',0),geoid(),opts),b=createTerrainGeometry(grid('EGM2008',1000),geoid(),opts);assert.ok(Math.abs(b.attributes.position.getY(4)-a.attributes.position.getY(4)-1)<1e-6);a.dispose();b.dispose();});
test('海床不當成暴露陸地：負高程顯示海面',()=>{const opts={centerLat:23.5,centerLon:121,stride:1};const a=createTerrainGeometry(grid('EGM2008',-5000),geoid(),opts),b=createTerrainGeometry(grid('EGM2008',0),geoid(),opts);assert.deepEqual(a.attributes.position.array,b.attributes.position.array);a.dispose();b.dispose();});
test('缺測區不產生假地形三角形',()=>{const h=surface();h.samples[0]=-32768;const g=createTerrainGeometry(h,geoid(),{centerLat:23.5,centerLon:121,stride:1});assert.equal(g.userData.missingVertices,1);assert.ok(g.index.count<24);g.dispose();});
for(const [name,change] of [ ['不明高程基準',h=>h.heightDatum='unknown'],['旋轉格網',h=>h.transform[1]=1],['非有限高程',h=>h.samples[2]=NaN],['錯誤單位',h=>h.unit='km'] ])test(name+'被拒絕',()=>{const h=surface();change(h);assert.throws(()=>createTerrainGeometry(h,geoid(),{centerLat:23.5,centerLon:121}));});
test('不一致的大地水準面格網被拒絕',()=>{const n=geoid();n.transform[2]+=.01;assert.throws(()=>createTerrainGeometry(surface(),n));});
for(const stride of [0,9,1.5])test('錯誤採樣步長'+stride,()=>assert.throws(()=>createTerrainGeometry(surface(),geoid(),{stride})));
const now=Date.parse('2026-10-27T04:00:00Z'),slot='2026-10-27T03:20:00Z';
const headers=()=>new Headers({'Layer-Time-Request':slot,'Layer-Time-Actual':slot,'Layer-Identifier-Actual':WEATHER_SOURCE.id+'_v0_NRT'});
test('原生WMTS實際時間與產品皆核對才通過',()=>assert.equal(verifyWeatherHeaders(headers(),slot,now).slot,slot));
for(const key of ['Layer-Time-Request','Layer-Time-Actual','Layer-Identifier-Actual'])test('缺少'+key+'拒絕顯示',()=>{const h=headers();h.delete(key);assert.throws(()=>verifyWeatherHeaders(h,slot,now));});
test('時間吸附到舊圖被拒絕',()=>{const h=headers();h.set('Layer-Time-Actual','2026-10-26T03:20:00Z');assert.throws(()=>verifyWeatherHeaders(h,slot,now));});
test('其他衛星產品被拒絕',()=>{const h=headers();h.set('Layer-Identifier-Actual','wrong');assert.throws(()=>verifyWeatherHeaders(h,slot,now));});
test('已過期產品被拒絕',()=>assert.throws(()=>verifyWeatherHeaders(headers(),slot,now+7200000)));
test('來源時段在未來被拒絕',()=>assert.throws(()=>verifyWeatherHeaders(headers(),slot,now-7200000)));
