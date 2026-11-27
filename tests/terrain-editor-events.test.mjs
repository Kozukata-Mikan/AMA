import {beforeEach} from 'node:test';
import {resetDatabase} from './save-test-environment.mjs';
beforeEach(resetDatabase);
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountTerrainEditor } from '../tactical-map/terrain-editor.js?v=self-sealing-1';
import { createBattleStore } from '../js/battle-state.js?v=self-sealing-1';
import { sampleTerrain, resizeTerrain, applyBrush, readTerrainVertex } from '../tactical-map/terrain-data.js';
import { flatTerrain } from './fixtures.mjs';

// Execute the real editor event handlers with a small DOM/pointer adapter.
// This covers the UI -> applyBrush -> save path missing from the algorithm tests.
class Element {
 constructor(tag){this.tagName=tag;this.children=[];this.listeners=new Map();this.style={setProperty(){}};this.dataset={};this.className='';this.value='';this.captures=new Set();
  this.classList={contains:c=>this.className.split(' ').includes(c),add:c=>{if(!this.classList.contains(c))this.className+=' '+c},remove:c=>{this.className=this.className.split(' ').filter(x=>x!==c).join(' ')},toggle:(c,v)=>{if(v??!this.classList.contains(c))this.classList.add(c);else this.classList.remove(c)}};
 }
 append(...nodes){for(const n of nodes){this.children.push(n);n.parentElement=this;if(this.tagName==='select'&&!this.value&&n.value)this.value=n.value}}
 setAttribute(k,v){this[k]=v}
 addEventListener(k,f){if(!this.listeners.has(k))this.listeners.set(k,new Set());this.listeners.get(k).add(f)}
 removeEventListener(k,f){this.listeners.get(k)?.delete(f)}
 async dispatch(k,extra={}){const e={button:0,pointerId:1,preventDefault(){},stopImmediatePropagation(){},...extra};for(const f of this.listeners.get(k)??[])await f(e)}
 setPointerCapture(id){this.captures.add(id)}
 hasPointerCapture(id){return this.captures.has(id)}
 releasePointerCapture(id){this.captures.delete(id)}
 closest(){return null}
 remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this)}
 reportValidity(){return true}
 querySelectorAll(){return []}
}
function all(node){return [node,...node.children.flatMap(all)]}
async function setup(large=false){
 const data=new Map();
 globalThis.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
 globalThis.window={addEventListener(){},removeEventListener(){}};
 globalThis.document={createElement:tag=>new Element(tag)};
 globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value}};
 globalThis.getComputedStyle=()=>({position:'static'});
 globalThis.confirm=()=>true;
 const frames=new Map();let nextFrame=0;
 globalThis.requestAnimationFrame=f=>{frames.set(++nextFrame,f);return nextFrame};
 globalThis.cancelAnimationFrame=id=>frames.delete(id);
 const flush=()=>{for(const [id,f]of [...frames]){frames.delete(id);f()}};
 const store=await createBattleStore([]);
 let initial=flatTerrain();if(large)initial=resizeTerrain(initial,{width:7200,height:7200,cols:7201,rows:7201,contourInterval:6});
 await store.setTerrain(initial);
 let current=store.getSceneSnapshot().terrain;
 const sync=store.subscribe(()=>{current=store.getSceneSnapshot().terrain});
 const container=new Element('section'),svg=new Element('svg'),panel=new Element('section');panel.append(svg);
 const controller=mountTerrainEditor({container,svg,store,pickPoint:e=>({x:e.x??0,y:e.y??0}),previewTerrain:t=>{current=t},getTerrain:()=>current});
 const editing=all(container).find(n=>n.type==='checkbox');editing.checked=true;await editing.dispatch('change');
 const button=text=>all(container).find(n=>n.tagName==='button'&&n.textContent===text);
 return {svg,flush,store,container,button,getTerrain:()=>current,async dispose(){await controller.destroy();sync();await store.destroy()}};
}
for(const large of [false,true])test(`pointer drawing saves and undo/redo restore terrain (${large?'7200-cell':'legacy'} map)`,async ()=>{
 const ui=await setup(large);
 try{
  const before=sampleTerrain(ui.getTerrain(),0,0).height;
  await ui.svg.dispatch('pointerdown',{x:0,y:0});await ui.svg.dispatch('pointermove',{x:5,y:0});ui.flush();
  assert(sampleTerrain(ui.getTerrain(),0,0).height>before,'pointer handlers must apply the brush');
  await ui.svg.dispatch('pointerup');
  const saved=sampleTerrain(ui.store.getSceneSnapshot().terrain,0,0).height;
  assert(saved>before,'pointerup must commit the edit');assert.equal(ui.svg.captures.size,0);
  await ui.button('地形を元に戻す').dispatch('click');assert.equal(sampleTerrain(ui.getTerrain(),0,0).height,before);
  await ui.button('地形をやり直す').dispatch('click');assert.equal(sampleTerrain(ui.getTerrain(),0,0).height,saved);
  assert(!all(ui.container).some(n=>String(n.textContent).includes('MAX_TERRAIN_SAMPLES is not a function')));
 }finally{await ui.dispose()}
});
test('pointer cancel restores the previous map without saving',async ()=>{
 const ui=await setup();
 try{const before=JSON.stringify(ui.store.getSceneSnapshot().terrain);await ui.svg.dispatch('pointerdown');ui.flush();assert.notEqual(JSON.stringify(ui.getTerrain()),before);await ui.svg.dispatch('pointercancel');assert.equal(JSON.stringify(ui.getTerrain()),before);assert.equal(JSON.stringify(ui.store.getSceneSnapshot().terrain),before)}finally{await ui.dispose()}
});

for(const mode of ['raise','lower','smooth','level','land','sea','river','eraseRiver','shallow','eraseShallow'])test(`editor pointer entry executes ${mode} brush`,async ()=>{
 const ui=await setup();
 try{
  all(ui.container).find(n=>n.tagName==='select').value=mode;
  const expected=JSON.parse(JSON.stringify(ui.getTerrain()));
  applyBrush(expected,{x:0,y:0},{mode,radius:30,strength:5,target:20});
  await ui.svg.dispatch('pointerdown');ui.flush();await ui.svg.dispatch('pointerup');
  const actual=ui.store.getSceneSnapshot().terrain;
  for(let r=0;r<expected.rows;r++)for(let c=0;c<expected.cols;c++)assert.deepEqual(readTerrainVertex(actual,c,r),readTerrainVertex(expected,c,r));
  assert(all(ui.container).some(n=>String(n.textContent).includes('地形を保存')),'editor must reach the saved state');
 }finally{await ui.dispose()}
});

test('generated preview is separate, apply persists origin and undo/redo restore maps',async()=>{
 const ui=await setup();
 try{
  const before=ui.store.getSceneSnapshot().terrain;
  await ui.button('地形プレビューを生成').dispatch('click');
  assert.equal(ui.store.getSceneSnapshot().terrain,before,'preview never writes');
  const apply=ui.button('この地形を地図に適用');assert.equal(apply.disabled,false);
  await apply.dispatch('click');
  const generated=ui.store.getSceneSnapshot().terrain;assert.equal(generated.generation.mode,'description');assert.equal(generated.width,120);assert.equal(generated.cols,121);assert(sampleTerrain(generated,0,0).height>0);
  const exported=ui.store.exportScene();await ui.button('地形を元に戻す').dispatch('click');assert.equal(sampleTerrain(ui.store.getSceneSnapshot().terrain,0,0).height,-20);
  await ui.button('地形をやり直す').dispatch('click');assert.equal(ui.store.getSceneSnapshot().terrain.generation.mode,'description');
  await ui.store.importScene(exported);const reopened=await createBattleStore([]);try{assert.deepEqual(reopened.getSceneSnapshot().terrain.generation,generated.generation);assert.equal(sampleTerrain(reopened.getSceneSnapshot().terrain,0,0).height,sampleTerrain(generated,0,0).height)}finally{await reopened.destroy()}
 }finally{await ui.dispose()}
});
test('external terrain update invalidates an unapplied generated preview',async()=>{
 const ui=await setup();
 try{await ui.button('地形プレビューを生成').dispatch('click');assert.equal(ui.button('この地形を地図に適用').disabled,false);await ui.store.setTerrain(flatTerrain());assert.equal(ui.button('この地形を地図に適用').disabled,true)}finally{await ui.dispose()}
});
