import test from 'node:test';
import assert from 'node:assert/strict';
import {resetDatabase} from './save-test-environment.mjs';
import {source} from './fixtures.mjs';
import {createSimulation, openSimulation} from '../tactical-map/simulation-store.js?v=blast-area-1';
import {getAutonomousEngagementRange} from '../tactical-map/simulation-autonomous-weapon.js?v=car-return-1';
import {ensureUnitCombatRuntime} from '../tactical-map/equipment-runtime.js?v=field-support-1';
import {readSave} from '../js/save-database.js';

function gun(id, range, powerRule, barrelCount = 1) {
  return {
    id, name: id, range, powerRule, barrelCount, kind: 'weapon', ammo: 50,
    projectionCoefficient: 1, projectionSuffix: 'R', guidance: '平射',
    maxOrder: 5, ceilingU: 100, penetration: 'B', targetScope: '单体'
  };
}

function arm(unit, equipment) {
  unit.snapshot.equipmentSnapshots = equipment;
  unit.snapshot.mounts = equipment.map(item => ({equipmentId: item.id, position:'前部', count:1}));
  ensureUnitCombatRuntime(unit);
}

test('strongest full salvo sets half range with stable ties and live equipment eligibility', () => {
  const unit = source().instances[1];
  arm(unit, [gun('cannon', 125, '舰炮规则', 3), gun('tie', 150, '9'), gun('short', 50, '6')]);
  const [cannon, tie, short] = unit.equipmentState.groups;
  const cache = new Map();
  const choose = () => getAutonomousEngagementRange(unit, 2, cache);
  assert.equal(choose(), 75);
  tie.damaged = true;
  assert.equal(choose(), 62.5);
  cannon.remainingAmmo = 2;
  assert.equal(choose(), 25);
  short.lastUsedTurn = 2;
  assert.equal(choose(), null);
});

test('autonomous movement holds at half range until moderate damage restores pursuit', async () => {
  await resetDatabase();
  globalThis.localStorage = {getItem: () => null, setItem() {}};
  async function move(hp, x, armed = true) {
    const input = source();
    const enemy = input.instances[1];
    enemy.currentHp = hp;
    enemy.x = x;
    enemy.snapshot.naval.speedKnots = 40;
    if (armed) arm(enemy, [gun('cannon', 125, '舰炮规则', 3)]);
    const id = await createSimulation(input, () => ({valid:true}));
    const store = await openSimulation(id);
    await store.setEnemyAutonomy(true);
    await store.beginMovement();
    await store.resolveMovement();
    return JSON.parse(await readSave('junqi-simulation-v1:' + id)).instances.find(u => u.instanceId === 'b').x;
  }
  assert.equal(await move(10, 100), 62.5);
  assert.equal(await move(10, 50), 50);
  assert.equal(await move(10, 100, false), 100);
  assert.ok(await move(5, 100) < 62.5);
  assert.ok(await move(0, 100) < 62.5);
});
