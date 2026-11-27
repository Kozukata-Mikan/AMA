import {createShipEffectsState,validateShipEffectsState,resolveShipEffectAcquisition,resolveShipDamageControlPhase} from './ship-effects-runtime.js?v=support-stations-1';
const fail=m=>{throw Error(m);};
export const buildingAlive=u=>u?.branch==='building'&&(u.buildingState?.version===2?u.buildingState.status==='intact':u.currentHp>0);
export const buildingMountAvailable=(u,index)=>u?.branch!=='building'||buildingAlive(u)&&(!u.buildingState?.slots||u.buildingState.slots.find(s=>s.mountIndex===index||u.snapshot.mounts[index]?.position==='中心'&&s.position==='中心')?.hp>0);
export function ensureBuildingState(u){
 if(u.branch!=='building')return;
 const mounts=u.snapshot.mounts??[],centers=mounts.flatMap((m,i)=>m.position==='中心'?[i]:[]);
 const layout=mounts.flatMap((m,i)=>m.position==='中心'&&i!==centers[0]?[]:[{id:`mount-${i}`,mountIndex:i,position:m.position==='中心'?'中心':m.position==='地下'?'地下':'露天'}]);if(!centers.length)layout.push({id:'center',mountIndex:null,position:'中心'});
 const base=Math.floor(u.snapshot.maxHp/layout.length),remainder=u.snapshot.maxHp%layout.length;
 if(!u.buildingState||u.buildingState.version===1){
  const old=u.buildingState,slots=layout.map(s=>({...s,maxHp:base+(s.position==='中心'?remainder:0),hp:base+(s.position==='中心'?remainder:0),normalHitRemainder:0,effects:createShipEffectsState()}));
  let loss=u.snapshot.maxHp-u.currentHp;if(!Number.isSafeInteger(loss)||loss<0)fail('建築の現在耐性が不正です。');
  // 旧存档没有部位历史，确定性迁移；不重掷命中，不恢复已损失耐性。
  for(const s of [...slots.filter(s=>s.position!=='中心'),...slots.filter(s=>s.position==='中心')]){const n=Math.min(loss,s.hp);s.hp-=n;loss-=n;}
  u.buildingState={version:2,status:'intact',slots,normalHitRemainder:0,underwaterStrengthUses:old?.underwaterStrengthUses??0,lastRecoveryTurn:0};syncBuilding(u);
 }
 const state=u.buildingState;if(state.version!==2||!['intact','rebuilding','destroyed'].includes(state.status)||!Array.isArray(state.slots)||state.slots.length!==layout.length||!Number.isSafeInteger(state.lastRecoveryTurn)||state.lastRecoveryTurn<0||!Number.isSafeInteger(state.underwaterStrengthUses)||state.underwaterStrengthUses<0)fail('建築の部位保存状態が不正です。');
 state.slots.forEach((s,i)=>{const l=layout[i],maxHp=base+(l.position==='中心'?remainder:0);if(s.id!==l.id||s.mountIndex!==l.mountIndex||s.position!==l.position||s.maxHp!==maxHp||!Number.isSafeInteger(s.hp)||s.hp<0||s.hp>maxHp||!Number.isSafeInteger(s.normalHitRemainder)||s.normalHitRemainder<0||s.normalHitRemainder>2)fail('建築の配置耐性が不正です。');validateShipEffectsState(s.effects);});
 if(u.currentHp!==state.slots.reduce((n,s)=>n+s.hp,0))fail('建築の合計耐性と配置耐性が一致しません。');
 const c=state.slots.find(s=>s.position==='中心');if(state.status==='intact'&&c.hp===0||state.status==='rebuilding'&&(u.snapshot.building?.permanence!=='permanent'||c.hp>=c.maxHp)||state.status==='destroyed'&&(c.hp!==0||u.snapshot.building?.permanence==='permanent'))fail('建築の中心状態が不正です。');
 return state;
}
export function syncBuilding(u){const state=u.buildingState,c=state.slots.find(s=>s.position==='中心');if(c.hp===0)state.status=u.snapshot.building?.permanence==='permanent'?'rebuilding':'destroyed';u.currentHp=state.slots.reduce((n,s)=>n+s.hp,0);}
export function chooseBuildingSlot(u,coin=()=>Boolean(crypto.getRandomValues(new Uint32Array(1))[0]&1)){
 ensureBuildingState(u);const slots=u.buildingState.slots;if(slots.length===1)return slots[0];const bits=Math.ceil(Math.log2(slots.length));for(let attempt=0;attempt<1000;attempt++){let n=0;for(let i=0;i<bits;i++){const head=coin();if(typeof head!=='boolean')fail('配置抽選のコインが不正です。');n=n*2+Number(head);}if(n<slots.length)return slots[n];}fail('配置抽選が収束しませんでした。');
}
export function applyBuildingHits(u,hits,context,coin){
 ensureBuildingState(u);const reports=[];for(const hit of hits){const s=u.buildingState.slots.find(s=>s.id===hit.mountId);if(!s)fail('被弾した建築配置がありません。');const before=s.hp;
  let damage=hit.damage??0;if(hit.normalCredits!==undefined){const credits=s.normalHitRemainder+hit.normalCredits;damage+=Math.floor(credits/3);s.normalHitRemainder=credits%3;}
  if(!Number.isSafeInteger(damage)||damage<0)fail('配置への被害値が不正です。');s.hp=Math.max(0,s.hp-damage);
  if(hit.fireEligible&&s.hp>0){const r=resolveShipEffectAcquisition({state:s.effects,type:'fire',turnNumber:context.turnNumber},coin);s.effects=r.state;}
  if(s.hp===0)s.effects.fire=null;reports.push({mountId:s.id,beforeHp:before,afterHp:s.hp,hpDamage:before-s.hp});
 }syncBuilding(u);return reports;
}
export function recoverBuildingAtStart(u,turn){
 const s=ensureBuildingState(u);if(!s||s.lastRecoveryTurn>=turn)return[];s.lastRecoveryTurn=turn;const reports=[],center=s.slots.find(p=>p.position==='中心');
 if(s.status==='rebuilding'){const before=center.hp;center.hp=Math.min(center.maxHp,center.hp+1);if(center.hp===center.maxHp)s.status='intact';reports.push({mountId:center.id,before,after:center.hp});}
 else if(s.status==='intact')for(const slot of s.slots){if(slot.position==='中心'||slot.hp===slot.maxHp)continue;const before=slot.hp;slot.hp=Math.min(slot.maxHp,slot.hp+1);reports.push({mountId:slot.id,before,after:slot.hp});}
 syncBuilding(u);return reports;
}
export function resolveBuildingFire(u,turn,coin){
 const s=ensureBuildingState(u),reports=[];for(const slot of s.slots){if(slot.hp===0||!slot.effects.fire)continue;const result=resolveShipDamageControlPhase({state:slot.effects,turnNumber:turn,damagedEquipmentIds:[]},{coinSource:coin});slot.effects=result.state;const before=slot.hp;for(const event of result.events)if(event.type==='fire-hp-damage')slot.hp=Math.max(0,slot.hp-event.amount);if(slot.hp===0)slot.effects.fire=null;reports.push({mountId:slot.id,beforeHp:before,afterHp:slot.hp,...result});}syncBuilding(u);return reports;
}
