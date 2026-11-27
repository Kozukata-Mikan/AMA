import {readPenetrationGrade} from './armor-runtime.js';
import {sampleTerrain} from './terrain-data.js';
import {navalHeight} from './naval-kind.js?v=catalog-layout-2';
import {expandFormationMemberIds} from './formation-target-runtime.js?v=electronic-ballistic-1';
import {formationCenter} from './formation-layout.js';
export function blastRadius(penetration){const grade=readPenetrationGrade(penetration).grade;return grade===null?0:({U:6,S:5,A:4,B:3,C:2,D:1,E:.5,F:.5})[grade];}
export function blastUnitPoint(scene,unit){const ground=sampleTerrain(scene.terrain,unit.x,unit.y);return{x:unit.x,y:unit.y,z:unit.branch==='building'?ground.surface:unit.branch==='air'?unit.altitude:navalHeight(unit,ground)};}
export function readBlastPoint(ref){if(!ref||ref.kind!=='point'||!['x','y','z'].every(k=>Number.isFinite(ref[k])))throw Error('爆心のX・Y・Zを有限の数値で指定してください。');return{kind:'point',x:ref.x,y:ref.y,z:ref.z};}
export function blastCenter(scene,ref){
 let center;
 if(ref.kind==='point')center=readBlastPoint(ref);
 else{const members=expandFormationMemberIds(scene,ref).map(id=>scene.instances.find(u=>u.instanceId===id));if(ref.kind==='unit')center=blastUnitPoint(scene,members[0]);else{const formation=scene.groups.find(g=>g.id===ref.id)?.formation;const xy=formation?formationCenter(members,formation):{x:members.reduce((n,u)=>n+u.x,0)/members.length,y:members.reduce((n,u)=>n+u.y,0)/members.length};center={...xy,z:members.reduce((sum,u)=>sum+blastUnitPoint(scene,u).z,0)/members.length};}}
 const {x,y,z}=center;if(!sampleTerrain(scene.terrain,x,y).inside)throw Error('爆心を地図内に指定してください。');
 return{x,y,z};
}
export function blastArea(scene,ref,penetration){
 const {x,y,z}=blastCenter(scene,ref),radius=blastRadius(penetration);
 const memberIds=scene.instances.filter(u=>['navy','building','air'].includes(u.branch)&&Number.isFinite(u.x)&&Number.isFinite(u.y)&&u.shipState?.status!=='sunk'&&u.aircraftState?.status!=='destroyed'&&(u.branch!=='building'||u.currentHp>0)&&(u.branch!=='air'||['airborne','landing'].includes(u.aircraftState?.mission))).filter(u=>{const p=blastUnitPoint(scene,u);return Math.hypot(p.x-x,p.y-y,p.z-z)<=radius+1e-7;}).map(u=>u.instanceId).sort();
 return{center:{x,y,z},radius,memberIds};
}
