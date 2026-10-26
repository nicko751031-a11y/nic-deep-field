// 使用實際 EarthLod 方法驗證資源預算；只有 THREE 建構環境與下載器以測試物件代替。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
let source=readFileSync(new URL('../js/earthlod.js',import.meta.url),'utf8').replace("import * as THREE from 'three';",'const THREE = {};');
const {EarthLod}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const SIZE=2048*2048*4*1.34;
function setup(){
 const e=Object.create(EarthLod.prototype), pending=[];
 Object.assign(e,{tiles:new Map(),patches:new Map(),loadedBytes:0,loading:0,failed:0,frame:100,budgetBytes:128e6,manifest:{tile:2048},engine:{maxAniso:1,textures:{},bodies:new Map()},loader:{load:(url,done,_progress,fail)=>pending.push({url,done,fail})}});
 return {e,pending};
}
const patch=k=>({userData:{key:k,file:k}});
const texture=()=>({image:{width:2048,height:2048},dispose(){this.disposed=true;}});
test('排隊中的貼圖也計入128MB額度',()=>{const {e,pending}=setup();for(let i=0;i<20;i++)e._load(patch(String(i)));assert.equal(pending.length,5);assert.ok(e.loadedBytes+e.loading*SIZE<=e.budgetBytes);});
test('下載完成不會偷偷突破預算',()=>{const {e,pending}=setup();for(let i=0;i<5;i++)e._load(patch(String(i)));for(const p of pending)p.done(texture());assert.equal(e.loading,0);assert.equal(e.loadedBytes,5*SIZE);e._load(patch('extra'));assert.equal(pending.length,5);});
test('舊且不在視野中的塊可以釋放以騰出新請求',()=>{const {e,pending}=setup();const old=[];for(let i=0;i<5;i++){const tex=texture();old.push(tex);e.tiles.set('old'+i,{state:'ok',tex,bytes:SIZE,lastUse:0});}e.loadedBytes=5*SIZE;e._load(patch('new'));assert.equal(pending.length,1);assert.ok(old.some(t=>t.disposed));assert.ok(e.loadedBytes+e.loading*SIZE<=e.budgetBytes);});
test('目前可見塊不能被逐出形成反覆下載',()=>{const {e,pending}=setup();for(let i=0;i<5;i++)e.tiles.set('old'+i,{state:'ok',tex:texture(),bytes:SIZE,lastUse:100});e.loadedBytes=5*SIZE;e._load(patch('new'));assert.equal(pending.length,0);assert.equal(e.tiles.size,5);});
test('下載失敗釋放排隊額度且保留失敗標記',()=>{const {e,pending}=setup();e._load(patch('a'));pending[0].fail();assert.equal(e.loading,0);assert.equal(e.loadedBytes,0);assert.equal(e.tiles.get('a').state,'failed');});
test('錯誤尺寸不能上傳GPU且釋放貼圖物件',()=>{const {e,pending}=setup();e._load(patch('a'));const tex=texture();tex.image.width=1024;pending[0].done(tex);assert.equal(tex.disposed,true);assert.equal(e.loadedBytes,0);assert.equal(e.loading,0);});
test('底圖切換時所有材質指向新圖、舊圖被釋放',()=>{const {e,pending}=setup();const old=texture();const u={uDay:{value:old}};const earth={def:{textures:{day:'earth.jpg'}},mesh:{material:{uniforms:u}}};e.engine.bodies.set('earth',earth);e.engine.textures['earth.jpg']=old;const pu={uDay:{value:old}};e.patches.set(2,[{material:{uniforms:pu}}]);e._loadBase('L0.jpg');const tex=texture();pending[0].done(tex);assert.equal(u.uDay.value,tex);assert.equal(pu.uDay.value,tex);assert.equal(e.engine.textures['earth.jpg'],tex);assert.equal(old.disposed,true);});
test('地球已卸載時不保留孤立底圖',()=>{const {e,pending}=setup();e._loadBase('L0.jpg');const tex=texture();pending[0].done(tex);assert.equal(tex.disposed,true);});
