import {aviationHostAlive,aviationLanes,initializeAviationRuntime,prepareAircraft,launchAircraft,landAircraft} from './aviation-operations.js?v=visual-support-bridge-1';
import {hasAircraftTemplate,ensureAircraftRuntime} from './aircraft-runtime.js?v=electronic-ballistic-1';
import {supportCapacity} from './support-equipment.js?v=visual-support-bridge-1';
const fail=m=>{throw Error(m);};
const side=scene=>scene.controls.enemyAutonomy?'ally':scene.controls.observationSide;
const record=(scene,data)=>scene.aviationRuntime.records.push({turnNumber:scene.turn.number,...data});
function selection(scene,request){
 initializeAviationRuntime(scene);if(scene.turn.phaseId!=='start')fail('航空調整はラウンド開始段階で行ってください。');
 const host=scene.instances.find(u=>u.instanceId===request.hostId);if(!host||host.side!==side(scene)||!aviationHostAlive(host))fail('航空運用可能な自陣営の母艦・施設を選択してください。');
 if(!Array.isArray(request.aircraftIds)||!request.aircraftIds.length||request.aircraftIds.length>10000||new Set(request.aircraftIds).size!==request.aircraftIds.length)fail('対象機を重複なく選択してください。');
 const map=new Map(scene.instances.map(u=>[u.instanceId,u])),planes=request.aircraftIds.map(id=>map.get(id));
 for(const p of planes){if(!hasAircraftTemplate(p)||p.side!==host.side||p.aircraftState?.status==='destroyed')fail('選択機を確認してください。自陣営の使用可能な機体だけ指定できます。');ensureAircraftRuntime(p);if(request.operation!=='landing'&&p.aircraftState.hostId!==host.instanceId)fail('選択中の母艦内の機体だけ操作できます。');}
 return{host,planes};
}
function ground(planes){for(const p of planes)if(!['parked','ready'].includes(p.aircraftState.mission))fail(`${p.name}：起降中・飛行中の機体は移せません。離陸待ちは先に離陸取消を行ってください。`);}
function lane(scene,host,id,planes){const lanes=aviationLanes(host,planes[0].snapshot.aircraft.type),r=lanes.find(r=>r.id===id);if(!r)fail('使用可能な発進場所を選択してください。');for(const p of planes){if(!aviationLanes(host,p.snapshot.aircraft.type).some(r=>r.id===id))fail('水上機と通常機は対応する発進場所へ分けてください。');if(r.kind==='catapult'&&supportCapacity(p,'rato')<1)fail(`${p.name}：カタパルトにはRATOが必要です。`);}const use=scene.aviationRuntime.runwayUse.find(u=>u.hostId===host.instanceId&&u.runwayId===id&&u.turnNumber===scene.turn.number);if(r.kind!=='water'&&(use?.kind==='landing'||scene.instances.some(p=>p.aircraftState?.hostId===host.instanceId&&p.aircraftState.runwayId===id&&p.aircraftState.mission==='landing'&&p.aircraftState.status!=='destroyed')))fail('この滑走路は着陸に使用中です。整備区で待機してください。');return r;}
// Called inside the simulation store's isolated persistence transaction. A failed
// mixed-squadron batch discards the entire candidate, including spent quotas.
export function dispatchAviation(scene,request){
 const {host,planes}=selection(scene,request),{operation,runwayId=null}=request;
 if(operation==='stage'){
  ground(planes);if(!['hangar','preparation','runway'].includes(request.zone))fail('移動先を確認してください。');
  if(request.zone==='runway'){lane(scene,host,runwayId,planes);for(const p of planes)if(!p.aircraftState.prepared||p.aircraftState.status!=='operational'||p.currentHp<p.snapshot.maxHp)fail(`${p.name}：整備を完了してから発進場所に移してください。`);}
  for(const p of planes)Object.assign(p.aircraftState,{mission:request.zone==='runway'?'ready':'parked',deckZone:request.zone,runwayId:request.zone==='runway'?runwayId:null,dueTurn:null});
 }else if(operation==='prepare'){
  ground(planes);if(planes.some(p=>p.aircraftState.deckZone!=='preparation'||p.aircraftState.mission!=='parked'))fail('先に対象機を整備区へ移してください。');
  const groups=new Map();for(const p of planes){const load=request.loadoutId===undefined?p.aircraftState.activeLoadoutId:request.loadoutId,key=JSON.stringify([p.unitId,load]);if(!groups.has(key))groups.set(key,{load,ids:[]});groups.get(key).ids.push(p.instanceId);}
  for(const {load,ids}of groups.values())prepareAircraft(scene,{hostId:host.instanceId,runwayId:null,aircraftIds:ids,loadoutId:load,reconfigure:true});
 }else if(operation==='squadron'){
  ground(planes);if(typeof request.squadron!=='string'||request.squadron.trim().length>100)fail('中隊名は100文字以内で指定してください。');
  for(const p of planes){p.aircraftState.formationId=request.squadron.trim()||null;p.groupId=null;p.aircraftState.clusterId=null;}
 }else if(operation==='takeoff'){
  const groups=new Map();for(const p of planes){if(p.aircraftState.mission!=='ready')fail('発進場所で待機する整備済み機を選択してください。');const id=p.aircraftState.runwayId;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(p.instanceId);}
  for(const [id,ids]of groups)launchAircraft(scene,{hostId:host.instanceId,runwayId:id,aircraftIds:ids});
 }else if(operation==='landing'){
  landAircraft(scene,{hostId:host.instanceId,runwayId,aircraftIds:planes.map(p=>p.instanceId)});
 }else if(operation==='cancel-takeoff'){
  for(const p of planes)if(p.aircraftState.mission!=='launching'||p.aircraftState.dueTurn!==scene.turn.number+1)fail('今ラウンドに登録した離陸待ち機だけ取り消せます。即時発進した機体は取り消せません。');
  const counts=new Map();for(const p of planes){const id=p.aircraftState.runwayId;counts.set(id,(counts.get(id)??0)+1);}for(const [id,n]of counts){const use=scene.aviationRuntime.runwayUse.find(u=>u.hostId===host.instanceId&&u.runwayId===id&&u.turnNumber===scene.turn.number&&u.kind==='takeoff');if(!use||use.count<n)fail('離陸枠の使用記録が一致しません。');use.count-=n;}
  scene.aviationRuntime.runwayUse=scene.aviationRuntime.runwayUse.filter(u=>u.count>0);for(const p of planes)Object.assign(p.aircraftState,{mission:'ready',dueTurn:null,deckZone:'runway'});
 }else fail('航空調整の操作を確認してください。');
 record(scene,{kind:'deck-'+operation,hostId:host.instanceId,aircraftIds:[...request.aircraftIds],...(operation==='stage'?{zone:request.zone,runwayId}:{}),...(operation==='squadron'?{squadron:request.squadron.trim()}: {})});
 return{operation,count:planes.length};
}
