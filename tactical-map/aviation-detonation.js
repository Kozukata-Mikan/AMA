import {chooseBuildingSlot} from './building-state.js?v=facility-rules-1';
import {aviationRunways} from './aviation-operations.js?v=car-return-1';
import {hasAircraftTemplate} from './aircraft-runtime.js?v=car-return-1';
import {parseDamageRule} from './weapon-damage-rule.js?v=car-return-1';
import {readWeaponProfile} from './weapon-profile-runtime.js?v=catalog-symbols-1';
import {resolveNumericDamage} from './numeric-damage-runtime.js?v=car-return-1';
import {resolveCannonImpact,summarizeCannonImpacts} from './cannon-damage-runtime.js?v=car-return-1';
import {readCombatTargetProfile,combatTargetState,resolveBuildingCannonImpact,resolveAircraftCannonImpact} from './combat-target-runtime.js?v=car-return-1';
const area=value=>({'后部':'後部','中部1':'中部①','中部2':'中部②','两舷':'両舷','两舷部':'両舷'})[value]??value;
export function explodeRunwayPayloads(scene,host,positions,coinSource,strengthOverride){
 const result={buildingHits:[],hpDamage:0,hasDamageEffect:false,effects:[],cannonImpacts:[],numericReports:[],aircraftIds:[],runwayIds:[],normalHitRemainder:combatTargetState(host)?.normalHitRemainder??0};
 if(!positions.length)return result;
 const hits=new Set(positions.map(area)),runways=aviationRunways(host).filter(r=>hits.has(area(r.position))||hits.has(`mount-${r.mountIndex}`));
 if(!runways.length)return result;
 const ids=new Set(runways.map(r=>r.id));
 const planes=scene.instances.filter(plane=>hasAircraftTemplate(plane)&&plane.aircraftState?.hostId===host.instanceId&&ids.has(plane.aircraftState.runwayId)&&['ready','launching'].includes(plane.aircraftState.mission)&&plane.aircraftState.status!=='destroyed').sort((a,b)=>a.instanceId.localeCompare(b.instanceId));
 return detonateAircraftPayloads(scene,host,planes,coinSource,strengthOverride,[...ids]);
}
export function detonateAircraftPayloads(scene,host,planes,coinSource,strengthOverride,runwayIds=[]){
 const result={buildingHits:[],hpDamage:0,hasDamageEffect:false,effects:[],cannonImpacts:[],numericReports:[],aircraftIds:[],runwayIds,normalHitRemainder:combatTargetState(host)?.normalHitRemainder??0},profile=readCombatTargetProfile(host),initialStrength=strengthOverride??profile.strength-(combatTargetState(host).underwaterStrengthUses??0);let strengthRemaining=initialStrength;
 const payloads=[];
 // Only the selected external loadout detonates. Fixed weapons and pods stay out.
 for(const plane of planes){
  const selected=plane.snapshot.aircraft.loadouts.find(l=>l.id===plane.aircraftState.activeLoadoutId),equipment=new Map(plane.snapshot.equipmentSnapshots.map(e=>[e.id,e]));
  for(const m of selected?.mounts??[]){const e=equipment.get(m.equipmentId);if(e?.kind!=='weapon')throw Error('掛載武器の性能資料がありません。');const rule=parseDamageRule(e),count=m.count*(e.barrelCount??1);if(!Number.isSafeInteger(count)||count<1)throw Error('掛載武器数が不正です。');if(rule.kind==='equipment')throw Error('設備威力の掛載誘爆は対応する被害規則が必要です。');payloads.push({plane,e,rule,count,inertial:readWeaponProfile(e).guidance==='inertial'});}
 }
 // Existing underwater protection goes to the highest-power hits first.
 payloads.sort((a,b)=>Number(b.rule.underwater)-Number(a.rule.underwater)||(a.rule.underwater?b.rule.power-a.rule.power:0)||a.plane.instanceId.localeCompare(b.plane.instanceId)||a.e.id.localeCompare(b.e.id));
 for(const{plane,e,rule,count,inertial}of payloads){
  if(rule.kind==='cannon')for(let n=0;n<count;n++){
   const armor=inertial?profile.strengthArmor:profile.armor,impact=host.branch==='air'?resolveAircraftCannonImpact({penetration:e.penetration,armor},coinSource):host.branch==='building'?resolveBuildingCannonImpact({penetration:e.penetration,armor},coinSource,host):resolveCannonImpact({penetration:e.penetration,armor},coinSource);
   if(host.branch==='building')result.buildingHits.push({mountId:impact.position.mountId,normalCredits:impact.normalCredits,fireEligible:impact.fireEligible});
   result.cannonImpacts.push(impact);if(impact.fireEligible&&host.branch==='navy')result.effects.push({targetId:host.instanceId,attackId:`runway:${plane.instanceId}:${e.id}:${n}`,type:'fire'});
  }else if(host.branch==='building'){
   for(let n=0;n<count;n++){const slot=chooseBuildingSlot(host,coinSource),damage=resolveNumericDamage({powerRule:e.powerRule,hitCount:1,penetration:e.penetration,armor:profile.armor,inertial,strength:profile.strength,strengthRemaining});result.buildingHits.push({mountId:slot.id,damage:damage.hpDamage});result.hpDamage+=damage.hpDamage;result.hasDamageEffect||=damage.hasDamageEffect;if(rule.underwater)strengthRemaining=damage.strengthRemainingAfter;}
  }else{
   const damage=resolveNumericDamage({powerRule:e.powerRule,hitCount:count,penetration:e.penetration,armor:profile.armor,inertial,strength:profile.strength,strengthRemaining});result.numericReports.push({aircraftId:plane.instanceId,equipmentId:e.id,damage});result.hpDamage+=damage.hpDamage;result.hasDamageEffect||=damage.hasDamageEffect;
   if(rule.underwater){strengthRemaining=damage.strengthRemainingAfter;if(host.branch==='navy')for(let n=0;n<count;n++)result.effects.push({targetId:host.instanceId,attackId:`runway:${plane.instanceId}:${e.id}:${n}`,type:'flooding'});}
  }
 }
 const cannon=summarizeCannonImpacts(result.cannonImpacts,result.normalHitRemainder);result.hpDamage+=cannon.hpDamage;result.normalHitRemainder=cannon.normalHitRemainder;result.hasDamageEffect||=cannon.damagingImpactCount>0;result.strengthConsumed=initialStrength-strengthRemaining;result.runwayIds=[...runwayIds];
 for(const plane of planes){result.aircraftIds.push(plane.instanceId);plane.aircraftState.status='destroyed';plane.aircraftState.destroyedReason=runwayIds.length?'runway-payload-detonation':'martyr-ram';plane.aircraftState.prepared=false;plane.currentHp=0;}
 if(result.aircraftIds.length){scene.aviationRuntime??={version:1,inventoryInitialized:true,records:[],runwayUse:[],preparationUse:[]};scene.aviationRuntime.records.push({kind:runwayIds.length?'runway-detonation':'martyr-ram',hostId:host.instanceId,turnNumber:scene.turn.number,phaseId:scene.turn.phaseId,...structuredClone(result)});}
 return result;
}
