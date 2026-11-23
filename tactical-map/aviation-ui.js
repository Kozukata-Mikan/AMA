import {hasAircraftTemplate} from './aircraft-runtime.js?v=aviation-operations-1';
import {aviationRunways,aviationHostAlive} from './aviation-operations.js?v=aviation-operations-1';
import {aircraftFacilityCompatible} from '../js/aircraft-template.js?v=aviation-operations-1';
import {supportCapacity} from './support-equipment.js?v=aviation-operations-1';
const node=(tag,text='')=>{const e=document.createElement(tag);e.textContent=text;return e;};
export function mountAviationUI(store){
 const panel=node('details');panel.open=true;panel.dataset.toolCategory='progress';panel.dataset.workflowPanel='aviation';panel.append(node('summary','航空運用｜整備・離陸・着陸'));
 const host=node('select'),runway=node('select'),operation=node('select'),type=node('select'),formation=node('select'),loadout=node('select'),count=node('input');count.type='number';count.min='1';count.step='1';count.value='1';
 for(const[id,name]of [['prepare','整備'],['takeoff','離陸'],['landing','着陸']])operation.append(new Option(name,id));
 for(const[title,control]of [['母艦・飛行場',host],['操作',operation],['使用する滑走路／カタパルト',runway],['航空機テンプレート',type],['航空編隊',formation],['整備時の掛載',loadout],['処理機数',count]]){const label=node('label');label.append(node('span',title),control);panel.append(label);}
 const note=node('p','ラウンド開始時に整備・起降を登録してから移動段階へ進みます。整備区1組＝最大9機。滑走路は27機・次ラウンド開始に完了、カタパルトは3機・即時完了。同じ滑走路で同ラウンドの離陸と着陸は併用できません。着陸登録時に滞空計時を停止します。');note.className='note';
 const info=node('p'),status=node('p'),action=node('button'),queue=node('div');status.setAttribute('role','status');action.type='button';panel.append(note,info,action,status,queue);document.querySelector('aside').append(panel);
 const reset=(control,options)=>{const old=control.value;control.replaceChildren(...options.map(([id,label])=>new Option(label,id)));if(options.some(([id])=>id===old))control.value=old;};
 function selection(scene){const h=scene.instances.find(u=>u.instanceId===host.value);let planes=scene.instances.filter(p=>p.observationOwn&&hasAircraftTemplate(p)&&p.aircraftState?.status!=='destroyed');
 if(operation.value==='landing')planes=planes.filter(p=>p.aircraftState.mission==='airborne'&&h&&aircraftFacilityCompatible(p.snapshot.aircraft.type,h)&&Math.hypot(p.x-h.x,p.y-h.y)<=(h.branch==='building'?25:12.5)+1e-7);
 else planes=planes.filter(p=>p.aircraftState.hostId===host.value&&p.aircraftState.status==='operational'&&(operation.value==='prepare'?['parked','ready'].includes(p.aircraftState.mission)&&p.aircraftState.preparedTurn!==scene.turn.number:p.aircraftState.mission==='ready'&&p.aircraftState.runwayId===runway.value));
 return planes;
 }
 function sync(){
  const scene=store.getSceneSnapshot(),hosts=scene.instances.filter(h=>h.observationOwn&&['navy','building'].includes(h.branch)&&(aviationRunways(h).length||supportCapacity(h,'parking-stand')));
  reset(host,[['','母艦・飛行場を選択'],...hosts.map(h=>[h.instanceId,h.name])]);const h=hosts.find(h=>h.instanceId===host.value);
  const lanes=h?aviationRunways(h):[];reset(runway,lanes.map(r=>[r.id,`${r.name}（${r.capacity}機／R）`]));
  let candidates=selection(scene);const templates=[...new Map(candidates.map(p=>[p.unitId,p.snapshot])).values()];reset(type,templates.map(t=>[t.id,t.name]));candidates=candidates.filter(p=>p.unitId===type.value);
  const formations=[...new Set(candidates.map(p=>p.aircraftState.formationId??(p.aircraftState.clusterId?null:p.groupId)??''))];reset(formation,formations.map(id=>[id,id||'編隊なし']));
  const template=templates.find(t=>t.id===type.value);reset(loadout,[['','空載'],...(template?.aircraft.loadouts??[]).map(l=>[l.id,l.name])]);loadout.closest('label').hidden=operation.value!=='prepare';
  const chosen=candidates.filter(p=>(p.aircraftState.formationId??(p.aircraftState.clusterId?null:p.groupId)??'')===formation.value),r=lanes.find(r=>r.id===runway.value),used=scene.aviationRuntime?.runwayUse?.find(u=>u.hostId===h?.instanceId&&u.runwayId===runway.value&&u.turnNumber===scene.turn.number),prepared=scene.aviationRuntime?.preparationUse?.find(u=>u.hostId===h?.instanceId&&u.turnNumber===scene.turn.number)?.count??0;
  count.max=String(chosen.length);info.textContent=h?`対象 ${chosen.length}機 / 整備 ${prepared}／${supportCapacity(h,'preparation-area')*9}機 / 滑走路 ${used?.count??0}／${r?.capacity??0}機${used?`（${used.kind==='takeoff'?'離陸':'着陸'}専用）`:''} / 駐機枠 ${scene.instances.filter(p=>hasAircraftTemplate(p)&&p.aircraftState?.hostId===h.instanceId&&p.aircraftState.status!=='destroyed').reduce((n,p)=>n+p.snapshot.aircraft.engines,0)}／${supportCapacity(h,'parking-stand')}`:'';
  action.textContent=({prepare:'整備を確定',takeoff:'離陸を指示',landing:'着陸を指示'})[operation.value];action.disabled=scene.turn.phaseId!=='start'||!h||!aviationHostAlive(h)||!r||!chosen.length;
  if(h&&!aviationHostAlive(h))info.textContent+=' / 航空運用停止';
  const stored=scene.instances.filter(p=>p.observationOwn&&hasAircraftTemplate(p)&&p.aircraftState?.hostId===h?.instanceId&&p.aircraftState.status!=='destroyed');const counts=new Map();for(const p of stored){const key=({parked:'未整備',ready:'整備済み・滑走路待機',launching:'離陸待ち（次R）',landing:'着陸待ち（次R）'})[p.aircraftState.mission]??p.aircraftState.mission;counts.set(key,(counts.get(key)??0)+1);}queue.replaceChildren(...[...counts].map(([name,n])=>node('p',`${name}：${n}機`)));
 }
 for(const control of [host,operation,runway,type,formation])control.addEventListener('change',sync);
 action.addEventListener('click',async()=>{try{const scene=store.getSceneSnapshot(),n=Number(count.value);if(!Number.isSafeInteger(n)||n<1)throw Error('処理機数は1以上の整数で指定してください。');const candidates=selection(scene).filter(p=>p.unitId===type.value&&(p.aircraftState.formationId??(p.aircraftState.clusterId?null:p.groupId)??'')===formation.value);if(n>candidates.length)throw Error('処理機数が対象機数を超えています。');await store[({prepare:'prepareAircraft',takeoff:'launchAircraft',landing:'landAircraft'})[operation.value]]({hostId:host.value,runwayId:runway.value,aircraftIds:candidates.slice(0,n).map(p=>p.instanceId),loadoutId:loadout.value||null});status.textContent='航空運用を保存しました。';}catch(e){status.textContent=e.message;}});
 const unsubscribe=store.subscribe(sync);sync();return()=>{unsubscribe();panel.remove();};
}
