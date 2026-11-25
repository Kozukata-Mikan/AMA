import {writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {fourAirScene} from '../tests/scenarios/four-air-exercises.mjs';
import {resetDatabase} from '../tests/save-test-environment.mjs';
import {createSimulation,openSimulation} from '../tactical-map/simulation-store.js?v=air-exercises-1';
import {readSave} from '../js/save-database.js';
import {aviationRunways} from '../tactical-map/aviation-operations.js?v=air-exercises-1';
import {assertAircraftLaunchTime} from '../tactical-map/aviation-time.js?v=day-catalog-pas-1';
import {getObserverVisibility,getVisibility} from '../tactical-map/simulation-features.js?v=air-exercises-1';
const clone=structuredClone;
export async function runAirExercise(number,{seed=20261125,outputDirectory=null,searchFirst=false}={}){
 const originalCrypto=globalThis.crypto;let rng=seed,randomCalls=0;
 function next(){randomCalls++;rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;return rng>>>0;}
 Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues(a){for(let i=0;i<a.length;i++)a[i]=next();return a;},randomUUID(){return Array.from({length:4},()=>next().toString(16).padStart(8,'0')).join('-');}}});
 try{
  await resetDatabase();globalThis.localStorage={getItem:()=>null,setItem(){}};
  const spec=fourAirScene(number);if(number===2&&searchFirst){spec.scene.instances.find(p=>p.side==='ally').snapshot.naval.aswRecon=null;for(const x of spec.sorties)x.plan={kind:'CAR',behavior:'priority',altitude:20,waypoints:[{x:100,y:0}]};}const input=clone(spec.scene),id=await createSimulation(input,()=>({valid:true}));let store=await openSimulation(id);
  const raw=async()=>JSON.parse(await readSave('junqi-simulation-v1:'+id));const logs=[],timings=[];const initial=await raw();logs.push({event:'initial-visibility',visibility:[...getVisibility(initial)]});
  const planes=(s,name)=>s.instances.filter(p=>p.branch==='air'&&p.unitId===name);
  const live=(s,name)=>planes(s,name).filter(p=>p.aircraftState.status!=='destroyed'&&p.aircraftState.mission==='airborne');
  for(let round=1;round<=spec.rounds;round++){
   const start=performance.now();let s=await raw();
   if(round===1){
    for(const sortie of spec.sorties){await store.setObservationSide(sortie.side);s=await raw();const home=s.instances.find(p=>p.instanceId===sortie.hostId),index=spec.sorties.filter(x=>x.hostId===sortie.hostId).findIndex(x=>x.name===sortie.name),runwayId=aviationRunways(home)[index].id,aircraftIds=planes(s,sortie.name).map(p=>p.instanceId);
     if(number===3&&sortie===spec.sorties[0]){const normal=clone(planes(s,sortie.name)[0]);normal.snapshot.equipmentSnapshots=normal.snapshot.equipmentSnapshots.filter(e=>e.supportEffect!=='night-observation');try{assertAircraftLaunchTime(s,normal);logs.push({event:'night-limit-control',accepted:true});}catch(e){logs.push({event:'night-limit-control',accepted:false,message:e.message});}}
     await store.prepareAircraft({hostId:sortie.hostId,runwayId,aircraftIds,loadoutId:sortie.loadoutId});await store.assignFlightMission({aircraftIds,plan:sortie.plan});await store.launchAircraft({hostId:sortie.hostId,runwayId,aircraftIds});logs.push({event:'takeoff',round,name:sortie.name,count:aircraftIds.length,dueRound:2,plan:sortie.plan});
    }
   }
   await store.setObservationSide('ally');await store.beginMovement();await store.resolveMovement();s=await raw();
   const seen=getVisibility({...s,controls:{...s.controls,enemyAutonomy:false,observationSide:'ally'}});
   logs.push({event:'movement',round,environment:s.environment,planes:s.instances.filter(p=>p.branch==='air').map(p=>({id:p.instanceId,name:p.unitId,x:p.x,y:p.y,z:p.altitude,hp:p.currentHp,status:p.aircraftState.status,mission:p.aircraftState.mission,stage:p.aircraftState.flightPlan?.stage,lowFlying:p.aircraftState.flightPlan?.lowFlying,ramTargetId:p.aircraftState.ramTargetId})),visibility:[...seen]});
   if(number===2&&round===2){const low=live(s,'A遊雲隊')[0],probe=clone(s.instances.find(p=>p.instanceId==='敵潜水艦'));probe.x=low.x+150;probe.y=low.y;probe.underwater=false;probe.depth=0;probe.snapshot.naval.kind='surface';probe.snapshot.naval.airRecon='A';logs.push({event:'low-cloud-recon',round,relativeHeight:low.altitude,at150:getObserverVisibility(s,probe,low),at100:getObserverVisibility(s,{...probe,x:low.x+100},low)});}
   for(let k=0;k<6;k++){
    s=await raw();const phase=s.turn.phaseId,phaseStart=performance.now();
    if(number===1&&round===2&&phase==='order-5'){
     await store.setObservationSide('enemy');const host=s.instances.find(p=>p.instanceId==='敵飛行場'),g=host.equipmentState.groups.find(g=>g.equipmentId==='飛行場対空砲'),target=live(s,'A殉道隊')[0];
     if(target)await store.saveAttackCommands({unitId:host.instanceId,assignments:[{groupId:g.id,targetId:target.instanceId}]},store.getSceneSnapshot().revision);
     await store.setObservationSide('ally');
    }
    if(number===2&&searchFirst&&round===2&&phase==='order-3'){for(const name of ['A遊雲隊','B弁舌隊'])for(const p of live(s,name)){const assignments=p.equipmentState.groups.filter(g=>p.snapshot.equipmentSnapshots.find(e=>e.id===g.equipmentId)?.guidance.includes('水下')).map(g=>({groupId:g.id,targetId:'敵潜水艦',attackMethod:'bvr'}));await store.saveAttackCommands({unitId:p.instanceId,assignments},store.getSceneSnapshot().revision);}}
    if(number===3&&round>=2&&phase==='order-5'){
     const pairs=[['A無畏隊','E無畏隊'],['B伏撃隊','F伏撃隊'],['C希孚隊','G希孚隊'],['D通常隊','H通常隊']];
     for(const [a,b]of pairs){const actorIds=live(s,a).filter(p=>p.aircraftState.status==='operational'&&!['confused','retreating'].includes(p.aircraftState.panic?.state)).map(p=>p.instanceId),targetIds=live(s,b).map(p=>p.instanceId);if(!actorIds.length||!targetIds.length)continue;try{await store.saveAirCombat({actorIds,targetIds});}catch(e){logs.push({event:'plan-rejected',round,pair:[a,b],message:e.message});}}
    }
    await store.settleAttackPhase(store.getSceneSnapshot().revision);const a=await raw();logs.push({event:'attack',round,phase,record:a.settlementRuntime.attackRecords.at(-1),airCombat:a.airCombatRuntime.records.filter(r=>r.turnNumber===round&&r.phaseId===phase)});timings.push({round,phase,milliseconds:performance.now()-phaseStart});
   }
   await store.finishSpecialPhase(store.getSceneSnapshot().revision);await store.finishTurn(store.getSceneSnapshot().revision);s=await raw();logs.push({event:'round-end',round,environment:s.environment,units:s.instances.map(p=>({id:p.instanceId,name:p.unitId,hp:p.currentHp,ship:p.shipState?.status,building:p.buildingState,air:p.aircraftState}))});timings.push({round,phase:'full-round',milliseconds:performance.now()-start});store=await openSimulation(id);
  }
  const final=await raw(),attacks=logs.filter(l=>l.event==='attack'),duels=attacks.flatMap(l=>l.airCombat.flatMap(c=>c.duels));
  const result={number,seed,searchFirst,engine:'Production persisted simulation store / IndexedDB / Node background compatibility path',input,logs,timings,randomCalls,summary:{end:final.environment,rounds:spec.rounds,squadrons:spec.sorties.map(x=>{const ps=planes(final,x.name);return{name:x.name,total:ps.length,destroyed:ps.filter(p=>p.aircraftState.status==='destroyed').length,parked:ps.filter(p=>p.aircraftState.status!=='destroyed'&&p.aircraftState.mission==='parked').length,heavy:ps.filter(p=>p.aircraftState.status==='heavy').length,airborne:ps.filter(p=>p.aircraftState.status!=='destroyed'&&p.aircraftState.mission==='airborne').length};}),targets:final.instances.filter(p=>p.branch!=='air').map(p=>({id:p.instanceId,hp:p.currentHp,maxHp:p.snapshot.maxHp,status:p.shipState?.status??p.buildingState?.status})),airBattles:attacks.reduce((n,l)=>n+l.airCombat.length,0),duels:duels.length,ambushes:duels.flatMap(d=>d.ambush??[]).length,aceLosses:duels.flatMap(d=>d.aceLosses??[]),panic:duels.flatMap(d=>d.panic??[]),rams:attacks.flatMap(l=>l.record.ramReports??[]),hits:attacks.flatMap(l=>l.record.hitReports),damage:attacks.flatMap(l=>l.record.targetReports)},final};
  if(outputDirectory){await mkdir(outputDirectory,{recursive:true});await writeFile(`${outputDirectory}/exercise-${number}.json`,JSON.stringify(result,null,2));await writeFile(`${outputDirectory}/scene-${number}.json`,JSON.stringify(input));}
  return result;
 }finally{Object.defineProperty(globalThis,'crypto',{configurable:true,value:originalCrypto});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const r=await runAirExercise(Number(process.argv[2]),{seed:Number(process.argv[3]??20261125),outputDirectory:process.argv[4]??'/tmp/ama-four-air'});console.log(JSON.stringify(r.summary,null,2));}catch(e){console.error(e,e.cause);process.exitCode=1;}}
