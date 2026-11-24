import {airborneUnit} from './air-ground-rules.js';

export function airDisruptionPenalty(scene, unit) {
  const state = unit?.aircraftState?.disruption;
  return state?.turnNumber === scene.turn.number ? state.penalties : 0;
}

// Count actual eligible volleys before any hit rolls. A formation-wide volley
// counts once per aircraft cluster, rather than once for every expanded member.
export function applyAirDisruption(scene, entries, assignments) {
  if (!entries.length || !scene.instances.some(u => u.branch === 'air' && u.aircraftState)) return {reports: [], increments: new Map()};
  const units = new Map(scene.instances.map(u => [u.instanceId, u]));
  const clusters = new Set(scene.groups.filter(g => g.kind === 'cluster').map(g => g.id));
  const key = u => u.aircraftState.clusterId ?? (clusters.has(u.groupId) ? u.groupId : u.instanceId);
  const members = new Map(), totals = new Map(), increments = new Map();
  for (const unit of scene.instances) {
    if (unit.branch !== 'air' || !unit.aircraftState || unit.aircraftState.status === 'destroyed' || !['airborne', 'landing'].includes(unit.aircraftState.mission)) continue;
    const id = key(unit);
    if (!members.has(id)) members.set(id, []);
    members.get(id).push(unit);
  }
  const targets = new Map(assignments.map(a => [a.commandId, a.targetIds]));
  for (const entry of entries) {
    const actor = units.get(entry.unitId);
    if (!actor || !['navy', 'building'].includes(actor.branch) || airborneUnit(actor)) continue;
    const affected = new Set();
    for (const id of targets.get(entry.commandId) ?? []) {
      const target = units.get(id);
      if (target?.branch === 'air' && target.aircraftState && members.get(key(target))?.includes(target)) affected.add(key(target));
    }
    for (const id of affected) {
      if (!totals.has(id)) totals.set(id, {projection: 0, commandIds: [], actorIds: new Set()});
      const total = totals.get(id);
      total.projection += entry.projection.groups * entry.projection.coinsPerGroup;
      if (!Number.isSafeInteger(total.projection)) throw Error('対空妨害の総投射数が範囲外です。');
      total.commandIds.push(entry.commandId);
      total.actorIds.add(entry.unitId);
    }
  }
  const reports = [];
  for (const [id, total] of totals) {
    const planes = members.get(id), addedPenalties = Math.floor(total.projection / (planes.length * 10));
    const report = {clusterId: id, aircraftIds: planes.map(p => p.instanceId), aircraftCount: planes.length,
      projection: total.projection, addedPenalties, commandIds: total.commandIds, actorIds: [...total.actorIds],
      turnNumber: scene.turn.number, phaseId: scene.turn.phaseId};
    for (const plane of planes) {
      const previous = airDisruptionPenalty(scene, plane);
      const penalties = previous + addedPenalties;
      if (!Number.isSafeInteger(penalties)) throw Error('対空妨害の不利判定数が範囲外です。');
      plane.aircraftState.disruption = {turnNumber: scene.turn.number, penalties};
      increments.set(plane.instanceId, addedPenalties);
    }
    reports.push(report);
  }
  return {reports, increments};
}
