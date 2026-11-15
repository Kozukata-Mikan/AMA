// node tests/compare-performance.mjs /absolute/path/to/baseline-checkout
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { source, ship, flatTerrain } from './fixtures.mjs';
const baseline=process.argv[2];if(!baseline)throw new Error('Pass a baseline checkout path.');
const load=(root,path)=>import(pathToFileURL(resolve(root,path)));
const now=process.cwd();
const [oldTerrain,newTerrain,oldFeatures,newFeatures,oldAttack,newAttack,oldMove,newMove,oldStore,newStore] = await Promise.all([
 load(baseline,'tactical-map/terrain-data.js'),load(now,'tactical-map/terrain-data.js'),
 load(baseline,'tactical-map/simulation-features.js'),load(now,'tactical-map/simulation-features.js'),
 load(baseline,'tactical-map/attack-terrain-runtime.js'),load(now,'tactical-map/attack-terrain-runtime.js'),
 load(baseline,'tactical-map/simulation-movement-route.js'),load(now,'tactical-map/simulation-movement-route.js'),
 load(baseline,'tactical-map/simulation-store.js'),load(now,'tactical-map/simulation-store.js')]);
const clone=v=>JSON.parse(JSON.stringify(v));
let seed=2048;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
let comparisons=0, routes=0;
for(const mode of ['raise','lower','smooth','level','land','sea','river','eraseRiver','shallow','eraseShallow']){
 let a=oldTerrain.createDemoTerrain(),b=clone(a);
 for(let n=0;n<10;n++){const p={x:random()*500-250,y:random()*500-250};const brush={mode,radius:5+random()*100,strength:0.1+random()*40,target:random()*200-100};oldTerrain.applyBrush(a,p,brush);newTerrain.applyBrush(b,p,brush);assert.deepEqual(b,a);comparisons++}
}
const terrain=oldTerrain.createDemoTerrain();
for(let n=0;n<300;n++){
 const from={x:random()*590-295,y:random()*590-295,z:random()*100};
 const to={x:random()*590-295,y:random()*590-295,z:random()*100};
 assert.equal(newFeatures.isTerrainBlocked(terrain,from,to),oldFeatures.isTerrainBlocked(terrain,from,to));
 assert.deepEqual(newAttack.traceAttackTerrainLine(terrain,from,to),oldAttack.traceAttackTerrainLine(terrain,from,to));
 if(oldTerrain.sampleTerrain(terrain,from.x,from.y).kind!=='land'){assert.deepEqual(newMove.clipLandRoute(terrain,{},[from,to]),oldMove.clipLandRoute(terrain,{},[from,to]));comparisons++;routes++}
 comparisons+=2;
}
console.log(`Differential checks passed: ${comparisons} (100 brush states, 300 LOS, 300 attack lines, ${routes} sea routes).`);
const values=new Map();globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),key:n=>[...values.keys()][n]??null,get length(){return values.size}};
const timings=[];
for(const [name,module]of [['baseline',oldStore],['optimized',newStore]]){
 values.clear();const scene=source();scene.instances=Array.from({length:40},(_,i)=>ship('ship'+i,i%2?'ally':'enemy',i*5-100));
 const id=module.createSimulation(scene,()=>({valid:true}));const store=module.openSimulation(id);
 const read=()=>store.getSceneSnapshot?store.getSceneSnapshot():store.getScene();
 read(); // cache/warm-up is outside the timed reads, matching subscribers after a revision.
 let start=performance.now();for(let i=0;i<25;i++)read();const reads=performance.now()-start;
 start=performance.now();for(let i=0;i<5;i++)store.setObservationSide(i%2?'ally':'enemy');const commits=performance.now()-start;
 timings.push({name,reads25ms:+reads.toFixed(3),commits5ms:+commits.toFixed(3)});
}
console.table(timings);
const start=performance.now();const big=newTerrain.resizeTerrain(flatTerrain(),{width:7200,height:7200,cols:7201,rows:7201,contourInterval:6});newTerrain.applyBrush(big,{x:2000,y:2000},{mode:'level',radius:5,strength:10,target:123});
console.log(JSON.stringify({largeMapCells:'7200 x 7200',createAndBrushMs:+(performance.now()-start).toFixed(3),storedVertices:Object.keys(big.vertices).length,jsonBytes:Buffer.byteLength(JSON.stringify(big)),heightAtEditedCell:newTerrain.sampleTerrain(big,2000,2000).height}));
