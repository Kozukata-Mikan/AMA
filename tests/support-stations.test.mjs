import test from 'node:test';import assert from 'node:assert/strict';
import {ensureUnitCombatRuntime} from '../tactical-map/equipment-runtime.js?v=visual-support-bridge-1';
import {source,ship} from './fixtures.mjs';import {resetDatabase} from './save-test-environment.mjs';
import {createSimulation,openSimulation} from '../tactical-map/simulation-store.js?v=visual-support-bridge-1';import {readSave,writeSave} from '../js/save-database.js';
import {ensureShipRuntime,readShipProfile,applyShipFireFloodingPhase} from '../tactical-map/ship-runtime.js?v=visual-support-bridge-1';
import {initializeSupportRuntime,startSupport,resolveSupportsAtSpecial,interruptSupportForMovement,reconcileSupports} from '../tactical-map/simulation-support.js?v=visual-support-bridge-1';
import {supportEquipmentSeed,supportCapacity,supportRadius} from '../tactical-map/support-equipment.js?v=visual-support-bridge-1';
import {initializeCatalog} from '../js/catalog-store.js?v=visual-support-bridge-1';import {isSinkingTimerPaused} from '../tactical-map/simulation-rescue.js?v=visual-support-bridge-1';
const arm=(unit,effect,count=1)=>{const item=supportEquipmentSeed().find(e=>e.supportEffect===effect);unit.snapshot.equipmentSnapshots=[item];unit.snapshot.mounts=[{equipmentId:item.id,position:'中部①',count}];};
function field({building=false,effect='repair-station',count=2,targets=2}={}){const scene=source();scene.instances=[ship('p'),...Array.from({length:targets},(_,i)=>ship('t'+i,'ally',8+i*2))];arm(scene.instances[0],effect,count);if(building){scene.instances[0].branch=scene.instances[0].snapshot.branch='building';scene.instances[0].snapshot.building={kind:'port'};}for(const unit of scene.instances){ensureShipRuntime(unit);ensureUnitCombatRuntime(unit);}scene.turn={number:1,phaseId:'special',elapsedMinutes:0};scene.controls={observationSide:'ally',enemyAutonomy:false};initializeSupportRuntime(scene);return scene;}
const sinking=u=>{u.shipState.status='sinking';u.shipState.specialDamageStatus=true;};
const saved=id=>readSave('junqi-simulation-v1:'+id).then(JSON.parse);
async function sim(scene){await resetDatabase();globalThis.localStorage={getItem:()=>null,setItem(){}};const id=await createSimulation(scene,()=>({valid:true}));return{id,store:await openSimulation(id)};}
async function special(store){await store.beginMovement();await store.resolveMovement();for(let i=0;i<6;i++)await store.settleAttackPhase(store.getSceneSnapshot().revision);}

test('station catalog adds five generic support types once and building positions are exposed/underground',()=>{
 const memory=new Map();globalThis.localStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};let catalog=initializeCatalog([]);for(const eq of supportEquipmentSeed())assert.ok(catalog.getData().equipment.some(e=>e.id===eq.id));
 const existing=catalog.getData();existing.supportStationsVersion=0;existing.equipment=existing.equipment.filter(e=>!e.supportEffect);memory.set('junqi-catalog-v1',JSON.stringify(existing));catalog=initializeCatalog([]);assert.equal(catalog.getData().equipment.filter(e=>supportEquipmentSeed().some(seed=>seed.id===e.id)).length,supportEquipmentSeed().length);
 const value={...structuredClone(catalog.units[0]),id:'building-stations',protected:false,branch:'building',building:{kind:'port'},sizeLevel:1,mounts:[{equipmentId:supportEquipmentSeed()[0].id,position:'中央',count:2},{equipmentId:supportEquipmentSeed()[1].id,position:'地下',count:1}]};catalog.saveUnit(value);const found=catalog.units.find(u=>u.id===value.id);assert.deepEqual(found.mounts.map(m=>m.position),['露天','地下']);assert.equal(found.equipmentSnapshots[0].supportEffect,'repair-station');
});
test('station capacity counts usable groups, with no AR-type automatic rescue guarantee',()=>{
 const scene=field(),p=scene.instances[0];assert.equal(supportCapacity(p,'repair-station'),2);p.equipmentState.groups[0].damaged=true;assert.equal(supportCapacity(p,'repair-station'),1);p.equipmentState.groups[1].destroyed=true;assert.equal(supportCapacity(p,'repair-station'),0);
 const ar=ship('ar');ar.snapshot.naval.type='AR';assert.equal(readShipProfile(ar).isRepairShip,false);arm(ar,'repair-station');assert.equal(readShipProfile(ar).isRepairShip,true);
});
test('support radius and parallel slots work for ships and port buildings',()=>{
 for(const building of [false,true]){const scene=field({building,targets:3}),[p,...targets]=scene.instances;for(const t of targets)sinking(t);assert.equal(supportRadius(p),building?25:12.5);targets[0].x=supportRadius(p);startSupport(scene,{providerId:'p',targetId:'t0',kind:'rescue'});startSupport(scene,{providerId:'p',targetId:'t1',kind:'rescue'});assert.throws(()=>startSupport(scene,{providerId:'p',targetId:'t2',kind:'rescue'}),/同時支援数/);assert.ok(p.supportLocked);assert.ok(targets[0].supportLocked);}
 const outside=field();sinking(outside.instances[1]);outside.instances[1].x=12.5001;assert.throws(()=>startSupport(outside,{providerId:'p',targetId:'t0',kind:'rescue'}),/支援円/);
});
test('repair stations rescue all assigned ships on the second special phase without tossing coins',()=>{
 const scene=field();for(const target of scene.instances.slice(1)){sinking(target);startSupport(scene,{providerId:'p',targetId:target.instanceId,kind:'rescue'});}assert.ok(isSinkingTimerPaused(scene,scene.instances[1]));assert.equal(resolveSupportsAtSpecial(scene).length,0);scene.turn.number=2;const results=resolveSupportsAtSpecial(scene,{coinSource:()=>{throw Error('must not toss');}});assert.equal(results.length,2);assert.ok(results.every(r=>r.guaranteed&&r.success));assert.ok(scene.instances.slice(1).every(t=>t.shipState.status==='heavy'&&!t.supportLocked));assert.ok(!scene.instances[0].supportLocked);
});
test('ordinary ships retain coin rescue and failed rescue sinks the target',()=>{
 const scene=field();scene.instances[0].snapshot.equipmentSnapshots=[];scene.instances[0].snapshot.mounts=[];delete scene.instances[0].equipmentState;const t=scene.instances[1];sinking(t);startSupport(scene,{providerId:'p',targetId:'t0',kind:'rescue'});resolveSupportsAtSpecial(scene);scene.turn.number=2;const [result]=resolveSupportsAtSpecial(scene,{coinSource:()=>false});assert.equal(result.guaranteed,false);assert.equal(t.shipState.status,'sunk');
});
test('supply restores at most one quarter of the initial budget per turn and completes at full',()=>{
 const scene=field({effect:'supply-station',targets:1}),target=scene.instances[1],budget=readShipProfile(target).enduranceBudget;target.shipState.remainingEndurance=0;startSupport(scene,{providerId:'p',targetId:'t0',kind:'supply'});
 for(let turn=1;turn<=4;turn++){scene.turn.number=turn;resolveSupportsAtSpecial(scene);assert.equal(target.shipState.remainingEndurance,budget*turn/4);assert.throws(()=>resolveSupportsAtSpecial(scene),/処理済/);}
 assert.equal(scene.supportRuntime.tasks[0].status,'complete');assert.ok(!target.supportLocked);
});
test('external damage control uses the same failure consequences and an extra current-turn attempt',()=>{
 const scene=field({effect:'damage-control-station',targets:1}),target=scene.instances[1];target.shipState.effects.fire={level:'small',acquiredTurn:1,failedControls:0};startSupport(scene,{providerId:'p',targetId:'t0',kind:'damage-control'});
 applyShipFireFloodingPhase(target,{turnNumber:1,phaseId:'special'},()=>false);const before=target.currentHp;const result=resolveSupportsAtSpecial(scene,{coinSource:()=>false,selectRepairIndex:()=>0});assert.equal(result.length,1);assert.equal(target.currentHp,before-1);assert.equal(target.shipState.effects.fire.failedControls,2);
 scene.turn.number=2;resolveSupportsAtSpecial(scene,{coinSource:()=>true});assert.equal(target.shipState.effects.fire,null);assert.equal(scene.supportRuntime.tasks[0].status,'complete');
});
test('movement requires confirmation, cancels all involved support, and leaves completed recovery intact',()=>{
 const scene=field({effect:'supply-station',targets:1}),target=scene.instances[1];target.shipState.remainingEndurance=0;startSupport(scene,{providerId:'p',targetId:'t0',kind:'supply'});resolveSupportsAtSpecial(scene);const recovered=target.shipState.remainingEndurance,before=JSON.stringify(scene);assert.throws(()=>interruptSupportForMovement(scene,['t0'],false),e=>e.code==='SUPPORT_INTERRUPTION_REQUIRED');assert.equal(JSON.stringify(scene),before);interruptSupportForMovement(scene,['t0'],true);assert.equal(target.shipState.remainingEndurance,recovered);assert.ok(!target.supportLocked&&!scene.instances[0].supportLocked);
});
test('lost station capacity interrupts active rescue and restores the paused sinking clock',()=>{
 const scene=field({targets:1,count:2}),target=scene.instances[1];sinking(target);startSupport(scene,{providerId:'p',targetId:'t0',kind:'rescue'});scene.turn.number=2;scene.instances[0].equipmentState.groups.forEach(g=>g.destroyed=true); // ordinary rescue retains one fallback slot
 scene.instances[0].shipState.status='sunk';reconcileSupports(scene);assert.equal(target.shipState.sinkingElapsedMinutes,30);assert.ok(!target.supportLocked);
});
test('real store persists support and atomically confirms movement interruption after turn end',async()=>{
 const input=field({effect:'supply-station',targets:1});input.instances[1].shipState.remainingEndurance=0;const{id,store}=await sim(input);await special(store);await store.startSupport({providerId:'p',targetId:'t0',kind:'supply'});await store.finishSpecialPhase(store.getSceneSnapshot().revision);let raw=await saved(id);assert.ok(raw.instances[0].supportLocked);const restored=raw.instances[1].shipState.remainingEndurance;await store.finishTurn(store.getSceneSnapshot().revision);const reopened=await openSimulation(id);await reopened.beginMovement();const before=await readSave('junqi-simulation-v1:'+id);await assert.rejects(reopened.planMovement({kind:'unit',id:'p'},1,0),e=>e.code==='SUPPORT_INTERRUPTION_REQUIRED');assert.equal(await readSave('junqi-simulation-v1:'+id),before);await reopened.planMovement({kind:'unit',id:'p'},1,0,{confirmSupportInterruption:true});raw=await saved(id);assert.equal(raw.supportRuntime.tasks[0].status,'interrupted');assert.equal(raw.instances[1].shipState.remainingEndurance,restored);assert.ok(!raw.instances[0].supportLocked);
});


test('a non-naval unit with a repair station supplies guaranteed rescue without naval runtime',async()=>{
 const input=field({targets:1});const provider=input.instances[0];provider.branch=provider.snapshot.branch='army';delete provider.shipState;sinking(input.instances[1]);const{id}=await sim(input);const seeded=await saved(id);const episode={turnNumber:1,phaseId:'order-5',elapsedMinutes:0};seeded.phaseFinishRuntime.sinkingOrigins=[{targetId:'t0',first:episode,episodes:[episode]}];await writeSave('junqi-simulation-v1:'+id,JSON.stringify(seeded),{expectedRaw:await readSave('junqi-simulation-v1:'+id)});const store=await openSimulation(id);await special(store);await store.startSupport({providerId:'p',targetId:'t0',kind:'rescue'});await store.finishSpecialPhase(store.getSceneSnapshot().revision);await store.finishTurn(store.getSceneSnapshot().revision);await special(store);await store.finishSpecialPhase(store.getSceneSnapshot().revision);const raw=await saved(id);assert.equal(raw.supportRuntime.tasks[0].status,'complete');assert.equal(raw.instances[1].shipState.status,'heavy');assert.equal(raw.supportRuntime.records.at(-1).results[0].guaranteed,true);
});

test('worker special-phase settlement saves support recovery and locks',async()=>{
 const {Worker}=await import('node:worker_threads');const {shutdownBackground}=await import('../tactical-map/background-client.js?v=visual-support-bridge-1');
 globalThis.Worker=class{constructor(){this.worker=new Worker(new URL('./worker-thread-adapter.mjs',import.meta.url));this.worker.on('message',data=>this.onmessage?.({data}));this.worker.on('error',e=>this.onerror?.(e));}postMessage(v){this.worker.postMessage(v)}terminate(){this.worker.terminate()}};
 try{const input=field({effect:'supply-station',targets:1});input.instances[1].shipState.remainingEndurance=0;const{id,store}=await sim(input);await special(store);await store.startSupport({providerId:'p',targetId:'t0',kind:'supply'});await store.finishSpecialPhase(store.getSceneSnapshot().revision);const raw=await saved(id);assert.equal(raw.instances[1].shipState.remainingEndurance,readShipProfile(raw.instances[1]).enduranceBudget*.25);assert.ok(raw.instances[0].supportLocked);assert.equal(raw.supportRuntime.records[0].results[0].kind,'supply');}finally{shutdownBackground();delete globalThis.Worker;}
});
test('observation hides support links and locks when a foreign participant is unidentified',async()=>{
 const {getObservedScene}=await import('../tactical-map/simulation-features.js?v=visual-support-bridge-1');const input=field({effect:'supply-station',targets:1});input.instances[1].shipState.remainingEndurance=0;const{id,store}=await sim(input);await special(store);await store.startSupport({providerId:'p',targetId:'t0',kind:'supply'});const raw=await saved(id);raw.controls.observationSide='enemy';const observed=getObservedScene(raw);assert.deepEqual(observed.supportRuntime.tasks,[]);assert.equal(observed.supportRuntime.records,undefined);assert.ok(observed.instances.every(u=>u.supportLocked===undefined));
});
