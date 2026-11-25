import {supportCapacity} from './support-equipment.js?v=field-support-1';
import {buildingAlive,buildingMountAvailable,recoverBuildingAtStart} from './building-state.js?v=facility-rules-1';
import {hasAircraftTemplate,ensureAircraftRuntime} from './aircraft-runtime.js?v=air-losses-1';
import {navalKind} from './naval-kind.js';
export const serviceProviderAlive=u=>u&&Number.isFinite(u.x)&&Number.isFinite(u.y)&&(u.branch==='building'?buildingAlive(u):u.branch==='navy'?!['sinking','sunk'].includes(u.shipState?.status):hasAircraftTemplate(u)?u.aircraftState?.mission==='airborne'&&u.aircraftState.status==='operational':u.currentHp>0);
export function remoteStations(scene){
 const result=[];for(const u of scene.instances){if(!serviceProviderAlive(u))continue;const eq=new Map((u.snapshot.equipmentSnapshots??[]).map(e=>[e.id,e]));let radius=-1;
  for(const g of u.equipmentState?.groups??[]){const e=eq.get(g.equipmentId);if(e?.supportEffect!=='remote-station'||g.damaged||g.destroyed||!buildingMountAvailable(u,g.mountIndex))continue;if(Number.isFinite(e.remoteRange)&&e.remoteRange>=0)radius=Math.max(radius,e.remoteRange);}
  if(radius>=0)result.push({unitId:u.instanceId,side:u.side,x:u.x,y:u.y,radius});
 }return result;
}
export function enforceRemoteControl(scene){
 const drones=scene.instances.filter(p=>hasAircraftTemplate(p)&&['drone','land-drone'].includes(p.snapshot.aircraft.type)&&p.aircraftState?.mission==='airborne'&&p.aircraftState.status!=='destroyed');if(!drones.length)return[];const stations=remoteStations(scene),reports=[];
 for(const p of drones)if(!stations.some(s=>s.side===p.side&&Math.hypot(p.x-s.x,p.y-s.y)<=s.radius+1e-7)){if(p.aircraftState.remainingAirTime>0)reports.push({aircraftId:p.instanceId,kind:'remote-range-lost',turnNumber:scene.turn.number});p.aircraftState.remainingAirTime=0;p.aircraftState.remoteControlLost=true;}
 return reports;
}
export function repairAircraftAtStart(scene){
 const reports=[],byHost=new Map();for(const p of scene.instances){if(!hasAircraftTemplate(p)||!p.aircraftState?.hostId)continue;if(!byHost.has(p.aircraftState.hostId))byHost.set(p.aircraftState.hostId,[]);byHost.get(p.aircraftState.hostId).push(p);}
 for(const host of scene.instances){if(!serviceProviderAlive(host)||host.groundCrewLastTurn===scene.turn.number)continue;host.groundCrewLastTurn=scene.turn.number;let points=supportCapacity(host,'ground-crew');if(!points)continue;
  const planes=(byHost.get(host.instanceId)??[]).filter(p=>p.side===host.side&&p.aircraftState.status!=='destroyed'&&['parked','ready'].includes(p.aircraftState.mission)&&p.currentHp<p.snapshot.maxHp).sort((a,b)=>(a.snapshot.maxHp-a.currentHp)-(b.snapshot.maxHp-b.currentHp)||a.instanceId.localeCompare(b.instanceId));
  for(const p of planes){if(!points)break;const before=p.currentHp,restored=Math.min(points,p.snapshot.maxHp-p.currentHp);p.currentHp+=restored;points-=restored;Object.assign(p.aircraftState,{status:'operational',mission:'parked',prepared:false,runwayId:null,dueTurn:null});reports.push({hostId:host.instanceId,aircraftId:p.instanceId,before,after:p.currentHp});ensureAircraftRuntime(p);}
 }return reports;
}
export function advanceFacilityServices(scene){
 const buildingReports=[];for(const u of scene.instances)if(u.branch==='building')buildingReports.push({unitId:u.instanceId,repairs:recoverBuildingAtStart(u,scene.turn.number)});
 return {buildingReports,aircraftRepairs:repairAircraftAtStart(scene)};
}
export const isAirship=u=>u?.branch==='navy'&&navalKind(u)==='air';
export const isAirshipBase=u=>u?.branch==='building'&&u.snapshot.building?.kind==='airport'&&u.snapshot.building?.airportType==='airship';
// 圆域并集覆盖整段航路；端点在范围内但中途离开也会失联。
export function checkDroneRoute(scene,unit,route,stations=remoteStations(scene)){
 if(!hasAircraftTemplate(unit)||!['drone','land-drone'].includes(unit.snapshot.aircraft.type)||unit.aircraftState?.mission!=='airborne'||unit.aircraftState.status==='destroyed')return;
 const own=stations.filter(s=>s.side===unit.side);for(let i=1;i<(route?.length??0);i++){
  const a=route[i-1],b=route[i],dx=b.x-a.x,dy=b.y-a.y,A=dx*dx+dy*dy;if(A<1e-12)continue;const ranges=[];
  for(const s of own){const ox=a.x-s.x,oy=a.y-s.y,B=2*(ox*dx+oy*dy),C=ox*ox+oy*oy-s.radius*s.radius,D=B*B-4*A*C;if(D<0)continue;const root=Math.sqrt(D),lo=Math.max(0,(-B-root)/(2*A)),hi=Math.min(1,(-B+root)/(2*A));if(lo<=hi+1e-9)ranges.push([lo,hi]);}
  ranges.sort((a,b)=>a[0]-b[0]);let end=0;for(const [lo,hi] of ranges){if(lo>end+1e-9)break;end=Math.max(end,hi);}if(end<1-1e-9){unit.aircraftState.remainingAirTime=0;unit.aircraftState.remoteControlLost=true;break;}
 }
}
