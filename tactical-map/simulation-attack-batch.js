import { readWeaponProfile } from "./weapon-profile-runtime.js";
import { initializeAttackRuntime } from "./simulation-attack-runtime.js";

const copy = value => JSON.parse(JSON.stringify(value));
const ATTACK_PHASE = /^(order-[1-5]|pas)$/;

function fail(message) {
  throw new Error(message);
}

function nonempty(value) {
  return typeof value === "string" && value.trim() !== "";
}

function requireAttackPhase(scene) {
  if (
    !scene ||
    !Array.isArray(scene.instances) ||
    !Number.isSafeInteger(scene.turn?.number) ||
    scene.turn.number < 1 ||
    !ATTACK_PHASE.test(scene.turn.phaseId)
  ) {
    fail("攻撃批次のラウンドまたは段階が不正です。");
  }
}

function findUnit(scene, id) {
  const unit = scene.instances.find(
    item => item.instanceId === id
  );

  if (!unit) {
    fail("攻撃批次のユニットを確認できません。");
  }

  return unit;
}

function findGroup(unit, id) {
  const group = unit.equipmentState?.groups?.find(
    item => item.id === id
  );

  if (!group) {
    fail("攻撃批次の装備組を確認できません。");
  }

  return group;
}

function profileFor(unit, group) {
  const source = unit.snapshot?.equipmentSnapshots?.find(
    item => item.id === group.equipmentId
  );

  if (!source) {
    fail("装備性能の配置スナップショットがありません。");
  }

  return readWeaponProfile(source);
}

function groupKey(unitId, groupId) {
  return JSON.stringify([unitId, groupId]);
}

// 不使用localeCompare，避免不同环境的排序规则改变顺序。
function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 只初始化内部批次状态，不补造历史快照。
 *
 * 已停在攻击阶段的旧存档，没有快照时仍允许加载；
 * 但正式批次准备会明确拒绝，不能把当前状态冒充阶段开始。
 */
export function initializeAttackBatchRuntime(scene) {
  if (
    !scene ||
    !Array.isArray(scene.instances) ||
    !Array.isArray(scene.groups) ||
    !Number.isSafeInteger(scene.turn?.number) ||
    scene.turn.number < 1
  ) {
    fail("攻撃批次の保存状態が不正です。");
  }

  if (scene.attackBatchRuntime === undefined) {
    scene.attackBatchRuntime = {
      version: 1,
      snapshot: null
    };
  }

  const runtime = scene.attackBatchRuntime;

  if (
    !runtime ||
    typeof runtime !== "object" ||
    Array.isArray(runtime) ||
    runtime.version !== 1
  ) {
    fail("攻撃批次の保存形式が不正です。");
  }

  const snapshot = runtime.snapshot;

  if (snapshot === null) return;

  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    Array.isArray(snapshot) ||
    snapshot.version !== 1 ||
    !Number.isSafeInteger(snapshot.turnNumber) ||
    snapshot.turnNumber < 1 ||
    snapshot.turnNumber !== scene.turn.number ||
    !ATTACK_PHASE.test(snapshot.phaseId) ||
    snapshot.phaseId !== scene.turn.phaseId ||
    !Number.isSafeInteger(snapshot.elapsedMinutes) ||
    snapshot.elapsedMinutes !== scene.turn.elapsedMinutes ||
    !Array.isArray(snapshot.instances) ||
    !Array.isArray(snapshot.groups) ||
    !snapshot.environment ||
    !snapshot.controls ||
    !snapshot.rayTargetRuntime ||
    !Array.isArray(snapshot.rayTargetRuntime.locks)
  ) {
    fail("次序開始スナップショットが現在の段階と一致しません。");
  }

  const ids = new Set();

  for (const unit of snapshot.instances) {
    if (
      !unit ||
      !nonempty(unit.instanceId) ||
      ids.has(unit.instanceId) ||
      !Array.isArray(unit.equipmentState?.groups)
    ) {
      fail("次序開始スナップショットのユニットが不正です。");
    }

    ids.add(unit.instanceId);
  }

  // 本项目不在战斗中新增或删除实例。
  // 沉船仍保留，因此阶段内实例集合应保持一致。
  if (
    ids.size !== scene.instances.length ||
    scene.instances.some(unit => !ids.has(unit.instanceId))
  ) {
    fail("次序開始後にユニット構成が変更されています。");
  }
}

/**
 * 只在真正进入攻击阶段时调用。
 * 不能由预览、计划保存或批次执行临时建立。
 *
 * 保存的是本阶段规则所需的内部数据，
 * 不复制initialScene、历史行动或地形大数组。
 */
export function captureAttackPhaseStart(scene) {
  requireAttackPhase(scene);
  initializeAttackRuntime(scene);
  initializeAttackBatchRuntime(scene);

  if (scene.attackBatchRuntime.snapshot !== null) {
    fail("この攻撃段階の開始状態はすでに保存されています。");
  }

  if (scene.attackRuntime.commands.length !== 0) {
    fail("未処理の攻撃計画があるため、段階開始を記録できません。");
  }

  scene.attackBatchRuntime.snapshot = copy({
    version: 1,
    turnNumber: scene.turn.number,
    phaseId: scene.turn.phaseId,
    elapsedMinutes: scene.turn.elapsedMinutes,
    environment: scene.environment,
    controls: scene.controls,
    instances: scene.instances,
    groups: scene.groups,
    rayTargetRuntime: scene.rayTargetRuntime ?? {
      version: 1,
      locks: []
    }
  });

  initializeAttackBatchRuntime(scene);
}

/**
 * 取得独立的阶段开始规则场景。
 * 地形沿用场景资料；调用方不得修改地形。
 * 不向页面或观察导出返回这个对象。
 */
export function getAttackPhaseStartScene(scene) {
  requireAttackPhase(scene);
  initializeAttackBatchRuntime(scene);

  const snapshot = scene.attackBatchRuntime.snapshot;

  if (snapshot === null) {
    fail(
      "この段階の開始スナップショットがありません。" +
      "現在状態で代用せず、攻撃結算を停止します。"
    );
  }

  const start = copy(snapshot);

  return {
    terrain: scene.terrain,
    environment: start.environment,
    controls: start.controls,
    turn: {
      number: start.turnNumber,
      phaseId: start.phaseId,
      elapsedMinutes: start.elapsedMinutes
    },
    instances: start.instances,
    groups: start.groups,
    rayTargetRuntime: start.rayTargetRuntime
  };
}

/**
 * 按阶段开始状态检查装备与资源资格。
 * 不代替目标几何、命中修正、范围效果和伤害检查。
 */
function prepareCommand(startScene, command) {
  const actor = findUnit(startScene, command.unitId);
  const target = findUnit(startScene, command.targetId);
  const group = findGroup(actor, command.groupId);
  const profile = profileFor(actor, group);

  if (actor.branch !== "navy" || target.branch !== "navy") {
    fail("この軍種の正式な攻撃批次処理は未接続です。");
  }

  if (
    ["sinking", "sunk"].includes(actor.shipState?.status) ||
    actor.shipState?.rescueTaskId !== null
  ) {
    fail("段階開始時に行動不能または救助中の艦船があります。");
  }

  if (
    actor.instanceId === target.instanceId ||
    actor.side === target.side
  ) {
    fail("自分自身または同一陣営への攻撃は結算できません。");
  }

  if (target.shipState?.status === "sunk") {
    fail("段階開始時に沈没している目標は攻撃できません。");
  }

  if (profile.kind !== "weapon" || profile.issues.length) {
    fail(
      "攻撃装備の性能を確認できません。" +
      (profile.issues.length
        ? "\n" + profile.issues.join("\n")
        : "")
    );
  }

  if (group.damaged) {
    fail("段階開始時に損傷している装備組は使用できません。");
  }

  if (
    group.lastUsedTurn !== null &&
    group.lastUsedTurn >= startScene.turn.number
  ) {
    fail("このラウンドで使用済み、または使用記録が不正な装備組です。");
  }

  const orderMatch = /^order-([1-5])$/.exec(
    startScene.turn.phaseId
  );

  if (profile.pasOnly) {
    if (startScene.turn.phaseId !== "pas") {
      fail("PAS装備はPAS段階に限り使用できます。");
    }
  } else {
    if (
      !orderMatch ||
      profile.maxOrder === null ||
      Number(orderMatch[1]) > profile.maxOrder
    ) {
      fail("この装備組は現在の次序で使用できません。");
    }
  }

  if (
    !Number.isSafeInteger(group.remainingAmmo) ||
    group.remainingAmmo < 1 ||
    !Number.isSafeInteger(profile.fullAmmoCost) ||
    profile.fullAmmoCost < 1 ||
    !profile.projection
  ) {
    fail("装備組の残弾または投射率が不正です。");
  }

  // 减量投射尚未整合：
  // 不能根据剩余弹数随意改变X或Y。
  if (group.remainingAmmo < profile.fullAmmoCost) {
    fail(
      "完全投射には残弾が不足しています。" +
      "減量投射の割り当て処理が未接続のため、結算を停止します。"
    );
  }

  const total =
    profile.projection.groups *
    profile.projection.coinsPerGroup;

  if (
    !Number.isSafeInteger(total) ||
    total !== profile.fullAmmoCost
  ) {
    fail("投射率と消費弾数が一致しません。");
  }

  return {
    commandId: command.id,
    unitId: actor.instanceId,
    groupId: group.id,
    targetId: target.instanceId,
    side: actor.side,
    profile: copy(profile),
    projection: {
      groups: profile.projection.groups,
      coinsPerGroup: profile.projection.coinsPerGroup,
      standalone: profile.projection.standalone === true
    },
    ammoBefore: group.remainingAmmo,
    ammoCost: profile.fullAmmoCost,
    ammoAfter: group.remainingAmmo - profile.fullAmmoCost,
    lastUsedTurnBefore: group.lastUsedTurn
  };
}

/**
 * 准备整个次序的资源清单。
 * 不写回、不扣弹、不掷币、不登记射线。
 *
 * 必须准备所有阵营的计划，不能先结算我方再结算敌方。
 */
export function prepareAttackBatchResources(scene) {
  requireAttackPhase(scene);
  initializeAttackRuntime(scene);

  if (scene.controls?.enemyAutonomy === true) {
    fail("敵・中立の自律攻撃計画が未実装のため、結算できません。");
  }

  const startScene = getAttackPhaseStartScene(scene);

  const commands = [...scene.attackRuntime.commands].sort(
    (a, b) =>
      compareText(a.unitId, b.unitId) ||
      compareText(a.groupId, b.groupId)
  );

  const entries = commands.map(
    command => prepareCommand(startScene, command)
  );

  const rayTargets = new Map();

  for (const entry of entries) {
    if (entry.profile.guidance !== "ray") continue;

    const existing = startScene.rayTargetRuntime.locks.find(
      lock =>
        lock.unitId === entry.unitId &&
        lock.turnNumber === startScene.turn.number
    );

    const selected = rayTargets.get(entry.unitId);

    if (
      (existing && existing.targetId !== entry.targetId) ||
      (selected && selected !== entry.targetId)
    ) {
      fail(
        "同じ艦船の射線に複数の目標が指定されています。" +
        "このラウンドの射線目標を統一してください。"
      );
    }

    rayTargets.set(entry.unitId, entry.targetId);
  }

  return {
    version: 1,
    turnNumber: startScene.turn.number,
    phaseId: startScene.turn.phaseId,
    entries
  };
}

/**
 * 正式整批事务内部的资源应用步骤。
 *
 * 只允许对尚未应用本批伤害的候选副本调用。
 * 命中、伤害、报告和计划终结必须随后同事务完成。
 *
 * 不导出为页面按钮；单独调用不等于攻击完成。
 */
export function applyAttackBatchResources(scene, prepared) {
  const expected = prepareAttackBatchResources(scene);

  // 不信任页面或调用方传入的扣弹数字。
  if (JSON.stringify(prepared) !== JSON.stringify(expected)) {
    fail("攻撃批次の資源準備結果が現在の計画と一致しません。");
  }

  const changes = [];
  const used = new Set();

  for (const entry of expected.entries) {
    const actor = findUnit(scene, entry.unitId);
    const group = findGroup(actor, entry.groupId);
    const key = groupKey(entry.unitId, entry.groupId);

    if (
      used.has(key) ||
      group.remainingAmmo !== entry.ammoBefore ||
      group.lastUsedTurn !== entry.lastUsedTurnBefore ||
      group.damaged
    ) {
      fail("攻撃資源が変更済み、またはこの批次で使用済みです。");
    }

    used.add(key);

    changes.push({
      group,
      entry
    });
  }

  // 全组检查成功后才更新，不产生前几组扣弹的半结果。
  for (const { group, entry } of changes) {
    group.remainingAmmo = entry.ammoAfter;
    group.lastUsedTurn = expected.turnNumber;
  }

  return expected.entries.map(entry => ({
    commandId: entry.commandId,
    unitId: entry.unitId,
    groupId: entry.groupId,
    turnNumber: expected.turnNumber,
    phaseId: expected.phaseId,
    ammoBefore: entry.ammoBefore,
    ammoCost: entry.ammoCost,
    ammoAfter: entry.ammoAfter,
    lastUsedTurnBefore: entry.lastUsedTurnBefore,
    lastUsedTurnAfter: expected.turnNumber
  }));
}
