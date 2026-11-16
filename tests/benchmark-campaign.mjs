// Isolated Node + worker_threads + in-memory IndexedDB timings; excludes DOM and disk I/O.
import fs from 'node:fs/promises';import {pathToFileURL} from 'node:url';import {Worker as NW} from 'node:worker_threads';import {resolve} from 'node:path';import {tmpdir,cpus} from 'node:os';import {createHash} from 'node:crypto';
const [rootArg='.',label='campaign',roundText='3',autoText='false',scenePath,catalogPath]=process.argv.slice(2),root=resolve(rootArg),rounds=Number(roundText),autonomy=autoText==='true';
if(!scenePath||!catalogPath||!Number.isInteger(rounds)||rounds<1||rounds>1000||!/^[a-zA-Z0-9_-]+$/.test(label))throw new Error('Usage: node tests/benchmark-campaign.mjs ROOT LABEL ROUNDS AUTONOMY SCENE_JSON CATALOG_JSON');
const load=p=>import(pathToFileURL(root+'/'+p));
const {IDBFactory}=await import('fake-indexeddb');globalThis.indexedDB=new IDBFactory();globalThis.BroadcastChannel=undefined;
const catalogRaw=await fs.readFile(catalogPath,'utf8'),sceneRaw=await fs.readFile(scenePath,'utf8');
const values=new Map([['junqi-catalog-v1',catalogRaw]]);globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
const adapter=`import {parentPort} from 'node:worker_threads';let start=0;globalThis.self={postMessage:data=>parentPort.postMessage({...data,computeMs:performance.now()-start})};await import(${JSON.stringify(pathToFileURL(root+'/tactical-map/background-worker.js').href)});parentPort.on('message',data=>{start=performance.now();self.onmessage({data})});`;
await fs.writeFile(resolve(tmpdir(),'ama-opt-worker-'+label+'.mjs'),adapter);const jobs=[];
globalThis.Worker=class{constructor(){this.w=new NW(pathToFileURL(resolve(tmpdir(),'ama-opt-worker-'+label+'.mjs')));this.p=new Map();this.w.on('message',data=>{const p=this.p.get(data.id);jobs.push({operation:p.task,computeMs:data.computeMs,wallMs:performance.now()-p.time});this.p.delete(data.id);this.onmessage?.({data})});this.w.on('error',e=>this.onerror?.(e))}postMessage(data){this.p.set(data.id,{time:performance.now(),task:data.payload.operation??data.task});this.w.postMessage(data)}terminate(){this.w.terminate()}};
const {initializeCatalog}=await load('js/catalog-store.js'),catalog=initializeCatalog([]);const {createBattleStore}=await load('js/battle-state.js'),battle=await createBattleStore(catalog.units);await battle.importScene(sceneRaw);
const {prepareSimulationAmmoSource}=await load('tactical-map/equipment-runtime.js');const source=prepareSimulationAmmoSource(battle.getScene(),catalog.units),{sampleTerrain}=await load('tactical-map/terrain-data.js');
const {createSimulation,openSimulation}=await load('tactical-map/simulation-store.js'),{readSave}=await load('js/save-database.js');
const id=await createSimulation(source,u=>{const s=sampleTerrain(source.terrain,u.x,u.y),restricted=s.kind==='river'||s.kind==='shallow';return {valid:s.inside&&s.kind!=='land'&&(!restricted||(!u.underwater&&u.sizeLevel<=2))&&(!u.underwater||u.depth>0),reason:'terrain'}}),store=await openSimulation(id);
if(autonomy)await store.setEnemyAutonomy(true);store.getSceneSnapshot();const rows=[];
let last=performance.now(),lag=0;const timer=setInterval(()=>{const now=performance.now();lag=Math.max(lag,now-last-5);last=now},5);
try{for(let round=1;round<=rounds;round++){
 const row={round},start=performance.now();let snapshotMs=0;
 async function step(key,fn){const t=performance.now();await fn();row[key]=(row[key]??0)+performance.now()-t;const a=performance.now();store.getSceneSnapshot();snapshotMs+=performance.now()-a}
 await step('beginMs',()=>store.beginMovement());await step('movementMs',()=>store.resolveMovement());for(let i=0;i<6;i++)await step('attacksMs',()=>store.settleAttackPhase(store.getSceneSnapshot().revision));await step('specialMs',()=>store.finishSpecialPhase(store.getSceneSnapshot().revision));await step('endMs',()=>store.finishTurn(store.getSceneSnapshot().revision));
 row.totalMs=performance.now()-start;row.snapshotMs=snapshotMs;row.lagMs=lag;lag=0;const saved=await readSave('junqi-simulation-v1:'+id);row.saveBytes=Buffer.byteLength(saved);rows.push(row);console.log(JSON.stringify(row));
 await fs.writeFile(resolve(tmpdir(),'ama-opt-'+label+'.json'),JSON.stringify({label,autonomy,node:process.version,cpu:cpus()[0]?.model,sceneSha256:createHash('sha256').update(sceneRaw).digest('hex'),catalogSha256:createHash('sha256').update(catalogRaw).digest('hex'),rows,jobs},null,2));
 }console.log(JSON.stringify({label,rounds,autonomy,results:resolve(tmpdir(),'ama-opt-'+label+'.json')}));
}finally{clearInterval(timer);(await load('tactical-map/background-client.js')).shutdownBackground()}
