// 射线每回合、每单位单目标锁定。
// 仅处理锁定，不掷币、不扣弹、不造成伤害、不推进阶段。
// 必须由正式攻击事务调用，不能绑定到目标选择或预览。

function fail(message) {
  throw new Error(message);
}

function requireTurn(turnNumber) {
  if (
    !Number.isSafeInteger(turnNumber) ||
    turnNumber < 1
  ) {
    fail("射線のラウンド番号が不正です。");
  }
}

function requireId(value) {
  if (typeof value !== "string" || !value.trim()) {
    fail("射線のユニット指定が不正です。");
  }

  return value;
}

function findUnit(scene, instanceId) {
  const unit = scene.instances.find(
    item => item.instanceId === instanceId
  );

  if (!unit) {
    fail("射線の行動側または目標を確認できません。");
  }

  return unit;
}

/**
 * 旧存档只补缺失字段。
 * 已保存的锁定历史不清除、不重置。
 *
 * 根字段不会自动进入getObservedScene的白名单。
 */
export function initializeRayTargetRuntime(scene) {
  if (
    !scene ||
    !Array.isArray(scene.instances) ||
    !scene.turn
  ) {
    fail("射線の推演状態が不正です。");
  }

  requireTurn(scene.turn.number);

  if (scene.rayTargetRuntime === undefined) {
    scene.rayTargetRuntime = {
      version: 1,
      locks: []
    };
  }

  const runtime = scene.rayTargetRuntime;

  if (
    !runtime ||
    typeof runtime !== "object" ||
    Array.isArray(runtime) ||
    runtime.version !== 1 ||
    !Array.isArray(runtime.locks)
  ) {
    fail("射線の目標固定記録が不正です。");
  }

  const keys = new Set();

  for (const lock of runtime.locks) {
    if (!lock || typeof lock !== "object") {
      fail("射線の目標固定記録が不正です。");
    }

    requireTurn(lock.turnNumber);
    requireId(lock.unitId);
    requireId(lock.targetId);

    if (
      lock.turnNumber > scene.turn.number ||
      lock.unitId === lock.targetId
    ) {
      fail("射線の目標固定記録が不正です。");
    }

    findUnit(scene, lock.unitId);
    findUnit(scene, lock.targetId);

    // 锁定按“单位＋回合”唯一，不按装备组分别锁定。
    const key = JSON.stringify([
      lock.unitId,
      lock.turnNumber
    ]);

    if (keys.has(key)) {
      fail("同一ラウンドの射線目標が重複しています。");
    }

    keys.add(key);
  }
}

/**
 * 确定性检查。
 * 不初始化、不修改场景、不登记锁定。
 *
 * 此函数不负责观察权限或完整攻击资格。
 * 页面调用前仍需assertManualControl、
 * assertIdentifiedTargets。
 */
export function checkRayTarget({
  scene,
  unitId,
  targetId,
  turnNumber
}) {
  requireTurn(turnNumber);
  requireId(unitId);
  requireId(targetId);

  if (
    !scene ||
    !Array.isArray(scene.instances) ||
    turnNumber !== scene.turn?.number
  ) {
    fail("射線の現在ラウンドが一致していません。");
  }

  findUnit(scene, unitId);
  findUnit(scene, targetId);

  if (unitId === targetId) {
    fail("自分自身を射線の目標には指定できません。");
  }

  const locks = scene.rayTargetRuntime?.locks ?? [];

  if (!Array.isArray(locks)) {
    fail("射線の目標固定記録が不正です。");
  }

  const lock = locks.find(item =>
    item.unitId === unitId &&
    item.turnNumber === turnNumber
  );

  return {
    allowed: !lock || lock.targetId === targetId,
    alreadyLocked: Boolean(lock),
    lockedTargetId: lock?.targetId ?? null,
    reason: lock && lock.targetId !== targetId
      ? "射線はこのラウンド中、別の目標へ変更できません。"
      : null
  };
}

/**
 * 正式发动射线攻击时登记目标。
 *
 * scene必须来自正式保存事务的工作副本。
 * 攻击资格、命中、扣弹、伤害和本锁定必须同事务保存。
 *
 * 不应在保存草案、选择目标、预览时调用。
 */
export function registerRayTarget(
  scene,
  { unitId, targetId },
  context
) {
  if (
    !context ||
    context.turnNumber !== scene.turn?.number ||
    context.phaseId !== scene.turn?.phaseId ||
    typeof context.phaseId !== "string" ||
    !/^(order-[1-5]|pas)$/.test(context.phaseId)
  ) {
    fail("射線を固定する攻撃段階が不正です。");
  }

  initializeRayTargetRuntime(scene);

  const check = checkRayTarget({
    scene,
    unitId,
    targetId,
    turnNumber: context.turnNumber
  });

  if (!check.allowed) {
    fail(check.reason);
  }

  if (!check.alreadyLocked) {
    scene.rayTargetRuntime.locks.push({
      unitId,
      targetId,
      turnNumber: context.turnNumber
    });
  }

  return {
    version: 1,
    unitId,
    targetId,
    turnNumber: context.turnNumber,
    newlyLocked: !check.alreadyLocked
  };
}
