import {beforeEach} from 'node:test';
import {resetDatabase, IDBObjectStore} from './save-test-environment.mjs';
import {readSave, writeSave} from '../js/save-database.js';
beforeEach(resetDatabase);
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoTerrain, resizeTerrain, sampleTerrain, gridPosition, applyBrush, validateTerrain, readTerrainVertex } from '../tactical-map/terrain-data.js';
import { terrainRenderWindow, makeTerrainRenderGrid } from '../tactical-map/terrain-render-grid.js';
import { createBattleStore } from '../js/battle-state.js?v=field-support-1';
import { createSimulation, openSimulation } from '../tactical-map/simulation-store.js?v=field-support-1';
import { isTerrainBlocked } from '../tactical-map/simulation-features.js?v=field-support-1';
import { traceAttackTerrainLine } from '../tactical-map/attack-terrain-runtime.js';
import { runEquipmentRegressionTests } from '../tactical-map/simulation-equipment-regression.js?v=field-support-1';
import { runRangeRegression } from '../tactical-map/simulation-range-regression.js?v=field-support-1';

const copy = v => JSON.parse(JSON.stringify(v));
const data = new Map();
globalThis.localStorage = {
 getItem: k => data.get(k) ?? null,
 setItem: (k,v) => data.set(k,String(v)), removeItem: k => data.delete(k),
 key: n => [...data.keys()][n] ?? null, get length(){return data.size}
};
globalThis.window = {addEventListener(){},removeEventListener(){}};
import {flatTerrain, source} from './fixtures.mjs';

for (const mode of ['raise','lower','smooth','level','land','sea','river','eraseRiver','shallow','eraseShallow']) {
 test(`dense and sparse brush agree: ${mode}`,()=>{
  const dense=createDemoTerrain();
  // Same nodes, different storage. No display LOD participates in this comparison.
  const sparse={version:2,width:dense.width,height:dense.height,cols:dense.cols,rows:dense.rows,contourInterval:6,base:copy(dense),vertices:{}};
  const brush={mode,radius:30,strength:5,target:20};
  applyBrush(dense,{x:-75,y:-10},brush);applyBrush(sparse,{x:-75,y:-10},brush);
  for(let r=0;r<dense.rows;r++)for(let c=0;c<dense.cols;c++)assert.deepEqual(readTerrainVertex(sparse,c,r),readTerrainVertex(dense,c,r));
 });
}
test('7200 cells per axis retain independently editable one-cell details',()=>{
 const large=resizeTerrain(flatTerrain(),{width:7200,height:7200,cols:7201,rows:7201,contourInterval:6});
 assert.equal(large.version,2);assert.equal(Object.keys(large.vertices).length,0);
 applyBrush(large,{x:2000,y:2000},{mode:'level',radius:5,strength:10,target:123});
 assert.equal(sampleTerrain(large,2000,2000).height,123);
 assert.equal(sampleTerrain(large,2010,2000).height,-20);
 assert(Object.keys(large.vertices).length < 100);
 assert(JSON.stringify(large).length < 100_000);
 assert.deepEqual(sampleTerrain(validateTerrain(copy(large)),2000,2000),sampleTerrain(large,2000,2000));
});
test('old maps round trip without changing any values',()=>{
 const old=createDemoTerrain();assert.deepEqual(validateTerrain(copy(old)),old);
});
test('malformed large vertices and invalid grid dimensions are rejected',()=>{
 const t=resizeTerrain(flatTerrain(),{width:7200,height:7200,cols:7201,rows:7201,contourInterval:6});
 assert.throws(()=>validateTerrain({...t,vertices:{'51854401':[0,0,0]}}));
 assert.throws(()=>validateTerrain({...t,vertices:{'1':[NaN,0,0]}}));
 assert.throws(()=>validateTerrain({...t,vertices:{'1':[0,2,0]}}));
 assert.throws(()=>resizeTerrain(t,{...t,cols:7202}));
});
test('same-resolution resize does not nest bases or drop fine edits',()=>{
 let t=resizeTerrain(flatTerrain(),{width:7200,height:7200,cols:7201,rows:7201,contourInterval:6});
 applyBrush(t,{x:1000,y:1000},{mode:'land',radius:5,strength:50,target:0});
 const before=sampleTerrain(t,1000,1000);
 for(let i=0;i<25;i++)t=resizeTerrain(t,{...t,contourInterval:5+i%2});
 assert.deepEqual(sampleTerrain(t,1000,1000),before);assert.equal(t.base.version,1);
});
test('resizing expands ocean without stretching the original terrain',()=>{
 const old=createDemoTerrain();const t=resizeTerrain(old,{width:7200,height:7200,cols:7201,rows:7201,contourInterval:6});
 assert.equal(sampleTerrain(t,3000,3000).kind,'sea');
 for(let r=0;r<old.rows;r+=10)for(let c=0;c<old.cols;c+=10){
  const p=gridPosition(old,c,r);const actual=sampleTerrain(t,p.x,p.y).height;
  // New grid interpolation can differ between old nodes; aligned vertices must agree exactly.
  if(Number.isInteger(p.x)&&Number.isInteger(p.y))assert(Math.abs(actual-sampleTerrain(old,p.x,p.y).height)<1e-9);
 }
});
test('display LOD bounds drawing work without changing saved geometry',()=>{
 const t=resizeTerrain(flatTerrain(),{width:7200,height:7200,cols:7201,rows:7201,contourInterval:6});
 const before=JSON.stringify(t);const overview=terrainRenderWindow(t);
 assert(overview.cols.length<=130);assert(overview.rows.length<=130);
 const close=terrainRenderWindow(t,{x:-500*32,y:-340*32,scale:32},{x:0,y:0,width:1000,height:700});
 assert.equal(close.cols[1]-close.cols[0],1);
 makeTerrainRenderGrid(t,close);assert.equal(JSON.stringify(t),before);
});
test('one-cell land still blocks exact movement/LOS queries on a large map',()=>{
 const t=resizeTerrain(flatTerrain(),{width:7200,height:7200,cols:7201,rows:7201,contourInterval:6});
 t.vertices[3600*7201+3600]=[100,0,0];
 assert.equal(isTerrainBlocked(t,{x:-2,y:0},{x:2,y:0}),true);
 const line=traceAttackTerrainLine(t,{x:-2,y:0,z:1},{x:2,y:0,z:1});
 assert.equal(line.maxGroundHeight,100);assert.equal(line.minGroundClearance,-99);
});
test('battle read snapshots are immutable, reusable, and invalidated after changes',async ()=>{
 data.clear();const store=await createBattleStore([]);
 const a=store.getSceneSnapshot();assert.equal(a,store.getSceneSnapshot());
 assert.throws(()=>{a.name='mutated'});
 const mutable=store.getScene();mutable.name='private';assert.notEqual(store.getSceneSnapshot().name,'private');
 await store.renameScene('changed');const b=store.getSceneSnapshot();assert.notEqual(a,b);assert.equal(b.name,'changed');
 assert.equal(a.terrain,b.terrain);await store.destroy();
});
test('simulation cached snapshots preserve fog and mutable getScene contract',async ()=>{
 data.clear();const id=await createSimulation(source(),()=>({valid:true}));const store=await openSimulation(id);
 const a=store.getSceneSnapshot();assert.equal(a,store.getSceneSnapshot());assert(Object.isFrozen(a));
 const hidden=a.instances.find(u=>u.instanceId==='b');
 assert.equal(hidden.observationLevel,'shadow');assert.equal(hidden.currentHp,null);assert.equal(hidden.snapshot.maxHp,null);assert.notEqual(hidden.name,'b');
 const mutable=store.getScene();mutable.name='private';assert.notEqual(store.getSceneSnapshot().name,'private');
 await store.setObservationSide('enemy');const b=store.getSceneSnapshot();assert.notEqual(a,b);assert.equal(b.controls.observationSide,'enemy');
 assert.equal(a.terrain,b.terrain);
 assert(a.instances.every(u=>u.observationOwn || u.observationLevel !== undefined));
});
test('cross-tab writes with same revision are rejected instead of overwritten',async ()=>{
 data.clear();const id=await createSimulation(source(),()=>({valid:true}));const store=await openSimulation(id);
 const key='junqi-simulation-v1:'+id;const previous=await readSave(key);
 await writeSave(key,previous+' ',{expectedRaw:previous});
 await assert.rejects(()=>store.setObservationSide('enemy'));assert.equal(await readSave(key),previous+' ');
});
test('save failure does not advance in-memory revision or cached state',async ()=>{
 data.clear();const id=await createSimulation(source(),()=>({valid:true}));const store=await openSimulation(id);
 const before=store.getSceneSnapshot();const put=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(){throw new DOMException('disk full','QuotaExceededError')};
 try{await assert.rejects(()=>store.setObservationSide('enemy'));assert.equal(store.getSceneSnapshot(),before)}finally{IDBObjectStore.prototype.put=put}
});
test('all existing equipment and range rule regressions pass',()=>{
 assert.equal(runEquipmentRegressionTests().failed,0);assert.equal(runRangeRegression().passed,true);
});

import { drawTerrainFaces, projectMap } from '../tactical-map/map-display.js?v=day-catalog-pas-1';
import { pickProjectedTerrainPoint } from '../tactical-map/terrain-picking.js?v=day-catalog-pas-1';

test('SVG batching keeps every full-resolution triangle and bounds DOM node count',()=>{
 const node=()=>({children:[],attributes:{},setAttribute(k,v){this.attributes[k]=v},append(v){if(v.fragment)this.children.push(...v.children);else this.children.push(v)}});
 globalThis.document={createElementNS:()=>node(),createDocumentFragment:()=>({...node(),fragment:true})};
 const t=flatTerrain();const layer=node();drawTerrainFaces({layer,terrain:t,colored:true});
 const triangles=layer.children.reduce((n,child)=>n+(child.attributes.d.match(/M/g)||[]).length,0);
 assert.equal(triangles,2*(t.cols-1)*(t.rows-1));assert(layer.children.length<60);
});
test('exact picking reaches a one-cell high feature on the 7200-cell map',()=>{
 const t=resizeTerrain(flatTerrain(),{width:7200,height:7200,cols:7201,rows:7201,contourInterval:6});
 t.vertices[3600*7201+3600]=[100,0,0];
 const hit=pickProjectedTerrainPoint(t,projectMap(0,0,100));
 assert(hit);assert(Math.abs(hit.x)<1e-7);assert(Math.abs(hit.y)<1e-7);
 const flat=pickProjectedTerrainPoint(t,projectMap(2000,2000,0));
 assert(flat);assert(Math.abs(flat.x-2000)<1e-7);assert(Math.abs(flat.y-2000)<1e-7);
});
test('viewport completely outside the map renders no cells',()=>{
 const t=flatTerrain();const window=terrainRenderWindow(t,{x:1e7,y:1e7,scale:1},{x:0,y:0,width:1000,height:700});
 assert.equal(makeTerrainRenderGrid(t,window).length,0);
});

import { ensureShipRuntime } from '../tactical-map/ship-runtime.js?v=field-support-1';
import { ensureUnitCombatRuntime } from '../tactical-map/equipment-runtime.js?v=field-support-1';
import { finishSpecialPhase, finishTurn, recordSinkingStarts } from '../tactical-map/simulation-phase-finish.js?v=field-support-1';
import { startPlannedRescues } from '../tactical-map/simulation-rescue.js?v=field-support-1';
import { ship } from './fixtures.mjs';
function rescueScene(){
 const s={turn:{number:1,phaseId:'special',elapsedMinutes:0},instances:[ship('rescuer'),ship('target','ally',1)],groups:[],rescuePlans:[],rescueTasks:[]};
 for(const u of s.instances){ensureShipRuntime(u);ensureUnitCombatRuntime(u)}
 s.instances[1].currentHp=0;s.instances[1].shipState.status='sinking';s.instances[1].shipState.hasReceivedDamage=true;
 recordSinkingStarts(s,[{targetId:'target',sinkingStarted:{turnNumber:1,phaseId:'special'}}]);
 s.turn.phaseId='movement';s.rescuePlans=[{kind:'rescue',rescuerId:'rescuer',targetId:'target',turnNumber:1}];startPlannedRescues(s);s.turn.phaseId='special';return s;
}
for(const heads of [true,false])test(`full phase flow preserves rescue outcome: ${heads}`,()=>{
 const random=crypto.getRandomValues;crypto.getRandomValues=a=>{a.fill(heads?1:0);return a};
 try{
  const s=rescueScene();finishSpecialPhase(s);assert.equal(s.rescueTasks[0].status,'active');finishTurn(s);
  assert.equal(s.instances[1].shipState.sinkingElapsedMinutes,0);s.turn.phaseId='special';finishSpecialPhase(s);
  assert.equal(s.rescueTasks[0].status,heads?'success':'failure');assert.equal(s.instances[1].shipState.status,heads?'heavy':'sunk');
  assert(s.instances.every(u=>u.shipState.rescueTaskId===null));finishTurn(s);
 }finally{crypto.getRandomValues=random}
});
test('full fire damage-control sequence preserves sinking transition',()=>{
 const s=rescueScene();s.rescueTasks=[];for(const u of s.instances)u.shipState.rescueTaskId=null;
 s.instances[0].shipState.effects.fire={level:'small',acquiredTurn:1,failedControls:0};
 s.instances.splice(1,1);s.phaseFinishRuntime.sinkingOrigins=[];
 const random=crypto.getRandomValues;crypto.getRandomValues=a=>{a.fill(0);return a};
 try{for(let n=0;n<3;n++){s.turn.phaseId='special';finishSpecialPhase(s);if(n<2)finishTurn(s)}
  assert.equal(s.instances[0].currentHp,7);assert.equal(s.instances[0].shipState.status,'sinking');assert.equal(s.phaseFinishRuntime.sinkingOrigins.length,1);
 }finally{crypto.getRandomValues=random}
});
test('selected-unit read APIs work with frozen observation snapshots',async ()=>{
 data.clear();const id=await createSimulation(source(),()=>({valid:true}));const store=await openSimulation(id);
 store.getSceneSnapshot();
 assert.doesNotThrow(()=>store.getAttackEquipmentProfiles('a'));
 assert.doesNotThrow(()=>store.getEquipmentRepairOptions('a'));
 assert.doesNotThrow(()=>store.getEntities());
 await store.beginMovement();assert.equal(store.getSceneSnapshot().turn.phaseId,'movement');
});
test('overlapping saves are rejected without overwriting the active transaction',async ()=>{
 data.clear();const id=await createSimulation(source(),()=>({valid:true}));const store=await openSimulation(id);
 const first=store.beginMovement();
 await assert.rejects(()=>store.setObservationSide('enemy'),/保存中/);
 await first;
 assert.equal(store.getSceneSnapshot().controls.observationSide,'ally');
 assert.equal(store.getSceneSnapshot().turn.phaseId,'movement');
});
test('large edited terrain survives editor save/export/import/reopen intact',async ()=>{
 data.clear();let store=await createBattleStore([]);
 const t=resizeTerrain(flatTerrain(),{width:7200,height:7200,cols:7201,rows:7201,contourInterval:6});
 applyBrush(t,{x:2000,y:2000},{mode:'level',radius:5,strength:10,target:123});
 await store.setTerrain(t);await store.renameScene('Large terrain');
 const exported=store.exportScene();await store.importScene(exported);
 assert.equal(sampleTerrain(store.getSceneSnapshot().terrain,2000,2000).height,123);
 await store.destroy();store=await createBattleStore([]);
 assert.equal(store.getSceneSnapshot().terrain.cols,7201);
 assert.equal(sampleTerrain(store.getSceneSnapshot().terrain,2000,2000).height,123);await store.destroy();
});
