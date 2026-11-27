import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {Worker as NodeWorker} from 'node:worker_threads';
import {shutdownBackground} from '../tactical-map/background-client.js?v=aviation-deck-1';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {ensureShipRuntime} from '../tactical-map/ship-runtime.js?v=field-support-1';
import {TRAINING_TRAIT_OPTIONS} from '../js/catalog-seed.js?v=field-support-1';
import {source,ship} from '../tests/fixtures.mjs';
import {aircraft,weapon} from '../tests/scenarios/carrier-air-strike.mjs';
import {supportEquipmentSeed,STATION_IDS,supportEffectOf} from '../tactical-map/support-equipment.js?v=field-support-1';
import {ensureBuildingState} from '../tactical-map/building-state.js?v=facility-rules-1';
import {ensureUnitCombatRuntime} from '../tactical-map/equipment-runtime.js?v=field-support-1';
import {resetDatabase} from '../tests/save-test-environment.mjs';
import {createSimulation,openSimulation} from '../tactical-map/simulation-store.js?v=resume-save-1';
import {readSave} from '../js/save-database.js';
export function auditCases(){
 const cases=[];
 function add(name,mutate,expected='advance'){cases.push({name,mutate,expected});}
 const arm=(u,e=weapon('gun',1,'艦砲規則',5,{guidance:'平射',range:300}),position='中部①',count=1)=>{u.snapshot.mounts=[{position,equipmentId:e.id,count}];u.snapshot.equipmentSnapshots=[e];};
 const building=(u,hp=30)=>{u.branch=u.snapshot.branch='building';u.snapshot.building={kind:'airport',airportType:'runway',permanence:'permanent',runways:1};u.currentHp=u.snapshot.maxHp=hp;u.snapshot.mounts.forEach(m=>m.position='露天');};
 for(const guidance of ['平射','抛射','射线','雷达','数控','惯性'])for(const power of ['艦砲規則','2'])add(`水面炮战/${guidance}/${power}`,s=>arm(s.instances[1],weapon('gun',1,power,5,{guidance,range:300})));
 for(const position of ['前部','中部①','中部②','両舷','後部','尾部'])add('炮战射界/'+position,s=>arm(s.instances[1],undefined,position,4));
 for(const scope of ['单体','集群','范围（指定2）','范围（随机3）'])add('目标范围/'+scope,s=>{arm(s.instances[1],weapon('gun',1,'艦砲規則',5,{range:300,scope}));s.instances[0].groupId='g';const t=ship('a2','ally',3);t.groupId='g';t.snapshot.naval.speedKnots=0;s.instances.push(t);s.groups=[{id:'g',name:'g',kind:'cluster',parentId:null}];});
 for(const scope of ['范围（指定2）','范围（随机3）','范围（全体）'])add('两舷范围炮/'+scope,s=>{arm(s.instances[1],weapon('gun',1,'艦砲規則',5,{range:300,scope}),'両舷',4);const target=s.instances[0];target.groupId='g';const other=structuredClone(target);other.instanceId='a2';other.x=3;s.instances.push(other);s.groups=[{id:'g',name:'g',kind:'cluster',parentId:null}];});
 for(const guidance of ['平射（水下）','抛射（水下）','雷达（水下）','数控（水下）','惯性（水下）'])add('潜航对潜/'+guidance,s=>{for(const u of s.instances){u.snapshot.naval.kind='submarine';u.snapshot.naval.aswRecon='A';u.snapshot.naval.submergedSpeedKnots=0;u.depth=2;u.underwater=true;}arm(s.instances[1],weapon('gun',1,'2（水下）',5,{guidance,range:300}));});
 add('普通炮跳过水下目标',s=>{s.instances[0].snapshot.naval.kind='submarine';s.instances[0].depth=2;s.instances[0].underwater=true;arm(s.instances[1]);});
 for(const power of ['艦砲規則','2'])for(const kind of ['building','air','airship'])add(`舰炮攻击/${kind}/${power}`,s=>{arm(s.instances[1],weapon('gun',1,power,5,{range:300}));const u=s.instances[0];if(kind==='building')building(u);if(kind==='airship'){u.snapshot.naval.kind='air';u.altitude=10;}if(kind==='air'){u.branch='air';u.snapshot=aircraft('target',{engines:2});u.unitId=u.snapshot.id;u.currentHp=2;u.altitude=20;}});
 add('空中舰自律向水面炮击',s=>{arm(s.instances[1]);s.instances[1].snapshot.naval.kind='air';s.instances[1].altitude=10;});
 add('建筑炮自律',s=>{arm(s.instances[1]);building(s.instances[1]);});
 add('建筑炮配置耐性0、中心尚存',s=>{const u=s.instances[1];arm(u);u.snapshot.mounts.push({position:'中心',equipmentId:'center',count:1});u.snapshot.equipmentSnapshots.push({...supportEquipmentSeed()[0],id:'center'});building(u,6);u.snapshot.mounts[1].position='中心';u.currentHp=3;ensureBuildingState(u).lastRecoveryTurn=1;});
 add('设备威力对舰',s=>arm(s.instances[1],weapon('gun',1,'2（设备）',5,{range:300})));
 for(const effect of supportEquipmentSeed())add('炮战携带支援/'+effect.supportEffect,s=>{arm(s.instances[1]);s.instances[1].snapshot.equipmentSnapshots.push(effect);s.instances[1].snapshot.mounts.push({position:'後部',equipmentId:effect.id,count:1});});
 add('旧版水上机弹射器与炮战并存',s=>{arm(s.instances[1]);const u=s.instances[1];u.snapshot.equipmentSnapshots.push({id:'eq-seaplane-catapult',name:'旧式カタパルト',kind:'support',supportEffect:''});u.snapshot.mounts.push({position:'後部',equipmentId:'eq-seaplane-catapult',count:1});});
 for(const state of ['damaged','destroyed','empty','partial-ammo','future-order','PAS'])add('装备状态/'+state,s=>{const u=s.instances[1];arm(u);if(state==='future-order')u.snapshot.equipmentSnapshots[0].maxOrder='1';if(state==='PAS')u.snapshot.equipmentSnapshots[0].maxOrder='PAS';ensureUnitCombatRuntime(u);const g=u.equipmentState.groups[0];if(['damaged','destroyed'].includes(state))g.damaged=true;if(state==='destroyed')g.destroyed=true;if(state==='empty')g.remainingAmmo=0;if(state==='partial-ammo'){u.snapshot.equipmentSnapshots[0].projectionCoefficient=2;g.remainingAmmo=1;}});
 add('无合法目标、超射程',s=>{s.instances[0].x=90;arm(s.instances[1],weapon('gun',1,'艦砲規則',5,{range:1}));});
 for(const time of ['00:00','05:30','12:00','20:30','23:30'])add('炮战时段/'+time,s=>{arm(s.instances[1]);s.environment={day:1,time,weather:'clear'};});
 for(const weather of ['fog','dense-fog','blizzard','thunderstorm','typhoon'])add('炮战天气/'+weather,s=>{arm(s.instances[1]);s.environment={day:1,time:'12:00',weather};});
 for(const type of ['fire','flooding'])add('炮战既有状态/'+type,s=>{arm(s.instances[1]);const u=s.instances[1];ensureShipRuntime(u);u.shipState.effects[type]={level:type==='fire'?'small':'light',acquiredTurn:1,failedControls:0};});
 for(const trait of TRAINING_TRAIT_OPTIONS)add('炮战词条/'+trait.id,s=>{arm(s.instances[1]);s.instances[1].snapshot.trainingTraits=[trait.id];if(trait.id==='one-against-thousand')s.instances[1].currentHp=40;});
 for(const name of ['unknown-support','large','army','special'])add('预留规则/'+name,s=>{arm(s.instances[1]);if(name==='unknown-support'){s.instances[1].snapshot.equipmentSnapshots.push({id:'other',name:'未定義電子装備',kind:'support'});s.instances[1].snapshot.mounts.push({position:'後部',equipmentId:'other',count:1});}if(name==='large')s.instances[1].snapshot.equipmentSnapshots[0].guidance='惯性（大型）';if(['army','special'].includes(name))s.instances[1].branch=s.instances[1].snapshot.branch=name;},'stop');
 return cases;
}
function chain(e){const a=[];for(let depth=0;e&&depth<8;depth++,e=e.cause)a.push({name:e.name,message:e.message,code:e.code});return a;}
export async function auditSimulationRules({outputDirectory=null,catalogPath=null,worker=false}={}){
 const results=[],previousWorker=globalThis.Worker;if(worker)globalThis.Worker=class{constructor(){this.w=new NodeWorker(new URL('../tests/worker-thread-adapter.mjs',import.meta.url));this.w.on('message',data=>this.onmessage?.({data}));this.w.on('error',error=>this.onerror?.(error));}postMessage(data){this.w.postMessage(data);}terminate(){this.w.terminate();}};
 try{
 const cases=auditCases();if(catalogPath){const catalog=JSON.parse(await readFile(catalogPath,'utf8'));for(const equipment of catalog.equipment.filter(e=>e.kind==='weapon'))cases.push({name:'实存图鉴/'+equipment.name,expected:'advance',mutate(s){const actor=s.instances[1];actor.snapshot.equipmentSnapshots=[structuredClone(equipment)];actor.snapshot.mounts=[{position:'中部①',equipmentId:equipment.id,count:1}];if(/水下/.test(equipment.guidance+equipment.powerRule))for(const u of s.instances){u.snapshot.naval.kind='submarine';u.snapshot.naval.aswRecon='A';u.snapshot.naval.submergedSpeedKnots=0;u.underwater=true;u.depth=2;}const target=s.instances[0];target.groupId='g';const other=structuredClone(target);other.instanceId='a2';other.x=target.x+3;other.groupId='g';s.instances.push(other);s.groups=[{id:'g',name:'実存編隊',kind:'cluster',parentId:null}];}});for(const equipment of catalog.equipment.filter(e=>e.kind==='support'))cases.push({name:'实存图鉴支援/'+equipment.name,expected:STATION_IDS.includes(supportEffectOf(equipment))?'advance':'stop',mutate(s){const actor=s.instances[1],gun=weapon('audit-gun',1,1,5,{range:300});actor.snapshot.equipmentSnapshots=[gun,structuredClone(equipment)];actor.snapshot.mounts=[{position:'中部①',equipmentId:gun.id,count:1},{position:'後部',equipmentId:equipment.id,count:1}];}});}
 for(const c of cases){
  await resetDatabase();globalThis.localStorage={getItem:()=>null,setItem(){}};const input=source();input.instances[1].x=50;for(const u of input.instances){u.currentHp=u.snapshot.maxHp=100;Object.assign(u.snapshot.naval,{speedKnots:0,endurance:'1k',seaRecon:'A',airRecon:'A',aswRecon:'A',armor:'C'});}c.mutate(input);let stage='create',store,id;const start=performance.now();
  try{id=await createSimulation(input,()=>({valid:true}));store=await openSimulation(id);await store.setEnemyAutonomy(true);stage='movement';await store.beginMovement();await store.resolveMovement();for(let i=0;i<6;i++){stage=store.getSceneSnapshot().turn.phaseId;await store.settleAttackPhase(store.getSceneSnapshot().revision);}stage='special';await store.finishSpecialPhase(store.getSceneSnapshot().revision);stage='end';await store.finishTurn(store.getSceneSnapshot().revision);await openSimulation(id);results.push({name:c.name,expected:c.expected,outcome:'advance',milliseconds:performance.now()-start});}
  catch(e){results.push({name:c.name,expected:c.expected,outcome:'stop',stage,error:chain(e),milliseconds:performance.now()-start});}
 }
 if(outputDirectory){await mkdir(outputDirectory,{recursive:true});await writeFile(outputDirectory+'/rule-audit.json',JSON.stringify(results,null,2));}
 return results;
 }finally{if(worker){shutdownBackground();if(previousWorker===undefined)delete globalThis.Worker;else globalThis.Worker=previousWorker;}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const r=await auditSimulationRules({outputDirectory:process.argv[2]??'/tmp/ama-rule-audit',catalogPath:process.argv[3]==='-'?null:process.argv[3]??null,worker:process.argv[4]==='worker'});console.log(JSON.stringify(r,null,2));}
