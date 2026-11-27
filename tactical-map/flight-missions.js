import {supportCapacity} from './support-equipment.js?v=visual-support-bridge-1';
import {parseDamageRule} from './weapon-damage-rule.js?v=visual-support-bridge-1';
import {hasAirTrait} from './air-training-runtime.js?v=electronic-ballistic-1';
import {expandFormationMemberIds} from './formation-target-runtime.js?v=visual-support-bridge-1';
import {maximumHullDamage} from './simulation-autonomous-weapon.js?v=visual-support-bridge-1';
import {validateFlightPlan} from './flight-plan-data.js';
import {hasAircraftTemplate,readAircraftProfile,aircraftCanAct} from './aircraft-runtime.js?v=electronic-ballistic-1';
import {aircraftMayFly} from './aviation-time.js?v=visual-support-bridge-1';
import {getVisibility} from './simulation-features.js?v=visual-support-bridge-1';
import {aviationRunways,aviationLanes,aviationHostAlive,landAircraft} from './aviation-operations.js?v=visual-support-bridge-1';
import {sampleTerrain} from './terrain-data.js';
import {readWeaponProfile,readWeaponTargetScope} from './weapon-profile-runtime.js?v=visual-support-bridge-1';
import {readFiringArc} from './weapon-firing-arc.js?v=blast-area-1';
import {checkAirAttackMode,airborneUnit} from './air-ground-rules.js?v=car-return-1';
import {saveAirCombat,initializeAirCombat} from './air-combat.js?v=visual-support-bridge-1';
const fail=m=>{throw Error(m);},distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),live=p=>hasAircraftTemplate(p)&&p.aircraftState?.status!=='destroyed';
// CAS must not enqueue an ordinary gun against a submerged target. Such a
// command has no legal fallback and would abort the whole attack transaction.
function missionWeaponCanTarget(scene,target,underwaterWeapon){
 if(!underwaterWeapon)return target.underwater!==true;
 return target.branch!=='building'||sampleTerrain(scene.terrain,target.x,target.y).surface<=0;
}
function own(scene,planes){const side=scene.controls.enemyAutonomy?'ally':scene.controls.observationSide;if(planes.some(p=>p.side!==side))fail('操作中の陣営の機体だけ指定してください。');}
function visibility(scene,side,ids,cache){const key='view:'+side+':'+ids.join('|');if(cache?.has(key))return cache.get(key);const result=getVisibility({...scene,controls:{...scene.controls,observationSide:side,enemyAutonomy:false}},new Set(ids));cache?.set(key,result);return result;}
export function assignFlightMission(scene,{aircraftIds,plan}){
 if(scene.turn.phaseId!=='start')fail('航路はラウンド開始時、離陸前に登録してください。');
 if(!Array.isArray(aircraftIds)||!aircraftIds.length||new Set(aircraftIds).size!==aircraftIds.length)fail('機体を重複なく選択してください。');
 const planes=aircraftIds.map(id=>scene.instances.find(u=>u.instanceId===id));if(planes.some(p=>!live(p)||!['parked','ready'].includes(p.aircraftState.mission)))fail('未発進の搭載機を指定してください。');own(scene,planes);
 if(plan==null){for(const p of planes)delete p.aircraftState.flightPlan;return;}
 const cache=new Map(),ids=new Set(aircraftIds),map=new Map(scene.instances.map(u=>[u.instanceId,u])),copies=[];
 for(const p of planes){const home=map.get(p.aircraftState.hostId),profile=readAircraftProfile(p);if(!aviationHostAlive(home))fail('帰投先の母艦・飛行場が使用できません。');
  const result={version:1,kind:plan.kind,behavior:plan.behavior,stage:'outbound',homeId:home.instanceId,origin:{x:home.x,y:home.y},waypoints:structuredClone(plan.waypoints??[]),cursor:0,radius:Number(plan.radius??50),altitude:Number(plan.altitude??p.altitude),targetId:plan.targetId??null,escortId:plan.escortId??null,attackMethod:plan.attackMethod??null,notice:''};validateFlightPlan(result);
  if(!({CAR:['avoid','priority'],CAS:['adjust','escort'],CAP:['engage','conservative']})[result.kind].includes(result.behavior))fail('任務と行動方針の組み合わせが不正です。');
  if(result.altitude>profile.ceiling||!sampleTerrain(scene.terrain,result.origin.x+result.radius,result.origin.y).inside&&result.kind==='CAP'||result.waypoints.some(w=>!sampleTerrain(scene.terrain,w.x,w.y).inside))fail('航点・巡航半径・高度が地図または上昇限度の範囲外です。');
  if(result.kind==='CAP'&&[[-1,0],[0,-1],[0,1]].some(([x,y])=>!sampleTerrain(scene.terrain,result.origin.x+x*result.radius,result.origin.y+y*result.radius).inside))fail('巡航円を地図内に収めてください。');
  if(result.kind==='CAR'&&!result.waypoints.length)fail('CARの航点を1つ以上指定してください。');
  if(result.kind==='CAS'){
   if(result.kind==='CAS'&&result.behavior!=='escort'&&result.targetId?.startsWith('group:')){result.targetGroupId=result.targetId.slice(6);const memberIds=expandFormationMemberIds(scene,{kind:'group',id:result.targetGroupId}),seen=visibility(scene,p.side,memberIds,cache);result.targetIds=memberIds.filter(id=>{const t=map.get(id);return t.side!==p.side&&!airborneUnit(t)&&seen.get(id)==='identified';});if(!result.targetIds.length)fail('編隊内に識別済みの攻撃目標がありません。');result.targetId=result.targetIds[0];}
   const target=map.get(result.behavior==='escort'?result.escortId:result.targetId);
   if(result.behavior==='escort'){if(!live(target)||target.side!==p.side||target.aircraftState.mission!=='airborne'||target.aircraftState.flightPlan?.kind!=='CAS'||target.aircraftState.flightPlan.behavior==='escort'||ids.has(target.instanceId))fail('飛行中の自陣営CAS攻撃隊を護衛対象にしてください。');result.escortGroupId=target.groupId;}
   else{if(!target||airborneUnit(target)||target.side===p.side||visibility(scene,p.side,[target.instanceId],cache).get(target.instanceId)!=='identified')fail('識別済みの地上・水上・水中の敵目標を選択してください。');const z=target.branch==='building'?sampleTerrain(scene.terrain,target.x,target.y).surface:target.underwater?-(target.depth??0):sampleTerrain(scene.terrain,target.x,target.y).surface;checkAirAttackMode(p,target,result.attackMethod,result.altitude,z);result.targetPoint={x:target.x,y:target.y};}
  }
  copies.push(result);
 }
 planes.forEach((p,i)=>p.aircraftState.flightPlan=copies[i]);
}
function enemiesNear(scene,plane,center,radius,cache,includeAirships=false){const key=String(includeAirships)+plane.side+':'+center.x+':'+center.y+':'+radius;if(cache.has(key))return cache.get(key);const candidates=scene.instances.filter(t=>(live(t)&&t.aircraftState.mission==='airborne'||includeAirships&&t.branch==='navy'&&airborneUnit(t)&&!['sinking','sunk'].includes(t.shipState?.status))&&((plane.side==='ally'&&t.side==='enemy')||(plane.side==='enemy'&&t.side==='ally'))&&distance(t,center)<=radius);const seen=candidates.length?visibility(scene,plane.side,candidates.map(p=>p.instanceId)):new Map();const result=candidates.filter(t=>seen.get(t.instanceId)==='identified').sort((a,b)=>distance(a,plane)-distance(b,plane));cache.set(key,result);return result;}
export function flightMissionRoutes(scene,excluded=new Set()){
 if(!scene.instances.some(p=>p.aircraftState?.flightPlan&&p.aircraftState.mission==='airborne'))return [];
 const routes=[],map=new Map(scene.instances.map(u=>[u.instanceId,u])),cache=new Map(),endpoints=new Map();
 const ordered=scene.instances.filter(p=>p.aircraftState?.flightPlan).sort((a,b)=>Number(a.aircraftState.flightPlan.behavior==='escort')-Number(b.aircraftState.flightPlan.behavior==='escort'));
 for(const p of ordered){const s=p.aircraftState,f=s?.flightPlan;if(!f||!live(p)||s.mission!=='airborne'||!aircraftMayFly(scene,p)||excluded.has(p.instanceId)||f.stage==='complete')continue;validateFlightPlan(f);const profile=readAircraftProfile(p),home=map.get(f.homeId);f.notice='';
  if(!aviationHostAlive(home)){f.notice='帰投先が使用不能です。手動で別の着陸先を選択してください。';continue;}
  // Recover already-reached waypoints from a resumed sortie before planning.
  if(f.kind==='CAR'&&f.stage==='outbound'){while(f.cursor<f.waypoints.length&&distance(p,f.waypoints[f.cursor])<=1e-7)f.cursor++;if(f.cursor===f.waypoints.length)f.stage='returning';}
  if(s.status==='heavy'||s.remainingAirTime<=1||f.kind==='CAR'&&s.remainingAirTime<=Math.floor(profile.maximumAirTime/2))f.stage='returning';
  let targets=[],intercept=null;
  if(f.stage!=='returning'){
   const protectedPlane=f.behavior==='escort'?(live(map.get(f.escortId))?map.get(f.escortId):f.escortGroupId?scene.instances.find(q=>q.groupId===f.escortGroupId&&q.side===p.side&&live(q)&&q.aircraftState.mission==='airborne'):null):null;
   if(f.behavior==='escort'&&(!live(protectedPlane)||protectedPlane.aircraftState.mission!=='airborne'||['returning','complete'].includes(protectedPlane.aircraftState.flightPlan?.stage)))f.stage='returning';
   const enemy=f.behavior==='avoid'?enemiesNear(scene,p,p,100,cache,true)[0]:f.behavior==='engage'?enemiesNear(scene,p,f.origin,f.radius,cache)[0]:protectedPlane?enemiesNear(scene,p,protectedPlane,100,cache)[0]:null;
   if(enemy&&f.behavior==='avoid')f.stage='returning';else if(enemy)intercept=enemy;
   if(f.stage!=='returning'){
    if(intercept)targets=[intercept];
    else if(protectedPlane)targets=[endpoints.get(protectedPlane.instanceId)??protectedPlane];
    else if(f.kind==='CAP'){
     const step=Math.PI/12;let angle=distance(p,f.origin)<f.radius*.5?0:Math.atan2(p.y-f.origin.y,p.x-f.origin.x);if(distance(p,f.origin)<f.radius*.5)targets.push({x:f.origin.x+f.radius,y:f.origin.y});
     for(let i=1;i<=256;i++){const a=angle+i*step;targets.push({x:f.origin.x+Math.cos(a)*f.radius,y:f.origin.y+Math.sin(a)*f.radius});}
    }else{
     targets=f.waypoints.slice(f.cursor);
     if(f.kind==='CAS'){
      const target=map.get(f.targetId);if(!target||target.shipState?.status==='sunk'||target.aircraftState?.status==='destroyed'||target.branch==='building'&&target.currentHp===0){f.stage='returning';}
      else{if(visibility(scene,p.side,[f.targetId],cache).get(f.targetId)==='identified')f.targetPoint={x:target.x,y:target.y};targets=[...targets,f.targetPoint];}
     }else if(!targets.length)f.stage='returning';
    }
   }
  }
  if(f.stage==='returning')targets=[home];
  p.altitude=Math.min(f.altitude,profile.ceiling);
  let budget=Math.min(profile.movementLimit,s.remainingEndurance),current={x:p.x,y:p.y},route=[current],travel=0,checkpoints=[];
  for(const t of targets){const d=distance(current,t);if(d>budget+1e-7){if(budget>0)route.push({x:current.x+(t.x-current.x)*budget/d,y:current.y+(t.y-current.y)*budget/d});break;}route.push({x:t.x,y:t.y});budget-=d;travel+=d;current=route.at(-1);if(!intercept&&f.stage!=='returning'&&f.kind!=='CAP'&&f.behavior!=='escort'&&checkpoints.length<f.waypoints.length-f.cursor)checkpoints.push({distance:travel,cursor:f.cursor+checkpoints.length+1});if(route.length>=257)break;}
  endpoints.set(p.instanceId,route.at(-1));
  routes.push({instanceId:p.instanceId,route,missionProgress:checkpoints});
 }
 return routes;
}
export function finishMissionMovement(scene,destinations,routes){const planes=new Map(scene.instances.map(p=>[p.instanceId,p]));const byId=new Map(destinations.map(d=>[d.instanceId,d]));for(const r of routes){const p=planes.get(r.instanceId),f=p.aircraftState.flightPlan,d=byId.get(r.instanceId);if(!d)continue;for(const c of r.missionProgress)if(d.distance>=c.distance-1e-7)f.cursor=c.cursor;if(f.kind==='CAR'&&f.cursor===f.waypoints.length&&f.stage==='outbound')f.stage='returning';if(f.kind==='CAS'&&f.behavior!=='escort'&&f.stage==='outbound'&&f.cursor===f.waypoints.length&&distance(p,f.targetPoint)<1e-5)f.stage='attack';}}
export function autoLandMissions(scene){
 const groups=new Map();for(const p of scene.instances){const f=p.aircraftState?.flightPlan;if(!f||!live(p))continue;if(p.aircraftState.mission==='airborne'&&(p.aircraftState.remainingAirTime<=1||f.kind==='CAR'&&p.aircraftState.remainingAirTime<=Math.floor(readAircraftProfile(p).maximumAirTime/2)))f.stage='returning';if(p.aircraftState.mission==='parked'&&f.stage==='returning'){f.stage='complete';continue;}const home=scene.instances.find(u=>u.instanceId===f.homeId);if(f.stage!=='returning'||p.aircraftState.mission!=='airborne'||!aviationHostAlive(home)||distance(p,home)>(home.branch==='building'?25:12.5))continue;const key=p.side+':'+f.homeId;if(!groups.has(key))groups.set(key,{home,planes:[]});groups.get(key).planes.push(p);}
 const controls=scene.controls;try{for(const {home,planes}of groups.values()){scene.controls={...controls,enemyAutonomy:false,observationSide:home.side};let pending=[...planes];for(const r of [...new Map(planes.flatMap(p=>aviationLanes(home,p.snapshot.aircraft.type)).map(r=>[r.id,r])).values()]){const use=scene.aviationRuntime.runwayUse.find(u=>u.hostId===home.instanceId&&u.runwayId===r.id&&u.turnNumber===scene.turn.number);if(use&&use.kind!=='landing')continue;const n=Math.max(0,r.capacity-(use?.count??0));const chosen=pending.filter(p=>{
 const type=p.snapshot.aircraft.type;
 if(type==='rotorcraft'||r.kind==='vertical')return type==='rotorcraft'&&r.kind==='vertical';
 if(r.kind==='water')return type==='seaplane';
 if(r.kind==='runway')return type!=='seaplane';
 return supportCapacity(p,'rato')>0;
 }).slice(0,n);if(!chosen.length)continue;try{landAircraft(scene,{hostId:home.instanceId,runwayId:r.id,aircraftIds:chosen.map(p=>p.instanceId)});pending=pending.filter(p=>!chosen.includes(p));for(const p of chosen)if(p.aircraftState.mission==='parked')p.aircraftState.flightPlan.stage='complete';}catch(e){for(const p of chosen)p.aircraftState.flightPlan.notice=e.message;}}for(const p of pending)p.aircraftState.flightPlan.notice='着陸枠の空きを待っています。';}}finally{scene.controls=controls;}
}
export function appendMissionAttacks(scene){
 if(!/^order-[1-5]$/.test(scene.turn.phaseId))return;
 const participants=scene.instances.filter(p=>live(p)&&p.aircraftState?.flightPlan&&aircraftCanAct(p,'attack')&&aircraftMayFly(scene,p));if(!participants.length)return;
 const cache=new Map(),map=new Map(scene.instances.map(u=>[u.instanceId,u])),reservations=new Map(),damageEstimates=new Map();
 for(const c of scene.attackRuntime.commands){if(c.turnNumber!==scene.turn.number||c.phaseId!==scene.turn.phaseId||!c.targetId)continue;const actor=map.get(c.unitId),g=actor?.equipmentState?.groups.find(g=>g.id===c.groupId),e=actor?.snapshot.equipmentSnapshots.find(e=>e.id===g?.equipmentId);if(!e)continue;let damage=1;try{damage=maximumHullDamage(readWeaponProfile(e,g));}catch{}const old=reservations.get(c.targetId)??{count:0,damage:0};reservations.set(c.targetId,{count:old.count+1,damage:old.damage+damage});}
 for(const p of participants){const f=p.aircraftState.flightPlan;if(f.stage==='returning'||f.stage==='complete')continue;
  if(f.kind==='CAP'&&f.behavior==='engage'||f.kind==='CAS'&&f.behavior==='escort'){
   const protectedPlane=f.behavior==='escort'?map.get(f.escortId):null,center=protectedPlane??f.origin,radius=protectedPlane?100:f.radius;
   const targets=enemiesNear(scene,p,center,radius,cache);if(!targets.length)continue;initializeAirCombat(scene);if(scene.airCombatRuntime.commands.some(c=>c.turnNumber===scene.turn.number&&c.phaseId===scene.turn.phaseId&&(c.actorIds.includes(p.instanceId)||c.targetIds.includes(p.instanceId))))continue;
   const own=participants.filter(q=>q.side===p.side&&q.groupId===p.groupId&&q.aircraftState.flightPlan.kind===f.kind&&q.aircraftState.flightPlan.behavior===f.behavior&&distance(q,p)<=10).slice(0,27);const actorIds=(p.groupId?own:[p]).map(u=>u.instanceId),enemy=targets[0],targetIds=targets.filter(t=>t.unitId===enemy.unitId&&t.groupId===enemy.groupId&&distance(t,enemy)<=10).slice(0,27).map(t=>t.instanceId);const controls=scene.controls;try{scene.controls={...controls,enemyAutonomy:false,observationSide:p.side};saveAirCombat(scene,{actorIds,targetIds});}catch(e){f.notice=e.message;}finally{scene.controls=controls;}continue;
  }
  if(f.kind!=='CAS'||f.stage!=='attack')continue;
  const ids=f.targetGroupId?expandFormationMemberIds(scene,{kind:'group',id:f.targetGroupId}):[f.targetId],seen=visibility(scene,p.side,ids,cache);let candidates=ids.map(id=>map.get(id)).filter(t=>t&&t.side!==p.side&&!airborneUnit(t)&&seen.get(t.instanceId)==='identified'&&t.shipState?.status!=='sunk'&&(t.branch!=='building'||t.currentHp>0));
  if(hasAirTrait(p,'economy')&&f.targetGroupId)candidates.sort((a,b)=>(reservations.get(a.instanceId)?.count??0)-(reservations.get(b.instanceId)?.count??0));
  const target=candidates[0];if(!target){f.notice='攻撃目標を識別できません。';f.stage='returning';continue;}
  const z=target.branch==='building'?sampleTerrain(scene.terrain,target.x,target.y).surface:target.underwater?-(target.depth??0):sampleTerrain(scene.terrain,target.x,target.y).surface;
  try{checkAirAttackMode(p,target,f.attackMethod,p.altitude,z);}catch(e){f.notice=e.message;continue;}
  let pending=0;
  for(const g of p.equipmentState.groups){if(!['主動武器','掛載'].includes(g.position)||g.damaged||g.destroyed||g.lastUsedTurn===scene.turn.number)continue;const e=p.snapshot.equipmentSnapshots.find(e=>e.id===g.equipmentId);if(e?.kind!=='weapon')continue;const profile=readWeaponProfile(e,g);if(profile.pasOnly||g.remainingAmmo<profile.fullAmmoCost)continue;const underwaterWeapon=profile.underwater===true||parseDamageRule(e).underwater,eligibleCandidates=candidates.filter(t=>missionWeaponCanTarget(scene,t,underwaterWeapon));if(!eligibleCandidates.length)continue;pending++;if(profile.issues.length||Number(scene.turn.phaseId.slice(-1))>profile.maxOrder)continue;
   let chosen=eligibleCandidates[0];if(hasAirTrait(p,'economy')&&f.targetGroupId){chosen=eligibleCandidates.filter(t=>(reservations.get(t.instanceId)?.damage??0)<Math.max(1,t.currentHp)).sort((a,b)=>(reservations.get(a.instanceId)?.count??0)-(reservations.get(b.instanceId)?.count??0))[0];if(!chosen)continue;}
   const chosenZ=chosen.branch==='building'?sampleTerrain(scene.terrain,chosen.x,chosen.y).surface:chosen.underwater?-(chosen.depth??0):sampleTerrain(scene.terrain,chosen.x,chosen.y).surface;try{checkAirAttackMode(p,chosen,f.attackMethod,p.altitude,chosenZ);}catch{continue;}
   const d=Math.hypot(p.x-chosen.x,p.y-chosen.y,p.altitude-chosenZ);if(d>profile.range||chosenZ-p.altitude>profile.ceilingU)continue;try{readFiringArc(p,g,chosen);}catch{continue;}
   const scope=readWeaponTargetScope(profile.targetScope);if(scope.kind!=='single'&&profile.targetScope.trim()!=='集群'){f.notice='範囲武器は手動で編隊目標を指定してください。';continue;}
   if(scene.attackRuntime.commands.some(c=>c.unitId===p.instanceId&&c.groupId===g.id))continue;
   if(hasAirTrait(p,'economy')){const key=profile.equipmentId+':'+profile.fullAmmoCost;if(!damageEstimates.has(key)){try{damageEstimates.set(key,maximumHullDamage(profile));}catch{damageEstimates.set(key,1);}}const old=reservations.get(chosen.instanceId)??{count:0,damage:0};reservations.set(chosen.instanceId,{count:old.count+1,damage:old.damage+damageEstimates.get(key)});}
   scene.attackRuntime.commands.push({id:`mission-cas:${p.instanceId}:${scene.turn.number}:${scene.turn.phaseId}:${g.id}`,status:'planned',turnNumber:scene.turn.number,phaseId:scene.turn.phaseId,unitId:p.instanceId,groupId:g.id,targetRef:{kind:'unit',id:chosen.instanceId},specifiedTargetIds:[],targetId:chosen.instanceId,attackMethod:f.attackMethod,createdAt:new Date().toISOString(),boundaries:[]});
  }
  if(!pending){f.stage='returning';f.notice='使用可能な攻撃武器がないため帰投します。';}
 }
}
export function finishMissionAttacks(scene,reports){const fired=new Set(reports.filter(r=>String(r.commandId).startsWith('mission-cas:')).map(r=>r.unitId));for(const p of scene.instances){const f=p.aircraftState?.flightPlan;if(!f||f.stage!=='attack')continue;if(fired.has(p.instanceId))f.firedTurn=scene.turn.number;if(f.firedTurn===scene.turn.number){const remaining=p.equipmentState.groups.some(g=>['主動武器','掛載'].includes(g.position)&&!g.damaged&&!g.destroyed&&g.lastUsedTurn!==scene.turn.number&&g.remainingAmmo>0);if(!remaining||scene.turn.phaseId==='order-1')f.stage='returning';}else if(scene.turn.phaseId==='order-1'){f.stage='returning';f.notice='このラウンドに発射できず帰投します。';}}}
