import { readShipProfile } from "./ship-runtime.js";
import { TURN_DURATION_MINUTES } from "./rules-engine.js";


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
  if (
    !scene ||
    !Array.isArray(scene.instances) ||
    !Number.isSafeInteger(scene.turn?.number) ||
    scene.turn.number < 1
  ) {
    fail("救助の現在ラウンドまたは場面が不正です。");
  }

  // 只补缺失字段，不清除既有任务和计划。
  scene.rescuePlans ??= [];
  scene.rescueTasks ??= [];

  if (
    !Array.isArray(scene.rescuePlans) ||
    !Array.isArray(scene.rescueTasks)
  ) {
    fail("救助の保存形式が不正です。");
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
      fail("救助任務の保存値が不正です。");
    }

    taskIds.add(task.id);

    const rescuer = findUnit(scene, task.rescuerId);
    const target = findUnit(scene, task.targetId);

    if (task.status === "active") {
      if (
        task.resolvedTurn !== null ||
        task.coinHeads !== null ||
        task.guaranteed !== false ||
        task.interruptionReason !== undefined ||
        task.pausedMinutesBackfilled !== undefined
      ) {
        fail("継続中の救助任務に終了記録があります。");
      }

      for (const id of [task.rescuerId, task.targetId]) {
        if (activeParticipants.has(id)) {
          fail("同じ艦船が複数の救助任務に参加しています。");
        }

        activeParticipants.add(id);
      }

      if (!rescueCanContinue(task, rescuer, target)) {
        fail("救助任務と艦船の保存状態が一致していません。");
      }

      continue;
    }

    if (
      !Number.isSafeInteger(task.resolvedTurn) ||
      task.resolvedTurn < task.startedTurn ||
      task.resolvedTurn > scene.turn.number
    ) {
      fail("救助任務の終了ラウンドが不正です。");
    }

    // 已结束任务不能继续锁住任一方。
    // 允许双方已经参加其他的新任务。
    if (
      rescuer.shipState.rescueTaskId === task.id ||
      target.shipState.rescueTaskId === task.id
    ) {
      fail("終了した救助任務が艦船を拘束しています。");
    }

    if (task.status === "interrupted") {
      const expectedBackfill =
        (task.resolvedTurn - task.startedTurn) *
        TURN_DURATION_MINUTES;

      if (
        typeof task.interruptionReason !== "string" ||
        !task.interruptionReason.trim() ||
        !Number.isSafeInteger(expectedBackfill) ||
        !Number.isSafeInteger(task.pausedMinutesBackfilled) ||
        task.pausedMinutesBackfilled !== expectedBackfill ||
        task.coinHeads !== null ||
        task.guaranteed !== false
      ) {
        fail("救助中断の保存記録が不正です。");
      }

      continue;
    }

    // 正常救助最早在开始后的下一回合判定。
    // 校验历史结果，不重新掷硬币，也不重新判定当前舰种。
    if (
      task.resolvedTurn < task.startedTurn + 1 ||
      typeof task.guaranteed !== "boolean" ||
      task.interruptionReason !== undefined ||
      task.pausedMinutesBackfilled !== undefined
    ) {
      fail("救助判定の終了記録が不正です。");
    }

    if (task.guaranteed) {
      if (
        task.coinHeads !== null ||
        task.status !== "success"
      ) {
        fail("必ず成功する救助の記録が不正です。");
      }
    } else if (
      typeof task.coinHeads !== "boolean" ||
      task.status !== (
        task.coinHeads ? "success" : "failure"
      )
    ) {
      fail("救助のコイン結果と終了状態が一致しません。");
    }
  }

  for (const unit of scene.instances) {
    if (unit.branch !== "navy") continue;

    if (!unit.shipState) {
      fail("艦船の救助状態が初期化されていません。");
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
 * 当前任务是否仍能继续。
 * 救助双方挨打本身不导致中断。
 * 救助舰无法行动、目标不再濒临沉没、
 * 任务引用失配或距离条件不再满足时，不能继续。
 */
function rescueCanContinue(task, rescuer, target) {
  return (
    rescuer.instanceId !== target.instanceId &&
    hasPosition(rescuer) &&
    hasPosition(target) &&
    !["sinking", "sunk"].includes(rescuer.shipState.status) &&
    target.shipState.status === "sinking" &&
    rescuer.shipState.rescueTaskId === task.id &&
    target.shipState.rescueTaskId === task.id &&
    Math.hypot(
      rescuer.x - target.x,
      rescuer.y - target.y
    ) <= 2
  );
}

/**
 * 中断一个救助任务，并补算救助期间暂停的自然沉没时间。
 *
 * 必须在正式保存事务的工作副本上调用。
 * 不掷硬币、不推进时间，不独立保存。
 *
 * 计时约定：
 * - sinkingElapsedMinutes保存实际已累计的沉没时间；
 * - 活跃救助期间，回合结束模块不得增加这个值；
 * - 中断时补回已经过去的完整回合；
 * - 当前尚未结束的回合不提前计入。
 */
export function interruptRescueTask(
  scene,
  taskId,
  reason = "state-changed"
) {
  if (
    typeof reason !== "string" ||
    !reason.trim()
  ) {
    fail("救助中断の理由が不正です。");
  }

  const task = scene.rescueTasks.find(
    item => item.id === taskId
  );

  if (!task) {
    fail("救助任務が見つかりません。");
  }

  // 已终结任务不重复补算暂停时间。
  if (task.status !== "active") {
    return {
      taskId: task.id,
      interrupted: false,
      alreadyFinished: true
    };
  }

  if (
    !Number.isSafeInteger(scene.turn.number) ||
    !Number.isSafeInteger(task.startedTurn) ||
    task.startedTurn < 1 ||
    scene.turn.number < task.startedTurn
  ) {
    fail("救助の開始ラウンドと現在のラウンドが不正です。");
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

  const pausedMinutes =
    (scene.turn.number - task.startedTurn) *
    TURN_DURATION_MINUTES;

  const elapsedAfter = elapsedBefore + pausedMinutes;

  if (
    !Number.isSafeInteger(pausedMinutes) ||
    !Number.isSafeInteger(elapsedAfter) ||
    elapsedAfter < 0
  ) {
    fail("救助の停止期間の換算結果が範囲外です。");
  }

  // 已计算完所有值，再更新任务及双方引用。
  task.status = "interrupted";
  task.resolvedTurn = scene.turn.number;
  task.interruptionReason = reason.trim();
  task.pausedMinutesBackfilled = pausedMinutes;

  // 中断不是失败抽签，不能伪造反面结果。
  task.coinHeads = null;
  task.guaranteed = false;

  if (rescuer.shipState.rescueTaskId === task.id) {
    rescuer.shipState.rescueTaskId = null;
  }

  if (target.shipState.rescueTaskId === task.id) {
    target.shipState.rescueTaskId = null;
  }

  // 补算只恢复被暂停的时间，不重新开始沉没倒计时。
  target.shipState.sinkingElapsedMinutes = elapsedAfter;

  let naturallySunk = false;

  if (
    target.shipState.status === "sinking" &&
    elapsedAfter >= 4 * TURN_DURATION_MINUTES
  ) {
    target.shipState.status = "sunk";
    naturallySunk = true;
  }

  return {
    taskId: task.id,
    interrupted: true,
    alreadyFinished: false,
    reason: task.interruptionReason,
    pausedMinutesBackfilled: pausedMinutes,
    sinkingElapsedBefore: elapsedBefore,
    sinkingElapsedAfter: elapsedAfter,
    naturallySunk
  };
}

/**
 * 正式攻击／特殊效果应用后调用，清理不能继续的救助。
 * 必须和导致状态变化的处理处于同一个保存事务。
 *
 * 不调用initializeRescueState：
 * 状态刚发生变化时，失效任务尚未清理，
 * 应先处理中断，再进行完整保存校验。
 */
export function reconcileActiveRescues(scene) {
  if (
    !scene ||
    !Array.isArray(scene.instances) ||
    !Array.isArray(scene.rescueTasks) ||
    !Number.isSafeInteger(scene.turn?.number) ||
    scene.turn.number < 1
  ) {
    fail("救助継続判定の推演状態が不正です。");
  }

  const results = [];

  for (const task of scene.rescueTasks) {
    if (task.status !== "active") continue;

    const rescuer = findUnit(scene, task.rescuerId);
    const target = findUnit(scene, task.targetId);

    if (!rescueCanContinue(task, rescuer, target)) {
      results.push(
        interruptRescueTask(
          scene,
          task.id,
          "continuation-conditions-lost"
        )
      );
    }
  }

  return results;
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

    if (!rescueCanContinue(task, rescuer, target)) {
      fail("救助任務の継続条件が一致していません。");
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
      resultType: "rescue-roll",
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
