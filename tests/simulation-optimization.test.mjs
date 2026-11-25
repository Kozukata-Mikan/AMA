import test from 'node:test';import assert from 'node:assert/strict';
import {encodeSpecialHistory,decodeSpecialHistory} from '../tactical-map/special-history-codec.js';
import {freezeSpecialHistory,copySceneWithSpecialHistory,isImmutableSpecialRecord} from '../tactical-map/special-history-snapshot.js';
import {getVisibility,getObserverVisibility,initializeSimulationFeatures} from '../tactical-map/simulation-features.js?v=field-support-1';
import {ensureShipRuntime} from '../tactical-map/ship-runtime.js?v=field-support-1';import {ensureUnitCombatRuntime} from '../tactical-map/equipment-runtime.js?v=field-support-1';
import {source,ship} from './fixtures.mjs';
const copy=x=>JSON.parse(JSON.stringify(x));
function history(){const eq={groups:[{id:'gun',ammo:6,damaged:false}],itemDamage:{items:{front:{damaged:false}}}};return {specialRuntime:{version:1,lastFireFloodingTurn:2,records:[1,2].map(turn=>({version:1,step:'fire-flooding',turnNumber:turn,phaseId:'special',shipReports:[{version:1,targetId:'ship',turnNumber:turn,phaseId:'special',skipped:false,rolls:[{type:'fire',coin:turn===1,success:turn===1}],events:[],beforeEquipmentState:copy(eq),afterEquipmentState:copy(eq),futureField:{preserved:true}}],rescueInterruptions:[]}))},instances:[{currentHp:10}],otherField:{preserved:true}}}
test('history dictionary round trips full reports exactly and reduces repeated payloads',()=>{
 const scene=history(),before=JSON.stringify(scene),packed=encodeSpecialHistory(scene);assert.equal(packed.specialHistoryEncoding.equipmentStates.length,1);assert(JSON.stringify(packed).length<before.length);assert.equal(JSON.stringify(scene),before);assert.deepEqual(decodeSpecialHistory(copy(packed)),scene);
 const updated=copy(scene);updated.specialRuntime.records[1].shipReports[0].afterEquipmentState.groups[0].ammo=2;assert.equal(encodeSpecialHistory(updated).specialHistoryEncoding.equipmentStates.length,2);assert.deepEqual(decodeSpecialHistory(copy(encodeSpecialHistory(updated))),updated);
});
test('old histories, missing optional fields, future fields and nullable metadata remain lossless',()=>{
 const scene=history();assert.equal(decodeSpecialHistory(scene),scene);delete scene.specialRuntime.records[0].shipReports[0].beforeEquipmentState;scene.specialRuntime.records[1].shipReports[0].afterEquipmentState=null;
 assert.deepEqual(decodeSpecialHistory(copy(encodeSpecialHistory(scene))),scene);assert.equal(encodeSpecialHistory({instances:[]}).instances.length,0);
});
test('malformed dictionary version, records and references fail before save',()=>{
 for(const mutate of [x=>x.specialHistoryEncoding.version=2,x=>x.specialHistoryEncoding.equipmentStates=null,x=>x.specialRuntime.records=null,x=>x.specialRuntime.records[0].shipReports=null,x=>x.specialRuntime.records[0].shipReports[0].beforeEquipmentState={$equipmentState:-1},x=>x.specialRuntime.records[0].shipReports[0].beforeEquipmentState={$equipmentState:1},x=>x.specialRuntime.records[0].shipReports[0].beforeEquipmentState={$equipmentState:0,extra:true}]){const value=copy(encodeSpecialHistory(history()));mutate(value);assert.throws(()=>decodeSpecialHistory(value))}
});
test('only owned deep immutable history is shared; public mutable inputs stay independent',()=>{
 const original=history(),mutableCopy=copySceneWithSpecialHistory(original);mutableCopy.specialRuntime.records[0].shipReports[0].beforeEquipmentState.groups[0].ammo=1;assert.equal(original.specialRuntime.records[0].shipReports[0].beforeEquipmentState.groups[0].ammo,6);
 const owned=freezeSpecialHistory(copy(original)),working=copySceneWithSpecialHistory(owned);assert.equal(working.specialRuntime.records[0],owned.specialRuntime.records[0]);assert.notEqual(working.specialRuntime.records,owned.specialRuntime.records);assert(isImmutableSpecialRecord(working.specialRuntime.records[0]));assert.throws(()=>working.specialRuntime.records[0].shipReports[0].beforeEquipmentState.groups[0].ammo=0);
 working.instances[0].currentHp=1;working.specialRuntime.records.push({new:true});assert.equal(owned.instances[0].currentHp,10);assert.equal(owned.specialRuntime.records.length,2);
 const shallowFrozen=Object.freeze(copy(original.specialRuntime.records[0]));const external={...original,specialRuntime:{...original.specialRuntime,records:[shallowFrozen]}};assert.notEqual(copySceneWithSpecialHistory(external).specialRuntime.records[0],shallowFrozen);
});
function scene(){const s=source();s.turn={number:1,phaseId:'movement',elapsedMinutes:0};for(const u of s.instances){ensureShipRuntime(u);ensureUnitCombatRuntime(u)}initializeSimulationFeatures(s);return s}
function uncachedVisibility(s){const side=s.controls.enemyAutonomy?'ally':s.controls.observationSide,result=new Map();for(const t of s.instances){if(t.side===side){result.set(t.instanceId,'identified');continue}let found=null;for(const o of s.instances.filter(o=>o.side===side)){const level=getObserverVisibility(s,o,t);if(level==='identified'){found=level;break}if(level==='shadow')found=level}if(found)result.set(t.instanceId,found)}return result}
test('query-local recon reuse matches per-observer results for all sides and leaves inputs untouched',()=>{
 const s=scene();s.instances.push(ship('c','neutral',150));ensureShipRuntime(s.instances[2]);ensureUnitCombatRuntime(s.instances[2]);
 for(const side of ['ally','enemy','neutral'])for(const time of ['04:30','12:00','23:00']){s.controls.observationSide=side;s.environment.time=time;const before=JSON.stringify(s);assert.deepEqual(getVisibility(s),uncachedVisibility(s));assert.equal(JSON.stringify(s),before)}
});
test('damage, retained discovery expiry, movement, terrain and observation changes invalidate naturally',()=>{
 const s=scene(),a=s.instances[0],b=s.instances[1];assert.equal(getVisibility(s).get('b'),'shadow');
 const recon=a.equipmentState.itemDamage.items['sea-recon'];recon.damaged=true;recon.damagedTurn=1;recon.discoveries=[{targetId:'b',level:'identified'}];assert.equal(getVisibility(s).get('b'),'identified');
 s.turn.number=2;assert(!getVisibility(s).has('b'));recon.damaged=false;recon.damagedTurn=null;recon.discoveries=[];assert.equal(getVisibility(s).get('b'),'shadow');b.x=1000;assert(!getVisibility(s).has('b'));b.x=50;assert.equal(getVisibility(s).get('b'),'identified');
 s.terrain.heights.fill(40);assert(!getVisibility(s).has('b'));s.terrain.heights.fill(-20);assert.equal(getVisibility(s).get('b'),'identified');
 a.shipState.status='sunk';assert(!getVisibility(s).has('b'));s.controls.observationSide='enemy';assert.equal(getVisibility(s).get('b'),'identified');
});

test('legacy full histories reopen, compact on successful save and preserve public copy contracts',async()=>{
 const {resetDatabase}=await import('./save-test-environment.mjs');await resetDatabase();globalThis.localStorage={getItem:()=>null,setItem(){}};
 const {createSimulation,openSimulation}=await import('../tactical-map/simulation-store.js?v=field-support-1'),{readSave,writeSave}=await import('../js/save-database.js');
 const id=await createSimulation(source(),()=>({valid:true}));let store=await openSimulation(id);
 await store.beginMovement();await store.resolveMovement();for(let n=0;n<6;n++)await store.settleAttackPhase(store.getSceneSnapshot().revision);await store.finishSpecialPhase(store.getSceneSnapshot().revision);await store.finishTurn(store.getSceneSnapshot().revision);
 const key='junqi-simulation-v1:'+id,packedRaw=await readSave(key),full=decodeSpecialHistory(JSON.parse(packedRaw));assert(full.specialRuntime.records[0].shipReports.length>0);
 const legacy=JSON.stringify(full);await writeSave(key,legacy,{expectedRaw:packedRaw});store=await openSimulation(id);const before=store.getSceneSnapshot();await store.beginMovement();
 const rewritten=JSON.parse(await readSave(key));assert.equal(rewritten.specialHistoryEncoding.version,1);assert.deepEqual(decodeSpecialHistory(rewritten).specialRuntime,full.specialRuntime);assert.equal(store.getSceneSnapshot().turn.number,before.turn.number);
 const publicCopy=store.getScene();publicCopy.instances[0].currentHp=0;assert.notEqual(store.getScene().instances[0].currentHp,0);assert(!('specialHistoryEncoding' in publicCopy));assert(!('specialRuntime' in publicCopy));
 const corrupted=copy(rewritten);corrupted.specialRuntime.records[0].shipReports[0].beforeEquipmentState={$equipmentState:99999};const validRaw=await readSave(key),badRaw=JSON.stringify(corrupted);await writeSave(key,badRaw,{expectedRaw:validRaw});await assert.rejects(()=>openSimulation(id),/参照/);assert.equal(await readSave(key),badRaw);
});
