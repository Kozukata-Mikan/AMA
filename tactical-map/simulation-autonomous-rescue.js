import {
  readShipProfile
} from "./ship-runtime.js";

import {
  initializeRescueState
} from "./simulation-rescue.js";

const copy = value => JSON.parse(JSON.stringify(value));

function fail(message) {
  throw new Error(message);
}

function positioned(unit) {
  return Number.isFinite(unit.x) &&
    Number.isFinite(unit.y);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function compareId(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function availableRescuer(unit) {
  return (
    unit.branch === "navy" &&
    positioned(unit) &&
    unit.shipState &&
    !["sinking", "sunk"].includes(unit.shipState.status) &&
    unit.shipState.rescueTaskId === null
  );
}

function availableTarget(unit) {
  return (
    unit.branch === "navy" &&
    positioned(unit) &&
    unit.shipState?.status === "sinking" &&
    unit.shipState.rescueTaskId === null
  );
}

/**
 * 为移动后的敌方、中立舰船添加自主救助计划。
 *
 * 输入必须是移动执行事务的工作副本。
 * 不移动、不掷币、不启动任务、不保存。
 * 不注册规则尚未确认的外部设备修复。
 *
 * readVisibility接收隔离的阵营观察场景，
 * 返回现有getVisibility的查询结果。
 */
export function appendAutonomousRescuePlans(
  scene,
  readVisibility
) {
  if (!scene?.controls?.enemyAutonomy) return [];

  if (
    !Array.isArray(scene.instances) ||
    scene.turn?.phaseId !== "movement" ||
    !Number.isSafeInteger(scene.turn.number) ||
    scene.turn.number < 1
  ) {
    fail("自律救助計画の段階または場面が不正です。");
  }

  if (typeof readVisibility !== "function") {
    fail("自律救助の偵察判定が接続されていません。");
  }

  // 全体を副本で処理し、失敗時に計画だけ残さない。
  const working = copy(scene);

  initializeRescueState(working);

  const reserved = new Set();

  for (const plan of working.rescuePlans) {
    reserved.add(plan.rescuerId);
    reserved.add(plan.targetId);
  }

  for (const task of working.rescueTasks) {
    if (task.status !== "active") continue;

    reserved.add(task.rescuerId);
    reserved.add(task.targetId);
  }

  const additions = [];

  for (const side of ["enemy", "neutral"]) {
    const ownUnits = working.instances.filter(
      unit => unit.side === side
    );

    let neutralThreats = [];

    if (side === "neutral") {
      // 仅在隔离副本中切换观察阵营。
      // 不改变正式场景的按钮状态或玩家权限。
      const observation = copy(working);
      observation.controls.enemyAutonomy = false;
      observation.controls.observationSide = side;

      const visibility = readVisibility(observation);

      if (
        !visibility ||
        typeof visibility.has !== "function"
      ) {
        fail("自律救助の偵察判定結果が不正です。");
      }

      neutralThreats = observation.instances.filter(unit =>
        unit.side !== side &&
        positioned(unit) &&
        unit.shipState?.status !== "sunk" &&
        visibility.has(unit.instanceId)
      );
    }

    const targets = ownUnits
      .filter(availableTarget)
      .sort((a, b) =>
        // 优先救助已累计更多沉没时间的舰船。
        b.shipState.sinkingElapsedMinutes -
          a.shipState.sinkingElapsedMinutes ||
        compareId(a.instanceId, b.instanceId)
      );

    for (const target of targets) {
      if (reserved.has(target.instanceId)) continue;

      const candidates = ownUnits.filter(rescuer =>
        rescuer.instanceId !== target.instanceId &&
        !reserved.has(rescuer.instanceId) &&
        availableRescuer(rescuer) &&
        distance(rescuer, target) <= 2
      );

      const safeCandidates = side === "neutral"
        ? candidates.filter(rescuer => {
            /*
             * 中立的保守策略：
             * 已发现的其他阵营单位若在救助双方附近，
             * 本次不主动锁定救助行动。
             *
             * 2格是策略警戒距离，不是武器射程，
             * 不能解释成“2格外没有威胁”。
             */
            return !neutralThreats.some(threat =>
              distance(threat, rescuer) <= 2 ||
              distance(threat, target) <= 2
            );
          })
        : candidates;

      safeCandidates.sort((a, b) => {
        const aRepairShip = readShipProfile(a).isRepairShip;
        const bRepairShip = readShipProfile(b).isRepairShip;

        return (
          Number(bRepairShip) - Number(aRepairShip) ||
          distance(a, target) - distance(b, target) ||
          compareId(a.instanceId, b.instanceId)
        );
      });

      const rescuer = safeCandidates[0];
      if (!rescuer) continue;

      const plan = {
        kind: "rescue",
        rescuerId: rescuer.instanceId,
        targetId: target.instanceId,
        turnNumber: working.turn.number
      };

      working.rescuePlans.push(plan);
      additions.push(copy(plan));

      reserved.add(rescuer.instanceId);
      reserved.add(target.instanceId);
    }
  }

  initializeRescueState(working);

  // 只写回本模块负责的计划。
  scene.rescuePlans = copy(working.rescuePlans);

  return additions;
}
