import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBuilding,normalizeBuildingUnit,buildingPlacement,buildingSymbolParts,BUILDING_DIAMETER,buildingPartPresentation,drawBuildingIcon,transformBuildingPath} from '../tactical-map/building-runtime.js';
import {BUILDING_FIELDS} from '../js/catalog-seed.js?v=field-support-1';
import {initializeCatalog} from '../js/catalog-store.js?v=field-support-1';
import {createBattleStore} from '../js/battle-state.js?v=aviation-deck-1';
import {createSimulation,openSimulation} from '../tactical-map/simulation-store.js?v=aviation-deck-1';
import {getObserverVisibility} from '../tactical-map/simulation-features.js?v=aviation-deck-1';
import {source,ship} from './fixtures.mjs';
import {resetDatabase} from './save-test-environment.mjs';
import {prepareSimulationAmmoSource} from '../tactical-map/equipment-runtime.js?v=field-support-1';
import {readSave} from '../js/save-database.js';
const memory=()=>globalThis.localStorage={getItem:()=>null,setItem(){}};
const facility=(id='facility',side='ally')=>{const unit=ship(id,side);unit.branch=unit.snapshot.branch='building';unit.faction='blue';unit.snapshot.building={kind:'airport',permanence:'permanent',airportType:'runway',runways:3};Object.assign(unit.snapshot.naval,{aswRecon:'B',seaRecon:'B',airRecon:'B',detection:'F',strength:2,armor:'C',endurance:'100'});return unit;};

test('building fields contain common performance plus facility types, without ship movement or training fields',()=>{
 const keys=new Set(BUILDING_FIELDS.map(f=>f.key));
 for(const key of ['name','branch','faction','maxHp','sizeLevel','naval.armor','naval.strength','naval.detection','naval.seaRecon','naval.airRecon','naval.aswRecon','building.kind','building.runways'])assert.ok(keys.has(key),key);
 for(const key of ['naval.speedKnots','naval.kind','naval.iconType','trainingTraits'])assert.ok(!keys.has(key));
 assert.equal(BUILDING_FIELDS.find(f=>f.key==='sizeLevel').type,'building-size');
});
test('building catalog validation, equipment and export/import preserve definitions atomically',()=>{
 memory();const catalog=initializeCatalog([]),unit=facility();
 const value={...unit.snapshot,id:'new-facility',protected:false,faction:'blue',sizeLevel:1,maxHp:10,trainingTraits:[],mounts:[{equipmentId:catalog.getData().equipment[0].id,position:'中央',count:2}]};
 catalog.saveUnit(value);catalog.importJSON(catalog.exportJSON());let found=catalog.units.find(u=>u.id===value.id);
 assert.equal(found.branch,'building');assert.equal(found.building.runways,3);assert.equal(found.naval.aswRecon,'B');assert.equal(found.mounts[0].count,2);assert.equal(found.equipmentSnapshots.length,1);
 const before=catalog.exportJSON();
 for(const patch of [{sizeLevel:2},{building:{kind:'unknown'}},{building:{runways:4}},{building:{runways:1.5}},{building:{permanence:'bad'}}])assert.throws(()=>catalog.saveUnit({...value,...patch}));
 assert.equal(catalog.exportJSON(),before);
});
test('facility placement allows every terrain surface and ignores stored altitude',()=>{
 const u=facility();u.altitude=80;normalizeBuildingUnit(u);assert.equal(u.altitude,null);assert.equal(u.sizeLevel,1);
 for(const kind of ['land','sea','river','shallow']){const surface=kind==='land'?12:0;const state=buildingPlacement({inside:true,kind,height:kind==='land'?12:-20,surface});assert.ok(state.valid);assert.equal(state.height,surface);}
 assert.ok(!buildingPlacement({inside:false,surface:0}).valid);
});
test('facility symbols use an exact 50-grid ring, runway counts and selective bases',()=>{
 assert.equal(BUILDING_DIAMETER,50);
 for(const permanence of ['temporary','permanent'])for(const airportType of ['runway','airship','anchorage'])for(const runways of [1,2,3]){
  const parts=buildingSymbolParts({kind:'airport',permanence,airportType,runways});
  assert.equal(parts.filter(p=>p.role==='base').length,permanence==='permanent'?1:0);
  assert.equal(parts.filter(p=>p.role==='runway').length,airportType==='runway'?runways:airportType==='anchorage'?2:0);
  assert.equal(parts.filter(p=>p.role==='wave').length,airportType==='anchorage'?1:0);
  const ring=parts.find(p=>p.role==='ring'),coords=ring.d.match(/-?\d+(?:\.\d+)?/g).map(Number),x=coords.filter((_,i)=>i%2===0),y=coords.filter((_,i)=>i%2===1);
  assert.equal(Math.max(...x)-Math.min(...x),50);assert.equal(Math.max(...y)-Math.min(...y),50);
 }
 for(const permanence of ['temporary','permanent'])for(const portType of ['trade','cargo','supply']){
  const parts=buildingSymbolParts({kind:'port',portType,permanence});assert.equal(parts.filter(p=>p.role==='base').length,permanence==='permanent'?1:0);assert.ok(parts.some(p=>p.role==='anchor'));assert.equal(parts.filter(p=>p.role===portType).length,portType==='cargo'?3:1);
 }
 assert.equal(normalizeBuilding().kind,'airport');
});
test('building deployment saves side, color, equipment and fixed body through scene reload',async()=>{
 await resetDatabase();memory();const catalog=initializeCatalog([]);const value={...facility().snapshot,id:'facility-template',protected:false,faction:'blue',maxHp:10,sizeLevel:1,trainingTraits:[],mounts:[{equipmentId:catalog.getData().equipment[0].id,position:'中央',count:1}]};catalog.saveUnit(value);
 const battle=await createBattleStore(catalog.units);
 try{const added=await battle.addUnit(value.id,{name:'臨海飛行場',side:'enemy',faction:'orange'});await battle.updateUnit(added.instanceId,{x:10,y:20});await battle.importScene(battle.exportScene());const u=battle.getScene().instances[0];assert.equal(u.branch,'building');assert.equal(u.side,'enemy');assert.equal(u.faction,'orange');assert.equal(u.snapshot.building.runways,3);assert.equal(u.snapshot.equipmentSnapshots.length,1);
 const raw=battle.exportScene();await assert.rejects(battle.updateUnit(added.instanceId,{sizeLevel:2}),/体型/);assert.equal(battle.exportScene(),raw);
 }finally{await battle.destroy();}
});
test('building reconnaissance uses normal sea/ASW grades, and an enemy facility does not block autonomous turns',async()=>{
 await resetDatabase();memory();const scene=source();const b=facility('base','enemy');b.x=150;b.snapshot.equipmentSnapshots=[{id:'facility-support',name:'施設用設備',kind:'support',ammo:0}];b.snapshot.mounts=[{equipmentId:'facility-support',position:'中央',count:1}];scene.instances.push(b);scene.instances[0].faction=scene.instances[1].faction='';
 const id=await createSimulation(scene,()=>({valid:true})),store=await openSimulation(id);let raw=JSON.parse(await readSave('junqi-simulation-v1:'+id));
 const observer=raw.instances.find(u=>u.instanceId==='base'),target=raw.instances[0];assert.equal(getObserverVisibility(raw,observer,target),'shadow');
 target.snapshot.naval.kind='submarine';target.depth=2;target.underwater=true;assert.equal(getObserverVisibility(raw,observer,target),'shadow');observer.snapshot.naval.aswRecon='';assert.equal(getObserverVisibility(raw,observer,target),null);
 await store.setEnemyAutonomy(true);await store.beginMovement();await assert.rejects(store.planMovement({kind:'unit',id:'base'},160,0),/操作|陣営|艦船/);await store.resolveMovement();await store.settleAttackPhase(store.getSceneSnapshot().revision);raw=JSON.parse(await readSave('junqi-simulation-v1:'+id));assert.equal(raw.instances.find(u=>u.instanceId==='base').x,150);assert.equal(raw.turn.phaseId,'order-4');
 for(let i=0;i<5;i++)await store.settleAttackPhase(store.getSceneSnapshot().revision);await store.finishSpecialPhase(store.getSceneSnapshot().revision);await store.finishTurn(store.getSceneSnapshot().revision);raw=JSON.parse(await readSave('junqi-simulation-v1:'+id));assert.equal(raw.turn.number,2);assert.equal(raw.instances.find(u=>u.instanceId==='base').snapshot.mounts.length,1);
});


test('non-firing facilities preserve unregistered ammo without weakening ship start checks',()=>{
 const building=facility();building.snapshot.equipmentSnapshots=[{id:'empty-gun',kind:'weapon',name:'未登録弾薬',ammo:null}];building.snapshot.mounts=[{equipmentId:'empty-gun',position:'中央',count:1}];
 const input={instances:[building]};const result=prepareSimulationAmmoSource(input,[]);assert.equal(result.instances[0].snapshot.equipmentSnapshots[0].ammo,null);assert.equal(input.instances[0].snapshot.equipmentSnapshots[0].ammo,null);
 const navy=structuredClone(building);navy.branch=navy.snapshot.branch='navy';assert.throws(()=>prepareSimulationAmmoSource({instances:[navy]},[]),/予備弾数/);
});


test('reference runway layouts have a horizontal strip, with the three-strip cross above it',()=>{
 const points=path=>{const a=path.match(/-?\d+(?:\.\d+)?/g).map(Number);return Array.from({length:a.length/2},(_,i)=>({x:a[i*2],y:a[i*2+1]}));};
 const center=ps=>({x:ps.reduce((n,p)=>n+p.x,0)/ps.length,y:ps.reduce((n,p)=>n+p.y,0)/ps.length});
 for(const n of [2,3]){const runways=buildingSymbolParts({runways:n}).filter(p=>p.role==='runway').map(p=>points(p.d));assert.equal(runways.length,n);const horizontal=runways[0];assert.ok(Math.max(...horizontal.map(p=>p.x))-Math.min(...horizontal.map(p=>p.x))>10*(Math.max(...horizontal.map(p=>p.y))-Math.min(...horizontal.map(p=>p.y))));if(n===3)assert.ok(center(horizontal).y>center(runways[1]).y+5);}
});
test('upright logo rendering is reduced and lifted without projecting it onto the ground or changing data',()=>{
 const oldDocument=globalThis.document;const make=()=>({attributes:{},children:[],setAttribute(k,v){this.attributes[k]=v;},append(child){this.children.push(child);}});globalThis.document={createElementNS:make};
 try{const u=facility(),before=JSON.stringify(u),root=make();let projected=0;drawBuildingIcon(u,root,path=>{projected++;return transformBuildingPath(path,(x,y)=>({x:x-y,y:(x+y)*.43}));});assert.equal(projected,2);assert.equal(JSON.stringify(u),before);const parts=root.children[0].children;assert.equal(parts.filter(p=>p.attributes['data-plane']==='ground').length,2);assert.equal(parts.filter(p=>p.attributes['data-plane']==='upright').length,3);for(const part of buildingSymbolParts(u.snapshot.building)){const view=buildingPartPresentation(part);if(['ring','base'].includes(part.role))assert.deepEqual(view,{plane:'ground',scale:1,lift:0});else{assert.ok(view.scale<=.5);assert.ok(view.lift>0&&view.lift<25);}}}
 finally{globalThis.document=oldDocument;}
});
