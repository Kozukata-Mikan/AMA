import {flareBlocks} from './electronic-warfare.js?v=electronic-ballistic-1';
import {spottingBonus} from './support-effects.js?v=electronic-ballistic-1';
import {airDisruptionPenalty} from './air-disruption.js?v=car-return-1';
import {initializeAirTraining,resolveAceLosses,airTrainingRule,rollManeuver,applySquadPanic,airConfused,airRetreating,canAmbush,markAmbush} from './air-training-runtime.js?v=electronic-ballistic-1';
import {checkRayTarget,registerRayTarget,initializeRayTargetRuntime} from './ray-target-runtime.js';
import {traceAttackTerrainLine,entersTerrainInterior} from './attack-terrain-runtime.js';
import {hasAircraftTemplate,aircraftCanAct,applyAircraftHit,ensureAircraftRuntime} from './aircraft-runtime.js?v=electronic-ballistic-1';
import {aircraftMayFly} from './aviation-time.js?v=electronic-ballistic-1';
import {readWeaponProfile} from './weapon-profile-runtime.js?v=electronic-ballistic-1';
import {parseDamageRule} from './weapon-damage-rule.js?v=car-return-1';
import {resolveHitCoins,getHitModifiers} from './weapon-hit-runtime.js?v=electronic-ballistic-1';
import {resolveNumericDamage} from './numeric-damage-runtime.js?v=car-return-1';
import {compareArmorGrades,readArmorGrade} from './armor-runtime.js?v=car-return-1';
import {getVisibility,getObserverVisibility} from './simulation-features.js?v=electronic-ballistic-1';
const fail=m=>{throw Error(m);};
const randomCoin=()=>Boolean(crypto.getRandomValues(new Uint32Array(1))[0]&1);
function toss(coin){const value=coin();if(typeof value!=='boolean')fail('空戦のコイン結果が不正です。');return value;}
function indexOfRandom(n,coin){if(n===1)return 0;const bits=Math.ceil(Math.log2(n));for(let tries=0;tries<1000;tries++){let value=0;for(let i=0;i<bits;i++)value=value*2+Number(toss(coin));if(value<n)return value;}fail('空戦の無作為抽選が収束しません。');}
function shuffle(items,coin){const list=[...items];for(let i=list.length-1;i>0;i--){const j=indexOfRandom(i+1,coin);[list[i],list[j]]=[list[j],list[i]];}return list;}
export const AIR_TRAINING=[['novice','見習い'],['regular','普通'],['elite','精鋭'],['ace','エース']];
export function airReaction(training){const key=String(training??'').trim(),map={'':1,novice:0,'见习':0,'見習い':0,'見習':0,regular:1,'普通':1,elite:2,'精锐':2,'精鋭':2,ace:3,'王牌':3,'エース':3};if(!(key in map))fail('航空機の練度は見習い・普通・精鋭・エースから選択してください。');return map[key];}
export function maneuverDice(aircraft){const match=String(aircraft?.maneuverability??'').match(/^(\d+)R$/i),n=match?Number(match[1]):NaN;if(!Number.isSafeInteger(n)||n<1||n>10000)fail('空戦には整数の機動性（1R・2Rなど）が必要です。');return n;}
export function splitAirSquadrons(planes,coin=randomCoin){const shuffled=shuffle(planes,coin),count=Math.floor(shuffled.length/3),squads=[];for(let i=0;i<count;i++)squads.push(shuffled.slice(i*3,i*3+3));for(const plane of shuffled.slice(count*3))squads.push([plane]);return squads;}
export function buildAirEngagements(left,right,coin=randomCoin){const a=splitAirSquadrons(left,coin),b=splitAirSquadrons(right,coin),edges=new Map();if(!a.length||!b.length)return{squads:[a,b],edges:[]};for(let i=0;i<a.length;i++){const j=indexOfRandom(b.length,coin);edges.set(`${i}:${j}`,{left:i,right:j});}for(let j=0;j<b.length;j++){const i=indexOfRandom(a.length,coin);edges.set(`${i}:${j}`,{left:i,right:j});}return{squads:[a,b],edges:shuffle([...edges.values()],coin)};}
export function initializeAirCombat(scene){scene.airCombatRuntime??={version:1,commands:[],records:[]};const r=scene.airCombatRuntime;if(r.version!==1||!Array.isArray(r.commands)||!Array.isArray(r.records))fail('空戦の保存形式が不正です。');const ids=new Set();for(const c of r.commands){if(typeof c.id!=='string'||ids.has(c.id)||!Number.isSafeInteger(c.turnNumber)||c.turnNumber<1||!/^order-[1-5]$/.test(c.phaseId)||!Array.isArray(c.actorIds)||!Array.isArray(c.targetIds)||!c.actorIds.length||!c.targetIds.length||new Set(c.actorIds).size!==c.actorIds.length||new Set(c.targetIds).size!==c.targetIds.length)fail('空戦計画の保存状態が不正です。');ids.add(c.id);}return r;}
function planesFor(scene,ids){if(!Array.isArray(ids)||!ids.length||ids.length>27||new Set(ids).size!==ids.length)fail('機体は重複なく1～27機で指定してください。');const map=new Map(scene.instances.map(u=>[u.instanceId,u]));return ids.map(id=>{const p=map.get(id);if(!hasAircraftTemplate(p))fail('航空機テンプレートのある機体を指定してください。');return p;});}
function weaponGroups(plane,role,phase){const eq=new Map(plane.snapshot.equipmentSnapshots.map(e=>[e.id,e]));return plane.equipmentState.groups.filter(g=>g.position===role&&!g.damaged&&!g.destroyed&&g.remainingAmmo!==0).map(g=>({g,e:eq.get(g.equipmentId),p:readWeaponProfile(eq.get(g.equipmentId),g)})).filter(w=>w.p.kind==='weapon'&&!w.p.pasOnly&&Number(phase.slice(-1))<=w.p.maxOrder);}
function validateBattle(scene,c,{manual=false}={}){
 const actors=planesFor(scene,c.actorIds),targets=planesFor(scene,c.targetIds),side=actors[0].side;
 if(actors.some(p=>p.side!==side||!aircraftCanAct(p,'attack')||!aircraftMayFly(scene,p))||targets.some(p=>p.side===side||p.aircraftState.mission!=='airborne'||p.aircraftState.status==='destroyed'))fail('空戦には行動可能な自陣営の航空機と飛行中の敵航空機が必要です。');
 const visibility=getVisibility({...scene,controls:{...scene.controls,observationSide:side,enemyAutonomy:false}},new Set(c.targetIds));if(targets.some(p=>visibility.get(p.instanceId)!=='identified'))fail('空戦目標は自陣営で識別済みの機体だけを選択してください。');
 for(const p of [...actors,...targets]){maneuverDice(p.snapshot.aircraft);airTrainingRule(p).reaction;readArmorGrade(p.snapshot.naval.armor);for(const role of ['主動武器','自衛武器'])for(const w of weaponGroups(p,role,scene.turn.phaseId)){if(w.p.issues.length)fail(`${p.name} / ${w.p.label}：${w.p.issues.join(' / ')}`);const rule=parseDamageRule(w.e);if(w.p.guidance==='inertial')fail('航空機の固有強度による慣性防御は未定義です。航空機への慣性武器は後続規則が必要です。');if(w.p.large||rule.kind==='equipment'||rule.underwater)fail('この武器の航空機への専用被害規則は未接続です。通常数字威力・艦砲威力を使用してください。');if(rule.kind==='cannon')compareArmorGrades(w.p.penetration,p.snapshot.naval.armor);}}
 if(manual&&side!==(scene.controls.enemyAutonomy?'ally':scene.controls.observationSide))fail('操作中の陣営の航空機を指定してください。');
 const reachable=actors.some(a=>weaponGroups(a,'主動武器',scene.turn.phaseId).some(w=>w.g.remainingAmmo>=w.p.fullAmmoCost&&targets.some(b=>distance(a,b)<=w.p.range+1e-7&&(b.altitude-a.altitude)<=w.p.ceilingU+1e-7)));
 if(!reachable)fail('現在の次序で射距・射高・弾薬を満たす主動武器がありません。');return{actors,targets};
}
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,(a.altitude??0)-(b.altitude??0));
export function saveAirCombat(scene,request){
 if(!/^order-[1-5]$/.test(scene.turn.phaseId))fail('空戦計画は次序1～5で指定してください。');const r=initializeAirCombat(scene),c={id:crypto.randomUUID(),turnNumber:scene.turn.number,phaseId:scene.turn.phaseId,actorIds:[...request.actorIds],targetIds:[...request.targetIds]};validateBattle(scene,c,{manual:true});if(r.commands.some(o=>o.turnNumber===c.turnNumber&&o.phaseId===c.phaseId&&o.actorIds.some(id=>c.actorIds.includes(id))))fail('この機体の空戦計画は登録済みです。先に取り消してください。');r.commands.push(c);
}
export function preflightAirCombat(scene){const r=initializeAirCombat(scene);for(const c of r.commands.filter(c=>c.turnNumber===scene.turn.number&&c.phaseId===scene.turn.phaseId))validateBattle(scene,c);}
function readiness(squad,encounter,coin){const members=squad.filter(p=>p.aircraftState.status==='operational'&&!airRetreating(p));if(!members.length)return{normal:false,reason:'unable',roll:null};if(encounter===0)return{normal:true,reason:'first',roll:null};const reaction=airTrainingRule(members[0]).reaction;if(encounter>reaction)return{normal:false,reason:'exhausted',reaction,roll:null};const roll=toss(coin);return{normal:roll,reason:roll?'reaction-success':'reaction-failed',reaction,roll};}
function canFireAt(scene,a,b,profile,traces){
 if(distance(a,b)>profile.range+1e-7||b.altitude-a.altitude>profile.ceilingU+1e-7)return false;
 if(profile.guidance==='radar'&&getObserverVisibility(scene,a,b)===null)return false;
 if(profile.guidance==='ray'&&!checkRayTarget({scene,unitId:a.instanceId,targetId:b.instanceId,turnNumber:scene.turn.number}).allowed)return false;
 if(['direct','ray','lobbed'].includes(profile.guidance)){
  const key=a.instanceId+':'+b.instanceId;let trace=traces.get(key);if(!trace){trace=traceAttackTerrainLine(scene.terrain,{x:a.x,y:a.y,z:a.altitude},{x:b.x,y:b.y,z:b.altitude});traces.set(key,trace);}
  if(profile.guidance==='lobbed'?trace.maxGroundHeight>30+1e-7:entersTerrainInterior(trace))return false;
 }return true;
}
function fireWeapons(scene,shooters,opponents,role,coin){
 const shots=[],applications=[],traces=new Map();for(const a of shooters){if(a.aircraftState.status!=='operational'||a.electronicState?.droneSuppressed&&['drone','land-drone'].includes(a.snapshot.aircraft.type))continue;const choices=opponents.filter(p=>p.aircraftState.status!=='destroyed');if(!choices.length)break;
  const actualRole=airConfused(a)||airRetreating(a)?'自衛武器':role;
  for(const w of weaponGroups(a,actualRole,scene.turn.phaseId)){if(w.g.remainingAmmo<w.p.fullAmmoCost)continue;const eligible=choices.filter(b=>canFireAt(scene,a,b,w.p,traces));if(!eligible.length)continue;const b=eligible[indexOfRandom(eligible.length,coin)],modifiers=getHitModifiers({guidance:w.p.guidance,environment:scene.environment,globalBonuses:spottingBonus(a),globalPenalties:(distance(a,b)>w.p.range/2+1e-7?1:0)+airDisruptionPenalty(scene,a)});
   const hit=resolveHitCoins({...w.p.projection,guidance:w.p.guidance,radarSuppressed:a.electronicState?.radarSuppressed??false,bonuses:modifiers.bonuses,penalties:modifiers.penalties},coin);w.g.remainingAmmo-=w.p.fullAmmoCost;w.g.lastUsedTurn=scene.turn.number;if(w.p.guidance==='ray')registerRayTarget(scene,{unitId:a.instanceId,targetId:b.instanceId},{turnNumber:scene.turn.number,phaseId:scene.turn.phaseId});
   if(flareBlocks(scene,b,w.p.guidance)){hit.hitCount=0;hit.flareBlocked=true;}
   const rule=parseDamageRule(w.e);let damage=0,normalCredits=0;if(rule.kind==='cannon'){for(let n=0;n<hit.hitCount;n++){const comparison=compareArmorGrades(w.p.penetration,b.snapshot.naval.armor),category=toss(coin)?comparison.category:'normal';normalCredits+=({major:9,penetration:3,normal:1,shatter:0})[category];}}else damage=resolveNumericDamage({powerRule:w.e.powerRule,hitCount:hit.hitCount,penetration:w.p.penetration,armor:b.snapshot.naval.armor,strength:0,strengthRemaining:0,inertial:w.p.guidance==='inertial'}).hpDamage;
   applications.push({targetId:b.instanceId,hit:hit.hitCount>0,damage,normalCredits});shots.push({actorId:a.instanceId,targetId:b.instanceId,groupId:w.g.id,role:actualRole,weaponName:w.e.name,disruptionPenalty:airDisruptionPenalty(scene,a),hitCount:hit.hitCount,ammoCost:w.p.fullAmmoCost,hit});
  }
 }return{shots,applications};
}
function applyFire(scene,fire){
 const applications=[];for(const hit of fire.applications){const p=scene.instances.find(p=>p.instanceId===hit.targetId),s=ensureAircraftRuntime(p),credits=(s.normalHitRemainder??0)+hit.normalCredits;const result=applyAircraftHit(p,{hit:hit.hit,durabilityDamage:hit.damage+Math.floor(credits/3)});s.normalHitRemainder=credits%3;applications.push(result);}return applications;
}
function hiddenFrom(scene,squad,opponents,views){if(!squad.length||!opponents.length)return false;const view=views.get(opponents[0].side);return squad.every(p=>!view.get(p.instanceId));}
export function resolveAirCombat(scene,coin=randomCoin,{prevalidated=false}={}){
 initializeAirTraining(scene);if(!prevalidated)preflightAirCombat(scene);initializeRayTargetRuntime(scene);const r=initializeAirCombat(scene),current=r.commands.filter(c=>c.turnNumber===scene.turn.number&&c.phaseId===scene.turn.phaseId),reports=[],seen=new Set();
 for(const c of current){
  const key=[c.actorIds.slice().sort().join('|'),c.targetIds.slice().sort().join('|')].sort().join('::');if(seen.has(key))continue;seen.add(key);
  const actors=planesFor(scene,c.actorIds),targets=planesFor(scene,c.targetIds),witnesses={},views=new Map();
  for(const side of new Set([...actors,...targets].map(p=>p.side))){const view=getVisibility({...scene,controls:{...scene.controls,observationSide:side,enemyAutonomy:false}},new Set([...c.actorIds,...c.targetIds]));views.set(side,view);witnesses[side]=[...actors,...targets].filter(p=>p.side===side||view.get(p.instanceId)==='identified').map(p=>p.instanceId);}
  const plan=buildAirEngagements(actors,targets,coin),encounters=[plan.squads[0].map(()=>0),plan.squads[1].map(()=>0)],duels=[];
  for(const edge of plan.edges){
   const original=[plan.squads[0][edge.left],plan.squads[1][edge.right]],before=original.map(team=>new Set(team.filter(p=>p.aircraftState.status==='destroyed').map(p=>p.instanceId)));
   let left=original[0].filter(p=>p.aircraftState.status!=='destroyed'),right=original[1].filter(p=>p.aircraftState.status!=='destroyed');if(!left.length||!right.length)continue;
   const duel={left:left.map(p=>p.instanceId),right:right.map(p=>p.instanceId),ambush:[],shots:[],applications:[]};
   const ambushers=[canAmbush(scene,left)&&hiddenFrom(scene,left,right,views),canAmbush(scene,right)&&hiddenFrom(scene,right,left,views)];
   for(const [index,shooters,opponents]of [[0,left,right],[1,right,left]])if(ambushers[index]){const fire=fireWeapons(scene,shooters,opponents,'主動武器',coin);if(fire.shots.length){markAmbush(scene,shooters);duel.ambush.push({side:index,shots:fire.shots});duel.shots.push(...fire.shots.map(s=>({...s,ambush:true})));duel.applications.push(...applyFire(scene,fire));}}
   left=left.filter(p=>p.aircraftState.status!=='destroyed');right=right.filter(p=>p.aircraftState.status!=='destroyed');
   const a=readiness(left,encounters[0][edge.left]++,coin),b=readiness(right,encounters[1][edge.right]++,coin);duel.readiness=[a,b];
   if(!left.length||!right.length||!a.normal&&!b.normal){duel.skipped=true;duel.reason=!left.length||!right.length?'ambush-eliminated-opponent':'both-unable-to-engage';}
   else{
    const rolls=[{dice:[],fixedHeads:0,fixedTails:0},{dice:[],fixedHeads:0,fixedTails:0}];
    if(a.normal&&b.normal)for(const [side,squad]of [[0,left],[1,right]])rolls[side]=rollManeuver(squad[0],maneuverDice(squad[0].snapshot.aircraft),coin);
    const dice=rolls.map(r=>r.dice),heads=dice.map(list=>list.filter(Boolean).length),outcome=!a.normal?'right':!b.normal?'left':heads[0]===heads[1]?'tie':heads[0]>heads[1]?'left':'right';
    const fireA=fireWeapons(scene,left,right,outcome==='right'?'自衛武器':'主動武器',coin),fireB=fireWeapons(scene,right,left,outcome==='left'?'自衛武器':'主動武器',coin);
    duel.applications.push(...applyFire(scene,{applications:[...fireA.applications,...fireB.applications]}));duel.shots.push(...fireA.shots,...fireB.shots);Object.assign(duel,{dice,heads,outcome,maneuver:rolls});
   }
   duel.aceLosses=resolveAceLosses(scene,coin);
   duel.panic=original.flatMap((team,i)=>applySquadPanic(team,{lost:team.filter(p=>p.aircraftState.status==='destroyed'&&!before[i].has(p.instanceId)).length,defeated:duel.outcome===(i===0?'right':'left')},coin));
   if(duel.skipped&&!duel.shots.length)delete duel.shots;
   duels.push(duel);
  }
  reports.push({id:c.id,turnNumber:c.turnNumber,phaseId:c.phaseId,actorIds:c.actorIds,targetIds:c.targetIds,witnesses,squads:plan.squads.map(side=>side.map(team=>team.map(p=>p.instanceId))),duels});
 }
 r.commands=r.commands.filter(c=>!current.includes(c));r.records.push(...reports);return reports;
}
