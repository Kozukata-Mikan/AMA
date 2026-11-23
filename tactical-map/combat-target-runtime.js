import {readShipProfile,applyShipDamageAttack} from './ship-runtime.js?v=aviation-operations-1';
import {compareArmorGrades} from './armor-runtime.js';
export function ensureBuildingCombatRuntime(unit){
 if(unit.branch!=='building')return;
 unit.buildingState??={version:1,status:unit.currentHp===0?'destroyed':'intact',normalHitRemainder:0,underwaterStrengthUses:0};const s=unit.buildingState;
 if(s.version!==1||!['intact','destroyed'].includes(s.status)||!Number.isSafeInteger(s.normalHitRemainder)||s.normalHitRemainder<0||s.normalHitRemainder>2||!Number.isSafeInteger(s.underwaterStrengthUses)||s.underwaterStrengthUses<0||(s.status==='destroyed')!==(unit.currentHp===0))throw Error('建築の被害保存状態が不正です。');
}
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
 ensureBuildingCombatRuntime(unit);const beforeHp=unit.currentHp,beforeState=structuredClone(unit.buildingState);
 if(!Number.isSafeInteger(event.hpDamage)||event.hpDamage<0)throw Error('建築への被害値が不正です。');
 unit.currentHp=Math.max(0,beforeHp-event.hpDamage);unit.buildingState.normalHitRemainder=event.normalHitRemainder??unit.buildingState.normalHitRemainder;unit.buildingState.status=unit.currentHp===0?'destroyed':'intact';
 return{version:1,targetId:unit.instanceId,attackId:event.attackId,turnNumber:context.turnNumber,phaseId:context.phaseId,beforeHp,afterHp:unit.currentHp,beforeState,afterState:structuredClone(unit.buildingState),hpDamage:event.hpDamage,hasDamageEffect:event.hasDamageEffect,sinkingStarted:null};
}
export function aviationRandomCoin(){return Boolean(crypto.getRandomValues(new Uint32Array(1))[0]&1);}
export function buildingHitPosition(coin=aviationRandomCoin){const heads=coin();if(typeof heads!=='boolean')throw Error('部位判定のコインが不正です。');return heads?'露天':'地下';}
export function resolveBuildingCannonImpact({penetration,armor},coin=aviationRandomCoin){
 const comparison=compareArmorGrades(penetration,armor),progressHeads=coin();if(typeof progressHeads!=='boolean')throw Error('命中後のコインが不正です。');const category=progressHeads?comparison.category:'normal',label=buildingHitPosition(coin);
 return{version:1,comparison,progressHeads,progressLost:!progressHeads,originalCategory:category,waterCoins:[],waterHit:false,position:{id:label==='露天'?'exposed':'underground',label,overpenetration:false},finalCategory:category,finalLabel:({major:'大貫通',penetration:'貫通',normal:'通常命中',shatter:'破砕'})[category],normalCredits:({major:9,penetration:3,normal:1,shatter:0})[category],hasDamageEffect:category!=='shatter',fireEligible:false};
}
