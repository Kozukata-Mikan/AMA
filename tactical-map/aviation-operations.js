import {resolveForcedLanding,recordAviationAceLosses} from './aviation-losses.js?v=visual-support-bridge-1';
import {initializeAirTraining,clearLandedPanic} from './air-training-runtime.js?v=electronic-ballistic-1';
import {autoLandMissions} from './flight-missions.js?v=visual-support-bridge-1';
import {assertAircraftPreparationTime,assertAircraftLaunchTime,assertAircraftLandingTime} from './aviation-time.js?v=visual-support-bridge-1';
import {buildingAlive,buildingMountAvailable} from './building-state.js?v=visual-support-bridge-1';
import {advanceFacilityServices,enforceRemoteControl,isAirshipBase,isAirship} from './aviation-services.js?v=visual-support-bridge-1';
import {readShipProfile} from './ship-runtime.js?v=visual-support-bridge-1';
import {hasAircraftTemplate,ensureAircraftRuntime,readAircraftProfile} from './aircraft-runtime.js?v=electronic-ballistic-1';
import {aircraftFacilityCompatible} from '../js/aircraft-template.js?v=self-sealing-1';
import {supportCapacity,supportEffectOf} from './support-equipment.js?v=visual-support-bridge-1';
import {ensureUnitCombatRuntime,readEffectiveInitialAmmo} from './equipment-runtime.js?v=visual-support-bridge-1';
import {navalKind} from './naval-kind.js';
import {parseDamageRule} from './weapon-damage-rule.js?v=visual-support-bridge-1';
import {sampleTerrain} from './terrain-data.js';
const clone=v=>structuredClone(v),fail=message=>{throw new Error(message);};
const planeFor=(scene,id)=>scene.instances.find(u=>u.instanceId===id&&hasAircraftTemplate(u));
export const aviationHostAlive=host=>host&&Number.isFinite(host.x)&&Number.isFinite(host.y)&&(host.branch==='navy'?!['sinking','sunk'].includes(host.shipState?.status)&&!host.rescueSupportLocked:host.branch==='building'&&buildingAlive(host));
function own(scene,unit){if(!unit||unit.side!==(scene.controls.enemyAutonomy?'ally':scene.controls.observationSide))fail('観察陣営のユニットを指定してください。');}
export function aviationRunways(host){
 const result=[],building=host.snapshot?.building;
 if(!(host.branch==='building'&&building?.kind==='airport')&&!(host.snapshot?.equipmentSnapshots??[]).some(e=>['runway','catapult'].includes(supportEffectOf(e))))return result;
 const eq=new Map((host.snapshot?.equipmentSnapshots??[]).map(e=>[e.id,e]));
 const groups=host.equipmentState?.groups??(host.snapshot?.mounts??[]).flatMap((m,mi)=>Array.from({length:m.count??0},(_,i)=>({id:`mount-${mi}-group-${i}`,mountIndex:mi,position:m.position,equipmentId:m.equipmentId})));
 for(const g of groups){const e=eq.get(g.equipmentId),kind=supportEffectOf(e);if(!buildingMountAvailable(host,g.mountIndex)||g.damaged||g.destroyed||!['runway','catapult'].includes(kind))continue;result.push({id:g.id,name:`${kind==='catapult'?'カタパルト':'滑走路'} ${g.position} / ${g.id}`,position:g.position,mountIndex:g.mountIndex,kind,capacity:kind==='catapult'?3:27});}
 return result;
}
export function initializeAviationRuntime(scene){
 scene.aviationRuntime??={version:1,inventoryInitialized:false,runwayUse:[],preparationUse:[],records:[]};const r=scene.aviationRuntime;
 if(r.version!==1||!Array.isArray(r.runwayUse)||!Array.isArray(r.preparationUse)||!Array.isArray(r.records)||typeof r.inventoryInitialized!=='boolean')fail('航空運用の保存状態が不正です。');
 const seenUses=new Set();for(const [kind,uses]of [['runway',r.runwayUse],['preparation',r.preparationUse]])for(const u of uses){if(!u)fail('航空運用の使用数記録が不正です。');const key=JSON.stringify([kind,u.hostId,u.runwayId,u.turnNumber]);if(!u||typeof u.hostId!=='string'||!Number.isSafeInteger(u.turnNumber)||u.turnNumber<1||u.turnNumber>scene.turn.number||!Number.isSafeInteger(u.count)||u.count<1||seenUses.has(key)||(kind==='runway'&&(typeof u.runwayId!=='string'||!['takeoff','landing'].includes(u.kind)||u.count>27)))fail('航空運用の使用数記録が不正です。');seenUses.add(key);}
 if(!r.inventoryInitialized){
  const additions=[];
  for(const host of scene.instances){
   if(!['navy','building'].includes(host.branch))continue;
   const references=host.snapshot?.aviationComplement??[];if(!references.length)continue;const templates=new Map((host.snapshot?.aircraftSnapshots??[]).map(a=>[a.id,a]));
   let slots=0;
   for(const [row,entry]of references.entries()){
    if(scene.instances.length+additions.length+entry.count>10000)fail('搭載機を含むユニット数は10000以内にしてください。');
    const snapshot=templates.get(entry.unitId);if(!snapshot?.aircraft||!Number.isSafeInteger(entry.count)||entry.count<1||entry.count>10000)fail('搭載航空機の資料参照・機数が不正です。');
    if(!aircraftFacilityCompatible(snapshot.aircraft.type,host))fail(`${host.name}：この航空機の種別を運用できません。`);
    slots+=snapshot.aircraft.engines*entry.count;
    for(let n=0;n<entry.count;n++){
     const id=`${host.instanceId}:air:${row}:${n}`;if(scene.instances.some(u=>u.instanceId===id))fail('搭載機識別番号が重複しています。');
     const unit={instanceId:id,unitId:snapshot.id,snapshot:clone(snapshot),name:`${snapshot.name} ${n+1}`,branch:'air',side:host.side,faction:host.faction,sizeLevel:snapshot.sizeLevel??1,currentHp:snapshot.maxHp,heading:host.heading??0,x:host.x,y:host.y,altitude:Math.min(80,snapshot.aircraft.ceiling??80),depth:0,underwater:false,groupId:null,isOverallFlagship:false,isFormationFlagship:false};
     const state=ensureAircraftRuntime(unit);Object.assign(state,{mission:'parked',hostId:host.instanceId,runwayId:null,prepared:false,formationId:entry.groupId??null,trainingTeamId:`${host.instanceId}:air:${row}:team:${Math.floor(n/27)}`});additions.push(unit);
    }
   }
   if(slots>supportCapacity(host,'parking-stand'))fail(`${host.name}：必要駐機枠${slots}が登録駐機枠を超えています。`);
  }
  if(scene.instances.length+additions.length>10000)fail('搭載機を含むユニット数は10000以内にしてください。');
  scene.instances.push(...additions);r.inventoryInitialized=true;
 }
 initializeAirTraining(scene);
}
function assertRunwayOpenForStaging(scene,host,runway){if(runway.kind==='water')return;const use=scene.aviationRuntime.runwayUse.find(u=>u.hostId===host.instanceId&&u.runwayId===runway.id&&u.turnNumber===scene.turn.number);if(use?.kind==='landing'||scene.instances.some(p=>p.aircraftState?.hostId===host.instanceId&&p.aircraftState.runwayId===runway.id&&p.aircraftState.mission==='landing'&&p.aircraftState.status!=='destroyed'))fail('この滑走路は着陸に使用中です。整備区で待機してください。');}
export const WATER_LANE='water-surface';
export function aviationLanes(host,type){const lanes=aviationRunways(host);return type==='seaplane'&&aircraftFacilityCompatible(type,host)?[{id:WATER_LANE,name:'水面起降（滑走路不要）',kind:'water',capacity:10000,mountIndex:null,position:'水面'},...lanes.filter(r=>r.kind==='catapult')]:lanes;}
function assertLaneAircraft(runway,planes){
 if(runway.kind==='water'&&planes.some(p=>p.snapshot.aircraft.type!=='seaplane'))fail('水面起降は水上機専用です。');
 if(runway.kind==='runway'&&planes.some(p=>p.snapshot.aircraft.type==='seaplane'))fail('水上機は滑走路を使用しません。水面起降かカタパルトを選択してください。');
 if(runway.kind==='catapult'&&planes.some(p=>supportCapacity(p,'rato')<1))fail('カタパルトを使用する航空機にはRATO発進補助が必要です。');
}
function runwayFor(scene,hostId,id){const host=scene.instances.find(u=>u.instanceId===hostId);own(scene,host);if(!aviationHostAlive(host))fail('母艦・施設は航空運用できません。');const runway=(id===WATER_LANE?aviationLanes(host,'seaplane'):aviationRunways(host)).find(r=>r.id===id);if(!runway)fail('使用可能な滑走路／カタパルトを選択してください。');return{host,runway};}
function chosen(scene,ids){if(!Array.isArray(ids)||!ids.length||ids.length>10000||new Set(ids).size!==ids.length)fail('対象機を重複なく選択してください。');return ids.map(id=>{const p=planeFor(scene,id);if(!p)fail('対象航空機がありません。');return p;});}
function roundStart(scene){initializeAviationRuntime(scene);if(scene.turn.phaseId!=='start')fail('整備・起降はラウンド開始時に指定してください。');}
function reserveRunway(scene,host,runway,kind,count){if(runway.kind==='water')return;const r=scene.aviationRuntime;let use=r.runwayUse.find(u=>u.turnNumber===scene.turn.number&&u.hostId===host.instanceId&&u.runwayId===runway.id);if(use&&use.kind!==kind)fail('このラウンドは同じ滑走路で離陸・着陸を併用できません。');if((use?.count??0)+count>runway.capacity)fail(`この滑走路の1ラウンド${runway.capacity}機の上限を超えています。`);if(!use){use={turnNumber:scene.turn.number,hostId:host.instanceId,runwayId:runway.id,kind,count:0};r.runwayUse.push(use);}use.count+=count;}
function equipLoadout(unit,id,{refill=true}={}){
 const permanent=unit.snapshot.mounts.length,old=unit.equipmentState?.groups?.filter(g=>g.mountIndex<permanent)??[];
 unit.aircraftState.activeLoadoutId=id;delete unit.equipmentState;ensureUnitCombatRuntime(unit);
 for(const g of unit.equipmentState.groups){const previous=old.find(o=>o.id===g.id);if(previous){g.damaged=previous.damaged;g.destroyed=previous.destroyed;if(previous.ammoRegistration)g.ammoRegistration=clone(previous.ammoRegistration);}g.remainingAmmo=!refill&&previous?previous.remainingAmmo:readEffectiveInitialAmmo(g);g.lastUsedTurn=!refill&&previous?previous.lastUsedTurn:null;}
}
export function prepareAircraft(scene,{hostId,runwayId=null,aircraftIds,loadoutId=null,reconfigure=false}){
 roundStart(scene);const host=scene.instances.find(u=>u.instanceId===hostId);own(scene,host);if(!aviationHostAlive(host))fail('母艦・施設は航空運用できません。');const runway=runwayId===null?null:runwayFor(scene,hostId,runwayId).runway,planes=chosen(scene,aircraftIds);if(runway){assertLaneAircraft(runway,planes);assertRunwayOpenForStaging(scene,host,runway);}
 for(const p of planes){own(scene,p);if(!aircraftFacilityCompatible(p.snapshot.aircraft.type,host))fail('この母艦・施設では対象機を整備できません。');assertAircraftPreparationTime(scene,p,host);const s=ensureAircraftRuntime(p);if(s.hostId!==hostId||!['parked','ready'].includes(s.mission)||s.status!=='operational')fail('母艦内の行動可能な未発進機を選択してください。');if(p.currentHp<p.snapshot.maxHp)fail('損傷機は全快するまで整備できません。');if(s.preparedTurn===scene.turn.number&&!(reconfigure&&s.prepared))fail('この機体は今ラウンドに整備済みです。');if(loadoutId!==null&&!p.snapshot.aircraft.loadouts.some(l=>l.id===loadoutId))fail('選択した掛載構成がありません。');const selected=p.snapshot.aircraft.loadouts.find(l=>l.id===loadoutId);for(const m of selected?.mounts??[]){const e=p.snapshot.equipmentSnapshots.find(e=>e.id===m.equipmentId);if(e?.kind!=='weapon')fail('掛載には武器を登録してください。');if(/大型/.test(e.guidance??''))fail('大型武器の専用誘爆規則が未接続です。');const rule=parseDamageRule(e);if(rule.kind==='equipment')fail('設備威力の掛載は誘爆時の被害規則が未接続です。');}}
 const fresh=planes.filter(p=>p.aircraftState.preparedTurn!==scene.turn.number);let use=scene.aviationRuntime.preparationUse.find(u=>u.hostId===hostId&&u.turnNumber===scene.turn.number);const capacity=supportCapacity(host,'preparation-area')*9;if((use?.count??0)+fresh.length>capacity)fail(`整備能力は今ラウンド${capacity}機です。`);
 if(fresh.length){if(!use){use={hostId,turnNumber:scene.turn.number,count:0};scene.aviationRuntime.preparationUse.push(use);}use.count+=fresh.length;}
 for(const p of planes){const s=p.aircraftState,profile=readAircraftProfile(p);const refill=s.preparedTurn!==scene.turn.number;equipLoadout(p,loadoutId,{refill});Object.assign(s,{mission:runway?'ready':'parked',deckZone:runway?'runway':'preparation',prepared:true,preparedTurn:scene.turn.number,runwayId:runway?.id??null,...(refill?{remainingEndurance:profile.enduranceBudget,remainingAirTime:profile.maximumAirTime}:{})});}
 scene.aviationRuntime.records.push({kind:'prepare',turnNumber:scene.turn.number,hostId,runwayId,aircraftIds:[...aircraftIds],loadoutId});
}
function depart(scene,plane,host){delete plane.aircraftState.emergencyLanding;const ground=host.branch==='navy'&&navalKind(host)==='air'?host.altitude:sampleTerrain(scene.terrain,host.x,host.y).surface;const altitude=Math.max(1,ground+1);if(altitude>plane.snapshot.aircraft.ceiling)fail('母艦・施設の地表高度が機体の上昇限度以上です。');Object.assign(plane,{x:host.x,y:host.y,altitude,heading:host.heading??0});if(plane.aircraftState.flightPlan)plane.aircraftState.flightPlan.origin={x:host.x,y:host.y};Object.assign(plane.aircraftState,{sortieHomeId:host.instanceId,sortieLaunched:true,mission:'airborne',hostId:null,runwayId:null,prepared:false,dueTurn:null});}
export function launchAircraft(scene,{hostId,runwayId,aircraftIds}){
 roundStart(scene);const{host,runway}=runwayFor(scene,hostId,runwayId);own(scene,host);const planes=chosen(scene,aircraftIds);assertLaneAircraft(runway,planes);
 for(const p of planes){own(scene,p);assertAircraftLaunchTime(scene,p);const s=ensureAircraftRuntime(p);if(s.hostId!==hostId||s.runwayId!==runwayId||s.mission!=='ready'||!s.prepared||s.status!=='operational'||p.currentHp<p.snapshot.maxHp)fail('指定滑走路の整備済み機を選択してください。');if(Math.max(1,(host.branch==='navy'&&navalKind(host)==='air'?host.altitude:sampleTerrain(scene.terrain,host.x,host.y).surface)+1)>p.snapshot.aircraft.ceiling)fail('施設高度が上昇限度以上です。');}
 reserveRunway(scene,host,runway,'takeoff',planes.length);
 for(const p of planes){if(runway.kind==='catapult')depart(scene,p,host);else Object.assign(p.aircraftState,{mission:'launching',dueTurn:scene.turn.number+1});}
 enforceRemoteControl(scene);rebuildAircraftClusters(scene);
 scene.aviationRuntime.records.push({kind:'takeoff',turnNumber:scene.turn.number,hostId,runwayId,aircraftIds:[...aircraftIds],immediate:runway.kind==='catapult'});
}
export function landAircraft(scene,{hostId,runwayId,aircraftIds},coin){
 roundStart(scene);const{host,runway}=runwayFor(scene,hostId,runwayId);own(scene,host);const planes=chosen(scene,aircraftIds);assertLaneAircraft(runway,planes);
 let occupied=scene.instances.filter(p=>hasAircraftTemplate(p)&&p.aircraftState?.hostId===hostId&&p.aircraftState.status!=='destroyed').reduce((n,p)=>n+p.snapshot.aircraft.engines,0);
 if(runway.kind!=='water'&&scene.instances.some(p=>hasAircraftTemplate(p)&&p.aircraftState?.hostId===hostId&&p.aircraftState.runwayId===runwayId&&p.aircraftState.mission==='ready'&&p.aircraftState.status!=='destroyed'))fail('滑走路に発進待機機があります。先に整備区または格納庫へ移してください。');
 for(const p of planes){own(scene,p);assertAircraftLandingTime(scene,p);const s=ensureAircraftRuntime(p);if(s.mission!=='airborne'||s.status==='destroyed'||!aircraftFacilityCompatible(p.snapshot.aircraft.type,host))fail('着陸可能な飛行中の機体を選択してください。');if(Math.hypot(p.x-host.x,p.y-host.y)>(host.branch==='building'?25:12.5)+1e-7)fail('機体が母艦・施設の着陸範囲外です。');occupied+=p.snapshot.aircraft.engines;}
 if(occupied>supportCapacity(host,'parking-stand'))fail('着陸先の駐機枠が不足しています。');reserveRunway(scene,host,runway,'landing',planes.length);
 for(const p of planes){const landing=resolveForcedLanding(scene,p,{hostId,runwayId,stage:'registration'},coin);if(landing&&!landing.success)continue;const s=p.aircraftState;if(!s.clusterId)s.formationId=p.groupId??s.formationId??null;p.groupId=s.formationId??null;Object.assign(s,{mission:runway.kind==='catapult'?'parked':'landing',hostId,runwayId:runway.kind==='catapult'?null:runwayId,prepared:false,dueTurn:runway.kind==='catapult'?null:scene.turn.number+1,clusterId:null});}
 recordAviationAceLosses(scene,coin);
 scene.aviationRuntime.records.push({kind:'landing',turnNumber:scene.turn.number,hostId,runwayId,aircraftIds:[...aircraftIds],immediate:runway.kind==='catapult'});clearLandedPanic(scene);rebuildAircraftClusters(scene);
}
export function advanceAviationStart(scene,coin){
 initializeAviationRuntime(scene);
 advanceFacilityServices(scene);
 advanceAirshipBaseServices(scene);
 scene.aviationRuntime.runwayUse=scene.aviationRuntime.runwayUse.filter(u=>u.turnNumber>=scene.turn.number);
 scene.aviationRuntime.preparationUse=scene.aviationRuntime.preparationUse.filter(u=>u.turnNumber>=scene.turn.number);
 for(const p of scene.instances){if(!hasAircraftTemplate(p))continue;const s=p.aircraftState;if(!s||s.status==='destroyed'||!['launching','landing'].includes(s.mission)||s.dueTurn>scene.turn.number)continue;const host=scene.instances.find(u=>u.instanceId===s.hostId);if(!aviationHostAlive(host)){s.mission='parked';s.prepared=false;s.runwayId=null;s.dueTurn=null;continue;}if(s.mission==='launching'){try{assertAircraftLaunchTime(scene,p);const lane=aviationLanes(host,p.snapshot.aircraft.type).find(r=>r.id===s.runwayId);if(!lane)fail('発進場所を利用できません。');assertLaneAircraft(lane,[p]);depart(scene,p,host);}catch(e){Object.assign(s,{mission:'ready',dueTurn:null});}}else{const landing=s.status==='heavy'&&!s.emergencyLanding?resolveForcedLanding(scene,p,{hostId:host.instanceId,runwayId:s.runwayId,stage:'completion'},coin):null;if(!landing||landing.success)Object.assign(s,{mission:'parked',runwayId:null,dueTurn:null,prepared:false});}}
 recordAviationAceLosses(scene,coin);
 clearLandedPanic(scene);
 autoLandMissions(scene);
 clearLandedPanic(scene);
 enforceRemoteControl(scene);rebuildAircraftClusters(scene);
}
export function rebuildAircraftClusters(scene){
 const existing=new Map(scene.groups.filter(g=>g.aviationCluster).map(g=>[g.id,g]));
 const buckets=new Map();
 for(const p of scene.instances){if(!hasAircraftTemplate(p)||p.aircraftState?.mission!=='airborne'||p.aircraftState.status==='destroyed'||!p.aircraftState.sortieLaunched)continue;const s=p.aircraftState;if(!s.clusterId)s.formationId=p.groupId??s.formationId??null;const key=JSON.stringify([p.unitId,p.snapshot,p.sizeLevel,p.side,p.faction,s.activeLoadoutId,s.formationId,s.flightPlan?{kind:s.flightPlan.kind,behavior:s.flightPlan.behavior,homeId:s.flightPlan.homeId,waypoints:s.flightPlan.waypoints,radius:s.flightPlan.radius,altitude:s.flightPlan.altitude,targetId:s.flightPlan.targetId,escortId:s.flightPlan.escortId,attackMethod:s.flightPlan.attackMethod}:null, s.status, s.remainingAirTime]);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(p);}
 const used=new Set();
 for(const planes of buckets.values()){const batches=[];let batch=[];for(const p of planes){if(batch.length>=27||batch.some(q=>Math.hypot(q.x-p.x,q.y-p.y,(q.altitude??0)-(p.altitude??0))>10)){batches.push(batch);batch=[];}batch.push(p);}if(batch.length)batches.push(batch);for(const batch of batches){let id=batch[0].aircraftState.clusterId;if(!id||used.has(id))id=crypto.randomUUID();used.add(id);const old=existing.get(id);const group=old??{id,name:`${batch[0].snapshot.name} / ${batch[0].snapshot.aircraft.loadouts.find(l=>l.id===batch[0].aircraftState.activeLoadoutId)?.name??'空載'}${batch[0].aircraftState.formationId?' / '+batch[0].aircraftState.formationId:''} 航空集群`,kind:'cluster',parentId:null,aviationCluster:true};if(!old)scene.groups.push(group);for(const p of batch){p.groupId=id;p.aircraftState.clusterId=id;}}}
 // 不删除已有编队标识或历史引用；空集群仅停止显示。
}
export function reconcileAviation(scene){
 if(!scene.aviationRuntime)return;
 advanceAirshipBaseServices(scene);
 const planes=scene.instances.filter(p=>hasAircraftTemplate(p)&&p.aircraftState?.hostId);if(!planes.length)return;
 const hosts=new Map(scene.instances.filter(h=>['navy','building'].includes(h.branch)).map(h=>[h.instanceId,h])),lanes=new Map();
 for(const p of planes){const s=p.aircraftState,host=hosts.get(s.hostId);if(!host)fail('搭載機の母艦参照がありません。');if(s.mission!=='landing'){p.x=host.x;p.y=host.y;}if(!lanes.has(host.instanceId))lanes.set(host.instanceId,new Set([...aviationRunways(host).map(r=>r.id),...(aircraftFacilityCompatible('seaplane',host)?[WATER_LANE]:[])]));
  if(!aviationHostAlive(host)||s.runwayId&&!lanes.get(host.instanceId).has(s.runwayId)){if(['ready','launching'].includes(s.mission)){s.status='destroyed';p.currentHp=0;s.destroyedReason='runway-destroyed';}if(s.mission==='landing')s.mission='parked';s.prepared=false;s.runwayId=null;s.dueTurn=null;}
 }
}

export function operateAirshipBase(scene,{hostId,runwayId,unitId,operation}){
 roundStart(scene);const {host,runway}=runwayFor(scene,hostId,runwayId),unit=scene.instances.find(u=>u.instanceId===unitId);own(scene,unit);
 if(!isAirshipBase(host)||!isAirship(unit)||!aviationHostAlive(unit)||unit.side!==host.side)fail('空中艦基地と同陣営の行動可能な空中艦を指定してください。');
 const state=unit.airshipBaseState??{mission:'airborne',hostId:null,runwayId:null,prepared:false};
 if(operation==='landing'){
  if(state.mission!=='airborne'||Math.hypot(unit.x-host.x,unit.y-host.y)>25+1e-7)fail('空中艦は基地半径25マス以内から入港してください。');
  reserveRunway(scene,host,runway,'landing',1);Object.assign(state,{mission:runway.kind==='catapult'?'parked':'landing',hostId,runwayId:runway.id,prepared:false,dueTurn:runway.kind==='catapult'?null:scene.turn.number+1});
 }else if(operation==='prepare'){
  if(state.hostId!==hostId||!['parked','ready'].includes(state.mission)||Math.hypot(unit.x-host.x,unit.y-host.y)>25+1e-7)fail('基地に入港した空中艦を指定してください。');
  if(state.preparedTurn===scene.turn.number)fail('今ラウンドは整備済みです。');
  let use=scene.aviationRuntime.preparationUse.find(u=>u.hostId===hostId&&u.turnNumber===scene.turn.number);if((use?.count??0)+1>supportCapacity(host,'preparation-area')*9)fail('今ラウンドの整備能力を超えています。');if(!use){use={hostId,turnNumber:scene.turn.number,count:0};scene.aviationRuntime.preparationUse.push(use);}use.count++;
  unit.shipState.remainingEndurance=readShipProfile(unit).enduranceBudget;for(const g of unit.equipmentState.groups){g.remainingAmmo=readEffectiveInitialAmmo(g);g.lastUsedTurn=null;}
  Object.assign(state,{mission:'ready',runwayId:runway.id,prepared:true,preparedTurn:scene.turn.number});
 }else if(operation==='takeoff'){
  if(state.hostId!==hostId||state.runwayId!==runwayId||state.mission!=='ready'||!state.prepared)fail('この滑走路で整備済みの空中艦を指定してください。');reserveRunway(scene,host,runway,'takeoff',1);Object.assign(state,{mission:runway.kind==='catapult'?'airborne':'launching',prepared:false,dueTurn:runway.kind==='catapult'?null:scene.turn.number+1});if(state.mission==='airborne')state.hostId=null;
 }else fail('空中艦の基地操作が不正です。');
 unit.airshipBaseState=state;scene.aviationRuntime.records.push({kind:'airship-'+operation,turnNumber:scene.turn.number,hostId,unitId,runwayId});
}
export function advanceAirshipBaseServices(scene){
 const hosts=new Map(scene.instances.map(u=>[u.instanceId,u]));
 for(const unit of scene.instances){const state=unit.airshipBaseState;if(!state||state.mission==='airborne')continue;const host=hosts.get(state.hostId);if(!aviationHostAlive(host)){Object.assign(state,{mission:'airborne',hostId:null,runwayId:null,prepared:false,dueTurn:null});continue;}
  if(['landing','launching'].includes(state.mission)&&state.dueTurn<=scene.turn.number){if(state.mission==='launching')Object.assign(state,{mission:'airborne',hostId:null,runwayId:null,prepared:false,dueTurn:null});else Object.assign(state,{mission:'parked',prepared:false,dueTurn:null});}
 }
}
