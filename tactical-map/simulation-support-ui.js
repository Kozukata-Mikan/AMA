import {inSupportRange,SUPPORT_NAMES,supportCapacity} from './support-equipment.js?v=visual-support-bridge-1';
import {needsSupport,supportLimit} from './simulation-support.js?v=visual-support-bridge-1';
import {isAirship,isAirshipBase} from './aviation-services.js?v=visual-support-bridge-1';
import {conditionLabel,effectLabel} from './support-condition.js';

function el(tag,text=''){
 const n=document.createElement(tag);n.textContent=text;return n;
}
function button(text,action){
 const b=el('button',text);b.type='button';b.addEventListener('click',action);return b;
}
export function mountSupportUI(store,container,selectedUnit){
 const panel=el('details');panel.open=true;
 const kinds=el('div'),targets=el('div'),tasks=el('div'),message=el('p'),slots=el('p');
 kinds.className='support-tabs';targets.className='support-roster';message.setAttribute('role','status');
 let kind='rescue',targetId='';
 const choices=Object.entries(SUPPORT_NAMES).map(([key,name])=>{
  const b=button(name,()=>{kind=key;targetId='';sync();});kinds.append(b);return b;
 });
 const start=button('支援を開始',async()=>{
  try{await store.startSupport({providerId:selectedUnit(),targetId,kind});message.textContent='支援を開始しました。';}
  catch(e){message.textContent=e.message;}
 });
 panel.append(el('summary','救助・損管・補給'),kinds,slots,el('h4','支援対象'),targets,start,message,tasks);container.append(panel);
 function sync(){
  const scene=store.getSceneSnapshot(),provider=scene.instances.find(u=>u.observationOwn&&u.instanceId===selectedUnit());
  if(!provider)return;
  choices.forEach((b,i)=>b.setAttribute('aria-pressed',String(Object.keys(SUPPORT_NAMES)[i]===kind)));
  const all=scene.supportRuntime?.tasks??[],active=all.filter(t=>t.status==='active');
  const used=active.filter(t=>t.providerId===provider.instanceId&&t.kind===kind).length;
  const capacity=supportLimit(provider,kind);
  const eligible=capacity>used&&!provider.aviationStored&&Number.isFinite(provider.x)&&Number.isFinite(provider.y)&&
   !['sinking','sunk'].includes(provider.shipState?.status)&&!['destroyed','rebuilding'].includes(provider.buildingState?.status)&&
   provider.snapshot.building?.airportType!=='anchorage'&&!provider.shipState?.rescueTaskId&&!active.some(t=>t.targetId===provider.instanceId);
  const candidates=eligible?scene.instances.filter(u=>u.observationOwn&&u.instanceId!==provider.instanceId&&
   (!isAirshipBase(provider)||isAirship(u))&&inSupportRange(provider,u)&&needsSupport(u,kind)&&
   !u.shipState?.rescueTaskId&&!active.some(t=>t.providerId===u.instanceId||t.targetId===u.instanceId)):[];
  if(!candidates.some(u=>u.instanceId===targetId))targetId='';
  slots.textContent=`支援枠 ${used} / ${capacity}`+(scene.turn.phaseId==='special'?'':' · 開始は特殊段階')+
   (kind==='rescue'&&capacity?' · '+(supportCapacity(provider,'repair-station')?'修理所あり':'通常救助'):'');
  targets.replaceChildren();
  for(const u of candidates){
   const b=button('',()=>{targetId=u.instanceId;sync();});b.setAttribute('aria-pressed',String(targetId===u.instanceId));
   const fx=u.shipState?.effects;
   b.append(el('strong',u.name),el('small',`${conditionLabel(u)} · 耐性 ${u.currentHp}/${u.snapshot.maxHp}`+
    (fx?.fire?' · '+effectLabel('fire',fx.fire):'')+(fx?.flooding?' · '+effectLabel('flooding',fx.flooding)+'浸水':'')));
   targets.append(b);
  }
  if(!candidates.length)targets.append(el('small',eligible?'支援範囲内に該当する対象なし':'この支援を開始できる枠がありません。'));
  start.disabled=scene.turn.phaseId!=='special'||!targetId;
  tasks.replaceChildren();
  for(const t of active.filter(t=>[t.providerId,t.targetId].includes(provider.instanceId))){
   const end=button(`${SUPPORT_NAMES[t.kind]}を中止 · ${scene.instances.find(u=>u.instanceId===t.targetId)?.name??''}`,async()=>{
    try{await store.cancelSupport(t.id);message.textContent='支援を中止しました。';}catch(e){message.textContent=e.message;}
   });end.disabled=!['movement','special'].includes(scene.turn.phaseId);tasks.append(end);
  }
  for(const t of all.filter(t=>t.status!=='active'&&[t.providerId,t.targetId].includes(provider.instanceId)).slice(-5).reverse()){
   tasks.append(el('small',`R${t.startedTurn} 開始 · ${SUPPORT_NAMES[t.kind]} · ${({complete:'完了',failed:'失敗',interrupted:'中止'})[t.status]??t.status}`));
  }
 }
 const unsubscribe=store.subscribe(sync);sync();document.dispatchEvent(new CustomEvent('support-provider-select',{detail:selectedUnit()}));
 return ()=>{unsubscribe();panel.remove();};
}
