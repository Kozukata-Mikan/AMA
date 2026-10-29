// ===== 舰船基础规则 =====
// 注释可以使用中文；所有可能显示到页面的文本使用日语。
// 输入使用明确的规则参数，暂不绑定项目snapshot字段名。

export const SHIP_STATUS_LABELS = Object.freeze({
  intact: "無傷",
  minor: "軽微な損傷",
  light: "小破",
  moderate: "中破",
  heavy: "大破",
  sinking: "沈没寸前",
  sunk: "沈没"
});

const ARMOR_GRADES = Object.freeze([
  "F", "E", "D", "C", "B", "A", "S", "U"
]);

function requireNonNegative(value, label) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    throw new Error(
      `${label}には0以上の有限数を指定してください。`
    );
  }
}

function requireStrength(value) {
  if (
    !Number.isInteger(value) ||
    value < 0 ||
    value > 7
  ) {
    throw new Error(
      "強度は0から7までの整数で指定してください。"
    );
  }
}

function requireStatus(status) {
  if (!Object.hasOwn(SHIP_STATUS_LABELS, status)) {
    throw new Error("艦船の損傷状態が不正です。");
  }
}

export function getShipStatusLabel(status) {
  requireStatus(status);
  return SHIP_STATUS_LABELS[status];
}

/**
 * 应用一次已完成命中和防御判定的伤害事件。
 *
 * sufferedDamage:
 *   是否确实受到规则意义上的伤害。
 *
 * durabilityDamage:
 *   防御处理后，本应削减的耐性数值。
 *   大破时耐性虽为0，仍需传入这个数值。
 *
 * 注意：
 * - 不负责命中、装甲、伤害公式。
 * - 不直接用于按单位顺序逐个结算同次序攻击。
 * - 多次攻击的合并／事件处理方式另由结算引擎负责。
 */
export function applyShipDamage(ship, event) {
  const {
    maxHp,
    currentHp,
    status,
    hasReceivedDamage
  } = ship;

  requireNonNegative(maxHp, "最大耐性");
  requireNonNegative(currentHp, "現在耐性");
  requireStatus(status);

  if (maxHp <= 0 || currentHp > maxHp) {
    throw new Error("艦船の耐性データが不正です。");
  }

  if (typeof hasReceivedDamage !== "boolean") {
    throw new Error("被害履歴の真偽値が必要です。");
  }

  if (
    (status === "heavy" ||
      status === "sinking" ||
      status === "sunk") &&
    currentHp !== 0
  ) {
    throw new Error(
      "大破・沈没寸前・沈没の耐性は0でなければなりません。"
    );
  }

  if (
    typeof event?.sufferedDamage !== "boolean"
  ) {
    throw new Error("被害の有無を指定してください。");
  }

  requireNonNegative(
    event.durabilityDamage,
    "耐性減少量"
  );

  if (
    !event.sufferedDamage &&
    event.durabilityDamage > 0
  ) {
    throw new Error(
      "被害なしの攻撃に耐性減少量は指定できません。"
    );
  }

  const result = { ...ship };

  if (status === "sunk" || !event.sufferedDamage) {
    return result;
  }

  result.hasReceivedDamage = true;

  // 濒临沉没后再次受到任意伤害，直接沉没。
  if (status === "sinking") {
    result.status = "sunk";
    result.currentHp = 0;
    return result;
  }

  // 大破后再受到具有耐性削减效果的攻击。
  if (status === "heavy") {
    if (event.durabilityDamage > 0) {
      result.status = "sinking";
      result.sinkingElapsedMinutes = 0;
    }

    return result;
  }

  if (event.durabilityDamage === 0) {
    // 后续无耐性削减的伤害，不降低已有损伤等级。
    if (
      !hasReceivedDamage &&
      status === "intact"
    ) {
      result.status = "minor";
    }

    return result;
  }

  result.currentHp = Math.max(
    0,
    currentHp - event.durabilityDamage
  );

  if (result.currentHp === 0) {
    result.status = "heavy";
  } else if (result.currentHp <= maxHp / 2) {
    result.status = "moderate";
  } else {
    result.status = "light";
  }

  return result;
}

/**
 * 这里只检查本批规则明确的行动限制。
 * 大破不在这里被自动判定为无法行动。
 */
export function checkShipActionState(
  ship,
  { rescueLocked = false } = {}
) {
  requireStatus(ship.status);

  if (ship.status === "sunk") {
    return {
      allowed: false,
      reason: "この艦船は沈没しています。"
    };
  }

  if (ship.status === "sinking") {
    return {
      allowed: false,
      reason: "沈没寸前の艦船は行動できません。"
    };
  }

  if (rescueLocked) {
    return {
      allowed: false,
      reason: "救助中の艦船は他の行動を実行できません。"
    };
  }

  return {
    allowed: true,
    reason: ""
  };
}

export function strengthArmorGrade(strength) {
  requireStrength(strength);
  return ARMOR_GRADES[strength];
}

/**
 * 输入一次应适用强度效果的水下攻击。
 * 不在这里决定命中，也不把未命中的攻击自动计为消耗。
 */
export function applyUnderwaterStrength({
  power,
  strength,
  usesConsumed
}) {
  requireNonNegative(power, "威力");
  requireStrength(strength);

  if (
    !Number.isInteger(usesConsumed) ||
    usesConsumed < 0 ||
    usesConsumed > strength
  ) {
    throw new Error(
      "水中攻撃に対する強度効果の使用回数が不正です。"
    );
  }

  const applied = usesConsumed < strength;

  return {
    power: applied ? 1 : power,
    usesConsumed: applied
      ? usesConsumed + 1
      : usesConsumed,
    applied
  };
}

// 正数取整采用向下取整，与27节→125格的示例一致。
export function shipMovementLimit(speedKnots) {
  requireNonNegative(speedKnots, "速力");
  return Math.floor(speedKnots * 1.852 / 0.4);
}

export function shipEnduranceBudget(endurance) {
  requireNonNegative(endurance, "航続距離");
  return Math.floor(endurance * 1.852 / 0.4);
}

export function formationMovementLimit(speedsKnots) {
  if (
    !Array.isArray(speedsKnots) ||
    speedsKnots.length === 0
  ) {
    throw new Error("編隊の艦船速力が必要です。");
  }

  let minimum = Infinity;

  for (const speed of speedsKnots) {
    requireNonNegative(speed, "速力");
    minimum = Math.min(minimum, speed);
  }

  return shipMovementLimit(minimum);
}

/**
 * 侦察判断核心。
 *
 * distance由地图规则提供，不擅自决定二维／三维。
 * terrainBlocked由地形视线检查提供。
 * weatherPenalty由环境适配层提供。
 * reconnaissanceGrade须按目标军种选择对海／对空侦察。
 */
export function detectTarget({
  distance,
  reconnaissanceGrade,
  concealmentGrade,
  timePenalty,
  weatherPenalty,
  terrainBlocked
}) {
  requireNonNegative(distance, "距離");
  requireNonNegative(timePenalty, "時刻による射程減少");
  requireNonNegative(weatherPenalty, "天候による射程減少");

  if (typeof terrainBlocked !== "boolean") {
    throw new Error("地形による遮蔽判定が必要です。");
  }

  if (terrainBlocked) {
    return {
      level: "none",
      reason: "地形に遮られているため発見できません。"
    };
  }

  // 100以内不受侦察等级、时间或天气限制。
  if (distance <= 100) {
    return {
      level: "identified",
      reason: "近距離で識別しました。"
    };
  }

  const reconnaissance = ARMOR_GRADES.indexOf(
    reconnaissanceGrade
  );

  const concealment = ARMOR_GRADES.indexOf(
    concealmentGrade
  );

  if (reconnaissance < 0 || concealment < 0) {
    throw new Error(
      "偵察等級と探測強度はF・E・D・C・B・A・S・Uで指定してください。"
    );
  }

  const range = Math.max(
    0,
    400 - timePenalty - weatherPenalty
  );

  if (
    distance <= range &&
    reconnaissance >= concealment
  ) {
    return {
      level: "silhouette",
      reason: "影のみを発見しました。詳細情報は表示できません。"
    };
  }

  return {
    level: "none",
    reason: "発見条件を満たしていません。"
  };
}
