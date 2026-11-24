import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker} from 'node:worker_threads';
import {flatTerrain,source} from './fixtures.mjs';
import {resetDatabase} from './save-test-environment.mjs';
import {createSimulation,openSimulation} from '../tactical-map/simulation-store.js';
import {executeBackgroundTask} from '../tactical-map/background-tasks.js';
import {readSave} from '../js/save-database.js';
import {applyBrush,readTerrainVertex,resizeTerrain} from '../tactical-map/terrain-data.js';
import {createTerrainStrokeSession} from '../tactical-map/terrain-stroke-session.js';
import {runBackgroundTask,shutdownBackground,subscribeBackgroundStatus} from '../tactical-map/background-client.js?v=air-combat-1';
class BrowserWorker{
 constructor(){this.worker=new NodeWorker(new URL('./worker-thread-adapter.mjs',import.meta.url));this.worker.on('message',data=>this.onmessage?.({data}));this.worker.on('error',error=>this.onerror?.(error))}
 postMessage(data){this.worker.postMessage(data)}terminate(){this.worker.terminate()}
}
test('real isolated worker handles resizing, ordered brush batches, errors and cancellation',async()=>{
 globalThis.Worker=BrowserWorker;const statuses=[],unsubscribe=subscribeBackgroundStatus(n=>statuses.push(n));
 try{
  const source=flatTerrain(),brush={mode:'raise',radius:30,strength:10,target:0};
  const expected=structuredClone(source),session=createTerrainStrokeSession(source,brush);
  const points=[{x:0,y:0},{x:10,y:10}];for(const p of points)applyBrush(expected,p,brush);
  await Promise.all(points.map(p=>session.enqueue([p])));const result=await session.finish();
  for(let r=0;r<source.rows;r++)for(let c=0;c<source.cols;c++)assert.deepEqual(readTerrainVertex(result.terrain,c,r),readTerrainVertex(expected,c,r));
  assert(result.frame.changes.length>0);
  const settings={width:7200,height:7200,cols:7201,rows:7201,contourInterval:10};
  // A tiny resize can finish before a zero-delay timer; protocol correctness must not depend on timer scheduling.
  assert.deepEqual(await runBackgroundTask('terrain-resize',{source,settings}),resizeTerrain(source,settings));
  await assert.rejects(runBackgroundTask('missing',{}));
  const cancelled=createTerrainStrokeSession(source,brush);await cancelled.enqueue(points);await cancelled.cancel();
  assert(statuses.some(n=>n>0));assert.equal(statuses.at(-1),0);
 }finally{unsubscribe();shutdownBackground();delete globalThis.Worker}
});
test('worker startup failure rejects instead of retrying a calculation',async()=>{
 let attempts=0;globalThis.Worker=class{constructor(){attempts++;throw new Error('blocked')}};
 try{await assert.rejects(runBackgroundTask('terrain-resize',{source:flatTerrain(),settings:{}}));assert.equal(attempts,1)}finally{shutdownBackground();delete globalThis.Worker}
});
test('worker simulation phase results match shared rules and store commits remain atomic',async()=>{
 await resetDatabase();globalThis.localStorage={getItem:()=>null,setItem(){}};globalThis.Worker=BrowserWorker;
 try{
  const id=await createSimulation(source(),()=>({valid:true})),store=await openSimulation(id);
  await store.beginMovement();
  for(const operation of ['movement',...Array(6).fill('attack'),'special','turn-end']){
   const scene=JSON.parse(await readSave('junqi-simulation-v1:'+id));
   const payload={operation,scene:structuredClone(scene)},expected=executeBackgroundTask('simulation',structuredClone(payload));
   const actual=await runBackgroundTask('simulation',payload);assert.deepEqual(actual,expected);
   const method={movement:'resolveMovement',attack:'settleAttackPhase',special:'finishSpecialPhase','turn-end':'finishTurn'}[operation];
   await store[method](scene.revision);
  }
  const scene=JSON.parse(await readSave('junqi-simulation-v1:'+id));
  assert.equal(scene.turn.number,2);assert.equal(scene.turn.phaseId,'start');
  await store.beginMovement();
  await store.resolveMovement();assert.equal(store.getSceneSnapshot().turn.phaseId,'order-5');
  const before=store.getSceneSnapshot();shutdownBackground();globalThis.Worker=class{constructor(){throw new Error('blocked')}};
  await assert.rejects(store.settleAttackPhase(before.revision));
  assert.equal(store.getSceneSnapshot(),before);assert.equal(store.isSaving(),false);
 }finally{shutdownBackground();delete globalThis.Worker}
});

test('worker awaits asynchronous terrain generation and returns saveable terrain',async()=>{
 globalThis.Worker=BrowserWorker;
 try{const result=await runBackgroundTask('terrain-generate',{options:{kind:'mountains',widthKm:24,heightKm:24,lengthKm:10,seed:42}});assert.equal(result.terrain.generation.seed,42);assert.equal(result.terrain.cols,121);assert.equal(result.summary.widthKm,24);assert(result.terrain.base.chunks);await assert.rejects(runBackgroundTask('terrain-generate',{options:{widthKm:2000}}))}
 finally{shutdownBackground();delete globalThis.Worker}
});
