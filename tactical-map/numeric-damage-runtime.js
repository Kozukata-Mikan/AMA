import { compareArmorGrades } from "./armor-runtime.js";

// 普通数字威力与水下数字威力。
// 不处理舰炮、设备损坏，不修改场景或存档。
// 输入命中数量必须来自正式命中判定，而不是投射总弹数。

const STRENGTH_ARMOR = Object.freeze([
  "F", "E", "D", "C", "B", "A", "S", "U"
]);

function requireInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label}の値が不正です。`);
  }

  return value;
}

/**
 * 读取数字威力。
 *
 * 支持：
 * 2
 * "2"
 * "2（水下）"
 * "2(水下)"
 * "威力：2（水下）"
 *
 * 设备威力、舰炮规则不允许送入本模块。
 */
export function readNumericPower(value) {
  const text = typeof value === "number"
    ? String(value)
    : typeof value === "string"
      ? value.trim()
      : "";

  const normalized = text
    .replace(/^威力\s*[:：]\s*/, "")
    .trim();

  const match = /^(\d+)\s*(?:[（(]\s*(水下)\s*[）)])?$/
    .exec(normalized);

  if (!match) {
    throw new Error(
      "この処理には数字威力または数字威力（水下）を指定してください。"
    );
  }

  const power = requireInteger(
    Number(match[1]),
    "威力",
    1
  );

  return {
    power,
    underwater: match[2] === "水下"
  };
}

function penetrationExceedsArmor(penetration, armor) {
  // "-"表示穿深0。
  // 对普通数字威力，它不能高于已定义的任何装甲等级。
  // 这不需要将0伪装成某个装甲阶。
  if (
    typeof penetration === "string" &&
    penetration.trim() === "-"
  ) {
    // 同时验证装甲，不能让无效目标资料绕过检查。
    compareArmorGrades(armor, armor);
    return false;
  }

  return compareArmorGrades(
    penetration,
    armor
  ).difference > 0;
}

/**
 * 汇总一次装备组攻击对一个目标的数字威力伤害。
 *
 * 参数：
 * powerRule：数字威力原字段。
 * hitCount：最终命中枚数。
 * penetration：穿深。
 * armor：目标本来装甲。
 * inertial：是否属于惯性攻击，由装备适配层明确提供。
 * strength：目标固有强度，惯性攻击时必须提供。
 * strengthRemaining：目标剩余水下强度防御次数，
 *                    水下威力时必须提供。
 *
 * 返回值只描述伤害与强度消耗。
 * 调用方必须在同一保存事务中应用二者。
 */
export function resolveNumericDamage({
  powerRule,
  hitCount,
  penetration,
  armor,
  inertial = false,
  strength,
  strengthRemaining
}) {
  const parsed = readNumericPower(powerRule);

  requireInteger(hitCount, "命中数");

  if (typeof inertial !== "boolean") {
    throw new Error("慣性攻撃の指定が不正です。");
  }

  let damagePerUnprotectedHit;
  let protectedHitCount = 0;
  let effectiveArmor = null;
  let nextStrengthRemaining = null;

  if (parsed.underwater) {
    requireInteger(
      strengthRemaining,
      "残存する強度防御回数"
    );

    // 水下威力先按专门规则无视装甲。
    // 每次命中消耗一次尚存的强度防御。
    protectedHitCount = Math.min(
      hitCount,
      strengthRemaining
    );

    nextStrengthRemaining =
      strengthRemaining - protectedHitCount;

    damagePerUnprotectedHit = parsed.power;
  } else {
    effectiveArmor = armor;

    if (inertial) {
      requireInteger(strength, "固有強度");

      if (strength > 7) {
        throw new Error("固有強度は0～7で指定してください。");
      }

      // 惯性防御不消耗水下强度防御次数。
      effectiveArmor = STRENGTH_ARMOR[strength];
    }

    damagePerUnprotectedHit = penetrationExceedsArmor(
      penetration,
      effectiveArmor
    )
      ? parsed.power
      : 1;
  }

  const unprotectedHitCount =
    hitCount - protectedHitCount;

  const hpDamage =
    protectedHitCount +
    unprotectedHitCount * damagePerUnprotectedHit;

  requireInteger(hpDamage, "耐性被害の合計");

  return {
    version: 1,
    kind: parsed.underwater ? "underwater" : "numeric",
    power: parsed.power,
    hitCount,
    hpDamage,
    hasDamageEffect: hitCount > 0,
    effectiveArmor,
    protectedHitCount,
    unprotectedHitCount,
    damagePerUnprotectedHit,
    strengthConsumed: protectedHitCount,
    strengthRemainingBefore: parsed.underwater
      ? strengthRemaining
      : null,
    strengthRemainingAfter: nextStrengthRemaining,

    // 只提供资格；实际进水抽签由状态层执行。
    // 已经进水时，不重复获得，也不重复进行获取判定。
    floodingEligible: parsed.underwater && hitCount > 0
  };
}

/**
 * 只显示规则路径，不读取剩余强度或掷硬币。
 * 可供观察权限过滤后的目标检查使用。
 */
export function getNumericDamagePreview({
  powerRule,
  penetration,
  armor,
  inertial = false,
  strength
}) {
  const parsed = readNumericPower(powerRule);

  if (parsed.underwater) {
    return [
      `水下威力：1命中につき耐性${parsed.power}。`,
      "装甲を無視します。",
      "強度防御が残っている命中は、威力を1に固定します。",
      "命中ごとに強度防御を1回消費します。",
      "この表示では残存回数を読み出さず、消費もしません。",
      "進水の取得判定は正式な結算時に処理します。"
    ];
  }

  const result = resolveNumericDamage({
    powerRule,
    hitCount: 1,
    penetration,
    armor,
    inertial,
    strength
  });

  return [
    `数字威力：${parsed.power}`,
    `判定用装甲：${result.effectiveArmor}`,
    `1命中あたりの耐性被害：${result.hpDamage}`,
    inertial
      ? "慣性攻撃は固有強度に対応する装甲等級を使用します。"
      : "貫通が装甲を超えない場合、威力を1に固定します。",
    "進失・水中命中・艦船部位の抽選は適用しません。",
    "この表示では命中判定や耐性変更を行いません。"
  ];
}
