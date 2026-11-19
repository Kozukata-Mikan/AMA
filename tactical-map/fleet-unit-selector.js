import { formationMembers } from './formation-layout.js?v=fleet-course-3';
import { getFlagshipDisplayName } from './flagship-display.js';

export const NO_FLEET = '__none__';
export function fleetSelectionModel(scene, units) {
  const allowed = new Set(units.map(unit => unit.instanceId));
  const groups = scene.groups.map(group => {
    const members = formationMembers(scene, group.id);
    return {group, units: members.filter(unit => allowed.has(unit.instanceId)),
      whole: members.length > 0 && members.every(unit => allowed.has(unit.instanceId))};
  }).filter(item => item.units.length);
  const known = new Set(scene.groups.map(group => group.id));
  return {groups, loose: units.filter(unit => !known.has(unit.groupId))};
}

/** A fleet filter plus an existing single-unit control. No hidden battlefield reads. */
export function createFleetUnitSelector(actor, {label, encodeUnit = id => id,
  encodeGroup = id => JSON.stringify({kind:'group',id}), wholeGroups = false} = {}) {
  const fleet = document.createElement('select');
  const field = document.createElement('label');
  const title = document.createElement('span'); title.textContent = label;
  field.append(title, fleet);
  let model = {groups:[],loose:[]};
  let available = [];
  function refill(previous) {
    const group = model.groups.find(item => item.group.id === fleet.value);
    available = group?.units ?? model.loose;
    actor.replaceChildren(new Option(group && wholeGroups && group.whole
      ? '編隊全体を操作（単艦も選択可）' : '単艦を選択してください',
      group && wholeGroups && group.whole ? encodeGroup(group.group.id) : ''));
    for (const unit of available)
      actor.append(new Option(getFlagshipDisplayName(unit), encodeUnit(unit.instanceId)));
    if ([...actor.options].some(option => option.value === previous)) actor.value = previous;
  }
  fleet.addEventListener('change', () => {
    refill(''); actor.dispatchEvent(new Event('change', {bubbles:true}));
  });
  return {field, fleet,
    sync(scene, units) {
      const previous = actor.value, previousFleet = fleet.value || NO_FLEET;
      model = fleetSelectionModel(scene, units);
      fleet.replaceChildren(new Option('編隊なし',NO_FLEET),
        ...model.groups.map(item => new Option(`${item.group.name}（${item.units.length}）`,item.group.id)));
      fleet.value = model.groups.some(item => item.group.id === previousFleet) ? previousFleet : NO_FLEET;
      refill(previous);
    },
    select(value) {
      const group = model.groups.find(item => wholeGroups && encodeGroup(item.group.id) === value);
      const unit = model.groups.flatMap(item => item.units).concat(model.loose)
        .find(item => encodeUnit(item.instanceId) === value);
      if (!group && !unit) return false;
      if (group) fleet.value = group.group.id;
      else if (!available.some(item => item.instanceId === unit.instanceId))
        fleet.value = model.groups.some(item => item.group.id === unit.groupId) ? unit.groupId : NO_FLEET;
      refill(value);
      return actor.value === value;
    },
    setDisabled(value) {fleet.disabled = value; actor.disabled = value;},
  };
}
