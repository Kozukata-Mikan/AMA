import {
  readRangeCommandTarget
} from "./simulation-range-command.js";

import {
  prepareRangeProjection,
  selectRangeOccurrences,
  resolveRangeProjectionHits
} from "./range-projection-runtime.js";

const copy = value => JSON.parse(JSON.stringify(value));

function fail(message) {
  throw new Error(message);
}

function requireHook(hooks, name) {
  if (typeof hooks?.[name] !== "function") {
    fail("範囲攻撃の正式な結算処理が未接続です。");
  }

  return hooks[name];
}

function syncResult(result) {
  if (result && typeof result.then === "function") {
    fail("範囲攻撃の結算処理に非同期処理は使用できません。");
  }

  return result;
}

function id(value) {
  return typeof value === "string" && value.trim() !== "";
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * 对只读检查使用独立副本。
 * 检查函数不得修改输入；未实现的规则必须抛错。
 */
function readonlyCall(fn, input) {
  const isolated = copy(input);
  const before = JSON.stringify(isolated);
  const result = syncResult(fn(isolated));

  if (JSON.stringify(isolated) !== before) {
    fail("範囲攻撃の条件照合が入力状態を変更しました。");
  }

  return result == null ? result : copy(result);
}

/**
 * 正式定义读取结果：
 *
 * {
 *   supported: true,
 *   actorId,
 *   equipmentGroupId,
 *   scope: { mode, maximumTargets },
 *   projection: { groups, coinsPerGroup, standalone },
 *   guidance
 * }
 *
 * 必须来自装备规则和阶段开始状态，
 * 不允许直接相信命令自带的范围、投射和弹药字段。
 */
function validateDefinition(definition) {
  if (
    !definition ||
    definition.supported !== true ||
    !id(definition.actorId) ||
    !id(definition.equipmentGroupId)
  ) {
    fail("範囲攻撃の装備規則が確定していません。");
  }

  return definition;
}

/**
 * 编排一个完整的范围批次。
 *
 * 本函数不保存、不推进阶段、不推进时间。
 * 输入scene始终不变；只在返回成功时提供候选场景。
 *
 * 注意：
 * commands必须是本次序完整的待结算命令集合。
 * 不得先结算单体命令，再单独调用这里结算范围命令。
 *
 * 当前版本只支持整个批次均为范围命令。
 * 混合批次在正式随机数产生前拒绝。
 */
export function prepareRangeBatchTransaction({
  scene,
  startScene,
  commands
}, hooks) {
  const readDefinition = requireHook(
    hooks,
    "readDefinition"
  );
  const checkMember = requireHook(
    hooks,
    "checkMember"
  );
  const preflightResources = requireHook(
    hooks,
    "preflightResources"
  );
  const applyResources = requireHook(
    hooks,
    "applyResources"
  );
  const resolveDamage = requireHook(
    hooks,
    "resolveDamage"
  );
  const applyMergedDamage = requireHook(
    hooks,
    "applyMergedDamage"
  );
  const finalizeBatch = requireHook(
    hooks,
    "finalizeBatch"
  );
  const validateCandidate = requireHook(
    hooks,
    "validateCandidate"
  );

  if (
    !scene ||
    !startScene ||
    !Array.isArray(commands) ||
    commands.length === 0
  ) {
    fail("範囲攻撃の一括結算入力が不正です。");
  }

  const current = copy(scene);
  const snapshot = copy(startScene);
  const orders = copy(commands);
  const commandIds = new Set();
  const equipmentUses = new Map();
  const prepared = [];

  // 第一阶段：整个批次确定性预检。
  // 尚未扣弹、抽取目标或掷命中硬币。
  for (const command of orders) {
    if (
      !id(command?.id) ||
      commandIds.has(command.id)
    ) {
      fail("攻撃命令の識別番号が不正、または重複しています。");
    }

    commandIds.add(command.id);

    const definition = validateDefinition(
      readonlyCall(readDefinition, {
        startScene: snapshot,
        command
      })
    );

    const target = readRangeCommandTarget(
      command,
      definition.scope
    );

    let actorUses = equipmentUses.get(definition.actorId);

    if (!actorUses) {
      actorUses = new Set();
      equipmentUses.set(definition.actorId, actorUses);
    }

    if (actorUses.has(definition.equipmentGroupId)) {
      fail("同じ装備群に複数の攻撃命令があります。");
    }

    actorUses.add(definition.equipmentGroupId);

    const projection = prepareRangeProjection({
      startScene: snapshot,
      commandId: command.id,
      actorId: definition.actorId,
      targetRef: target.targetRef,
      scope: definition.scope,
      projection: definition.projection,
      guidance: definition.guidance,
      specifiedTargetIds: target.specifiedTargetIds
    }, (memberScene, actor, targetUnit) =>
      readonlyCall(checkMember, {
        startScene: memberScene,
        command,
        definition,
        actor,
        target: targetUnit
      })
    );

    prepared.push({
      command,
      definition,
      projection
    });
  }

  // 一条命令一份资源需求，不按受影响人数倍增。
  const requests = prepared.map(item => ({
    commandId: item.command.id,
    actorId: item.definition.actorId,
    equipmentGroupId: item.definition.equipmentGroupId,
    ammoCost: item.projection.ammoCost
  }));

  const resourcePlan = readonlyCall(preflightResources, {
    scene: current,
    startScene: snapshot,
    commands: orders,
    requests
  });

  if (
    !resourcePlan ||
    resourcePlan.allowed !== true ||
    !Array.isArray(resourcePlan.requests) ||
    resourcePlan.requests.length !== requests.length
  ) {
    fail("範囲攻撃の一括資源照合が確定していません。");
  }

  const confirmed = new Map();

  for (const request of resourcePlan.requests) {
    if (
      !id(request?.commandId) ||
      confirmed.has(request.commandId) ||
      !positiveInteger(request.ammoCost)
    ) {
      fail("範囲攻撃の資源計画が不正です。");
    }

    confirmed.set(request.commandId, request);
  }

  for (const request of requests) {
    const actual = confirmed.get(request.commandId);

    if (
      !actual ||
      actual.actorId !== request.actorId ||
      actual.equipmentGroupId !== request.equipmentGroupId ||
      actual.ammoCost !== request.ammoCost
    ) {
      fail("範囲攻撃の資源計画が投射定義と一致しません。");
    }
  }

  // 第二阶段：正式目标抽取和命中。
  // 到这里，整个批次的成员资格和资源预检都已通过。
  const rangeReports = [];

  for (const item of prepared) {
    const selected = selectRangeOccurrences(
      item.projection
    );

    rangeReports.push(
      resolveRangeProjectionHits(
        item.projection,
        selected
      )
    );
  }

  // 第三阶段：计算伤害，但尚不修改舰船状态。
  // 随机重复目标以命令ID＋出现序号识别，不能覆盖。
  const damageEntries = [];

  for (let index = 0; index < prepared.length; index++) {
    const item = prepared[index];
    const report = rangeReports[index];

    for (const occurrence of report.reports) {
      const resolved = readonlyCall(resolveDamage, {
        startScene: snapshot,
        command: item.command,
        definition: item.definition,
        occurrence
      });

      if (
        !resolved ||
        resolved.supported !== true ||
        resolved.commandId !== item.command.id ||
        resolved.occurrenceIndex !== occurrence.occurrenceIndex ||
        resolved.targetId !== occurrence.targetId ||
        resolved.damage == null
      ) {
        fail("範囲攻撃の正式な被害計算が確定していません。");
      }

      damageEntries.push(resolved);
    }
  }

  const byTarget = new Map();

  for (const entry of damageEntries) {
    if (!byTarget.has(entry.targetId)) {
      byTarget.set(entry.targetId, []);
    }

    byTarget.get(entry.targetId).push(entry);
  }

  const targetBatches = [...byTarget.entries()].map(
    ([targetId, entries]) => ({
      targetId,
      entries
    })
  );

  // 第四阶段：只修改隔离候选场景。
  // 任何一步失败，候选对象被丢弃，输入scene保持不变。
  const candidate = copy(current);

  const resourcesResult = syncResult(applyResources({
    candidate,
    resourcePlan: copy(resourcePlan)
  }));

  if (resourcesResult?.applied !== true) {
    fail("範囲攻撃の資源適用が完了していません。");
  }

  // 整批只调用一次。
  // 此接口必须按阶段开始状态合算每个目标的全部伤害，
  // 并协调水下强度、特殊状态和救助，不可逐条升级损伤。
  const damageResult = syncResult(applyMergedDamage({
    candidate,
    startScene: copy(snapshot),
    targetBatches: copy(targetBatches)
  }));

  if (damageResult?.applied !== true) {
    fail("範囲攻撃の一括被害適用が完了していません。");
  }

  const finishResult = syncResult(finalizeBatch({
    candidate,
    commands: copy(orders),
    rangeReports: copy(rangeReports),
    damageEntries: copy(damageEntries),
    resourcePlan: copy(resourcePlan)
  }));

  if (finishResult?.finalized !== true) {
    fail("範囲攻撃の命令終結が完了していません。");
  }

  const validation = readonlyCall(validateCandidate, {
    candidate,
    originalScene: current,
    startScene: snapshot,
    commands: orders,
    requests,
    rangeReports,
    damageEntries
  });

  if (validation?.valid !== true) {
    fail("範囲攻撃の保存候補を検証できません。");
  }

  return {
    candidate,
    rangeReports: copy(rangeReports),
    damageEntries: copy(damageEntries)
  };
}
