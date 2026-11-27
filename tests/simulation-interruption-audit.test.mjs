import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker} from 'node:worker_threads';
import {auditSimulationRules} from '../scripts/audit-simulation-rules.mjs';
import {applyEquipmentAttack} from '../tactical-map/equipment-item-runtime.js?v=self-sealing-1';
import {source} from './fixtures.mjs';
import {weapon} from './scenarios/carrier-air-strike.mjs';
import {resetDatabase} from './save-test-environment.mjs';
import {createSimulation,openSimulation} from '../tactical-map/simulation-store.js?v=self-sealing-1';
import {readSave,writeSave} from '../js/save-database.js';
import {shutdownBackground} from '../tactical-map/background-client.js?v=self-sealing-1';
import {serializeBackgroundError,deserializeBackgroundError} from '../tactical-map/background-errors.js?v=settlement-audit-1';
import {supportCapacity,supportEffectOf} from '../tactical-map/support-equipment.js?v=field-support-1';

test('worker diagnostics preserve nested causes, public messages and codes without arbitrary battlefield data',()=>{
 const root=Object.assign(new TypeError('炮位失效'),{code:'ATTACK_WEAPON_UNAVAILABLE',skipAttack:true,scene:{enemySecret:'hidden'}}),outer=new Error('自律攻撃計画を作成できません。',{cause:root});Object.assign(outer,{name:'SimulationSettlementError',publicMessage:outer.message});
 const wire=serializeBackgroundError(outer);assert.equal(JSON.stringify(wire).includes('enemySecret'),false);const restored=deserializeBackgroundError(structuredClone(wire));assert.equal(restored.name,'SimulationSettlementError');assert.equal(restored.publicMessage,outer.publicMessage);assert.equal(restored.cause.message,root.message);assert.equal(restored.cause.code,root.code);assert.equal(restored.cause.skipAttack,true);assert.match(restored.cause.stack,/TypeError/);
 outer.cause=outer;assert.doesNotThrow(()=>JSON.stringify(serializeBackgroundError(outer)));assert.equal(deserializeBackgroundError({message:'old worker error'}).message,'old worker error');
});
test('legacy seaplane catapult has its implemented support role without rewriting the snapshot',()=>{
 const e={id:'eq-seaplane-catapult',kind:'support',supportEffect:''},u={branch:'navy',snapshot:{equipmentSnapshots:[e],mounts:[{equipmentId:e.id,count:2}]}};assert.equal(supportEffectOf(e),'catapult');assert.equal(supportCapacity(u,'catapult'),2);assert.equal(e.supportEffect,'');assert.equal(supportEffectOf({id:'custom-catapult',kind:'support'}),'');
});
test('rule-category matrix completes supported rounds and preserves deliberate unsupported-rule stops in a real worker',async t=>{
 const rows=await auditSimulationRules({worker:true});
 for(const row of rows)await t.test(row.name,()=>assert.equal(row.outcome,row.expected,JSON.stringify(row.error)));
});
test('real worker sends internal settlement causes and failed settlement leaves the saved scene untouched',async()=>{
 await resetDatabase();globalThis.localStorage={getItem:()=>null,setItem(){}};const s=source();s.instances[1].x=50;const actor=s.instances[1],gun=weapon('unsupported',1,1,5,{guidance:'惯性（大型）',range:300});actor.snapshot.equipmentSnapshots=[gun];actor.snapshot.mounts=[{position:'中部①',equipmentId:gun.id,count:1}];
 let calls=0;globalThis.Worker=class{constructor(){this.w=new NodeWorker(new URL('./worker-thread-adapter.mjs',import.meta.url));this.w.on('message',data=>this.onmessage?.({data}));this.w.on('error',error=>this.onerror?.(error));}postMessage(data){calls++;this.w.postMessage(data);}terminate(){this.w.terminate();}};
 try{const id=await createSimulation(s,()=>({valid:true})),store=await openSimulation(id);await store.setEnemyAutonomy(true);await store.beginMovement();await store.resolveMovement();const before=await readSave('junqi-simulation-v1:'+id),beforeCalls=calls;
  await assert.rejects(store.settleAttackPhase(store.getSceneSnapshot().revision),e=>{assert.equal(e.name,'SimulationSettlementError');assert.match(e.publicMessage,/自律攻撃/);assert.match(e.cause.message,/大型武器/);assert.match(e.cause.stack,/finalPreflight/);return true;});assert.equal(calls-beforeCalls,1,'failed random calculation must never be retried silently');assert.equal(await readSave('junqi-simulation-v1:'+id),before);
 }finally{shutdownBackground();delete globalThis.Worker;}
});
test('a saved plan invalidated by weapon damage is skipped at execution, but a new damaged-weapon order is rejected',async()=>{
 await resetDatabase();globalThis.localStorage={getItem:()=>null,setItem(){}};const s=source();s.instances[1].x=50;const actor=s.instances[0],gun=weapon('gun',1,1,1,{range:300});actor.snapshot.equipmentSnapshots=[gun];actor.snapshot.mounts=[{position:'中部①',equipmentId:'gun',count:1}];const id=await createSimulation(s,()=>({valid:true}));let store=await openSimulation(id);await store.beginMovement();await store.resolveMovement();const group=store.getSceneSnapshot().instances.find(p=>p.instanceId==='a').equipmentState.groups[0];await store.saveAttackCommands({unitId:'a',assignments:[{groupId:group.id,targetId:'b'}]},store.getSceneSnapshot().revision);
 // Isolated persisted fixture represents the result of earlier equipment damage.
 const key='junqi-simulation-v1:'+id,old=await readSave(key),raw=JSON.parse(old);for(const list of [raw.instances,raw.attackBatchRuntime.snapshot.instances])applyEquipmentAttack({turn:raw.turn,instances:list},list.find(p=>p.instanceId==='a'),{powerRule:'1（设备）',hitCount:1},{selectIndex:()=>1,observeBeforeDamage:()=>null});await writeSave(key,JSON.stringify(raw),{expectedRaw:old});store=await openSimulation(id);
 await assert.rejects(store.saveAttackCommands({unitId:'a',assignments:[{groupId:group.id,targetId:'b'}]},store.getSceneSnapshot().revision),/損傷/);
 for(let i=0;i<6;i++)await store.settleAttackPhase(store.getSceneSnapshot().revision);const final=JSON.parse(await readSave(key));assert.equal(final.turn.phaseId,'special');assert.equal(final.instances[0].equipmentState.groups[0].remainingAmmo,gun.ammo);assert.equal(final.settlementRuntime.attackRecords.flatMap(r=>r.skippedCommands).length,1);assert.ok(final.settlementRuntime.attackRecords.every(r=>r.resourceReports.length===0));
});
test('range broadside orders are capped before registration and overcommitted legacy plans no longer trap execution',async()=>{
 await resetDatabase();globalThis.localStorage={getItem:()=>null,setItem(){}};const s=source(),actor=s.instances[0],gun=weapon('range',1,1,5,{range:300,scope:'范围（全体）'});s.instances[1].x=50;s.instances[1].groupId='enemy';const second=structuredClone(s.instances[1]);second.instanceId='b2';second.x=55;second.y=5;s.instances.push(second);s.groups=[{id:'enemy',name:'enemy',kind:'cluster',parentId:null}];actor.snapshot.equipmentSnapshots=[gun];actor.snapshot.mounts=[{position:'両舷',equipmentId:gun.id,count:4}];
 const id=await createSimulation(s,()=>({valid:true}));let store=await openSimulation(id);await store.beginMovement();await store.resolveMovement();let raw=JSON.parse(await readSave('junqi-simulation-v1:'+id));const groups=raw.instances[0].equipmentState.groups;
 const receipt=await store.saveAttackCommands({unitId:'a',assignments:groups.map(g=>({groupId:g.id,targetRef:{kind:'group',id:'enemy'},specifiedTargetIds:[]}))},store.getSceneSnapshot().revision);assert.equal(receipt.commands.length,2);assert.equal(receipt.skippedCommands.length,2);
 const key='junqi-simulation-v1:'+id,old=await readSave(key);raw=JSON.parse(old);const base=raw.attackRuntime.commands[0];for(let i=2;i<4;i++)raw.attackRuntime.commands.push({...structuredClone(base),id:'legacy-overquota-'+i,groupId:groups[i].id});await writeSave(key,JSON.stringify(raw),{expectedRaw:old});store=await openSimulation(id);
 await store.settleAttackPhase(store.getSceneSnapshot().revision);raw=JSON.parse(await readSave(key));assert.equal(raw.turn.phaseId,'order-4');assert.equal(raw.settlementRuntime.attackRecords[0].skippedCommands.length,2);assert.equal(raw.settlementRuntime.attackRecords[0].resourceReports.length,2);assert.equal(raw.instances[0].equipmentState.groups.filter(g=>g.remainingAmmo===gun.ammo).length,2);
});
