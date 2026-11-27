import test from 'node:test';
import assert from 'node:assert/strict';
import {resetDatabase} from './save-test-environment.mjs';
import {source, ship} from './fixtures.mjs';
import {createSimulation, openSimulation} from '../tactical-map/simulation-store.js?v=resume-save-1';
import {captureRoundWitnesses, buildObservedRoundReports, readObservedRoundReport} from '../tactical-map/simulation-round-report.js?v=aviation-deck-1';
import {ensureShipRuntime} from '../tactical-map/ship-runtime.js?v=field-support-1';
import {ensureUnitCombatRuntime} from '../tactical-map/equipment-runtime.js?v=field-support-1';
import {readSave} from '../js/save-database.js';

const revision = store => store.getSceneSnapshot().revision;

function arm(unit) {
  unit.snapshot.mounts = [{equipmentId:'test-gun', position:'前部', count:1}];
  unit.snapshot.equipmentSnapshots = [{
    id:'test-gun', name:'Test gun', kind:'weapon', ammo:50,
    projectionCoefficient:1, barrelCount:1, projectionSuffix:'R',
    guidance:'平射', maxOrder:5, range:125, ceilingU:100,
    powerRule:'1', penetration:'F', targetScope:'单体'
  }];
}

test('manual round reports follow the observation side, persist, and stay unavailable during autonomy', async () => {
  await resetDatabase();
  globalThis.localStorage = {getItem:() => null, setItem() {}};
  const input = source();
  input.instances[1].x = 60;
  arm(input.instances[0]);
  const id = await createSimulation(input, () => ({valid:true}));
  let store = await openSimulation(id);
  assert.deepEqual(store.getRoundBattleReportStatus().rounds, []);
  assert.throws(() => store.getBattleReport(), /推演終了後/);
  await store.beginMovement();
  await store.resolveMovement();
  const groupId = store.getSceneSnapshot().instances.find(unit => unit.instanceId === 'a').equipmentState.groups[0].id;
  await store.saveAttackCommands({unitId:'a', assignments:[{groupId,targetId:'b'}]}, revision(store));
  for (let i=0; i<6; i++) await store.settleAttackPhase(revision(store));
  await store.finishSpecialPhase(revision(store));
  assert.throws(() => store.getRoundBattleReport(1), /ありません/);
  await store.finishTurn(revision(store));
  assert.deepEqual(store.getRoundBattleReportStatus(), {side:'ally', rounds:[1]});
  const ally = store.getRoundBattleReport(1);
  assert.equal(ally.time, '12:30');
  assert.deepEqual(ally.ownUnits.map(unit => unit.name), ['a']);
  assert.deepEqual(ally.contacts.map(unit => unit.name), ['b']);
  assert.equal(ally.attacks[0].weapon, 'Test gun');
  assert.equal(ally.attacks[0].target, 'b');
  ally.attacks.length = 0;
  assert.equal(store.getRoundBattleReport(1).attacks.length, 1);
  assert.ok(!Object.hasOwn(store.getSceneSnapshot(), 'observedRoundReports'));

  await store.setObservationSide('enemy');
  store = await openSimulation(id);
  const enemy = store.getRoundBattleReport(1);
  assert.equal(enemy.side, 'enemy');
  assert.deepEqual(enemy.ownUnits.map(unit => unit.name), ['b']);
  assert.ok(enemy.attacks.every(row => row.weapon === null));
  assert.throws(() => store.getRoundBattleReport(2), /ありません/);
  await store.setEnemyAutonomy(true);
  assert.deepEqual(store.getRoundBattleReportStatus().rounds, []);
  assert.throws(() => store.getRoundBattleReport(1), /ありません/);
  await store.beginMovement();
  await store.resolveMovement();
  for (let i=0; i<6; i++) await store.settleAttackPhase(revision(store));
  await store.finishSpecialPhase(revision(store));
  await store.finishTurn(revision(store));
  assert.deepEqual(JSON.parse(await readSave('junqi-simulation-v1:' + id)).observedRoundReports.map(record => record.roundNumber), [1]);
  await store.endSimulation(revision(store));
  assert.equal(store.getBattleReport().units.length, 2);
});

test('late identification does not reveal earlier attackers or uninvolved combat', () => {
  const scene = source();
  const [ally, enemy] = scene.instances;
  enemy.name = 'Late identification';
  scene.instances.push(ship('foreign', 'neutral', 800));
  for (const unit of scene.instances) {
    ensureShipRuntime(unit);
    ensureUnitCombatRuntime(unit);
  }
  scene.controls = {enemyAutonomy:false, observationSide:'ally'};
  scene.turn = {number:1, phaseId:'order-5'};
  const pairs = [['b','a'], ['foreign','b']];
  const roundWitnesses = captureRoundWitnesses(scene, pairs);
  assert.ok(!roundWitnesses.ally.includes(enemy.instanceId));
  scene.settlementRuntime = {attackRecords:[{
    turnNumber:1, phaseId:'order-5', roundWitnesses,
    hitReports:pairs.map(([unitId,targetId]) => ({unitId,targetId,groupId:'secret',hit:{hitCount:1}})),
    targetReports:[{targetId:'a',hpDamage:1},{targetId:'b',hpDamage:90}]
  }]};
  scene.simulationEndRuntime = {endedAt:null};
  scene.turn.number = 2;
  enemy.x = 80;
  scene.observedRoundReports = [buildObservedRoundReports(scene, 1)];
  const report = readObservedRoundReport(scene, 1);
  assert.equal(report.contacts[0].name, enemy.name);
  assert.deepEqual(report.attacks, [{phase:'order-5', actor:'未確認の艦船', target:ally.name, weapon:null, hits:1}]);
  assert.deepEqual(report.damage, [{phase:'order-5', target:ally.name, damage:1}]);
  assert.ok(!JSON.stringify(report).includes('foreign'));
});
