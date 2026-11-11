import {
  compareArmorGrades
} from "./armor-runtime.js";

// 舰炮命中后的判定。
// 不修改场景，不扣弹，不直接改变舰船损伤状态。
// 随机结果必须由正式结算调用方在同一事务中保存。

const HIT_POSITIONS = Object.freeze([
  Object.freeze({ id: "front", label: "前部", overpenetration: true }),
  Object.freeze({ id: "middle-1", label: "中部①", overpenetration: false }),
  Object.freeze({ id: "middle-2", label: "中部②", overpenetration: false }),
  Object.freeze({ id: "sides", label: "両舷", overpenetration: false }),
  Object.freeze({ id: "rear", label: "後部", overpenetration: true }),
  Object.freeze({ id: "tail", label: "尾部", overpenetration: true })
]);

const CATEGORIES = new Set([
  "major",
  "penetration",
  "normal",
  "shatter"
]);

const LABELS = Object.freeze({
  major: "大貫通",
  penetration: "貫通",
  normal: "通常命中",
  shatter: "破砕"
});

// 用“常命中份数”保存伤害，避免使用1/3浮点数。
// 3份常 = 1点耐性伤害。
const NORMAL_CREDITS = Object.freeze({
  major: 9,
  penetration: 3,
  normal: 1,
  shatter: 0
});

function requireInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label}の値が不正です。`);
  }

  return value;
}

function randomCoin() {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("艦砲判定に必要な乱数機能を利用できません。");
  }

  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return (buffer[0] & 1) === 1;
}

function toss(source) {
  const result = source();

  if (typeof result !== "boolean") {
    throw new Error("コイン判定は真偽値を返す必要があります。");
  }

  return result;
}

/**
 * 用三枚公平硬币抽取0～5。
 * 6和7拒绝重抽，避免直接取模造成部位概率不等。
 * 六个部位始终参与，不根据装备是否为空改变概率。
 */
function choosePosition(coinSource) {
  const attempts = [];

  for (;;) {
    const coins = [
      toss(coinSource),
      toss(coinSource),
      toss(coinSource)
    ];

    const value =
      (coins[0] ? 4 : 0) +
      (coins[1] ? 2 : 0) +
      (coins[2] ? 1 : 0);

    attempts.push({ coins, value, accepted: value < 6 });

    if (value < 6) {
      return {
        ...HIT_POSITIONS[value],
        attempts
      };
    }
  }
}

function downgrade(category) {
  switch (category) {
    case "major":
      return "penetration";
    case "penetration":
      return "normal";
    case "normal":
    case "shatter":
      return "shatter";
    default:
      throw new Error("艦砲命中の種別が不正です。");
  }
}

function readBaseComparison(penetration, armor) {
  // 零穿深由比较器统一解释为比F--低一档。
  // 预览与正式命中使用相同规则。
  return compareArmorGrades(penetration, armor);
}


/**
 * 判定一枚已经命中的舰炮弹。
 *
 * 流程：
 * 1. 进失：反面时作为常，不再检查水中命中。
 * 2. 非进失时，使用基础穿深类别。
 * 3. 穿或常检查三枚水中硬币。
 * 4. 等概率抽取六个舰船部位。
 * 5. 前部、后部、尾部执行降级。
 *
 * 此处只返回起火资格，不掷起火硬币：
 * 正式状态层必须先检查是否已经起火。
 */
export function resolveCannonImpact({
  penetration,
  armor
}, coinSource = randomCoin) {
  if (typeof coinSource !== "function") {
    throw new Error("艦砲判定のコイン関数がありません。");
  }

  // 随机判定前先验证资料，避免无效资料消耗随机结果。
  const comparison = readBaseComparison(penetration, armor);

  const progressHeads = toss(coinSource);
  const progressLost = !progressHeads;

  const originalCategory = progressLost
    ? "normal"
    : comparison.category;

  let category = originalCategory;
  let waterHit = false;
  const waterCoins = [];

  if (
    !progressLost &&
    ["penetration", "normal"].includes(category)
  ) {
    waterCoins.push(
      toss(coinSource),
      toss(coinSource),
      toss(coinSource)
    );

    waterHit = waterCoins.every(Boolean);

    if (waterHit) {
      category = category === "penetration"
        ? "major"
        : "penetration";
    }
  }

  const position = choosePosition(coinSource);

  if (position.overpenetration) {
    // 水中命中在这些部位退回原来的穿／常。
    // 其余类别下降一级。
    category = waterHit
      ? originalCategory
      : downgrade(category);
  }

  return {
    version: 1,
    comparison,
    progressHeads,
    progressLost,
    originalCategory,
    waterCoins,
    waterHit,
    position,
    finalCategory: category,
    finalLabel: LABELS[category],
    normalCredits: NORMAL_CREDITS[category],

    // 碎只是命中，不造成任何被害。
    hasDamageEffect: category !== "shatter",

    // 仅为候选；是否投起火硬币由状态层判断。
    fireEligible: ["major", "penetration"].includes(category)
  };
}

/**
 * 合算舰炮结果与舰船已有的常命中余数。
 * 可以跨装备组累计，但调用方必须按目标分别合算。
 *
 * 返回值是耐性伤害与新余数。
 * 不在这里执行大破→濒临沉没等状态变化。
 */
export function summarizeCannonImpacts(
  impacts,
  normalHitRemainder
) {
  if (!Array.isArray(impacts)) {
    throw new Error("艦砲命中結果の一覧が不正です。");
  }

  requireInteger(normalHitRemainder, "通常命中の累積値");

  if (normalHitRemainder > 2) {
    throw new Error("通常命中の累積値は0～2で指定してください。");
  }

  let totalCredits = normalHitRemainder;
  let damagingImpactCount = 0;
  let fireEligibleCount = 0;

  for (const impact of impacts) {
    if (
      !impact ||
      impact.version !== 1 ||
      !CATEGORIES.has(impact.finalCategory) ||
      impact.normalCredits !== NORMAL_CREDITS[impact.finalCategory]
    ) {
      throw new Error("艦砲命中結果の保存形式が不正です。");
    }

    totalCredits += impact.normalCredits;
    requireInteger(totalCredits, "通常命中換算の合計");

    if (impact.finalCategory !== "shatter") {
      damagingImpactCount += 1;
    }

    if (["major", "penetration"].includes(impact.finalCategory)) {
      fireEligibleCount += 1;
    }
  }

  return {
    version: 1,
    hpDamage: Math.floor(totalCredits / 3),
    normalHitRemainder: totalCredits % 3,
    damagingImpactCount,
    fireEligibleCount
  };
}

/**
 * 确定性说明，供目标检查界面调用。
 * 不掷硬币，不读取目标内部累计余数。
 */
export function getCannonDamagePreview({
  penetration,
  armor
}) {
  const comparison = readBaseComparison(penetration, armor);

  return [
    `基本比較：${comparison.label} / 階差 ${comparison.difference}`,
    "命中後、進失コインが裏なら通常命中として扱います。",
    "進失の場合、水中命中の判定は行いません。",
    "進失でない貫通・通常命中は、3枚すべて表なら水中命中です。",
    "命中部位は、空き配置も含む6部位から等確率で選びます。",
    "前部・後部・尾部では1段階低下します。",
    "水中命中は、その部位では元の貫通・通常命中に戻ります。",
    "大貫通＝耐性3、貫通＝耐性1、通常命中3枚＝耐性1。",
    "通常命中の不足分は目標ごとに保存します。",
    "破砕は被害・軽微な損傷・沈没を発生させません。",
    "この表示ではコインを投げず、最終被害を決定しません。"
  ];
}
