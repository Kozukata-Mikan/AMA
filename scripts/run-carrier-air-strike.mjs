// Reproducible integration exercise using the same persisted store transactions
// as the browser. The seeded RNG exists only in this isolated Node test process.
import {writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {carrierAirStrikeScene,TEST_SEED} from '../tests/scenarios/carrier-air-strike.mjs';
import {resetDatabase} from '../tests/save-test-environment.mjs';
import {createSimulation,openSimulation} from '../tactical-map/simulation-store.js?v=day-catalog-pas-1';
import {readSave} from '../js/save-database.js';
import {aviationRunways} from '../tactical-map/aviation-operations.js?v=day-catalog-pas-1';

export async function runCarrierAirStrike({outputDirectory=null}={}) {
  const originalCrypto=globalThis.crypto;
  let seed=TEST_SEED;
  const next=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:{
    getRandomValues(array){for(let i=0;i<array.length;i++)array[i]=next();return array;},
    randomUUID(){const hex=Array.from({length:4},()=>next().toString(16).padStart(8,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20)}`;}
  }});
  try {
    await resetDatabase();globalThis.localStorage={getItem:()=>null,setItem(){}};
    const input=carrierAirStrikeScene(),id=await createSimulation(input,()=>({valid:true}));
    let store=await openSimulation(id);
    const raw=async()=>JSON.parse(await readSave('junqi-simulation-v1:'+id));
    const logs=[],timings=[];
    const squad=(s,name)=>s.instances.filter(u=>u.branch==='air'&&u.unitId===name);
    const living=(s,name)=>squad(s,name).filter(p=>p.aircraftState.status!=='destroyed');
    for(let round=1;round<=5;round++) {
      const started=performance.now();let s=await raw();
      if(round===1) {
        for(const [side,hostId,names]of [['ally','味方飛行場',['A隊','B隊','C隊']],['enemy','敵空母',['D隊']]]) {
          await store.setObservationSide(side);s=await raw();
          const lanes=aviationRunways(s.instances.find(u=>u.instanceId===hostId));
          for(const [i,name]of names.entries()) {
            const aircraftIds=squad(s,name).map(p=>p.instanceId),runwayId=lanes[i].id;
            await store.prepareAircraft({hostId,runwayId,aircraftIds,loadoutId:name==='D隊'?null:'strike'});
            const plan=name==='D隊'?{kind:'CAP',behavior:'engage',radius:70,altitude:20}:{kind:'CAS',behavior:'adjust',targetId:'敵空母',attackMethod:name==='B隊'?'torpedo':name==='C隊'?'level':'dive',altitude:name==='B隊'?10:name==='C隊'?60:20};
            await store.assignFlightMission({aircraftIds,plan});
            await store.launchAircraft({hostId,runwayId,aircraftIds});
            logs.push({round,event:'takeoff-registered',squad:name,count:aircraftIds.length,dueRound:2,loadout:name==='D隊'?'empty':'strike',plan});
          }
        }
      }
      await store.setObservationSide('ally');
      await store.beginMovement();await store.resolveMovement();
      s=await raw();logs.push({round,event:'movement',squads:['A隊','B隊','C隊','D隊'].map(name=>({name,planes:living(s,name).map(p=>({id:p.instanceId,x:p.x,y:p.y,z:p.altitude,status:p.aircraftState.status,mission:p.aircraftState.mission,stage:p.aircraftState.flightPlan?.stage,airTime:p.aircraftState.remainingAirTime}))}))});
      for(let phase=0;phase<6;phase++) {
        s=await raw();const phaseId=s.turn.phaseId,phaseStart=performance.now();
        if(round===2&&phaseId==='order-5') {
          await store.setObservationSide('enemy');
          for(const shipId of ['護衛艦1','護衛艦2','敵空母']) {
            const actor=s.instances.find(u=>u.instanceId===shipId),assignments=[];
            for(const g of actor.equipmentState.groups) {
              const e=actor.snapshot.equipmentSnapshots.find(e=>e.id===g.equipmentId);
              if(e.kind!=='weapon'||String(e.maxOrder)==='PAS')continue;
              const name=e.id.endsWith('C')?'C隊':'B隊',target=living(s,name).find(p=>p.aircraftState.mission==='airborne');
              if(target)assignments.push({groupId:g.id,targetId:target.instanceId});
            }
            if(assignments.length)await store.saveAttackCommands({unitId:shipId,assignments},store.getSceneSnapshot().revision);
          }
          await store.setObservationSide('ally');
        }
        await store.settleAttackPhase(store.getSceneSnapshot().revision);
        const after=await raw(),record=after.settlementRuntime.attackRecords.at(-1);
        logs.push({round,event:'attack-phase',phaseId,record,airCombat:after.airCombatRuntime.records.filter(r=>r.turnNumber===round&&r.phaseId===phaseId)});
        timings.push({round,phaseId,milliseconds:performance.now()-phaseStart});
      }
      await store.finishSpecialPhase(store.getSceneSnapshot().revision);
      await store.finishTurn(store.getSceneSnapshot().revision);
      s=await raw();
      logs.push({round,event:'round-end',time:s.environment.time,ships:s.instances.filter(u=>u.branch!=='air').map(u=>({id:u.instanceId,hp:u.currentHp,status:u.shipState?.status??u.buildingState?.status})),squads:['A隊','B隊','C隊','D隊'].map(name=>({name,planes:squad(s,name).map(p=>({id:p.instanceId,hp:p.currentHp,status:p.aircraftState.status,mission:p.aircraftState.mission,panic:p.aircraftState.panic,airTime:p.aircraftState.remainingAirTime,stage:p.aircraftState.flightPlan?.stage,reason:p.aircraftState.destroyedReason,ammo:p.equipmentState.groups.map(g=>({id:g.id,position:g.position,remaining:g.remainingAmmo}))}))}))});
      timings.push({round,phaseId:'full-round',milliseconds:performance.now()-started});
      // Reopen from IndexedDB each round to exercise persistence, rather than
      // running an in-memory calculator with manual state advancement.
      store=await openSimulation(id);
      if(round>=3&&['A隊','B隊','C隊'].every(name=>living(s,name).every(p=>p.aircraftState.mission==='parked')))break;
    }
    const final=await raw();
    const result={seed:TEST_SEED,engine:'production store + background task compatibility path + IndexedDB',input,logs,timings,
      summary:{rounds:final.turn.number-1,time:final.environment.time,ships:final.instances.filter(u=>u.branch!=='air').map(u=>({name:u.name,hp:u.currentHp,maxHp:u.snapshot.maxHp,status:u.shipState?.status??u.buildingState?.status})),
      squadrons:['A隊','B隊','C隊','D隊'].map(name=>({name,total:squad(final,name).length,destroyed:squad(final,name).filter(p=>p.aircraftState.status==='destroyed').length,heavy:living(final,name).filter(p=>p.aircraftState.status==='heavy').length,damaged:living(final,name).filter(p=>p.currentHp>0&&p.currentHp<p.snapshot.maxHp).length,parked:living(final,name).filter(p=>p.aircraftState.mission==='parked').length,airborne:living(final,name).filter(p=>p.aircraftState.mission==='airborne').length})),
      airCombats:final.airCombatRuntime.records.length,duels:final.airCombatRuntime.records.flatMap(r=>r.duels).length,disruption:final.settlementRuntime.attackRecords.flatMap(r=>r.airDisruptionReports??[])},final};
    if(outputDirectory){await mkdir(outputDirectory,{recursive:true});await writeFile(outputDirectory+'/carrier-air-strike.json',JSON.stringify(result,null,2));await writeFile(outputDirectory+'/carrier-air-strike-scene.json',JSON.stringify(input));}
    return result;
  } finally {Object.defineProperty(globalThis,'crypto',{configurable:true,value:originalCrypto});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const result=await runCarrierAirStrike({outputDirectory:process.argv[2]??'/tmp/ama-carrier-air-strike'});console.log(JSON.stringify(result.summary,null,2));}
  catch(e){console.error(e);console.error(e.cause);process.exitCode=1;}
}
