import {
  ensureShipRuntime,
  applyShipFireFloodingPhase
} from "./ship-runtime.js";

import {
  initializeRescueState,
  reconcileActiveRescues
} from "./simulation-rescue.js";

const copy = value => JSON.parse(JSON.stringify(value));
/**
 * 起火／进水子流程的场景级记录。
 * 仅补缺失字段，不清空既有记录。
 * 不修改initialScene，不推进阶段。
 */
export function initializeSpecialRuntime(scene) {
  if (
    !scene.turn ||
    !Number.isSafeInteger(scene.turn.number) ||
    scene.turn.number < 1
  ) {
    throw new Error("特殊処理の現在ラウンドが不正です。");
  }

  if (scene.specialRuntime === undefined) {
    scene.specialRuntime = {
      version: 1,
      lastFireFloodingTurn: 0,
      records: []
    };
  }

  const runtime = scene.specialRuntime;

  if (
    !runtime ||
    typeof runtime !== "object" ||
    Array.isArray(runtime) ||
    runtime.version !== 1 ||
    !Number.isSafeInteger(runtime.lastFireFloodingTurn) ||
    runtime.lastFireFloodingTurn < 0 ||
    runtime.lastFireFloodingTurn > scene.turn.number ||
    !Array.isArray(runtime.records)
  ) {
    throw new Error("特殊処理の保存状態が不正です。");
  }

  const recordedTurns = new Set();
  let latestTurn = 0;

  for (const record of runtime.records) {
    if (
      !record ||
      record.version !== 1 ||
      record.step !== "fire-flooding" ||
      record.phaseId !== "special" ||
      !Number.isSafeInteger(record.turnNumber) ||
      record.turnNumber < 1 ||
      record.turnNumber > scene.turn.number ||
      !Array.isArray(record.shipReports) ||
      !Array.isArray(record.rescueInterruptions) ||
      recordedTurns.has(record.turnNumber)
    ) {
      throw new Error("火災・浸水の処理履歴が不正です。");
    }

    recordedTurns.add(record.turnNumber);
    latestTurn = Math.max(latestTurn, record.turnNumber);

    const targetIds = new Set();

    for (const report of record.shipReports) {
      if (
        !report ||
        report.version !== 1 ||
        typeof report.targetId !== "string" ||
        !report.targetId.trim() ||
        targetIds.has(report.targetId) ||
        report.turnNumber !== record.turnNumber ||
        report.phaseId !== "special" ||
        typeof report.skipped !== "boolean" ||
        !Array.isArray(report.rolls) ||
        !Array.isArray(report.events)
      ) {
        throw new Error("艦船の特殊処理報告が不正です。");
      }

      targetIds.add(report.targetId);

      const rolledTypes = new Set();

      for (const roll of report.rolls) {
        if (
          !roll ||
          !["fire", "flooding"].includes(roll.type) ||
          rolledTypes.has(roll.type) ||
          typeof roll.coin !== "boolean" ||
          roll.success !== roll.coin
        ) {
          throw new Error("損管のコイン記録が不正です。");
        }

        rolledTypes.add(roll.type);
      }

      if (
        report.skipped &&
        (
          report.rolls.length !== 0 ||
          report.events.length !== 0
        )
      ) {
        throw new Error(
          "処理を省略した艦船に特殊判定が記録されています。"
        );
      }
    }
  }

  if (latestTurn !== runtime.lastFireFloodingTurn) {
    throw new Error(
      "火災・浸水の履歴と処理済みラウンドが一致していません。"
    );
  }

  // 非沉没舰的处理记录不能落后于场景级完成记录。
  // 老存档尚无场景记录时，不凭空补造历史。
  if (latestTurn > 0) {
    for (const unit of scene.instances) {
      if (
        unit.branch === "navy" &&
        unit.shipState?.status !== "sunk" &&
        (
          !unit.shipState?.effects ||
          unit.shipState.effects.lastResolvedTurn < latestTurn
        )
      ) {
        throw new Error(
          "艦船の特殊状態と場面の処理履歴が一致していません。"
        );
      }
    }
  }
}


/**
 * 特殊阶段中的起火／进水子流程。
 *
 * 输入scene必须是正式保存事务的工作副本。
 * 内部再建立副本，保证任一舰船处理失败时，
 * 不把前面舰船的半结算写回。
 *
 * 不处理：
 * - 正常到期的救助抽签；
 * - 设备损管；
 * - 回合结束自然沉没计时；
 * - 阶段推进与场景时间推进。
 *
 * 返回的随机报告必须由调用方同事务保存。
 */
export function applyFireFloodingSpecialStep(
  scene,
  coinSource
) {
  if (
    !scene ||
    !Array.isArray(scene.instances) ||
    !scene.turn ||
    !Number.isSafeInteger(scene.turn.number) ||
    scene.turn.number < 1 ||
    scene.turn.phaseId !== "special"
  ) {
    throw new Error("特殊効果判定段階の推演状態が不正です。");
  }

  if (
    coinSource !== undefined &&
    typeof coinSource !== "function"
  ) {
    throw new Error("特殊状態のコイン関数が不正です。");
  }

  const working = copy(scene);

    initializeSpecialRuntime(working);

  if (
    working.specialRuntime.lastFireFloodingTurn >=
    working.turn.number
  ) {
    throw new Error(
      "このラウンドの火災・浸水処理はすでに完了しています。"
    );
  }

  
  for (const unit of working.instances) {
    ensureShipRuntime(unit);
  }

  // 先检查原任务有效，不能靠本次处理掩盖损坏的保存数据。
  initializeRescueState(working);

  const shipReports = [];

  for (const unit of working.instances) {
    if (unit.branch !== "navy") continue;

    shipReports.push(
      applyShipFireFloodingPhase(
        unit,
        {
          turnNumber: working.turn.number,
          phaseId: working.turn.phaseId
        },
        coinSource
      )
    );
  }

  // 全部舰船词条处理后，再统一处理中断。
  // 救助舰失控时，补回被救目标的暂停时间。
  const rescueInterruptions = reconcileActiveRescues(working);

  for (const unit of working.instances) {
    ensureShipRuntime(unit);
  }

  initializeRescueState(working);

  const report = {
    version: 1,
    step: "fire-flooding",
    turnNumber: working.turn.number,
    phaseId: working.turn.phaseId,
    shipReports,
    rescueInterruptions
  };

  // 仅在整个子流程成功后写回。
    // 报告和状态属于同一次处理。
  // 后续正式commit会把它们一起保存。
  working.specialRuntime.records.push(copy(report));
  working.specialRuntime.lastFireFloodingTurn =
    working.turn.number;

  initializeSpecialRuntime(working);

  // 仅在整个子流程成功后写回事务候选副本。
  scene.instances = working.instances;
  scene.rescueTasks = working.rescueTasks;
  scene.specialRuntime = working.specialRuntime;

  return copy(report);

}
