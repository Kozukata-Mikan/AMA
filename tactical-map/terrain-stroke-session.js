import {runBackgroundTask} from './background-client.js?v=field-support-1';
import {beginTerrainEdit,applyTerrainChanges} from './terrain-edit-history.js';
export function createTerrainStrokeSession(source,brush){
 const sessionId=crypto.randomUUID(),edit=beginTerrainEdit(source);let cancelled=false,closed=false;
 let pending=runBackgroundTask('terrain-start',{sessionId,source,brush});
 // A cancel may happen before the first pointer-move attaches a waiter.
 pending.catch(()=>{});
 return {
  working:edit.working,
  enqueue(points){
   pending=pending.then(async()=>{
    if(cancelled)return;
    const result=await runBackgroundTask('terrain-dabs',{sessionId,points});
    if(!cancelled)applyTerrainChanges(edit.working,result.changes);
   });
   pending.catch(()=>{});return pending;
  },
  async finish(){await pending;if(cancelled)throw new Error('描画は取り消されています。');await runBackgroundTask('terrain-end',{sessionId});closed=true;return {terrain:edit.working,frame:edit.frame()}},
  async cancel(){cancelled=true;try{await pending}catch{}if(!closed)await runBackgroundTask('terrain-cancel',{sessionId});closed=true}
 };
}
