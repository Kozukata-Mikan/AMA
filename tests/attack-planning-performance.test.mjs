import test from 'node:test';
import assert from 'node:assert/strict';
import {resetDatabase} from './save-test-environment.mjs';
import {source} from './fixtures.mjs';
import {createSimulation,openSimulation} from '../tactical-map/simulation-store.js';
import {readSave} from '../js/save-database.js';
import {createAutonomousAttackValidator,prepareAttackBatchResources,prepareBatchHitChecks} from '../tactical-map/simulation-attack-batch.js';

async function fixture(position='中部①',range=125){
 await resetDatabase();globalThis.localStorage={getItem:()=>null,setItem(){}};
 const input=source();input.instances[1].x=60;
 const actor=input.instances[0];
 actor.snapshot.mounts=[{equipmentId:'gun',position,count:4}];
 actor.snapshot.equipmentSnapshots=[{id:'gun',name:'Test gun',kind:'weapon',ammo:50,projectionCoefficient:1,barrelCount:1,projectionSuffix:'R',guidance:'平射',maxOrder:5,range,ceilingU:100,powerRule:'1',penetration:'F',targetScope:'单体'}];
 const id=await createSimulation(input,()=>({valid:true})),store=await openSimulation(id);
 await store.beginMovement();await store.resolveMovement();
 return {id,store,scene:JSON.parse(await readSave('junqi-simulation-v1:'+id))};
}
const command=(scene,index)=>({id:'candidate-'+index,status:'planned',turnNumber:1,phaseId:'order-5',unitId:'a',groupId:scene.instances[0].equipmentState.groups[index].id,targetId:'b',createdAt:scene.updatedAt,boundaries:[]});

test('planning validates only the new candidate and preserves full-batch results',async()=>{
 const {scene}=await fixture();let calls=0;
 const check=(start,entry)=>{calls++;assert(Object.isFrozen(start.instances[0].snapshot));assert(Object.isFrozen(entry.profile));return {allowed:true,commandId:entry.commandId,bonuses:0,penalties:0}};
 const validate=createAutonomousAttackValidator(scene,check);
 for(let i=0;i<4;i++){const next=command(scene,i);validate(next);scene.attackRuntime.commands.push(next)}
 assert.equal(calls,4,'accepted older commands must not be rechecked per candidate');
 const prepared=prepareAttackBatchResources(scene);assert.equal(prepared.entries.length,4);
 assert.equal(prepareBatchHitChecks(scene,prepared,check).checks.length,4);
 assert.equal(calls,8);assert.throws(()=>validate(command(scene,0)),/重複/);
});

test('rejected candidate does not consume broadside quota or poison later candidates',async()=>{
 const {scene}=await fixture('两舷');const check=(start,entry)=>({allowed:true,commandId:entry.commandId,bonuses:0,penalties:0});
 const validate=createAutonomousAttackValidator(scene,check);
 validate(command(scene,0));validate(command(scene,1));
 assert.throws(()=>validate(command(scene,2)),error=>error.code==='BROADSIDE_QUOTA');
 assert.throws(()=>validate(command(scene,3)),error=>error.code==='BROADSIDE_QUOTA');
 assert.equal(scene.attackRuntime.commands.length,0,'validator does not commit plans itself');
});

test('preflight cannot mutate a shared isolated snapshot or the caller battlefield',async()=>{
 const {scene}=await fixture(),before=JSON.stringify(scene);
 const validate=createAutonomousAttackValidator(scene,(start)=>{start.instances[0].x=999;return {allowed:true,commandId:entry.commandId,bonuses:0,penalties:0}});
 assert.throws(()=>validate(command(scene,0)),TypeError);assert.equal(JSON.stringify(scene),before);
});

test('all-out-of-range manual plan is rejected atomically and empty phase still advances',async()=>{
 const {store,scene}=await fixture('中部①',25),before=store.getSceneSnapshot();
 await assert.rejects(()=>store.saveAttackCommands({unitId:'a',assignments:scene.instances[0].equipmentState.groups.map(group=>({groupId:group.id,targetId:'b'}))},before.revision),/射距/);
 assert.equal(store.getSceneSnapshot().revision,before.revision);
 await store.settleAttackPhase(before.revision);
 assert.equal(store.getSceneSnapshot().turn.phaseId,'order-4');
});

test('manual plan full preflight runs in a real worker before the atomic save',async()=>{
 const {Worker}=await import('node:worker_threads');
 const {shutdownBackground}=await import('../tactical-map/background-client.js?v=aircraft-template-1');
 const {store,scene}=await fixture();let dispatched=0;
 globalThis.Worker=class{
  constructor(){this.worker=new Worker(new URL('./worker-thread-adapter.mjs',import.meta.url));this.worker.on('message',data=>this.onmessage?.({data}));this.worker.on('error',error=>this.onerror?.(error))}
  postMessage(data){assert.equal(data.task,'simulation-attack-preflight');dispatched++;this.worker.postMessage(data)}
  terminate(){this.worker.terminate()}
 };
 try{
  const before=store.getSceneSnapshot();
  const receipt=await store.saveAttackCommands({unitId:'a',assignments:[{groupId:scene.instances[0].equipmentState.groups[0].id,targetId:'b'}]},before.revision);
  assert.equal(dispatched,1);assert.equal(receipt.commands.length,1);assert.equal(store.getSceneSnapshot().revision,before.revision+1);
  shutdownBackground();globalThis.Worker=class{constructor(){throw Error('unavailable')}};
  const saved=store.getSceneSnapshot();
  await assert.rejects(()=>store.saveAttackCommands({unitId:'a',assignments:[{groupId:scene.instances[0].equipmentState.groups[1].id,targetId:'b'}]},saved.revision),/ワーカー/);
  assert.equal(store.getSceneSnapshot(),saved);
 }finally{shutdownBackground();delete globalThis.Worker}
});
