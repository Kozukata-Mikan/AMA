import { readShipProfile } from "./ship-runtime.js";

import {
  assertManualControl,
  assertIdentifiedTargets
} from "./simulation-features.js";

function fail(message) {
  throw new Error(message);
}

function findUnit(scene, id) {
  const unit = scene.instances.find(
    item => item.instanceId === id
  );

  if (!unit || unit.branch !== "navy") {
    fail("救助対象または救助艦が見つかりません。");
  }

  return unit;
}

function hasPosition(unit) {
  return Number.isFinite(unit.x) && Number.isFinite(unit.y);
}

function canRescue(unit) {
  return (
    hasPosition(unit) &&
    !["sinking", "sunk"].includes(unit.shipState?.status) &&
    unit.shipState?.rescueTaskId === null
  );
}

function coin() {
  if (!globalThis.crypto?.getRandomValues) {
    fail("コイン判定に必要な乱数機能を利用できません。");
  }

  const value = new Uint32Array(1);
  crypto.getRandomValues(value);

  return (value[0] & 1) === 1;
}

export function initializeRescueState(scene) {
  // 旧存档仅补缺失字段，不清除既有任务。
  scene.rescuePlans ??= [];
  scene.rescueTasks ??= [];

  if (
    !Array.isArray(scene.rescuePlans) ||
    !Array.isArray(scene.rescueTasks)
  ) {
    fail("救助の保存形式が不正です。");
  }

  const taskIds = new Set();

  for (const task of scene.rescueTasks) {
    if (
      !task ||
      typeof task.id !== "string" ||
      taskIds.has(task.id) ||
      !Number.isInteger(task.startedTurn) ||
      task.startedTurn < 1 ||
      !["active", "success", "failure"].includes(task.status)
    ) {
      fail("救助任務の保存値が不正です。");
    }

    taskIds.add(task.id);

    const rescuer = findUnit(scene, task.rescuerId);
    const target = findUnit(scene, task.targetId);

    if (task.status === "active") {
      if (
        rescuer.instanceId === target.instanceId ||
        rescuer.shipState.rescueTaskId !== task.id ||
        target.shipState.rescueTaskId !== task.id ||
        target.shipState.status !== "sinking"
      ) {
        fail("救助任務と艦船の保存状態が一致していません。");
      }
    }
  }

  for (const unit of scene.instances) {
    if (
      unit.branch === "navy" &&
      unit.shipState.rescueTaskId !== null &&
      !scene.rescueTasks.some(task =>
        task.id === unit.shipState.rescueTaskId &&
        task.status === "active" &&
        [task.rescuerId, task.targetId].includes(unit.instanceId)
      )
    ) {
      fail("艦船に対応する救助任務がありません。");
    }
  }
}

/**
 * 移动成功后调用。
 * 不满足最终距离的计划不开始救助，也不撤销已经成功的移动。
 * 不进行随机判定，不推进回合，不累计沉没时间。
 */
export function startPlannedRescues(scene) {
  for (const plan of scene.rescuePlans) {
    if (plan.turnNumber !== scene.turn.number) {
      fail("別ラウンドの救助計画が混在しています。");
    }

    const rescuer = findUnit(scene, plan.rescuerId);
    const target = findUnit(scene, plan.targetId);

    const valid =
      canRescue(rescuer) &&
      hasPosition(target) &&
      target.shipState.status === "sinking" &&
      target.shipState.rescueTaskId === null &&
      Math.hypot(
        rescuer.x - target.x,
        rescuer.y - target.y
      ) <= 2;

    if (!valid) {
      // 不使用包含目标名称、坐标的失败信息。
      continue;
    }

    if (!globalThis.crypto?.randomUUID) {
      fail("救助任務の識別番号を生成できません。");
    }

    const task = {
      id: crypto.randomUUID(),
      rescuerId: rescuer.instanceId,
      targetId: target.instanceId,
      startedTurn: scene.turn.number,
      status: "active",
      resolvedTurn: null,
      coinHeads: null,
      guaranteed: false
    };

    scene.rescueTasks.push(task);

    rescuer.shipState.rescueTaskId = task.id;
    target.shipState.rescueTaskId = task.id;

    // 保留已经经过的沉没时间，不清零。
  }

  scene.rescuePlans = [];
}

/**
 * 未来正式结束回合时，计时模块必须先使用此检查。
 * 救助期间不能给濒临沉没舰增加沉没时间。
 */
export function isSinkingTimerPaused(scene, unit) {
  if (unit.branch !== "navy") return false;

  return scene.rescueTasks.some(task =>
    task.status === "active" &&
    task.targetId === unit.instanceId &&
    task.id === unit.shipState.rescueTaskId
  );
}

/**
 * 正式特殊阶段的内部结算接口。
 * 开始当回合为第1回合，下一个回合为第2回合。
 * 保存事务外不应单独调用本函数。
 */
export function resolveRescuesAtSpecial(scene) {
  if (scene.turn.phaseId !== "special") {
    fail("救助判定は特殊効果判定段階でのみ実行できます。");
  }

  const results = [];

  for (const task of scene.rescueTasks) {
    if (
      task.status !== "active" ||
      scene.turn.number < task.startedTurn + 1
    ) {
      continue;
    }

    const rescuer = findUnit(scene, task.rescuerId);
    const target = findUnit(scene, task.targetId);

    if (
      rescuer.shipState.rescueTaskId !== task.id ||
      target.shipState.rescueTaskId !== task.id ||
      target.shipState.status !== "sinking"
    ) {
      // 救助中断规则未定义，不能擅自决定成功或失败。
      fail("救助中の状態が変化しています。中断規則の定義が必要です。");
    }

    const guaranteed = readShipProfile(rescuer).isRepairShip;
    const heads = guaranteed ? null : coin();
    const success = guaranteed || heads === true;

    task.guaranteed = guaranteed;
    task.coinHeads = heads;
    task.resolvedTurn = scene.turn.number;
    task.status = success ? "success" : "failure";

    target.shipState.status = success ? "heavy" : "sunk";

    rescuer.shipState.rescueTaskId = null;
    target.shipState.rescueTaskId = null;

    // 成功不恢复耐性，也不重置已保存的沉没经过时间。
    results.push({
      taskId: task.id,
      success,
      guaranteed,
      coinHeads: heads
    });
  }

  return results;
}

export function createRescueFeatures(getState, commit) {
  return {
    planRescue(rescuerId, targetId) {
      commit(scene => {
        if (scene.turn.phaseId !== "movement") {
          fail("救助計画は移動段階でのみ指定できます。");
        }

        const rescuer = findUnit(scene, rescuerId);
        const target = findUnit(scene, targetId);

        assertManualControl(scene, [rescuer]);
        assertIdentifiedTargets(scene, [target]);

        if (rescuerId === targetId) {
          fail("自分自身を救助することはできません。");
        }

        if (!canRescue(rescuer)) {
          fail("この艦船は救助を開始できません。");
        }

        if (
          target.shipState.status !== "sinking" ||
          target.shipState.rescueTaskId !== null
        ) {
          fail("救助対象は救助中ではない沈没寸前の艦船に限られます。");
        }

        // 距离在移动结算后检查，不在提交时强制<=2。
        scene.rescuePlans = scene.rescuePlans.filter(
          plan => plan.rescuerId !== rescuerId
        );

        if (scene.rescuePlans.some(plan =>
          [plan.rescuerId, plan.targetId].some(id =>
            id === rescuerId || id === targetId
          )
        )) {
          fail("同じ艦船を複数の救助計画に参加させることはできません。");
        }

        scene.rescuePlans.push({
          rescuerId,
          targetId,
          turnNumber: scene.turn.number
        });
      });
    },

    cancelRescuePlan(rescuerId) {
      commit(scene => {
        if (scene.turn.phaseId !== "movement") {
          fail("救助計画の取消は移動段階でのみ実行できます。");
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
