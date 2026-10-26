// 瀏覽器驗收：測試注入的時間與錯誤僅用於測試，不提交作近即時資料。
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {execSync} from 'node:child_process';
const require=createRequire(import.meta.url);let pw;try{pw=require('playwright');}catch{pw=require(path.join(execSync('npm root -g').toString().trim(),'playwright'));}
const base=process.argv[2]||'http://127.0.0.1:8123/',out=process.argv[3]||'earth-terrain-browser';fs.mkdirSync(out,{recursive:true});
const report={environment:'Chromium SwiftShader；裝置尺寸模擬，不是 iPhone 真機',cases:[]};
const browser=await pw.chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 for(const spec of [{name:'desktop',width:1100,height:760},{name:'phone-portrait',width:412,height:915,touch:true},{name:'phone-landscape',width:915,height:412,touch:true}]){
  const context=await browser.newContext({viewport:{width:spec.width,height:spec.height},deviceScaleFactor:1,isMobile:!!spec.touch,hasTouch:!!spec.touch});const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram|GL_INVALID/i.test(m.text()))errors.push(m.text());});
  await page.goto(base+'earth-layers.html',{waitUntil:'load',timeout:120000});await page.waitForFunction(()=>window.__arcLayers,{},{timeout:60000});
  const geometry=await page.evaluate(()=>{const s=__arcLayers;return {metadata:s.geometry.userData,positionFinite:[...s.geometry.attributes.position.array].every(Number.isFinite),normalFinite:[...s.geometry.attributes.normal.array].every(Number.isFinite),cameraY:s.camera.position.y,texture:s.mesh.material.map.image.width};});
  assert.equal(geometry.positionFinite,true);assert.equal(geometry.normalFinite,true);assert.equal(geometry.metadata.heightExaggeration,1);assert.ok(geometry.cameraY>=100);assert.equal(geometry.texture,360);
  await page.screenshot({path:path.join(out,spec.name+'-terrain.png')});
  await page.click('#archive');await page.waitForFunction(()=>__arcLayers.mode==='archive'&&document.getElementById('status').textContent.includes('歷史驗證快照'));await page.screenshot({path:path.join(out,spec.name+'-archive.png')});
  await page.click('#surface');assert.equal(await page.evaluate(()=>__arcLayers.mode),'surface');
  const controls=await page.locator('.actions > *').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};}));
  for(const b of controls){assert.ok(b.h>=44);assert.ok(b.x>=0&&b.x+b.w<=spec.width+1);}
  for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){const a=controls[i],b=controls[j];assert.ok(Math.min(a.x+a.w,b.x+b.w)<=Math.max(a.x,b.x)+1||Math.min(a.y+a.h,b.y+b.h)<=Math.max(a.y,b.y)+1);}
  // 實際來源連線測試：來源停機時允許明示失敗，不以假圖讓測試變綠。
  await page.click('#live');await page.waitForFunction(()=>['ready','failed','unavailable'].includes(__arcLayers.state.status),{},{timeout:45000});
  const actual=await page.evaluate(()=>__arcLayers.state.snapshot());
  if(actual.status==='ready')assert.equal(actual.isNearRealtime,true);else{assert.equal(actual.productSlotUTC,'—');assert.equal(actual.hasFrame,false);}
  await page.screenshot({path:path.join(out,spec.name+'-live.png')});
  // 注入 HTTP 503，確認之前的成功圖像會撤下，而不是偷偷沿用快照。
  await page.route('https://gibs.earthdata.nasa.gov/**',r=>r.fulfill({status:503,body:'測試刻意模擬來源失敗',headers:{'Access-Control-Allow-Origin':'*'}}));
  await page.evaluate(()=>__arcLayers.refreshLive());
  const failed=await page.evaluate(()=>({state:__arcLayers.state.snapshot(),hasMap:!!__arcLayers.mesh.material.map}));
  assert.equal(failed.state.hasFrame,false);assert.equal(failed.state.productSlotUTC,'—');assert.equal(failed.hasMap,false);
  await page.click('#surface');assert.equal(errors.length,0,JSON.stringify(errors));
  report.cases.push({name:spec.name,geometry,actualSource:actual,injectedFailure:failed,controlCount:controls.length,errors});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await context.close();
 }
}catch(e){report.failure=String(e);throw e;}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();}
