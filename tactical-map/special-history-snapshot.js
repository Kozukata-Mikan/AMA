import {freezeSnapshot} from './read-only-snapshot.js';
const records=new WeakSet(),equipment=new WeakSet(),serializedEquipment=new WeakMap();
const clone=value=>JSON.parse(JSON.stringify(value));
const fields=['beforeEquipmentState','afterEquipmentState'];
export function immutableHistoryEquipment(value){
 if(value&&typeof value==='object'&&equipment.has(value))return value;
 const next=clone(value);if(next&&typeof next==='object'){freezeSnapshot(next);equipment.add(next)}return next;
}
export function historyEquipmentKey(value){
 if(value&&typeof value==='object'&&equipment.has(value)){
  if(!serializedEquipment.has(value))serializedEquipment.set(value,JSON.stringify(value));return serializedEquipment.get(value);
 }
 return JSON.stringify(value);
}
export function isImmutableSpecialRecord(value){return !!value&&typeof value==='object'&&records.has(value)}
function immutableRecord(record){
 if(isImmutableSpecialRecord(record))return record;
 // Avoid expanding already-owned immutable equipment snapshots while copying a new record.
 const reports=record.shipReports;
 if(!Array.isArray(reports)){const result=freezeSnapshot(clone(record));records.add(result);return result}
 const result=clone({...record,shipReports:reports.map(report=>{const next={...report};for(const key of fields)delete next[key];return next})});
 for(let i=0;i<reports.length;i++)for(const key of fields)if(reports[i][key]!==undefined)result.shipReports[i][key]=immutableHistoryEquipment(reports[i][key]);
 freezeSnapshot(result);records.add(result);return result;
}
export function freezeSpecialHistory(scene){
 if(Array.isArray(scene.specialRuntime?.records))scene.specialRuntime.records=scene.specialRuntime.records.map(immutableRecord);
 return scene;
}
export function copySceneWithSpecialHistory(scene){
 const runtime=scene.specialRuntime;
 if(!runtime||!Array.isArray(runtime.records))return clone(scene);
 const result=clone({...scene,specialRuntime:{...runtime,records:[]}});
 // Unknown/mutable caller data keeps the old independent mutable-copy contract.
 result.specialRuntime.records=runtime.records.map(record=>isImmutableSpecialRecord(record)?record:clone(record));
 return result;
}
