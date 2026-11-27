import test from 'node:test';
import assert from 'node:assert/strict';
import {supportCompartments,effectLabel,unitNeedsAttention,conditionLabel} from '../tactical-map/support-condition.js';

test('shipwide damage and compartment equipment remain distinct, including damage to an empty bridge',()=>{
 const unit={branch:'navy',currentHp:8,snapshot:{maxHp:10},shipState:{status:'light',effects:{flooding:{level:'medium'}}},equipmentState:{
  itemDamage:{items:{bridge:{destroyed:true,damaged:true,damagedTurn:2}}},
  groups:[{equipmentId:'pump',position:'中部１',damaged:true}]
 }};
 const parts=supportCompartments(unit);
 assert.equal(parts.length,7);
 assert.equal(parts.find(p=>p.label==='中部①').equipment[0].equipmentId,'pump');
 assert.equal(parts.find(p=>p.label==='艦橋').status,'完全破損');
 assert.ok(parts.every(p=>p.hp===undefined&&p.effects===undefined));
 assert.equal(effectLabel('flooding',unit.shipState.effects.flooding),'中度');
 assert.ok(unitNeedsAttention(unit));
});

test('each building slot retains its own HP and fire; multiple center mounts share a single slot',()=>{
 const unit={branch:'building',currentHp:6,snapshot:{maxHp:10,mounts:[{position:'中心'},{position:'露天'},{position:'中心'}]},
  buildingState:{status:'intact',slots:[{position:'中心',mountIndex:0,hp:5,maxHp:5,effects:{}},{position:'露天',mountIndex:1,hp:1,maxHp:5,effects:{fire:{level:'large'}}}]},
  equipmentState:{groups:[0,1,2].map(mountIndex=>({mountIndex}))}};
 const [center,open]=supportCompartments(unit);
 assert.equal(center.equipment.length,2);assert.equal(open.equipment.length,1);
 assert.equal(open.maxHp-open.hp,4);assert.equal(effectLabel('fire',open.effects.fire),'大火');
 assert.equal(conditionLabel(unit),'損傷');
});
