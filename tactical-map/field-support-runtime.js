import {supportCapacity,supportEffectOf} from './support-equipment.js?v=field-support-1';
import {buildingMountAvailable} from './building-state.js?v=facility-rules-1';
import {sampleTerrain} from './terrain-data.js';
import {navalKind} from './naval-kind.js';
import {balloonActive} from './support-effects.js?v=field-support-1';
import {applyShipMineDamage,readShipProfile} from './ship-runtime.js?v=field-support-1';
import {recordSinkingStarts} from './simulation-phase-finish.js?v=catalog-symbols-1';
const SIDES=['ally','enemy','neutral'],RADIUS=5,EPS=1e-7;
const fail=m=>{throw Error(m);};
const key=(unitId,groupId)=>JSON.stringify([unitId,groupId]);
export function initializeFieldSupport(scene){
 scene.fieldSupportRuntime??={version:1,mines:[],spent:[],records:[]};const r=scene.fieldSupportRuntime;
 if(r.version!==1||!Array.isArray(r.mines)||!Array.isArray(r.spent)||!Array.isArray(r.records))fail('野外支援の保存状態が不正です。');
 const ids=new Set(),spent=new Set(),units=new Map(scene.instances.map(u=>[u.instanceId,u]));
 for(const m of r.mines){if(typeof m.id!=='string'||ids.has(m.id)||!units.has(m.ownerId)||!SIDES.includes(m.side)||![m.x,m.y].every(Number.isFinite)||!Number.isSafeInteger(m.turnNumber)||m.turnNumber<1||m.turnNumber>scene.turn.number)fail('機雷の保存状態が不正です。');ids.add(m.id);}
 for(const use of r.spent){const k=key(use.unitId,use.groupId);if(!units.has(use.unitId)||typeof use.groupId!=='string'||spent.has(k))fail('機雷の消費記録が不正です。');spent.add(k);}
 for(const u of scene.instances)if(u.fieldSupport!==undefined&&(!u.fieldSupport||typeof u.fieldSupport.balloonRaised!=='boolean'))fail('観測気球の状態が不正です。');
 return r;
}
export function remainingMineGroups(scene,unit){const spent=new Set((scene.fieldSupportRuntime?.spent??[]).filter(s=>s.unitId===unit.instanceId).map(s=>s.groupId)),eq=new Map(unit.snapshot.equipmentSnapshots.map(e=>[e.id,e]));return(unit.equipmentState?.groups??[]).filter(g=>!g.damaged&&!g.destroyed&&buildingMountAvailable(unit,g.mountIndex)&&supportEffectOf(eq.get(g.equipmentId))==='mine'&&!spent.has(g.id));}
const deployed=u=>Number.isFinite(u.x)&&Number.isFinite(u.y)&&!['sinking','sunk'].includes(u.shipState?.status)&&(!u.aircraftState||u.aircraftState.status==='operational'&&u.aircraftState.mission==='airborne')&&(u.branch!=='building'||u.buildingState?.status==='intact');
function record(scene,event){scene.fieldSupportRuntime.records.push({turnNumber:scene.turn.number,phaseId:scene.turn.phaseId,...event});}
function firstContact(route,mine){
 let distance=0;
 for(let i=0;i<route.length;i++){
  const a=route[i],b=route[i+1]??a,dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy),fx=a.x-mine.x,fy=a.y-mine.y,c=fx*fx+fy*fy-RADIUS*RADIUS;
  if(c<=EPS)return distance;
  if(length>EPS){const B=2*(fx*dx+fy*dy),A=length*length,disc=B*B-4*A*c;if(disc>=-EPS){const t=(-B-Math.sqrt(Math.max(0,disc)))/(2*A);if(t>=-EPS&&t<=1+EPS)return distance+Math.max(0,t)*length;}}
  distance+=length;
 }
 return null;
}
// Spatial buckets avoid checking every ship against every laid mine. Sampled
// cells only collect candidates; the final test uses exact swept segments.
function pathCandidates(route,buckets){const result=new Set();for(let i=0;i<route.length;i++){const a=route[i],b=route[i+1]??a,n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/RADIUS));for(let j=0;j<=n;j++){const x=Math.floor((a.x+(b.x-a.x)*j/n)/RADIUS),y=Math.floor((a.y+(b.y-a.y)*j/n)/RADIUS);for(let dx=-2;dx<=2;dx++)for(let dy=-2;dy<=2;dy++)for(const mine of buckets.get(`${x+dx},${y+dy}`)??[])result.add(mine);}}return result;}
export function resolveFieldMines(scene,destinations=[],coin){
 const runtime=scene.fieldSupportRuntime;if(!runtime?.mines.length)return[];
 const buckets=new Map();for(const mine of runtime.mines){const k=`${Math.floor(mine.x/RADIUS)},${Math.floor(mine.y/RADIUS)}`;if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(mine);}
 const routes=new Map(destinations.map(d=>[d.instanceId,d.route])),events=[];
 for(const unit of scene.instances){
  const waterShip=unit.branch==='navy'&&['surface','submarine'].includes(navalKind(unit))&&!['sunk'].includes(unit.shipState?.status),guard=(waterShip||deployed(unit))&&supportCapacity(unit,'mine-guard')>0;
  if(!waterShip&&!guard)continue;
  const route=routes.get(unit.instanceId)??[{x:unit.x,y:unit.y}];if(!route.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)))continue;
  for(const mine of pathCandidates(route,buckets)){if(mine.side===unit.side)continue;const contact=firstContact(route,mine);if(contact===null)continue;const speed=unit.branch==='navy'?readShipProfile(unit).movementLimit:1;events.push({unit,mine,clear:guard,time:contact/Math.max(1,speed)});}
 }
 events.sort((a,b)=>a.time-b.time||Number(b.clear)-Number(a.clear)||a.unit.instanceId.localeCompare(b.unit.instanceId)||a.mine.id.localeCompare(b.mine.id));
 const removed=new Set(),reports=[];
 for(const event of events){const {unit,mine}=event;if(removed.has(mine.id)||unit.shipState?.status==='sunk')continue;removed.add(mine.id);
  if(event.clear){record(scene,{kind:'mine-cleared',mineId:mine.id,unitId:unit.instanceId,side:unit.side,x:mine.x,y:mine.y});continue;}
  const report=applyShipMineDamage(unit,mine.id,{turnNumber:scene.turn.number,phaseId:scene.turn.phaseId},coin);recordSinkingStarts(scene,[report]);reports.push(report);record(scene,{kind:'mine-triggered',mineId:mine.id,unitId:unit.instanceId,side:unit.side,ownerSide:mine.side,x:mine.x,y:mine.y,damage:report.actualHpLoss,report});
 }
 runtime.mines=runtime.mines.filter(m=>!removed.has(m.id));return reports;
}
export function operateFieldSupport(scene,{unitId,action},coin){
 const runtime=initializeFieldSupport(scene),unit=scene.instances.find(u=>u.instanceId===unitId);
 if(scene.turn.phaseId!=='special')fail('機雷・観測気球の操作は特殊段階で行ってください。');
 if(!unit||!deployed(unit))fail('行動可能な配置済みユニットを選択してください。');
 if(action==='lay-mine'){
  const groups=remainingMineGroups(scene,unit),tile=sampleTerrain(scene.terrain,unit.x,unit.y);if(!groups.length)fail('使用可能な機雷がありません。');if(!tile.inside||!['sea','shallow'].includes(tile.kind))fail('機雷は現在位置の海域・浅海に敷設してください。');
  const group=groups[0],mine={id:crypto.randomUUID(),ownerId:unitId,side:unit.side,x:unit.x,y:unit.y,turnNumber:scene.turn.number};runtime.spent.push({unitId,groupId:group.id});runtime.mines.push(mine);record(scene,{kind:'mine-laid',unitId,side:unit.side,mineId:mine.id,x:mine.x,y:mine.y});resolveFieldMines(scene,[],coin);
 }else if(action==='sweep'){
  if(supportCapacity(unit,'mine-guard')<1)fail('使用可能な掃海具がありません。');
  const ids=new Set(runtime.mines.filter(m=>m.side!==unit.side&&Math.hypot(m.x-unit.x,m.y-unit.y)<=RADIUS+EPS).map(m=>m.id));for(const mine of runtime.mines)if(ids.has(mine.id))record(scene,{kind:'mine-cleared',mineId:mine.id,unitId,side:unit.side,x:mine.x,y:mine.y});runtime.mines=runtime.mines.filter(m=>!ids.has(m.id));
 }else if(['raise-balloon','lower-balloon'].includes(action)){
  if(supportCapacity(unit,'observation-balloon')<1)fail('使用可能な観測気球がありません。');unit.fieldSupport={balloonRaised:action==='raise-balloon'};record(scene,{kind:'balloon',unitId,side:unit.side,raised:unit.fieldSupport.balloonRaised});
 }else fail('野外支援の操作を確認してください。');
}
export function fieldSupportOptions(scene,side){return scene.instances.filter(u=>u.side===side&&deployed(u)).map(u=>({id:u.instanceId,name:u.name,mines:remainingMineGroups(scene,u).length,guard:supportCapacity(u,'mine-guard')>0,balloon:supportCapacity(u,'observation-balloon')>0,raised:balloonActive(u)})).filter(u=>u.mines||u.guard||u.balloon);}
export function observedFieldSupport(scene,side){const r=scene.fieldSupportRuntime;return{version:1,mines:(r?.mines??[]).filter(m=>m.side===side).map(m=>({id:m.id,x:m.x,y:m.y})),records:(r?.records??[]).filter(r=>r.side===side||r.kind==='mine-triggered'&&r.ownerSide===side).slice(-50).map(r=>({kind:r.kind,turnNumber:r.turnNumber,phaseId:r.phaseId,x:r.x,y:r.y,raised:r.raised,damage:r.side===side?r.damage:undefined}))};}
