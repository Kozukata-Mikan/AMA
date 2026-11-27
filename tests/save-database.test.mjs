import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {resetDatabase,IDBObjectStore} from './save-test-environment.mjs';
import {readSave,writeSave,listSaveMetadata,closeSaveDatabase} from '../js/save-database.js';
import {createBattleStore} from '../js/battle-state.js?v=aviation-deck-1';
import {createSimulation,openSimulation} from '../tactical-map/simulation-store.js?v=aviation-deck-1';
import {source} from './fixtures.mjs';
let legacy;
beforeEach(async()=>{
 await resetDatabase();legacy=new Map();
 globalThis.localStorage={getItem:k=>legacy.get(k)??null,setItem:(k,v)=>legacy.set(k,String(v)),key:i=>[...legacy.keys()][i]??null,get length(){return legacy.size}};
 globalThis.window={addEventListener(){},removeEventListener(){}};
});

test('legacy migration preserves original bytes and does not rewrite localStorage',async()=>{
 const raw=' {"name":"旧作戦", "values":[1,2,3]} ';
 legacy.set('battle',raw);
 assert.equal(await readSave('battle'),raw);assert.equal(legacy.get('battle'),raw);
 await writeSave('battle','{"name":"新作戦"}',{expectedRaw:raw});
 assert.equal(legacy.get('battle'),raw);
 await closeSaveDatabase();assert.equal(await readSave('battle'),'{"name":"新作戦"}');
});
test('existing IndexedDB record wins over a changed legacy backup',async()=>{
 legacy.set('battle','{"name":"old"}');await readSave('battle');
 await writeSave('battle','{"name":"new"}',{expectedRaw:'{"name":"old"}'});
 legacy.set('battle','{"name":"stale older tab"}');
 assert.equal(await readSave('battle'),'{"name":"new"}');
});
test('failed migration aborts record and metadata together, retaining legacy backup',async()=>{
 const raw='{"name":"keep me"}';legacy.set('battle',raw);
 const put=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(...args){if(this.name==='save-index')throw new DOMException('full','QuotaExceededError');return put.apply(this,args)};
 try{await assert.rejects(()=>readSave('battle'))}finally{IDBObjectStore.prototype.put=put}
 assert.equal(legacy.get('battle'),raw);
 legacy.delete('battle');assert.equal(await readSave('battle'),null);
 legacy.set('battle',raw);assert.equal(await readSave('battle'),raw);
});
test('large save works when localStorage writes are out of quota',async()=>{
 localStorage.setItem=()=>{throw new DOMException('full','QuotaExceededError')};
 const raw=JSON.stringify({name:'large',data:'x'.repeat(6*1024*1024)});
 await writeSave('large',raw);assert.equal(await readSave('large'),raw);
 assert.equal((await listSaveMetadata('large'))[0].name,'large');
});
test('two writers compare and commit atomically; only one can replace the same revision',async()=>{
 await writeSave('shared','original');
 const results=await Promise.allSettled([
  writeSave('shared','first',{expectedRaw:'original'}),
  writeSave('shared','second',{expectedRaw:'original'})
 ]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.filter(r=>r.status==='rejected').length,1);
 assert(['first','second'].includes(await readSave('shared')));
});
test('metadata list imports only matching legacy keys without deleting unrelated data',async()=>{
 legacy.set('junqi-simulation-v1:a','{"name":"A"}');legacy.set('unrelated','important');
 await writeSave('junqi-simulation-v1:b','{"name":"B"}');
 const list=await listSaveMetadata('junqi-simulation-v1:');
 assert.deepEqual(list.map(x=>x.name).sort(),['A','B']);assert.equal(legacy.get('unrelated'),'important');
 assert.equal(legacy.get('junqi-simulation-v1:a'),'{"name":"A"}');
});
test('malformed legacy payload is preserved; editor blocks normal writes',async()=>{
 const key='junqi-battle-scene-v2';legacy.set(key,'{broken');
 const store=await createBattleStore([]);assert.equal(store.isRecoveryBlocked(),true);
 await assert.rejects(()=>store.renameScene('overwrite'));
 assert.equal(legacy.get(key),'{broken');assert.equal(await readSave(key),'{broken');store.destroy();
});
test('legacy scene normalizes to the same scene and survives reload after save',async()=>{
 let store=await createBattleStore([]);const saved=store.getScene();store.destroy();
 legacy.set('junqi-battle-scene-v2',JSON.stringify({...saved,name:'legacy scene'}));
 store=await createBattleStore([]);assert.equal(store.getSceneSnapshot().name,'legacy scene');
 const before=store.getSceneSnapshot();let notifications=0;store.subscribe(()=>notifications++);
 const saving=store.renameScene('database scene');
 assert.equal(store.getSceneSnapshot(),before,'must not publish before transaction completion');
 await saving;assert.equal(notifications,1);assert.equal(store.getSceneSnapshot().name,'database scene');store.destroy();
 store=await createBattleStore([]);assert.equal(store.getSceneSnapshot().name,'database scene');
 assert.equal(JSON.parse(legacy.get('junqi-battle-scene-v2')).name,'legacy scene');store.destroy();
});
test('failed editor save retains both visible and committed scene, then allows retry',async()=>{
 const store=await createBattleStore([]);await store.renameScene('before');
 const original=store.getSceneSnapshot(),raw=await readSave('junqi-battle-scene-v2');
 const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=()=>{throw new DOMException('full','QuotaExceededError')};
 try{await assert.rejects(()=>store.renameScene('after'));assert.equal(store.getSceneSnapshot(),original);assert.equal(store.isSaving(),false)}finally{IDBObjectStore.prototype.put=put}
 assert.equal(await readSave('junqi-battle-scene-v2'),raw);
 await store.renameScene('retry');assert.equal(store.getSceneSnapshot().name,'retry');store.destroy();
});
test('independent simulation stores cannot overwrite a newer saved turn',async()=>{
 const id=await createSimulation(source(),()=>({valid:true}));const first=await openSimulation(id),second=await openSimulation(id);
 await first.beginMovement();await assert.rejects(()=>second.beginMovement());
 assert.equal(second.getSceneSnapshot().turn.phaseId,'start');
 assert.equal((await openSimulation(id)).getSceneSnapshot().turn.phaseId,'movement');
});
test('legacy simulations reopen with identical turn, units and terrain',async()=>{
 const id=await createSimulation(source(),()=>({valid:true}));const key='junqi-simulation-v1:'+id,raw=await readSave(key);
 const original=(await openSimulation(id)).getScene();
 // A fresh database represents upgrading an existing browser, with only its legacy save available.
 await resetDatabase();legacy.set(key,raw);
 const migrated=(await openSimulation(id)).getScene();assert.deepEqual(migrated,original);assert.equal(legacy.get(key),raw);
});
test('failed special/end-phase saves cannot advance phase, round or elapsed time',async()=>{
 const id=await createSimulation(source(),()=>({valid:true})),key='junqi-simulation-v1:'+id;
 let raw=await readSave(key),value=JSON.parse(raw);value.turn.phaseId='special';
 await writeSave(key,JSON.stringify(value),{expectedRaw:raw});
 const store=await openSimulation(id),original=store.getSceneSnapshot();
 const put=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=()=>{throw new DOMException('full','QuotaExceededError')};
 try{await assert.rejects(()=>store.finishSpecialPhase(original.revision));assert.equal(store.getSceneSnapshot(),original)}finally{IDBObjectStore.prototype.put=put}
 await store.finishSpecialPhase(original.revision);
 const end=store.getSceneSnapshot();assert.equal(end.turn.phaseId,'end');
 IDBObjectStore.prototype.put=()=>{throw new DOMException('full','QuotaExceededError')};
 try{await assert.rejects(()=>store.finishTurn(end.revision));assert.equal(store.getSceneSnapshot(),end)}finally{IDBObjectStore.prototype.put=put}
 await store.finishTurn(end.revision);
 assert.equal(store.getSceneSnapshot().turn.number,2);assert.equal(store.getSceneSnapshot().turn.elapsedMinutes,30);
});
test('saving notifications cover both success and failure without premature publication',async()=>{
 const store=await createBattleStore([]),states=[];const off=store.subscribeSaving(value=>states.push(value));
 const original=store.getSceneSnapshot();const pending=store.renameScene('saved');
 assert.equal(store.isSaving(),true);assert.equal(store.getSceneSnapshot(),original);
 await pending;assert.deepEqual(states,[false,true,false]);
 off();store.destroy();
});
test('scene JSON larger than the old five-megabyte cap can round trip',async()=>{
 const store=await createBattleStore([]),scene=store.getScene();scene.name='x'.repeat(6*1024*1024);
 await store.importScene(JSON.stringify(scene));
 const exported=store.exportScene();assert(exported.length>5_000_000);
 await store.importScene(exported);assert.equal(store.getSceneSnapshot().name.length,6*1024*1024);store.destroy();
});
