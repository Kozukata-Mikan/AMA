import {blastRadius,blastUnitPoint} from './blast-area.js?v=electronic-ballistic-1';
import {ensureShipRuntime} from './ship-runtime.js?v=electronic-ballistic-1';
import {ensureUnitCombatRuntime} from './equipment-runtime.js?v=electronic-ballistic-1';
const clone=value=>JSON.parse(JSON.stringify(value));
export function initializeProjectiles(scene){
 for(const u of scene.instances){const p=u.projectileState;if(!p)continue;
  if(p.version!==1||!Number.isFinite(p.apex)||p.apex<200||p.apex>300||u.branch!=='navy'||!['flying','destroyed','impacted'].includes(p.status)||!Number.isSafeInteger(p.launchTurn)||p.launchTurn<1||p.launchTurn>scene.turn.number||p.dueTurn!==p.launchTurn+1||!/^order-[1-5]$|^pas$/.test(p.duePhase)||!['x','y','z'].every(k=>Number.isFinite(p.center?.[k]))||!p.weapon||p.weapon.guidance!=='慣性')throw Error('弾道弾の保存状態が不正です。');
  if(p.status==='flying'&&u.currentHp<=0){p.status='destroyed';u.shipState.status='sunk';}
 }
}
export function launchProjectiles(scene,entries,coin=Math.random){
 const reports=[];
 for(const e of entries){if(!e.profile.large)continue;
  const actor=scene.instances.find(u=>u.instanceId===e.unitId),group=actor.equipmentState.groups.find(g=>g.id===e.groupId),original=actor.snapshot.equipmentSnapshots.find(w=>w.id===group.equipmentId);
  const id='ballistic:'+e.commandId;if(scene.instances.some(u=>u.instanceId===id))throw Error('弾道弾の発射記録が重複しています。');
  // Ten independent bits choose an apex in the inclusive 200–300 altitude band.
  let bits=0;for(let i=0;i<10;i++){const value=coin();if(typeof value!=='boolean'&&typeof value!=='number')throw Error('弾道弾の軌道乱数が不正です。');bits=bits*2+(typeof value==='boolean'?Number(value):value>=.5?1:0);}
  const radius=blastRadius(e.profile.penetration),from=blastUnitPoint(scene,actor),center=clone(e.area.center),altitude=200+bits%101;
  const weapon={...clone(original),id:id+':warhead',name:original.name+'（着弾）',guidance:'慣性',targetScope:'範囲（全体）',range:1000000,ceilingU:1000000,maxOrder:scene.turn.phaseId==='pas'?'PAS':scene.turn.phaseId.slice(6),ammo:e.ammoCost};
  const u={instanceId:id,unitId:id,name:original.name+'・弾道弾',branch:'navy',side:actor.side,faction:actor.faction??'none',sizeLevel:1,x:(from.x+center.x)/2,y:(from.y+center.y)/2,altitude,heading:Math.atan2(center.x-from.x,from.y-center.y)*180/Math.PI,groupId:null,underwater:false,depth:0,currentHp:radius,snapshot:{id,name:original.name+'・弾道弾',branch:'navy',maxHp:Math.max(radius,.5),trainingTraits:[],naval:{kind:'air',type:'弾道弾',strength:0,detection:'E',seaRecon:'F',airRecon:'F',armor:'0',speedKnots:0,endurance:0},mounts:[{equipmentId:weapon.id,position:'中部①',count:1}],equipmentSnapshots:[weapon]},projectileState:{version:1,status:radius>0?'flying':'destroyed',launchTurn:scene.turn.number,dueTurn:scene.turn.number+1,duePhase:scene.turn.phaseId,sourceId:actor.instanceId,sourceName:actor.name,launchPoint:from,center,apex:altitude,weapon}};
  ensureShipRuntime(u);ensureUnitCombatRuntime(u);if(radius===0)u.shipState.status='sunk';scene.instances.push(u);reports.push({projectileId:id,sourceId:actor.instanceId,side:actor.side,center,altitude,hp:radius,dueTurn:u.projectileState.dueTurn,duePhase:u.projectileState.duePhase});
 }
 return reports;
}
export function dueProjectiles(scene){initializeProjectiles(scene);return scene.instances.filter(u=>u.projectileState?.status==='flying'&&u.projectileState.dueTurn===scene.turn.number&&u.projectileState.duePhase===scene.turn.phaseId);}
export function markProjectileImpacts(scene,ids){for(const id of ids){const u=scene.instances.find(u=>u.instanceId===id);u.currentHp=0;u.shipState.status='sunk';u.projectileState.status='impacted';}}
