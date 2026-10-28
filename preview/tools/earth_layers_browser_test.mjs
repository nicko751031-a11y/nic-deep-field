// 真實分塊候選版驗證；合成資料不可通過。截圖不代表 iPhone 真機。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execSync} from 'node:child_process';
const require=createRequire(import.meta.url);
let pw; try {pw=require('playwright');} catch {pw=require(path.join(execSync('npm root -g').toString().trim(),'playwright'));}
const base=process.argv[2]||'http://127.0.0.1:8123/';
const out=process.argv[3]||'earth-layer-browser';fs.mkdirSync(out,{recursive:true});
const report={environment:'無頭 Chromium / SwiftShader，非 iOS 真機、非硬體 GPU',cases:[]};
const browser=await pw.chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
report.browserVersion=browser.version();
try {
 for(const scenario of [
  {name:'desktop',width:900,height:650,quality:'high',touch:false},
  {name:'mobile-portrait',width:412,height:915,quality:'medium',touch:true},
  {name:'mobile-landscape',width:915,height:412,quality:'medium',touch:true},
  {name:'mobile-polar-budget',width:915,height:412,quality:'medium',touch:true,lat:86,lon:0,polar:true}, // 極區 8 塊匯聚超出 128 MB 硬上限時依設計降到 L1（earthlod 第一道預算），故接受 level≥1
  {name:'missing-tile-fallback',width:720,height:540,quality:'high',touch:false,missing:true}
 ]) {
  const context=await browser.newContext({viewport:{width:scenario.width,height:scenario.height},deviceScaleFactor:1,isMobile:scenario.touch,hasTouch:scenario.touch});
  const page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!(scenario.missing&&/404/.test(m.text()))) errors.push(m.text());});
  if(scenario.missing) await page.route('**/earth_tiles/L2_*.jpg',r=>r.fulfill({status:404,body:'測試刻意缺塊'}));
  await page.goto(`${base}?quality=${scenario.quality}`,{waitUntil:'load',timeout:120000});
  await page.waitForFunction(()=>window.__ndf&&document.getElementById('loading')?.classList.contains('done'),{},{timeout:120000});
  await page.evaluate(async({lat,lon})=>{const n=__ndf;n.controls.stop();n.engine.timeRate=0;n.engine.breath=false;n.engine.setCine(false);n.engine.simTime=Date.parse('2026-10-27T04:00:00Z');n.engine.update(0);await n.testPlaceOver(lat,lon,1800);document.getElementById('btn-hide').click();document.getElementById('title-card').classList.remove('show');},{lat:scenario.lat??23.7,lon:scenario.lon??121});
  await page.waitForFunction(({missing,polar})=>{const s=__ndf.engine.earthLod?.status();return (polar?s?.level>=1:s?.level===2)&&s.loading===0&&(missing?s.failed>0:s.loaded>0);},{missing:!!scenario.missing,polar:!!scenario.polar},{timeout:120000});
  const near=await page.evaluate(()=>{const e=__ndf.engine;return {lod:e.earthLod.status(),shaderErrors:e.shaderErrors,quality:e.quality,cacheBytes:e.earthLod.loadedBytes,budgetBytes:e.earthLod.budgetBytes,cloudOpacity:e.bodies.get('earth').mesh.material.uniforms.uCloudOpacity.value};});
  assert.equal(near.lod.synthetic,false);assert.equal(near.lod.state,'ready');assert.equal(near.shaderErrors.length,0);assert.equal(errors.length,0,JSON.stringify(errors));
  assert.equal(near.cloudOpacity,1);assert.ok(near.cacheBytes<=near.budgetBytes,'分塊快取不得超出預算');
  await page.screenshot({path:path.join(out,`${scenario.name}-clouds-1800km.png`)});
  // 從設定元件觸發，核對完整事件接線，而非直接更改 shader。
  await page.evaluate(()=>{const input=document.getElementById('s-earth-clouds');input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.waitForFunction(()=>{const n=__ndf;return !document.getElementById('earth-layer-note').hidden&&n.engine.earthLod.patches.get(n.engine.earthLod.level).every(p=>p.material.uniforms.uCloudOpacity.value===0);},{},{timeout:60000});
  await page.screenshot({path:path.join(out,`${scenario.name}-surface-1800km.png`)});
  const surface=await page.evaluate(()=>({cloudOpacity:__ndf.engine.bodies.get('earth').mesh.material.uniforms.uCloudOpacity.value,note:document.getElementById('earth-layer-note').textContent}));
  assert.equal(surface.cloudOpacity,0);assert.match(surface.note,/非即時晴空/);
  await page.evaluate(async()=>{await __ndf.testPlaceOver(23.7,121,30000);});
  await page.waitForFunction(()=>__ndf.engine.earthLod.status().level===0,{},{timeout:60000});
  const far=await page.evaluate(()=>__ndf.engine.earthLod.status());
  await page.evaluate(()=>__ndf.earthView.setCloudsVisible(true));
  assert.equal(await page.evaluate(()=>document.getElementById('earth-layer-note').hidden),true);
  assert.equal(errors.length,0,JSON.stringify(errors));
  report.cases.push({name:scenario.name,near,surface,far,errors});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  console.log(scenario.name,JSON.stringify(near));await context.close();
 }
} catch(error) {report.failure=String(error);throw error;} finally {fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();}
