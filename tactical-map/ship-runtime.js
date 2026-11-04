import {
  normalizeEnvironment,
  getTimePeriod,
  getWeatherInfo
} from "./environment-data.js";

import {
  createShipEffectsState,
  validateShipEffectsState,
  getOwnShipEffectLines,
  resolveShipEffectAcquisition,
  resolveShipDamageControlPhase
} from "./ship-effects-runtime.js";

import {
  ensureEquipmentRuntime
} from "./equipment-runtime.js";


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

  // 新推演或尚无舰船状态的旧框架：建立起始状态。
  if (unit.shipState === undefined) {
    unit.shipState = {
      version: 1,
      status: inferInitialStatus(currentHp, profile.maxHp),

      // null表示旧框架未记录完整伤害历史。
      hasReceivedDamage:
        currentHp < profile.maxHp ? true : null,

      underwaterStrengthUses: 0,
      remainingEndurance: profile.enduranceBudget,

      // 常命中的剩余累计份数：只能为0、1或2。
      normalHitRemainder: 0,

      // 仅保存状态，不在这里推进计时。
      sinkingElapsedMinutes: 0,
      rescueTaskId: null
    };
  }

  const state = unit.shipState;

  // 先确认保存状态的基本结构有效。
  if (
    !state ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    state.version !== 1 ||
    !Object.hasOwn(SHIP_STATUS_LABELS, state.status)
  ) {
    throw new Error("艦船の保存状態が不正です。");
  }

  // 兼容以前没有常命中累计字段的存档。
  // 已有0、1或2时保留原值，绝不因刷新重置。
  if (state.normalHitRemainder === undefined) {
    state.normalHitRemainder = 0;
  }

  // 检查常命中的累计余数。
  if (
    !Number.isInteger(state.normalHitRemainder) ||
    state.normalHitRemainder < 0 ||
    state.normalHitRemainder > 2
  ) {
    throw new Error("通常命中の累積値が不正です。");
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

    // 特殊效果可以使正耐性舰船进入濒临沉没。
  // 救助成功后的大破，以及后续沉没，也保留这个来源标记。
  // 旧存档只补缺失字段，不凭耐性猜测特殊损伤历史。
  if (state.specialDamageStatus === undefined) {
    state.specialDamageStatus = false;
  }

  if (typeof state.specialDamageStatus !== "boolean") {
    throw new Error("特殊効果による損傷状態の記録が不正です。");
  }

  if (
    state.specialDamageStatus &&
    !["heavy", "sinking", "sunk"].includes(state.status)
  ) {
    throw new Error("特殊損傷の記録と艦船の状態が一致していません。");
  }

  const hpStatus = inferInitialStatus(currentHp, profile.maxHp);

    const severeStatus =
    ["heavy", "sinking", "sunk"].includes(state.status);

  const consistent = state.specialDamageStatus
    ? severeStatus
    : currentHp === 0
      ? severeStatus
      : currentHp === profile.maxHp
        ? ["intact", "minor"].includes(state.status)
        : state.status === hpStatus;


    if (!consistent) {
    throw new Error("耐性と艦船の損傷状態が一致していません。");
  }

  // 仅为没有此字段的旧框架状态补建。
  // 已存在的起火、进水及处理历史绝不能重置。
  if (state.effects === undefined) {
    state.effects = createShipEffectsState();
  } else {
    state.effects = validateShipEffectsState(state.effects);
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

  // 外方识别详情只显示公开资料，不读取内部运行状态。
  if (unit.observationOwn === false) {
    return [
      `艦種：${profile.type}`,
      `損傷状態：${SHIP_STATUS_LABELS[unit.shipState?.status] ?? "未確認"}`,
      `火災：${unit.observedEffects?.fire ? "あり" : "なし"}`,
      `強度：${profile.strength}`,
      `装甲：${profile.armor || "未登録"}`,
      `探測強度：${profile.detection}`,
      `対海偵察：${profile.seaRecon}`,
      `対空偵察：${profile.airRecon}`,
      `速力：${profile.speedKnots}ノット`,
      "残弾・装備損傷・航続距離の残量・内部状態は非公開です。"
    ];
  }

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
    ...getOwnShipEffectLines(
      state.effects ?? createShipEffectsState()
    ),
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
        `救助状態：${state.rescueTaskId
      ? "救助中・他の行動は不可"
      : "救助中ではありません"}`,
    "移動と救助開始を接続済み。攻撃と正式な特殊段階処理は接続待ちです。"
  ];
}

// ===== 单次攻击的舰船被害应用 =====
// 输入必须是“一次装备组攻击”汇总后的结果。
// 仅修改调用方提供的事务工作副本。
// 不保存存档、不扣弹、不推进阶段、不掷随机数。

function requireDamageInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label}は0以上の安全な整数で指定してください。`);
  }

  return value;
}

function readDamageAttack(attack) {
  if (
    !attack ||
    typeof attack !== "object" ||
    Array.isArray(attack)
  ) {
    throw new Error("攻撃被害の書式が不正です。");
  }

  if (
    typeof attack.attackId !== "string" ||
    !attack.attackId.trim()
  ) {
    throw new Error("攻撃記録の識別番号がありません。");
  }

    if (!["cannon", "numeric", "underwater", "batch"].includes(attack.kind)) {
    throw new Error("この被害処理は耐性への攻撃専用です。");
  }

  const hpDamage = requireDamageInteger(
    attack.hpDamage,
    "耐性への被害"
  );

  if (typeof attack.hasDamageEffect !== "boolean") {
    throw new Error("被害効果の有無が不正です。");
  }

  if (!attack.hasDamageEffect && hpDamage !== 0) {
    throw new Error("被害効果のない攻撃に耐性被害が登録されています。");
  }

  let normalHitRemainder = null;

   if (attack.kind === "cannon" || attack.kind === "batch") {
    normalHitRemainder = requireDamageInteger(
      attack.normalHitRemainder,
      "通常命中の累積値"
    );

    if (normalHitRemainder > 2) {
      throw new Error("通常命中の累積値は0～2で指定してください。");
    }
  } else if (attack.normalHitRemainder !== undefined) {
    throw new Error(
      "艦砲または合算批次以外では通常命中の累積値を変更できません。"
    );
  }

  return {
    attackId: attack.attackId,
    kind: attack.kind,
    hpDamage,
    hasDamageEffect: attack.hasDamageEffect,
    normalHitRemainder
  };
}

/**
 * 应用一次已经汇总、已经判定完成的耐性攻击。
 *
 * unit必须来自保存事务的工作副本，不能传部署快照。
 *
 * attack：
 * - attackId：本次攻击记录ID。
 * - kind：cannon / numeric / underwater。
 * - hpDamage：防御及累计处理后的耐性伤害。
 * - hasDamageEffect：是否存在被害效果。
 * - normalHitRemainder：仅cannon需要，范围0～2。
 *
 * context：
 * - turnNumber：当前回合。
 * - phaseId：当前结算阶段。
 *
 * 不处理：
 * - 装备损坏、强度次数消耗、起火和进水抽签。
 * - 救助中断与自然沉没计时。
 * - 同次序多次攻击的统一裁定。
 */
export function applyShipDamageAttack(
  unit,
  attackValue,
  context
) {
  const attack = readDamageAttack(attackValue);

  if (
    !context ||
    !Number.isSafeInteger(context.turnNumber) ||
    context.turnNumber < 1 ||
    !/^order-[1-5]$|^pas$/.test(context.phaseId)
  ) {
    throw new Error("攻撃被害を適用するラウンド・段階が不正です。");
  }

  // 在独立副本上完成初始化、验证和变更。
  // 任意校验失败都不部分修改传入的单位。
  const working = JSON.parse(JSON.stringify(unit));

  ensureShipRuntime(working);

  const profile = readShipProfile(working);
  const beforeHp = working.currentHp;
  const beforeState = JSON.parse(JSON.stringify(working.shipState));
  const state = working.shipState;

  let ignored = false;

  if (state.status === "sunk") {
    // 已沉没单位不再次升级损伤，也不继续累计常命中。
    ignored = true;
  } else {
    if (attack.kind === "cannon" || attack.kind === "batch") {
      // 全碎或没有被害时，不能凭输入改变累计余数。
      if (
        !attack.hasDamageEffect &&
        attack.normalHitRemainder !== state.normalHitRemainder
      ) {
        throw new Error(
          "被害のない艦砲攻撃で通常命中の累積値が変化しています。"
        );
      }

      state.normalHitRemainder = attack.normalHitRemainder;
    }

    if (attack.hasDamageEffect) {
      state.hasReceivedDamage = true;

      switch (beforeState.status) {
        case "sinking":
          // 濒临沉没：任何有被害效果的攻击都会导致沉没。
          // “碎”因hasDamageEffect=false，不会进入这里。
          state.status = "sunk";
          break;

        case "heavy":
          // 大破：只有产生耐性削减效果的本次攻击才进入濒临沉没。
          // 不能依赖显示HP差，因为这里的HP本来已经是0。
          if (attack.hpDamage > 0) {
            state.status = "sinking";
            state.sinkingElapsedMinutes = 0;
          }
          break;

        default:
          working.currentHp = Math.max(
            0,
            beforeHp - attack.hpDamage
          );

          if (working.currentHp === 0) {
            state.status = "heavy";
          } else if (working.currentHp <= profile.maxHp / 2) {
            state.status = "moderate";
          } else if (working.currentHp < profile.maxHp) {
            state.status = "light";
          } else {
            // 命中存在被害效果，但尚未造成耐性削减。
            state.status = "minor";
          }
          break;
      }
    }
  }

  // 变更后的耐性、状态及运行字段仍须符合现有保存约束。
  ensureShipRuntime(working);

  const enteredSinking =
    beforeState.status !== "sinking" &&
    state.status === "sinking";

  const becameSunk =
    beforeState.status !== "sunk" &&
    state.status === "sunk";

  const report = {
    version: 1,
    attackId: attack.attackId,
    targetId: working.instanceId,
    turnNumber: context.turnNumber,
    phaseId: context.phaseId,
    ignored,
    requestedHpDamage: attack.hpDamage,
    actualHpLoss: beforeHp - working.currentHp,
    hasDamageEffect: !ignored && attack.hasDamageEffect,
    beforeHp,
    afterHp: working.currentHp,
    beforeStatus: beforeState.status,
    afterStatus: state.status,
    beforeNormalHitRemainder: beforeState.normalHitRemainder,
    afterNormalHitRemainder: state.normalHitRemainder,

    // 必须由正式事务层持久化首次濒临沉没时间。
    sinkingStarted: enteredSinking
      ? {
          turnNumber: context.turnNumber,
          phaseId: context.phaseId
        }
      : null,

    becameSunk,

    // 不在这里直接清掉救助ID：
    // 救助模块必须同时更新任务、另一艘舰船和暂停计时。
        // 挨打本身不自动中断救助。
    // 本舰进入无法行动状态时，交给救助任务层检查并更新双方。
    rescueInterruptionRequired:
      !ignored &&
      (enteredSinking || becameSunk) &&
      state.rescueTaskId != null

  };

  // 所有验证成功后才写回事务工作副本。
  unit.currentHp = working.currentHp;
  unit.shipState = JSON.parse(JSON.stringify(state));

  return report;
}

/**
 * 确定性试算，不修改传入单位。
 * 只供内部规则集成使用；不能向外方观察页面返回完整单位。
 */
export function previewShipDamageAttack(
  unit,
  attack,
  context
) {
  const working = JSON.parse(JSON.stringify(unit));

  const report = applyShipDamageAttack(
    working,
    attack,
    context
  );

  return report;
}

// ===== 攻击导致的起火／进水获得接口 =====
// 只处理一次符合资格的命中。
// 必须对正式保存事务的工作副本调用。
// 不保存、不扣弹、不推进阶段。

export function applyShipEffectAcquisition(
  unit,
  request,
  context,
  coinSource
) {
  if (
    !request ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    typeof request.attackId !== "string" ||
    !request.attackId.trim() ||
    !["fire", "flooding"].includes(request.type)
  ) {
    throw new Error("特殊状態の取得要求が不正です。");
  }

  if (
    !context ||
    !Number.isSafeInteger(context.turnNumber) ||
    context.turnNumber < 1 ||
    typeof context.phaseId !== "string" ||
    !/^(order-[1-5]|pas)$/.test(context.phaseId)
  ) {
    throw new Error(
      "特殊状態を取得するラウンド・攻撃段階が不正です。"
    );
  }

  if (
    coinSource !== undefined &&
    typeof coinSource !== "function"
  ) {
    throw new Error("特殊状態のコイン関数が不正です。");
  }

  const working = JSON.parse(JSON.stringify(unit));

  if (working?.branch !== "navy") {
    throw new Error("特殊状態の対象が艦船ではありません。");
  }

  ensureShipRuntime(working);

  // 已沉没单位不再取得新的起火或进水，也不消耗随机判定。
  if (working.shipState.status === "sunk") {
    return {
      version: 1,
      attackId: request.attackId,
      targetId: working.instanceId,
      turnNumber: context.turnNumber,
      phaseId: context.phaseId,
      type: request.type,
      skipped: true,
      skipReason: "sunk",
      coin: null,
      acquired: false
    };
  }

  const result = resolveShipEffectAcquisition(
    {
      state: working.shipState.effects,
      type: request.type,
      turnNumber: context.turnNumber
    },
    coinSource
  );

  working.shipState.effects = result.state;

  // 所有校验成功后，才修改事务工作副本。
  ensureShipRuntime(working);

  unit.shipState = JSON.parse(
    JSON.stringify(working.shipState)
  );

  return {
    version: 1,
    attackId: request.attackId,
    targetId: working.instanceId,
    turnNumber: context.turnNumber,
    phaseId: context.phaseId,
    type: request.type,
    skipped: result.skipped,
    skipReason: result.skipped ? "already-present" : null,
    coin: result.coin,
    acquired: result.acquired
  };
}

// ===== 起火／进水特殊阶段应用 =====
// 只用于正式事务工作副本。
// 不独立保存、不推进阶段。
// 不把火灾伤害伪装成武器攻击。

// 保留旧入口名，避免破坏已有调用。
// 现在统一处理火灾、浸水和已安装装备组的内部损管。
export function applyShipFireFloodingPhase(
  unit,
  context,
  coinSource,
  selectRepairIndex
) {

  if (
    !context ||
    !Number.isSafeInteger(context.turnNumber) ||
    context.turnNumber < 1 ||
    context.phaseId !== "special"
  ) {
    throw new Error(
      "火災・浸水の処理は特殊効果判定段階に限ります。"
    );
  }

  if (
    coinSource !== undefined &&
    typeof coinSource !== "function"
  ) {
    throw new Error("特殊状態のコイン関数が不正です。");
  }

  if (
    selectRepairIndex !== undefined &&
    typeof selectRepairIndex !== "function"
  ) {
    throw new Error("設備修理の抽選関数が不正です。");
  }

  const working = JSON.parse(JSON.stringify(unit));


  if (working?.branch !== "navy") {
    throw new Error("火災・浸水の処理対象が艦船ではありません。");
  }

  ensureShipRuntime(working);
  ensureEquipmentRuntime(working);

  const beforeEquipmentState = JSON.parse(
    JSON.stringify(working.equipmentState)
  );

  const profile = readShipProfile(working);
  const beforeHp = working.currentHp;
  const beforeStatus = working.shipState.status;
  const beforeEffects = JSON.parse(
    JSON.stringify(working.shipState.effects)
  );

  // 沉没舰不进行损管，不消耗硬币。
  if (beforeStatus === "sunk") {
    return {
      version: 1,
      targetId: working.instanceId,
      turnNumber: context.turnNumber,
      phaseId: context.phaseId,
      skipped: true,
      skipReason: "sunk",
      rolls: [],
      events: [],
      beforeHp,
      afterHp: beforeHp,
      beforeStatus,
      afterStatus: beforeStatus,
      sinkingStarted: null,
      rescueInterruptionRequired: false
    };
  }

    // 候选来自现有运行状态，不接受页面提交的修复目标。
  const damagedEquipmentIds = working.equipmentState.groups
    .filter(group => group.damaged)
    .map(group => group.id);

  // 火灾、浸水、设备分别判定一次R。
  // 未传入随机函数时，由算法模块使用默认随机源。
  const result = resolveShipDamageControlPhase(
    {
      state: working.shipState.effects,
      turnNumber: context.turnNumber,
      damagedEquipmentIds
    },
    {
      coinSource,
      selectRepairIndex
    }
  );


  const state = working.shipState;
  state.effects = result.state;

  const sinkingCauses = [];

  for (const event of result.events) {
    switch (event.type) {
      case "fire-hp-damage":
        state.hasReceivedDamage = true;

        working.currentHp = Math.max(
          0,
          working.currentHp - event.amount
        );

        // 火灾耐性伤害不是一次武器攻击。
        // 不套用“濒临沉没再遭有被害效果攻击即沉没”的攻击规则。
        if (
          !["heavy", "sinking", "sunk"].includes(state.status)
        ) {
          state.status = inferInitialStatus(
            working.currentHp,
            profile.maxHp
          );
        }

        break;

      case "enter-sinking":
        sinkingCauses.push(event.cause);

        if (!["sinking", "sunk"].includes(state.status)) {
          state.status = "sinking";
          state.specialDamageStatus = true;

          // 仅首次进入时初始化。
          // 已濒临沉没的舰船不能因另一词条失控重置倒计时。
          state.sinkingElapsedMinutes = 0;
        }

        break;

              case "equipment-repaired": {
        const group = working.equipmentState.groups.find(
          item => item.id === event.equipmentId
        );

        if (
          !group ||
          group.damaged !== true ||
          event.method !== "damage-control" ||
          event.equipmentId !==
            result.equipmentControl.repairedEquipmentId
        ) {
          throw new Error("設備修理の結果と損傷状態が一致しません。");
        }

        // 只解除损坏。
        // 不恢复弹药，不重置lastUsedTurn，不修改图鉴快照。
        group.damaged = false;
        break;
      }

      case "equipment-control-failed":
        // 损管失败只是修复无效，不使装备彻底损坏。
        break;

      case "effect-cleared":
      case "effect-worsened":
      case "flooding-movement-reduction":
      case "flooding-movement-restored":
        // 状态算法已经更新effects。
        // 移动层从effects计算减益，不另存第二套移动力。
        break;

      default:
        throw new Error("未対応の損傷管制イベントがあります。");
    }
  }

  ensureShipRuntime(working);
  ensureEquipmentRuntime(working);


  const enteredSinking =
    beforeStatus !== "sinking" &&
    state.status === "sinking";

  const report = {
    version: 1,
    targetId: working.instanceId,
    turnNumber: context.turnNumber,
    phaseId: context.phaseId,
    skipped: false,
    rolls: result.rolls,
    events: result.events,
    equipmentControl: JSON.parse(
      JSON.stringify(result.equipmentControl)
    ),
    beforeEquipmentState,
    afterEquipmentState: JSON.parse(
      JSON.stringify(working.equipmentState)
    ),
    beforeEffects,
    afterEffects: JSON.parse(JSON.stringify(state.effects)),
    beforeHp,
    afterHp: working.currentHp,
    actualHpLoss: beforeHp - working.currentHp,
    beforeStatus,
    afterStatus: state.status,
    sinkingStarted: enteredSinking
      ? {
          turnNumber: context.turnNumber,
          phaseId: context.phaseId,
          causes: sinkingCauses
        }
      : null,
    rescueInterruptionRequired:
      enteredSinking &&
      state.rescueTaskId !== null
  };

  // 所有处理及校验成功后才写回。
  unit.currentHp = working.currentHp;
    // 所有处理及校验成功后才写回。
  unit.currentHp = working.currentHp;
  unit.shipState = JSON.parse(JSON.stringify(state));
  unit.equipmentState = JSON.parse(
    JSON.stringify(working.equipmentState)
  );

  return report;

}
