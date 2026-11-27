import test from 'node:test';
import assert from 'node:assert/strict';
import {ship,source} from './fixtures.mjs';
import {supportEquipmentSeed} from '../tactical-map/support-equipment.js?v=visual-support-bridge-1';
import {operateTransport,validateTransport} from '../tactical-map/transport-hold.js';
import {createSimulation,openSimulation} from '../tactical-map/simulation-store.js?v=visual-support-bridge-1';
import {resetDatabase} from './save-test-environment.mjs';

function fixture(){
 const scene=source(),h=ship('carrier'),r=ship('receiver','ally',4),a=ship('army','ally',1),p=ship('port','ally',7);
 const hold=supportEquipmentSeed().find(e=>e.supportEffect==='transport-hold');
 for(const u of [h,r]){u.snapshot.equipmentSnapshots=[hold];u.snapshot.mounts=[{position:'前部',equipmentId:hold.id,count:1}];}
 a.branch=a.snapshot.branch='army';p.branch=p.snapshot.branch='building';p.snapshot.building={kind:'port',portType:'cargo',permanence:'permanent'};
 scene.instances=[h,r,p,a];return scene;
}
test('stored army keeps its identity through load, save, transfer and port storage',async()=>{
 await resetDatabase();globalThis.localStorage={getItem:()=>null,setItem(){}};
 const id=await createSimulation(fixture(),()=>({valid:true}));let store=await openSimulation(id);
 const move=(operation,hostId,receiverId)=>store.operateTransport({operation,hostId,receiverId,unitIds:['army']});
 await assert.rejects(move('load','carrier'),/特殊/);
 await store.beginMovement();await store.resolveMovement();for(let i=0;i<6;i++)await store.settleAttackPhase(store.getSceneSnapshot().revision);
 await move('load','carrier');store=await openSimulation(id);
 const observed=()=>store.getSceneSnapshot().instances;
 assert.ok(!observed().some(u=>u.instanceId==='army'));assert.equal(observed().find(u=>u.instanceId==='carrier').transportManifest[0].id,'army');
 await move('transfer','carrier','receiver');await move('transfer','receiver','port');
 await assert.rejects(move('unload','port'),/陸地/);
 await store.finishSpecialPhase(store.getSceneSnapshot().revision);await store.finishTurn(store.getSceneSnapshot().revision);
 await store.beginMovement();await store.resolveMovement();store=await openSimulation(id);
 assert.equal(observed().find(u=>u.instanceId==='port').transportManifest.length,1);
});
test('capacity, range and batch failures are atomic, and landed units return to the map',()=>{
 const scene=fixture();scene.turn={number:1,phaseId:'special'};scene.controls={observationSide:'ally'};
 const [h,r,p,a]=scene.instances;scene.groups=[{id:'ground',name:'Ground',kind:'cluster',parentId:null}];a.groupId='ground';const b=structuredClone(a);b.instanceId='other';scene.instances.push(b);
 const move=(operation,hostId,unitIds,receiverId)=>operateTransport(scene,{operation,hostId,unitIds,receiverId});
 assert.throws(()=>move('load',h.instanceId,[a.instanceId,b.instanceId]));assert.equal(a.x,1);
 move('load',h.instanceId,[a.instanceId]);move('load',r.instanceId,[b.instanceId]);assert.throws(()=>move('transfer',h.instanceId,[a.instanceId],r.instanceId));
 p.x=200;assert.throws(()=>move('transfer',h.instanceId,[a.instanceId],p.instanceId));p.x=7;
 move('transfer',h.instanceId,[a.instanceId],p.instanceId);validateTransport(scene);scene.terrain.heights.fill(10);
 move('unload',p.instanceId,[a.instanceId]);assert.equal(a.transportHostId,undefined);assert.equal(a.groupId,'ground');assert.equal(a.x,7);assert.equal(a.y,0);
});
