import test from 'node:test';
import assert from 'node:assert/strict';
import {source} from './fixtures.mjs';
import {weapon} from './scenarios/carrier-air-strike.mjs';
import {createSimulation,openSimulation} from '../tactical-map/simulation-store.js?v=visual-support-bridge-1';
import {settleAttackPhase} from '../tactical-map/simulation-settlement.js?v=visual-support-bridge-1';
import {readSave} from '../js/save-database.js';
import {resetDatabase} from './save-test-environment.mjs';
async function fire(guidance,power,coin){
 await resetDatabase();globalThis.localStorage={getItem:()=>null,setItem(){}};
 const s=source(),a=s.instances[0],b=s.instances[1];b.x=30;b.snapshot.naval.kind='air';b.altitude=20;b.snapshot.naval.strength=0;b.snapshot.naval.armor='U';a.snapshot.naval.airRecon='A';
 const gun=weapon('test',1,power,5,{guidance,penetration:'A',range:300});gun.barrelCount=null;gun.projectionCoefficient=null;gun.projectionSuffix='R';a.snapshot.equipmentSnapshots=[gun];a.snapshot.mounts=[{equipmentId:'test',position:'中部①',count:1}];
 const id=await createSimulation(s,()=>({valid:true})),store=await openSimulation(id);await store.beginMovement();await store.resolveMovement();const group=store.getAttackGroupReport('a').groups[0];await store.saveAttackCommands({unitId:'a',assignments:[{groupId:group.groupId,targetId:'b'}]},store.getSceneSnapshot().revision);const raw=JSON.parse(await readSave('junqi-simulation-v1:'+id));settleAttackPhase(raw,coin);return raw;
}
test('inertial numeric weapons damage airborne ships using strength armor instead of hull armor',async()=>{const inertial=await fire('惯性','3',()=>true),ordinary=await fire('数控','3',()=>true);assert.equal(inertial.instances.find(u=>u.instanceId==='b').currentHp,7);assert.equal(ordinary.instances.find(u=>u.instanceId==='b').currentHp,9);assert.equal(inertial.turn.phaseId,'order-4');});
test('inertial cannon weapons also resolve against airborne ships using strength armor',async()=>{const coins=[true,true,false,false,true],raw=await fire('惯性','艦砲規則',()=>coins.shift()??false),report=raw.settlementRuntime.attackRecords.at(-1).targetReports[0];assert.equal(report.cannonImpacts[0].impact.comparison.armor.label,'F');assert.equal(raw.instances.find(u=>u.instanceId==='b').currentHp,7);});
