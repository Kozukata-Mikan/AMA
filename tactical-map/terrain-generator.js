import {TERRAIN_CHUNK_SIZE,validateTerrain} from './terrain-data.js';
export const KM_PER_CELL=0.2, METERS_PER_Z=100;
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const kinds=['mountains','hills','island','archipelago','plain','ocean','coast','river','valley'];
function number(value,label,min,max){if(value===null||value===undefined||String(value).trim()==='')throw new Error(`${label}を入力してください。`);const n=Number(value);if(!Number.isFinite(n)||n<min||n>max)throw new Error(`${label}：${min}～${max}で指定してください。`);return n}
export function normalizeGenerationOptions(input){
 const mode=input.mode??'description';if(!['description','geographic'].includes(mode))throw new Error('生成方式が不正です。');
 const width=Math.round(number(input.widthKm??60,'東西の範囲(km)',24,1440)*5),height=Math.round(number(input.heightKm??60,'南北の範囲(km)',24,1440)*5);
 const seed=number(input.seed??1,'シード',0,4294967295);if(!Number.isInteger(seed))throw new Error('シードは整数です。');
 const detail=Number(input.detail??513);if(![257,513].includes(detail))throw new Error('生成精度が不正です。');
 const kind=input.kind??'mountains';if(!kinds.includes(kind))throw new Error('対応していない地形です。');
 const elevation=input.elevation??'dem';if(!['dem','approximate','flat'].includes(elevation))throw new Error('標高方式が不正です。');
 const o={mode,kind,width,height,widthKm:width/5,heightKm:height/5,seed,detail,elevation,
  lengthKm:number(input.lengthKm??10,'地形の長さ(km)',0.2,1440),heightMeters:number(input.heightMeters??1200,'山頂の高さ(m)',1,60000),
  seaDepthMeters:number(input.seaDepthMeters??200,'仮の海底深さ(m)',1,20000),angle:number(input.angle??0,'方向(度)',-360,360),
  description:String(input.description??'').slice(0,500),label:String(input.label??'').slice(0,250)};
 if(mode==='description'&&o.lengthKm>Math.min(o.widthKm,o.heightKm)*0.9)throw new Error('地形の長さが範囲に収まりません。東西・南北の範囲を広げてください。');
 if(mode==='geographic'){
  o.latitude=number(input.latitude,'中心緯度',-75,75);o.longitude=number(input.longitude,'中心経度',-180,180);
  const b=geographicBounds(o);if(b.south< -80||b.north>80||b.east-b.west>120)throw new Error('この範囲は極域または投影の対応範囲を超えています。中心か範囲を調整してください。');
 }
 return o;
}
export function parseTerrainDescription(description){
 const text=String(description??'').normalize('NFKC').trim();if(!text||text.length>500)throw new Error('説明を1～500文字で入力してください。');
 const rules=[['archipelago',/群岛|群島|诸岛|諸島|archipelago|islands/i],['island',/岛|島|island/i],['valley',/山谷|峡谷|渓谷|valley/i],['mountains',/山脉|山脈|山地|山岳|mountain|ridge/i],['hills',/丘陵|丘|hill/i],['river',/河流|河川|河|川|river/i],['coast',/海岸|coast/i],['plain',/平原|平地|草原|plain/i],['ocean',/海洋|海域|大海|ocean|sea/i]];
 const kind=rules.find(([,re])=>re.test(text))?.[0];if(!kind)throw new Error('山脈・丘陵・島・群島・平原・海域・海岸・河川・渓谷のキーワードを含めてください。');
 const length=text.match(/(\d+(?:\.\d+)?)\s*(?:km|公里|千米|キロ(?:メートル)?)/i);
 const peak=text.match(/(?:高度|海拔|標高|高さ|height|peak)\s*(?:约|約|为|は|:|：|of)?\s*(\d+(?:\.\d+)?)\s*(m|米|メートル|km|公里|千米)/i);
 const lengthKm=length?Number(length[1]):10;
 const heightMeters=peak?Number(peak[1])*(/^(km|公里|千米)$/i.test(peak[2])?1000:1):(kind==='hills'?300:1200);
 const angle=/东北|東北|northeast/i.test(text)?-45:/西北|northwest/i.test(text)?45:/南北|north.?south/i.test(text)?90:0;
 return {kind,lengthKm,heightMeters,angle,widthKm:Math.min(1440,Math.max(24,Math.ceil(lengthKm*1.4))),heightKm:Math.min(1440,Math.max(24,Math.ceil(lengthKm*1.4))),description:text};
}
function hash(x,y,seed){let n=Math.imul(x|0,374761393)^Math.imul(y|0,668265263)^seed;n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295}
function noise(x,y,seed){const a=Math.floor(x),b=Math.floor(y),fx=x-a,fy=y-b,s=t=>t*t*(3-2*t),u=s(fx),v=s(fy);return (1-v)*((1-u)*hash(a,b,seed)+u*hash(a+1,b,seed))+v*((1-u)*hash(a,b+1,seed)+u*hash(a+1,b+1,seed))}
function surface(o,x,y){
 const angle=o.angle*Math.PI/180,u=x*Math.cos(angle)+y*Math.sin(angle),v=-x*Math.sin(angle)+y*Math.cos(angle),L=o.lengthKm;
 const n=noise(x/2,y/2,o.seed),detail=noise(x/.45,y/.45,o.seed+7);
 let meters=20,river=0;const depth=-o.seaDepthMeters;
 if(o.kind==='ocean')return [depth/100,0,0];
 if(o.kind==='mountains'){
  const t=u/L,edge=Math.max(0,Math.cos(clamp(t,-.5,.5)*Math.PI));
  const center=L*.06*Math.sin(t*Math.PI*4+o.seed%7),distance=(v-center)/(L*.12);
  meters+=o.heightMeters*Math.exp(-distance*distance*2)*edge**2*(.60+.25*Math.cos(t*22)+.15*n)*(0.92+.08*detail);
 }else if(o.kind==='hills'){
  const falloff=Math.max(0,1-Math.hypot(u/(L*.6),v/(L*.6)));
  meters+=o.heightMeters*falloff*(.15+.85*noise(x/(L*.18),y/(L*.18),o.seed));
 }else if(['island','archipelago'].includes(o.kind)){
  let value=-1;const count=o.kind==='island'?1:7;
  for(let i=0;i<count;i++){
   const cx=count===1?0:(hash(i,1,o.seed)-.5)*L,cy=count===1?0:(hash(i,2,o.seed)-.5)*L;
   const radius=count===1?L*.45:L*(.10+.10*hash(i,3,o.seed));
   value=Math.max(value,1-Math.hypot((u-cx)/radius,(v-cy)/(radius*.65))+(n-.5)*.15);
  }
  meters=value>0?Math.max(1,o.heightMeters*value**1.6*(.75+.25*detail)):depth;
 }else if(o.kind==='coast'){
  const distance=u-L*.12*Math.sin(v/(L*.3));meters=distance>0?20+o.heightMeters*.2*Math.min(1,distance/(L*.3))*n:depth;
 }else if(o.kind==='river'||o.kind==='valley'){
  const center=L*.12*Math.sin(u/(L*.25)),d=Math.abs(v-center);
  if(o.kind==='valley')meters+=o.heightMeters*(1-Math.exp(-((d/(L*.2))**2)))*(.8+.2*n);
  if(d<Math.max(.12,L*.015)){river=1;meters=1;}
 }else meters=20+(n-.5)*3;
 return [Math.round(clamp(meters/100,-200,600)*1000)/1000,river,0];
}
export function makeGenerationGrid(o){
 const maxCells=o.detail-1,spacing=Math.max(1,o.width/maxCells,o.height/maxCells);
 return {cols:Math.max(9,Math.ceil(o.width/spacing)+1),rows:Math.max(9,Math.ceil(o.height/spacing)+1)};
}
function baseTerrain(o,grid){return {version:3,width:o.width,height:o.height,...grid,contourInterval:6,chunkSize:TERRAIN_CHUNK_SIZE,base:null,chunks:{}}}
function put(t,col,row,v){if(v[0]===-20&&!v[1]&&!v[2])return;const key=`${Math.floor(col/32)},${Math.floor(row/32)}`;const chunk=t.chunks[key]??(t.chunks[key]={});chunk[(row%32)*32+col%32]=v}
function complete(o,base,extra={}){
 const terrain={version:3,width:o.width,height:o.height,cols:o.width+1,rows:o.height+1,contourInterval:6,chunkSize:32,base,chunks:{},generation:{version:1,mode:o.mode,label:o.label||o.description||o.kind,seed:o.seed,elevation:o.mode==='description'?'procedural':o.elevation,seaDepthMeters:o.seaDepthMeters,spacingX:o.width*200/(base.cols-1),spacingY:o.height*200/(base.rows-1),...(o.mode==='geographic'?{latitude:o.latitude,longitude:o.longitude}:{})}};
 return {terrain:validateTerrain(terrain),summary:{widthKm:o.widthKm,heightKm:o.heightKm,spacingMeters:Math.max(terrain.generation.spacingX,terrain.generation.spacingY),...extra}};
}
export function generateDescribedTerrain(input){
 const o=normalizeGenerationOptions({...input,mode:'description'}),grid=makeGenerationGrid(o),base=baseTerrain(o,grid);
 for(let r=0;r<grid.rows;r++)for(let c=0;c<grid.cols;c++)put(base,c,r,surface(o,(c/(grid.cols-1)-.5)*o.widthKm,(r/(grid.rows-1)-.5)*o.heightKm));
 return complete(o,base,{heightSource:'説明による手続き生成',seaSource:'指定した一様な仮の深さ'});
}
export function geographicBounds(o){const dy=o.heightKm/2/111.195,dx=o.widthKm/2/(111.195*Math.cos(o.latitude*Math.PI/180));return {west:o.longitude-dx,east:o.longitude+dx,south:o.latitude-dy,north:o.latitude+dy}}
export function geographicPoint(o,col,row,grid){const b=geographicBounds(o);return {longitude:b.west+(b.east-b.west)*col/(grid.cols-1),latitude:b.north-(b.north-b.south)*row/(grid.rows-1)}}
export function rasterizeCoastline(data,o,grid){
 if(data?.version!==1||data.scale!==10000||!Array.isArray(data.polygons))throw new Error('海岸線資料の形式が不正です。');
 const mask=new Uint8Array(grid.cols*grid.rows),bounds=geographicBounds(o),scale=data.scale;
 for(const polygon of data.polygons){
  const [west,south,east,north]=polygon.b.map(n=>n/scale);if(south>bounds.north||north<bounds.south)continue;
  for(const shift of [-360,0,360]){
   if(west+shift>bounds.east||east+shift<bounds.west)continue;
   const scanlines=Array.from({length:grid.rows},()=>[]);
   for(const encoded of polygon.r){
    const ring=encoded.slice();if(data.encoding==='delta')for(let i=2;i<ring.length;i++)ring[i]+=ring[i-2];
    for(let i=0,j=ring.length-2;i<ring.length;j=i,i+=2){
     const ax=((ring[j]/scale+shift)-bounds.west)/(bounds.east-bounds.west)*(grid.cols-1),ay=(bounds.north-ring[j+1]/scale)/(bounds.north-bounds.south)*(grid.rows-1);
     const bx=((ring[i]/scale+shift)-bounds.west)/(bounds.east-bounds.west)*(grid.cols-1),by=(bounds.north-ring[i+1]/scale)/(bounds.north-bounds.south)*(grid.rows-1);
     if(ay===by)continue;
     for(let y=Math.max(0,Math.ceil(Math.min(ay,by)));y<=Math.min(grid.rows-1,Math.ceil(Math.max(ay,by))-1);y++)scanlines[y].push(ax+(bx-ax)*(y-ay)/(by-ay));
    }
   }
   for(let r=0;r<grid.rows;r++){
    const xs=scanlines[r].sort((a,b)=>a-b);
    for(let i=0;i+1<xs.length;i+=2)for(let c=Math.max(0,Math.ceil(xs[i]));c<=Math.min(grid.cols-1,Math.floor(xs[i+1]));c++)mask[r*grid.cols+c]=1;
   }
  }
 }
 return mask;
}
export function generateGeographicTerrain(input,data,elevationSampler=null){
 const o=normalizeGenerationOptions({...input,mode:'geographic'}),grid=makeGenerationGrid(o),mask=rasterizeCoastline(data,o,grid),base=baseTerrain(o,grid);
 if(o.elevation==='dem'&&typeof elevationSampler!=='function')throw new Error('標高データがありません。近似山地または平坦を選択してください。');
 let landCount=0;
 // Inland distance provides a gentle shoreline taper only for explicitly approximate relief.
 const distance=new Float32Array(mask.length);for(let i=0;i<mask.length;i++)distance[i]=mask[i]?1e6:0;
 const dx=o.widthKm/(grid.cols-1),dy=o.heightKm/(grid.rows-1);
 for(let r=0;r<grid.rows;r++)for(let c=0;c<grid.cols;c++){const i=r*grid.cols+c;if(mask[i])distance[i]=Math.min(distance[i],c?distance[i-1]+dx:1e6,r?distance[i-grid.cols]+dy:1e6)}
 for(let r=grid.rows-1;r>=0;r--)for(let c=grid.cols-1;c>=0;c--){const i=r*grid.cols+c;if(mask[i])distance[i]=Math.min(distance[i],c+1<grid.cols?distance[i+1]+dx:1e6,r+1<grid.rows?distance[i+grid.cols]+dy:1e6)}
 for(let r=0;r<grid.rows;r++)for(let c=0;c<grid.cols;c++){
  const i=r*grid.cols+c;let meters=-o.seaDepthMeters;
  if(mask[i]){
   landCount++;
   if(o.elevation==='dem'){const p=geographicPoint(o,c,r,grid);meters=elevationSampler(p.longitude,p.latitude);if(!Number.isFinite(meters))throw new Error('標高データに欠損があります。範囲を調整するか近似山地を選択してください。');meters=Math.max(1,meters)}
   else if(o.elevation==='flat')meters=10;
   else meters=10+o.heightMeters*(1-Math.exp(-distance[i]/2))*(.12+.88*noise(c/15,r/15,o.seed));
  }
  put(base,c,r,[Math.round(clamp(meters/100,-200,600)*1000)/1000,0,0]);
 }
 return complete(o,base,{bounds:geographicBounds(o),landFraction:landCount/mask.length,heightSource:{dem:'Mapzen Terrain Tiles の概略高程',approximate:'推測した山地（実測標高ではありません）',flat:'海岸線のみ・陸地は一様10m'}[o.elevation],seaSource:'指定した一様な仮の深さ（実測水深ではありません）',landSource:data.source});
}
