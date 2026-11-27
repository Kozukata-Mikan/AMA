import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAircraft,aircraftAirTime,aircraftParkingSlots,aircraftFacilityCompatible} from '../js/aircraft-template.js';
import {AIRCRAFT_FIELDS} from '../js/catalog-seed.js?v=field-support-1';
import {initializeCatalog} from '../js/catalog-store.js?v=field-support-1';
import {createBattleStore} from '../js/battle-state.js?v=aviation-deck-1';
import {ensureAircraftRuntime,applyAircraftHit,aircraftCanAct,aircraftTimerDisplay,finishAircraftTurn} from '../tactical-map/aircraft-runtime.js?v=aviation-deck-1';
import {createSimulation,openSimulation} from '../tactical-map/simulation-store.js?v=resume-save-1';
import {getObservedScene} from '../tactical-map/simulation-features.js?v=aviation-deck-1';
import {ensureShipRuntime} from '../tactical-map/ship-runtime.js?v=field-support-1';
import {readSave} from '../js/save-database.js';
import {resetDatabase} from './save-test-environment.mjs';
import {source,ship} from './fixtures.mjs';
const memory=()=>globalThis.localStorage={getItem:()=>null,setItem(){}};
function aircraft(id='plane',side='ally',endurance='1k'){
 const unit=ship(id,side,0);unit.branch=unit.snapshot.branch='air';unit.currentHp=unit.snapshot.maxHp=2;unit.altitude=10;
 unit.snapshot.aircraft=normalizeAircraft({type:'carrier',engines:2,crew:3,ceiling:100,maneuverability:'2R'});
 Object.assign(unit.snapshot.naval,{speedKnots:200,endurance,armor:'C',airRecon:'B',seaRecon:'C',aswRecon:'D'});return unit;
}
const raw=id=>readSave('junqi-simulation-v1:'+id).then(JSON.parse);
async function setup(endurance='1k',side='ally',currentHp=2){await resetDatabase();memory();const scene=source();scene.instances=[aircraft('plane',side,endurance)];scene.instances[0].currentHp=currentHp;const id=await createSimulation(scene,()=>({valid:true}));return{id,store:await openSimulation(id)};}
async function round(store){await store.beginMovement();await store.resolveMovement();for(let i=0;i<6;i++)await store.settleAttackPhase(store.getSceneSnapshot().revision);await store.finishSpecialPhase(store.getSceneSnapshot().revision);await store.finishTurn(store.getSceneSnapshot().revision);}

test('aircraft fields and types are independent of ship hull, damage and training settings',()=>{
 const fields=new Set(AIRCRAFT_FIELDS.map(f=>f.key));for(const key of ['aircraft.type','aircraft.engines','aircraft.crew','aircraft.maneuverability','aircraft.ceiling','aircraft.training','naval.speedKnots','naval.endurance','naval.armor','naval.airRecon','naval.seaRecon','naval.aswRecon'])assert.ok(fields.has(key),key);
 for(const key of ['maxHp','naval.kind','naval.iconType','naval.strength','naval.submergedSpeedKnots','trainingTraits'])assert.ok(!fields.has(key));
 for(const engines of [1,2,3,4])assert.equal(aircraftParkingSlots({engines}),engines);
 assert.equal(normalizeAircraft({type:'drone'}).crew,0);assert.equal(normalizeAircraft({type:'land-drone'}).crew,0);assert.equal(normalizeAircraft({maneuverability:'2 r'}).maneuverability,'2R');
 for(const bad of [{engines:0},{crew:-1},{maneuverability:'fast'},{ceiling:0},{type:'other'},{version:2}])assert.throws(()=>normalizeAircraft(bad));
});
test('airtime uses the requested half-maximum-speed formula, in whole rounds',()=>{
 assert.equal(aircraftAirTime('1k',200),10);assert.equal(aircraftAirTime('1.09k',200),10);assert.equal(aircraftAirTime('100',200),1);assert.equal(aircraftAirTime('',null),null);assert.throws(()=>aircraftAirTime('1k',0));assert.throws(()=>aircraftAirTime('oops',200));
});
test('facility compatibility records all five types without treating ports as airfields',()=>{
 const ship={branch:'navy'},runway={branch:'building',building:{kind:'airport',airportType:'runway'}},airship={branch:'building',building:{kind:'airport',airportType:'airship'}},anchorage={branch:'building',building:{kind:'airport',airportType:'anchorage'}},port={branch:'building',building:{kind:'port'}};
 for(const type of ['carrier','drone']){assert.ok(aircraftFacilityCompatible(type,ship));assert.ok(aircraftFacilityCompatible(type,runway));assert.ok(!aircraftFacilityCompatible(type,anchorage));}
 for(const type of ['land','land-drone']){assert.ok(!aircraftFacilityCompatible(type,ship));assert.ok(aircraftFacilityCompatible(type,runway));assert.ok(!aircraftFacilityCompatible(type,airship));assert.ok(!aircraftFacilityCompatible(type,anchorage));}
 assert.ok(aircraftFacilityCompatible('seaplane',ship));assert.ok(aircraftFacilityCompatible('seaplane',anchorage));assert.ok(!aircraftFacilityCompatible('seaplane',runway));assert.ok(!aircraftFacilityCompatible('carrier',port));
});
test('catalog validates support-only pods and preserves distinct loadouts, references and snapshots',()=>{
 memory();const catalog=initializeCatalog([]);const gun=catalog.getData().equipment.find(e=>e.kind==='weapon');const pod=catalog.getData().equipment.find(e=>e.kind==='support');
 const value={...aircraft().snapshot,protected:false,sizeLevel:1,faction:'',mounts:[{position:'ポッド',equipmentId:pod.id,count:1}],aircraft:normalizeAircraft({...aircraft().snapshot.aircraft,loadouts:[{id:'bomb',name:'爆装',mounts:[{equipmentId:gun.id,count:2}]},{id:'empty',name:'空装',mounts:[]}]})};catalog.saveUnit(value);catalog.importJSON(catalog.exportJSON());const result=catalog.units.find(u=>u.id===value.id);assert.equal(result.maxHp,2);assert.equal(result.aircraft.loadouts.length,2);assert.equal(result.mounts.length,1);assert.ok(result.equipmentSnapshots.some(e=>e.id===gun.id));
 const before=catalog.exportJSON();assert.throws(()=>catalog.saveUnit({...value,mounts:[{position:'ポッド',equipmentId:gun.id,count:1}]}),/支援装備/);assert.equal(catalog.exportJSON(),before);assert.throws(()=>catalog.deleteEquipment(gun.id));
 const unknown=structuredClone(value);unknown.aircraft.loadouts[0].mounts[0].equipmentId='missing';assert.throws(()=>catalog.saveUnit(unknown),/参照する装備/);assert.equal(catalog.exportJSON(),before);
});
test('aircraft damage has only operational/heavy/destroyed, heavy retains movement alone',()=>{
 const unit=aircraft();ensureAircraftRuntime(unit);applyAircraftHit(unit,{hit:true,durabilityDamage:1});assert.equal(unit.aircraftState.status,'operational');applyAircraftHit(unit,{hit:true,durabilityDamage:1});assert.equal(unit.aircraftState.status,'heavy');assert.ok(aircraftCanAct(unit,'move'));assert.ok(!aircraftCanAct(unit,'attack'));assert.ok(!aircraftCanAct(unit,'recon'));applyAircraftHit(unit,{hit:false});assert.equal(unit.aircraftState.status,'heavy');applyAircraftHit(unit,{hit:true,durabilityDamage:0});assert.equal(unit.aircraftState.status,'destroyed');assert.ok(!aircraftCanAct(unit,'move'));
});
test('time advances once at round end even while stationary, with strict private half-time colors',()=>{
 const unit=aircraft();ensureAircraftRuntime(unit);unit.observationOwn=true;const scene={instances:[unit],turn:{number:1}};assert.equal(aircraftTimerDisplay(unit).color,'#d684ff');
 for(let n=1;n<=10;n++){scene.turn.number=n;finishAircraftTurn(scene);assert.equal(unit.aircraftState.remainingAirTime,10-n);if(n===5)assert.equal(aircraftTimerDisplay(unit).color,'#d684ff');if(n===6)assert.equal(aircraftTimerDisplay(unit).color,'#ff4e68');assert.throws(()=>finishAircraftTurn(scene),/処理済/);}
 assert.equal(unit.aircraftState.status,'destroyed');assert.equal(unit.aircraftState.destroyedReason,'air-time-expired');assert.equal(aircraftTimerDisplay(unit),null);unit.observationOwn=false;assert.equal(aircraftTimerDisplay(unit),null);
});
test('custom scene enforces ceiling and endurance-derived engine health without changing saved snapshots',async()=>{
 await resetDatabase();memory();const plane=aircraft();const battle=await createBattleStore([plane.snapshot]);const unit=await battle.addUnit(plane.unitId);assert.equal(unit.altitude,80);const before=battle.exportScene();await assert.rejects(battle.updateUnit(unit.instanceId,{altitude:101}),/上昇限度/);await assert.rejects(battle.updateUnit(unit.instanceId,{currentHp:3}),/耐性/);assert.equal(battle.exportScene(),before);await battle.updateUnit(unit.instanceId,{altitude:100});await battle.importScene(battle.exportScene());assert.equal(battle.getScene().instances[0].snapshot.aircraft.engines,2);
});
test('real simulation moves a heavy aircraft, consumes route endurance, saves elapsed time and hides foreign clocks',async(t)=>{
 // This test checks movement and clocks; survival of the separate navigation roll is deterministic.
 t.mock.method(crypto,'getRandomValues',values=>{values.fill(1);return values;});
 const{id,store}=await setup('1k','ally',0);await store.beginMovement();await store.planMovement({kind:'unit',id:'plane'},50,0,{altitude:20});await store.resolveMovement();let scene=await raw(id);assert.equal(scene.instances[0].x,50);assert.equal(scene.instances[0].altitude,20);assert.equal(scene.instances[0].aircraftState.remainingEndurance,4580);for(let i=0;i<6;i++)await store.settleAttackPhase(store.getSceneSnapshot().revision);await store.finishSpecialPhase(store.getSceneSnapshot().revision);await store.finishTurn(store.getSceneSnapshot().revision);scene=await raw(id);assert.equal(scene.instances[0].aircraftState.remainingAirTime,9);const reopened=await openSimulation(id);assert.equal(reopened.getSceneSnapshot().instances[0].aircraftState.remainingAirTime,9);
 const observer=ship('observer','enemy',50);ensureShipRuntime(observer);scene.instances.push(observer);scene.controls.observationSide='enemy';const observed=getObservedScene(scene).instances.find(u=>u.instanceId==='plane');assert.ok(observed);assert.equal(observed.aircraftState,undefined);assert.equal(aircraftTimerDisplay(observed),null);
});
test('expiry is committed at round end and removed from map; enemy autonomy does not apply ship AI to aircraft',async()=>{
 const{id,store}=await setup('100','enemy');await store.setEnemyAutonomy(true);await round(store);const scene=await raw(id);assert.equal(scene.turn.number,2);assert.equal(scene.instances[0].aircraftState.status,'destroyed');assert.ok(!store.getSceneSnapshot().instances.some(u=>u.instanceId==='plane'));assert.equal(scene.initialScene.instances[0].currentHp,2);assert.equal(scene.initialScene.instances[0].aircraftState,undefined);
});

test('isolated worker saves aircraft clocks and expiry through complete simulation phases',async()=>{
 const {Worker}=await import('node:worker_threads');const {shutdownBackground}=await import('../tactical-map/background-client.js?v=aviation-deck-1');
 globalThis.Worker=class{constructor(){this.worker=new Worker(new URL('./worker-thread-adapter.mjs',import.meta.url));this.worker.on('message',data=>this.onmessage?.({data}));this.worker.on('error',e=>this.onerror?.(e));}postMessage(v){this.worker.postMessage(v)}terminate(){this.worker.terminate()}};
 try{const{id,store}=await setup('100');await round(store);const scene=await raw(id);assert.equal(scene.instances[0].aircraftState.remainingAirTime,0);assert.equal(scene.instances[0].aircraftState.status,'destroyed');assert.equal(scene.phaseFinishRuntime.records.at(-1).aircraftReports[0].destroyed,true);assert.ok(!store.getSceneSnapshot().instances.length);}finally{shutdownBackground();delete globalThis.Worker;}
});

test('aircraft form calculations and loadout controls preserve independent combinations',async()=>{
 class Element{constructor(tag,text=''){this.tagName=tag;this.textContent=text;this.children=[];this.dataset={};this.listeners=new Map();this._value='';}set value(v){this._value=String(v??'');}get value(){return this._value;}append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);if(this.tagName==='select'&&!this.value)this.value=n.value;}}replaceChildren(...nodes){this.children=[];this.append(...nodes);}setAttribute(k,v){this[k]=v;}addEventListener(type,fn){this.listeners.set(type,fn);}closest(){return this.parent;}remove(){this.parent.children=this.parent.children.filter(n=>n!==this);}fire(type){this.listeners.get(type)?.({type});}}
 const oldDocument=globalThis.document,oldOption=globalThis.Option;globalThis.document={createElement:tag=>new Element(tag)};globalThis.Option=class extends Element{constructor(text,value){super('option',text);this.value=value;}};
 try{
  const {mountAircraftDerivedFields,mountAircraftLoadoutEditor}=await import('../tactical-map/aircraft-catalog-ui.js');const controls=new Map();for(const [key,value]of Object.entries({'naval.speedKnots':'200','naval.endurance':'1k','aircraft.engines':'2','aircraft.type':'carrier','aircraft.crew':'1','aircraft.remoteRange':''})){const label=new Element('label'),control=new Element('input');control.value=value;label.append(control);controls.set(key,control);}
  const host=new Element('div'),output=mountAircraftDerivedFields(controls,host);assert.match(output.textContent,/2.*10ラウンド.*5時間/);controls.get('aircraft.type').value='drone';controls.get('aircraft.type').fire('change');assert.equal(controls.get('aircraft.crew').value,'0');assert.equal(controls.get('aircraft.remoteRange').parent.hidden,false);controls.get('naval.endurance').value='500';controls.get('naval.endurance').fire('input');assert.match(output.textContent,/5ラウンド/);
  const data=[{id:'a',name:'雷装',mounts:[{equipmentId:'weapon-a',count:2}]},{id:'b',name:'爆装',mounts:[{equipmentId:'weapon-b',count:1}]}];const root=new Element('div');const read=mountAircraftLoadoutEditor(root,[{id:'weapon-a',name:'魚雷',kind:'weapon'},{id:'weapon-b',name:'爆弾',kind:'weapon'}],data);assert.deepEqual(read(),data);const firstGroup=root.children[0].children.find(n=>n.tagName==='div').children[0];firstGroup.children.find(n=>n.textContent==='この構成を削除').fire('click');assert.deepEqual(read(),[data[1]]);
 }finally{globalThis.document=oldDocument;globalThis.Option=oldOption;}
});
