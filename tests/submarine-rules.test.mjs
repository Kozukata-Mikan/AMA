import test from 'node:test';
import assert from 'node:assert/strict';
import {source,ship} from './fixtures.mjs';
import {resetDatabase} from './save-test-environment.mjs';
import {createSimulation,openSimulation} from '../tactical-map/simulation-store.js?v=field-support-1';
import {readSave} from '../js/save-database.js';
import {navalKind,isSubmerged,normalizeNavalPosition,navalCanTraverse} from '../tactical-map/naval-kind.js';
import {readShipProfile} from '../tactical-map/ship-runtime.js?v=field-support-1';
import {getObserverVisibility} from '../tactical-map/simulation-features.js?v=field-support-1';
import {readWeaponProfile} from '../tactical-map/weapon-profile-runtime.js?v=field-support-1';
import {initializeCatalog} from '../js/catalog-store.js?v=field-support-1';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function submarine(unit){unit.snapshot.naval.kind='submarine';unit.depth=2;unit.underwater=true;unit.snapshot.naval.speedKnots=20;unit.snapshot.naval.submergedSpeedKnots=10;return unit;}
async function simulation(scene=source()){
 await resetDatabase();globalThis.localStorage={getItem:()=>null,setItem(){}};
 const id=await createSimulation(scene,()=>({valid:true}));return{id,store:await openSimulation(id)};
}
const saved=id=>readSave('junqi-simulation-v1:'+id).then(JSON.parse);
const gun=(id,guidance,power='1')=>({id,name:id,kind:'weapon',ammo:20,projectionCoefficient:1,barrelCount:1,projectionSuffix:'R',guidance,maxOrder:5,range:125,ceilingU:100,powerRule:power,penetration:'F',targetScope:'单体'});
function arm(unit,weapons){unit.snapshot.equipmentSnapshots=weapons;unit.snapshot.mounts=weapons.map(w=>({equipmentId:w.id,position:'中部①',count:1}));}

test('four ship kinds, depth zero surfacing, vertical minima and legacy submarine migration',()=>{
 const legacy=ship('old');legacy.underwater=true;legacy.depth=12;normalizeNavalPosition(legacy);
 assert.equal(navalKind(legacy),'submarine');assert.equal(legacy.depth,12);
 const sub=submarine(ship('s'));normalizeNavalPosition(sub);assert.ok(isSubmerged(sub));
 sub.depth=0;normalizeNavalPosition(sub);assert.equal(sub.underwater,false);assert.equal(navalKind(sub),'submarine');
 sub.depth=.5;assert.throws(()=>normalizeNavalPosition(sub),/1以上/);
 const air=ship('air');air.snapshot.naval.kind='air';air.altitude=0;assert.throws(()=>normalizeNavalPosition(air),/1以上/);
 const kinds=['sea','land','river','shallow'];
 for(const kind of ['air','surface','land','submarine']){
  const u=ship('u');u.snapshot.naval.kind=kind;u.altitude=20;u.depth=kind==='submarine'?1:0;normalizeNavalPosition(u);
  const allowed=kinds.filter(k=>navalCanTraverse(u,{inside:true,kind:k,height:k==='land'?5:-10,surface:k==='land'?5:0}));
  assert.deepEqual(allowed,kind==='air'?kinds:kind==='land'?['land','river','shallow']:kind==='submarine'?['sea']:['sea','river','shallow']);
 }
});

test('catalog kind, both speeds and ASW fields survive save/export/import',()=>{
 globalThis.localStorage={getItem:()=>null,setItem(){}};const catalog=initializeCatalog([]);
 const base=catalog.units.find(u=>u.branch==='navy');
 const value=structuredClone(base);value.id='sub-new';value.protected=false;Object.assign(value.naval,{kind:'submarine',speedKnots:18,submergedSpeedKnots:9,aswRecon:'B'});
 catalog.saveUnit(value);catalog.importJSON(catalog.exportJSON());const item=catalog.units.find(u=>u.id==='sub-new');
 for(const key of ['kind','speedKnots','submergedSpeedKnots','aswRecon'])assert.equal(item.naval[key],value.naval[key]);
 const before=catalog.exportJSON();assert.throws(()=>catalog.saveUnit({...value,naval:{...value.naval,kind:'unknown'}}),/種類/);assert.equal(catalog.exportJSON(),before);
});

test('surfacing orders use surface speed, stay pending until settlement and persist depth zero',async()=>{
 const scene=source();const sub=submarine(scene.instances[0]);
 assert.equal(readShipProfile(sub).movementLimit,46);sub.depth=0;assert.equal(readShipProfile(sub).movementLimit,92);sub.depth=2;
 const{id,store}=await simulation(scene);await store.beginMovement();
 assert.equal(store.getMovementInfo({kind:'unit',id:'a'},{depth:0}).limit,92);
 await store.planMovement({kind:'unit',id:'a'},80,0,{depth:0});
 assert.equal((await saved(id)).instances[0].depth,2);
 await store.resolveMovement();const result=await saved(id);near(result.instances[0].x,80);assert.equal(result.instances[0].depth,0);assert.equal(result.instances[0].underwater,false);
 assert.equal((await openSimulation(id)).getSceneSnapshot().instances.find(u=>u.instanceId==='a').depth,0);
});

test('diving speed and depth validation reject illegal orders atomically',async()=>{
 const scene=source();submarine(scene.instances[0]);scene.instances[0].depth=0;scene.instances[0].underwater=false;
 const{id,store}=await simulation(scene);await store.beginMovement();const before=await readSave('junqi-simulation-v1:'+id);
 await assert.rejects(store.planMovement({kind:'unit',id:'a'},80,0,{depth:2}),/上限/);
 await assert.rejects(store.planMovement({kind:'unit',id:'a'},0,0,{depth:.5}),/1以上/);
 await assert.rejects(store.planMovement({kind:'unit',id:'b'},250,0,{depth:2}),/操作|陣営|控制|权限/);
 assert.equal(await readSave('junqi-simulation-v1:'+id),before);
 await store.planMovement({kind:'unit',id:'a'},0,0,{depth:1});await store.resolveMovement();assert.ok((await saved(id)).instances[0].underwater);
});

test('air ships can change altitude during movement and land ships use land terrain',async()=>{
 let scene=source();scene.instances=[ship('a')];scene.instances[0].snapshot.naval.kind='air';scene.instances[0].altitude=1;
 let {id,store}=await simulation(scene);await store.beginMovement();await store.planMovement({kind:'unit',id:'a'},10,0,{altitude:4});await store.resolveMovement();assert.equal((await saved(id)).instances[0].altitude,4);
 scene=source();scene.instances=[ship('a')];scene.instances[0].snapshot.naval.kind='land';scene.terrain.heights.fill(10);
 ({id,store}=await simulation(scene));await store.beginMovement();await store.planMovement({kind:'unit',id:'a'},10,0);await store.resolveMovement();near((await saved(id)).instances[0].x,10);
});

test('submerged targets require ASW even at close range, surface targets keep ordinary naval reconnaissance',async()=>{
 const scene=source();submarine(scene.instances[1]);scene.instances[1].x=20;
 const{id}=await simulation(scene);const raw=await saved(id),[observer,target]=raw.instances;
 observer.snapshot.naval.seaRecon='U';observer.snapshot.naval.aswRecon='';
 assert.equal(getObserverVisibility(raw,observer,target),null);
 observer.snapshot.naval.aswRecon='F';assert.equal(getObserverVisibility(raw,observer,target),'identified');
 target.x=150;target.snapshot.naval.detection='B';assert.equal(getObserverVisibility(raw,observer,target),null);
 observer.snapshot.naval.aswRecon='A';assert.equal(getObserverVisibility(raw,observer,target),'shadow');
 target.depth=0;target.underwater=false;observer.snapshot.naval.aswRecon='';target.x=20;assert.equal(getObserverVisibility(raw,observer,target),'identified');
 submarine(observer);assert.equal(getObserverVisibility(raw,observer,target),'identified');
});

test('all five underwater guidance families keep their base algorithms and allow submerged weapons',async()=>{
 const variants=[['平射（水下）','direct'],['抛射（水下）','lobbed'],['雷达（水下）','radar'],['数控（水下）','computer'],['惯性（水下）','inertial']];
 for(const [guidance,id] of variants){const profile=readWeaponProfile(gun('g',guidance));assert.equal(profile.guidance,id);assert.equal(profile.underwater,true);assert.deepEqual(profile.issues,[]);}
 const scene=source();scene.instances[1].x=30;const sub=submarine(scene.instances[0]);
 arm(sub,[gun('normal','平射'),...variants.map(([g],i)=>gun('water-'+i,g))]);
 const{id,store}=await simulation(scene);await store.beginMovement();await store.resolveMovement();let raw=await saved(id);
 const groups=raw.instances[0].equipmentState.groups;
 const before=await readSave('junqi-simulation-v1:'+id);
 await assert.rejects(store.saveAttackCommands({unitId:'a',assignments:[{groupId:groups[0].id,targetId:'b'}]},store.getSceneSnapshot().revision),/潜航/);
 assert.equal(await readSave('junqi-simulation-v1:'+id),before);
 await store.saveAttackCommands({unitId:'a',assignments:groups.slice(1).map(group=>({groupId:group.id,targetId:'b'}))},store.getSceneSnapshot().revision);
 raw=await saved(id);assert.equal(raw.attackRuntime.commands.length,5);assert.ok(raw.instances[0].equipmentState.groups.every(group=>group.remainingAmmo===20));
});

test('new underwater guidance retains algorithms for half-width parentheses and Chinese/Japanese spellings',()=>{
 for(const [name,base] of [['抛射','lobbed'],['拋射','lobbed'],['雷达','radar'],['レーダー','radar'],['数控','computer'],['惯性','inertial'],['慣性','inertial']]){
  const profile=readWeaponProfile(gun('g',name+'(水下)'));assert.equal(profile.guidance,base);assert.equal(profile.underwater,true);
 }
});


test('real background worker settles vertical orders with the selected surface speed',async()=>{
 const {Worker}=await import('node:worker_threads');
 const {shutdownBackground}=await import('../tactical-map/background-client.js?v=field-support-1');
 const scene=source();submarine(scene.instances[0]);const {id,store}=await simulation(scene);
 globalThis.Worker=class{
  constructor(){this.worker=new Worker(new URL('./worker-thread-adapter.mjs',import.meta.url));this.worker.on('message',data=>this.onmessage?.({data}));this.worker.on('error',error=>this.onerror?.(error));}
  postMessage(data){this.worker.postMessage(data);} terminate(){this.worker.terminate();}
 };
 try{await store.beginMovement();await store.planMovement({kind:'unit',id:'a'},80,0,{depth:0});await store.resolveMovement();const raw=await saved(id);near(raw.instances[0].x,80);assert.equal(raw.instances[0].depth,0);assert.equal(raw.instances[0].underwater,false);}
 finally{shutdownBackground();delete globalThis.Worker;}
});


test('duplicate legacy surface speed migrates to the original speed field',()=>{
 globalThis.localStorage={getItem:()=>null,setItem(){}};
 const catalog=initializeCatalog([]);const value=structuredClone(catalog.units.find(u=>u.branch==='navy'));
 value.id='legacy-speed';value.protected=false;Object.assign(value.naval,{kind:'submarine',speedKnots:10,surfaceSpeedKnots:18,submergedSpeedKnots:9});
 catalog.saveUnit(value);let naval=catalog.units.find(u=>u.id===value.id).naval;
 assert.equal(naval.speedKnots,18);assert.equal(naval.submergedSpeedKnots,9);assert.ok(!('surfaceSpeedKnots' in naval));
 const edited=structuredClone(catalog.units.find(u=>u.id===value.id));edited.naval.speedKnots=22;catalog.saveUnit(edited);assert.equal(catalog.units.find(u=>u.id===value.id).naval.speedKnots,22);
 const unit=ship('legacy');Object.assign(unit.snapshot.naval,{kind:'submarine',speedKnots:10,surfaceSpeedKnots:18,submergedSpeedKnots:9});normalizeNavalPosition(unit);
 assert.equal(readShipProfile(unit).speedKnots,18);assert.ok(!('surfaceSpeedKnots' in unit.snapshot.naval));
});
