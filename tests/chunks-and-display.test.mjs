import test from 'node:test';
import assert from 'node:assert/strict';
import {flatTerrain} from './fixtures.mjs';
import {applyBrush,readTerrainVertex,resizeTerrain,freezeTerrainSnapshot,validateTerrain,writeTerrainOverride} from '../tactical-map/terrain-data.js';
import {beginTerrainEdit,applyTerrainFrame} from '../tactical-map/terrain-edit-history.js';
import {sceneLighting,applySceneLighting,drawDistanceGrid,distanceGridSettings} from '../tactical-map/simulation-scene-display.js';
import {projectMap} from '../tactical-map/map-display.js';
const brush={radius:20,strength:10,target:30};
for(const mode of ['raise','lower','smooth','level','land','sea','river','eraseRiver','shallow','eraseShallow'])test(`chunk editing and undo preserve exact vertices: ${mode}`,()=>{
 const original=flatTerrain();original.heights[100]=15;original.rivers.fill(1);original.shallows.fill(1);
 const frozen=freezeTerrainSnapshot(original),edit=beginTerrainEdit(frozen),expected=structuredClone(original);
 for(const point of [{x:0,y:0},{x:5,y:5}]){applyBrush(expected,point,{...brush,mode});applyBrush(edit.working,point,{...brush,mode})}
 const result=freezeTerrainSnapshot(edit.working),frame=edit.frame();
 for(let row=0;row<original.rows;row++)for(let col=0;col<original.cols;col++)assert.deepEqual(readTerrainVertex(result,col,row),readTerrainVertex(expected,col,row));
 assert.equal(result.base,frozen);assert.equal(applyTerrainFrame(result,frame,false),frozen);
 const redo=applyTerrainFrame(frozen,frame,true);assert.deepEqual(validateTerrain(redo),validateTerrain(result));
 assert(frame.changes.length<original.cols*original.rows/2);
});
test('only touched chunks are copied, frozen bases and other chunks survive normalization',()=>{
 const base=freezeTerrainSnapshot(resizeTerrain(flatTerrain(),{width:7200,height:7200,cols:7201,rows:7201,contourInterval:10}));
 const first=beginTerrainEdit(base);writeTerrainOverride(first.working,0,[10,0,0]);writeTerrainOverride(first.working,100,[20,1,0]);
 const snapshot=freezeTerrainSnapshot(first.working),edit=beginTerrainEdit(snapshot);
 writeTerrainOverride(edit.working,0,[30,0,1]);writeTerrainOverride(edit.working,0,[40,0,1]);
 const next=freezeTerrainSnapshot(edit.working),frame=edit.frame();
 assert.equal(next.base,snapshot.base);assert.equal(next.chunks['3,0'],snapshot.chunks['3,0']);assert.notEqual(next.chunks['0,0'],snapshot.chunks['0,0']);
 assert.equal(frame.changes.length,1);assert.deepEqual(frame.changes[0].before,[10,0,0]);
 assert.deepEqual(readTerrainVertex(snapshot,0,0),[10,0,0]);
 assert.deepEqual(validateTerrain(applyTerrainFrame(next,frame,false)),validateTerrain(snapshot));
 assert.equal(freezeTerrainSnapshot(next),next);
 const removal=beginTerrainEdit(next);writeTerrainOverride(removal.working,0,null);assert(!removal.working.chunks['0,0']);
 assert.deepEqual(readTerrainVertex(removal.working,0,0),readTerrainVertex(base,0,0));
 for(const chunks of [{'999,0':{0:[0,0,0]}},{'0,0':{1024:[0,0,0]}},{'0,0':{0:[601,0,0]}},{'0,0':{0:[0,2,0]}}])assert.throws(()=>validateTerrain({...next,chunks}));
});
class Element{constructor(tag){this.tag=tag;this.children=[];this.attributes={};this.dataset={};this.style={setProperty:(k,v)=>this.attributes[k]=v}}setAttribute(k,v){this.attributes[k]=v}append(n){this.children.push(n)}replaceChildren(){this.children=[]}}
function dom(){globalThis.document={createElementNS:(_,tag)=>new Element(tag)};return new Element('g')}
test('lighting uses existing boundaries and projected east/west without changing terrain',()=>{
 for(const [time,period]of [['04:00','dawn'],['05:29','dawn'],['05:30','day'],['19:00','day'],['19:01','dusk'],['20:30','dusk'],['20:31','night'],['00:00','night']])assert.equal(sceneLighting(time).period,period);
 assert(sceneLighting('12:00').exposure>sceneLighting('00:00').exposure);
 const terrain=flatTerrain(),before=JSON.stringify(terrain),layer=dom(),panel=new Element('div');
 for(const [time,x]of [['04:00',terrain.width/2],['20:00',-terrain.width/2]]){applySceneLighting(panel,layer,terrain,time);const gradient=layer.children[0].children[0];assert.equal(gradient.attributes.cx,projectMap(x,0,0).x)}
 applySceneLighting(panel,layer,terrain,'12:00');assert.equal(layer.children.length,0);assert.equal(JSON.stringify(terrain),before);
});
test('distance grids remain bounded on maximum maps and report effective world spacing',()=>{
 const terrain=resizeTerrain(flatTerrain(),{width:7200,height:7200,cols:7201,rows:7201,contourInterval:10}),layer=dom();
 for(const scale of [0.001,0.1,1,10])for(const requested of ['auto','5','25','50']){
  const options={visible:true,view:{x:0,y:0,scale},box:{x:-600,y:-400,width:1200,height:800},requested,planes:'xyz'};
  const s=drawDistanceGrid(layer,terrain,options);assert.deepEqual(s,distanceGridSettings(terrain,options.view,options.box,requested));
  assert(layer.children.length<110);for(const n of layer.children)assert(!/NaN|Infinity/.test(n.attributes.d));
  assert((s.x1-s.x0+s.y1-s.y0)/s.step<=240);assert(s.zStep>0);
 }
 drawDistanceGrid(layer,terrain,{visible:false});assert.equal(layer.children.length,0);
});
