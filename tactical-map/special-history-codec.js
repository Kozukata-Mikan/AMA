import {immutableHistoryEquipment,historyEquipmentKey,freezeSpecialHistory} from './special-history-snapshot.js';
// Lossless wire/storage representation only. Rules and reports see the full original objects.
const fields=['beforeEquipmentState','afterEquipmentState'];
const marker='specialHistoryEncoding';
export function encodeSpecialHistory(scene){
 if(Object.hasOwn(scene,marker))throw new Error('特殊履歴の内部形式が重複しています。');
 const runtime=scene.specialRuntime;if(!runtime||!Array.isArray(runtime.records)||runtime.records.length===0)return scene;
 const table=[],indices=new Map();
 const records=runtime.records.map(record=>{
  if(!Array.isArray(record.shipReports))return record;
  return {...record,shipReports:record.shipReports.map(report=>{
   const next={...report};
   for(const key of fields){
    const value=report[key];if(value===undefined)continue;
    const text=historyEquipmentKey(value);let index=indices.get(text);
    if(index===undefined){index=table.length;indices.set(text,index);table.push(value)}
    next[key]={$equipmentState:index};
   }
   return next;
  })};
 });
 if(table.length===0)return scene;
 return {...scene,specialRuntime:{...runtime,records},[marker]:{version:1,equipmentStates:table}};
}
export function decodeSpecialHistory(scene){
 const encoding=scene[marker];if(encoding===undefined)return scene;
 if(!encoding||encoding.version!==1||!Array.isArray(encoding.equipmentStates)||!scene.specialRuntime||!Array.isArray(scene.specialRuntime.records))throw new Error('特殊履歴の圧縮形式が不正です。');
 const table=encoding.equipmentStates.map(value=>immutableHistoryEquipment(value));
 const records=scene.specialRuntime.records.map(record=>{
  if(!record||!Array.isArray(record.shipReports))throw new Error('特殊履歴の圧縮記録が不正です。');
  return {...record,shipReports:record.shipReports.map(report=>{
   if(!report||typeof report!=='object')throw new Error('特殊履歴の報告形式が不正です。');
   const next={...report};
   for(const key of fields){
    const reference=report[key];if(reference===undefined)continue;
    if(!reference||typeof reference!=='object'||Object.keys(reference).length!==1||!Number.isSafeInteger(reference.$equipmentState)||reference.$equipmentState<0||reference.$equipmentState>=table.length)throw new Error('特殊履歴の装備参照が範囲外です。');
    next[key]=table[reference.$equipmentState];
   }
   return next;
  })};
 });
 const result={...scene,specialRuntime:{...scene.specialRuntime,records}};delete result[marker];return freezeSpecialHistory(result);
}
