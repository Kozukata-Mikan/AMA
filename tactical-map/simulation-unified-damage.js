import {
  ensureShipRuntime,
  readShipProfile,
  applyShipDamageAttack,
  applyShipEffectAcquisition
} from "./ship-runtime.js";

import {
  summarizeCannonImpacts
} from "./cannon-damage-runtime.js";

import {
  readNumericPower,
  resolveNumericDamage
} from "./numeric-damage-runtime.js";

import {
  initializeRescueState,
  reconcileActiveRescues
} from "./simulation-rescue.js";

const copy = value => JSON.parse(JSON.stringify(value));
const ATTACK_PHASE = /^(order-[1-5]|pas)$/;

function fail(message) {
  throw new Error(message);
}

function id(value) {
  return typeof value === "string" &&
    value.trim().length > 0;
}

function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${label}の値が不正です。`);
  }

  return value;
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function findUnit(scene, instanceId) {
  const unit = scene.instances.find(
    item => item.instanceId === instanceId
  );

  if (!unit) {
    fail("統一被害処理の目標を確認できません。");
  }

  return unit;
}

function validateScene(scene) {
  if (
    !scene ||
    !Array.isArray(scene.instances) ||
    !Number.isSafeInteger(scene.turn?.number) ||
    scene.turn.number < 1 ||
    typeof scene.turn.phaseId !== "string" ||
    !ATTACK_PHASE.test(scene.turn.phaseId)
  ) {
    fail("統一被害処理のラウンドまたは段階が不正です。");
  }
}

/**
 * 内部报告，不加入观察副本。
 * 旧存档只补缺失字段，不补造过去的战斗。
 */
export function initializeUnifiedDamageRuntime(scene) {
  if (
    !scene ||
    !Number.isSafeInteger(scene.turn?.number) ||
    scene.turn.number < 1
  ) {
    fail("統一被害処理の現在ラウンドが不正です。");
  }

  if (scene.unifiedDamageRuntime === undefined) {
    scene.unifiedDamageRuntime = {
      version: 1,
      records: []
    };
  }

  const runtime = scene.unifiedDamageRuntime;

  if (
    !runtime ||
    typeof runtime !== "object" ||
    Array.isArray(runtime) ||
    runtime.version !== 1 ||
    !Array.isArray(runtime.records)
  ) {
    fail("統一被害処理の保存形式が不正です。");
  }

  const batchIds = new Set();
  const phaseKeys = new Set();

  for (const record of runtime.records) {
    if (
      !record ||
      record.version !== 1 ||
      record.step !== "unified-damage" ||
      !id(record.batchId) ||
      batchIds.has(record.batchId) ||
      !Number.isSafeInteger(record.turnNumber) ||
      record.turnNumber < 1 ||
      record.turnNumber > scene.turn.number ||
      typeof record.phaseId !== "string" ||
      !ATTACK_PHASE.test(record.phaseId) ||
      !Array.isArray(record.targetReports) ||
      !Array.isArray(record.rescueInterruptions)
    ) {
      fail("統一被害処理の履歴が不正です。");
    }

    const phaseKey = JSON.stringify([
      record.turnNumber,
      record.phaseId
    ]);

    if (phaseKeys.has(phaseKey)) {
      fail("同じ次序の統一被害処理が重複しています。");
    }

    batchIds.add(record.batchId);
    phaseKeys.add(phaseKey);
  }
}

/**
 * 输入仅来自正式规则层：
 *
 * cannon：
 * {
 *   attackId,
 *   targetId,
 *   kind: "cannon",
 *   impacts: resolveCannonImpact()生成的结果数组
 * }
 *
 * numeric：
 * {
 *   attackId,
 *   targetId,
 *   kind: "numeric",
 *   powerRule,
 *   hitCount,
 *   penetration,
 *   inertial: boolean
 * }
 *
 * 水下数字威力仍用kind:"numeric"输入，
 * 是否水下由readNumericPower()读取。
 *
 * 设备攻击、未知类型不能混入此步骤。
 */
function readAttacks(values) {
  if (!Array.isArray(values)) {
    fail("統一被害処理の攻撃一覧が不正です。");
  }

  const attackIds = new Set();
  const attacks = [];

  for (const value of values) {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !id(value.attackId) ||
      !id(value.targetId) ||
      attackIds.has(value.attackId)
    ) {
      fail("統一被害処理の攻撃識別番号が不正です。");
    }

    attackIds.add(value.attackId);

    if (value.kind === "cannon") {
      // 汇总函数同时检查类别和常命中份数。
      summarizeCannonImpacts(value.impacts, 0);

      attacks.push({
        attackId: value.attackId,
        targetId: value.targetId,
        kind: "cannon",
        impacts: copy(value.impacts)
      });

      continue;
    }

    if (value.kind === "numeric") {
      const parsed = readNumericPower(value.powerRule);

      integer(value.hitCount, "命中数");

      if (typeof value.inertial !== "boolean") {
        fail("慣性攻撃の指定が不正です。");
      }

      attacks.push({
        attackId: value.attackId,
        targetId: value.targetId,
        kind: "numeric",
        powerRule: value.powerRule,
        power: parsed.power,
        underwater: parsed.underwater,
        hitCount: value.hitCount,
        penetration: value.penetration,
        inertial: value.inertial
      });

      continue;
    }

    fail(
      "設備攻撃または未対応の威力が含まれています。" +
      "耐性攻撃で代用せず、結算を停止します。"
    );
  }

  return attacks.sort(
    (a, b) => compareText(a.attackId, b.attackId)
  );
}

/**
 * 在任何伤害和获取硬币之前，准备一个目标的全部被害。
 *
 * 水下强度按威力从高到低分配。
 * 同威力只按attackId稳定报告归属，不改变总伤害。
 */
function prepareTarget(startUnit, attacks) {
  const checked = copy(startUnit);

  if (checked.branch !== "navy") {
    fail("この統一被害処理は艦船専用です。");
  }

  ensureShipRuntime(checked);

  if (checked.shipState.status === "sunk") {
    fail("段階開始時に沈没している目標が含まれています。");
  }

  const profile = readShipProfile(checked);

  const cannonAttacks = attacks.filter(
    attack => attack.kind === "cannon"
  );

  const cannonImpacts = cannonAttacks.flatMap(
    attack => attack.impacts
  );

  const cannon = summarizeCannonImpacts(
    cannonImpacts,
    checked.shipState.normalHitRemainder
  );

  const numericReports = [];

  const ordinary = attacks.filter(
    attack =>
      attack.kind === "numeric" &&
      !attack.underwater
  );

  for (const attack of ordinary) {
    const result = resolveNumericDamage({
      powerRule: attack.powerRule,
      hitCount: attack.hitCount,
      penetration: attack.penetration,
      armor: profile.armor,
      inertial: attack.inertial,
      strength: profile.strength
    });

    numericReports.push({
      attackId: attack.attackId,
      ...result
    });
  }

  const underwater = attacks.filter(
    attack =>
      attack.kind === "numeric" &&
      attack.underwater
  ).sort(
    (a, b) =>
      b.power - a.power ||
      compareText(a.attackId, b.attackId)
  );

  const strengthBefore =
    profile.strength -
    checked.shipState.underwaterStrengthUses;

  let strengthRemaining = strengthBefore;

  for (const attack of underwater) {
    const result = resolveNumericDamage({
      powerRule: attack.powerRule,
      hitCount: attack.hitCount,
      penetration: attack.penetration,
      armor: profile.armor,
      inertial: attack.inertial,
      strength: profile.strength,
      strengthRemaining
    });

    strengthRemaining = result.strengthRemainingAfter;

    numericReports.push({
      attackId: attack.attackId,
      ...result
    });
  }

  let hpDamage = cannon.hpDamage;

  for (const report of numericReports) {
    hpDamage += report.hpDamage;
    integer(hpDamage, "統一耐性被害");
  }

  const hasDamageEffect =
    cannon.damagingImpactCount > 0 ||
    numericReports.some(
      report => report.hasDamageEffect
    );

  const acquisitions = [];

  for (const attack of cannonAttacks) {
    attack.impacts.forEach((impact, index) => {
      // 不信任额外fireEligible字段，直接从最终类别推导。
      if (
        ["major", "penetration"].includes(
          impact.finalCategory
        )
      ) {
        acquisitions.push({
          attackId: attack.attackId,
          type: "fire",
          hitIndex: index
        });
      }
    });
  }

  for (const attack of underwater) {
    // 每次合资格命中一次获取机会。
    // 已取得进水后，由现有状态算法跳过后续硬币。
    for (
      let hitIndex = 0;
      hitIndex < attack.hitCount;
      hitIndex++
    ) {
      acquisitions.push({
        attackId: attack.attackId,
        type: "flooding",
        hitIndex
      });
    }
  }

  acquisitions.sort(
    (a, b) =>
      compareText(a.attackId, b.attackId) ||
      compareText(a.type, b.type) ||
      a.hitIndex - b.hitIndex
  );

  return {
    targetId: checked.instanceId,
    attackIds: attacks.map(attack => attack.attackId),
    beforeHp: checked.currentHp,
    beforeShipState: copy(checked.shipState),
    hpDamage,
    hasDamageEffect,
    normalHitRemainder: cannon.normalHitRemainder,
    cannon,
    numericReports,
    strengthBefore,
    strengthAfter: strengthRemaining,
    strengthConsumed: strengthBefore - strengthRemaining,
    acquisitions
  };
}

/**
 * 确认被害尚未应用。
 *
 * 允许正式事务已经扣弹：
 * 此处只比较耐性和shipState，不比较equipmentState。
 */
function assertDamageNotApplied(unit, prepared) {
  if (
    unit.currentHp !== prepared.beforeHp ||
    JSON.stringify(unit.shipState) !==
      JSON.stringify(prepared.beforeShipState)
  ) {
    fail(
      "段階開始後に目標の被害状態が変更されています。" +
      "逐次被害と統一被害を混在させることはできません。"
    );
  }
}

/**
 * 应用同次序全部目标的统一被害。
 *
 * scene：正式保存事务的候选副本。
 * startScene：getAttackPhaseStartScene()返回的内部快照。
 * attacks：规则层实际生成的命中结果，不接受页面伤害数字。
 * batchId：本批次固定ID，不应在重复点击时随意更换。
 *
 * 不负责：
 * - 攻击资格、命中硬币、扣弹和射线登记；
 * - 首次濒临沉没时间的救助计时字段接入；
 * - 攻击计划终结、阶段推进或独立保存。
 *
 * 返回sinkingStarted，交给完整攻击事务登记首次时间。
 */
export function applyUnifiedDamageStep(
  scene,
  startScene,
  attacksValue,
  batchId,
  coinSource
) {
  validateScene(scene);
  validateScene(startScene);

  if (
    scene.turn.number !== startScene.turn.number ||
    scene.turn.phaseId !== startScene.turn.phaseId ||
    !id(batchId) ||
    (
      coinSource !== undefined &&
      typeof coinSource !== "function"
    )
  ) {
    fail("統一被害処理の開始状態または批次指定が不正です。");
  }

  const working = copy(scene);
  initializeUnifiedDamageRuntime(working);

  if (
    working.unifiedDamageRuntime.records.some(
      record =>
        record.batchId === batchId ||
        (
          record.turnNumber === working.turn.number &&
          record.phaseId === working.turn.phaseId
        )
    )
  ) {
    fail("この次序の統一被害はすでに処理済みです。");
  }

  // 原始任务必须有效，不能用本次攻击掩盖坏存档。
  initializeRescueState(working);

  const attacks = readAttacks(attacksValue);
  const byTarget = new Map();

  for (const attack of attacks) {
    if (!byTarget.has(attack.targetId)) {
      byTarget.set(attack.targetId, []);
    }

    byTarget.get(attack.targetId).push(attack);
  }

  const targetIds = [...byTarget.keys()].sort(compareText);
  const preparedTargets = [];

  // 全部目标的资料和伤害先验证完成。
  // 这里不投起火／进水获取硬币。
  for (const targetId of targetIds) {
    const startUnit = findUnit(startScene, targetId);
    const currentUnit = findUnit(working, targetId);

    const prepared = prepareTarget(
      startUnit,
      byTarget.get(targetId)
    );

    assertDamageNotApplied(currentUnit, prepared);
    preparedTargets.push(prepared);
  }

  const context = {
    turnNumber: working.turn.number,
    phaseId: working.turn.phaseId
  };

  const targetReports = [];

  // 每个目标只调用一次被害状态升级。
  for (const prepared of preparedTargets) {
    const unit = findUnit(working, prepared.targetId);

    unit.shipState.underwaterStrengthUses +=
      prepared.strengthConsumed;

    const damage = applyShipDamageAttack(
      unit,
      {
        attackId: `${batchId}:${prepared.targetId}`,
        kind: "cannon",
        hpDamage: prepared.hpDamage,
        hasDamageEffect: prepared.hasDamageEffect,
        normalHitRemainder: prepared.normalHitRemainder
      },
      context
    );

    ensureShipRuntime(unit);

    targetReports.push({
      version: 1,
      targetId: prepared.targetId,
      attackIds: [...prepared.attackIds],

      // 使用cannon应用入口，仅为一次性写入共同累计余数。
      // numericReports保留每种数字威力的真实被害来源。
      damage,
      cannon: copy(prepared.cannon),
      numericReports: copy(prepared.numericReports),
      strengthBefore: prepared.strengthBefore,
      strengthAfter: prepared.strengthAfter,
      strengthConsumed: prepared.strengthConsumed,
      effectAcquisitions: []
    });
  }

  // 所有耐性被害应用成功后，才处理特殊状态获取硬币。
  for (
    let index = 0;
    index < preparedTargets.length;
    index++
  ) {
    const prepared = preparedTargets[index];
    const unit = findUnit(working, prepared.targetId);
    const report = targetReports[index];

    for (const request of prepared.acquisitions) {
      const result = applyShipEffectAcquisition(
        unit,
        {
          attackId: request.attackId,
          type: request.type
        },
        context,
        coinSource
      );

      report.effectAcquisitions.push({
        ...result,
        hitIndex: request.hitIndex
      });
    }
  }

  // 挨打本身不自动中断。
  // 所有目标被害完成后，统一检查救助继续条件。
  const rescueInterruptions =
    reconcileActiveRescues(working);

  for (const unit of working.instances) {
    ensureShipRuntime(unit);
  }

  initializeRescueState(working);

  const report = {
    version: 1,
    step: "unified-damage",
    batchId,
    turnNumber: working.turn.number,
    phaseId: working.turn.phaseId,
    targetReports,
    rescueInterruptions
  };

  working.unifiedDamageRuntime.records.push(
    copy(report)
  );

  initializeUnifiedDamageRuntime(working);

  // 全步骤成功后才写回外层事务候选副本。
  scene.instances = working.instances;
  scene.rescueTasks = working.rescueTasks;
  scene.unifiedDamageRuntime =
    working.unifiedDamageRuntime;

  return copy(report);
}
