// Helper for compare-simulation-optimization.mjs. User fixtures remain outside the repository.
import fs from 'node:fs/promises';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
const [root,scenePath,catalogPath,outputPath,scenario='campaign']=process.argv.slice(2),load=p=>import(pathToFileURL(root+'/'+p));
const {IDBFactory}=await import('fake-indexeddb');globalThis.indexedDB=new IDBFactory();globalThis.BroadcastChannel=undefined;delete globalThis.Worker;
let randomState=20261116,uuid=0;const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296};Math.random=random;
Object.defineProperty(globalThis,'crypto',{configurable:true,value:{randomUUID:()=>`00000000-0000-4000-8000-${String(++uuid).padStart(12,'0')}`,getRandomValues:a=>{for(let i=0;i<a.length;i++)a[i]=Math.floor(random()*4294967296);return a}}});
const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:['2026-11-16T00:00:00.000Z']))}static now(){return 1794787200000}};
const catalogRaw=await fs.readFile(catalogPath,'utf8'),sceneRaw=await fs.readFile(scenePath,'utf8'),values=new Map([['junqi-catalog-v1',catalogRaw]]);globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
const {initializeCatalog}=await load('js/catalog-store.js'),catalog=initializeCatalog([]),{createBattleStore}=await load('js/battle-state.js'),battle=await createBattleStore(catalog.units);await battle.importScene(sceneRaw);
const {prepareSimulationAmmoSource}=await load('tactical-map/equipment-runtime.js');const source=prepareSimulationAmmoSource(battle.getScene(),catalog.units);
if(scenario==='contact'||scenario==='squadron'){
 source.instances=['ally','enemy'].flatMap(side=>source.instances.filter(u=>u.side===side).slice(0,scenario==='squadron'?6:2));source.groups=[];
 for(let i=0;i<source.instances.length;i++){const u=source.instances[i];u.groupId=null;u.isOverallFlagship=false;u.isFormationFlagship=false;u.x=u.side==='ally'?-30:30;u.y=(i%(scenario==='squadron'?6:2))*12;u.underwater=false;u.depth=12}
 source.terrain.heights.fill(-20);source.terrain.rivers.fill(0);source.terrain.shallows?.fill(0);
}
const {createSimulation,openSimulation}=await load('tactical-map/simulation-store.js'),{readSave}=await load('js/save-database.js');
const id=await createSimulation(source,()=>({valid:true})),store=await openSimulation(id);await store.setEnemyAutonomy(true);
const stages=[];
function expand(value){if(value.specialHistoryEncoding){const table=value.specialHistoryEncoding.equipmentStates;for(const record of value.specialRuntime.records)for(const report of record.shipReports)for(const key of ['beforeEquipmentState','afterEquipmentState'])if(report[key]!==undefined)report[key]=structuredClone(table[report[key].$equipmentState]);delete value.specialHistoryEncoding}for(const key of value.initialSceneReferences??[])value.initialScene[key]=structuredClone(value[key]);delete value.initialSceneReferences;return value}
async function step(name,fn){let error=null;try{await fn()}catch(e){error={name:e.name,message:e.message}}const full=expand(JSON.parse(await readSave('junqi-simulation-v1:'+id))),observed=store.getScene(),stage={name,error,full,observed};stages.push(stage);console.log(`${scenario}: ${name} ${error?'stopped: '+error.message:'ok'} ${createHash('sha256').update(JSON.stringify(full)).digest('hex').slice(0,12)}`);return !error}
let okay=await step('begin',()=>store.beginMovement());if(okay)okay=await step('movement',()=>store.resolveMovement());for(let n=5;okay&&n>=0;n--)okay=await step('attack-'+n,()=>store.settleAttackPhase(store.getSceneSnapshot().revision));if(okay)okay=await step('special',()=>store.finishSpecialPhase(store.getSceneSnapshot().revision));if(okay)await step('end',()=>store.finishTurn(store.getSceneSnapshot().revision));
await fs.writeFile(outputPath,JSON.stringify(stages));
