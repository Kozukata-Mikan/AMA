import {readShipProfile,applyShipDamageAttack} from './ship-runtime.js?v=facility-rules-1';
import {compareArmorGrades} from './armor-runtime.js';
export {ensureBuildingState as ensureBuildingCombatRuntime} from './building-state.js?v=facility-rules-1';
import {ensureBuildingState,applyBuildingHits,chooseBuildingSlot} from './building-state.js?v=facility-rules-1';
export function combatTargetState(unit){return unit.branch==='building'?unit.buildingState??{status:unit.currentHp===0?'destroyed':'intact',normalHitRemainder:0,underwaterStrengthUses:0}:unit.shipState;}
export function readCombatTargetProfile(unit){
 if(unit.branch!=='building')return readShipProfile(unit);
 const n=unit.snapshot.naval??{},strength=n.strength;
 if(!Number.isSafeInteger(strength)||strength<0||strength>7)throw Error(`${unit.name}：建築の強度は0～7で登録してください。`);
 compareArmorGrades('F',n.armor);
 return{maxHp:unit.snapshot.maxHp,strength,strengthArmor:['F','E','D','C','B','A','S','U'][strength],armor:n.armor};
}
export function applyCombatTargetDamage(unit,event,context){
 if(unit.branch!=='building')return applyShipDamageAttack(unit,event,context);
 ensureBuildingState(unit);const beforeHp=unit.currentHp,beforeState=structuredClone(unit.buildingState);
 const hits=event.buildingHits??[{mountId:chooseBuildingSlot(unit).id,damage:event.hpDamage}];
 const slots=applyBuildingHits(unit,hits,context,event.coinSource);
 return{version:2,targetId:unit.instanceId,attackId:event.attackId,turnNumber:context.turnNumber,phaseId:context.phaseId,beforeHp,afterHp:unit.currentHp,beforeState,afterState:structuredClone(unit.buildingState),hpDamage:beforeHp-unit.currentHp,hasDamageEffect:event.hasDamageEffect,sinkingStarted:null,slots};
}
export function aviationRandomCoin(){return Boolean(crypto.getRandomValues(new Uint32Array(1))[0]&1);}
export function buildingHitPosition(coin=aviationRandomCoin){const heads=coin();if(typeof heads!=='boolean')throw Error('部位判定のコインが不正です。');return heads?'露天':'地下';}
export function resolveBuildingCannonImpact({penetration,armor},coin=aviationRandomCoin,unit){
 const comparison=compareArmorGrades(penetration,armor),progressHeads=coin();if(typeof progressHeads!=='boolean')throw Error('命中後のコインが不正です。');const category=progressHeads?comparison.category:'normal',slot=unit?chooseBuildingSlot(unit,coin):null,label=slot?.position??buildingHitPosition(coin);
 return{version:1,comparison,progressHeads,progressLost:!progressHeads,originalCategory:category,waterCoins:[],waterHit:false,position:{id:slot?.id??(label==='露天'?'exposed':'underground'),label,mountId:slot?.id,overpenetration:false},finalCategory:category,finalLabel:({major:'大貫通',penetration:'貫通',normal:'通常命中',shatter:'破砕'})[category],normalCredits:({major:9,penetration:3,normal:1,shatter:0})[category],hasDamageEffect:category!=='shatter',fireEligible:['major','penetration'].includes(category)};
}
