import {EQUIPMENT_HIT_ITEMS} from './equipment-damage-runtime.js?v=visual-support-bridge-1';
import {positionItemId} from './equipment-item-runtime.js?v=visual-support-bridge-1';
import {SHIP_STATUS_LABELS} from './ship-runtime.js?v=visual-support-bridge-1';

const levels={small:'小火',medium:'中火',large:'大火',uncontrolled:'制御不能'};
const floods={light:'軽度',medium:'中度',heavy:'重度',uncontrolled:'制御不能'};
export const effectLabel=(type,effect)=>effect?(type==='fire'?levels:floods)[effect.level]:'なし';
export const equipmentStatus=g=>g.destroyed?'完全破損':g.damaged?'損傷':g.consumed?'消費済み':'正常';
export function conditionLabel(unit){
 const state=unit.shipState?.status??unit.buildingState?.status??unit.aircraftState?.status;
 if(unit.buildingState?.status==='intact')return unit.currentHp<unit.snapshot.maxHp?'損傷':'健全';
 return SHIP_STATUS_LABELS[state]??({rebuilding:'中心再建中',destroyed:'喪失',operational:'行動可能'})[state]??(unit.currentHp<unit.snapshot.maxHp?'損傷':'健全');
}
export function unitNeedsAttention(unit){
 return unit.currentHp<unit.snapshot.maxHp || unit.shipState?.effects?.fire || unit.shipState?.effects?.flooding ||
  unit.buildingState?.slots?.some(s=>s.effects?.fire||s.hp<s.maxHp) ||
  Object.values(unit.equipmentState?.itemDamage?.items??{}).some(s=>s.damaged||s.destroyed) ||
  unit.equipmentState?.groups?.some(g=>g.damaged||g.destroyed);
}
export function supportCompartments(unit){
 const groups=unit.equipmentState?.groups??[];
 if(unit.branch==='navy'){
  const items=unit.equipmentState?.itemDamage?.items??{};
  return EQUIPMENT_HIT_ITEMS.map(({id,label})=>{
   const equipment=groups.filter(g=>positionItemId(g.position)===id);
   const state=items[id]??{destroyed:equipment.some(g=>g.destroyed),damaged:equipment.some(g=>g.damaged)};
   return {label:id==='bridge'?'艦橋':label,status:equipmentStatus(state),equipment,damagedTurn:state.damagedTurn};
  });
 }
 if(unit.buildingState?.slots)return unit.buildingState.slots.map(slot=>({
  label:slot.position==='中心'?'中心':slot.position+' '+(slot.mountIndex+1),
  status:slot.hp===0?'機能停止':slot.hp<slot.maxHp?'損傷':'正常',hp:slot.hp,maxHp:slot.maxHp,effects:slot.effects,
  equipment:groups.filter(g=>g.mountIndex===slot.mountIndex||(slot.position==='中心'&&unit.snapshot.mounts[g.mountIndex]?.position==='中心'))
 }));
 const locations=new Map();
 for(const group of groups){
  if(!locations.has(group.position))locations.set(group.position,{label:group.position||'搭載設備',equipment:[]});
  locations.get(group.position).equipment.push(group);
 }
 return [...locations.values()];
}
