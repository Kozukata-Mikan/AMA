import {geographicBounds,makeGenerationGrid} from './terrain-generator.js';
export const GEOGRAPHIC_PRESETS=[
 {name:'宿務と周辺諸島 / 宿务群岛 / Cebu',aliases:/宿务|宿霧|宿雾|セブ|cebu/i,latitude:10.3,longitude:123.8,widthKm:220,heightKm:280},
 {name:'沖縄と周辺諸島 / 冲绳 / Okinawa',aliases:/沖縄|冲绳|okinawa/i,latitude:26.4,longitude:127.9,widthKm:180,heightKm:200},
 {name:'台湾 / 臺灣 / Taiwan',aliases:/台湾|臺灣|taiwan/i,latitude:23.7,longitude:121,widthKm:260,heightKm:440},
 {name:'対馬 / 对马 / Tsushima',aliases:/対馬|对马|tsushima/i,latitude:34.4,longitude:129.35,widthKm:90,heightKm:120},
 {name:'ハワイ諸島 / 夏威夷 / Hawaii',aliases:/ハワイ|夏威夷|hawaii/i,latitude:20.5,longitude:-157,widthKm:700,heightKm:420}
];
const placeCache=new Map();let searching=false,lastSearch=0;
export async function searchGeographicPlaces(query){
 const text=String(query??'').trim();if(text.length<2||text.length>200)throw new Error('地名は2～200文字で入力してください。');
 const preset=GEOGRAPHIC_PRESETS.filter(p=>p.aliases.test(text));if(preset.length)return preset;
 if(placeCache.has(text))return placeCache.get(text);
 if(searching||Date.now()-lastSearch<1200)throw new Error('地名検索は少し間隔を空けてください。');
 searching=true;lastSearch=Date.now();
 try{
  const cleaned=text.replace(/^(?:我想要|我想|请|請)?(?:生成|绘制|繪製|制作|製作|创建|創建)(?:一片|一个|一個)?\s*/,'').replace(/(?:の地形|の地図|地图|地圖)$/,'');
  const url=new URL('https://geocoding-api.open-meteo.com/v1/search');url.search=new URLSearchParams({name:cleaned,count:'5',language:'ja',format:'json'});
  const response=await fetchWithTimeout(url);if(!response.ok)throw new Error('地名検索サービスに接続できません。経緯度で指定できます。');
  const data=await response.json();const results=(data.results??[]).filter(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)).map(p=>({name:[p.name,p.admin1,p.country].filter(Boolean).join(' / '),latitude:p.latitude,longitude:p.longitude,widthKm:200,heightKm:200}));
  placeCache.set(text,results);return results;
 }finally{searching=false}
}
export async function fetchWithTimeout(url,timeout=20000){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);try{return await fetch(url,{signal:controller.signal,credentials:'omit'})}finally{clearTimeout(timer)}}
let coastlinePromise=null;
export async function decodeCoastline(text){
 if(typeof DecompressionStream!=='function')throw new Error('このブラウザーでは海岸線資料を展開できません。ブラウザーを更新してください。');
 const bytes=Uint8Array.from(atob(text.trim()),c=>c.charCodeAt(0));const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
 return JSON.parse(await new Response(stream).text());
}
export function loadCoastline(){
 if(!coastlinePromise)coastlinePromise=(async()=>{const r=await fetchWithTimeout(new URL('../data/terrain-land.b64',import.meta.url),45000);if(!r.ok)throw new Error('海岸線資料を読み込めませんでした。');return decodeCoastline(await r.text())})().catch(e=>{coastlinePromise=null;throw e});
 return coastlinePromise;
}
export function terrariumMeters(r,g,b){return r*256+g+b/256-32768}
function mercator(longitude,latitude,z){const n=2**z,lat=latitude*Math.PI/180;return {x:(longitude+180)/360*n,y:(1-Math.asinh(Math.tan(lat))/Math.PI)/2*n}}
export function elevationTilePlan(o){
 const b=geographicBounds(o),grid=makeGenerationGrid(o),spacing=o.widthKm*1000/(grid.cols-1);
 let z=Math.max(0,Math.min(12,Math.ceil(Math.log2(156543.03392*Math.cos(o.latitude*Math.PI/180)/spacing))));
 let plan;
 do{
  const nw=mercator(b.west,b.north,z),se=mercator(b.east,b.south,z);
  plan={z,x0:Math.floor(nw.x),x1:Math.floor(se.x),y0:Math.floor(nw.y),y1:Math.floor(se.y)};
  if((plan.x1-plan.x0+1)*(plan.y1-plan.y0+1)<=16)break;z--;
 }while(z>=0);
 return plan;
}
const tileCache=new Map();
async function loadTile(z,x,y){
 const n=2**z,wrapped=((x%n)+n)%n,key=`${z}/${wrapped}/${y}`;
 if(tileCache.has(key)){const value=tileCache.get(key);tileCache.delete(key);tileCache.set(key,value);return value}
 if(typeof OffscreenCanvas!=='function'||typeof createImageBitmap!=='function')throw new Error('高程画像の読み取りに対応していません。近似山地または平坦を選択してください。');
 const r=await fetchWithTimeout(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${key}.png`);if(!r.ok)throw new Error('高程を取得できません。再試行、または近似山地・平坦を選択してください。');
 const bitmap=await createImageBitmap(await r.blob());
 try{if(bitmap.width!==256||bitmap.height!==256)throw new Error('高程タイルの寸法が不正です。');const canvas=new OffscreenCanvas(256,256),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);const data=ctx.getImageData(0,0,256,256).data;tileCache.set(key,data);while(tileCache.size>32)tileCache.delete(tileCache.keys().next().value);return data}finally{bitmap.close()}
}
export async function loadElevationSampler(o){
 const p=elevationTilePlan(o),tasks=[],tiles=new Map();
 for(let y=p.y0;y<=p.y1;y++)for(let x=p.x0;x<=p.x1;x++)tasks.push({x,y});
 let index=0;await Promise.all(Array.from({length:Math.min(4,tasks.length)},async()=>{while(index<tasks.length){const {x,y}=tasks[index++];tiles.set(`${x}/${y}`,await loadTile(p.z,x,y))}}));
 return (longitude,latitude)=>{const q=mercator(longitude,latitude,p.z),x=Math.floor(q.x),y=Math.floor(q.y),data=tiles.get(`${x}/${y}`);if(!data)return NaN;const px=Math.max(0,Math.min(255,Math.floor((q.x-x)*256))),py=Math.max(0,Math.min(255,Math.floor((q.y-y)*256))),i=(py*256+px)*4;return data[i+3]?terrariumMeters(data[i],data[i+1],data[i+2]):NaN};
}
