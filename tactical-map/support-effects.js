import {supportCapacity} from './support-equipment.js?v=field-support-1';
import {navalHeight} from './naval-kind.js';
import {sampleTerrain} from './terrain-data.js';
export const balloonActive=unit=>unit?.fieldSupport?.balloonRaised===true&&supportCapacity(unit,'observation-balloon')>0&&!['sinking','sunk'].includes(unit.shipState?.status)&&unit.aircraftState?.status!=='destroyed';
export const spottingBonus=unit=>Number(supportCapacity(unit,'spotter')>0||balloonActive(unit));
export function balloonObserver(scene,unit){
 if(!balloonActive(unit))return unit;
 const terrain=sampleTerrain(scene.terrain,unit.x,unit.y),base=unit.branch==='navy'?navalHeight(unit,terrain):unit.branch==='air'?unit.altitude:terrain.surface;
 return {...unit,reconnaissanceAltitude:base+30};
}
