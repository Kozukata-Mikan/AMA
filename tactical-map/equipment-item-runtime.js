import {
  EQUIPMENT_HIT_ITEMS,
  resolveEquipmentImpacts,
  validateEquipmentImpactReport,
  resolveEquipmentItemDamageControl,
  validateEquipmentItemControlReport
} from "./equipment-damage-runtime.js";

import {
  ensureEquipmentRuntime
} from "./equipment-runtime.js";

const copy = value => JSON.parse(JSON.stringify(value));
const ITEM_IDS = EQUIPMENT_HIT_ITEMS.map(item => item.id);
const RECON_IDS = ["sea-recon", "air-recon"];

const POSITION_NAMES = new Map([
  ["前部", "front"],
  ["中部1", "middle-1"],
  ["中部１", "middle-1"],
  ["中部2", "middle-2"],
  ["中部２", "middle-2"],
  ["两舷", "both-sides"],
  ["兩舷", "both-sides"],
  ["両舷", "both-sides"],
  ["后部", "rear"],
  ["後部", "rear"],
  ["尾部", "tail"],

  // 同时接受本模块自身的稳定ID。
  ["front", "front"],
  ["middle-1", "middle-1"],
  ["middle-2", "middle-2"],
  ["both-sides", "both-sides"],
  ["rear", "rear"],
  ["tail", "tail"]
]);

function fail(message) {
  throw new Error(message);
}

function object(value) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function requireTurn(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail("設備処理のラウンド番号が不正です。");
  }

  return value;
}

function requireItemId(itemId) {
  if (!ITEM_IDS.includes(itemId)) {
    fail("設備処理の対象項目が不正です。");
  }
}

function positionItemId(position) {
  if (typeof position !== "string") {
    fail("装備位置の保存値が不正です。");
  }

  const normalized = position
    .trim()
    .replace(/\s+/g, "");

  const itemId = POSITION_NAMES.get(normalized);

  // 未识别位置必须拒绝，不能冒充空槽。
  if (!itemId) {
    fail("装備位置を八項目に対応付けできません。");
  }

  return itemId;
}

function validateDiscoveries(value) {
  if (!Array.isArray(value)) {
    fail("偵察発見元の保存形式が不正です。");
  }

  const ids = new Set();

  for (const entry of value) {
    if (
      !object(entry) ||
      typeof entry.targetId !== "string" ||
      !entry.targetId ||
      !["identified", "shadow"].includes(entry.level) ||
      ids.has(entry.targetId)
    ) {
      fail("偵察発見元の保存値が不正です。");
    }

    ids.add(entry.targetId);
  }
}

function validateItemState(state) {
  if (
    !object(state) ||
    typeof state.damaged !== "boolean" ||
    typeof state.destroyed !== "boolean" ||
    (state.destroyed && !state.damaged)
  ) {
    fail("設備項目の損傷状態が不正です。");
  }

  if (state.damagedTurn !== null) {
    requireTurn(state.damagedTurn);
  }

  validateDiscoveries(state.discoveries);

  if (
    !state.damaged &&
    (
      state.destroyed ||
      state.damagedTurn !== null ||
      state.discoveries.length !== 0
    )
  ) {
    fail("正常な設備項目に損傷記録が残っています。");
  }

  // 旧存档迁移的损坏允许没有受损回合，
  // 但不能替它伪造当回合发现保留。
  if (
    state.damagedTurn === null &&
    state.discoveries.length !== 0
  ) {
    fail("偵察発見元の保持ラウンドがありません。");
  }
}

function emptyItemState() {
  return {
    damaged: false,
    destroyed: false,
    damagedTurn: null,
    discoveries: []
  };
}

function groupsForItem(unit, itemId) {
  return unit.equipmentState.groups.filter(
    group => positionItemId(group.position) === itemId
  );
}

/**
 * 初始化八项状态，并兼容旧装备组存档。
 *
 * 正式场景初始化或事务工作副本上调用。
 * 不清空旧存档，不修改snapshot。
 *
 * 旧存档中某位置只损坏了部分组时，
 * 迁移为该整个项目损坏；彻底损坏优先。
 */
export function ensureEquipmentItemRuntime(unit) {
  if (!object(unit) || unit.branch !== "navy") {
    fail("設備項目処理は艦船専用です。");
  }

  ensureEquipmentRuntime(unit);

  if (!Array.isArray(unit.equipmentState.groups)) {
    fail("装備グループの保存形式が不正です。");
  }

  for (const group of unit.equipmentState.groups) {
    positionItemId(group.position);
  }

  let runtime = unit.equipmentState.itemDamage;

  if (runtime === undefined) {
    runtime = {
      version: 1,
      items: Object.fromEntries(
        ITEM_IDS.map(id => [id, emptyItemState()])
      )
    };

    for (const itemId of ITEM_IDS) {
      if (RECON_IDS.includes(itemId)) continue;

      const groups = groupsForItem(unit, itemId);
      const state = runtime.items[itemId];

      state.destroyed = groups.some(
        group => group.destroyed === true
      );

      state.damaged = state.destroyed ||
        groups.some(group => group.damaged === true);
    }

    unit.equipmentState.itemDamage = runtime;
  }

  if (
    !object(runtime) ||
    runtime.version !== 1 ||
    !object(runtime.items) ||
    Object.keys(runtime.items).length !== ITEM_IDS.length ||
    ITEM_IDS.some(id => !Object.hasOwn(runtime.items, id))
  ) {
    fail("八項目の設備保存形式が不正です。");
  }

  for (const itemId of ITEM_IDS) {
    const state = runtime.items[itemId];
    validateItemState(state);

    if (RECON_IDS.includes(itemId)) continue;

    const groups = groupsForItem(unit, itemId);

    if (
      groups.length === 0 &&
      (
        state.damaged ||
        state.destroyed ||
        state.damagedTurn !== null ||
        state.discoveries.length !== 0
      )
    ) {
      fail("空の装備位置に損傷状態が保存されています。");
    }

    // 项目状态是正式来源，装备组状态用于现有武器资格检查。
    for (const group of groups) {
      group.damaged = state.damaged;
      group.destroyed = state.destroyed;
    }
  }

  ensureEquipmentRuntime(unit);
  return runtime;
}

/**
 * 查询使用副本，不在观察函数中迁移或写入正式单位。
 */
export function readEquipmentItemState(unit, itemId) {
  requireItemId(itemId);

  const working = copy(unit);
  const runtime = ensureEquipmentItemRuntime(working);

  return copy(runtime.items[itemId]);
}

function writeWorkingEquipment(unit, working) {
  ensureEquipmentItemRuntime(working);
  unit.equipmentState = copy(working.equipmentState);
}

/**
 * 设备攻击实际写回。
 *
 * 必须由正式结算层在场景工作副本上调用。
 * observeBeforeDamage负责读取受损前、对应侦察项的发现来源。
 *
 * observeBeforeDamage(observer, target, itemId)
 *   => "identified" | "shadow" | null
 *
 * 该回调不能使用已混合全阵营来源的getVisibility。
 */
export function applyEquipmentAttack(
  scene,
  targetUnit,
  input,
  {
    selectIndex,
    observeBeforeDamage
  } = {}
) {
  if (
    !object(scene) ||
    !Array.isArray(scene.instances) ||
    !object(targetUnit)
  ) {
    fail("設備攻撃の場面データが不正です。");
  }

  const turnNumber = requireTurn(scene.turn?.number);

  if (
    !scene.instances.some(
      unit => unit === targetUnit
    )
  ) {
    fail("設備攻撃の対象が作業場面に属していません。");
  }

  // 在抽选前完成状态和回调资格检查。
  const working = copy(targetUnit);
  const runtime = ensureEquipmentItemRuntime(working);

  if (typeof observeBeforeDamage !== "function") {
    fail("設備攻撃の偵察発見元処理が接続されていません。");
  }

  const captured = {};

  for (const itemId of RECON_IDS) {
    captured[itemId] = [];

    if (runtime.items[itemId].damaged) continue;

    for (const target of scene.instances) {
      if (
        target.instanceId === targetUnit.instanceId ||
        target.side === targetUnit.side
      ) {
        continue;
      }

      const level = observeBeforeDamage(
        targetUnit,
        target,
        itemId
      );

      if (level === null) continue;

      if (!["identified", "shadow"].includes(level)) {
        fail("偵察発見元の取得結果が不正です。");
      }

      captured[itemId].push({
        targetId: target.instanceId,
        level
      });
    }

    validateDiscoveries(captured[itemId]);
  }

  const report = resolveEquipmentImpacts(
    input,
    selectIndex
  );

  validateEquipmentImpactReport(report);

  const applications = [];

  for (const draw of report.draws) {
    const itemId = draw.itemId;
    const state = runtime.items[itemId];
    const recon = RECON_IDS.includes(itemId);

    const groups = recon
      ? []
      : groupsForItem(working, itemId);

    const empty = !recon && groups.length === 0;
    const before = copy(state);

    if (!empty && !state.damaged) {
      state.damaged = true;
      state.damagedTurn = turnNumber;
      state.discoveries = recon
        ? copy(captured[itemId])
        : [];
    }

    // 已损坏项目不叠加、不延长发现保持时间。
    // 已彻底损坏项目不降级。
    applications.push({
      allocationIndex: draw.allocationIndex,
      itemId,
      empty,
      groupIds: groups.map(group => group.id),
      before,
      after: copy(state),
      changed: JSON.stringify(before) !==
        JSON.stringify(state)
    });
  }

  writeWorkingEquipment(targetUnit, working);

  return {
    ...report,
    turnNumber,
    applications
  };
}

/**
 * 生成内部损管候选，不抽选、不掷币。
 */
export function getEquipmentControlCandidates(unit) {
  const working = copy(unit);
  const runtime = ensureEquipmentItemRuntime(working);

  return ITEM_IDS.filter(itemId => {
    const state = runtime.items[itemId];
    return state.damaged && !state.destroyed;
  });
}

function applyItemResolution(
  working,
  itemId,
  success
) {
  requireItemId(itemId);

  if (typeof success !== "boolean") {
    fail("設備修復の成否が不正です。");
  }

  const runtime = ensureEquipmentItemRuntime(working);
  const state = runtime.items[itemId];

  if (!state.damaged || state.destroyed) {
    fail("修復可能な損傷項目ではありません。");
  }

  const before = copy(state);

  if (success) {
    runtime.items[itemId] = emptyItemState();
  } else {
    // 失败作用于同一个项目。
    state.destroyed = true;
  }

  ensureEquipmentItemRuntime(working);

  return {
    itemId,
    success,
    outcome: success ? "repaired" : "destroyed",
    before,
    after: copy(runtime.items[itemId])
  };
}

/**
 * 内部损管：先选一个项目，再判定一次R，随后实际写回。
 *
 * 场景级“只处理一次”仍由既有特殊阶段事务负责。
 */
export function applyEquipmentItemDamageControl(
  unit,
  sources = {}
) {
  const working = copy(unit);
  ensureEquipmentItemRuntime(working);

  const report = resolveEquipmentItemDamageControl(
    {
      candidateIds: getEquipmentControlCandidates(working)
    },
    sources
  );

  validateEquipmentItemControlReport(report);

  const application = report.skipped
    ? null
    : applyItemResolution(
        working,
        report.itemId,
        report.success
      );

  writeWorkingEquipment(unit, working);

  return {
    ...report,
    application
  };
}

/**
 * 外部修复的最终项目结果应用。
 *
 * 任务层必须先完成资格、距离、耗时、持续性和判定检查。
 * 此函数不创建任务、不掷币、不处理救助计时。
 *
 * 成功恢复一个项目；失败使该项目彻底损坏。
 * 不改变舰船耐性或沉没状态。
 */
export function applyExternalEquipmentRepairResult(
  unit,
  itemId,
  success
) {
  const working = copy(unit);

  const application = applyItemResolution(
    working,
    itemId,
    success
  );

  writeWorkingEquipment(unit, working);

  return {
    version: 1,
    kind: "equipment-external-repair",
    ...application
  };
}

/**
 * 侦察能力查询。
 */
export function isEquipmentReconAvailable(unit, itemId) {
  if (!RECON_IDS.includes(itemId)) {
    fail("偵察項目の指定が不正です。");
  }

  return !readEquipmentItemState(unit, itemId).damaged;
}

/**
 * 仅查询这个观察者、这个侦察项的受损当回合发现。
 * 下一回合自动失效，不写回状态、不延长有效期。
 */
export function getRetainedEquipmentDiscovery(
  scene,
  observer,
  target,
  itemId
) {
  if (!RECON_IDS.includes(itemId)) {
    fail("偵察項目の指定が不正です。");
  }

  const state = readEquipmentItemState(observer, itemId);

  if (
    !state.damaged ||
    state.damagedTurn !== scene.turn?.number
  ) {
    return null;
  }

  return state.discoveries.find(
    entry => entry.targetId === target.instanceId
  )?.level ?? null;
}
