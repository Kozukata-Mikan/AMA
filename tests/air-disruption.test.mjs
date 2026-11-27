import test from 'node:test';
import assert from 'node:assert/strict';
import {ship,source} from './fixtures.mjs';
import {normalizeAircraft} from '../js/aircraft-template.js';
import {ensureAircraftRuntime} from '../tactical-map/aircraft-runtime.js?v=aviation-deck-1';
import {ensureUnitCombatRuntime} from '../tactical-map/equipment-runtime.js?v=field-support-1';
import {applyAirDisruption,airDisruptionPenalty} from '../tactical-map/air-disruption.js?v=air-defense-1';
import {createSimulation,openSimulation} from '../tactical-map/simulation-store.js?v=resume-save-1';
import {captureAttackPhaseStart} from '../tactical-map/simulation-attack-batch.js?v=aviation-deck-1';
import {settleAttackPhase} from '../tactical-map/simulation-settlement.js?v=aviation-deck-1';
import {readSave,writeSave} from '../js/save-database.js';
import {resetDatabase} from './save-test-environment.mjs';
const gun=(id,n=1,order=5)=>({id,name:id,kind:'weapon',barrelCount:n,projectionCoefficient:1,projectionSuffix:'R',ammo:1000,powerRule:'1',penetration:'A',guidance:'平射',range:300,ceilingU:100,maxOrder:String(order),targetScope:'単体'});
function plane(id){const p=ship(id,'ally',30);p.branch=p.snapshot.branch='air';p.unitId=p.snapshot.id='plane';p.altitude=20;p.currentHp=p.snapshot.maxHp=2;p.groupId='air';p.snapshot.aircraft=normalizeAircraft({engines:2,ceiling:100,maneuverability:'2R',training:'regular',attackModes:['dive']});p.snapshot.naval={...p.snapshot.naval,speedKnots:200,endurance:'1k'};p.snapshot.equipmentSnapshots=[gun('airgun',3),gun('later',2,3)];p.snapshot.mounts=[{position:'主動武器',equipmentId:'airgun',count:1},{position:'主動武器',equipmentId:'later',count:1}];ensureAircraftRuntime(p);ensureUnitCombatRuntime(p);return p;}
function scene(){const s=source();s.instances=[ship('aa1','enemy',0),ship('aa2','enemy',-10),...Array.from({length:12},(_,i)=>plane('p'+i))];for(const u of s.instances.slice(0,2)){u.snapshot.equipmentSnapshots=[gun('flak',60)];u.snapshot.mounts=[{position:'中部①',equipmentId:'flak',count:1}];}s.groups=[{id:'air',name:'air',kind:'cluster',parentId:null}];s.turn={number:1,phaseId:'order-5'};return s;}
const entries=[{commandId:'one',unitId:'aa1',projection:{groups:1,coinsPerGroup:60}},{commandId:'two',unitId:'aa2',projection:{groups:1,coinsPerGroup:60}}];
test('two ships aggregate 120 projections over 12 aircraft into exactly one penalty',()=>{const s=scene(),r=applyAirDisruption(s,entries,[{commandId:'one',targetIds:['p0']},{commandId:'two',targetIds:['p1']}]);assert.equal(r.reports[0].projection,120);assert.equal(r.reports[0].aircraftCount,12);assert.equal(r.reports[0].addedPenalties,1);assert.ok(s.instances.slice(2).every(p=>airDisruptionPenalty(s,p)===1));s.turn.phaseId='order-4';applyAirDisruption(s,entries,[{commandId:'one',targetIds:['p0']},{commandId:'two',targetIds:['p1']}]);assert.equal(airDisruptionPenalty(s,s.instances[2]),2);s.turn.number=2;assert.equal(airDisruptionPenalty(s,s.instances[2]),0);});
test('formation expansion and repeated occurrences do not multiply the same volley',()=>{const s=scene();const r=applyAirDisruption(s,entries,[{commandId:'one',targetIds:[...s.instances.slice(2).map(p=>p.instanceId),'p0']},{commandId:'two',targetIds:['p1']}]);assert.equal(r.reports[0].projection,120);});
test('rounding is per phase, excludes air-to-air volleys and grounded/destroyed aircraft',()=>{const s=scene();s.instances[2].aircraftState.mission='parked';s.instances[3].aircraftState.status='destroyed';const e={commandId:'short',unitId:'aa1',projection:{groups:1,coinsPerGroup:99}},a=[{commandId:'short',targetIds:['p2']}];assert.equal(applyAirDisruption(s,[e],a).reports[0].addedPenalties,0);s.turn.phaseId='order-4';assert.equal(applyAirDisruption(s,[e],a).reports[0].addedPenalties,0);const air={...e,unitId:'p3'};assert.deepEqual(applyAirDisruption(s,[air],a).reports,[]);s.instances[0].snapshot.naval.kind='air';assert.deepEqual(applyAirDisruption(s,[e],a).reports,[]);});
async function planned(){await resetDatabase();globalThis.localStorage={getItem:()=>null,setItem(){}};const input=scene();delete input.turn;const id=await createSimulation(input,()=>({valid:true})),store=await openSimulation(id);await store.beginMovement();await store.resolveMovement();await store.saveAttackCommands({unitId:'p0',attackMethod:'dive',assignments:[{groupId:'mount-0-group-0',targetId:'aa1'},{groupId:'mount-1-group-0',targetId:'aa1'}]},store.getSceneSnapshot().revision);await store.setObservationSide('enemy');for(const id of ['aa1','aa2'])await store.saveAttackCommands({unitId:id,assignments:[{groupId:'mount-0-group-0',targetId:'p0'}]},store.getSceneSnapshot().revision);return{id,store,raw:JSON.parse(await readSave('junqi-simulation-v1:'+id))};}
test('real order attacks can miss completely but still penalize aircraft in the SAME order and later orders',async()=>{const {raw,id}=await planned();settleAttackPhase(raw,()=>false);const record=raw.settlementRuntime.attackRecords.at(-1);assert.ok(record.hitReports.every(h=>h.hit.hitCount===0));assert.equal(record.airDisruptionReports[0].projection,120);const attack=record.hitReports.find(h=>h.unitId==='p0');assert.equal(attack.modifiers.airDisruption,1);assert.equal(attack.hit.remainingPenalties,1);assert.ok(attack.hit.stackRounds.some(r=>r.kind==='penalty'));raw.attackBatchRuntime.snapshot=null;captureAttackPhaseStart(raw);settleAttackPhase(raw,()=>false);raw.attackBatchRuntime.snapshot=null;captureAttackPhaseStart(raw);settleAttackPhase(raw,()=>false);const later=raw.settlementRuntime.attackRecords.at(-1).hitReports.find(h=>h.unitId==='p0');assert.equal(later.modifiers.airDisruption,1);raw.attackBatchRuntime.snapshot=null;captureAttackPhaseStart(raw);await writeSave('junqi-simulation-v1:'+id,JSON.stringify(raw),{expectedRaw:await readSave('junqi-simulation-v1:'+id)});const loaded=await openSimulation(id);await loaded.setObservationSide('ally');assert.equal(loaded.getSceneSnapshot().instances.find(p=>p.instanceId==='p0').aircraftState.disruption.penalties,1);});
test('invalid hit RNG aborts without saving ammo, penalties or phase progress',async()=>{const {store,id}=await planned();const before=await readSave('junqi-simulation-v1:'+id);const raw=JSON.parse(before);assert.throws(()=>settleAttackPhase(raw,()=>42));assert.equal(await readSave('junqi-simulation-v1:'+id),before);assert.equal(store.getSceneSnapshot().turn.phaseId,'order-5');});

test('air combat also receives the current-round disruption penalty without modifying maneuver dice',async()=>{
 const {saveAirCombat,resolveAirCombat}=await import('../tactical-map/air-combat.js?v=aviation-deck-1');
 const s=scene(),a=s.instances[2],b=plane('enemy-plane');b.side='enemy';b.groupId=null;b.x=50;s.instances.push(b);s.controls={observationSide:'ally',enemyAutonomy:false};
 a.aircraftState.disruption={turnNumber:1,penalties:2};
 saveAirCombat(s,{actorIds:[a.instanceId],targetIds:[b.instanceId]});
 const [r]=resolveAirCombat(s,()=>false),shots=r.duels.flatMap(d=>d.shots??[]).filter(h=>h.actorId===a.instanceId);
 assert.ok(shots.length);assert.ok(shots.every(h=>h.disruptionPenalty===2&&h.hit.penalties>=2));
 assert.equal(r.duels[0].dice[0].length,2);
});
test('air combat prevalidated at phase start does not abort when AA destroys its target in the same phase',async()=>{
 const {raw}=await planned();
 const {ensureShipRuntime}=await import('../tactical-map/ship-runtime.js?v=field-support-1');
 const {saveAirCombat}=await import('../tactical-map/air-combat.js?v=aviation-deck-1');
 const {initializeAirTraining}=await import('../tactical-map/air-training-runtime.js');
 // The AA target is already heavy at phase start; the next hit shoots it down.
 const target=raw.instances.find(u=>u.instanceId==='p0');target.currentHp=0;target.aircraftState.status='heavy';
 const actor=plane('enemy-air');actor.side='enemy';actor.groupId=null;actor.x=60;ensureShipRuntime(actor);raw.instances.push(actor);
 raw.controls.observationSide='enemy';
 raw.attackRuntime.commands=raw.attackRuntime.commands.filter(c=>c.unitId!=='p0');
 initializeAirTraining(raw);raw.attackBatchRuntime.snapshot=null;captureAttackPhaseStart(raw);
 saveAirCombat(raw,{actorIds:[actor.instanceId],targetIds:[target.instanceId]});
 settleAttackPhase(raw,()=>true);
 assert.equal(target.aircraftState.status,'heavy'); // Transactions replace instances.
 assert.equal(raw.instances.find(p=>p.instanceId==='p0').aircraftState.status,'destroyed');
 assert.equal(raw.airCombatRuntime.records.length,1);
 assert.equal(raw.turn.phaseId,'order-4');
});
