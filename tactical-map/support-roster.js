import {unitNeedsAttention} from './support-condition.js';
import {NO_FLEET} from './fleet-unit-selector.js?v=fleet-cohesion-6';

const searchable=value=>value.normalize('NFKC').toLowerCase().trim();
export function indexSupportRoster(scene){
 const own=scene.instances.filter(unit=>unit.observationOwn&&!unit.projectileState);
 const groups=new Map(scene.groups.filter(group=>!group.observationForeign).map(group=>[group.id,group]));
 const counts=new Map(),paths=new Map(),members=new Map(),damaged=new Set();
 function pathFor(id){
  if(paths.has(id))return paths.get(id);
  const path=[],seen=new Set();
  for(let group=groups.get(id);group&&!seen.has(group.id);group=groups.get(group.parentId)){
   seen.add(group.id);path.unshift(group);
  }
  const label=path.map(group=>group.name).join(' › ');
  const value={path,label,text:searchable(label)};
  paths.set(id,value);return value;
 }
 for(const unit of own){
  const attention=Boolean(unitNeedsAttention(unit));
  if(attention)damaged.add(unit.instanceId);
  const path=pathFor(unit.groupId);
  members.set(unit.instanceId,{group:path,name:searchable(unit.name)});
  const ids=path.path.length?path.path.map(group=>group.id):[NO_FLEET];
  for(const id of ids){
   if(!counts.has(id))counts.set(id,{id,label:id===NO_FLEET?'編隊なし':pathFor(id).label,total:0,attention:0});
   const count=counts.get(id);count.total++;if(attention)count.attention++;
  }
 }
 const options=[...counts.values()].sort((a,b)=>a.id===NO_FLEET?1:b.id===NO_FLEET?-1:a.label.localeCompare(b.label,'ja'));
 return {own,damaged,members,options};
}
export function filterSupportRoster(index,groupId,query,attentionOnly){
 const term=searchable(query);
 return index.own.filter(unit=>{
  if(attentionOnly&&!index.damaged.has(unit.instanceId))return false;
  const {group,name}=index.members.get(unit.instanceId);
  if(groupId===NO_FLEET&&group.path.length)return false;
  if(groupId&&groupId!==NO_FLEET&&!group.path.some(g=>g.id===groupId))return false;
  return name.includes(term)||group.text.includes(term)||(!group.path.length&&'編隊なし'.includes(term));
 });
}
