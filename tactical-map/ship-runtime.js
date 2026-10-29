import {
  normalizeEnvironment,
  getTimePeriod,
  getWeatherInfo
} from "./environment-data.js";

// ===== 舰船数据与推演状态接入 =====
// 不修改图鉴快照，不推进时间，不执行战斗。
// 页面文案使用日语，代码注释使用中文。

const GRADES = Object.freeze([
  "F", "E", "D", "C", "B", "A", "S", "U"
]);

export const SHIP_STATUS_LABELS = Object.freeze({
  intact: "無傷",
  minor: "軽微な損傷",
  light: "小破",
  moderate: "中破",
  heavy: "大破",
  sinking: "沈没寸前",
  sunk: "沈没"
});

function requireNumber(value, label, min = 0) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min
  ) {
    throw new Error(`${label}の値が不正です。`);
  }

  return value;
}

function requireGrade(value, label) {
  if (!GRADES.includes(value)) {
    throw new Error(`${label}の等級が不正です。`);
  }

  return value;
}

function convertDistance(value) {
  const result = Math.floor(value * 1.852 / 0.4);

  if (!Number.isSafeInteger(result)) {
    throw new Error("移動距離の換算結果が範囲外です。");
  }

  return result;
}

/**
 * 实际snapshot中的续航允许数字或"k"缩写。
 * 例如"7.2k"按7200读取，不使用parseFloat截断。
 */
export function parseShipEndurance(value) {
  if (typeof value === "number") {
    return requireNumber(value, "航続距離");
  }

  if (typeof value !== "string") {
    throw new Error("航続距離の書式が不正です。");
  }

  const match = value.trim().match(
    /^(\d+(?:\.\d+)?)\s*(k)?$/i
  );

  if (!match) {
    throw new Error(
      "航続距離は数値または「7.2k」の形式で指定してください。"
    );
  }

  return requireNumber(
    Number(match[1]) * (match[2] ? 1000 : 1),
    "航続距離"
  );
}

export function readShipProfile(unit) {
  if (unit?.branch !== "navy") {
    throw new Error("海軍ユニットではありません。");
  }

  const snapshot = unit.snapshot;
  const naval = snapshot?.naval;

  if (!naval || typeof naval !== "object") {
    throw new Error(
      `${unit.name ?? "艦船"}：艦船性能が登録されていません。`
    );
  }

  const maxHp = requireNumber(
    snapshot.maxHp,
    "最大耐性",
    Number.MIN_VALUE
  );

  const strength = naval.strength;

  if (
    !Number.isInteger(strength) ||
    strength < 0 ||
    strength > 7
  ) {
    throw new Error("強度は0から7の整数で指定してください。");
  }

  if (typeof naval.type !== "string" || !naval.type.trim()) {
    throw new Error("艦種が登録されていません。");
  }

  const speedKnots = requireNumber(naval.speedKnots, "速力");
  const endurance = parseShipEndurance(naval.endurance);

  return {
    maxHp,
    type: naval.type.trim(),
    strength,
    detection: requireGrade(naval.detection, "探測強度"),
    seaRecon: requireGrade(naval.seaRecon, "対海偵察"),
    airRecon: requireGrade(naval.airRecon, "対空偵察"),

    // 带有正负修饰的装甲值原样保留，暂不解释伤害公式。
    armor: typeof naval.armor === "string" ? naval.armor : "",

    speedKnots,
    endurance,
    movementLimit: convertDistance(speedKnots),
    enduranceBudget: convertDistance(endurance),
    strengthArmor: GRADES[strength],
    isRepairShip: naval.type.trim().toUpperCase() === "AR"
  };
}

function inferInitialStatus(currentHp, maxHp) {
  if (currentHp === 0) return "heavy";
  if (currentHp <= maxHp / 2) return "moderate";
  if (currentHp < maxHp) return "light";
  return "intact";
}

/**
 * 在新建推演或读取旧框架存档时调用。
 * 已有shipState必须保留并校验，不能刷新后重置。
 *
 * 旧框架没有伤害结算和损伤历史：
 * 只能根据初始耐性建立起始状态，不能还原轻微破损历史。
 */
export function ensureShipRuntime(unit) {
  if (unit.branch !== "navy") return;

  const profile = readShipProfile(unit);
  const currentHp = requireNumber(unit.currentHp, "現在耐性");

  if (currentHp > profile.maxHp) {
    throw new Error("現在耐性が最大耐性を超えています。");
  }

  if (unit.shipState === undefined) {
    unit.shipState = {
      version: 1,
      status: inferInitialStatus(currentHp, profile.maxHp),

      // null表示旧框架未记录历史，不冒充“从未受伤”。
      hasReceivedDamage:
        currentHp < profile.maxHp ? true : null,

      underwaterStrengthUses: 0,
      remainingEndurance: profile.enduranceBudget,

      // 仅预留状态，不擅自决定回合计时边界。
      sinkingElapsedMinutes: 0,
      rescueTaskId: null
    };
  }

  const state = unit.shipState;

  if (
    !state ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    state.version !== 1 ||
    !Object.hasOwn(SHIP_STATUS_LABELS, state.status)
  ) {
    throw new Error("艦船の保存状態が不正です。");
  }

  if (
    state.hasReceivedDamage !== null &&
    typeof state.hasReceivedDamage !== "boolean"
  ) {
    throw new Error("艦船の被害履歴が不正です。");
  }

  if (
    !Number.isInteger(state.underwaterStrengthUses) ||
    state.underwaterStrengthUses < 0 ||
    state.underwaterStrengthUses > profile.strength
  ) {
    throw new Error("強度効果の使用回数が不正です。");
  }

  requireNumber(state.remainingEndurance, "残り航続距離");

  if (state.remainingEndurance > profile.enduranceBudget) {
    throw new Error("残り航続距離が初期値を超えています。");
  }

  requireNumber(
    state.sinkingElapsedMinutes,
    "沈没寸前の経過時間"
  );

  if (
    state.rescueTaskId !== null &&
    (
      typeof state.rescueTaskId !== "string" ||
      !state.rescueTaskId.trim()
    )
  ) {
    throw new Error("救助識別番号が不正です。");
  }

  const hpStatus = inferInitialStatus(currentHp, profile.maxHp);

  const consistent = currentHp === 0
    ? ["heavy", "sinking", "sunk"].includes(state.status)
    : currentHp === profile.maxHp
      ? ["intact", "minor"].includes(state.status)
      : state.status === hpStatus;

  if (!consistent) {
    throw new Error("耐性と艦船の損傷状態が一致していません。");
  }
}

export function getReconConditions(environment) {
  const normalized = normalizeEnvironment(environment);
  const period = getTimePeriod(normalized.time);
  const weather = getWeatherInfo(normalized.weather);

  let timePenalty;

  switch (period.id) {
    case "day":
      timePenalty = 0;
      break;
    case "dawn":
    case "dusk":
      timePenalty = 50;
      break;
    case "night":
      timePenalty = 100;
      break;
    default:
      throw new Error("時刻区分が不正です。");
  }

  let weatherPenalty;

  if (
    normalized.weather === "high-temperature" ||
    normalized.weather === "icing"
  ) {
    weatherPenalty = 0;
  } else {
    switch (weather.level) {
      case "white":
        weatherPenalty = 0;
        break;
      case "blue":
        weatherPenalty = 50;
        break;
      case "yellow":
        weatherPenalty = 100;
        break;
      case "orange":
      case "red":
        weatherPenalty = 200;
        break;
      default:
        throw new Error("天候区分が不正です。");
    }
  }

  return {
    period,
    weather,
    timePenalty,
    weatherPenalty,

    // 时间与天气分别扣减，合算。
    normalRange: Math.max(
      0,
      400 - timePenalty - weatherPenalty
    ),

    identificationRange: 100
  };
}

export function getShipDetailLines(unit, environment) {
  const profile = readShipProfile(unit);
  const state = unit.shipState;

  if (!state) {
    throw new Error("艦船の推演状態が初期化されていません。");
  }

  const recon = getReconConditions(environment);
  const strengthRemaining =
    profile.strength - state.underwaterStrengthUses;

  return [
    `艦種：${profile.type}`,
    `損傷状態：${SHIP_STATUS_LABELS[state.status]}`,
    `強度：${profile.strength}`,
    `水中攻撃への強度効果：残り${strengthRemaining}回`,
    `慣性攻撃に使用する装甲：${profile.strengthArmor}`,
    `装甲：${profile.armor || "未登録"}`,
    `探測強度：${profile.detection}`,
    `対海偵察：${profile.seaRecon}`,
    `対空偵察：${profile.airRecon}`,
    `現在の通常偵察距離：${recon.normalRange}`,
    `近距離識別距離：${recon.identificationRange}`,
    "偵察には等級条件と地形遮蔽の判定も必要です。",
    `速力：${profile.speedKnots}ノット`,
    `最大移動距離：${profile.movementLimit}マス／ラウンド`,
    `残り航続距離：${state.remainingEndurance}マス`,
    `初期航続距離：${profile.enduranceBudget}マス`,
    `救助判定：${profile.isRepairShip
      ? "ARによる救助は必ず成功"
      : "コインによる判定"}`,
    "移動・攻撃・救助の実行処理は、対応ルールの接続待ちです。"
  ];
}
