// 单位级、每回合一次的练度效果。
// 不修改部署快照，不在初始化或预览时掷币。

const TRAIT_ID = "one-against-thousand";
const ATTACK_PHASE = /^(order-[1-5]|pas|special)$/;


function fail(message) {
  throw new Error(message);
}

function hasTrait(unit) {
  const state = unit.trainingState;

  if (
    !state ||
    !Array.isArray(state.baseTraits) ||
    !Array.isArray(state.acquiredTraits)
  ) {
    fail("練度・特殊能力の実行状態が不正です。");
  }

  return (
    state.baseTraits.includes(TRAIT_ID) ||
    state.acquiredTraits.includes(TRAIT_ID)
  );
}

function eligible(unit) {
  return (
    unit.branch === "navy" &&
    ["moderate", "heavy"].includes(unit.shipState?.status)
  );
}

export function initializeRoundTraitRuntime(scene) {
  if (
    !scene ||
    !Array.isArray(scene.instances) ||
    !Number.isSafeInteger(scene.turn?.number) ||
    scene.turn.number < 1
  ) {
    fail("ラウンド特殊能力の保存状態が不正です。");
  }

  // 兼容旧存档：只建立空容器，不补造过去的发动结果。
  if (scene.roundTraitRuntime === undefined) {
    scene.roundTraitRuntime = {
      version: 1,
      records: []
    };
  }

  const runtime = scene.roundTraitRuntime;

  if (
    !runtime ||
    typeof runtime !== "object" ||
    Array.isArray(runtime) ||
    runtime.version !== 1 ||
    !Array.isArray(runtime.records)
  ) {
    fail("ラウンド特殊能力の履歴形式が不正です。");
  }

  const unitIds = new Set(
    scene.instances.map(unit => unit.instanceId)
  );
  const keys = new Set();

  for (const record of runtime.records) {
    if (
      !record ||
      record.version !== 1 ||
      record.traitId !== TRAIT_ID ||
      !Number.isSafeInteger(record.turnNumber) ||
      record.turnNumber < 1 ||
      record.turnNumber > scene.turn.number ||
      typeof record.unitId !== "string" ||
      !unitIds.has(record.unitId) ||
      typeof record.phaseId !== "string" ||
      !ATTACK_PHASE.test(record.phaseId) ||
      typeof record.activated !== "boolean"
    ) {
      fail("ラウンド特殊能力の発動履歴が不正です。");
    }

    const key = JSON.stringify([
      record.turnNumber,
      record.unitId,
      record.traitId
    ]);

    if (keys.has(key)) {
      fail("同じラウンドの特殊能力発動履歴が重複しています。");
    }

    keys.add(key);
  }

  return runtime;
}

// 只供正式结算的候选副本调用。
// 按稳定单位ID顺序抽签，不受炮组数或目标候选数影响。
export function resolveRoundTraits(
  scene,
  startScene,
  coinSource
) {
  if (
    coinSource !== undefined &&
    typeof coinSource !== "function"
  ) {
    fail("特殊能力の乱数関数が不正です。");
  }

  if (
    scene.turn.number !== startScene.turn.number ||
    scene.turn.phaseId !== startScene.turn.phaseId ||
    !ATTACK_PHASE.test(startScene.turn.phaseId)
  ) {
    fail("特殊能力の判定段階が一致しません。");
  }

  const runtime = initializeRoundTraitRuntime(scene);
  const turnNumber = startScene.turn.number;

  const recordedIds = new Set(
    runtime.records
      .filter(record => record.turnNumber === turnNumber)
      .map(record => record.unitId)
  );

  const units = [...startScene.instances].sort((a, b) =>
    a.instanceId < b.instanceId ? -1 :
    a.instanceId > b.instanceId ? 1 : 0
  );

  const nextRecords = [];

  for (const unit of units) {
    if (!eligible(unit) || !hasTrait(unit)) continue;
    if (recordedIds.has(unit.instanceId)) continue;

    // true代表发动成功；正式随机源每单位只调用一次。
    const activated = coinSource === undefined
      ? Math.random() < 0.5
      : coinSource();

    if (typeof activated !== "boolean") {
      fail("特殊能力の発動判定は真偽値で返してください。");
    }

    nextRecords.push({
      version: 1,
      traitId: TRAIT_ID,
      turnNumber,
      phaseId: startScene.turn.phaseId,
      unitId: unit.instanceId,
      activated
    });
  }

  runtime.records.push(...nextRecords);
  initializeRoundTraitRuntime(scene);

  return nextRecords;
}

// 查询函数：不初始化、不写入、不掷币。
// 正式命中路径必须要求记录存在。
// 计划预检中的0只是未计入待定奖励，不代表发动失败。
export function readOneAgainstThousandBonus({
  actor,
  turnNumber,
  runtime,
  requireResolved = false
}) {
  if (!eligible(actor)) return 0;

  const records = runtime?.records;

  if (
    records !== undefined &&
    !Array.isArray(records)
  ) {
    fail("ラウンド特殊能力の履歴形式が不正です。");
  }

  const matches = (records ?? []).filter(record =>
    record.turnNumber === turnNumber &&
    record.unitId === actor.instanceId &&
    record.traitId === TRAIT_ID
  );

  if (matches.length > 1) {
    fail("同じラウンドの特殊能力発動履歴が重複しています。");
  }

  if (matches.length === 0) {
    if (requireResolved) {
      fail(
        "一騎当千の正式なラウンド発動結果がありません。"
      );
    }

    return 0;
  }

  const record = matches[0];

  if (
    record.version !== 1 ||
    typeof record.activated !== "boolean"
  ) {
    fail("一騎当千の発動履歴が不正です。");
  }

  return record.activated ? 2 : 0;
}
