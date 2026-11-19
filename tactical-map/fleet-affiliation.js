import {formationMembers,formationSide} from './formation-layout.js?v=fleet-cohesion-5';
export const FLEET_SIDE_LABELS = {ally:'味方',enemy:'敵',neutral:'中立',mixed:'混合陣営',empty:'所属艦なし'};
export function fleetSideSections(scene, groups = scene.groups) {
  return Object.entries(FLEET_SIDE_LABELS).map(([side,label])=>({side,label,
    groups:groups.filter(group=>formationSide(formationMembers(scene,group.id))===side)})).filter(section=>section.groups.length);
}
export function appendFleetOptions(control, scene, groups, leading = []) {
  control.replaceChildren(...leading.map(([value,label])=>new Option(label,value)));
  for (const section of fleetSideSections(scene,groups)) {
    const bucket=document.createElement('optgroup');bucket.label=section.label;
    for (const group of section.groups) bucket.append(new Option(group.name,group.id));
    control.append(bucket);
  }
}
