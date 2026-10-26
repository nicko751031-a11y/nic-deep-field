// NOAA 高程局部網格：來源高程 1:1、公里座標、先在 JS double 減局部原點才交給 GPU。
// 不取代主站飛行或觀測邊界；供地球圖層驗證與後續球面分塊整合。
import * as THREE from 'three';
import { validateHeightGrid, sampleHeight, geodeticEcefKm } from './earthlayers.js';

export function createTerrainGeometry(grid, geoid, { centerLat = 23.5, centerLon = 121, stride = 2 } = {}) {
  validateHeightGrid(grid); validateHeightGrid(geoid);
  if (!Number.isInteger(stride) || stride < 1 || stride > 8) throw new RangeError('地形採樣步長無效');
  if (grid.heightDatum !== 'EGM2008' || geoid.heightDatum !== 'EGM2008-undulation') throw new RangeError('高程基準不相容');
  if (grid.width !== geoid.width || grid.height !== geoid.height || grid.transform.some((x,i)=> Math.abs(x-geoid.transform[i])>1e-10)) throw new RangeError('高程與大地水準面格網不一致');
  const n0 = sampleHeight(geoid, centerLat, centerLon);
  if (n0 === null) throw new RangeError('中心點缺少高程基準資料');
  const origin = geodeticEcefKm(centerLat, centerLon, 0, {datum:'orthometric',geoidMetres:n0});
  const lat = centerLat*Math.PI/180, lon = centerLon*Math.PI/180;
  const east = [-Math.sin(lon),Math.cos(lon),0];
  const up = [Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)];
  const south = [Math.sin(lat)*Math.cos(lon),Math.sin(lat)*Math.sin(lon),-Math.cos(lat)];
  const rows=[], cols=[];
  for(let j=0;j<grid.height;j+=stride) rows.push(j);
  for(let i=0;i<grid.width;i+=stride) cols.push(i);
  if(rows.at(-1)!==grid.height-1)rows.push(grid.height-1);
  if(cols.at(-1)!==grid.width-1)cols.push(grid.width-1);
  const vertices=[],uv=[],valid=[]; const t=grid.transform;
  for(const row of rows) for(const col of cols) {
    const latitude=t[5]+(row+0.5)*t[4], longitude=t[2]+(col+0.5)*t[0];
    const H=grid.samples[row*grid.width+col], N=geoid.samples[row*geoid.width+col];
    const ok=H!==grid.nodata&&N!==geoid.nodata&&Number.isFinite(H)&&Number.isFinite(N);
    valid.push(ok);
    // 海洋顯示海平面，不把海床畫成暴露的陸地；不誇大高程。
    const p=geodeticEcefKm(latitude,longitude,ok?Math.max(0,H):0,{datum:'orthometric',geoidMetres:ok?N:n0}).map((v,i)=>v-origin[i]);
    const dot=(v)=>p[0]*v[0]+p[1]*v[1]+p[2]*v[2];
    vertices.push(dot(east),dot(up),dot(south));
    uv.push((col+0.5)/grid.width,1-(row+0.5)/grid.height);
  }
  const indices=[],nx=cols.length;
  for(let j=0;j<rows.length-1;j++)for(let i=0;i<nx-1;i++){
    const a=j*nx+i,b=a+1,c=a+nx,d=c+1;
    if([a,b,c].every(x=>valid[x]))indices.push(a,c,b);
    if([b,c,d].every(x=>valid[x]))indices.push(b,c,d);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
  geometry.userData={classification:'NOAA 高程資料重建，非即時',heightExaggeration:1,unit:'km',sampleStride:stride,sourceResolutionArcsec:grid.sourceResolutionArcsec,originECEFKm:origin,triangles:indices.length/3,missingVertices:valid.filter(x=>!x).length};
  return geometry;
}

export async function loadHeightGrid(metaURL, {signal}={}) {
  const base = new URL(metaURL, location.href);
  if(base.origin!==location.origin)throw new Error('高程僅讀取本站已審核靜態檔案');
  const r=await fetch(base,{signal});if(!r.ok)throw new Error('高程紀錄載入失敗');
  const meta=await r.json();
  if(typeof meta.file!=='string'||!/^[-\w.]+$/.test(meta.file)||!['int16-little-endian','float32-little-endian'].includes(meta.encoding))throw new Error('高程檔案設定無效');
  if(!/^[a-f0-9]{64}$/.test(meta.sha256)||!Number.isInteger(meta.width)||!Number.isInteger(meta.height)||meta.width<2||meta.height<2||meta.width*meta.height>2000000)throw new Error('高程紀錄不完整或超過預算');
  const data=await fetch(new URL(meta.file,base),{signal});if(!data.ok)throw new Error('高程資料載入失敗');
  const raw=await data.arrayBuffer(); const bytes=meta.encoding==='int16-little-endian'?2:4;
  if(raw.byteLength!==meta.width*meta.height*bytes)throw new Error('高程檔案大小錯誤');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),v=>v.toString(16).padStart(2,'0')).join('');
  if(hash!==meta.sha256)throw new Error('高程雜湊不符');
  const view=new DataView(raw),samples=new Float32Array(meta.width*meta.height);
  for(let i=0;i<samples.length;i++)samples[i]=bytes===2?view.getInt16(i*2,true):view.getFloat32(i*4,true);
  return validateHeightGrid({...meta,samples});
}
