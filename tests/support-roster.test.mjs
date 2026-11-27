import test from 'node:test';
import assert from 'node:assert/strict';
import {indexSupportRoster,filterSupportRoster} from '../tactical-map/support-roster.js';
import {NO_FLEET} from '../tactical-map/fleet-unit-selector.js?v=fleet-cohesion-6';

test('nested fleet and ship search includes descendants, combines damage filters and keeps other sides private',()=>{
 const unit=(id,name,groupId,hp=10)=>({instanceId:id,name,groupId,currentHp:hp,snapshot:{maxHp:10},observationOwn:true});
 const group=(id,name,parentId=null)=>({id,name,parentId});
 const index=indexSupportRoster({groups:[group('p','第１艦隊'),group('c','護衛隊','p'),group('other','第２艦隊'),group('d','護衛隊','other'),{...group('e','外方'),observationForeign:true}],
  instances:[unit('a','旗艦','p'),unit('b','青葉','c',5),unit('c','夕凪','d'),unit('l','港',null),{...unit('e','秘匿艦','e'),observationOwn:false}]});
 const ids=(scope,query,attention=false)=>filterSupportRoster(index,scope,query,attention).map(u=>u.instanceId);
 assert.deepEqual(ids('','第1艦隊'),['a','b']);assert.deepEqual(ids('','護衛隊'),['b','c']);
 assert.deepEqual(ids('p','護衛隊',true),['b']);assert.deepEqual(ids('d','青葉'),[]);
 assert.deepEqual(ids(NO_FLEET,''),['l']);assert.deepEqual(ids('','外方'),[]);
 assert.deepEqual(index.options.find(g=>g.id==='p'),{id:'p',label:'第１艦隊',total:2,attention:1});
});
