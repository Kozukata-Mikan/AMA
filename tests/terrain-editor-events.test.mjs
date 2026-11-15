import test from 'node:test';
import assert from 'node:assert/strict';
import { mountTerrainEditor } from '../tactical-map/terrain-editor.js';
import { createBattleStore } from '../js/battle-state.js';
import { sampleTerrain, resizeTerrain, applyBrush } from '../tactical-map/terrain-data.js';
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
 dispatch(k,extra={}){const e={button:0,pointerId:1,preventDefault(){},stopImmediatePropagation(){},...extra};for(const f of this.listeners.get(k)??[])f(e)}
 setPointerCapture(id){this.captures.add(id)}
 hasPointerCapture(id){return this.captures.has(id)}
 releasePointerCapture(id){this.captures.delete(id)}
 closest(){return null}
 remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this)}
 reportValidity(){return true}
 querySelectorAll(){return []}
}
function all(node){return [node,...node.children.flatMap(all)]}
function setup(large=false){
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
 const store=createBattleStore([]);
 let initial=flatTerrain();if(large)initial=resizeTerrain(initial,{width:7200,height:7200,cols:7201,rows:7201,contourInterval:6});
 store.setTerrain(initial);
 let current=store.getSceneSnapshot().terrain;
 const sync=store.subscribe(()=>{current=store.getSceneSnapshot().terrain});
 const container=new Element('section'),svg=new Element('svg'),panel=new Element('section');panel.append(svg);
 const controller=mountTerrainEditor({container,svg,store,pickPoint:e=>({x:e.x??0,y:e.y??0}),previewTerrain:t=>{current=t},getTerrain:()=>current});
 const editing=all(container).find(n=>n.type==='checkbox');editing.checked=true;editing.dispatch('change');
 const button=text=>all(container).find(n=>n.tagName==='button'&&n.textContent===text);
 return {svg,flush,store,container,button,getTerrain:()=>current,dispose(){controller.destroy();sync();store.destroy()}};
}
for(const large of [false,true])test(`pointer drawing saves and undo/redo restore terrain (${large?'7200-cell':'legacy'} map)`,()=>{
 const ui=setup(large);
 try{
  const before=sampleTerrain(ui.getTerrain(),0,0).height;
  ui.svg.dispatch('pointerdown',{x:0,y:0});ui.svg.dispatch('pointermove',{x:5,y:0});ui.flush();
  assert(sampleTerrain(ui.getTerrain(),0,0).height>before,'pointer handlers must apply the brush');
  ui.svg.dispatch('pointerup');
  const saved=sampleTerrain(ui.store.getSceneSnapshot().terrain,0,0).height;
  assert(saved>before,'pointerup must commit the edit');assert.equal(ui.svg.captures.size,0);
  ui.button('地形を元に戻す').dispatch('click');assert.equal(sampleTerrain(ui.getTerrain(),0,0).height,before);
  ui.button('地形をやり直す').dispatch('click');assert.equal(sampleTerrain(ui.getTerrain(),0,0).height,saved);
  assert(!all(ui.container).some(n=>String(n.textContent).includes('MAX_TERRAIN_SAMPLES is not a function')));
 }finally{ui.dispose()}
});
test('pointer cancel restores the previous map without saving',()=>{
 const ui=setup();
 try{const before=JSON.stringify(ui.store.getSceneSnapshot().terrain);ui.svg.dispatch('pointerdown');ui.flush();assert.notEqual(JSON.stringify(ui.getTerrain()),before);ui.svg.dispatch('pointercancel');assert.equal(JSON.stringify(ui.getTerrain()),before);assert.equal(JSON.stringify(ui.store.getSceneSnapshot().terrain),before)}finally{ui.dispose()}
});

for(const mode of ['raise','lower','smooth','level','land','sea','river','eraseRiver','shallow','eraseShallow'])test(`editor pointer entry executes ${mode} brush`,()=>{
 const ui=setup();
 try{
  all(ui.container).find(n=>n.tagName==='select').value=mode;
  const expected=JSON.parse(JSON.stringify(ui.getTerrain()));
  applyBrush(expected,{x:0,y:0},{mode,radius:30,strength:5,target:20});
  ui.svg.dispatch('pointerdown');ui.flush();ui.svg.dispatch('pointerup');
  assert.deepEqual(ui.store.getSceneSnapshot().terrain,expected);
  assert(all(ui.container).some(n=>String(n.textContent).includes('地形を保存し')),'editor must reach the saved state');
 }finally{ui.dispose()}
});
