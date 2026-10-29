// ===== 装甲与穿深等级 =====
// 8级、36阶；U只有1阶。
// 页面与错误提示使用日语，注释使用中文。

const LEVELS = Object.freeze([
  "F", "E", "D", "C", "B", "A", "S", "U"
]);

const SUFFIXES = Object.freeze([
  "--", "-", "", "+", "++"
]);

export const ARMOR_STEPS = Object.freeze([
  ...LEVELS.slice(0, 7).flatMap(
    level => SUFFIXES.map(suffix => level + suffix)
  ),
  "U"
]);

export function parseArmorGrade(value) {
  if (typeof value !== "string") {
    throw new Error("装甲・貫徹等級は文字列で指定してください。");
  }

  const normalized = value.trim().toUpperCase();
  const displayStepIndex = ARMOR_STEPS.indexOf(normalized);

  if (displayStepIndex < 0) {
    throw new Error(
      "装甲・貫徹等級が不正です。" +
      "FからSには--・-・無修飾・+・++を使用できます。" +
      "Uは無修飾のみ表示します。"
    );
  }

  const level = normalized[0];
  const levelIndex = LEVELS.indexOf(level);

  // 判定尺度包含隐藏的U--、U-、U、U+、U++。
  // 显示U对应无修饰U：
  // S++ = 34，U-- = 35，U- = 36，U = 37。
  const stepIndex = normalized === "U"
    ? 37
    : displayStepIndex;

  return {
    value: normalized,
    level,
    levelIndex,
    displayStepIndex,
    stepIndex
  };
}


/**
 * 正数：穿深高于装甲。
 * 0：相同。
 * 负数：穿深低于装甲。
 *
 * 不在这里判断大穿／碎的两级门槛。
 */
export function comparePenetrationToArmor(
  penetration,
  armor
) {
  return (
    parseArmorGrade(penetration).stepIndex -
    parseArmorGrade(armor).stepIndex
  );
}

export const PENETRATION_LABELS = Object.freeze({
  major: "大貫徹",
  penetration: "貫徹",
  normal: "通常",
  shatter: "破砕",
  water: "水中命中",
  ingressFailure: "進失"
});

export function getPenetrationLabel(result) {
  if (!Object.hasOwn(PENETRATION_LABELS, result)) {
    throw new Error("貫徹判定の種類が不正です。");
  }

  return PENETRATION_LABELS[result];
}

/**
 * 用“常”的份数精确表示伤害，不用浮点数累计1/3。
 *
 * 大穿 = 9份常 = 3点耐性。
 * 穿   = 3份常 = 1点耐性。
 * 常   = 1份常。
 * 碎   = 0份常。
 *
 * 本函数不决定这些份数跨攻击／次序是否累计。
 */
export function getNormalDamageTokens(result) {
  const tokens = {
    major: 9,
    penetration: 3,
    normal: 1,
    shatter: 0
  };

  if (!Object.hasOwn(tokens, result)) {
    throw new Error(
      "水中命中と進失は、対応する通常判定へ変換してから計算してください。"
    );
  }

  return tokens[result];
}

export function downgradePenetration(result) {
  const downgrade = {
    major: "penetration",
    penetration: "normal",
    normal: "shatter",
    shatter: "shatter"
  };

  if (!Object.hasOwn(downgrade, result)) {
    throw new Error(
      "過剰貫通の処理には通常の貫徹判定が必要です。"
    );
  }

  return downgrade[result];
}

export function isOverpenetrationPosition(position) {
  // 兼容现有快照中的中文位置名及日语显示名称。
  const reduced = new Set([
    "前部", "后部", "後部", "尾部"
  ]);

  const unchanged = new Set([
    "中部①", "中部②", "两舷", "両舷"
  ]);

  if (reduced.has(position)) return true;
  if (unchanged.has(position)) return false;

  throw new Error("艦船の命中部位が不正です。");
}
export function isMajorPenetration(penetration, armor) {
  // 恰好高10阶仍为穿，高11阶才进入大穿。
  return comparePenetrationToArmor(penetration, armor) > 10;
}

/**
 * 已命中且没有触发进失时，进行穿深与装甲比较。
 * 这里只分类，不抛硬币、不扣耐性、不推进阶段。
 */
export function classifyPenetration(penetration, armor) {
  const penetrationGrade = parseArmorGrade(penetration);
  const armorGrade = parseArmorGrade(armor);

  const difference =
    penetrationGrade.stepIndex - armorGrade.stepIndex;

  if (difference > 10) {
    return "major";
  }

  if (difference > 0) {
    return "penetration";
  }

  if (difference < -10) {
    return "shatter";
  }

  return "normal";
}

