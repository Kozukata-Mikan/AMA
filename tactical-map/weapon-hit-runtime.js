import {
  normalizeEnvironment,
  getTimePeriod,
  getWeatherInfo
} from "./environment-data.js";

// 只处理命中硬币，不处理射程、目标资格、伤害或阶段推进。
// 所有结果必须由调用方在保存事务内持久化。

const GUARANTEED_COIN_GUIDANCE = new Set([
  "ray",
  "radar",
  "computer"
]);

const MODIFIED_GUIDANCE = new Set([
  "lobbed",
  "direct",
  "inertial"
]);

const GUIDANCE_TYPES = new Set([
  ...MODIFIED_GUIDANCE,
  ...GUARANTEED_COIN_GUIDANCE
]);

function requireInteger(value, label, minimum = 0) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    throw new Error(`${label}の値が不正です。`);
  }

  return value;
}

function randomCoin() {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("命中判定に必要な乱数機能を利用できません。");
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
 * 规范化输入采用内部字段，不猜测图鉴字段。
 *
 * groups: X，硬币叠数。
 * coinsPerGroup: Y，每叠硬币数。
 * guidance:
 *   lobbed   抛射
 *   direct   平射，含平射（水下）
 *   inertial 惯性，含惯性（大型）
 *   ray      射线
 *   radar    雷达
 *   computer 数控
 *
 * bonuses / penalties: 已汇总的奖励与惩罚次数。
 */
export function resolveHitCoins({
  groups,
  coinsPerGroup,
  guidance,
  bonuses = 0,
  penalties = 0,
  standalone = false
}, coinSource = randomCoin) {

  requireInteger(groups, "硬貨の束数", 1);
  requireInteger(coinsPerGroup, "束内の硬貨数", 1);
  requireInteger(bonuses, "有利判定の回数");
  requireInteger(penalties, "不利判定の回数");

  if (!GUIDANCE_TYPES.has(guidance)) {
    throw new Error("誘導方式の指定が不正です。");
  }

  if (typeof coinSource !== "function") {
    throw new Error("コイン判定関数がありません。");
  }

    if (typeof standalone !== "boolean") {
    throw new Error("単独Rの設定が不正です。");
  }

  if (standalone) {
    if (groups !== 1 || coinsPerGroup !== 1) {
      throw new Error("単独Rは硬貨1枚で判定してください。");
    }

    // 单独R没有X叠，奖励／惩罚不能作用于叠内硬币。
    // 雷达、数控、射线的硬币必命中效果仍保留。
    const guaranteed = GUARANTEED_COIN_GUIDANCE.has(guidance);
    const heads = guaranteed ? true : toss(coinSource);

    return {
      version: 1,
      standalone: true,
      groups: 1,
      coinsPerGroup: 1,
      guidance,
      bonuses,
      penalties,
      cancelled: Math.min(bonuses, penalties),
      remainingBonuses: 0,
      remainingPenalties: 0,
      maximumHits: 1,
      effectiveGroups: [],
      stackRounds: [],
      coinResults: [{
        groupIndex: 0,
        coinIndex: 0,
        guaranteed,
        heads
      }],
      hitCount: heads ? 1 : 0
    };
  }

  
  const maximumHits = groups * coinsPerGroup;

  if (!Number.isSafeInteger(maximumHits)) {
    throw new Error("命中数の計算結果が範囲外です。");
  }

  const cancelled = Math.min(bonuses, penalties);
    // 先一对一抵消，剩余次数不得超过原始X叠数。
  const remainingBonuses = Math.min(groups, bonuses - cancelled);
  const remainingPenalties = Math.min(groups, penalties - cancelled);


  const effectiveGroups = new Set();
  let pending = Array.from(
    { length: groups },
    (_, index) => index
  );

  const stackRounds = [];

  function rollGroups(kind, round) {
    const results = pending.map(groupIndex => ({
      groupIndex,
      heads: toss(coinSource)
    }));

    stackRounds.push({
      kind,
      round,
      results
    });

    return results;
  }

  // 奖励轮：正面锁定有效，反面继续等待。
  for (
    let round = 1;
    round <= remainingBonuses && pending.length;
    round++
  ) {
    const results = rollGroups("bonus", round);

    for (const result of results) {
      if (result.heads) {
        effectiveGroups.add(result.groupIndex);
      }
    }

    pending = results
      .filter(result => !result.heads)
      .map(result => result.groupIndex);
  }

  // 惩罚轮：反面锁定无效，正面继续等待。
  for (
    let round = 1;
    round <= remainingPenalties && pending.length;
    round++
  ) {
    const results = rollGroups("penalty", round);

    pending = results
      .filter(result => result.heads)
      .map(result => result.groupIndex);
  }

  // 未被奖励直接锁定、也未被惩罚淘汰的叠，
  // 仍执行正常的X叠判定。
  if (pending.length) {
    const results = rollGroups("normal", 1);

    for (const result of results) {
      if (result.heads) {
        effectiveGroups.add(result.groupIndex);
      }
    }
  }

  const guaranteedCoins =
    GUARANTEED_COIN_GUIDANCE.has(guidance);

  const coinResults = [];

  for (
    const groupIndex of [...effectiveGroups].sort((a, b) => a - b)
  ) {
    for (
      let coinIndex = 0;
      coinIndex < coinsPerGroup;
      coinIndex++
    ) {
      coinResults.push({
        groupIndex,
        coinIndex,
        guaranteed: guaranteedCoins,
        heads: guaranteedCoins
          ? true
          : toss(coinSource)
      });
    }
  }

  return {
    version: 1,
    groups,
    coinsPerGroup,
    guidance,
    bonuses,
    penalties,
    cancelled,
    remainingBonuses,
    remainingPenalties,
    maximumHits,
    effectiveGroups: [...effectiveGroups].sort((a, b) => a - b),
    stackRounds,
    coinResults,
    hitCount: coinResults.filter(result => result.heads).length
  };
}

/**
 * 单独R：一枚硬币，没有X叠判定。
 * X·YR：先判X叠，再判有效叠内的Y枚硬币。
 * 同时接受图鉴显示使用的乘号，避免显示与解析不一致。
 */
export function parseHitExpression(value) {
  if (typeof value !== "string") {
    throw new Error("命中表記は文字列で指定してください。");
  }

  const expression = value.trim();

  if (/^R$/i.test(expression)) {
    return {
      groups: 1,
      coinsPerGroup: 1,
      standalone: true
    };
  }

  const match = expression.match(
    /^(\d+)\s*[·・⋅×x*]\s*(\d+)\s*R$/i
  );

  if (!match) {
    throw new Error(
      "命中表記は「R」または「5·3R」の形式で指定してください。"
    );
  }

  const groups = Number(match[1]);
  const coinsPerGroup = Number(match[2]);

  requireInteger(groups, "硬貨の束数", 1);
  requireInteger(coinsPerGroup, "束内の硬貨数", 1);

  return { groups, coinsPerGroup };
}


/**
 * 汇总命中修正。
 *
 * trainingBonuses / trainingPenalties:
 * 由属性适配层根据练度与词条计算，不能用猜测的图鉴字段。
 *
 * electronicBonuses / electronicPenalties:
 * 电子干扰效果尚未具体定义，由正式电子规则提供。
 *
 * globalBonuses / globalPenalties:
 * 明确作用于本次R判定的其他效果，不等同于天气或练度。
 */
export function getHitModifiers({
  guidance,
  environment,
  trainingBonuses = 0,
  trainingPenalties = 0,
  electronicBonuses = 0,
  electronicPenalties = 0,
  globalBonuses = 0,
  globalPenalties = 0
}) {
  if (!GUIDANCE_TYPES.has(guidance)) {
    throw new Error("誘導方式の指定が不正です。");
  }

  for (const [label, value] of [
    ["練度の有利判定", trainingBonuses],
    ["練度の不利判定", trainingPenalties],
    ["電子効果の有利判定", electronicBonuses],
    ["電子効果の不利判定", electronicPenalties],
    ["追加の有利判定", globalBonuses],
    ["追加の不利判定", globalPenalties]
  ]) {
    requireInteger(value, label);
  }

  const normalized = normalizeEnvironment(environment);
  const period = getTimePeriod(normalized.time);
  const weather = getWeatherInfo(normalized.weather);

  let timePenalties = 0;
  let weatherPenalties = 0;
  let bonuses = globalBonuses;
  let penalties = globalPenalties;

  if (MODIFIED_GUIDANCE.has(guidance)) {
    timePenalties = period.id === "night"
      ? 2
      : ["dawn", "dusk"].includes(period.id)
        ? 1
        : 0;

    const exemptWeather = [
      "high-temperature",
      "icing"
    ].includes(normalized.weather);

    weatherPenalties = exemptWeather
      ? 0
      : ({
          white: 0,
          blue: 1,
          yellow: 2,
          orange: 3,
          red: 3
        })[weather.level];
        requireInteger(weatherPenalties, "天候の不利判定");

    bonuses += trainingBonuses;
    penalties +=
      trainingPenalties +
      timePenalties +
      weatherPenalties;
  } else if (
    guidance === "radar" ||
    guidance === "computer"
  ) {
    bonuses += electronicBonuses;
    penalties += electronicPenalties;
  }

    // 各输入合法，不代表求和后仍处于安全整数范围。
  requireInteger(bonuses, "有利判定の合計");
  requireInteger(penalties, "不利判定の合計");

  // 射线不受天气、练度和电子干扰影响。
  // 其他明确作用于R的通用效果仍单独保留。
  return {
    bonuses,
    penalties,
    breakdown: {
      timePenalties,
      weatherPenalties,
      trainingBonuses: MODIFIED_GUIDANCE.has(guidance)
        ? trainingBonuses
        : 0,
      trainingPenalties: MODIFIED_GUIDANCE.has(guidance)
        ? trainingPenalties
        : 0,
      electronicBonuses: ["radar", "computer"].includes(guidance)
        ? electronicBonuses
        : 0,
      electronicPenalties: ["radar", "computer"].includes(guidance)
        ? electronicPenalties
        : 0,
      globalBonuses,
      globalPenalties
    }
  };
}
