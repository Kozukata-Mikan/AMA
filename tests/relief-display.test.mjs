import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {getVerticalExaggeration,setVerticalExaggeration,projectDisplayPoint,unprojectDisplayPoint} from '../tactical-map/relief-display.js';
import {mountReliefControls,RELIEF_PREFERENCE_KEY} from '../tactical-map/relief-controls.js';
import {projectMap} from '../tactical-map/map-display.js?v=day-catalog-pas-1';import {pickProjectedTerrainPoint} from '../tactical-map/terrain-picking.js?v=day-catalog-pas-1';
import {terrainRenderWindow,makeTerrainRenderGrid} from '../tactical-map/terrain-render-grid.js';
import {flatTerrain} from './fixtures.mjs';import {sampleTerrain,createDemoTerrain} from '../tactical-map/terrain-data.js';
import {isTerrainBlocked} from '../tactical-map/simulation-features.js?v=settlement-audit-1';import {traceAttackTerrainLine} from '../tactical-map/attack-terrain-runtime.js';
import {drawSimulationCartography} from '../tactical-map/simulation-cartography.js?v=day-catalog-pas-1';
for(const factor of [1,2,3,5,10,20])test(`projection, fixed altitude inverse and terrain picking agree at ${factor}x`,()=>{
 try{setVerticalExaggeration(factor);const terrain=flatTerrain();for(let r=0;r<terrain.rows;r++)for(let c=0;c<terrain.cols;c++)terrain.heights[r*terrain.cols+c]=20+(-terrain.width/2+c*terrain.width/(terrain.cols-1))*.01;
  for(const p of [{x:100,y:-50},{x:-180,y:120}]){
   const h=sampleTerrain(terrain,p.x,p.y).height,screen=projectMap(p.x,p.y,h),pick=pickProjectedTerrainPoint(terrain,screen);assert(pick);assert(Math.abs(pick.x-p.x)<1e-5);assert(Math.abs(pick.y-p.y)<1e-5);
   const win=terrainRenderWindow(terrain,{x:0,y:0,scale:1},{x:screen.x-5,y:screen.y-5,width:10,height:10});const c=(p.x+terrain.width/2)/terrain.width*(terrain.cols-1),r=(p.y+terrain.height/2)/terrain.height*(terrain.rows-1);assert(win.cols[0]<=c&&win.cols.at(-1)>=c);assert(win.rows[0]<=r&&win.rows.at(-1)>=r);
  }
  for(const z of [-20,0,80,500]){const p=projectDisplayPoint(30,-70,z),inverse=unprojectDisplayPoint(p,z);assert(Math.abs(inverse.x-30)<1e-8);assert(Math.abs(inverse.y+70)<1e-8)}
 }finally{setVerticalExaggeration(1)}
});
test('changing display height never changes physical terrain or LOS/attack results',()=>{
 const terrain=createDemoTerrain(),before=JSON.stringify(terrain),from={x:-250,y:0,z:10},to={x:250,y:0,z:10};
 const physical=()=>({sample:sampleTerrain(terrain,0,0),los:isTerrainBlocked(terrain,from,to),attack:traceAttackTerrainLine(terrain,from,to)}),expected=physical();
 try{for(const factor of [1,5,20]){setVerticalExaggeration(factor);assert.deepEqual(physical(),expected);assert.equal(JSON.stringify(terrain),before);assert.equal(projectMap(5,8,0).y,340+13*.43)}}finally{setVerticalExaggeration(1)}
 for(const factor of [0,-1,4,Infinity,'bad'])assert.throws(()=>setVerticalExaggeration(factor));
});
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.attributes={};this.listeners=new Map()}
 setAttribute(k,v){this.attributes[k]=v}append(...nodes){for(const n of nodes){this.children.push(n);n.parent=this}}replaceChildren(...nodes){this.children=[];this.append(...nodes)}
 addEventListener(k,f){this.listeners.set(k,f)}removeEventListener(k){this.listeners.delete(k)}remove(){this.parent.children=this.parent.children.filter(n=>n!==this)}
}
test('cartographic geometry changes with factor but source heights remain exact',()=>{
 globalThis.document={createElementNS:(_,tag)=>new Element(tag),createDocumentFragment:()=>new Element('fragment')};const terrain=createDemoTerrain(),grid=makeTerrainRenderGrid(terrain),before=JSON.stringify(terrain),layer=new Element('g');
 try{setVerticalExaggeration(1);drawSimulationCartography(layer,terrain,grid);const a=JSON.stringify(layer.children[0].children.map(n=>n.attributes));setVerticalExaggeration(5);drawSimulationCartography(layer,terrain,grid);const b=JSON.stringify(layer.children[0].children.map(n=>n.attributes));assert.notEqual(a,b);assert.equal(JSON.stringify(terrain),before)}finally{setVerticalExaggeration(1)}
});
test('control defaults to 5x, writes only a display preference, and blocks mid-edit changes',()=>{
 const scene='original unmodified scene',data=new Map([['junqi-battle-scene-v2',scene]]);globalThis.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};globalThis.document={createElement:tag=>new Element(tag)};
 const host=new Element('div');let allowed=false,renders=0;const dispose=mountReliefControls(host,{canChange:()=>allowed,onChange:()=>renders++}),select=host.children[0].children[1];
 try{assert.equal(getVerticalExaggeration(),5);select.value='20';select.listeners.get('change')();assert.equal(getVerticalExaggeration(),5);assert.equal(renders,0);assert.equal(data.size,1);
 allowed=true;select.value='10';select.listeners.get('change')();assert.equal(renders,1);assert.equal(getVerticalExaggeration(),10);assert.equal(data.get(RELIEF_PREFERENCE_KEY),'10');assert.equal(data.get('junqi-battle-scene-v2'),scene);assert.equal(data.size,2);
 dispose();assert.equal(host.children.length,0);const again=mountReliefControls(host);assert.equal(getVerticalExaggeration(),10);again();
 }finally{setVerticalExaggeration(1)}
});
test('both pages load the display-only control and stronger contour stylesheet',async()=>{
 for(const page of ['index.html','simulation.html'])assert((await fs.readFile(new URL('../tactical-map/'+page,import.meta.url),'utf8')).includes('relief-display.css'));
 const css=await fs.readFile(new URL('../tactical-map/relief-display.css',import.meta.url),'utf8');assert(css.includes('.chart-contour-major'));assert(css.includes('.contour.contour-major'));
});
