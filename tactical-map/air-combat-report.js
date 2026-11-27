export function observedAirCombat(scene,side){
 const units=new Map(scene.instances.map(u=>[u.instanceId,u])),own=id=>units.get(id)?.side===side;
 return{commands:(scene.airCombatRuntime?.commands??[]).filter(c=>c.actorIds.every(own)),records:(scene.airCombatRuntime?.records??[]).filter(r=>[...r.actorIds,...r.targetIds].some(own)).map(r=>{
  const known=new Set(r.witnesses?.[side]??[]),name=id=>own(id)||known.has(id)?units.get(id)?.name??'失われた機体':'未識別の航空機';
  return{turnNumber:r.turnNumber,phaseId:r.phaseId,duels:r.duels.filter(d=>[...d.left,...d.right].some(own)).map(d=>({left:d.left.map(name),right:d.right.map(name),skipped:d.skipped??false,outcome:d.outcome,heads:d.heads,dice:d.dice,maneuver:d.maneuver,readiness:d.readiness,recoveries:(d.applications??[]).filter(a=>own(a.targetId)&&a.selfSealingRecovery).map(a=>({aircraftName:name(a.targetId),...a.selfSealingRecovery})),panic:(d.panic??[]).filter(p=>own(p.aircraftId)).map(p=>({...p,aircraftName:name(p.aircraftId)})),aceLosses:(d.aceLosses??[]).filter(r=>own(r.pilotId)).map(r=>({...r,pilotName:r.pilotName,heirName:r.heirName})),shots:(d.shots??[]).map(s=>({actor:name(s.actorId),target:name(s.targetId),role:s.role,ambush:s.ambush??false,hitCount:s.hitCount,disruptionPenalty:own(s.actorId)?s.disruptionPenalty??0:undefined,weaponName:own(s.actorId)||known.has(s.actorId)?s.weaponName:'未識別兵装'}))}))};
 })};
}
