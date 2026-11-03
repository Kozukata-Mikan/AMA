import {
  expandFormationMemberIds
} from "./formation-target-runtime.js";

import {
  assertIdentifiedTargets
} from "./simulation-features.js";

import {
  resolveHitCoins
} from "./weapon-hit-runtime.js";

const copy = value => JSON.parse(JSON.stringify(value));

function fail(message) {
  throw new Error(message);
}

function integer(value, label, minimum = 0) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    fail(`${label}の値が不正です。`);
  }

  return value;
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function findUnit(scene, id) {
  const unit = scene.instances.find(
    item => item.instanceId === id
  );

  if (!unit) {
    fail("範囲攻撃の対象を確認できません。");
  }

  return unit;
}

/**
 * 等概率整数，避免取模偏差。
 * 只在正式事务选取目标时调用，不在预览时调用。
 */
function randomIndex(length) {
  integer(length, "候補数", 1);

  if (
    length > 0x100000000 ||
    !globalThis.crypto?.getRandomValues
  ) {
    fail("範囲攻撃の目標選択に必要な乱数機能がありません。");
  }

  const size = 0x100000000;
  const limit = size - (size % length);
  const buffer = new Uint32Array(1);

  do {
    globalThis.crypto.getRandomValues(buffer);
  } while (buffer[0] >= limit);

  return buffer[0] % length;
}

/**
 * 内部规范化范围契约，不猜测图鉴文本。
 *
 * scope:
 * {
 *   mode: "all" | "specified" | "random",
 *   maximumTargets: 正整数或null
 * }
 *
 * all：
 *   全体覆盖；maximumTargets必须为null。
 *
 * specified：
 *   在指定主编队内部指定受影响成员。
 *   没有指定到上限时不补目标、不拒绝。
 *
 * random：
 *   抽取次数=min(上限,合格候选人数)。
 *   每次独立抽取，允许重复抽中同一成员。
 *
 * maximumTargets是上限，不是最低人数。
 */
function readScope(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !["all", "specified", "random"].includes(value.mode)
  ) {
    fail("範囲攻撃の正式な範囲定義がありません。");
  }

  if (value.mode === "all") {
    if (value.maximumTargets !== null) {
      fail("全体範囲の上限指定が不正です。");
    }
  } else {
    integer(value.maximumTargets, "対象数の上限", 1);
  }

  return {
    mode: value.mode,
    maximumTargets: value.maximumTargets
  };
}

function validateCheck(result, targetId) {
  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    typeof result.then === "function" ||
    result.targetId !== targetId ||
    typeof result.allowed !== "boolean"
  ) {
    fail("範囲メンバーの攻撃条件が確定していません。");
  }

  if (!result.allowed) {
    // false仅用于规则上明确不合格的成员。
    // 未实现或资料错误必须由预检抛错，不能当成不合格跳过。
    if (
      result.code !== "TARGET_INELIGIBLE" ||
      typeof result.reason !== "string" ||
      result.reason.trim() === ""
    ) {
      fail("未確定の攻撃条件を対象外として省略できません。");
    }

    return {
      targetId,
      allowed: false,
      code: result.code,
      reason: result.reason
    };
  }

  return {
    targetId,
    allowed: true,
    bonuses: integer(result.bonuses, "有利判定"),
    penalties: integer(result.penalties, "不利判定")
  };
}

/**
 * 整个范围的确定性预检。
 *
 * 必须传入次序开始场景。
 * checkMember必须检查真实射距、射高、地形、
 * 水下资格、威力算法支持和完整命中修正。
 *
 * 不扣弹、不随机选取、不掷命中硬币。
 */
export function prepareRangeProjection({
  startScene,
  commandId,
  actorId,
  targetRef,
  scope,
  projection,
  guidance,
  specifiedTargetIds = []
}, checkMember) {
  if (
    typeof commandId !== "string" ||
    commandId.trim() === "" ||
    typeof checkMember !== "function"
  ) {
    fail("範囲攻撃の命令または正式条件照合が不正です。");
  }

  const scene = copy(startScene);
  const actor = findUnit(scene, actorId);
  const normalizedScope = readScope(scope);

  const groups = integer(projection?.groups, "投射束数", 1);
  const coinsPerGroup = integer(
    projection?.coinsPerGroup,
    "束内投射数",
    1
  );

  if (typeof projection.standalone !== "boolean") {
    fail("単独Rの設定が不正です。");
  }

  const ammoCost = integer(
    groups * coinsPerGroup,
    "一回分の消費弾数",
    1
  );

  if (
    projection.standalone &&
    (groups !== 1 || coinsPerGroup !== 1)
  ) {
    fail("単独Rの投射設定が不正です。");
  }

  const memberIds = expandFormationMemberIds(
    scene,
    targetRef
  );

  const observationScene = {
    ...scene,
    controls: {
      ...scene.controls,
      observationSide: actor.side
    }
  };

  // 不通过候选报告泄露未识别成员。
  // 当前采用保守拒绝，不自行增加盲射规则。
  assertIdentifiedTargets(
    observationScene,
    memberIds.map(id => findUnit(scene, id))
  );

  const checks = [];

  for (const targetId of memberIds) {
    const target = findUnit(scene, targetId);

    if (
      targetId === actorId ||
      target.side === actor.side
    ) {
      checks.push({
        targetId,
        allowed: false,
        code: "TARGET_INELIGIBLE",
        reason: "自艦または同一陣営は攻撃対象外です。"
      });
      continue;
    }

    const input = {
      scene: copy(observationScene),
      actor: copy(actor),
      target: copy(target)
    };

    const before = JSON.stringify(input);

    const result = checkMember(
      input.scene,
      input.actor,
      input.target
    );

    if (JSON.stringify(input) !== before) {
      fail("範囲攻撃の条件照合が入力状態を変更しました。");
    }

    checks.push(validateCheck(result, targetId));
  }

  const eligibleIds = checks
    .filter(check => check.allowed)
    .map(check => check.targetId)
    .sort(compareText);

  if (eligibleIds.length === 0) {
    fail("主目標の範囲に攻撃可能なメンバーがいません。");
  }

  if (!Array.isArray(specifiedTargetIds)) {
    fail("指定範囲メンバーの形式が不正です。");
  }

  if (
    normalizedScope.mode !== "specified" &&
    specifiedTargetIds.length !== 0
  ) {
    fail("この範囲方式では個別メンバーを指定できません。");
  }

  let specifiedIds = [];

  if (normalizedScope.mode === "specified") {
    if (
      specifiedTargetIds.length === 0 ||
      new Set(specifiedTargetIds).size !== specifiedTargetIds.length ||
      specifiedTargetIds.some(id => !eligibleIds.includes(id))
    ) {
      fail("指定メンバーが重複、未指定、または攻撃対象外です。");
    }

    if (
      specifiedTargetIds.length >
      normalizedScope.maximumTargets
    ) {
      fail("指定メンバー数が範囲上限を超えています。");
    }

    specifiedIds = [...specifiedTargetIds].sort(compareText);
  }

  // 用既有命中算法验证引导与投射结构。
  // 隔离支持检查，不消耗正式随机数。
  resolveHitCoins({
    groups,
    coinsPerGroup,
    standalone: projection.standalone,
    guidance,
    bonuses: 0,
    penalties: 0
  }, () => false);

  return copy({
    version: 1,
    commandId,
    actorId,
    targetRef,
    scope: normalizedScope,
    projection: {
      groups,
      coinsPerGroup,
      standalone: projection.standalone
    },
    guidance,

    // 无论展开几名成员，本命令只有这一份资源消耗。
    ammoCost,

    memberIds,
    eligibleIds,
    specifiedTargetIds: specifiedIds,
    checks
  });
}

/**
 * 正式目标选择步骤。
 *
 * 返回occurrences而不是去重后的targets：
 * 随机重复必须保留，以供各次完整投射。
 *
 * 不保存，不扣弹；必须在整批预检通过后调用。
 */
export function selectRangeOccurrences(
  prepared,
  indexSource = randomIndex
) {
  if (
    !prepared ||
    prepared.version !== 1 ||
    !Array.isArray(prepared.eligibleIds) ||
    prepared.eligibleIds.length === 0 ||
    new Set(prepared.eligibleIds).size !==
      prepared.eligibleIds.length ||
    typeof indexSource !== "function"
  ) {
    fail("範囲攻撃の準備結果が不正です。");
  }

  const scope = readScope(prepared.scope);
  const candidates = [...prepared.eligibleIds];
  const selections = [];
  let targetIds;

  if (scope.mode === "all") {
    targetIds = candidates;
  } else if (scope.mode === "specified") {
    targetIds = [...prepared.specifiedTargetIds];

    if (
      targetIds.length === 0 ||
      targetIds.length > scope.maximumTargets ||
      new Set(targetIds).size !== targetIds.length ||
      targetIds.some(id => !candidates.includes(id))
    ) {
      fail("指定範囲メンバーが準備結果と一致しません。");
    }
  } else {
    const count = Math.min(
      scope.maximumTargets,
      candidates.length
    );

    targetIds = [];

    for (let drawIndex = 0; drawIndex < count; drawIndex++) {
      const candidateIndex = indexSource(candidates.length);

      integer(candidateIndex, "抽選位置");

      if (candidateIndex >= candidates.length) {
        fail("範囲攻撃の抽選位置が候補数を超えています。");
      }

      const targetId = candidates[candidateIndex];

      // 不移除候选，不去重：允许重复抽中。
      targetIds.push(targetId);

      selections.push({
        drawIndex,
        candidateIndex,
        targetId
      });
    }
  }

  return {
    version: 1,
    commandId: prepared.commandId,
    mode: scope.mode,
    candidateIds: candidates,
    selections,
    occurrences: targetIds.map((targetId, occurrenceIndex) => ({
      commandId: prepared.commandId,
      occurrenceIndex,
      targetId
    }))
  };
}


/**
 * 检查正式目标选择记录。
 *
 * 不产生随机数，不修改输入。
 * 允许随机重复，但禁止超次数、改目标、丢抽签记录。
 *
 * 只检查记录的内部一致性；
 * 正式预检结果仍必须来自本次事务，不能信任外部导入。
 */
export function validateRangeSelection(prepared, selected) {
  if (
    !prepared ||
    prepared.version !== 1 ||
    typeof prepared.commandId !== "string" ||
    prepared.commandId.trim() === "" ||
    !Array.isArray(prepared.eligibleIds) ||
    prepared.eligibleIds.length === 0 ||
    prepared.eligibleIds.some(
      id => typeof id !== "string" || id.trim() === ""
    ) ||
    new Set(prepared.eligibleIds).size !==
      prepared.eligibleIds.length
  ) {
    fail("範囲攻撃の準備結果が不正です。");
  }

  const scope = readScope(prepared.scope);
  const candidates = prepared.eligibleIds;

  if (
    !selected ||
    selected.version !== 1 ||
    selected.commandId !== prepared.commandId ||
    selected.mode !== scope.mode ||
    !Array.isArray(selected.candidateIds) ||
    !Array.isArray(selected.selections) ||
    !Array.isArray(selected.occurrences) ||
    selected.occurrences.length === 0
  ) {
    fail("範囲攻撃の目標選択記録が不正です。");
  }

  if (
    selected.candidateIds.length !== candidates.length ||
    selected.candidateIds.some(
      (id, index) => id !== candidates[index]
    )
  ) {
    fail("範囲攻撃の候補一覧が正式照合と一致しません。");
  }

  for (
    let index = 0;
    index < selected.occurrences.length;
    index++
  ) {
    const occurrence = selected.occurrences[index];

    if (
      !occurrence ||
      occurrence.commandId !== prepared.commandId ||
      occurrence.occurrenceIndex !== index ||
      !candidates.includes(occurrence.targetId)
    ) {
      fail("範囲攻撃の対象が正式候補と一致しません。");
    }
  }

  if (scope.mode === "random") {
    const expectedCount = Math.min(
      scope.maximumTargets,
      candidates.length
    );

    if (
      selected.occurrences.length !== expectedCount ||
      selected.selections.length !== expectedCount
    ) {
      fail("範囲攻撃の抽選回数が正式上限と一致しません。");
    }

    for (let index = 0; index < expectedCount; index++) {
      const draw = selected.selections[index];
      const occurrence = selected.occurrences[index];

      if (
        !draw ||
        draw.drawIndex !== index ||
        !Number.isSafeInteger(draw.candidateIndex) ||
        draw.candidateIndex < 0 ||
        draw.candidateIndex >= candidates.length ||
        draw.targetId !== candidates[draw.candidateIndex] ||
        draw.targetId !== occurrence.targetId
      ) {
        fail("範囲攻撃の抽選記録と対象が一致しません。");
      }
    }

    // 刻意不检查目标唯一性：
    // 随机允许同一单位重复被选。
    return true;
  }

  if (selected.selections.length !== 0) {
    fail("非抽選の範囲攻撃に抽選記録が含まれています。");
  }

  let expectedIds;

  if (scope.mode === "all") {
    expectedIds = candidates;
  } else {
    const ids = prepared.specifiedTargetIds;

    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.length > scope.maximumTargets ||
      new Set(ids).size !== ids.length ||
      ids.some(id => !candidates.includes(id))
    ) {
      fail("正式な指定メンバー一覧が不正です。");
    }

    expectedIds = ids;
  }

  if (
    selected.occurrences.length !== expectedIds.length ||
    selected.occurrences.some(
      (occurrence, index) =>
        occurrence.targetId !== expectedIds[index]
    )
  ) {
    fail("範囲攻撃の対象集合が正式指定と一致しません。");
  }

  return true;
}

/**
 * 每次范围命中独立执行完整X·YR。
 *
 * 重复抽中同一目标也不合并命中掷币。
 * 之后的伤害计算才能按目标统一合算。
 */
export function resolveRangeProjectionHits(
  prepared,
  selected,
  coinSource
) {
  // 先完整验证目标和抽取次数，再允许产生命中随机数。
  validateRangeSelection(prepared, selected);
  if (
    !selected ||
    selected.version !== 1 ||
    selected.commandId !== prepared.commandId ||
    !Array.isArray(selected.occurrences) ||
    selected.occurrences.length === 0 ||
    (
      coinSource !== undefined &&
      typeof coinSource !== "function"
    )
  ) {
    fail("範囲攻撃の目標選択結果が不正です。");
  }

  const checks = new Map(
    prepared.checks
      .filter(check => check.allowed)
      .map(check => [check.targetId, check])
  );

  // 全出现项先校验，再开始正式命中随机。
  const inputs = selected.occurrences.map((occurrence, index) => {
    const check = checks.get(occurrence.targetId);

    if (
      occurrence.commandId !== prepared.commandId ||
      occurrence.occurrenceIndex !== index ||
      !check
    ) {
      fail("範囲攻撃の対象と正式条件照合が一致しません。");
    }

    return {
      occurrence: copy(occurrence),
      input: {
        ...prepared.projection,
        guidance: prepared.guidance,
        bonuses: check.bonuses,
        penalties: check.penalties
      }
    };
  });

  const reports = inputs.map(({ occurrence, input }) => ({
    ...occurrence,
    hit: coinSource === undefined
      ? resolveHitCoins(input)
      : resolveHitCoins(input, coinSource)
  }));

  return {
    version: 1,
    step: "range-hit",
    commandId: prepared.commandId,

    // 仅报告一次资源需求；本函数不执行扣弹。
    ammoCost: prepared.ammoCost,

    selection: copy(selected),
    reports
  };
}
