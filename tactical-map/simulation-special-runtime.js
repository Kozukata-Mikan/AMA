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
  scene.instances = working.instances;
  scene.rescueTasks = working.rescueTasks;

  return report;
}
