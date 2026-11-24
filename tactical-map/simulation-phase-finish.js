import {resolveAceLosses} from './air-training-runtime.js?v=air-training-1';
import {resolveAirNavigationLosses} from './aviation-losses.js?v=day-catalog-pas-1';
import {rebuildAircraftClusters} from './aviation-operations.js?v=day-catalog-pas-1';
import {enforceRemoteControl} from './aviation-services.js?v=air-losses-1';
import {ensureBuildingState} from './building-state.js?v=facility-rules-1';
import {advanceAviationStart,reconcileAviation} from './aviation-operations.js?v=day-catalog-pas-1';
import {hasAircraftTemplate,finishAircraftTurn} from './aircraft-runtime.js?v=air-losses-1';
import { hasSupportEquipment } from "./support-equipment.js?v=air-training-1";
import { resolveSupportsAtSpecial, reconcileSupports } from "./simulation-support.js?v=day-catalog-pas-1";
import {copySceneWithSpecialHistory} from './special-history-snapshot.js';
import {
  TURN_DURATION_MINUTES
} from "./rules-engine.js";

import {
  normalizeEnvironment, advanceEnvironment
} from "./environment-data.js?v=day-catalog-pas-1";

import {
  ensureShipRuntime,
  readShipProfile,
  applyShipFireFloodingPhase
} from "./ship-runtime.js?v=day-catalog-pas-1";

import {
  ensureUnitCombatRuntime
} from "./equipment-runtime.js?v=air-training-1";

import {
  initializeSpecialRuntime,
  applyFireFloodingSpecialStep
} from "./simulation-special-runtime.js?v=day-catalog-pas-1";

import {
  initializeRescueRuntime,
  applyRescueSpecialStep,
  applySinkingEndStep
} from "./simulation-rescue-runtime.js?v=day-catalog-pas-1";

import {
  getEquipmentControlCandidates
} from "./equipment-item-runtime.js?v=air-training-1";


import {
  initializeRescueState
} from "./simulation-rescue.js?v=day-catalog-pas-1";

import {
  initializeRoundTraitRuntime,
  resolveRoundTraits
} from "./simulation-round-trait-runtime.js";


const copy = value => JSON.parse(JSON.stringify(value));

function fail(message) {
  throw new Error(message);
}

function safeInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail(`${label}の値が不正です。`);
  }
  return value;
}

function findUnit(scene, id) {
  const unit = scene.instances.find(
    item => item.instanceId === id
  );

  if (!unit) fail("沈没時間の対象を確認できません。");
  return unit;
}

function validateScene(scene) {
  if (
    !scene ||
    !Array.isArray(scene.instances) ||
    !Array.isArray(scene.groups)
  ) {
    fail("段階終了処理の場面が不正です。");
  }

  safeInteger(scene.turn?.number, "ラウンド番号", 1);
  safeInteger(scene.turn?.elapsedMinutes, "経過時間");

  normalizeEnvironment(scene.environment);

  for (const unit of scene.instances) {
    ensureShipRuntime(unit);
    ensureBuildingState(unit);
    ensureUnitCombatRuntime(unit);
  }

  initializeRescueState(scene);
  initializeRescueRuntime(scene);
  initializeSpecialRuntime(scene);
  initializePhaseFinishRuntime(scene);
  initializeRoundTraitRuntime(scene);

}

/**
 * 不补造旧存档的首次濒临沉没时间。
 * first保存首次历史；episodes保存每次重新进入的计时起点。
 * 救助成功后再次进入时建立新episode，不覆盖first。
 */
export function initializePhaseFinishRuntime(scene) {
  if (scene.phaseFinishRuntime === undefined) {
    scene.phaseFinishRuntime = {
      version: 1,
      sinkingOrigins: [],
      records: []
    };
  }

  const runtime = scene.phaseFinishRuntime;

  if (
    !runtime ||
    runtime.version !== 1 ||
    !Array.isArray(runtime.sinkingOrigins) ||
    !Array.isArray(runtime.records)
  ) {
    fail("段階終了処理の保存形式が不正です。");
  }

  const targetIds = new Set();

  for (const origin of runtime.sinkingOrigins) {
    if (
      !origin ||
      typeof origin.targetId !== "string" ||
      targetIds.has(origin.targetId) ||
      !Array.isArray(origin.episodes) ||
      origin.episodes.length === 0 ||
      JSON.stringify(origin.first) !==
        JSON.stringify(origin.episodes[0])
    ) {
      fail("沈没寸前の開始記録が不正です。");
    }

    targetIds.add(origin.targetId);

    const unit = findUnit(scene, origin.targetId);

    if (unit.branch !== "navy") {
      fail("沈没時間の記録対象が艦船ではありません。");
    }

    let previous = -1;

    for (const episode of origin.episodes) {
      safeInteger(episode.turnNumber, "沈没開始ラウンド", 1);
      safeInteger(episode.elapsedMinutes, "沈没開始時刻");

      if (
        episode.turnNumber > scene.turn.number ||
        episode.elapsedMinutes > scene.turn.elapsedMinutes ||
        episode.elapsedMinutes < previous ||
        !/^(order-[1-5]|pas|special)$/.test(episode.phaseId)
      ) {
        fail("沈没開始記録が現在の時刻と一致しません。");
      }

      previous = episode.elapsedMinutes;
    }
  }

  const keys = new Set();

  for (const record of runtime.records) {
    if (
      !record ||
      record.version !== 1 ||
      !["special-complete", "turn-complete"].includes(record.step)
    ) {
      fail("段階終了の履歴が不正です。");
    }

    safeInteger(record.turnNumber, "履歴ラウンド", 1);

    if (record.turnNumber > scene.turn.number) {
      fail("段階終了の履歴が未来になっています。");
    }

    const key = `${record.step}:${record.turnNumber}`;

    if (keys.has(key)) {
      fail("段階終了の履歴が重複しています。");
    }

    keys.add(key);
  }
}

/**
 * 攻击或特殊效果报告产生后，由同一事务调用。
 * 接受算法返回的sinkingStarted，不接受页面传入。
 */
export function recordSinkingStarts(scene, reports) {
  initializePhaseFinishRuntime(scene);

  for (const report of reports) {
    if (!report.sinkingStarted) continue;

    const started = report.sinkingStarted;

    if (
      started.turnNumber !== scene.turn.number ||
      started.phaseId !== scene.turn.phaseId
    ) {
      fail("沈没開始報告の段階が一致しません。");
    }

    const unit = findUnit(scene, report.targetId);

    if (
      unit.branch !== "navy" ||
      !["sinking", "sunk"].includes(unit.shipState.status)
    ) {
      fail("沈没開始報告と艦船状態が一致しません。");
    }

    let origin = scene.phaseFinishRuntime.sinkingOrigins.find(
      item => item.targetId === report.targetId
    );

    const episode = {
      turnNumber: scene.turn.number,
      phaseId: scene.turn.phaseId,
      elapsedMinutes: scene.turn.elapsedMinutes
    };

    if (!origin) {
      origin = {
        targetId: report.targetId,
        first: copy(episode),
        episodes: []
      };

      scene.phaseFinishRuntime.sinkingOrigins.push(origin);
    }

    const latest = origin.episodes.at(-1);

    if (
      latest &&
      latest.turnNumber === episode.turnNumber &&
      latest.phaseId === episode.phaseId
    ) {
      fail("沈没開始が二重に記録されています。");
    }

    origin.episodes.push(episode);
  }

  initializePhaseFinishRuntime(scene);
}

function assertNotCompleted(scene, step) {
  if (scene.phaseFinishRuntime.records.some(record =>
    record.step === step &&
    record.turnNumber === scene.turn.number
  )) {
    fail("この段階の終了処理はすでに完了しています。");
  }
}

/**
 * 全舰确定性预检。
 * 两种硬币分支均在隔离副本试算，正式随机数尚未调用。
 */
function preflightSpecial(scene) {
  if (
    scene.attackRuntime?.commands?.length ||
    scene.movementPlans?.length ||
    scene.rescuePlans?.length
  ) {
    fail("未処理の行動計画が残っています。");
  }

  if (
    scene.specialRuntime.lastFireFloodingTurn >= scene.turn.number ||
    scene.rescueRuntime.lastSpecialTurn >= scene.turn.number
  ) {
    fail(
      "特殊段階の一部がすでに処理されています。" +
      "部分処理を再実行せず停止します。"
    );
  }

  for (const unit of scene.instances) {
    
   

    if (unit.branch === "building" || hasAircraftTemplate(unit) || (unit.branch !== "navy" && hasSupportEquipment(unit))) continue;
    if (unit.branch !== "navy") {
      fail(
        "海軍以外の特殊段階処理が未接続です。"
      );
    }

      const damagedCount =
  getEquipmentControlCandidates(unit).length;

const context = {
  turnNumber: scene.turn.number,
  phaseId: "special"
};

if (
  damagedCount === 0 ||
  unit.shipState.status === "sunk"
) {
  for (const heads of [false, true]) {
    applyShipFireFloodingPhase(
      copy(unit),
      context,
      () => heads,
      () => {
        fail("損管対象がない状態で設備抽選が呼ばれました。");
      }
    );
  }
} else {
  // 成功和失败都必须先选择同一个项目。
  // 每个候选的两个硬币分支均在隔离副本验证。
  for (let index = 0; index < damagedCount; index++) {
    for (const heads of [false, true]) {
      applyShipFireFloodingPhase(
        copy(unit),
        context,
        () => heads,
        candidateCount => {
          if (candidateCount !== damagedCount) {
            fail("設備損管の候補数が事前検査と一致しません。");
          }

          return index;
        }
      );
    }
  }
}


  }

  // 救助抽签前验证所有即将到期的救助舰性能。
  for (const task of scene.rescueTasks) {
    if (
      task.status === "active" &&
      scene.turn.number >= task.startedTurn + 1
    ) {
      readShipProfile(findUnit(scene, task.rescuerId));
    }
  }
}

/**
 * 按首次进入本次濒临沉没的起点检查时间。
 * 活跃救助仅减去已经结束的暂停回合。
 * 中断任务已经补算，因此不再减去。
 */
function preflightSinkingTime(scene) {
  for (const unit of scene.instances) {
    if (
      unit.branch !== "navy" ||
      unit.shipState.status !== "sinking"
    ) {
      continue;
    }

    const origin = scene.phaseFinishRuntime.sinkingOrigins.find(
      item => item.targetId === unit.instanceId
    );

    const episode = origin?.episodes.at(-1);

    if (!episode) {
      fail(
        "旧保存データに沈没寸前の開始時刻がありません。" +
        "現在時刻から履歴を補造せず、回合終了を停止します。"
      );
    }

    let pausedMinutes = 0;

    for (const task of [...scene.rescueTasks, ...(scene.supportRuntime?.tasks ?? [])]) {
      if (
      (task.kind ?? "rescue") !== "rescue" ||
       task.status !== "active" ||
       task.targetId !== unit.instanceId
      ) {
     continue;
     }


      if (task.startedTurn < episode.turnNumber) {
        fail("救助開始と沈没開始の記録が一致しません。");
      }

      pausedMinutes +=
        (scene.turn.number - task.startedTurn) *
        TURN_DURATION_MINUTES;
    }

    safeInteger(pausedMinutes, "救助停止時間");

    const expected =
      scene.turn.elapsedMinutes -
      episode.elapsedMinutes -
      pausedMinutes;

    if (
      expected < 0 ||
      unit.shipState.sinkingElapsedMinutes !== expected
    ) {
      fail(
        "沈没開始時刻・救助停止時間・累積時間が一致しません。"
      );
    }
  }
}

function nextEnvironment(environment) {
  return advanceEnvironment(environment,TURN_DURATION_MINUTES);
}

export function finishSpecialPhase(scene, coinSource) {
  if (scene.turn?.phaseId !== "special") {
    fail("特殊詞条判定段階ではありません。");
  }

  const working = copySceneWithSpecialHistory(scene);

  validateScene(working);
  assertNotCompleted(working, "special-complete");
  preflightSpecial(working);

  // 正式事务中补判；已有本回合记录的单位不会重新抽签。
  // 使用特殊阶段开始状态，不受随后火灾、浸水、救助影响。
  resolveRoundTraits(working, working);

  const fireFlooding = applyFireFloodingSpecialStep(working);

  // 即使随后救助协调使舰船沉没，也保留进入时刻。
  recordSinkingStarts(working, fireFlooding.shipReports);

  const externalSupport = resolveSupportsAtSpecial(working);
  recordSinkingStarts(working, externalSupport.filter(item=>item.report).map(item=>item.report));
  const rescue = applyRescueSpecialStep(working);
  const airNavigationReports=resolveAirNavigationLosses(working,coinSource);
  if(airNavigationReports.some(r=>r.crashed))rebuildAircraftClusters(working);

  working.phaseFinishRuntime.records.push({
    version: 1,
    step: "special-complete",
    turnNumber: working.turn.number,
    elapsedMinutes: working.turn.elapsedMinutes,
    fireFloodingTurn: fireFlooding.turnNumber,
    rescueTurn: rescue.turnNumber,
    airNavigationReports
  });

  working.turn.phaseId = "end";

  reconcileAviation(working);
  validateScene(working);

  scene.instances = working.instances;
  scene.groups = working.groups;
  scene.aviationRuntime = working.aviationRuntime;
  scene.supportRuntime = working.supportRuntime;
  scene.rescueTasks = working.rescueTasks;
  scene.specialRuntime = working.specialRuntime;
  scene.rescueRuntime = working.rescueRuntime;
  scene.phaseFinishRuntime = working.phaseFinishRuntime;
  scene.roundTraitRuntime = working.roundTraitRuntime;
  scene.turn = working.turn;

  return {
    nextPhaseId: "end",
    message:
      "火災・浸水・装備損管・救助・航空機迷航判定をまとめて保存しました。" +
      "回合終了段階へ移りました。時刻は進めていません。"
  };
}

export function finishTurn(scene) {
  if (scene.turn?.phaseId !== "end") {
    fail("回合終了段階ではありません。");
  }

  const working = copySceneWithSpecialHistory(scene);

  validateScene(working);
  assertNotCompleted(working, "turn-complete");

  if (
    !working.phaseFinishRuntime.records.some(record =>
      record.step === "special-complete" &&
      record.turnNumber === working.turn.number
    ) ||
    working.specialRuntime.lastFireFloodingTurn !==
      working.turn.number ||
    working.rescueRuntime.lastSpecialTurn !== working.turn.number
  ) {
    fail("このラウンドの特殊段階が完了していません。");
  }

  if (
    working.attackRuntime?.commands?.length ||
    working.movementPlans?.length ||
    working.rescuePlans?.length
  ) {
    fail("未処理の行動計画が残っています。");
  }

  const nextTurn = working.turn.number + 1;
  const nextElapsed =
    working.turn.elapsedMinutes + TURN_DURATION_MINUTES;

  safeInteger(nextTurn, "次のラウンド", 1);
  safeInteger(nextElapsed, "次の経過時間");

  preflightSinkingTime(working);

  const beforeEnvironment = normalizeEnvironment(
    working.environment
  );

  const afterEnvironment = nextEnvironment(
    working.environment
  );

  const sinking = applySinkingEndStep(working);
  enforceRemoteControl(working);
  const aircraftReports=finishAircraftTurn(working);
  const aceLosses=resolveAceLosses(working);

  working.phaseFinishRuntime.records.push({
    version: 1,
    step: "turn-complete",
    turnNumber: working.turn.number,
    beforeElapsedMinutes: working.turn.elapsedMinutes,
    afterElapsedMinutes: nextElapsed,
    beforeDay: beforeEnvironment.day,
    afterDay: afterEnvironment.day,
    beforeTime: beforeEnvironment.time,
    afterTime: afterEnvironment.time,
    aircraftReports,
    aceLosses,
    sinkingTurn: sinking.turnNumber
  });

  // 所有结束子流程成功后，才在同一候选副本推进。
  working.environment = afterEnvironment;
  working.turn = {
    ...working.turn,
    number: nextTurn,
    phaseId: "start",
    elapsedMinutes: nextElapsed
  };
  advanceAviationStart(working);

  reconcileAviation(working);
  validateScene(working);

  scene.instances = working.instances;
  scene.groups = working.groups;
  scene.aviationRuntime = working.aviationRuntime;
  scene.supportRuntime = working.supportRuntime;
  scene.rescueTasks = working.rescueTasks;
  scene.rescueRuntime = working.rescueRuntime;
  scene.phaseFinishRuntime = working.phaseFinishRuntime;
  scene.environment = working.environment;
  scene.turn = working.turn;

  return {
    nextPhaseId: "start",
    turnNumber: nextTurn,
    elapsedMinutes: nextElapsed,
    time: afterEnvironment.time,
    message:
      "回合終了処理を保存しました。" +
      "30分進めて、次のラウンドを開始しました。"
  };
}
