import {parseTerrainDescription} from './terrain-generator.js';
import {searchGeographicPlaces,GEOGRAPHIC_PRESETS} from './terrain-geography.js';
import {runBackgroundTask} from './background-client.js?v=aviation-deck-1';
import {readTerrainVertex} from './terrain-data.js';
const initialDescription='我想要生成一片连绵10km左右的山脉';
const labels={mountains:'連なる山脈',hills:'丘陵',island:'島',archipelago:'群島',plain:'平原',ocean:'海域',coast:'海岸',river:'河川',valley:'渓谷'};
function node(tag,text=''){const e=document.createElement(tag);e.textContent=text;return e}
function select(options,value){const e=node('select');for(const [id,label]of options)e.append(new Option(label,id));e.value=value;return e}
function number(value,min,max,step='any'){const e=node('input');e.type='number';e.value=String(value);e.min=String(min);e.max=String(max);e.step=step;return e}
function field(parent,title,input){const label=node('label');label.append(node('span',title),input);parent.append(label);return input}
function button(parent,title,fn){const e=node('button',title);e.type='button';e.addEventListener('click',fn);parent.append(e);return e}
export function generationPreviewImage(terrain){
 const longest=Math.max(terrain.width,terrain.height),width=400*terrain.width/longest,height=400*terrain.height/longest,nx=Math.max(4,Math.round(96*terrain.width/longest)),ny=Math.max(4,Math.round(96*terrain.height/longest)),paths=new Map();
 for(let r=0;r<ny;r++)for(let c=0;c<nx;c++){
  const v=readTerrainVertex(terrain,Math.round(c/(nx-1)*(terrain.cols-1)),Math.round(r/(ny-1)*(terrain.rows-1)));
  const color=v[0]<=0?'#173b53':v[1]?'#3f9eb3':['#4a7861','#65896a','#87966e','#a4a57c','#b3ad91','#c6bea8','#ded8c7'][Math.min(6,Math.floor(Math.log2(1+v[0])*1.1))];
  const list=paths.get(color)??[];list.push(`M${(c*width/nx).toFixed(2)},${(r*height/ny).toFixed(2)}h${(width/nx+.1).toFixed(2)}v${(height/ny+.1).toFixed(2)}h-${(width/nx+.1).toFixed(2)}z`);paths.set(color,list);
 }
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${[...paths].map(([color,d])=>`<path fill="${color}" d="${d.join('')}"/>`).join('')}<text x="12" y="22" fill="white" font-size="14">N ↑</text></svg>`;
 return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
}
export function mountTerrainGenerator({container,store,canAct,setBusy,saveGenerated}){
 const section=node('section');section.className='editor-section terrain-generator';section.append(node('h3','地形の自動生成'));
 const mode=field(section,'生成方式',select([['description','説明から生成'],['geographic','実在地域の概略']], 'description'));
 const description=field(section,'地形の説明 / 地名',node('textarea'));description.value=initialDescription;description.maxLength=500;description.rows=3;
 const help=node('p','例：连绵10km的山脉 / 20kmの群島 / a 10km mountain range');help.className='editor-note';section.append(help);
 const analyze=button(section,'説明を設定に反映',()=>safe(()=>applyDescription()));
 const local=node('div');local.className='terrain-generator-fields';section.append(local);
 const kind=field(local,'地形の種類',select(Object.entries(labels),'mountains'));
 const length=field(local,'地形の長さ(km)',number(10,.2,1440));
 const angle=field(local,'方向（0°＝東西 / 90°＝南北）',number(0,-360,360));
 const geo=node('div');geo.hidden=true;section.append(geo);
 const preset=field(geo,'地域プリセット',select([['','任意の中心座標'],...GEOGRAPHIC_PRESETS.map((p,i)=>[String(i),p.name])],''));
 const search=button(geo,'地名を検索',()=>safe(async()=>{
  const found=await searchGeographicPlaces(description.value);places=found;results.replaceChildren();
  results.append(new Option(found.length?'候補を選択してください':'見つかりません。経緯度で指定できます。',''));
  for(let i=0;i<found.length;i++)results.append(new Option(found[i].name,String(i)));results.value='';
  if(found.length===1){results.value='0';choose(found[0])}else message(found.length?'候補から地域を選択してください。':'中心緯度・経度で直接指定してください。');
 }));
 const results=field(geo,'地名検索の候補',select([['','検索結果']],''));
 const geoFields=node('div');geoFields.className='terrain-generator-fields';geo.append(geoFields);
 const latitude=field(geoFields,'中心緯度',number(10.3,-75,75)),longitude=field(geoFields,'中心経度',number(123.8,-180,180));
 const elevation=field(geo,'陸地の標高',select([['dem','オンライン高程（概略）'],['approximate','近似の山地（推測）'],['flat','海岸線のみ（陸地10m）']],'dem'));
 geo.append(node('p','検索で見つからない島や海域は経緯度を指定できます。高程取得に失敗した場合は、近似山地か平坦を選んで再生成してください。'));
 const common=node('div');common.className='terrain-generator-fields';section.append(common);
 const width=field(common,'生成範囲・東西(km)',number(24,24,1440)),height=field(common,'生成範囲・南北(km)',number(24,24,1440));
 const peak=field(common,'山地の高さ目安(m)',number(1200,1,60000)),depth=field(common,'仮の海底深さ(m)',number(200,1,20000));
 const seed=field(common,'シード（同じ設定で再現）',number(1,0,4294967295,'1'));
 const detail=field(section,'生成精度',select([['257','標準（広域の概観向け）'],['513','詳細（海岸・山地向け）']],'513'));
 section.append(node('p','XY：1格200m / Z：1格100m。最大7200×7200格。生成時の地形間隔は範囲と精度に応じて変わり、プレビューに表示します。'));
 const actions=node('div');actions.className='editor-actions';section.append(actions);
 const generate=button(actions,'地形プレビューを生成',()=>safe(async()=>{
  if(mode.value==='description'&&description.value!==lastDescription)applyDescription();
  const options=readOptions(),before=store.getSceneSnapshot().terrain,request=++epoch;
  clearPreview();message('地形を生成しています…');
  const result=await runBackgroundTask('terrain-generate',{options});
  if(destroyed||request!==epoch)return;
  if(store.getSceneSnapshot().terrain!==before)throw new Error('生成中に地図が変更されました。新しい地図で再生成してください。');
  candidate={...result,before};image.src=generationPreviewImage(result.terrain);preview.hidden=false;apply.disabled=false;
  const s=result.summary,g=result.terrain.generation;
  summary.textContent=[`${s.widthKm}×${s.heightKm}km / ${result.terrain.width}×${result.terrain.height}格`,
   `生成地形の間隔：約${Math.round(s.spacingMeters)}m（編集グリッドは200m）`,
   s.heightSource,s.seaSource,
   mode.value==='geographic'?`中心：${g.latitude.toFixed(4)}, ${g.longitude.toFixed(4)} / 北＝−Y・東＝＋X`:'',
   s.landFraction===0?'この範囲には資料上の陸地がありません。':s.landFraction===1?'この範囲は資料上すべて陸地です。':'',
   'プレビューは北が上です。地図に適用するまで現在の地形は変わりません。'].filter(Boolean).join('\n');
  message('プレビューを確認し、必要なら中心・範囲・高さを調整してください。');
 }));
 const status=node('p');status.className='editor-note editor-status';status.setAttribute('role','status');section.append(status);
 const preview=node('div');preview.className='terrain-generation-preview';preview.hidden=true;
 const image=node('img');image.alt='生成地形の北向きプレビュー';const summary=node('p');preview.append(image,summary);section.append(preview);
 const apply=button(preview,'この地形を地図に適用',()=>safe(async()=>{
  if(!candidate)throw new Error('先にプレビューを生成してください。');
  if(store.getSceneSnapshot().terrain!==candidate.before)throw new Error('元の地図が変わっています。再生成してください。');
  if(!confirm('現在の地形を生成結果で置き換えますか？ユニット座標はそのままです。適用後に配置条件を確認してください。地形の元に戻す操作で復元できます。'))return;
  await saveGenerated(candidate.terrain,candidate.before);clearPreview();message('地形を適用しました。手描きで編集でき、地形の元に戻す操作も利用できます。');
 }));apply.disabled=true;
 button(preview,'プレビューを破棄',()=>{if(!busy){clearPreview();message('プレビューを破棄しました。地図は変更していません。')}});
 const sources=node('details');sources.append(node('summary','資料・精度について'));
 sources.append(node('p','海岸線：Natural Earth 1:10m land（public domain・概略化）。高程：Mapzen / Tilezen Terrain Tiles。地名検索：Open-Meteo / GeoNames。近似山地は実測ではなく、海底は指定した仮の深さです。小さな島・細い海峡・低い沿岸地形は生成間隔によって省略・変形されます。大域の距離は中心緯度による局所投影で近似します。'));
 const credits=node('a','資料の出典とライセンス');credits.href='./terrain-data-sources.html';credits.target='_blank';credits.rel='noopener';sources.append(credits);section.append(sources);container.append(section);
 let places=[],candidate=null,busy=false,destroyed=false,epoch=0,lastDescription=initialDescription;
 function message(text,error=false){if(destroyed)return;status.textContent=text;status.classList.toggle('error',error)}
 function clearPreview(){candidate=null;preview.hidden=true;apply.disabled=true;image.removeAttribute?.('src')}
 function invalidate(){epoch++;clearPreview()}
 function choose(place){invalidate();latitude.value=String(place.latitude);longitude.value=String(place.longitude);width.value=String(place.widthKm);height.value=String(place.heightKm);message(`${place.name} の中心と範囲を設定しました。範囲は変更できます。`)}
 function applyDescription(){const p=parseTerrainDescription(description.value);kind.value=p.kind;length.value=String(p.lengthKm);angle.value=String(p.angle);width.value=String(p.widthKm);height.value=String(p.heightKm);peak.value=String(p.heightMeters);lastDescription=description.value;message(`${labels[p.kind]} / 長さ${p.lengthKm}km の設定を反映しました。`)}
 function readOptions(){return {mode:mode.value,kind:kind.value,lengthKm:length.value,angle:angle.value,widthKm:width.value,heightKm:height.value,heightMeters:peak.value,seaDepthMeters:depth.value,seed:seed.value,detail:detail.value,latitude:latitude.value,longitude:longitude.value,elevation:elevation.value,description:description.value,label:description.value}}
 async function safe(action){
  if(busy||destroyed)return;if(!canAct()){message('描画・計算・保存の完了後に操作してください。',true);return}
  busy=true;setBusy(true);for(const e of [generate,apply,search,analyze,mode,description,kind,length,angle,width,height,peak,depth,seed,detail,latitude,longitude,elevation,preset,results])e.disabled=true;
  try{await action()}catch(e){message(e.name==='AbortError'?'接続が時間内に完了しませんでした。再試行するか近似山地を選択してください。':e.message,true)}
  finally{busy=false;setBusy(false);if(!destroyed){for(const e of [generate,search,analyze,mode,description,kind,length,angle,width,height,peak,depth,seed,detail,latitude,longitude,elevation,preset,results])e.disabled=false;apply.disabled=!candidate}}
 }
 mode.addEventListener('change',()=>{invalidate();const real=mode.value==='geographic';geo.hidden=!real;local.hidden=real;analyze.hidden=real;help.textContent=real?'例：菲律宾宿务群岛 / 沖縄 / Taiwan。候補または経緯度で中心を決めてください。':'対応キーワード：山脈・丘陵・島・群島・平原・海域・海岸・河川・渓谷（中文・English可）';if(real){if(description.value===initialDescription)description.value='菲律宾宿务群岛';choose(GEOGRAPHIC_PRESETS[0])}else if(description.value==='菲律宾宿务群岛'){description.value=initialDescription;applyDescription()}});
 preset.addEventListener('change',()=>{if(preset.value!=='')choose(GEOGRAPHIC_PRESETS[Number(preset.value)])});
 results.addEventListener('change',()=>{if(results.value!=='')choose(places[Number(results.value)])});
 for(const e of [description,kind,length,angle,width,height,peak,depth,seed,detail,latitude,longitude,elevation])for(const event of ['input','change'])e.addEventListener(event,()=>{if(candidate){invalidate();message('設定を変更しました。プレビューを再生成してください。')}});
 return {invalidate,destroy(){destroyed=true;invalidate();section.remove()}};
}
