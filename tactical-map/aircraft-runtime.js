import {airDisruptionPenalty} from './air-disruption.js?v=air-defense-1';
import {airConfused,airRetreating,airTrainingRule,hasAirTrait} from './air-training-runtime.js?v=air-training-1';
import {validateFlightPlan} from './flight-plan-data.js';
import {normalizeAircraft,aircraftAirTime,parseAircraftEndurance} from '../js/aircraft-template.js?v=air-training-1';
import {TURN_DURATION_MINUTES} from './rules-engine.js';
export const hasAircraftTemplate=unit=>unit?.branch==='air'&&unit.snapshot?.aircraft?.version===1;
const fail=message=>{throw new Error(message);};
export function readAircraftProfile(unit){
 if(!hasAircraftTemplate(unit))fail('航空機テンプレートが登録されていません。');
 const data=unit.snapshot.aircraft,stats=unit.snapshot.naval??{};
 const maximumAirTime=aircraftAirTime(stats.endurance,stats.speedKnots);
 if(maximumAirTime===null||data.ceiling===null)fail(`${unit.name}：最高速度・航続力・上昇限度を登録してください。`);
 const movementLimit=Math.floor(stats.speedKnots*1.852/.4),enduranceBudget=Math.floor(parseAircraftEndurance(stats.endurance)*1.852/.4);
 if(!Number.isSafeInteger(movementLimit)||!Number.isSafeInteger(enduranceBudget))fail('航空機の距離換算が範囲外です。');
 return{...data,maxHp:data.engines,parkingSlots:data.engines,maximumAirTime,
  movementLimit,enduranceBudget};
}
export function normalizeAircraftPosition(unit){
 if(!hasAircraftTemplate(unit))return unit;
 const data=normalizeAircraft(unit.snapshot.aircraft);
 if(unit.snapshot.maxHp!==data.engines)fail('航空機の最大耐性と発動機数が一致しません。');
 if(!Number.isFinite(unit.currentHp)||unit.currentHp<0||unit.currentHp>data.engines)fail('航空機の現在耐性が不正です。');
 const altitude=unit.altitude??Math.min(80,data.ceiling??80);
 if(!Number.isFinite(altitude)||altitude<1||(data.ceiling!==null&&altitude>data.ceiling))fail('航空機の高度は1以上、上昇限度以下で指定してください。');
 unit.altitude=altitude;unit.underwater=false;unit.depth=0;return unit;
}
export function ensureAircraftRuntime(unit){
 if(!hasAircraftTemplate(unit))return null;
 normalizeAircraftPosition(unit);const profile=readAircraftProfile(unit);
 unit.aircraftState??={version:1,status:unit.currentHp===0?'heavy':'operational',mission:'airborne',remainingAirTime:profile.maximumAirTime,remainingEndurance:profile.enduranceBudget,lastElapsedTurn:0,activeLoadoutId:null,destroyedReason:null};
 const s=unit.aircraftState;
 if(s.deckZone!==undefined&&!['hangar','preparation','runway'].includes(s.deckZone))fail('航空管制盤の配置状態が不正です。');
 validateFlightPlan(s.flightPlan);
 if(s.disruption&&(!Number.isSafeInteger(s.disruption.turnNumber)||s.disruption.turnNumber<1||!Number.isSafeInteger(s.disruption.penalties)||s.disruption.penalties<0))fail('航空機の対空妨害状態が不正です。');
 if(s.panic&&(!Number.isSafeInteger(s.panic.count)||s.panic.count<0||!['normal','confused','retreating'].includes(s.panic.state)))fail('航空機の恐慌状態が不正です。');
 if(s.navigationLossTurn!==undefined&&(!Number.isSafeInteger(s.navigationLossTurn)||s.navigationLossTurn<1))fail('迷航判定の保存状態が不正です。');
 if(s.emergencyLanding&&(typeof s.emergencyLanding.success!=='boolean'||!Number.isSafeInteger(s.emergencyLanding.turnNumber)||s.emergencyLanding.turnNumber<1||typeof s.emergencyLanding.hostId!=='string'||typeof s.emergencyLanding.runwayId!=='string'))fail('不時着判定の保存状態が不正です。');
 s.normalHitRemainder??=0;s.underwaterStrengthUses??=0;
 if(s.normalHitRemainder!==undefined&&(!Number.isSafeInteger(s.normalHitRemainder)||s.normalHitRemainder<0||s.normalHitRemainder>2))fail('航空機の通常命中蓄積が不正です。');
 if(s.version!==1||!['operational','heavy','destroyed'].includes(s.status)||!['airborne','parked','ready','launching','landing'].includes(s.mission)||!Number.isSafeInteger(s.remainingAirTime)||s.remainingAirTime<0||s.remainingAirTime>profile.maximumAirTime||!Number.isFinite(s.remainingEndurance)||s.remainingEndurance<0||s.remainingEndurance>profile.enduranceBudget||!Number.isSafeInteger(s.lastElapsedTurn)||s.lastElapsedTurn<0)fail('航空機の保存状態が不正です。');
 if((s.status==='operational'&&unit.currentHp===0)||(s.status!=='operational'&&unit.currentHp!==0))fail('航空機の損傷状態と耐性が一致しません。');
 if(s.status!=='destroyed'&&['parked','ready','launching','landing'].includes(s.mission)){if(typeof s.hostId!=='string'||!s.hostId)fail('駐機・起降中の母艦参照がありません。');if(['ready','launching'].includes(s.mission)&&(s.prepared!==true||typeof s.runwayId!=='string'))fail('滑走路待機機の整備記録が不正です。');if(['launching','landing'].includes(s.mission)&&(!Number.isSafeInteger(s.dueTurn)||s.dueTurn<1))fail('起降完了ラウンドが不正です。');}
 if(s.activeLoadoutId!==null&&!profile.loadouts.some(l=>l.id===s.activeLoadoutId))fail('航空機の搭載構成が資料にありません。');
 return s;
}
export function aircraftCanAct(unit,action){
 const state=unit.aircraftState;
 return hasAircraftTemplate(unit)&&Boolean(state)&&state.mission==='airborne'&&state.status!=='destroyed'&&(action==='move'||state?.status==='operational'&&(action!=='attack'||!airConfused(unit)&&!airRetreating(unit)));
}
export function applyAircraftHit(unit,{hit,durabilityDamage=0}){
 const s=ensureAircraftRuntime(unit);
 if(typeof hit!=='boolean'||!Number.isFinite(durabilityDamage)||durabilityDamage<0||(!hit&&durabilityDamage!==0))fail('航空機の命中・被害値が不正です。');
 const before={currentHp:unit.currentHp,status:s.status};
 if(hit&&s.status!=='destroyed'){
  if(s.status==='heavy'){s.status='destroyed';s.destroyedReason='shot-down';}
  else{unit.currentHp=Math.max(0,unit.currentHp-durabilityDamage);if(unit.currentHp===0)s.status='heavy';}
 }
 return{targetId:unit.instanceId,before,after:{currentHp:unit.currentHp,status:s.status}};
}
export function finishAircraftTurn(scene){
 const reports=[];
 for(const unit of scene.instances){
  if(!hasAircraftTemplate(unit))continue;
  const s=ensureAircraftRuntime(unit);
  if(s.lastElapsedTurn>scene.turn.number)fail('航空機の滞空履歴が未来になっています。');
  if(s.lastElapsedTurn===scene.turn.number)fail('このラウンドの滞空時間は処理済みです。');
  s.lastElapsedTurn=scene.turn.number;
  if(s.mission!=='airborne'||s.status==='destroyed')continue;
  const before=s.remainingAirTime;s.remainingAirTime=Math.max(0,before-1);
  if(s.remainingAirTime===0){s.status='destroyed';s.destroyedReason='air-time-expired';unit.currentHp=0;}
  reports.push({targetId:unit.instanceId,before,after:s.remainingAirTime,destroyed:s.status==='destroyed',elapsedMinutes:TURN_DURATION_MINUTES});
 }
 return reports;
}
export function aircraftTimerDisplay(unit){
 if(!unit.observationOwn||!hasAircraftTemplate(unit)||!unit.aircraftState||unit.aircraftState.mission!=='airborne'||unit.aircraftState.status==='destroyed')return null;
 const members=(unit.clusterMembers??[unit]).filter(u=>u.observationOwn&&hasAircraftTemplate(u)&&u.aircraftState?.mission==='airborne'&&u.aircraftState.status!=='destroyed');
 if(!members.length)return null;
 const times=members.map(u=>u.aircraftState.remainingAirTime),minimum=Math.min(...times),maximum=Math.max(...times);
 return{text:`滞空 ${minimum===maximum?minimum:minimum+'～'+maximum}R`,color:members.some(u=>u.aircraftState.remainingAirTime<readAircraftProfile(u).maximumAirTime/2)?'#ff4e68':'#d684ff'};
}
export function aircraftDetailLines(unit, turnNumber){
 if(!hasAircraftTemplate(unit))return[];
 const data=unit.snapshot.aircraft;
 const lines=[`発動機数 / 最大耐性：${data.engines} / 必要駐機枠：${data.engines}`,`乗員数：${data.crew}`,`機動性：${data.maneuverability||'未設定'} / 上昇限度：${data.ceiling??'未設定'}`,`最高速度：${unit.snapshot.naval?.speedKnots??'未設定'}ノット`];
 if(unit.observationOwn&&unit.aircraftState){const s=unit.aircraftState;const rule=airTrainingRule(unit);lines.push(`対空妨害：不利${airDisruptionPenalty({turn:{number:turnNumber}},unit)}（ラウンド終了まで）`,`練度：${rule.label} / 反応力${rule.reaction} / 機動修正${rule.maneuver>=0?'+':''}${rule.maneuver}`,`恐慌：${s.panic?.count??0} / 閾値${rule.panic} / ${({normal:'通常',confused:'混乱（自衛のみ）',retreating:'撤退'})[s.panic?.state??'normal']}`);if(s.acePilot)lines.push(`ACE：${s.acePilotName}${s.status==='destroyed'?'（戦死）':''}`);if(s.flightPlan)lines.push(`航空任務：${s.flightPlan.kind} / ${({outbound:'往路',attack:'攻撃待機',returning:'帰投中',complete:'完了'})[s.flightPlan.stage]}${s.flightPlan.notice?' / '+s.flightPlan.notice:''}`);lines.push(`状態：${({operational:'行動可能',heavy:'大破（移動のみ）',destroyed:'撃墜・墜落'})[s.status]}`,`残り滞空時間：${s.remainingAirTime}ラウンド / 残り航続距離：${s.remainingEndurance.toFixed(1)}マス`);}
 return lines;
}
