import {getTimePeriod,normalizeEnvironment} from './environment-data.js';
import {supportCapacity} from './support-equipment.js?v=air-combat-1';
export const nightObservation=u=>supportCapacity(u,'night-observation')>0;
export const aviationPeriod=scene=>getTimePeriod(normalizeEnvironment(scene.environment).time).id;
export const aircraftMayFly=(scene,plane)=>nightObservation(plane)||['day','dusk'].includes(aviationPeriod(scene));
export function assertAircraftPreparationTime(scene,plane,host){if(aviationPeriod(scene)==='night'&&!nightObservation(plane)&&!nightObservation(host))throw Error('黒夜は整備できません。機体または母艦・施設に夜間観測を装備してください。');}
export function assertAircraftLaunchTime(scene,plane){if(aviationPeriod(scene)!=='day'&&!nightObservation(plane))throw Error('離陸は白昼のみです。夜間観測を装備した機体は全時間帯に離陸できます。');}
export function assertAircraftLandingTime(scene,plane){if(!aircraftMayFly(scene,plane))throw Error('黎明・黒夜の着陸には機体の夜間観測が必要です。');}
export function crashAircraftAfterDusk(scene,nextEnvironment){
 if(getTimePeriod(nextEnvironment.time).id!=='night')return[];const reports=[];
 for(const u of scene.instances){const s=u.aircraftState;if(u.branch!=='air'||!s||s.status==='destroyed'||!['airborne','landing'].includes(s.mission)||nightObservation(u))continue;s.remainingAirTime=0;s.status='destroyed';s.destroyedReason='night-flight-prohibited';u.currentHp=0;reports.push({aircraftId:u.instanceId,reason:s.destroyedReason});}return reports;
}
