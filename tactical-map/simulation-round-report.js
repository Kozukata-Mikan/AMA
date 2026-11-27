import {advanceEnvironment} from './environment-data.js?v=day-catalog-pas-1';
import {getObservationSide, getVisibility} from './simulation-features.js?v=car-return-1';

const sides = ['ally', 'enemy', 'neutral'];
const unknownUnit = '未確認の艦船';

function unitsById(scene) {
  return new Map(scene.instances.map(unit => [unit.instanceId, unit]));
}

function observationFor(scene, side, targets) {
  return getVisibility({
    ...scene,
    controls: {...scene.controls, observationSide: side, enemyAutonomy: false}
  }, targets);
}

// Store only names the participant's side could identify at settlement time.
// An absent witness (including old saves) must never be inferred from later sight.
export function captureRoundWitnesses(scene, pairs) {
  const units = unitsById(scene);
  const targetsBySide = new Map();
  for (const [a, b] of pairs) {
    const first = units.get(a);
    const second = units.get(b);
    if (!first || !second || first.side === second.side) continue;
    for (const [observer, target] of [[first, second], [second, first]]) {
      if (!targetsBySide.has(observer.side)) targetsBySide.set(observer.side, new Set());
      targetsBySide.get(observer.side).add(target.instanceId);
    }
  }
  const witnesses = {};
  for (const [side, targets] of targetsBySide) {
    witnesses[side] = [...observationFor(scene, side, targets)]
      .filter(([, level]) => level === 'identified')
      .map(([id]) => id);
  }
  return witnesses;
}

function ownWeapon(unit, groupId) {
  const group = unit.equipmentState?.groups.find(item => item.id === groupId);
  const equipment = unit.snapshot?.equipmentSnapshots?.find(item => item.id === group?.equipmentId);
  return equipment?.name || equipment?.label || '兵装名未記録';
}

function observedName(unit, side, identifiedIds) {
  return unit && (unit.side === side || identifiedIds.has(unit.instanceId))
    ? unit.name
    : unknownUnit;
}

function addRow(rows, keys, counts) {
  const key = JSON.stringify(keys);
  if (!rows.has(key)) rows.set(key, {...keys, ...counts});
  else for (const [field, value] of Object.entries(counts)) rows.get(key)[field] += value;
}

// Called on the worker after the round is settled, then saved with that transaction.
export function buildObservedRoundReports(scene, roundNumber) {
  const units = unitsById(scene);
  const attacks = [];
  for (const record of scene.settlementRuntime.attackRecords) {
    if (record.turnNumber === roundNumber) attacks.push(record);
  }
  const movement = scene.movementRuntime?.records.find(record => record.turnNumber === roundNumber);
  const reports = {};

  for (const side of sides) {
    const visibility = observationFor(scene, side);
    const ownUnits = [];
    const contacts = [];
    let shadows = 0;
    for (const unit of scene.instances) {
      const status = unit.shipState?.status ?? null;
      if (unit.side === side) ownUnits.push({name:unit.name, status, hp:unit.currentHp});
      else if (visibility.get(unit.instanceId) === 'identified') contacts.push({name:unit.name, status});
      else if (visibility.get(unit.instanceId) === 'shadow') shadows++;
    }

    const disruption = [];
    const attackRows = new Map();
    const damageRows = new Map();
    for (const record of attacks) {
      for (const event of record.airDisruptionReports ?? []) {
        const own = event.aircraftIds.map(id => units.get(id)).filter(u => u?.side === side);
        if (own.length) disruption.push({phase:record.phaseId, aircraft:own.map(u=>u.name), aircraftCount:event.aircraftCount, projection:event.projection, addedPenalties:event.addedPenalties});
      }
      const identified = new Set(record.roundWitnesses?.[side]);
      for (const hit of record.hitReports) {
        const actor = units.get(hit.unitId);
        const target = units.get(hit.targetId);
        const ownAttack = actor?.side === side;
        const hits = hit.hit.hitCount;
        if (!ownAttack && (target?.side !== side || hits === 0)) continue;
        addRow(attackRows, {
          phase:record.phaseId,
          actor:observedName(actor, side, identified),
          target:observedName(target, side, identified),
          weapon:ownAttack ? ownWeapon(actor, hit.groupId) : null
        }, {hits});
      }
      for (const damage of record.targetReports) {
        const target = units.get(damage.targetId);
        if (target?.side === side) {
          addRow(damageRows, {phase:record.phaseId, target:target.name}, {damage:damage.hpDamage});
        }
      }
    }

    const collisions = new Map();
    const identified = new Set(movement?.roundWitnesses?.[side]);
    for (const event of movement?.collisions ?? []) {
      const participants = event.unitIds.map(id => units.get(id));
      if (!participants.some(unit => unit?.side === side)) continue;
      addRow(collisions, {
        first:observedName(participants[0], side, identified),
        second:observedName(participants[1], side, identified)
      }, {count:1});
    }
    for (const damage of movement?.damageReports ?? []) {
      const target = units.get(damage.targetId);
      if (target?.side === side) {
        addRow(damageRows, {phase:'movement', target:target.name}, {damage:damage.requestedHpDamage});
      }
    }
    const fieldEvents=[];
    for(const r of scene.fieldSupportRuntime?.records??[]){if(r.turnNumber!==roundNumber)continue;const own=r.side===side;if(!own&&!(r.kind==='mine-triggered'&&r.ownerSide===side))continue;fieldEvents.push({phase:r.phaseId,kind:r.kind,unit:own?units.get(r.unitId)?.name??'自陣営ユニット':'未識別目標',raised:r.raised,damage:own?r.damage:undefined});if(own&&r.kind==='mine-triggered')addRow(damageRows,{phase:r.phaseId,target:units.get(r.unitId)?.name??'自陣営ユニット'},{damage:r.damage});}
    reports[side] = {fieldEvents,
      aircraftLosses:(scene.aviationRuntime?.records??[]).filter(r=>['navigation-loss','forced-landing'].includes(r.kind)&&r.turnNumber===roundNumber&&units.get(r.aircraftId)?.side===side).map(r=>({...r,aircraftName:units.get(r.aircraftId).name})),
      disruption, attacks:[...attackRows.values()], damage:[...damageRows.values()],
      collisions:[...collisions.values()], ownUnits, contacts, shadows
    };
  }
  return {roundNumber, day:scene.environment.day??1, time:scene.environment.time, reports};
}

export function visibleRoundNumbers(scene) {
  if (scene.controls.enemyAutonomy || scene.simulationEndRuntime.endedAt !== null) return [];
  return (scene.observedRoundReports ?? []).map(report => report.roundNumber);
}

export function readObservedRoundReport(scene, roundNumber) {
  const side = getObservationSide(scene);
  if (!visibleRoundNumbers(scene).includes(roundNumber) || !sides.includes(side)) {
    throw new Error('このラウンドの観察戦闘記録はありません。');
  }
  const report = scene.observedRoundReports.find(report => report.roundNumber === roundNumber);
  return structuredClone({roundNumber, day:report.day??advanceEnvironment(scene.initialScene?.environment,roundNumber*30).day, time:report.time, side, ...report.reports[side]});
}
