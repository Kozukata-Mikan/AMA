import {forkTerrainForEditing,writeTerrainOverride} from './terrain-data.js';
const equal=(a,b)=>a===b||!!(a&&b&&a.every((v,i)=>v===b[i]));
export function beginTerrainEdit(source){
 const changes=new Map();
 const working=forkTerrainForEditing(source,change=>{
  const previous=changes.get(change.index);
  const combined={index:change.index,before:previous?previous.before:change.before,after:change.after};
  if(equal(combined.before,combined.after))changes.delete(change.index);else changes.set(change.index,combined);
 });
 return {source,working,changes,
  frame(){return {kind:'patch',upgradeBase:source.version===3?null:source,changes:[...changes.values()]}},
  drain(){const batch=[...changes.values()];changes.clear();return batch}
 };
}
export function applyTerrainFrame(source,frame,forward){
 if(frame.kind==='replace')return forward?frame.after:frame.before;
 if(!forward&&frame.upgradeBase)return frame.upgradeBase;
 const working=forkTerrainForEditing(forward&&frame.upgradeBase?frame.upgradeBase:source);
 for(const change of frame.changes)writeTerrainOverride(working,change.index,forward?change.after:change.before);
 return working;
}
export function applyTerrainChanges(working,changes){for(const change of changes)writeTerrainOverride(working,change.index,change.after)}
