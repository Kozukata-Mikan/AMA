// 舰船起火、进水的状态算法。
// 不修改输入、不保存、不推进阶段。
// 设备损坏与设备损管尚未在本模块实现。

const FIRE_LEVELS = Object.freeze([
  "small", "medium", "large", "uncontrolled"
]);

const FLOODING_LEVELS = Object.freeze([
  "light", "medium", "heavy", "uncontrolled"
]);

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function randomCoin() {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("特殊状態の判定に必要な乱数機能がありません。");
  }

  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);

  return (buffer[0] & 1) === 1;
}

function toss(coinSource) {
  if (typeof coinSource !== "function") {
    throw new Error("特殊状態のコイン判定関数がありません。");
  }

  const result = coinSource();

  if (typeof result !== "boolean") {
    throw new Error("コイン判定は真偽値を返す必要があります。");
  }

  return result;
}

function requireTurn(turnNumber) {
  if (
    !Number.isSafeInteger(turnNumber) ||
    turnNumber < 1
  ) {
    throw new Error("ラウンド番号が不正です。");
  }
}

function validateEffect(effect, levels) {
  if (effect === null) return;

  if (
    !effect ||
    typeof effect !== "object" ||
    Array.isArray(effect) ||
    !levels.includes(effect.level) ||
    !Number.isSafeInteger(effect.acquiredTurn) ||
    effect.acquiredTurn < 1 ||
    !Number.isSafeInteger(effect.failedControls) ||
    effect.failedControls < 0
  ) {
    throw new Error("特殊状態の保存形式が不正です。");
  }

  // 新获得时为第一级，损管失败后每次提升一级。
  const expectedIndex = Math.min(effect.failedControls, 3);

  if (levels.indexOf(effect.level) !== expectedIndex) {
    throw new Error("特殊状態の段階と悪化回数が一致しません。");
  }
}

function readState(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error("特殊状態の保存データがありません。");
  }

  if (value.version !== 1) {
    throw new Error("特殊状態の保存バージョンに対応していません。");
  }

  validateEffect(value.fire, FIRE_LEVELS);
  validateEffect(value.flooding, FLOODING_LEVELS);

  if (
    !Number.isSafeInteger(value.lastResolvedTurn) ||
    value.lastResolvedTurn < 0
  ) {
    throw new Error("特殊状態の処理済みラウンドが不正です。");
  }

  for (const type of ["fire", "flooding"]) {
    const effect = value[type];
    if (!effect) continue;

    // 已经发生恶化，说明至少经历过一次特殊阶段。
    if (
      effect.failedControls > 0 &&
      effect.acquiredTurn > value.lastResolvedTurn
    ) {
      throw new Error(
        "特殊状態の取得ラウンドと処理履歴が一致しません。"
      );
    }
  }

  
  return copy(value);
}

export function createShipEffectsState() {
  return {
    version: 1,
    fire: null,
    flooding: null,
    lastResolvedTurn: 0
  };
}

/**
 * 一次符合资格的命中所触发的状态获得判定。
 *
 * type：
 * - fire：最终舰炮结果为穿／大穿。
 * - flooding：数字威力（水下）的命中。
 *
 * 已有对应状态时，不再投获取硬币。
 * 调用方负责筛选符合资格的命中。
 */
export function resolveShipEffectAcquisition({
  state: stateValue,
  type,
  turnNumber
}, coinSource = randomCoin) {
  requireTurn(turnNumber);

  if (!["fire", "flooding"].includes(type)) {
    throw new Error("この取得判定は火災・浸水専用です。");
  }

  const state = readState(stateValue);

  // 本回合特殊阶段已完成后，不允许再补入攻击获得状态。
  if (turnNumber <= state.lastResolvedTurn) {
    throw new Error("特殊状態を取得できる攻撃段階ではありません。");
  }

  if (state[type] !== null) {
    return {
      version: 1,
      state,
      type,
      skipped: true,
      coin: null,
      acquired: false
    };
  }

  const coin = toss(coinSource);
  const acquired = !coin;

  if (acquired) {
    state[type] = {
      level: type === "fire" ? "small" : "light",
      acquiredTurn: turnNumber,
      failedControls: 0
    };
  }

  return {
    version: 1,
    state,
    type,
    skipped: false,
    coin,
    acquired
  };
}

/**
 * 处理一个回合的火灾与浸水损管。
 *
 * - 两种状态各自投一枚硬币。
 * - 正面消除对应状态。
 * - 火灾失败：耐性伤害1，随后恶化。
 * - 浸水失败：移动力减少原始移动力的25%，随后恶化。
 * - 升到失控时返回“进入濒临沉没”事件。
 *
 * 不直接应用事件，也不代表完整特殊阶段已经完成。
 */
export function resolveShipFireFloodingPhase({
  state: stateValue,
  turnNumber
}, coinSource = randomCoin) {
  requireTurn(turnNumber);

  const state = readState(stateValue);

  if (turnNumber <= state.lastResolvedTurn) {
    throw new Error("このラウンドの火災・浸水はすでに処理済みです。");
  }

  for (const type of ["fire", "flooding"]) {
    const effect = state[type];

    if (effect && effect.acquiredTurn > turnNumber) {
      throw new Error("未来のラウンドで取得した特殊状態があります。");
    }
  }

  const rolls = [];
  const events = [];

  // 先分别完成损管判定，再返回事件。
  // 本模块内部不会因火灾导致状态变化而跳过浸水判定。
  for (const type of ["fire", "flooding"]) {
    const effect = state[type];
    if (!effect) continue;

    const coin = toss(coinSource);

    rolls.push({
      type,
      coin,
      success: coin
    });

    if (coin) {
      state[type] = null;

      events.push({
        type: "effect-cleared",
        effect: type
      });

      if (type === "flooding") {
        events.push({
          type: "flooding-movement-restored"
        });
      }

      continue;
    }

    if (type === "fire") {
      events.push({
        type: "fire-hp-damage",
        amount: 1
      });
    } else {
      events.push({
        type: "flooding-movement-reduction",
        originalMovementFraction: 0.25
      });
    }

    const levels = type === "fire"
      ? FIRE_LEVELS
      : FLOODING_LEVELS;

    const beforeLevel = effect.level;

    // 失控状态保留，不产生重复“首次失控”事件。
    if (beforeLevel !== "uncontrolled") {
      effect.failedControls += 1;
      effect.level = levels[
        Math.min(effect.failedControls, 3)
      ];
    }

    events.push({
      type: "effect-worsened",
      effect: type,
      beforeLevel,
      afterLevel: effect.level
    });

    if (
      beforeLevel !== "uncontrolled" &&
      effect.level === "uncontrolled"
    ) {
      events.push({
        type: "enter-sinking",
        cause: type
      });
    }
  }

  state.lastResolvedTurn = turnNumber;

  return {
    version: 1,
    state,
    rolls,
    events
  };
}

/**
 * 浸水造成的移动力比例。
 *
 * 不修改固有航速，也不计算格数取整。
 * 修复浸水后返回1，因此不会永久降低部署资料。
 */
export function getFloodingMovementFactor(stateValue) {
  const state = readState(stateValue);

  if (!state.flooding) return 1;

  return Math.max(
    0,
    1 - state.flooding.failedControls * 0.25
  );
}

/**
 * 校验并返回独立副本。
 * 供舰船初始化及保存校验调用。
 */
export function validateShipEffectsState(value) {
  return readState(value);
}

/**
 * 仅供本方详情显示。
 * 不应对外方观察副本调用，否则可能暴露进水状态。
 */
export function getOwnShipEffectLines(value) {
  const state = readState(value);

  const fireLabels = {
    small: "小火",
    medium: "中火",
    large: "大火",
    uncontrolled: "制御不能"
  };

  const floodingLabels = {
    light: "軽度浸水",
    medium: "中度浸水",
    heavy: "重度浸水",
    uncontrolled: "制御不能"
  };

  return [
    `火災：${state.fire
      ? fireLabels[state.fire.level]
      : "なし"}`,
    `浸水：${state.flooding
      ? floodingLabels[state.flooding.level]
      : "なし"}`,
    `浸水による移動力補正：${
      getFloodingMovementFactor(state) * 100
    }%`,
    "浸水補正は元の最大移動力に適用します。修復すると解除されます。"
  ];
}
