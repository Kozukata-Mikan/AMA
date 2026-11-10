import {
  ensureShipRuntime,
  applyShipFireFloodingPhase
} from "./ship-runtime.js";

import {
  ensureUnitCombatRuntime
} from "./equipment-runtime.js";

import {
  ensureEquipmentItemRuntime,
  applyEquipmentAttack,
  applyEquipmentItemDamageControl,
  applyExternalEquipmentRepairResult,
  getEquipmentControlCandidates,
  readEquipmentItemState,
  getRetainedEquipmentDiscovery
} from "./equipment-item-runtime.js";

import {
  initializeRescueState,
  interruptRescueTask,
  isSinkingTimerPaused
} from "./simulation-rescue.js";

import {
  applySinkingEndStep
} from "./simulation-rescue-runtime.js";

const copy = value => JSON.parse(JSON.stringify(value));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrow(callback, message) {
  let threw = false;

  try {
    callback();
  } catch {
    threw = true;
  }

  assert(threw, message);
}

function makeShip(id, x = 0) {
  const unit = {
    instanceId: id,
    unitId: id,
    name: id,
    branch: "navy",
    side: "ally",
    x,
    y: 0,
    heading: 0,
    underwater: false,
    depth: 0,
    currentHp: 10,

    snapshot: {
      maxHp: 10,
      trainingTraits: [],
      naval: {
        type: "DD",
        strength: 0,
        detection: "F",
        seaRecon: "F",
        airRecon: "F",
        armor: "F",
        speedKnots: 10,
        endurance: 100
      },
      mounts: [
        {
          equipmentId: "test-equipment",
          position: "前部",
          count: 2
        }
      ],
      equipmentSnapshots: [
        {
          id: "test-equipment",
          ammo: 10
        }
      ]
    }
  };

  ensureShipRuntime(unit);
  ensureUnitCombatRuntime(unit);
  ensureEquipmentItemRuntime(unit);

  return unit;
}

function damageFront(scene, unit) {
  return applyEquipmentAttack(
    scene,
    unit,
    {
      powerRule: "1（设备）",
      hitCount: 1
    },
    {
      selectIndex: () => 0,
      observeBeforeDamage: () => null
    }
  );
}

function activeTask(id, kind, rescuer, target) {
  const task = {
    id,
    kind,
    rescuerId: rescuer.instanceId,
    targetId: target.instanceId,
    startedTurn: 1,
    status: "active",
    resolvedTurn: null,
    coinHeads: null,
    guaranteed: false
  };

  if (kind === "equipment-repair") {
    task.itemId = "front";
  }

  rescuer.shipState.rescueTaskId = id;
  target.shipState.rescueTaskId = id;

  return task;
}

function endScene(kind) {
  const rescuer = makeShip("rescuer", 0);
  const target = makeShip("target", 1);

  const scene = {
    turn: {
      number: 1,
      phaseId: "end",
      elapsedMinutes: 0
    },
    instances: [rescuer, target],
    rescuePlans: [],
    rescueTasks: [],
    rescueRuntime: {
      version: 1,
      lastSpecialTurn: 1,
      lastEndTurn: 0,
      records: [
        {
          version: 1,
          step: "rescue-special",
          turnNumber: 1,
          results: []
        }
      ]
    }
  };

  target.currentHp = 0;
  target.shipState.status = "sinking";
  target.shipState.sinkingElapsedMinutes = 90;
  target.shipState.hasReceivedDamage = true;

  if (kind === "equipment-repair") {
    damageFront(scene, target);
  }

  scene.rescueTasks.push(
    activeTask("test-task", kind, rescuer, target)
  );

  initializeRescueState(scene);

  return scene;
}

export function runEquipmentRegressionTests() {
  const results = [];

  function test(name, callback) {
    try {
      callback();
      results.push({
        name,
        passed: true,
        error: null
      });
    } catch (error) {
      results.push({
        name,
        passed: false,
        error: error.message
      });
    }
  }

  test("威力2・命中3枚は6分配、耐性と弾薬は不変", () => {
    const unit = makeShip("target");
    const scene = {
      turn: { number: 1 },
      instances: [unit]
    };

    const hpBefore = unit.currentHp;
    const shipBefore = JSON.stringify(unit.shipState);
    const ammoBefore = unit.equipmentState.groups.map(
      group => group.remainingAmmo
    );

    const report = applyEquipmentAttack(
      scene,
      unit,
      {
        powerRule: "威力：2（设备）",
        hitCount: 3
      },
      {
        selectIndex: () => 0,
        observeBeforeDamage: () => null
      }
    );

    assert(report.allocationCount === 6, "分配数が6ではありません");
    assert(report.draws.length === 6, "抽選履歴が不足しています");
    assert(unit.currentHp === hpBefore, "耐性が変化しました");
    assert(
      JSON.stringify(unit.shipState) === shipBefore,
      "艦船損傷状態が変化しました"
    );
    assert(
      unit.equipmentState.groups.every(
        (group, index) =>
          group.remainingAmmo === ammoBefore[index] &&
          group.damaged &&
          !group.destroyed
      ),
      "同位置全組の損傷または弾薬状態が不正です"
    );
    assert(
      report.applications.filter(item => item.changed).length === 1,
      "重複命中で損傷が重なりました"
    );
  });

  test("空位置は分配を消費し、損傷候補にならない", () => {
    const unit = makeShip("target");
    const scene = {
      turn: { number: 1 },
      instances: [unit]
    };

    const before = JSON.stringify(unit);

    const report = applyEquipmentAttack(
      scene,
      unit,
      {
        powerRule: "1（设备）",
        hitCount: 1
      },
      {
        // 尾部には装備を配置していない。
        selectIndex: () => 5,
        observeBeforeDamage: () => null
      }
    );

    assert(report.allocationCount === 1, "分配が消費されていません");
    assert(report.applications[0].empty, "空位置として扱われていません");
    assert(JSON.stringify(unit) === before, "空位置で状態が変化しました");
    assert(
      getEquipmentControlCandidates(unit).length === 0,
      "空位置が損管候補になりました"
    );
  });

  test("内部損管は先に選択し、反面で同項目が完全破損", () => {
    const unit = makeShip("target");
    const scene = {
      turn: { number: 1 },
      instances: [unit]
    };

    damageFront(scene, unit);

    const calls = [];

    const report = applyEquipmentItemDamageControl(unit, {
      selectIndex: () => {
        calls.push("select");
        return 0;
      },
      coinSource: () => {
        calls.push("coin");
        return false;
      }
    });

    assert(
      calls.join(",") === "select,coin",
      "対象選択とR判定の順序が不正です"
    );
    assert(report.itemId === "front", "対象項目が変化しました");
    assert(report.outcome === "destroyed", "反面で完全破損しません");
    assert(
      unit.equipmentState.groups.every(group => group.destroyed),
      "同位置の全組が完全破損していません"
    );

    expectThrow(
      () => applyExternalEquipmentRepairResult(unit, "front", true),
      "完全破損した項目を修復できてしまいました"
    );
  });

  test("正式特殊段階は旧装備組損管を重複実行しない", () => {
    const unit = makeShip("target");
    const scene = {
      turn: { number: 1 },
      instances: [unit]
    };

    damageFront(scene, unit);

    let selections = 0;
    let coins = 0;

    const report = applyShipFireFloodingPhase(
      unit,
      {
        turnNumber: 1,
        phaseId: "special"
      },
      () => {
        coins += 1;
        return false;
      },
      count => {
        selections += 1;
        assert(count === 1, "候補が装備組単位になっています");
        return 0;
      }
    );

    assert(selections === 1, "設備選択が重複しました");
    assert(coins === 1, "設備R判定が重複しました");
    assert(
      report.equipmentControl?.outcome === "destroyed",
      "正式入口が八項目損管に接続されていません"
    );
  });

  test("外部修復成功は同位置全組を復旧し、弾薬を戻さない", () => {
    const unit = makeShip("target");
    const scene = {
      turn: { number: 1 },
      instances: [unit]
    };

    unit.equipmentState.groups[0].remainingAmmo = 3;
    unit.equipmentState.groups[0].lastUsedTurn = 1;

    damageFront(scene, unit);

    applyExternalEquipmentRepairResult(unit, "front", true);

    assert(
      unit.equipmentState.groups.every(group => !group.damaged),
      "同位置全組が復旧していません"
    );
    assert(
      unit.equipmentState.groups[0].remainingAmmo === 3 &&
      unit.equipmentState.groups[0].lastUsedTurn === 1,
      "弾薬または使用記録がリセットされました"
    );
  });

  test("偵察の受損回合発見は次ラウンドで失効", () => {
    const observer = makeShip("observer");
    const target = makeShip("enemy");
    target.side = "enemy";

    const scene = {
      turn: { number: 1 },
      instances: [observer, target]
    };

    applyEquipmentAttack(
      scene,
      observer,
      {
        powerRule: "1（设备）",
        hitCount: 1
      },
      {
        selectIndex: () => 6,
        observeBeforeDamage: (unit, observed, itemId) =>
          itemId === "sea-recon" ? "identified" : null
      }
    );

    assert(
      readEquipmentItemState(observer, "sea-recon").damaged,
      "対海偵察が損傷していません"
    );
    assert(
      getRetainedEquipmentDiscovery(
        scene, observer, target, "sea-recon"
      ) === "identified",
      "受損回合の発見が保持されていません"
    );

    scene.turn.number = 2;

    assert(
      getRetainedEquipmentDiscovery(
        scene, observer, target, "sea-recon"
      ) === null,
      "次ラウンドでも受損前発見が残っています"
    );
  });

  test("設備分配途中の失敗は対象を部分変更しない", () => {
    const unit = makeShip("target");
    const scene = {
      turn: { number: 1 },
      instances: [unit]
    };

    const before = JSON.stringify(unit);
    let draws = 0;

    expectThrow(() => {
      applyEquipmentAttack(
        scene,
        unit,
        {
          powerRule: "2（设备）",
          hitCount: 1
        },
        {
          selectIndex: () => draws++ === 0 ? 0 : 8,
          observeBeforeDamage: () => null
        }
      );
    }, "範囲外抽選を拒否しません");

    assert(JSON.stringify(unit) === before, "半分の損傷が書き戻されました");
  });

  test("設備修復は沈没計時を止めず、自然沈没時に任務解除", () => {
    const scene = endScene("equipment-repair");
    const target = scene.instances[1];

    assert(
      !isSinkingTimerPaused(scene, target),
      "設備修復で沈没計時が停止しました"
    );

    applySinkingEndStep(scene);

    assert(target !== scene.instances[1], "作業副本が書き戻されていません");

    const updated = scene.instances[1];
    const task = scene.rescueTasks[0];

    assert(updated.shipState.status === "sunk", "自然沈没しません");
    assert(task.status === "interrupted", "修復任務が解除されません");
    assert(task.pausedMinutesBackfilled === 0, "修復で時間を補算しました");
    assert(
      scene.instances.every(unit =>
        unit.shipState.rescueTaskId === null
      ),
      "任務の行動ロックが残っています"
    );
  });

  test("艦船救助は従来どおり自然沈没計時を停止", () => {
    const scene = endScene("rescue");

    applySinkingEndStep(scene);

    assert(
      scene.instances[1].shipState.sinkingElapsedMinutes === 90,
      "救助中に沈没時間が増加しました"
    );
    assert(
      scene.rescueTasks[0].status === "active",
      "有効な救助任務が中断されました"
    );
  });

  test("救助中断の補算は一度だけ", () => {
    const scene = endScene("rescue");
    scene.turn.number = 2;

    interruptRescueTask(scene, "test-task", "test");
    const afterFirst =
      scene.instances[1].shipState.sinkingElapsedMinutes;

    const second = interruptRescueTask(scene, "test-task", "test");

    assert(afterFirst === 120, "救助停止時間を正しく補算しません");
    assert(second.alreadyFinished, "終了済み任務を再中断しました");
    assert(
      scene.instances[1].shipState.sinkingElapsedMinutes === afterFirst,
      "停止時間を二重補算しました"
    );
  });

  test("同回合の終了処理再実行は拒否し、場面を変更しない", () => {
    const scene = endScene("rescue");

    applySinkingEndStep(scene);
    const before = JSON.stringify(scene);

    expectThrow(
      () => applySinkingEndStep(scene),
      "同回合の終了処理を再実行できました"
    );

    assert(
      JSON.stringify(scene) === before,
      "重複拒否時に場面が変化しました"
    );
  });

  console.table(results);

  return {
    passed: results.filter(result => result.passed).length,
    failed: results.filter(result => !result.passed).length,
    results
  };
}
