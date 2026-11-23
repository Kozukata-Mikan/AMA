import {fillEquipmentOptions} from '../js/equipment-options.js?v=aviation-operations-1';
import {aircraftAirTime,aircraftParkingSlots,AIRCRAFT_TYPES,isDroneType} from '../js/aircraft-template.js?v=aviation-operations-1';
const node=(tag,text='',className='')=>{const n=document.createElement(tag);n.textContent=text;if(className)n.className=className;return n;};
const button=(text,fn)=>{const b=node('button',text);b.type='button';b.addEventListener('click',fn);return b;};
function field(parent,title,control){const label=node('label');label.append(node('span',title),control);parent.append(label);return control;}
const input=(value,type='text')=>{const n=node('input');n.type=type;n.value=value??'';return n;};
export function mountAircraftDerivedFields(controls,host){
 const note=node('output','','catalog-aircraft-calculation');note.setAttribute('aria-live','polite');host.append(note);
 const update=()=>{try{const raw=controls.get('naval.speedKnots').value;const time=aircraftAirTime(controls.get('naval.endurance').value,raw.trim()?Number(raw):null);note.textContent=`必要駐機枠：${controls.get('aircraft.engines').value||'未設定'} / 滞空時間：${time??'未計算'}ラウンド${time===null?'':`（${time*.5}時間）`}（小数切捨て）`; }catch(e){note.textContent=e.message;}};
 for(const key of ['naval.speedKnots','naval.endurance','aircraft.engines'])controls.get(key).addEventListener('input',update);
 controls.get('aircraft.type').addEventListener('change',()=>{const drone=isDroneType(controls.get('aircraft.type').value);controls.get('aircraft.crew').value=drone?'0':controls.get('aircraft.crew').value==='0'?'1':controls.get('aircraft.crew').value;syncRemote();});
 function syncRemote(){controls.get('aircraft.remoteRange').closest('label').hidden=!isDroneType(controls.get('aircraft.type').value);}
 syncRemote();update();return note;
}
export function mountAircraftLoadoutEditor(parent,equipment,value=[]){
 const section=node('fieldset','','catalog-section');section.append(node('legend','掛載（出撃ごとに1構成／空載）'),node('p','固定の主動武器・自衛武器・ポッドとは別枠です。整備時に構成1つ、または空載を選択します。','catalog-muted'));
 const host=node('div','','catalog-repeat-list'),readers=[];section.append(host);
 function addLoadout(value={id:crypto.randomUUID(),name:'',mounts:[]}){
  const group=node('fieldset','','catalog-section');const title=field(group,'構成名',input(value.name));const mountHost=node('div','','catalog-repeat-list'),mounts=[];group.append(mountHost);
  function addMount(value={equipmentId:equipment[0]?.id??'',count:1}){
   const row=node('div','','catalog-repeat-row');const select=node('select');fillEquipmentOptions(select,equipment.filter(e=>e.kind==='weapon'),value.equipmentId);
   field(row,'装備',select);const count=field(row,'数量',input(value.count,'number'));count.min='1';count.step='1';
   const reader={active:true,read(){const quantity=Number(count.value);if(!count.value.trim()||!Number.isSafeInteger(quantity)||quantity<1)throw new Error('搭載装備数は1以上の整数で指定してください。');return{equipmentId:select.value,count:quantity};}};mounts.push(reader);
   row.append(button('この装備を削除',()=>{reader.active=false;row.remove();}));mountHost.append(row);
  }
  for(const m of value.mounts)addMount(m);
  const reader={active:true,read:()=>({id:value.id,name:title.value,mounts:mounts.filter(r=>r.active).map(r=>r.read())})};readers.push(reader);
  group.append(button('構成に装備を追加',()=>addMount()),button('この構成を削除',()=>{reader.active=false;group.remove();}));host.append(group);
 }
 for(const entry of value)addLoadout(entry);
 section.dataset.aircraftLoadouts='true';section.append(button('搭載構成を追加',()=>addLoadout()));parent.append(section);const read=()=>readers.filter(r=>r.active).map(r=>r.read());read.add=()=>addLoadout();return read;
}
export function appendAircraftSummary(parent,item,equipment){
 if(!item.aircraft)return;
 const time=aircraftAirTime(item.naval.endurance,item.naval.speedKnots);
 parent.append(node('p',`種別：${AIRCRAFT_TYPES.find(([id])=>id===item.aircraft.type)?.[1]} / 必要駐機枠：${aircraftParkingSlots(item.aircraft)} / 滞空時間：${time??'未計算'}ラウンド${time===null?'':'（'+time*.5+'時間）'}`,'catalog-aircraft-calculation'));
 parent.append(node('h4','掛載（整備時に構成1つ／空載を選択）'));
 for(const loadout of item.aircraft.loadouts){parent.append(node('p',`${loadout.name}：${loadout.mounts.map(m=>`${equipment.find(e=>e.id===m.equipmentId)?.name??m.equipmentId} × ${m.count}`).join(' / ')||'装備なし'}`));}
 if(!item.aircraft.loadouts.length)parent.append(node('p','搭載構成未登録'));
 parent.append(node('p','固定武装は構成を変更しても保持します。掛載は整備時に選択します。','catalog-muted'));
}
