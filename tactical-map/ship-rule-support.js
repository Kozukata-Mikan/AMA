import {
  normalizeEnvironment,
  getWeatherInfo
} from "./environment-data.js";

// ===== 舰船规则辅助 =====
// 不写入存档，不移动单位，不推进回合。

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

export function getReconWeatherPenalty(environment) {
  const normalized = normalizeEnvironment(environment);
  const weather = getWeatherInfo(normalized.weather);

  if (
    normalized.weather === "high-temperature" ||
    normalized.weather === "icing"
  ) {
    return 0;
  }

  switch (weather.level) {
    case "white":
      return 0;
    case "blue":
      return 50;
    case "yellow":
      return 100;
    case "orange":
    case "red":
      return 200;
    default:
      throw new Error("天候の分類が不正です。");
  }
}

export function convertShipDistance(value) {
  requireNonNegative(value, "速力または航続距離");
  return Math.floor(value * 1.852 / 0.4);
}

/**
 * 检查一艘舰船的移动距离预算。
 * distance须由正式地图距离规则计算。
 * 本函数只检查预算，不检查地形、路径或行动状态。
 */
export function checkShipMovementBudget({
  speedKnots,
  remainingEndurance,
  distance
}) {
  requireNonNegative(speedKnots, "速力");
  requireNonNegative(remainingEndurance, "残り航続距離");
  requireNonNegative(distance, "移動距離");

  const turnLimit = convertShipDistance(speedKnots);

  if (distance > turnLimit) {
    return {
      allowed: false,
      reason: "1ラウンドの最大移動距離を超えています。",
      turnLimit,
      remainingAfterMove: remainingEndurance
    };
  }

  if (distance > remainingEndurance) {
    return {
      allowed: false,
      reason: "残り航続距離が不足しています。",
      turnLimit,
      remainingAfterMove: remainingEndurance
    };
  }

  return {
    allowed: true,
    reason: "",
    turnLimit,
    remainingAfterMove: remainingEndurance - distance
  };
}

/**
 * 检查按相同距离移动的舰船编队。
 * 每个成员均须提供speedKnots与remainingEndurance。
 * 不根据成员数组位置决定移动结果。
 */
export function checkShipFormationBudget(members, distance) {
  if (!Array.isArray(members) || members.length === 0) {
    throw new Error("編隊の艦船データが必要です。");
  }

  requireNonNegative(distance, "移動距離");

  const checks = members.map(member =>
    checkShipMovementBudget({
      speedKnots: member.speedKnots,
      remainingEndurance: member.remainingEndurance,
      distance
    })
  );

  const turnLimit = Math.min(
    ...checks.map(check => check.turnLimit)
  );

  const failure = checks.find(check => !check.allowed);

  return {
    allowed: !failure,
    reason: failure?.reason ?? "",
    turnLimit,
    members: checks
  };
}
