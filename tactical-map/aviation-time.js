import {hasAirTrait} from './air-training-runtime.js?v=air-training-1';
import {getTimePeriod,normalizeEnvironment,getWeatherInfo} from './environment-data.js';
import {supportCapacity} from './support-equipment.js?v=air-training-1';
export const nightObservation=u=>supportCapacity(u,'night-observation')>0;
export const aviationPeriod=scene=>getTimePeriod(normalizeEnvironment(scene.environment).time).id;
const twilightWindow=(plane,time)=>{const [h,m]=time.split(':').map(Number),n=h*60+m;return hasAirTrait(plane,'twilight')&&n>=270&&n<=1290;};
export function restrictedAircraftFlight(scene,plane){const time=normalizeEnvironment(scene.environment).time;return !['day','dusk'].includes(getTimePeriod(time).id)&&!nightObservation(plane)&&!twilightWindow(plane,time);}
export const aircraftMayFly=(scene,plane)=>['airborne','landing'].includes(plane.aircraftState?.mission)||!restrictedAircraftFlight(scene,plane);
export function assertAircraftPreparationTime(scene,plane,host){if(aviationPeriod(scene)==='night'&&!nightObservation(plane)&&!nightObservation(host)&&!twilightWindow(plane,normalizeEnvironment(scene.environment).time))throw Error('黒夜は整備できません。機体または母艦・施設に夜間観測を装備してください。');}
export function assertAircraftLaunchTime(scene,plane){if(getWeatherInfo(normalizeEnvironment(scene.environment).weather).level==='orange'&&!hasAirTrait(plane,'storm-petrel'))throw Error('橙色天候では離陸できません。海燕の特性が必要です。');if(aviationPeriod(scene)!=='day'&&!nightObservation(plane)&&!twilightWindow(plane,normalizeEnvironment(scene.environment).time))throw Error('離陸は白昼のみです。夜間観測を装備した機体は全時間帯に離陸できます。');}
export function assertAircraftLandingTime(scene,plane){if(!aircraftMayFly(scene,plane))throw Error('黎明・黒夜の着陸には機体の夜間観測が必要です。');}
