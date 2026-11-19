import test from "node:test";
import assert from "node:assert/strict";
import { resetDatabase } from "./save-test-environment.mjs";
import { source, ship } from "./fixtures.mjs";
import {
  createSimulation,
  openSimulation,
} from "../tactical-map/simulation-store.js";
import { createBattleStore } from "../js/battle-state.js";
import { readSave } from "../js/save-database.js";
import { normalizeFormation } from "../tactical-map/formation-layout.js";
import { resolveMovementRoutes } from "../tactical-map/simulation-movement-route.js";
import { ensureShipRuntime } from "../tactical-map/ship-runtime.js";

function fixture() {
  const scene = source();
  scene.terrain.width = 3600;
  scene.terrain.height = 3600;
  scene.groups = [
    { id: "own", name: "Own squadron", kind: "formation", parentId: null },
    {
      id: "opponent",
      name: "Enemy squadron",
      kind: "formation",
      parentId: null,
    },
  ];
  scene.instances = [
    ship("a", "ally", 0),
    ship("a2", "ally", 0),
    ship("b", "enemy", 60),
    ship("b2", "enemy", 65),
    ship("hidden", "enemy", 600),
  ];
  scene.instances[1].y = 4;
  for (const unit of scene.instances) {
    unit.faction = "";
    unit.depth = 12;
    unit.groupId = unit.side === "ally" ? "own" : "opponent";
    unit.snapshot.mounts = [
      { equipmentId: "gun", position: "中部①", count: 2 },
    ];
    unit.snapshot.equipmentSnapshots = [
      {
        id: "gun",
        name: "Test gun",
        kind: "weapon",
        ammo: 50,
        projectionCoefficient: 1,
        barrelCount: 1,
        projectionSuffix: "R",
        guidance: "平射",
        maxOrder: 5,
        range: 125,
        ceilingU: 100,
        powerRule: "1",
        penetration: "F",
        targetScope: "单体",
      },
    ];
  }
  return scene;
}
const revision = (store) => store.getSceneSnapshot().revision;
const layout = {
  version: 1,
  overview: true,
  positions: [
    { id: "a", x: 2, y: 0 },
    { id: "a2", x: 2, y: 4 },
  ],
};
async function simulation() {
  await resetDatabase();
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  const id = await createSimulation(fixture(), () => ({ valid: true }));
  return { id, store: await openSimulation(id) };
}

test("layout rejects off-circle or overlapping ships and persists through custom export/import", async () => {
  assert.throws(
    () =>
      normalizeFormation({ ...layout, positions: [{ id: "a", x: 26, y: 0 }] }),
    /50/,
  );
  assert.throws(
    () =>
      normalizeFormation({
        ...layout,
        positions: [
          { id: "a", x: 0, y: 0 },
          { id: "a2", x: 0.2, y: 0 },
        ],
      }),
    /1.1/,
  );
  await resetDatabase();
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  const battle = await createBattleStore([]),
    input = {
      ...battle.getScene(),
      ...fixture(),
      terrainId: "demo-islands-v1",
    };
  await battle.importScene(JSON.stringify(input));
  await battle.saveFormation("own", layout);
  const before = battle.getScene();
  assert.equal(before.instances.find((u) => u.instanceId === "a").x, 2);
  await battle.importScene(battle.exportScene());
  assert.deepEqual(battle.getScene().groups[0].formation, layout);
  await battle.destroy();
});

test("formation re-arrangement is a legal movement plan, then mixed-speed members translate rigidly", async () => {
  const { id, store } = await simulation();
  await assert.rejects(store.saveFormation("own", layout), /移動段階/);
  await store.beginMovement();
  await store.saveFormation("own", layout);
  let saved = JSON.parse(await readSave("junqi-simulation-v1:" + id));
  assert.equal(
    saved.instances[0].x,
    0,
    "layout edit must not teleport a running ship",
  );
  await store.resolveMovement();
  saved = JSON.parse(await readSave("junqi-simulation-v1:" + id));
  assert.equal(saved.instances[0].x, 2);
  assert.equal(saved.instances[1].x, 2);
  assert.equal(saved.instances[1].y, 4);
});

test("rigid formation stops together after a collision and maintains offsets with unequal speeds", () => {
  const scene = fixture();
  scene.instances = scene.instances
    .slice(0, 2)
    .concat(ship("obstacle", "enemy", 11));
  for (const unit of scene.instances) ensureShipRuntime(unit);
  const result = resolveMovementRoutes(
    scene,
    [
      {
        instanceId: "a",
        rigidGroup: "own",
        route: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
        ],
      },
      {
        instanceId: "a2",
        rigidGroup: "own",
        route: [
          { x: 0, y: 4 },
          { x: 20, y: 4 },
        ],
      },
    ],
    (unit) => (unit.instanceId === "a" ? 20 : 40),
  );
  assert.equal(result.collisions.length, 1);
  assert.equal(result.destinations[0].x, 10);
  assert.equal(result.destinations[1].x, 10);
  assert.equal(result.destinations[1].y, 4);
});

test("formation target options and random attack allocation expose only identified members", async () => {
  const { id, store } = await simulation();
  const observed = store.getSceneSnapshot();
  const opponent = observed.groups.find((group) => group.id === "opponent");
  assert.equal(opponent.name, "Enemy squadron");
  assert.deepEqual(
    observed.instances
      .filter((unit) => unit.groupId === "opponent")
      .map((unit) => unit.instanceId),
    ["b", "b2"],
  );
  assert.ok(!JSON.stringify(opponent).includes("hidden"));
  await store.beginMovement();
  await store.resolveMovement();
  const receipt = await store.saveFormationAttack(
    { groupId: "own", targetRef: { kind: "group", id: "opponent" } },
    revision(store),
  );
  assert.equal(receipt.planned, 4);
  const saved = JSON.parse(await readSave("junqi-simulation-v1:" + id));
  assert.equal(saved.attackRuntime.commands.length, 4);
  assert.ok(
    saved.attackRuntime.commands.every((command) =>
      ["b", "b2"].includes(command.targetId),
    ),
  );
  assert.equal(saved.instances[0].equipmentState.groups[0].remainingAmmo, 50);
  await store.settleAttackPhase(revision(store));
  assert.equal(store.getSceneSnapshot().turn.phaseId, "order-4");
});

test("failed hidden targets and stale revisions leave formation attack plans untouched", async () => {
  const { id, store } = await simulation();
  await store.beginMovement();
  await store.resolveMovement();
  const raw = await readSave("junqi-simulation-v1:" + id);
  await assert.rejects(
    store.saveFormationAttack(
      { groupId: "own", targetRef: { kind: "unit", id: "hidden" } },
      revision(store),
    ),
    /識別/,
  );
  assert.equal(await readSave("junqi-simulation-v1:" + id), raw);
  await assert.rejects(
    store.saveFormationAttack(
      { groupId: "own", targetRef: { kind: "group", id: "opponent" } },
      revision(store) - 1,
    ),
    /状態/,
  );
  assert.equal(await readSave("junqi-simulation-v1:" + id), raw);
});

test("repeated whole-group movement keeps a nonzero anchor offset and a fixed formation", async () => {
  const { id, store } = await simulation();
  await store.beginMovement();
  await store.saveFormation("own", layout);
  await store.planMovement({ kind: "group", id: "own" }, 20, 10);
  await store.resolveMovement();
  let saved = JSON.parse(await readSave("junqi-simulation-v1:" + id));
  assert.deepEqual(
    saved.instances.slice(0, 2).map((u) => [u.x, u.y]),
    [
      [22, 10],
      [22, 14],
    ],
  );
  for (let i = 0; i < 6; i++) await store.settleAttackPhase(revision(store));
  await store.finishSpecialPhase(revision(store));
  await store.finishTurn(revision(store));
  await store.beginMovement();
  await store.planMovement({ kind: "group", id: "own" }, 40, 20);
  await store.resolveMovement();
  saved = JSON.parse(await readSave("junqi-simulation-v1:" + id));
  assert.deepEqual(
    saved.instances.slice(0, 2).map((u) => [u.x, u.y]),
    [
      [42, 20],
      [42, 24],
    ],
  );
  const reopened = await openSimulation(id);
  assert.deepEqual(
    reopened.getSceneSnapshot().groups.find((g) => g.id === "own").formation,
    layout,
  );
});

test("real worker plans a formation attack atomically and refuses orders for foreign formations", async () => {
  const { Worker } = await import("node:worker_threads");
  const { shutdownBackground } = await import(
    "../tactical-map/background-client.js?v=naval-formation-2"
  );
  const { id, store } = await simulation();
  globalThis.Worker = class {
    constructor() {
      this.worker = new Worker(
        new URL("./worker-thread-adapter.mjs", import.meta.url),
      );
      this.worker.on("message", (data) => this.onmessage?.({ data }));
      this.worker.on("error", (error) => this.onerror?.(error));
    }
    postMessage(data) {
      this.worker.postMessage(data);
    }
    terminate() {
      this.worker.terminate();
    }
  };
  try {
    await store.beginMovement();
    await store.resolveMovement();
    await store.saveFormationAttack(
      { groupId: "own", targetRef: { kind: "unit", id: "b" } },
      revision(store),
    );
    const raw = await readSave("junqi-simulation-v1:" + id);
    const commands = JSON.parse(raw).attackRuntime.commands;
    assert.equal(commands.length, 4);
    assert.ok(commands.every((command) => command.targetId === "b"));
    await assert.rejects(
      store.saveFormationAttack(
        { groupId: "opponent", targetRef: { kind: "unit", id: "a" } },
        revision(store),
      ),
      /陣営|操作/,
    );
    assert.equal(await readSave("junqi-simulation-v1:" + id), raw);
  } finally {
    shutdownBackground();
    delete globalThis.Worker;
  }
});

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
test("bow-relative editor migrates old map offsets without changing world placement", async () => {
  const {formationEditingDraft, formationOffset, formationCenter} = await import('../tactical-map/formation-layout.js');
  const members = fixture().instances.slice(0,2);
  members[1].isFormationFlagship = true;
  members[1].heading = 90;
  const draft = formationEditingDraft(members, layout);
  assert.equal(draft.version, 2);
  assert.equal(draft.heading, 90);
  for (const point of draft.positions) {
    const old = layout.positions.find(p => p.id === point.id);
    const world = formationOffset(point, draft);
    near(world.x, old.x); near(world.y, old.y);
  }
  assert.deepEqual(formationCenter(members, draft), formationCenter(members, layout));
  near(draft.positions[0].x, 0); near(draft.positions[0].y, -2);
  assert.equal(layout.version, 1, 'opening an editor must not mutate legacy data');
  assert.equal(normalizeFormation({...draft, positions:[{id:'a',x:25,y:0}]}).positions[0].x,25);
  assert.throws(() => normalizeFormation({...draft, heading: NaN}), /艦艏/);
});

test("custom bow-relative placement and JSON reopen preserve the formation frame", async () => {
  await resetDatabase();
  globalThis.localStorage = {getItem:()=>null,setItem(){}};
  const battle = await createBattleStore([]);
  await battle.importScene(JSON.stringify({...battle.getScene(),...fixture(),terrainId:'demo-islands-v1'}));
  const bowLayout = {version:2, heading:90, overview:true, positions:[{id:'a',x:0,y:0},{id:'a2',x:0,y:-20}]};
  await battle.saveFormation('own', bowLayout);
  near(battle.getScene().instances[1].x,20);
  near(battle.getScene().instances[1].y,0);
  await battle.importScene(battle.exportScene());
  assert.deepEqual(battle.getScene().groups[0].formation,bowLayout);
  await battle.destroy();
});

test("simulation bow-relative layout stays a movement plan and uses rotated offsets on translation", async () => {
  const {id,store} = await simulation();
  const bowLayout = {version:2, heading:90, overview:true, positions:[{id:'a',x:0,y:0},{id:'a2',x:0,y:-4}]};
  await store.beginMovement();
  await store.saveFormation('own',bowLayout);
  let saved=JSON.parse(await readSave('junqi-simulation-v1:'+id));
  near(saved.instances[1].x,0); near(saved.instances[1].y,4);
  await store.planMovement({kind:'group',id:'own'},20,10);
  await store.resolveMovement();
  saved=JSON.parse(await readSave('junqi-simulation-v1:'+id));
  near(saved.instances[0].x,20); near(saved.instances[0].y,10);
  near(saved.instances[1].x,24); near(saved.instances[1].y,10);
  const reopened=await openSimulation(id);
  assert.deepEqual(reopened.getSceneSnapshot().groups[0].formation,bowLayout);
});
