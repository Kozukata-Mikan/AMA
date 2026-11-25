import test from 'node:test';
import assert from 'node:assert/strict';
import {mountSimulationWorkflow} from '../tactical-map/simulation-workflow-ui.js?v=field-support-1';

class Node {
 constructor(tag,text=''){this.tagName=tag.toUpperCase();this.textContent=text;this.children=[];this.dataset={};this.attributes={};this.className='';this.classList={contains:c=>this.className.split(' ').includes(c),toggle:(c,on)=>{const names=new Set(this.className.split(' ').filter(Boolean));if(on)names.add(c);else names.delete(c);this.className=[...names].join(' ');}};}
 get childNodes(){return this.children;}
 append(...nodes){for(const node of nodes){if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(n=>n!==node);node.parentElement=this;this.children.push(node);}}
 prepend(node){this.insertBefore(node,this.children[0]??null);}
 insertBefore(node,before){if(before&&!this.children.includes(before))throw Error('Reference node missing');if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(n=>n!==node);node.parentElement=this;const index=before?this.children.indexOf(before):this.children.length;this.children.splice(index,0,node);}
 replaceChildren(...nodes){for(const child of this.children)child.parentElement=null;this.children=[];this.append(...nodes);}
 setAttribute(k,v){this.attributes[k]=v;}
 removeAttribute(k){delete this.attributes[k];}
 querySelector(selector){if(selector===':scope > summary')return this.children.find(n=>n.tagName==='SUMMARY')??null;const match=n=>selector.startsWith('#')?n.id===selector.slice(1):selector.startsWith('.')?n.classList.contains(selector.slice(1)):n.tagName===selector.toUpperCase();for(const child of this.children){if(match(child))return child;const found=child.querySelector(selector);if(found)return found;}return null;}
}
function fixture({stable=true,legacy=false}={}){
 const aside=new Node('aside');const panel=(title,key)=>{const n=new Node('details');n.append(new Node('summary',title));if(key)n.dataset.workflowPanel=key;aside.append(n);return n;};
 panel('時間・天候・回合');panel('参戦ユニット');panel('集群・編隊');panel('行動・記録');
 const movement=panel(stable?'変更後の移動パネル':legacy?'艦船移動・編隊行動':'ユニット移動・編隊行動',stable?'movement':null);
 const support=panel(stable?'変更後の支援パネル':legacy?'艦船救助':'外部支援・救助・補給',stable?'support':null);
 panel('編隊陣形');panel('編隊一括攻撃');const attack=panel('攻撃装備・一括確認');
 for(const id of ['attackExecuteBatch','attackFinishPhase','phaseCommandFeedback']){const node=new Node('button');node.id=id;attack.append(node);}
 const scene={turn:{number:1,phaseId:'start'}};let listener;const store={getSceneSnapshot:()=>scene,subscribe:fn=>(listener=fn,()=>listener=null)};
 return{aside,movement,support,scene,store,notify:()=>listener?.()};
}
for(const options of [{stable:true},{stable:false},{stable:false,legacy:true}])test(`workflow initializes with ${options.stable?'stable panel identities':options.legacy?'legacy panel titles':'aircraft/support panel titles'}`,()=>{
 const f=fixture(options),previous=globalThis.document;globalThis.document={createElement:tag=>new Node(tag),querySelector:selector=>selector==='aside'?f.aside:null};
 try{const finish=f.aside.querySelector('#attackFinishPhase'),execute=f.aside.querySelector('#attackExecuteBatch');const dispose=mountSimulationWorkflow(f.store);assert.ok(f.aside.querySelector('.workflow-overview'));assert.equal(f.movement.parentElement.parentElement.dataset.toolCategory,'movement');assert.equal(f.support.parentElement.parentElement.dataset.toolCategory,options.legacy?'movement':'progress');assert.equal(f.aside.querySelector('#attackExecuteBatch'),execute);f.scene.turn.phaseId='end';f.notify();assert.equal(finish.parentElement.id,'workflowEndActions');f.scene.turn.phaseId='special';f.notify();assert.equal(finish.parentElement.id,'workflowSpecialActions');dispose();}finally{globalThis.document=previous;}
});
