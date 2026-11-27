import {navalKind} from './naval-kind.js';
export const AIR_ATTACK_MODES=[['glide','滑降攻撃',1,0,30],['dive','急降下爆撃',0,0,30],['torpedo','雷撃',1,0,10],['level','水平爆撃',2,30,100],['high','高高度爆撃',3,100,Infinity],['bvr','視程外攻撃',0,-Infinity,Infinity]];
export const airborneUnit=u=>u?.branch==='air'||u?.branch==='navy'&&navalKind(u)==='air';
export const surfaceTarget=u=>!airborneUnit(u);
export function airAttackModes(unit){return unit?.branch==='air'?(unit.snapshot?.aircraft?.attackModes??[]):AIR_ATTACK_MODES.map(m=>m[0]);}
export function checkAirAttackMode(actor,target,id,fromHeight,toHeight){
 if(!airborneUnit(actor)||!surfaceTarget(target))return {penalty:0};
 const mode=AIR_ATTACK_MODES.find(m=>m[0]===id);
 if(!mode||!airAttackModes(actor).includes(id))throw Error('機体が使用できる対地・対艦攻撃方式を選択してください。');
 const delta=fromHeight-toHeight;
 if(id!=='bvr'&&(delta<0||delta<mode[3]||delta>mode[4]||['level','high'].includes(id)&&delta===mode[3])){const e=Error(`${mode[1]}：目標との高度差が使用条件を満たしていません。`);e.code='TARGET_INELIGIBLE';e.skipAttack=true;throw e;}
 return {penalty:mode[2],heightDifference:delta,label:mode[1]};
}
export const ARMOR_OPTIONS=['0',...['F','E','D','C','B','A','S'].flatMap(g=>['--','-','','+','++'].map(s=>g+s)).concat('U')];
