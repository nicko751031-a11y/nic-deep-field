// NASA GIBS 原生 WMTS：核對來源實際時間，僅提供紅外線觀測，不假造三維雲。
import { latestSourceSlot, weatherGate } from './earthlayers.js';
export const WEATHER_SOURCE = Object.freeze({
  id:'Himawari_AHI_Band13_Clean_Infrared',
  provider:'NASA GIBS／JMA Himawari AHI',
  capabilities:'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml',
  root:'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/',
  classification:'10.3 微米紅外線觀測；非肉眼真彩色，非三維雲高',
  bbox:[117,18,126,27], cadenceMs:600000
});
const OWS='http://www.opengis.net/ows/1.1', WMTS='http://www.opengis.net/wmts/1.0';
export function sourceSlotFromXML(xml, nowMs=Date.now()) {
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  if(doc.getElementsByTagName('parsererror').length)throw Error('衛星來源時間文件無法解析');
  const id=node=>node.getElementsByTagNameNS(OWS,'Identifier')[0]?.textContent?.trim();
  const layer=[...doc.getElementsByTagNameNS(WMTS,'Layer')].find(x=>id(x)===WEATHER_SOURCE.id);
  if(!layer)throw Error('衛星來源未收錄指定紅外線產品');
  const dim=[...layer.getElementsByTagNameNS(WMTS,'Dimension')].find(x=>id(x)?.toLowerCase()==='time');
  if(!dim)throw Error('衛星來源缺少時間維度');
  const slot=latestSourceSlot([...dim.getElementsByTagNameNS(WMTS,'Value')].map(x=>x.textContent.trim()),nowMs);
  if(!slot)throw Error('衛星來源沒有可用的 UTC 時段');
  return slot;
}
export function verifyWeatherHeaders(headers, requested, nowMs=Date.now()) {
  const actual=headers.get('layer-time-actual'), echoed=headers.get('layer-time-request');
  const layer=headers.get('layer-identifier-actual');
  if(echoed!==requested||actual!==requested)throw Error('來源實際時段不符或無法讀取，已拒絕顯示');
  if(layer!==WEATHER_SOURCE.id&&!layer?.startsWith(WEATHER_SOURCE.id+'_'))throw Error('衛星回應產品不符');
  const gate=weatherGate(actual,nowMs,nowMs,1);
  if(!gate.ok)throw Error(gate.reason);
  return {slot:actual,actualLayer:layer,ageMs:gate.ageMs};
}
async function bounded(response,limit) {
  if(!response.ok)throw Error(`衛星來源 HTTP ${response.status}`);
  if(Number(response.headers.get('content-length'))>limit)throw Error('衛星回應超過大小上限');
  const data=await response.arrayBuffer();if(data.byteLength>limit)throw Error('衛星回應超過大小上限');return data;
}
export async function loadHimawariTaiwan({signal,clock=Date.now,fetcher=fetch}={}) {
  const controller=new AbortController();const abort=()=>controller.abort();
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,30000);let bitmap=null;
  try {
    const options={signal:controller.signal,cache:'no-store',credentials:'omit',mode:'cors'};
    const cap=await bounded(await fetcher(WEATHER_SOURCE.capabilities,options),25000000);
    const slot=sourceSlotFromXML(new TextDecoder().decode(cap),clock());
    const url=WEATHER_SOURCE.root+WEATHER_SOURCE.id+'/default/'+slot+'/2km/5/7/33.png';
    const response=await fetcher(url,options);
    if(!response.ok)throw Error(`衛星影像 HTTP ${response.status}`);
    const verified=verifyWeatherHeaders(response.headers,slot,clock());
    if(!response.headers.get('content-type')?.includes('image/png'))throw Error('衛星回應不是 PNG 影像');
    const bytes=await bounded(response,4000000);
    bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
    if(bitmap.width!==512||bitmap.height!==512)throw Error('衛星影像尺寸不符');
    // 原分塊 117–126E、18–27N，裁切到地形118–124E、20–27N；不提高名義解析度。
    const canvas=document.createElement('canvas');canvas.width=341;canvas.height=398;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('衛星影像檢查環境不可用');
    ctx.drawImage(bitmap,512/9,0,512*6/9,512*7/9,0,0,341,398);
    const pixels=ctx.getImageData(0,0,341,398).data;let covered=0;
    for(let i=3;i<pixels.length;i+=4)if(pixels[i]>0)covered++;
    if(covered===0)throw Error('衛星回傳全透明缺測影像');
    bitmap.close();bitmap=null;
    if(controller.signal.aborted)throw new DOMException('衛星載入已取消','AbortError');
    verifyWeatherHeaders(response.headers,slot,clock());
    return {slot:verified.slot,verifiedTime:true,provider:WEATHER_SOURCE.provider,actualLayer:verified.actualLayer,
      classification:WEATHER_SOURCE.classification,coverageFraction:covered/(341*398),canvas,sourceURL:url,
      observationInstantUTC:null,bbox:[118,20,124,27],dispose(){canvas.width=canvas.height=1;}};
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);bitmap?.close();}
}
