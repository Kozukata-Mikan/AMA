// 攻击计划的持久化与结构校验。
// 不处理命中、资源消耗、伤害或阶段推进。
// 资格检查由store复用现有检查入口。

const ATTACK_PHASE = /^(order-[1-5]|pas)$/;

function fail(message) {
  throw new Error(message);
}

function text(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function isAttackPhase(phaseId) {
  return typeof phaseId === "string" &&
    ATTACK_PHASE.test(phaseId);
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

  // 旧存档只补缺失字段。
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
      command.turnNumber < 1 ||
      command.turnNumber !== scene.turn.number ||
      !isAttackPhase(command.phaseId) ||
      command.phaseId !== scene.turn.phaseId ||
      !text(command.unitId) ||
      !text(command.groupId) ||
      !text(command.targetId) ||
      command.unitId === command.targetId ||
      !text(command.createdAt) ||
      !Array.isArray(command.boundaries) ||
      command.boundaries.some(item => !text(item))
    ) {
      fail("攻撃計画の保存値が不正です。");
    }

    ids.add(command.id);

    const actor = scene.instances.find(
      unit => unit.instanceId === command.unitId
    );

    const target = scene.instances.find(
      unit => unit.instanceId === command.targetId
    );

    if (
      !actor ||
      !target ||
      !actor.equipmentState?.groups?.some(
        group => group.id === command.groupId
      )
    ) {
      fail("攻撃計画のユニットまたは装備組が一致しません。");
    }

    const key = JSON.stringify([
      command.unitId,
      command.groupId
    ]);

    if (groupKeys.has(key)) {
      fail("同じ装備組の攻撃計画が重複しています。");
    }

    groupKeys.add(key);
  }
}

/**
 * 原子替换一艘舰船所选装备组的计划。
 * request已经由store完成资格和权限检查。
 *
 * 未出现在request中的装备组计划保持不变。
 * 同装备组重新保存时替换目标，不产生重复计划。
 */
export function replaceAttackCommands(
  scene,
  unitId,
  requests,
  createId
) {
  initializeAttackRuntime(scene);

  if (
    !isAttackPhase(scene.turn.phaseId) ||
    !text(unitId) ||
    !Array.isArray(requests) ||
    !requests.length ||
    typeof createId !== "function"
  ) {
    fail("攻撃計画の登録要求が不正です。");
  }

  const groupIds = new Set();

  for (const request of requests) {
    if (
      !request ||
      !text(request.groupId) ||
      !text(request.targetId) ||
      groupIds.has(request.groupId) ||
      !Array.isArray(request.boundaries) ||
      request.boundaries.some(item => !text(item))
    ) {
      fail("攻撃計画の装備組指定が不正です。");
    }

    groupIds.add(request.groupId);
  }

  const retained = scene.attackRuntime.commands.filter(
    command =>
      command.unitId !== unitId ||
      !groupIds.has(command.groupId)
  );

  if (retained.length + requests.length > 1000) {
    fail("未処理の攻撃計画は1000件以内にしてください。");
  }

  const createdAt = new Date().toISOString();

  const added = requests.map(request => ({
    id: createId(),
    status: "planned",
    turnNumber: scene.turn.number,
    phaseId: scene.turn.phaseId,
    unitId,
    groupId: request.groupId,
    targetId: request.targetId,
    createdAt,
    boundaries: [...request.boundaries]
  }));

  // 先在独立根对象中校验，成功后才写回。
  const working = {
    ...scene,
    attackRuntime: {
      version: 1,
      commands: [...retained, ...added]
    }
  };

  initializeAttackRuntime(working);

  scene.attackRuntime = working.attackRuntime;
}
