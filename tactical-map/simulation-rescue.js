import { readShipProfile } from "./ship-runtime.js";
import { TURN_DURATION_MINUTES } from "./rules-engine.js";

import {
  assertManualControl,
  assertIdentifiedTargets
} from "./simulation-features.js";

import {
  getEquipmentControlCandidates,
  applyExternalEquipmentRepairResult
} from "./equipment-item-runtime.js";

const copy = value => JSON.parse(JSON.stringify(value));

function fail(message) {
  throw new Error(message);
}

function findUnit(scene, id) {
  const unit = scene.instances.find(
    item => item.instanceId === id
  );

  if (!unit || unit.branch !== "navy") {
    fail("救助・修復の対象艦を確認できません。");
  }

  return unit;
}

function hasPosition(unit) {
  return Number.isFinite(unit.x) &&
    Number.isFinite(unit.y);
}

function canRescue(unit) {
  return (
    hasPosition(unit) &&
    !["sinking", "sunk"].includes(unit.shipState?.status) &&
    unit.shipState?.rescueTaskId === null
  );
}

function taskKind(value) {
  const kind = value.kind ?? "rescue";

  if (!["rescue", "equipment-repair"].includes(kind)) {
    fail("救助・修復の任務種別が不正です。");
  }

  if (kind === "rescue" && value.itemId !== undefined) {
    fail("艦船救助に設備対象が保存されています。");
  }

  if (
    kind === "equipment-repair" &&
    (
      typeof value.itemId !== "string" ||
      ![
        "front", "middle-1", "middle-2",
        "both-sides", "rear", "tail",
        "sea-recon", "air-recon"
      ].includes(value.itemId)
    )
  ) {
    fail("設備修復の対象項目が不正です。");
  }

  return kind;
}

function repairable(unit, itemId) {
  return getEquipmentControlCandidates(unit)
    .includes(itemId);
}

function targetEligible(target, kind, itemId) {
  if (
    !hasPosition(target) ||
    target.shipState.status === "sunk"
  ) {
    return false;
  }

  return kind === "rescue"
    ? target.shipState.status === "sinking"
    : repairable(target, itemId);
}

function coin() {
  if (!globalThis.crypto?.getRandomValues) {
    fail("コイン判定に必要な乱数機能を利用できません。");
  }

  const value = new Uint32Array(1);
  globalThis.crypto.getRandomValues(value);

  return (value[0] & 1) === 1;
}

function rescueCanContinue(task, rescuer, target) {
  const kind = taskKind(task);

  return (
    rescuer.instanceId !== target.instanceId &&
    hasPosition(rescuer) &&
    !["sinking", "sunk"].includes(rescuer.shipState.status) &&
    targetEligible(target, kind, task.itemId) &&
    rescuer.shipState.rescueTaskId === task.id &&
    target.shipState.rescueTaskId === task.id &&
    Math.hypot(
      rescuer.x - target.x,
      rescuer.y - target.y
    ) <= 2
  );
}

export function initializeRescueState(scene) {
  if (
    !scene ||
    !Array.isArray(scene.instances) ||
    !Number.isSafeInteger(scene.turn?.number) ||
    scene.turn.number < 1
  ) {
    fail("救助・修復の現在ラウンドが不正です。");
  }

  scene.rescuePlans ??= [];
  scene.rescueTasks ??= [];

  if (
    !Array.isArray(scene.rescuePlans) ||
    !Array.isArray(scene.rescueTasks)
  ) {
    fail("救助・修復の保存形式が不正です。");
  }

  const taskIds = new Set();
  const activeParticipants = new Set();

  for (const task of scene.rescueTasks) {
    if (
      !task ||
      typeof task !== "object" ||
      Array.isArray(task) ||
      typeof task.id !== "string" ||
      !task.id.trim() ||
      taskIds.has(task.id) ||
      typeof task.rescuerId !== "string" ||
      !task.rescuerId.trim() ||
      typeof task.targetId !== "string" ||
      !task.targetId.trim() ||
      task.rescuerId === task.targetId ||
      !Number.isSafeInteger(task.startedTurn) ||
      task.startedTurn < 1 ||
      task.startedTurn > scene.turn.number ||
      !["active", "success", "failure", "interrupted"]
        .includes(task.status)
    ) {
      fail("救助・修復任務の保存値が不正です。");
    }

    const kind = taskKind(task);
    taskIds.add(task.id);

    const rescuer = findUnit(scene, task.rescuerId);
    const target = findUnit(scene, task.targetId);

    if (task.status === "active") {
      if (
        task.resolvedTurn !== null ||
        task.coinHeads !== null ||
        task.guaranteed !== false ||
        task.interruptionReason !== undefined ||
        task.pausedMinutesBackfilled !== undefined ||
        task.repairReport !== undefined
      ) {
        fail("継続中の任務に終了記録があります。");
      }

      for (const id of [task.rescuerId, task.targetId]) {
        if (activeParticipants.has(id)) {
          fail("同じ艦船が複数の任務に参加しています。");
        }

        activeParticipants.add(id);
      }

      if (!rescueCanContinue(task, rescuer, target)) {
        fail("任務と艦船の保存状態が一致していません。");
      }

      continue;
    }

    if (
      !Number.isSafeInteger(task.resolvedTurn) ||
      task.resolvedTurn < task.startedTurn ||
      task.resolvedTurn > scene.turn.number
    ) {
      fail("任務の終了ラウンドが不正です。");
    }

    if (
      rescuer.shipState.rescueTaskId === task.id ||
      target.shipState.rescueTaskId === task.id
    ) {
      fail("終了した任務が艦船を拘束しています。");
    }

    if (task.status === "interrupted") {
      const expectedBackfill = kind === "rescue"
        ? (task.resolvedTurn - task.startedTurn) *
          TURN_DURATION_MINUTES
        : 0;

      if (
        typeof task.interruptionReason !== "string" ||
        !task.interruptionReason.trim() ||
        !Number.isSafeInteger(expectedBackfill) ||
        task.pausedMinutesBackfilled !== expectedBackfill ||
        task.coinHeads !== null ||
        task.guaranteed !== false ||
        task.repairReport !== undefined
      ) {
        fail("任務中断の保存記録が不正です。");
      }

      continue;
    }

    if (
      task.resolvedTurn < task.startedTurn + 1 ||
      typeof task.guaranteed !== "boolean" ||
      task.interruptionReason !== undefined ||
      task.pausedMinutesBackfilled !== undefined
    ) {
      fail("任務判定の終了記録が不正です。");
    }

    if (task.guaranteed) {
      if (
        task.coinHeads !== null ||
        task.status !== "success"
      ) {
        fail("必ず成功する任務の記録が不正です。");
      }
    } else if (
      typeof task.coinHeads !== "boolean" ||
      task.status !== (
        task.coinHeads ? "success" : "failure"
      )
    ) {
      fail("任務のコイン結果と終了状態が一致しません。");
    }

    if (kind === "equipment-repair") {
      const report = task.repairReport;
      const success = task.status === "success";

      if (
        !report ||
        report.version !== 1 ||
        report.kind !== "equipment-external-repair" ||
        report.itemId !== task.itemId ||
        report.success !== success ||
        report.outcome !== (
          success ? "repaired" : "destroyed"
        ) ||
        report.before?.damaged !== true ||
        report.before?.destroyed !== false ||
        report.after?.damaged !== !success ||
        report.after?.destroyed !== !success
      ) {
        fail("設備修復の適用履歴が不正です。");
      }
    } else if (task.repairReport !== undefined) {
      fail("艦船救助に設備修復結果が保存されています。");
    }
  }

  for (const unit of scene.instances) {
    if (unit.branch !== "navy") continue;

    if (!unit.shipState) {
      fail("艦船の任務状態が初期化されていません。");
    }

    const taskId = unit.shipState.rescueTaskId;

    if (
      taskId !== null &&
      !scene.rescueTasks.some(task =>
        task.id === taskId &&
        task.status === "active" &&
        [task.rescuerId, task.targetId]
          .includes(unit.instanceId)
      )
    ) {
      fail("艦船に対応する継続任務がありません。");
    }
  }

  const plannedParticipants = new Set();

  for (const plan of scene.rescuePlans) {
    if (
      !plan ||
      typeof plan !== "object" ||
      Array.isArray(plan) ||
      typeof plan.rescuerId !== "string" ||
      typeof plan.targetId !== "string" ||
      plan.rescuerId === plan.targetId ||
      plan.turnNumber !== scene.turn.number
    ) {
      fail("救助・修復計画の保存値が不正です。");
    }

    taskKind(plan);
    findUnit(scene, plan.rescuerId);
    findUnit(scene, plan.targetId);

    for (const id of [plan.rescuerId, plan.targetId]) {
      if (
        plannedParticipants.has(id) ||
        activeParticipants.has(id)
      ) {
        fail("同じ艦船が複数の任務計画に参加しています。");
      }

      plannedParticipants.add(id);
    }
  }
}

export function startPlannedRescues(scene) {
  for (const plan of scene.rescuePlans) {
    if (plan.turnNumber !== scene.turn.number) {
      fail("別ラウンドの任務計画が混在しています。");
    }

    const kind = taskKind(plan);
    const rescuer = findUnit(scene, plan.rescuerId);
    const target = findUnit(scene, plan.targetId);

    const valid =
      canRescue(rescuer) &&
      target.shipState.rescueTaskId === null &&
      targetEligible(target, kind, plan.itemId) &&
      rescuer.instanceId !== target.instanceId &&
      Math.hypot(
        rescuer.x - target.x,
        rescuer.y - target.y
      ) <= 2;

    if (!valid) continue;

    if (!globalThis.crypto?.randomUUID) {
      fail("任務の識別番号を生成できません。");
    }

    const task = {
      id: globalThis.crypto.randomUUID(),
      kind,
      rescuerId: rescuer.instanceId,
      targetId: target.instanceId,
      startedTurn: scene.turn.number,
      status: "active",
      resolvedTurn: null,
      coinHeads: null,
      guaranteed: false
    };

    if (kind === "equipment-repair") {
      task.itemId = plan.itemId;
    }

    scene.rescueTasks.push(task);

    rescuer.shipState.rescueTaskId = task.id;
    target.shipState.rescueTaskId = task.id;
  }

  scene.rescuePlans = [];
}

export function isSinkingTimerPaused(scene, unit) {
  if (unit.branch !== "navy") return false;

  return scene.rescueTasks.some(task =>
    taskKind(task) === "rescue" &&
    task.status === "active" &&
    task.targetId === unit.instanceId &&
    task.id === unit.shipState.rescueTaskId
  );
}

export function interruptRescueTask(
  scene,
  taskId,
  reason = "state-changed"
) {
  if (typeof reason !== "string" || !reason.trim()) {
    fail("任務中断の理由が不正です。");
  }

  const task = scene.rescueTasks.find(
    item => item.id === taskId
  );

  if (!task) fail("任務が見つかりません。");

  if (task.status !== "active") {
    return {
      taskId: task.id,
      interrupted: false,
      alreadyFinished: true
    };
  }

  const kind = taskKind(task);

  if (
    !Number.isSafeInteger(scene.turn.number) ||
    !Number.isSafeInteger(task.startedTurn) ||
    task.startedTurn < 1 ||
    scene.turn.number < task.startedTurn
  ) {
    fail("任務の開始ラウンドが不正です。");
  }

  const rescuer = findUnit(scene, task.rescuerId);
  const target = findUnit(scene, task.targetId);
  const elapsedBefore = target.shipState.sinkingElapsedMinutes;

  if (
    !Number.isSafeInteger(elapsedBefore) ||
    elapsedBefore < 0
  ) {
    fail("沈没寸前の経過時間が不正です。");
  }

  // 设备修复没有暂停自然沉没计时，因此不补算。
  const pausedMinutes = kind === "rescue"
    ? (scene.turn.number - task.startedTurn) *
      TURN_DURATION_MINUTES
    : 0;

  const elapsedAfter = elapsedBefore + pausedMinutes;

  if (
    !Number.isSafeInteger(pausedMinutes) ||
    !Number.isSafeInteger(elapsedAfter)
  ) {
    fail("任務の停止期間が範囲外です。");
  }

  task.status = "interrupted";
  task.resolvedTurn = scene.turn.number;
  task.interruptionReason = reason.trim();
  task.pausedMinutesBackfilled = pausedMinutes;
  task.coinHeads = null;
  task.guaranteed = false;

  if (rescuer.shipState.rescueTaskId === task.id) {
    rescuer.shipState.rescueTaskId = null;
  }

  if (target.shipState.rescueTaskId === task.id) {
    target.shipState.rescueTaskId = null;
  }

  target.shipState.sinkingElapsedMinutes = elapsedAfter;

  let naturallySunk = false;

  if (
    kind === "rescue" &&
    target.shipState.status === "sinking" &&
    elapsedAfter >= 4 * TURN_DURATION_MINUTES
  ) {
    target.shipState.status = "sunk";
    naturallySunk = true;
  }

  return {
    taskId: task.id,
    kind,
    interrupted: true,
    alreadyFinished: false,
    reason: task.interruptionReason,
    pausedMinutesBackfilled: pausedMinutes,
    sinkingElapsedBefore: elapsedBefore,
    sinkingElapsedAfter: elapsedAfter,
    naturallySunk
  };
}

export function reconcileActiveRescues(scene) {
  if (
    !scene ||
    !Array.isArray(scene.instances) ||
    !Array.isArray(scene.rescueTasks) ||
    !Number.isSafeInteger(scene.turn?.number) ||
    scene.turn.number < 1
  ) {
    fail("任務継続判定の場面が不正です。");
  }

  const results = [];

  for (const task of scene.rescueTasks) {
    if (task.status !== "active") continue;

    const rescuer = findUnit(scene, task.rescuerId);
    const target = findUnit(scene, task.targetId);

    if (!rescueCanContinue(task, rescuer, target)) {
      results.push(interruptRescueTask(
        scene,
        task.id,
        "continuation-conditions-lost"
      ));
    }
  }

  return results;
}

export function resolveRescuesAtSpecial(scene) {
  if (scene.turn.phaseId !== "special") {
    fail("任務判定は特殊段階でのみ実行できます。");
  }

  const results = [];

  for (const task of scene.rescueTasks) {
    if (
      task.status !== "active" ||
      scene.turn.number < task.startedTurn + 1
    ) {
      continue;
    }

    const kind = taskKind(task);
    const rescuer = findUnit(scene, task.rescuerId);
    const target = findUnit(scene, task.targetId);

    if (!rescueCanContinue(task, rescuer, target)) {
      fail("任務の継続条件が一致していません。");
    }

    const guaranteed = readShipProfile(rescuer).isRepairShip;
    const heads = guaranteed ? null : coin();
    const success = guaranteed || heads === true;

    let repairReport;

    if (kind === "equipment-repair") {
      repairReport = applyExternalEquipmentRepairResult(
        target,
        task.itemId,
        success
      );
    } else {
      target.shipState.status = success ? "heavy" : "sunk";
    }

    task.guaranteed = guaranteed;
    task.coinHeads = heads;
    task.resolvedTurn = scene.turn.number;
    task.status = success ? "success" : "failure";

    if (repairReport) {
      task.repairReport = copy(repairReport);
    }

    rescuer.shipState.rescueTaskId = null;
    target.shipState.rescueTaskId = null;

    results.push({
      resultType: kind === "equipment-repair"
        ? "equipment-repair-roll"
        : "rescue-roll",
      taskId: task.id,
      kind,
      success,
      guaranteed,
      coinHeads: heads,
      ...(repairReport ? { repairReport } : {})
    });
  }

  return results;
}

function savePlan(scene, rescuerId, targetId, itemId) {
  if (scene.turn.phaseId !== "movement") {
    fail("救助・修復計画は移動段階で指定してください。");
  }

  const kind = itemId === undefined
    ? "rescue"
    : "equipment-repair";

  const rescuer = findUnit(scene, rescuerId);
  const target = findUnit(scene, targetId);

  assertManualControl(scene, [rescuer]);
  assertIdentifiedTargets(scene, [target]);

  if (rescuerId === targetId) {
    fail("自艦への外部救助・修復は指定できません。");
  }

  if (!canRescue(rescuer)) {
    fail("この艦船は救助・修復を開始できません。");
  }

  if (
    target.shipState.rescueTaskId !== null ||
    !targetEligible(target, kind, itemId)
  ) {
    fail("対象艦または設備項目は任務を開始できません。");
  }

  const plan = {
    kind,
    rescuerId,
    targetId,
    turnNumber: scene.turn.number
  };

  if (kind === "equipment-repair") {
    plan.itemId = itemId;
  }

  taskKind(plan);

  scene.rescuePlans = scene.rescuePlans.filter(
    old => old.rescuerId !== rescuerId
  );

  if (scene.rescuePlans.some(old =>
    [old.rescuerId, old.targetId].some(id =>
      id === rescuerId || id === targetId
    )
  )) {
    fail("同じ艦船を複数の任務計画に参加させられません。");
  }

  scene.rescuePlans.push(plan);
}

export function createRescueFeatures(getState, commit) {
  return {
    planRescue(rescuerId, targetId) {
      commit(scene => {
        savePlan(scene, rescuerId, targetId);
      });
    },

    planEquipmentRepair(rescuerId, targetId, itemId) {
      commit(scene => {
        savePlan(scene, rescuerId, targetId, itemId);
      });
    },

    cancelRescuePlan(rescuerId) {
      commit(scene => {
        if (scene.turn.phaseId !== "movement") {
          fail("任務計画の取消は移動段階で実行してください。");
        }

        const rescuer = findUnit(scene, rescuerId);
        assertManualControl(scene, [rescuer]);

        scene.rescuePlans = scene.rescuePlans.filter(
          plan => plan.rescuerId !== rescuerId
        );
      });
    }
  };
}
