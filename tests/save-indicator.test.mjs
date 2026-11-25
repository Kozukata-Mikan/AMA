import test from 'node:test';
import assert from 'node:assert/strict';
import {mountSaveIndicator} from '../tactical-map/save-indicator.js?v=field-support-1';
test('save indicator reflects pending writes and warns only while saving',()=>{
 const children=[],events=new Map(),subscribers=new Set();let saving=false;
 globalThis.document={body:{append:n=>children.push(n)},createElement:()=>({style:{},setAttribute(){},remove(){children.splice(children.indexOf(this),1)}})};
 globalThis.window={addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)};
 const store={isSaving:()=>saving,subscribeSaving(fn){subscribers.add(fn);fn(saving);return()=>subscribers.delete(fn)}};
 const dispose=mountSaveIndicator(store),indicator=children[0];assert.equal(indicator.hidden,true);
 saving=true;for(const fn of subscribers)fn(saving);assert.equal(indicator.hidden,false);
 let prevented=false;events.get('beforeunload')({preventDefault(){prevented=true}});assert.equal(prevented,true);
 saving=false;for(const fn of subscribers)fn(saving);assert.equal(indicator.hidden,true);
 prevented=false;events.get('beforeunload')({preventDefault(){prevented=true}});assert.equal(prevented,false);
 dispose();assert.equal(children.length,0);assert.equal(subscribers.size,0);assert.equal(events.size,0);
});
