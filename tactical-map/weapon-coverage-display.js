import {readWeaponProfile} from './weapon-profile-runtime.js?v=air-combat-1';
import {firingArcDefinition} from './weapon-firing-arc.js?v=air-combat-1';
import {buildingMountAvailable} from './building-state.js?v=facility-rules-1';
import {activeAircraftMounts} from '../js/aircraft-template.js?v=facility-rules-1';
import {sampleTerrain} from './terrain-data.js';import {navalHeight} from './naval-kind.js';
export const COVERAGE_COLORS=['#69d6ff','#ffce70','#bba1ff','#79e4af','#ff94c5','#ffa66d'];
export function weaponCoverage(scene,selection,issues=[]){
 const ids=selection?.kind==='group'?new Set(scene.instances.filter(u=>u.groupId===selection.id).map(u=>u.instanceId)):new Set([selection?.id]);const records=[],seen=new Set();
 for(const u of scene.instances){if(!ids.has(u.instanceId)||u.observationLevel==='shadow'||!Number.isFinite(u.x)||!Number.isFinite(u.y)||u.aviationStored)continue;const equipment=new Map((u.snapshot?.equipmentSnapshots??[]).map(e=>[e.id,e]));
  for(const [index,mount]of activeAircraftMounts(u).entries()){const e=equipment.get(mount.equipmentId);if(e?.kind!=='weapon')continue;const profile=readWeaponProfile(e);if(!Number.isFinite(profile.range)||profile.range<0){issues.push(`${u.name} / ${e.name}：射距が未登録のため表示できません。`);continue;}let arc;try{arc=firingArcDefinition(u,mount.position);}catch{issues.push(`${u.name} / ${e.name}：装備位置の射界が未定義です。`);continue;}
   const groups=u.equipmentState?.groups?.filter(g=>g.mountIndex===index),available=buildingMountAvailable(u,index)&&(!groups?.length||groups.some(g=>!g.damaged&&!g.destroyed&&g.remainingAmmo!==0));
   const z=u.branch==='building'?sampleTerrain(scene.terrain,u.x,u.y).surface:u.branch==='air'?u.altitude:navalHeight(u,sampleTerrain(scene.terrain,u.x,u.y));const key=JSON.stringify([u.x,u.y,z,u.heading,e.id,mount.position,profile.range,available]);if(seen.has(key))continue;seen.add(key);
   records.push({unitId:u.instanceId,name:e.name,position:mount.position,range:profile.range,pas:profile.pasOnly,available,x:u.x,y:u.y,z,heading:u.heading??0,...arc});
  }
 }return records.map((r,i)=>({...r,color:r.available?COVERAGE_COLORS[i%COVERAGE_COLORS.length]:'#84929b'}));
}
export function coveragePoints(record){
 const half=record.half,points=half<180?[{x:record.x,y:record.y,z:record.z}]:[];const steps=Math.max(24,Math.ceil(half/3));
 for(let i=0;i<=steps;i++){const angle=(record.heading+record.center-half+2*half*i/steps)*Math.PI/180;points.push({x:record.x+Math.sin(angle)*record.range,y:record.y-Math.cos(angle)*record.range,z:record.z});}return points;
}
export function drawWeaponCoverage(parent,scene,project,selection){
 parent.querySelector('.weapon-coverage-overlay')?.remove();const ns='http://www.w3.org/2000/svg',layer=document.createElementNS(ns,'g');layer.setAttribute('class','weapon-coverage-overlay');layer.setAttribute('pointer-events','none');parent.prepend(layer);const issues=[],records=weaponCoverage(scene,selection,issues);
 for(const [i,r]of records.entries()){const color=r.color,polygon=document.createElementNS(ns,'polygon');polygon.setAttribute('points',coveragePoints(r).map(p=>{const q=project(p.x,p.y,p.z);return`${q.x},${q.y}`;}).join(' '));polygon.setAttribute('fill',color);polygon.setAttribute('fill-opacity','.035');polygon.setAttribute('stroke',color);polygon.setAttribute('stroke-opacity','.75');polygon.setAttribute('stroke-width','1.2');polygon.setAttribute('stroke-dasharray',r.available?(r.pas?'3 3':'8 3'):'2 5');polygon.setAttribute('vector-effect','non-scaling-stroke');const title=document.createElementNS(ns,'title');title.textContent=`${r.name} / ${r.position} / 射距 ${r.range}${r.pas?' / PAS自動射撃':''}${r.available?'':' / 現在使用不可'}`;polygon.append(title);layer.append(polygon);}
 return{records,issues};
}
