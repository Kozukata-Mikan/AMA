// 攻击计划的持久化与结构校验。
// 不处理命中、资源消耗、伤害或阶段推进。
// 权限、装备范围和成员资格由正式入口检查。

const ATTACK_PHASE = /^(order-[1-5]|pas)$/;

function fail(message) {
  throw new Error(message);
}

function text(value) {
  return typeof value === "string" &&
    value.trim().length > 0;
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

export function isAttackPhase(phaseId) {
  return typeof phaseId === "string" &&
    ATTACK_PHASE.test(phaseId);
}

/**
 * 只规范化目标结构，不猜测装备范围规则。
 *
 * 旧单体：
 *   { targetId }
 *
 * 新目标：
 *   {
 *     targetRef: { kind: "unit" | "group", id },
 *     specifiedTargetIds: []
 *   }
 *
 * 编队目标不生成targetId。
 */
export function readAttackCommandTarget(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    fail("攻撃目標の形式が不正です。");
  }

  const hasRef = value.targetRef !== undefined;
  const hasLegacy = value.targetId !== undefined;

  if (!hasRef && !hasLegacy) {
    fail("攻撃の主目標を指定してください。");
  }

  const rawRef = hasRef
    ? value.targetRef
    : { kind: "unit", id: value.targetId };

  if (
    !rawRef ||
    typeof rawRef !== "object" ||
    Array.isArray(rawRef) ||
    !["unit", "group"].includes(rawRef.kind) ||
    !text(rawRef.id)
  ) {
    fail("攻撃の主目標が不正です。");
  }

  const targetRef = {
    kind: rawRef.kind,
    id: rawRef.id
  };

  if (
    hasLegacy &&
    (
      !text(value.targetId) ||
      targetRef.kind !== "unit" ||
      targetRef.id !== value.targetId
    )
  ) {
    fail("旧形式の目標と主目標が一致しません。");
  }

  const specifiedTargetIds =
    value.specifiedTargetIds === undefined
      ? []
      : value.specifiedTargetIds;

  if (
    !Array.isArray(specifiedTargetIds) ||
    specifiedTargetIds.some(id => !text(id)) ||
    new Set(specifiedTargetIds).size !==
      specifiedTargetIds.length
  ) {
    fail("指定メンバーが不正、または重複しています。");
  }

  // 单体主目标不能夹带另一个单位。
  if (
    targetRef.kind === "unit" &&
    specifiedTargetIds.some(id => id !== targetRef.id)
  ) {
    fail("単体の主目標と指定メンバーが一致しません。");
  }

  return {
    targetRef,
    specifiedTargetIds: [...specifiedTargetIds]
  };
}

function targetFields(value) {
  const target = readAttackCommandTarget(value);

  // 旧命令保持旧结构，避免加载时迁移存档。
  if (
    value.targetRef === undefined &&
    value.specifiedTargetIds === undefined
  ) {
    return { targetId: target.targetRef.id };
  }

  const result = {
    targetRef: target.targetRef,
    specifiedTargetIds: target.specifiedTargetIds
  };

  // 仅为单体提供旧入口兼容字段。
  if (target.targetRef.kind === "unit") {
    result.targetId = target.targetRef.id;
  }

  return result;
}

function assertTargetExists(scene, target, actorId) {
  if (target.targetRef.kind === "unit") {
    if (
      target.targetRef.id === actorId ||
      !scene.instances.some(
        unit => unit.instanceId === target.targetRef.id
      )
    ) {
      fail("攻撃目標のユニットが不正です。");
    }
  } else if (
    !Array.isArray(scene.groups) ||
    !scene.groups.some(
      group => group.id === target.targetRef.id
    )
  ) {
    fail("攻撃目標の編隊が見つかりません。");
  }

  // 这里只验证实例存在。
  // 是否属于阶段开始编队、是否合格，交给正式批次检查。
  for (const targetId of target.specifiedTargetIds) {
    if (
      targetId === actorId ||
      !scene.instances.some(
        unit => unit.instanceId === targetId
      )
    ) {
      fail("指定メンバーのユニットが不正です。");
    }
  }
}

export function initializeAttackRuntime(scene) {
  if (
    !scene ||
    !Array.isArray(scene.instances) ||
    !Number.isSafeInteger(scene.turn?.number) ||
    scene.turn.number < 1
  ) {
    fail("攻撃計画の推演状態が不正です。");
  }

  // 旧存档只补缺失字段，不改旧命令。
  if (scene.attackRuntime === undefined) {
    scene.attackRuntime = {
      version: 1,
      commands: []
    };
  }

  const runtime = scene.attackRuntime;

  if (
    !runtime ||
    typeof runtime !== "object" ||
    Array.isArray(runtime) ||
    runtime.version !== 1 ||
    !Array.isArray(runtime.commands) ||
    runtime.commands.length > 1000
  ) {
    fail("攻撃計画の保存形式が不正です。");
  }

  const ids = new Set();
  const groupKeys = new Set();

  for (const command of runtime.commands) {
    if (
      !command ||
      typeof command !== "object" ||
      Array.isArray(command) ||
      !text(command.id) ||
      ids.has(command.id) ||
      command.status !== "planned" ||
      !Number.isSafeInteger(command.turnNumber) ||
      command.turnNumber !== scene.turn.number ||
      !isAttackPhase(command.phaseId) ||
      command.phaseId !== scene.turn.phaseId ||
      !text(command.unitId) ||
      !text(command.groupId) ||
      !text(command.createdAt) ||
      !Array.isArray(command.boundaries) ||
      command.boundaries.some(item => !text(item))
    ) {
      fail("攻撃計画の保存値が不正です。");
    }

    const target = readAttackCommandTarget(command);

    const actor = scene.instances.find(
      unit => unit.instanceId === command.unitId
    );

    if (
      !actor ||
      !actor.equipmentState?.groups?.some(
        group => group.id === command.groupId
      )
    ) {
      fail("攻撃計画の行動艦または装備組が一致しません。");
    }

    assertTargetExists(scene, target, command.unitId);

    const key = JSON.stringify([
      command.unitId,
      command.groupId
    ]);

    if (groupKeys.has(key)) {
      fail("同じ装備組の攻撃計画が重複しています。");
    }

    ids.add(command.id);
    groupKeys.add(key);
  }
}

/**
 * 原子替换一艘舰船所选装备组的计划。
 * requests必须先由store完成权限与装备规则检查。
 * 未出现在requests中的装备组计划保持不变。
 */
export function replaceAttackCommands(
  scene,
  unitId,
  requests,
  createId
) {
  // 初始化和验证也在独立副本进行。
  const working = copy(scene);
  initializeAttackRuntime(working);

  if (
    !isAttackPhase(working.turn.phaseId) ||
    !text(unitId) ||
    !Array.isArray(requests) ||
    requests.length === 0 ||
    typeof createId !== "function"
  ) {
    fail("攻撃計画の登録要求が不正です。");
  }

  const inputs = copy(requests);
  const groupIds = new Set();

  for (const request of inputs) {
    if (
      !request ||
      !text(request.groupId) ||
      groupIds.has(request.groupId) ||
      !Array.isArray(request.boundaries) ||
      request.boundaries.some(item => !text(item))
    ) {
      fail("攻撃計画の装備組指定が不正です。");
    }

    readAttackCommandTarget(request);
    groupIds.add(request.groupId);
  }

  const retained = working.attackRuntime.commands.filter(
    command =>
      command.unitId !== unitId ||
      !groupIds.has(command.groupId)
  );

  if (retained.length + inputs.length > 1000) {
    fail("未処理の攻撃計画は1000件以内にしてください。");
  }

  const createdAt = new Date().toISOString();

  const added = inputs.map(request => ({
    id: createId(),
    status: "planned",
    turnNumber: working.turn.number,
    phaseId: working.turn.phaseId,
    unitId,
    groupId: request.groupId,
    ...targetFields(request),
    createdAt,
    boundaries: [...request.boundaries]
  }));

  working.attackRuntime = {
    version: 1,
    commands: [...retained, ...added]
  };

  initializeAttackRuntime(working);

  // 全部校验成功后，才修改传入的事务候选。
  scene.attackRuntime = copy(working.attackRuntime);
}
