import {buildingAlive} from './building-state.js?v=visual-support-bridge-1';
import {inSupportRange,supportCapacity,supportRadius} from './support-equipment.js?v=visual-support-bridge-1';
import {sampleTerrain} from './terrain-data.js';

// An unarmed army counter can participate as cargo without requiring ground-combat rules.
export const passiveArmy=u=>u.branch==='army'&&(Boolean(u.transportHostId)||!(u.snapshot?.mounts??[]).some(m=>
 (u.snapshot.equipmentSnapshots??[]).some(e=>e.id===m.equipmentId&&e.kind==='weapon')));
export const isCargoPort=u=>u?.branch==='building'&&u.snapshot?.building?.kind==='port';
export const holdSize=u=>supportCapacity(u,'transport-hold');
function available(u){
 if(!u||u.transportHostId||!Number.isFinite(u.x)||!Number.isFinite(u.y)||u.projectileState)return false;
 if(u.branch==='building')return buildingAlive(u);
 if(u.branch==='navy')return !['sinking','sunk'].includes(u.shipState?.status);
 if(u.aircraftState)return u.aircraftState.status==='operational'&&u.aircraftState.mission==='airborne';
 return u.currentHp>0;
}
export function transportManifests(instances){
 const manifests=new Map();
 for(const unit of instances)if(unit.transportHostId){
  if(!manifests.has(unit.transportHostId))manifests.set(unit.transportHostId,[]);
  manifests.get(unit.transportHostId).push({id:unit.instanceId,name:unit.name});
 }
 return manifests;
}
export function validateTransport(scene){
 const stored=scene.instances.filter(u=>u.transportHostId!=null);
 if(!stored.length)return;
 const units=new Map(scene.instances.map(u=>[u.instanceId,u]));
 for(const u of stored){
  const h=units.get(u.transportHostId);
  if(!h||u.branch!=='army'||u===h||h.side!==u.side||h.transportHostId||u.x!==null||u.y!==null||u.groupId!=null)
   throw Error('輸送庫の所属・配置記録が不正です。');
 }
}
const nearby=(a,b)=>inSupportRange(isCargoPort(b)?b:a,isCargoPort(b)?a:b);
export function transportOptions(units,host,manifestFor){
 const cargo=manifestFor(host.instanceId),port=isCargoPort(host),capacity=holdSize(host);
 const canReceive=available(host)&&(port||cargo.length<capacity);
 const neighbors=available(host)?units.filter(u=>u!==host&&u.side===host.side&&available(u)&&nearby(host,u)):[];
 return {cargo,port,capacity,active:available(host),load:canReceive?neighbors.filter(u=>u.branch==='army'&&!u.supportLocked&&!manifestFor(u.instanceId).length):[],
  receivers:neighbors.filter(u=>isCargoPort(u)||holdSize(u)>manifestFor(u.instanceId).length)};
}
function shorePoint(scene,port){
 const radius=supportRadius(port);
 let best=null,bestDistance=Infinity;
 for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
  const distance=dx*dx+dy*dy;
  if(distance>=bestDistance||distance>radius*radius)continue;
  const x=port.x+dx,y=port.y+dy;
  if(sampleTerrain(scene.terrain,x,y).kind==='land'){best={x,y};bestDistance=distance;}
 }
 return best;
}
export function operateTransport(scene,{hostId,unitIds,operation,receiverId}){
 if(scene.turn.phaseId!=='special')throw Error('輸送は特殊段階に操作してください。');
 const units=new Map(scene.instances.map(u=>[u.instanceId,u])),host=units.get(hostId);
 const side=scene.controls.enemyAutonomy?'ally':scene.controls.observationSide;
 if(!available(host)||host.side!==side)throw Error('使用可能な自陣営の輸送元を選択してください。');
 if(!Array.isArray(unitIds)||!unitIds.length||new Set(unitIds).size!==unitIds.length)throw Error('陸軍ユニットを重複なく選択してください。');
 const manifests=transportManifests(scene.instances),cargoFor=id=>manifests.get(id)??[];
 const options=transportOptions(scene.instances,host,cargoFor);
 const selected=unitIds.map(id=>units.get(id));
 if(operation==='load'){
  const allowed=new Set(options.load);
  if(selected.some(u=>!allowed.has(u))||(!options.port&&options.cargo.length+selected.length>options.capacity))throw Error('積載枠・距離・対象ユニットを確認してください。');
  for(const u of selected)Object.assign(u,{transportHostId:hostId,transportOriginalGroup:u.groupId??null,x:null,y:null,groupId:null});
  return;
 }
 if(selected.some(u=>!u||u.transportHostId!==hostId))throw Error('輸送元の積荷を選択してください。');
 if(operation==='transfer'){
  const receiver=units.get(receiverId);
  if(!options.receivers.includes(receiver)||(!isCargoPort(receiver)&&cargoFor(receiverId).length+selected.length>holdSize(receiver)))throw Error('移送先の積載枠・距離を確認してください。');
  for(const u of selected)u.transportHostId=receiverId;
 }else if(operation==='unload'&&options.port){
  const point=shorePoint(scene,host);
  if(!point)throw Error('港の範囲内に配置可能な陸地がありません。積荷は港に保管されています。');
  for(const u of selected){
   Object.assign(u,point);
   u.groupId=scene.groups.some(g=>g.id===u.transportOriginalGroup)?u.transportOriginalGroup:null;
   delete u.transportOriginalGroup;
   delete u.transportHostId;
  }
 }else throw Error('荷下ろしには港を選択してください。');
}
