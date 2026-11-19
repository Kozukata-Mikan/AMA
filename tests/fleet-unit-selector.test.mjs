import test from 'node:test';
import assert from 'node:assert/strict';
import {fleetSelectionModel} from '../tactical-map/fleet-unit-selector.js';

test('fleet filter separates loose ships, nested fleets and eligible members without exposing hidden units',()=>{
  const scene={groups:[{id:'own',name:'Own'},{id:'child',name:'Child',parentId:'own'},{id:'enemy',name:'Secret'}],instances:[
    {instanceId:'a',groupId:'own'},{instanceId:'b',groupId:'child'},
    {instanceId:'c',groupId:null},{instanceId:'orphan',groupId:'missing'},
    {instanceId:'hidden',groupId:'enemy'},
  ]};
  const model=fleetSelectionModel(scene,scene.instances.slice(0,4));
  assert.deepEqual(model.loose.map(u=>u.instanceId),['c','orphan']);
  assert.deepEqual(model.groups.map(item=>item.group.id),['own','child']);
  assert.deepEqual(model.groups[0].units.map(u=>u.instanceId),['a','b']);
  assert.equal(model.groups[0].whole,true);
  const ineligible=fleetSelectionModel(scene,[scene.instances[0]]);
  assert.equal(ineligible.groups[0].whole,false);
  assert.deepEqual(ineligible.groups[0].units.map(u=>u.instanceId),['a']);
  assert.ok(!JSON.stringify(model).includes('hidden'));
  assert.ok(!JSON.stringify(model).includes('Secret'));
});
