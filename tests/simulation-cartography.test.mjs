import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {drawSimulationCartography} from '../tactical-map/simulation-cartography.js?v=day-catalog-pas-1';
import {createDemoTerrain, resizeTerrain} from '../tactical-map/terrain-data.js';
import {makeTerrainRenderGrid} from '../tactical-map/terrain-render-grid.js';
class Element {
 constructor(tag){this.tag=tag;this.attributes={};this.children=[]}
 setAttribute(k,v){this.attributes[k]=v}
 append(...nodes){for(const n of nodes)if(n.tag==='fragment')this.children.push(...n.children);else this.children.push(n)}
 replaceChildren(...nodes){this.children=[];this.append(...nodes)}
}
function setup(){globalThis.document={createElementNS:(_,tag)=>new Element(tag),createDocumentFragment:()=>new Element('fragment')};return new Element('g')}
for(const colored of [true,false])test(`cartographic display draws coast/contours without changing terrain, colored=${colored}`,()=>{
 const t=createDemoTerrain(),grid=makeTerrainRenderGrid(t);const before=JSON.stringify({t,grid});const layer=setup();
 drawSimulationCartography(layer,t,grid,{colored});
 assert(layer.children.some(n=>n.attributes.class==='chart-coast'));
 assert(layer.children.some(n=>String(n.attributes.class).includes('chart-contour')));
 assert(layer.children.length<500,'keep batched DOM size near the old renderer');
 assert.equal(JSON.stringify({t,grid}),before);
 for(const n of layer.children)assert(!/NaN|Infinity|undefined/.test(n.attributes.d));
});
test('isolated river markers at map edges remain visible',()=>{
 const t=createDemoTerrain();t.heights.fill(10);t.rivers[0]=1;
 const layer=setup();drawSimulationCartography(layer,t,makeTerrainRenderGrid(t));
 assert(layer.children.some(n=>n.attributes.class==='chart-river'));
});
test('empty/offscreen and maximum grid maps remain bounded',()=>{
 const t=createDemoTerrain(),layer=setup();drawSimulationCartography(layer,t,[]);assert.equal(layer.children.length,0);
 t.heights.fill(-20);const large=resizeTerrain(t,{width:7200,height:7200,cols:7201,rows:7201,contourInterval:6});
 drawSimulationCartography(layer,large,makeTerrainRenderGrid(large));assert(layer.children.length<200);
});
test('mode switch and stylesheet are wired to the simulation page',async()=>{
 const html=await readFile(new URL('../tactical-map/simulation.html',import.meta.url),'utf8');
 const js=await readFile(new URL('../tactical-map/simulation-main.js?v=day-catalog-pas-1',import.meta.url),'utf8');
 const css=await readFile(new URL('../tactical-map/simulation-cartography.css',import.meta.url),'utf8');
 assert(html.includes('href="./simulation-cartography.css"'));assert(html.includes('id="mapStyleLabel"'));
 assert(js.includes('drawSimulationCartography(layer, terrain, makeTerrainRenderGrid(terrain, window), {colored})'));
 assert(css.includes('.chart-coast'));assert(css.includes('@media (max-width: 760px)'));
});
