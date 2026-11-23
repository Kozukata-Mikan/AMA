import {supportCapacity,supportRadius,inSupportRange,supportActive,supportConflicts,synchronizeSupportLocks,SUPPORT_NAMES} from './support-equipment.js?v=support-stations-1';
import {readShipProfile,applyShipFireFloodingPhase} from './ship-runtime.js?v=aircraft-template-2';
import {getEquipmentControlCandidates} from './equipment-item-runtime.js?v=aircraft-template-2';
const fail=message=>{throw new Error(message);};
const find=(scene,id)=>scene.instances.find(u=>u.instanceId===id);
const alive=unit=>unit&&Number.isFinite(unit.x)&&Number.isFinite(unit.y)&&(unit.branch==='navy'?!['sinking','sunk'].includes(unit.shipState?.status):unit.currentHp>0);
const station={rescue:'repair-station','damage-control':'damage-control-station',supply:'supply-station'};
export function supportLimit(unit,kind){return kind==='rescue'&&unit.branch==='navy'?Math.max(1,supportCapacity(unit,station[kind])):supportCapacity(unit,station[kind]);}
export function needsSupport(unit,kind){
 if(!unit||unit.branch!=='navy'||unit.shipState?.status==='sunk')return false;
 if(kind==='rescue')return unit.shipState.status==='sinking';
 if(kind==='supply')return unit.shipState.status!=='sinking'&&unit.shipState.remainingEndurance<readShipProfile(unit).enduranceBudget;
 return unit.shipState.status!=='sinking'&&Boolean(unit.shipState.effects?.fire||unit.shipState.effects?.flooding||getEquipmentControlCandidates(unit).length);
}
export function initializeSupportRuntime(scene){
 scene.supportRuntime??={version:1,tasks:[],records:[],lastSpecialTurn:0};const r=scene.supportRuntime;
 if(r.version!==1||!Array.isArray(r.tasks)||!Array.isArray(r.records)||!Number.isSafeInteger(r.lastSpecialTurn)||r.lastSpecialTurn<0||r.lastSpecialTurn>scene.turn.number)fail('支援任務の保存状態が不正です。');
 const ids=new Set(),targets=new Set();
 for(const t of r.tasks){
  if(!t||typeof t.id!=='string'||ids.has(t.id)||!SUPPORT_NAMES[t.kind]||!['active','complete','failed','interrupted'].includes(t.status)||!find(scene,t.providerId)||!find(scene,t.targetId)||t.providerId===t.targetId||!Number.isSafeInteger(t.startedTurn)||t.startedTurn<1||t.startedTurn>scene.turn.number||!Number.isSafeInteger(t.lastProcessedTurn)||t.lastProcessedTurn<0||t.lastProcessedTurn>scene.turn.number)fail('支援任務の記録が不正です。');
  ids.add(t.id);if(t.status==='active'){if(targets.has(t.targetId))fail('同じ艦船が複数の支援を受けています。');targets.add(t.targetId);}
 }
 synchronizeSupportLocks(scene);
}
export function endSupport(scene,task,reason,status='interrupted'){
 if(task.status!=='active')return;
 if(task.kind==='rescue'&&status==='interrupted'){
  const target=find(scene,task.targetId);if(target.shipState?.status==='sinking'){
   const minutes=Math.max(0,scene.turn.number-task.startedTurn)*30;target.shipState.sinkingElapsedMinutes+=minutes;task.pausedMinutesBackfilled=minutes;
   if(target.shipState.sinkingElapsedMinutes>=120)target.shipState.status='sunk';
  }
 }
 task.status=status;task.finishedTurn=scene.turn.number;task.reason=reason;synchronizeSupportLocks(scene);
}
export function reconcileSupports(scene){
 initializeSupportRuntime(scene);const used=new Map();
 for(const task of supportActive(scene)){
  const provider=find(scene,task.providerId),target=find(scene,task.targetId),key=task.providerId+':'+task.kind;
  const count=(used.get(key)??0)+1;used.set(key,count);
  if(!alive(provider)||!inSupportRange(provider,target)||provider.side!==target.side||count>supportLimit(provider,task.kind)||provider.shipState?.rescueTaskId||target.shipState?.rescueTaskId)endSupport(scene,task,'継続条件を失いました。');
  else if(!needsSupport(target,task.kind))endSupport(scene,task,'支援が不要になりました。','complete');
 }
 synchronizeSupportLocks(scene);
}
export function startSupport(scene,{providerId,targetId,kind},autonomous=false){
 initializeSupportRuntime(scene);if(scene.turn.phaseId!=='special')fail('支援は特殊段階で開始してください。');
 const provider=find(scene,providerId),target=find(scene,targetId),side=autonomous&&scene.controls.enemyAutonomy&&['enemy','neutral'].includes(provider?.side)?provider.side:scene.controls.enemyAutonomy?'ally':scene.controls.observationSide;
 if(!SUPPORT_NAMES[kind]||!alive(provider)||provider.side!==side||target?.side!==side||providerId===targetId||!needsSupport(target,kind))fail('支援側・対象・任務を確認してください。');
 if(!inSupportRange(provider,target))fail('対象艦が支援円の外です。');
 const active=supportActive(scene);
 if(active.some(t=>t.targetId===targetId||t.targetId===providerId||t.providerId===targetId)||provider.shipState?.rescueTaskId||target.shipState?.rescueTaskId)fail('別の支援・救助任務に参加しています。');
 if(active.filter(t=>t.providerId===providerId&&t.kind===kind).length>=supportLimit(provider,kind))fail('この支援設備の同時支援数を超えています。');
 const task={id:crypto.randomUUID(),providerId,targetId,kind,status:'active',startedTurn:scene.turn.number,lastProcessedTurn:0};scene.supportRuntime.tasks.push(task);synchronizeSupportLocks(scene);return task.id;
}
export function interruptSupportForMovement(scene,ids,confirmed){
 const tasks=supportConflicts(scene,ids);if(!tasks.length)return;
 if(confirmed!==true){const error=new Error('支援中の艦船です。移動すると支援を中止します。完了済みの効果は保持されます。');error.code='SUPPORT_INTERRUPTION_REQUIRED';throw error;}
 for(const task of tasks)endSupport(scene,task,'移動指令により中止しました。');
}
export function planAutonomousSupports(scene){
 if(!scene.controls?.enemyAutonomy)return;
 const candidates=scene.instances.filter(u=>u.branch==='navy'&&u.shipState?.status!=='sunk');
 for(const provider of scene.instances){
  if(!['enemy','neutral'].includes(provider.side)||!alive(provider))continue;
  for(const kind of ['rescue','damage-control','supply']){
   if(!supportLimit(provider,kind))continue;
   for(const target of candidates){
    if(target.side!==provider.side||!needsSupport(target,kind)||!inSupportRange(provider,target))continue;
    try{startSupport(scene,{providerId:provider.instanceId,targetId:target.instanceId,kind},true);}catch{} // 已被占用或本类容量已满，保留其他合法任务。
   }
  }
 }
}
export function resolveSupportsAtSpecial(scene,{coinSource,selectRepairIndex}={}){
 initializeSupportRuntime(scene);const r=scene.supportRuntime;
 if(r.lastSpecialTurn>=scene.turn.number)fail('このラウンドの外部支援は処理済みです。');
 reconcileSupports(scene);planAutonomousSupports(scene);
 const results=[];
 for(const task of supportActive(scene)){
  const provider=find(scene,task.providerId),target=find(scene,task.targetId);const result={taskId:task.id,kind:task.kind,providerId:task.providerId,targetId:task.targetId,turnNumber:scene.turn.number};
  if(task.kind==='rescue'){
   if(scene.turn.number<task.startedTurn+1)continue;
   const guaranteed=supportCapacity(provider,'repair-station')>0,heads=guaranteed?null:(coinSource?coinSource():Boolean(crypto.getRandomValues(new Uint32Array(1))[0]&1));
   if(heads!==null&&typeof heads!=='boolean')fail('救助のコイン結果が不正です。');
   const success=guaranteed||heads;target.shipState.status=success?'heavy':'sunk';endSupport(scene,task,success?'救助成功':'救助失敗',success?'complete':'failed');Object.assign(result,{guaranteed,coinHeads:heads,success});
  }else if(task.kind==='damage-control'){
   result.report=applyShipFireFloodingPhase(target,{turnNumber:scene.turn.number,phaseId:'special',externalSupport:true},coinSource,selectRepairIndex);
   if(!needsSupport(target,task.kind))endSupport(scene,task,'損管完了','complete');
  }else{
   const before=target.shipState.remainingEndurance,initial=readShipProfile(target).enduranceBudget;
   target.shipState.remainingEndurance=Math.min(initial,before+initial*.25);Object.assign(result,{before,after:target.shipState.remainingEndurance,restored:target.shipState.remainingEndurance-before});
   if(!needsSupport(target,task.kind))endSupport(scene,task,'補給完了','complete');
  }
  task.lastProcessedTurn=scene.turn.number;results.push(result);
 }
 r.records.push({turnNumber:scene.turn.number,results});r.lastSpecialTurn=scene.turn.number;reconcileSupports(scene);return results;
}
