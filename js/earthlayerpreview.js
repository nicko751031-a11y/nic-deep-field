// 地形與氣象驗證入口：仍採既有 vendored three.js；不改主站飛行與星曆。
import * as THREE from 'three';
import { createTerrainGeometry, loadHeightGrid } from './earthterrain.js';
import { WeatherLayerState } from './earthlayers.js';
import { loadHimawariTaiwan, WEATHER_SOURCE } from './earthweather.js';
const $=id=>document.getElementById(id);
async function start(){
  const canvas=$('terrain'), renderer=new THREE.WebGLRenderer({canvas,antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x04080c);
  const camera=new THREE.PerspectiveCamera(48,1,0.1,5000);
  const resize=()=>{renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();};resize();addEventListener('resize',resize);
  const path='assets/earth_layers/';
  const [h,n]=await Promise.all([loadHeightGrid(path+'taiwan-etopo60s.json'),loadHeightGrid(path+'taiwan-geoid60s.json')]);
  const geometry=createTerrainGeometry(h,n,{stride:matchMedia('(pointer:coarse)').matches?2:1});
  const loader=new THREE.TextureLoader(),day=await loader.loadAsync(path+'taiwan-nasa-200407.jpg');
  day.colorSpace=THREE.SRGBColorSpace;day.anisotropy=renderer.capabilities.getMaxAnisotropy();
  const mat=new THREE.MeshStandardMaterial({map:day,roughness:1,metalness:0});const mesh=new THREE.Mesh(geometry,mat);scene.add(mesh);
  // 為顯示坡面使用固定展示照明；不是當下太陽方位，也不是實際攝影。
  scene.add(new THREE.HemisphereLight(0xc8def3,0x2b2b25,0.65));
  const sun=new THREE.DirectionalLight(0xfff7e8,2.2);sun.position.set(-250,180,-170);scene.add(sun);
  let azimuth=.25,elevation=.56,distance=420,down=null,snapshotTexture=null,mode='surface',sequence=0;
  let liveTexture=null,disposed=false,lastRefresh=0;
  const apply=(texture,emissive=false)=>{mat.map=texture;mat.emissiveMap=emissive?texture:null;mat.emissive.setScalar(emissive?1:0);mat.color.setScalar(emissive?0:1);mat.needsUpdate=true;};
  const clearLive=()=>{if(liveTexture){apply(null);liveTexture.dispose();liveTexture=null;}};
  const showTime=()=>{if(state.status==='ready'&&state.frame){const slot=state.frame.slot;const age=Math.floor((Date.now()-Date.parse(slot))/60000);$('status').textContent='近即時紅外線（非真彩色、非雲高） · '+slot+'（UTC） · 延遲 '+age+' 分鐘 · 每10分鐘檢查';}};
  const state=new WeatherLayerState({onChange(s){
    if(mode!=='live'||disposed)return;
    clearLive();
    if(s.status==='ready'){
      liveTexture=new THREE.CanvasTexture(state.frame.canvas);liveTexture.colorSpace=THREE.SRGBColorSpace;apply(liveTexture,true);
      const date=new Date(s.productSlotUTC);showTime();
      $('source').textContent=WEATHER_SOURCE.classification+'\n來源：'+s.provider+'\n實際產品時段：'+s.productSlotUTC+'\n台灣時間：'+date.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})+'\n逐像素曝光時間未知；此圖層不是即時影片。地形高度只來自NOAA，不是氣象影像推算。';
    } else {
      apply(null);$('status').textContent=s.status==='loading'?'讀取衛星來源時間及影像…':'近即時氣象不可用 · 時間：—';
      $('source').textContent=(s.reason||'尚無經時間核對的影像')+'\n已撤下氣象圖；沒有切換成舊快照。';
    }
    $('error').textContent=['failed','unavailable'].includes(s.status)?s.reason:'';
  }});
  const refreshLive=()=>{lastRefresh=Date.now();return state.refresh(loadHimawariTaiwan);};
  async function setMode(next){
    if(!['surface','archive','live'].includes(next))throw Error('未知圖層');
    const seq=++sequence;mode=next;state.stop();clearLive();$('error').textContent='';
    for(const id of ['surface','archive','live'])$(id).setAttribute('aria-pressed',String(id===next));
    if(next==='live'){apply(null);await refreshLive();return;}
    if(next==='archive'){
      apply(null);$('status').textContent='載入已標示的驗證快照…';
      try{
        const r=await fetch(path+'weather-snapshot.json');if(!r.ok)throw Error('快照來源紀錄缺失');const info=await r.json();
        if(info.isNearRealtime!==false||info.displayMode!=='archive-test-snapshot')throw Error('快照分類錯誤');
        if(!snapshotTexture){const tex=await loader.loadAsync(path+'himawari-audit-snapshot.png');tex.colorSpace=THREE.SRGBColorSpace;if(disposed||seq!==sequence){tex.dispose();return;}snapshotTexture=tex;}
        if(seq!==sequence)return;apply(snapshotTexture,true);
        $('status').textContent='歷史驗證快照 · 非近即時 · 非真彩色';
        $('source').textContent='10.3 微米紅外線快照；非真彩色，非雲高。\n請求產品時段：'+info.product_slot_utc+'\nWMS 實際回傳時段未獨立確認；此圖只用於對位驗證，永不當作近即時備援。';
      }catch(e){if(seq===sequence){apply(null);$('status').textContent='快照載入失敗 · 時間：—';$('error').textContent=e.message;}}
    }else{
      apply(day);$('status').textContent='地表重建 · 高度 1:1 · '+geometry.userData.triangles.toLocaleString()+' 個三角形';
      $('source').textContent='NASA Blue Marble 2004-07 歷史合成，裁切原圖而非上採樣。NOAA ETOPO2022 60角秒高程；EGM2008 正高＋大地水準面起伏轉 WGS84 橢球高。海域顯示海面，照明為固定展示照明（非當下太陽）。';
    }
  }
  function position(){const d=Math.max(160,distance),minAngle=Math.asin(Math.min(.95,105/d));elevation=Math.max(minAngle,Math.min(1.4,elevation));camera.position.set(d*Math.sin(azimuth)*Math.cos(elevation),d*Math.sin(elevation),d*Math.cos(azimuth)*Math.cos(elevation));camera.lookAt(0,0,-20);}
  position();const points=new Map();let pinch=null;
  canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);points.set(e.pointerId,[e.clientX,e.clientY]);down=[e.clientX,e.clientY];});
  canvas.addEventListener('pointermove',e=>{if(!points.has(e.pointerId))return;points.set(e.pointerId,[e.clientX,e.clientY]);if(points.size===2){const[a,b]=[...points.values()];const d=Math.hypot(a[0]-b[0],a[1]-b[1]);if(pinch&&d>0)distance=Math.max(160,Math.min(1300,distance*pinch/d));pinch=d;}else if(down){azimuth-=(e.clientX-down[0])*.005;elevation+=(e.clientY-down[1])*.003;}down=[e.clientX,e.clientY];position();});
  const release=e=>{points.delete(e.pointerId);down=null;pinch=null;};canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);
  canvas.addEventListener('wheel',e=>{e.preventDefault();distance=Math.max(160,Math.min(1300,distance*Math.exp(e.deltaY*.001)));position();},{passive:false});
  for(const id of ['surface','archive','live'])$(id).onclick=()=>setMode(id);
  $('refresh').onclick=()=>mode==='live'?refreshLive():setMode('live');
  await setMode('surface');
  window.__arcLayers={geometry,mesh,camera,get mode(){return mode;},setMode,state,refreshLive,source:h,geoid:n};
  const timer=setInterval(()=>{if(mode!=='live'||document.hidden)return;state.tick();showTime();if(Date.now()-lastRefresh>=WEATHER_SOURCE.cadenceMs)refreshLive();},1000);
  renderer.setAnimationLoop(()=>{if(!document.hidden)renderer.render(scene,camera);});
  addEventListener('visibilitychange',()=>{if(!document.hidden&&mode==='live'){state.tick();if(Date.now()-lastRefresh>=WEATHER_SOURCE.cadenceMs)refreshLive();}});
  addEventListener('pagehide',()=>{disposed=true;sequence++;clearInterval(timer);state.stop();clearLive();renderer.setAnimationLoop(null);geometry.dispose();mat.dispose();day.dispose();snapshotTexture?.dispose();renderer.dispose();},{once:true});
}
start().catch(e=>{$('status').textContent='地形載入失敗，未使用假資料替代';$('error').textContent=e.message;console.error(e);});
