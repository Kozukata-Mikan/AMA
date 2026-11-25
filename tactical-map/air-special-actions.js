import {hasAirTrait,airRetreating,resolveAceLosses} from './air-training-runtime.js?v=air-training-1';
import {getVisibility} from './simulation-features.js?v=field-support-1';
import {readAircraftProfile} from './aircraft-runtime.js?v=air-losses-1';
import {aviationHostAlive,aviationRunways,aviationLanes} from './aviation-operations.js?v=field-support-1';
import {aircraftFacilityCompatible} from '../js/aircraft-template.js?v=air-training-1';
import {sampleTerrain} from './terrain-data.js';
import {navalHeight} from './naval-kind.js';
import {detonateAircraftPayloads} from './aviation-detonation.js?v=field-support-1';
import {applyCombatTargetDamage,combatTargetState} from './combat-target-runtime.js?v=field-support-1';
import {applyShipEffectAcquisition} from './ship-runtime.js?v=field-support-1';
import {compareArmorGrades} from './armor-runtime.js';
export function ensureRetreatMissions(scene){
 const hosts=scene.instances.filter(aviationHostAlive),map=new Map(scene.instances.map(u=>[u.instanceId,u]));
 for(const p of scene.instances){if(!p.aircraftState||!airRetreating(p)||p.aircraftState.status==='destroyed'||p.aircraftState.mission!=='airborne')continue;const f=p.aircraftState.flightPlan;if(f){f.stage='returning';continue;}const originalHome=map.get(p.aircraftState.sortieHomeId),home=(aviationHostAlive(originalHome)?originalHome:null)??hosts.filter(h=>aviationLanes(h,p.snapshot.aircraft.type).length&&h.side===p.side&&aircraftFacilityCompatible(p.snapshot.aircraft.type,h)).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];if(!home){p.aircraftState.retreatNotice='帰投先がありません。手動で着陸先を指定してください。';continue;}p.aircraftState.flightPlan={version:1,kind:'CAR',behavior:'priority',stage:'returning',homeId:home.instanceId,origin:{x:home.x,y:home.y},waypoints:[],cursor:0,radius:50,altitude:p.altitude,notice:''};}
}
export function martyrRoutes(scene,excluded=new Set()){
 const routes=[],cache=new Map();for(const p of scene.instances){const s=p.aircraftState;if(!s||s.status!=='heavy'||s.mission!=='airborne'||!hasAirTrait(p,'martyr')||excluded.has(p.instanceId))continue;const candidates=scene.instances.filter(t=>((p.side==='ally'&&t.side==='enemy')||(p.side==='enemy'&&t.side==='ally'))&&Number.isFinite(t.x)&&Number.isFinite(t.y)&&t.aircraftState?.status!=='destroyed'&&t.shipState?.status!=='sunk'&&(t.branch!=='building'||t.currentHp>0)&&(!t.aircraftState||t.aircraftState.mission==='airborne'));
  if(!cache.has(p.side))cache.set(p.side,getVisibility({...scene,controls:{...scene.controls,observationSide:p.side,enemyAutonomy:false}},new Set(candidates.map(t=>t.instanceId))));const height=t=>t.branch==='air'?t.altitude:t.branch==='building'?sampleTerrain(scene.terrain,t.x,t.y).surface:navalHeight(t,sampleTerrain(scene.terrain,t.x,t.y)),seen=cache.get(p.side),ceiling=readAircraftProfile(p).ceiling,target=candidates.filter(t=>seen.get(t.instanceId)==='identified'&&height(t)<ceiling).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y,height(a)-p.altitude)-Math.hypot(b.x-p.x,b.y-p.y,height(b)-p.altitude))[0];if(!target)continue;p.altitude=Math.min(ceiling,Math.max(1,height(target)+1));
  const d=Math.hypot(p.x-target.x,p.y-target.y),budget=Math.min(readAircraftProfile(p).movementLimit,s.remainingEndurance),scale=d?Math.min(1,budget/d):0;const point={x:p.x+(target.x-p.x)*scale,y:p.y+(target.y-p.y)*scale};routes.push({instanceId:p.instanceId,route:[{x:p.x,y:p.y},point]});s.ramTargetId=target.instanceId;
 }return routes;
}
export function resolveMartyrRams(scene,coin){
 const reports=[];for(const p of scene.instances){const s=p.aircraftState;if(!s?.ramTargetId||s.status!=='heavy'||!hasAirTrait(p,'martyr'))continue;const target=scene.instances.find(t=>t.instanceId===s.ramTargetId);if(!target||target.aircraftState?.status==='destroyed'||target.shipState?.status==='sunk'||Math.hypot(p.x-target.x,p.y-target.y)>1e-5)continue;
  const detonation=detonateAircraftPayloads(scene,target,[p],coin),context={turnNumber:scene.turn.number,phaseId:scene.turn.phaseId},attackId=`ram:${scene.turn.number}:${p.instanceId}`;
  const applied=applyCombatTargetDamage(target,{attackId,kind:'batch',hitCount:detonation.cannonImpacts.length+detonation.numericReports.length+detonation.buildingHits.length,hpDamage:detonation.hpDamage,hasDamageEffect:detonation.hasDamageEffect,normalHitRemainder:detonation.normalHitRemainder,buildingHits:detonation.buildingHits,coinSource:coin},context);combatTargetState(target).underwaterStrengthUses=(combatTargetState(target).underwaterStrengthUses??0)+(detonation.strengthConsumed??0);
  for(const effect of detonation.effects)if(target.branch==='navy')applyShipEffectAcquisition(target,effect,context,coin);
  reports.push({aircraftId:p.instanceId,targetId:target.instanceId,detonation,applied});
 }return reports;
}
export function applyLowCloud(scene,planes){for(const p of planes){if(!hasAirTrait(p,'low-cloud')||p.aircraftState?.mission!=='airborne'||p.aircraftState.status!=='operational')continue;const f=p.aircraftState.flightPlan;if(!f||f.stage==='returning'||f.stage==='complete')continue;const point=f.targetPoint??f.waypoints.at(-1);if(!point||Math.hypot(p.x-point.x,p.y-point.y)>100)continue;const ground=sampleTerrain(scene.terrain,p.x,p.y).surface,altitude=Math.max(1,ground+1);if(altitude<=p.snapshot.aircraft.ceiling){p.altitude=altitude;f.lowFlying=true;}}}
const POSITIONS=[{id:'middle-1',label:'中部①',overpenetration:false},{id:'middle-2',label:'中部②',overpenetration:false},{id:'sides',label:'両舷',overpenetration:false},{id:'front',label:'前部',overpenetration:true},{id:'rear',label:'後部',overpenetration:true},{id:'tail',label:'尾部',overpenetration:true}];
export function aimedAircraftPosition(actor,target,group,profile){if(!hasAirTrait(actor,'eloquence')||group?.position!=='掛載'||target.branch!=='navy')return null;const category=/艦砲|舰炮/.test(profile.powerRule??'')?compareArmorGrades(profile.penetration,target.snapshot.naval.armor).category:null,credits={major:9,penetration:3,normal:1,shatter:0},down={major:'penetration',penetration:'normal',normal:'shatter',shatter:'shatter'};return [...POSITIONS].sort((a,b)=>(category?credits[b.overpenetration?down[category]:category]:1)-(category?credits[a.overpenetration?down[category]:category]:1))[0];}
