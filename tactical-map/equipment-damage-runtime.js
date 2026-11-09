// ===== 设备威力与固定八项命中算法 =====
// 不修改场景、舰船、图鉴快照或存档。
// 正式武器命中数来自命中模块。
// 每枚命中按设备威力产生对应数量的设备命中分配。

export const EQUIPMENT_HIT_ITEMS = Object.freeze([
  Object.freeze({
    id: "front",
    kind: "position",
    label: "前部"
  }),
  Object.freeze({
    id: "middle-1",
    kind: "position",
    label: "中部①"
  }),
  Object.freeze({
    id: "middle-2",
    kind: "position",
    label: "中部②"
  }),
  Object.freeze({
    id: "both-sides",
    kind: "position",
    label: "両舷"
  }),
  Object.freeze({
    id: "rear",
    kind: "position",
    label: "後部"
  }),
  Object.freeze({
    id: "tail",
    kind: "position",
    label: "尾部"
  }),
  Object.freeze({
    id: "sea-recon",
    kind: "recon",
    label: "対海偵察"
  }),
  Object.freeze({
    id: "air-recon",
    kind: "recon",
    label: "対空偵察"
  })
]);

function fail(message) {
  throw new Error(message);
}

function requireInteger(value, label, minimum = 0) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    fail(`${label}の値が不正です。`);
  }

  return value;
}

function parseEquipmentPower(value) {
  if (typeof value !== "string") return null;

  const normalized = value
    .trim()
    .replace(/^威力\s*[:：]\s*/, "")
    .trim();

  // 接受用户确认的简体表记，以及同义繁体／日语表记。
  // 不接受设备威力（水下）等未确认的组合规则。
  const match =
    /^(\d+)\s*[（(]\s*(?:设备|設備)\s*[）)]$/
      .exec(normalized);

  if (!match) return null;

  return {
    power: requireInteger(
      Number(match[1]),
      "設備威力",
      1
    )
  };
}

/**
 * 严格读取设备威力。
 *
 * 支持：
 * "威力：1（设备）"
 * "威力：2（设备）"
 * "1（设备）"
 * "1(設備)"
 *
 * 数字威力和舰炮规则不进入本模块。
 */
export function readEquipmentPower(value) {
  const parsed = parseEquipmentPower(value);

  if (!parsed) {
    fail(
      "設備威力は「威力：1（設備）」の形式で指定してください。"
    );
  }

  return {
    kind: "equipment",
    power: parsed.power
  };
}

/**
 * 供统一威力解析器尝试设备分支。
 *
 * 不是设备表记时返回null。
 * 设备表记中的数值非法时仍抛错，不降级为其他规则。
 */
export function tryReadEquipmentPower(value) {
  const parsed = parseEquipmentPower(value);

  return parsed
    ? {
        kind: "equipment",
        power: parsed.power
      }
    : null;
}

/**
 * 无随机数的设备伤害预检。
 */
export function getEquipmentDamagePlan({
  powerRule,
  hitCount
}) {
  const parsed = readEquipmentPower(powerRule);

  requireInteger(hitCount, "武器命中数");

  const allocationCount = parsed.power * hitCount;

  requireInteger(
    allocationCount,
    "設備命中の割当数"
  );

  return {
    version: 1,
    kind: "equipment",
    power: parsed.power,
    hitCount,
    allocationCount,
    hpDamage: 0,
    ignoresArmor: true,
    ignoresPenetration: true,
    ignoresInertialDefense: true
  };
}

/**
 * 固定八项的等概率随机选择。
 *
 * 八可以整除32位随机数的取值总数，
 * 因此取模不会引入候选概率偏差。
 */
function randomHitItemIndex() {
  if (!globalThis.crypto?.getRandomValues) {
    fail("設備命中の抽選に必要な乱数機能を利用できません。");
  }

  const value = new Uint32Array(1);
  globalThis.crypto.getRandomValues(value);

  return value[0] % EQUIPMENT_HIT_ITEMS.length;
}

/**
 * 产生设备命中分配。
 *
 * selectIndex可由测试注入：
 * selectIndex(candidateCount, context) => candidateIndex
 *
 * 正式处理不传入时使用浏览器加密随机源。
 * 不排除任何候选，不去重。
 */
export function resolveEquipmentImpacts(
  input,
  selectIndex
) {
  if (
    selectIndex !== undefined &&
    typeof selectIndex !== "function"
  ) {
    fail("設備命中の抽選関数が不正です。");
  }

  const plan = getEquipmentDamagePlan(input);
  const draws = [];

  for (
    let allocationIndex = 0;
    allocationIndex < plan.allocationCount;
    allocationIndex++
  ) {
    const weaponHitIndex = Math.floor(
      allocationIndex / plan.power
    );

    const powerIndex = allocationIndex % plan.power;

    const context = {
      allocationIndex,
      weaponHitIndex,
      powerIndex
    };

    const candidateIndex = selectIndex === undefined
      ? randomHitItemIndex()
      : selectIndex(
          EQUIPMENT_HIT_ITEMS.length,
          { ...context }
        );

    if (
      !Number.isSafeInteger(candidateIndex) ||
      candidateIndex < 0 ||
      candidateIndex >= EQUIPMENT_HIT_ITEMS.length
    ) {
      fail("設備命中の抽選結果が範囲外です。");
    }

    const item = EQUIPMENT_HIT_ITEMS[candidateIndex];

    draws.push({
      ...context,
      candidateIndex,
      itemId: item.id
    });
  }

  return {
    ...plan,
    candidateIds: EQUIPMENT_HIT_ITEMS.map(
      item => item.id
    ),
    draws
  };
}

/**
 * 校验设备分配报告。
 * 不重新抽选，不补造历史结果。
 */
export function validateEquipmentImpactReport(report) {
  if (
    !report ||
    typeof report !== "object" ||
    Array.isArray(report) ||
    report.version !== 1 ||
    report.kind !== "equipment"
  ) {
    fail("設備命中の処理記録が不正です。");
  }

  requireInteger(report.power, "設備威力", 1);
  requireInteger(report.hitCount, "武器命中数");
  requireInteger(
    report.allocationCount,
    "設備命中の割当数"
  );

  const expectedCount =
    report.power * report.hitCount;

  requireInteger(
    expectedCount,
    "設備命中の割当数"
  );

  if (
    report.allocationCount !== expectedCount ||
    report.hpDamage !== 0 ||
    report.ignoresArmor !== true ||
    report.ignoresPenetration !== true ||
    report.ignoresInertialDefense !== true ||
    !Array.isArray(report.candidateIds) ||
    JSON.stringify(report.candidateIds) !==
      JSON.stringify(
        EQUIPMENT_HIT_ITEMS.map(item => item.id)
      ) ||
    !Array.isArray(report.draws) ||
    report.draws.length !== expectedCount
  ) {
    fail("設備命中の数量または候補記録が不正です。");
  }

  for (
    let index = 0;
    index < report.draws.length;
    index++
  ) {
    const draw = report.draws[index];

    if (
      !draw ||
      draw.allocationIndex !== index ||
      draw.weaponHitIndex !==
        Math.floor(index / report.power) ||
      draw.powerIndex !== index % report.power ||
      !Number.isSafeInteger(draw.candidateIndex) ||
      draw.candidateIndex < 0 ||
      draw.candidateIndex >= EQUIPMENT_HIT_ITEMS.length ||
      draw.itemId !==
        EQUIPMENT_HIT_ITEMS[draw.candidateIndex].id
    ) {
      fail("設備命中の抽選履歴が一致しません。");
    }
  }
}
// ===== 八项项目内部损管 =====
// 候选单位是舰船六个位置及两项侦察，不是装备组。
// 先选对象，再对同一对象判定一次R。
// 失败使选中对象彻底损坏。

function randomEquipmentControlIndex(candidateCount) {
  requireInteger(candidateCount, "設備損管の候補数", 1);

  if (candidateCount > EQUIPMENT_HIT_ITEMS.length) {
    fail("設備損管の候補数が範囲外です。");
  }

  if (!globalThis.crypto?.getRandomValues) {
    fail("設備損管の抽選に必要な乱数機能を利用できません。");
  }

  // 候选数量不一定能整除32位随机数范围。
  // 使用拒绝采样，避免直接取模造成概率偏差。
  const range = 0x100000000;
  const limit = range - range % candidateCount;
  const value = new Uint32Array(1);

  do {
    globalThis.crypto.getRandomValues(value);
  } while (value[0] >= limit);

  return value[0] % candidateCount;
}

function equipmentControlCoin() {
  if (!globalThis.crypto?.getRandomValues) {
    fail("設備損管のコイン判定に必要な乱数機能を利用できません。");
  }

  const value = new Uint32Array(1);
  globalThis.crypto.getRandomValues(value);

  // R：正面成功，反面失败。
  return (value[0] & 1) === 1;
}

/**
 * 将内部损管候选固定为八项顺序。
 *
 * 输入只能包含已损坏且未彻底损坏的项目ID。
 * 实际损伤资格由调用方从运行状态中生成；
 * 不允许直接采用页面传入的候选列表。
 */
function normalizeEquipmentControlCandidates(value) {
  const allowedIds = new Set(
    EQUIPMENT_HIT_ITEMS.map(item => item.id)
  );

  if (
    !Array.isArray(value) ||
    value.some(id =>
      typeof id !== "string" ||
      !allowedIds.has(id)
    ) ||
    new Set(value).size !== value.length
  ) {
    fail("設備損管の対象一覧が不正です。");
  }

  const selectedIds = new Set(value);

  return EQUIPMENT_HIT_ITEMS
    .filter(item => selectedIds.has(item.id))
    .map(item => item.id);
}

/**
 * 八项项目的内部损管算法。
 *
 * input:
 * {
 *   candidateIds: ["front", "sea-recon"]
 * }
 *
 * sources:
 * {
 *   selectIndex: candidateCount => index,
 *   coinSource: () => boolean
 * }
 *
 * 随机源可供隔离预检和测试注入。
 * 本函数不修改舰船或保存状态，也不推进阶段。
 */
export function resolveEquipmentItemDamageControl(
  input,
  sources = {}
) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    !sources ||
    typeof sources !== "object" ||
    Array.isArray(sources)
  ) {
    fail("設備損管の入力が不正です。");
  }

  const { selectIndex, coinSource } = sources;

  if (
    selectIndex !== undefined &&
    typeof selectIndex !== "function"
  ) {
    fail("設備損管の抽選関数が不正です。");
  }

  if (
    coinSource !== undefined &&
    typeof coinSource !== "function"
  ) {
    fail("設備損管のコイン関数が不正です。");
  }

  const candidateIds =
    normalizeEquipmentControlCandidates(
      input.candidateIds
    );

  if (candidateIds.length === 0) {
    return {
      version: 1,
      kind: "equipment-item-control",
      skipped: true,
      candidateIds,
      selectedIndex: null,
      itemId: null,
      coinHeads: null,
      success: null,
      outcome: null
    };
  }

  // 无论最后成功还是失败，都先确定同一个处理对象。
  const selectedIndex = selectIndex === undefined
    ? randomEquipmentControlIndex(candidateIds.length)
    : selectIndex(candidateIds.length);

  if (
    !Number.isSafeInteger(selectedIndex) ||
    selectedIndex < 0 ||
    selectedIndex >= candidateIds.length
  ) {
    fail("設備損管の抽選結果が範囲外です。");
  }

  const itemId = candidateIds[selectedIndex];

  const coinHeads = coinSource === undefined
    ? equipmentControlCoin()
    : coinSource();

  if (typeof coinHeads !== "boolean") {
    fail("設備損管のコイン結果が不正です。");
  }

  return {
    version: 1,
    kind: "equipment-item-control",
    skipped: false,
    candidateIds,
    selectedIndex,
    itemId,
    coinHeads,
    success: coinHeads,
    outcome: coinHeads ? "repaired" : "destroyed"
  };
}

/**
 * 校验内部损管报告。
 * 不重新抽选，不重新掷硬币，不补造历史结果。
 */
export function validateEquipmentItemControlReport(report) {
  if (
    !report ||
    typeof report !== "object" ||
    Array.isArray(report) ||
    report.version !== 1 ||
    report.kind !== "equipment-item-control" ||
    typeof report.skipped !== "boolean"
  ) {
    fail("設備損管の処理記録が不正です。");
  }

  const candidateIds =
    normalizeEquipmentControlCandidates(
      report.candidateIds
    );

  if (
    JSON.stringify(candidateIds) !==
      JSON.stringify(report.candidateIds)
  ) {
    fail("設備損管の候補順序が不正です。");
  }

  if (report.skipped) {
    if (
      candidateIds.length !== 0 ||
      report.selectedIndex !== null ||
      report.itemId !== null ||
      report.coinHeads !== null ||
      report.success !== null ||
      report.outcome !== null
    ) {
      fail("設備損管の未実施記録が不正です。");
    }

    return;
  }

  if (
    candidateIds.length === 0 ||
    !Number.isSafeInteger(report.selectedIndex) ||
    report.selectedIndex < 0 ||
    report.selectedIndex >= candidateIds.length ||
    report.itemId !==
      candidateIds[report.selectedIndex] ||
    typeof report.coinHeads !== "boolean" ||
    report.success !== report.coinHeads ||
    report.outcome !== (
      report.coinHeads ? "repaired" : "destroyed"
    )
  ) {
    fail("設備損管の対象と判定結果が一致しません。");
  }
}

