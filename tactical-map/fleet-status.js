import {getObservationSide,getObservedScene} from './simulation-features.js?v=self-sealing-1';
const SHIP_STATUS={intact:'無損傷',minor:'軽微な損傷',light:'小破',moderate:'中破',heavy:'大破',sinking:'沈没寸前',sunk:'沈没'};
const AIR_MISSION={parked:'駐機',ready:'整備完了・離陸待機',launching:'離陸中',landing:'着陸中',airborne:'飛行中'};
const SUPPORT={rescue:'救助', 'damage-control':'外部損管',supply:'補給'};
export function buildFleetStatus(scene,observed=getObservedScene(scene)){
 const side=getObservationSide(scene),known=new Map(observed.instances.filter(u=>u.observationOwn||u.observationLevel==='identified').map(u=>[u.instanceId,u.name]));
 const own=scene.instances.filter(u=>u.side===side),ownIds=new Set(own.map(u=>u.instanceId));for(const u of own)known.set(u.instanceId,u.name);
 const names=id=>known.get(id)??'未識別目標',groups=new Map(observed.groups.map(g=>[g.id,g]));
 const tasks=[...(scene.supportRuntime?.tasks??[]),...(scene.rescueTasks??[]).map(t=>({...t,kind:'rescue',providerId:t.rescuerId}))].filter(t=>t.status==='active');
 const taskActions=new Map(),commandTargets=new Map(),moving=new Set(),latest=new Map();
 const addAction=(id,text)=>{if(!ownIds.has(id))return;if(!taskActions.has(id))taskActions.set(id,new Set());taskActions.get(id).add(text);};
 for(const t of tasks){addAction(t.providerId,`${SUPPORT[t.kind]??'支援'}：${names(t.targetId)}`);addAction(t.targetId,`${SUPPORT[t.kind]??'支援'}を受領：${names(t.providerId)}`);}
 for(const p of scene.movementPlans??[])for(const id of p.memberIds??[])moving.add(id);
 for(const c of scene.attackRuntime?.commands??[]){if(!ownIds.has(c.unitId))continue;if(!commandTargets.has(c.unitId))commandTargets.set(c.unitId,new Set());const ref=c.targetRef;commandTargets.get(c.unitId).add(ref?.kind==='group'?(groups.get(ref.id)?.name??'未識別編隊'):names(c.targetId??ref?.id));}
 const records=scene.settlementRuntime?.attackRecords??[];for(let i=records.length-1;i>=0;i--){const r=records[i];if(r.turnNumber<scene.turn.number)break;if(r.turnNumber!==scene.turn.number)continue;const targets=new Map();for(const hit of r.hitReports??[])if(ownIds.has(hit.unitId)&&!latest.has(hit.unitId)){if(!targets.has(hit.unitId))targets.set(hit.unitId,new Set());targets.get(hit.unitId).add(names(hit.targetId));}for(const [id,set]of targets)latest.set(id,set);}
 const rows=own.map(u=>{
  const air=u.aircraftState,building=u.buildingState,status=air?(air.status==='destroyed'?'撃墜・喪失':air.status==='heavy'?'大破':u.currentHp<u.snapshot.maxHp?'損傷':'無損傷'):building?(building.status==='destroyed'?'破壊':building.status==='rebuilding'?'中心再建中':u.currentHp<u.snapshot.maxHp?'損傷':'無損傷'):SHIP_STATUS[u.shipState?.status]??(u.currentHp===u.snapshot.maxHp?'無損傷':'損傷');
  const effects=[];if(u.shipState?.effects?.fire||building?.slots?.some(s=>s.effects?.fire))effects.push('火災');if(u.shipState?.effects?.flooding)effects.push('浸水');if(air?.panic?.state==='confused')effects.push('混乱');if(air?.panic?.state==='retreating')effects.push('撤退');
  const actions=[...(taskActions.get(u.instanceId)??[])];
  if(moving.has(u.instanceId))actions.push('移動計画あり');
  const targets=commandTargets.get(u.instanceId);if(targets?.size)actions.push('攻撃準備：'+[...targets].join(' / '));
  if(air&&air.status!=='destroyed'){actions.push(air.mission==='parked'?(air.deckZone==='preparation'?'整備区':'格納庫')+(air.prepared?'・整備済み':'・未整備'):AIR_MISSION[air.mission]??air.mission);const f=air.flightPlan;if(air.mission==='airborne'&&f)actions.push(f.stage==='returning'?'帰投中':`${f.kind}任務${f.targetId?'：'+names(f.targetId):''}`);}
  if(!actions.length&&latest.has(u.instanceId))actions.push('攻撃済み：'+[...latest.get(u.instanceId)].join(' / '));

  const group=groups.get(u.groupId),path=[];let g=group;const seen=new Set();while(g&&!seen.has(g.id)){seen.add(g.id);path.unshift(g.name);g=groups.get(g.parentId);}
  return{id:u.instanceId,name:u.name,branch:u.branch,groupId:group?.id??'',groupName:path.join(' / ')||'編隊なし',status,hp:u.currentHp,maxHp:u.snapshot.maxHp,effects,actions:actions.length?actions:['待機'],airTime:air&&air.mission==='airborne'&&air.status!=='destroyed'?air.remainingAirTime:null,flagship:u.isOverallFlagship?'総旗艦':u.isFormationFlagship?'分旗艦':'',attention:status!=='無損傷'||effects.length>0||taskActions.has(u.instanceId)};
 });
 return{side,round:scene.turn.number,phase:scene.turn.phaseId,rows};
}
