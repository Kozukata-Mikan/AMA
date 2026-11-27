import {airTrainingRule,effectiveTraining,trainingCoin,randomAirCoin,resolveAceLosses} from './air-training-runtime.js?v=electronic-ballistic-1';
import {restrictedAircraftFlight} from './aviation-time.js?v=electronic-ballistic-1';

function destroy(plane, reason) {
  plane.currentHp = 0;
  plane.aircraftState.status = 'destroyed';
  plane.aircraftState.destroyedReason = reason;
}
function remember(scene, report) {
  if (!scene.aviationRuntime?.records) throw Error('航空損失の履歴保存先がありません。');
  scene.aviationRuntime.records.push(report);
}
export function recordAviationAceLosses(scene, coin = randomAirCoin) {
  const records = resolveAceLosses(scene, coin);
  for (const report of records) remember(scene, {kind:'ace-loss',turnNumber:scene.turn.number,...report});
  return records;
}
export function resolveAirNavigationLosses(scene, coin = randomAirCoin) {
  const reports = [];
  // Capture every aircraft's training before rolling: an ACE loss must not
  // change another aircraft's coin count halfway through this special step.
  const candidates = scene.instances.filter(p => p.branch === 'air' && p.aircraftState && p.aircraftState.status !== 'destroyed' && ['airborne','landing'].includes(p.aircraftState.mission))
    .map(p => ({plane:p,heavy:p.aircraftState.status==='heavy',restricted:restrictedAircraftFlight(scene,p),training:effectiveTraining(p),coins:airTrainingRule(p).reaction+1}));
  for (const {plane,heavy,restricted,training,coins} of candidates) {
    const state = plane.aircraftState;
    if ((!heavy&&!restricted) || state.navigationLossTurn === scene.turn.number) continue;
    if ((state.navigationLossTurn??0)>scene.turn.number) throw Error('迷航判定の履歴が未来になっています。');
    const rolls = Array.from({length:coins}, () => trainingCoin(coin));
    const crashed = rolls.every(head => !head);
    if (crashed) destroy(plane,'navigation-loss');
    state.navigationLossTurn = scene.turn.number;
    const report = {kind:'navigation-loss',turnNumber:scene.turn.number,phaseId:scene.turn.phaseId,aircraftId:plane.instanceId,training,heavy,restricted,rolls,crashed};
    remember(scene,report);reports.push(report);
  }
  recordAviationAceLosses(scene,coin);
  return reports;
}
export function resolveForcedLanding(scene, plane, {hostId,runwayId,stage}, coin = randomAirCoin) {
  const state = plane.aircraftState;
  if (state.status !== 'heavy') return null;
  const training=effectiveTraining(plane),retries=airTrainingRule(plane).reaction,rolls=[];
  for (let attempt=0;attempt<=retries;attempt++) {
    const head=trainingCoin(coin);rolls.push(head);
    if (head) break;
  }
  const success=rolls.some(Boolean);
  if (!success) destroy(plane,'forced-landing-failed');
  const report={kind:'forced-landing',turnNumber:scene.turn.number,aircraftId:plane.instanceId,hostId,runwayId,stage,training,retries,rolls,success};
  state.emergencyLanding={turnNumber:scene.turn.number,hostId,runwayId,success};
  remember(scene,report);
  return report;
}

export function observedAviationLosses(scene, side) {
  const own = new Map(scene.instances.filter(p=>p.side===side).map(p=>[p.instanceId,p.name]));
  const reports=[], records=scene.aviationRuntime?.records??[];
  for (let i=records.length-1;i>=0&&reports.length<30;i--) {
    const r=records[i];
    if (['navigation-loss','forced-landing'].includes(r.kind)&&own.has(r.aircraftId)) reports.push({...r,aircraftName:own.get(r.aircraftId)});
  }
  return reports.reverse();
}
