import { TURN_DURATION_MINUTES } from "./rules-engine.js";

import { ensureShipRuntime } from "./ship-runtime.js";

import {
  initializeRescueState,
  reconcileActiveRescues,
  resolveRescuesAtSpecial,
  isSinkingTimerPaused
} from "./simulation-rescue.js";

const copy = value => JSON.parse(JSON.stringify(value));

function fail(message) {
  throw new Error(message);
}

function requireScene(scene, phaseId) {
  if (
    !scene ||
    !Array.isArray(scene.instances) ||
    !scene.turn ||
    !Number.isSafeInteger(scene.turn.number) ||
    scene.turn.number < 1 ||
    scene.turn.phaseId !== phaseId
  ) {
    fail("救助・沈没処理のラウンドまたは段階が不正です。");
  }
}

/**
 * 只补缺失的运行字段，不修改初始快照。
 *
 * 报告保存在完整推演状态的根字段。
 * getObservedScene目前采用字段白名单，
 * 不会自动把这些内部报告加入观察副本。
 */
export function initializeRescueRuntime(scene) {
  if (scene.rescueRuntime === undefined) {
    scene.rescueRuntime = {
      version: 1,
      lastSpecialTurn: 0,
      lastEndTurn: 0,
      records: []
    };
  }

  const runtime = scene.rescueRuntime;

  if (
    !runtime ||
    typeof runtime !== "object" ||
    Array.isArray(runtime) ||
    runtime.version !== 1 ||
    !Number.isSafeInteger(runtime.lastSpecialTurn) ||
    runtime.lastSpecialTurn < 0 ||
    !Number.isSafeInteger(runtime.lastEndTurn) ||
    runtime.lastEndTurn < 0 ||
    !Array.isArray(runtime.records)
  ) {
    fail("救助・沈没処理の保存状態が不正です。");
  }

  if (
    !scene.turn ||
    !Number.isSafeInteger(scene.turn.number) ||
    runtime.lastSpecialTurn > scene.turn.number ||
    runtime.lastEndTurn > scene.turn.number
  ) {
    fail("救助・沈没処理の記録が未来のラウンドになっています。");
  }

  const keys = new Set();

  for (const record of runtime.records) {
    if (
      !record ||
      record.version !== 1 ||
      !["rescue-special", "sinking-end"].includes(record.step) ||
      !Number.isSafeInteger(record.turnNumber) ||
      record.turnNumber < 1 ||
      record.turnNumber > scene.turn.number ||
      !Array.isArray(record.results)
    ) {
      fail("救助・沈没処理の履歴が不正です。");
    }

    const key = `${record.step}:${record.turnNumber}`;

    if (keys.has(key)) {
      fail("救助・沈没処理の履歴が重複しています。");
    }

    keys.add(key);
  }

  for (const [step, turn] of [
    ["rescue-special", runtime.lastSpecialTurn],
    ["sinking-end", runtime.lastEndTurn]
  ]) {
    const latestRecordedTurn = runtime.records
      .filter(record => record.step === step)
      .reduce(
        (latest, record) => Math.max(latest, record.turnNumber),
        0
      );

    if (latestRecordedTurn !== turn) {
      fail("救助・沈没処理の履歴と処理済みラウンドが一致していません。");
    }
  }
}

function validateUnits(scene) {
  for (const unit of scene.instances) {
    ensureShipRuntime(unit);
  }

  initializeRescueState(scene);
}

function writeBack(scene, working) {
  // 只写回本子流程负责的运行数据。
  // 不写回initialScene，不修改环境、回合或部署快照。
  scene.instances = working.instances;
  scene.rescueTasks = working.rescueTasks;
  scene.rescueRuntime = working.rescueRuntime;
}

/**
 * 正式特殊阶段中的救助子流程。
 *
 * 开始当回合算第1回合：
 * 第1回合只检查中断；
 * 第2回合进行AR必成或硬币判定。
 *
 * 内部报告与状态一起写回事务工作副本。
 * 不代表整个特殊阶段完成，不推进阶段。
 */
export function applyRescueSpecialStep(scene) {
  requireScene(scene, "special");

  const working = copy(scene);

  initializeRescueRuntime(working);

  if (
    working.rescueRuntime.lastSpecialTurn >= working.turn.number
  ) {
    fail("このラウンドの救助判定はすでに処理済みです。");
  }

  for (const unit of working.instances) {
    ensureShipRuntime(unit);
  }

  // 接受同一事务中其他特殊效果造成的状态变化。
  // 先处理中断，再校验仍活跃的任务。
  const interruptions = reconcileActiveRescues(working);

  initializeRescueState(working);

  const rescueResults = resolveRescuesAtSpecial(working);

  const report = {
    version: 1,
    step: "rescue-special",
    turnNumber: working.turn.number,
    results: [
      ...interruptions.map(result => ({
        ...result,
        resultType: "interruption"
      })),
      ...rescueResults
    ]
  };

  validateUnits(working);

  working.rescueRuntime.records.push(copy(report));
  working.rescueRuntime.lastSpecialTurn = working.turn.number;

  initializeRescueRuntime(working);

  writeBack(scene, working);

  return copy(report);
}

/**
 * 正式回合结束中的自然沉没计时子流程。
 *
 * 每次成功处理增加一个回合的30分钟。
 * 活跃救助目标暂停自然沉没计时。
 * 同回合重复调用会被拒绝。
 *
 * 不增加scene.turn.number，不修改环境时间，
 * 不代表整个回合结束处理已经完成。
 */
export function applySinkingEndStep(scene) {
  requireScene(scene, "end");

  const working = copy(scene);

  initializeRescueRuntime(working);
  validateUnits(working);

  if (
    working.rescueRuntime.lastEndTurn >= working.turn.number
  ) {
    fail("このラウンドの沈没時間はすでに処理済みです。");
  }

  // 不允许跳过当回合救助子处理，直接做回合结束计时。
  if (
    working.rescueRuntime.lastSpecialTurn !== working.turn.number
  ) {
    fail("このラウンドの救助判定が完了していません。");
  }

  const results = [];

  for (const unit of working.instances) {
    if (
      unit.branch !== "navy" ||
      unit.shipState.status !== "sinking"
    ) {
      continue;
    }

    const state = unit.shipState;
    const beforeMinutes = state.sinkingElapsedMinutes;
    const paused = isSinkingTimerPaused(working, unit);

    if (paused) {
      results.push({
        targetId: unit.instanceId,
        paused: true,
        addedMinutes: 0,
        beforeMinutes,
        afterMinutes: beforeMinutes,
        naturallySunk: false
      });

      continue;
    }

    const afterMinutes =
      beforeMinutes + TURN_DURATION_MINUTES;

    if (!Number.isFinite(afterMinutes)) {
      fail("沈没寸前の経過時間が範囲外です。");
    }

    state.sinkingElapsedMinutes = afterMinutes;

    const naturallySunk =
      afterMinutes >= 4 * TURN_DURATION_MINUTES;

    if (naturallySunk) {
      state.status = "sunk";
    }

    results.push({
      targetId: unit.instanceId,
      paused: false,
      addedMinutes: TURN_DURATION_MINUTES,
      beforeMinutes,
      afterMinutes,
      naturallySunk
    });
  }

  const report = {
    version: 1,
    step: "sinking-end",
    turnNumber: working.turn.number,
    results
  };

  validateUnits(working);

  working.rescueRuntime.records.push(copy(report));
  working.rescueRuntime.lastEndTurn = working.turn.number;

  initializeRescueRuntime(working);

  writeBack(scene, working);

  return copy(report);
}
