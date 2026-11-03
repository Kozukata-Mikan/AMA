import { readWeaponProfile } from "./weapon-profile-runtime.js";
import { initializeAttackRuntime } from "./simulation-attack-runtime.js";
import { ensureUnitCombatRuntime } from "./equipment-runtime.js";
import { ensureShipRuntime } from "./ship-runtime.js";
import { initializeRayTargetRuntime } from "./ray-target-runtime.js";
import { assertIdentifiedTargets  } from "./simulation-features.js";
import { resolveHitCoins } from "./weapon-hit-runtime.js";
import { validateFormationTopology } from "./formation-target-runtime.js";


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
        // 在副本上校验，不能在加载校验时补写历史快照。
    const checked = copy(unit);

    ensureShipRuntime(checked);
    ensureUnitCombatRuntime(checked);

    // 正式阶段快照必须已经包含完整运行字段。
    // 若初始化需要补字段，说明它不是完整的阶段开始记录。
    if (
      JSON.stringify(checked.shipState) !==
        JSON.stringify(unit.shipState) ||
      JSON.stringify(checked.equipmentState) !==
        JSON.stringify(unit.equipmentState) ||
      JSON.stringify(checked.trainingState) !==
        JSON.stringify(unit.trainingState)
    ) {
      fail("次序開始スナップショットの実行状態が不足しています。");
    }

  }

  // 本项目不在战斗中新增或删除实例。
  // 沉船仍保留，因此阶段内实例集合应保持一致。
  if (
    ids.size !== scene.instances.length ||
    scene.instances.some(unit => !ids.has(unit.instanceId))
  ) {
    fail("次序開始後にユニット構成が変更されています。");
  }
    const rayScene = {
    instances: copy(snapshot.instances),
    turn: {
      number: snapshot.turnNumber
    },
    rayTargetRuntime: copy(snapshot.rayTargetRuntime)
  };

  initializeRayTargetRuntime(rayScene);

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
    // 每个阵营分别使用自己的阶段开始观察权限。
  // 只新建controls，不修改开始快照或页面观察阵营。
  const actorObservationScene = {
    ...startScene,
    controls: {
      ...startScene.controls,
      observationSide: actor.side
    }
  };

  assertIdentifiedTargets(
    actorObservationScene,
    [target]
  );

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

  // 用次序开始编队树检查，不能用当前列表临时补造。
  // 全批预检时执行，错误发生在扣弹与随机数之前。
  validateFormationTopology(startScene);

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
 * 正式批次事务内部的资源应用步骤。
 *
 * 在独立候选副本中完成检查和扣弹。
 * 任意失败都不修改传入场景。
 *
 * 必须先应用资源，再应用本批伤害：
 * 攻击者随后被击沉，不取消已经发动的攻击。
 *
 * 本函数不保存，不终结计划，不推进阶段。
 * 不能作为页面独立操作入口。
 */
export function applyAttackBatchResources(scene, prepared) {
  const working = copy(scene);
  const expected = prepareAttackBatchResources(working);

  if (
    JSON.stringify(prepared) !== JSON.stringify(expected)
  ) {
    fail("攻撃批次の資源準備結果が現在の計画と一致しません。");
  }

  const startScene = getAttackPhaseStartScene(working);
  const reports = [];
  const used = new Set();

  // 先完成整批检查，不在循环中扣弹。
  for (const entry of expected.entries) {
    const actor = findUnit(working, entry.unitId);
    const startActor = findUnit(startScene, entry.unitId);

    ensureShipRuntime(actor);
    ensureUnitCombatRuntime(actor);

    const group = findGroup(actor, entry.groupId);
    const startGroup = findGroup(startActor, entry.groupId);
    const key = groupKey(entry.unitId, entry.groupId);

    if (
      used.has(key) ||
      group.equipmentId !== startGroup.equipmentId ||
      group.mountIndex !== startGroup.mountIndex ||
      group.groupIndex !== startGroup.groupIndex ||
      group.position !== startGroup.position ||
      group.initialAmmo !== startGroup.initialAmmo ||
      group.profileAvailable !== startGroup.profileAvailable ||
      group.remainingAmmo !== entry.ammoBefore ||
      group.lastUsedTurn !== entry.lastUsedTurnBefore ||
      group.damaged !== startGroup.damaged
    ) {
      fail(
        "段階開始後に装備構成または攻撃資源が変更されています。"
      );
    }

    used.add(key);
  }

  // 整批检查成功后，在独立候选副本中扣弹。
  for (const entry of expected.entries) {
    const actor = findUnit(working, entry.unitId);
    const group = findGroup(actor, entry.groupId);

    group.remainingAmmo = entry.ammoAfter;
    group.lastUsedTurn = expected.turnNumber;

    reports.push({
      version: 1,
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
    });
  }

  // 扣弹后的保存约束仍须成立。
  const checkedActors = new Set();

  for (const entry of expected.entries) {
    if (checkedActors.has(entry.unitId)) continue;

    const actor = findUnit(working, entry.unitId);

    ensureShipRuntime(actor);
    ensureUnitCombatRuntime(actor);

    checkedActors.add(entry.unitId);
  }

  // 所有检查通过后，只写回本步骤负责的装备运行状态。
  // 不替换整场instances，不覆盖其他事务步骤的数据。
  for (const unitId of checkedActors) {
    const source = findUnit(working, unitId);
    const destination = findUnit(scene, unitId);

    destination.equipmentState = copy(source.equipmentState);
  }

  return copy(reports);
}

/**
 * 正式预检函数必须返回：
 *
 * {
 *   allowed: true,
 *   commandId: entry.commandId,
 *   bonuses: 非负安全整数,
 *   penalties: 非负安全整数
 * }
 *
 * bonuses / penalties必须已经包含本次命中所需修正。
 * 不提供默认零值，避免漏掉练度、词条或环境效果。
 */
function validateHitPreflight(result, entry) {
  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    result.allowed !== true ||
    result.commandId !== entry.commandId ||
    !Number.isSafeInteger(result.bonuses) ||
    result.bonuses < 0 ||
    !Number.isSafeInteger(result.penalties) ||
    result.penalties < 0
  ) {
    fail(
      "正式な攻撃条件または命中修正が確定していません。" +
      "未確定の条件を省略せず、結算を停止します。"
    );
  }

  return {
    commandId: entry.commandId,
    bonuses: result.bonuses,
    penalties: result.penalties
  };
}

/**
 * 在隔离副本上对全批次执行正式预检。
 *
 * 正式预检只能查询：
 * 不允许修改快照、计划或资源，不应掷随机数。
 *
 * 实际几何、词条、范围与威力支持检查由正式预检负责。
 * 此处不能只传入“始终allowed”的占位函数。
 */
function prepareBatchHitChecks(
  scene,
  prepared,
  finalPreflight
) {
  if (typeof finalPreflight !== "function") {
    fail(
      "正式な攻撃条件照合が未接続です。" +
      "命中コインは投げません。"
    );
  }

  const expected = prepareAttackBatchResources(
    copy(scene)
  );

  if (
    JSON.stringify(prepared) !== JSON.stringify(expected)
  ) {
    fail("命中判定の批次と現在の攻撃計画が一致しません。");
  }

  const startScene = getAttackPhaseStartScene(
    copy(scene)
  );

  const checks = [];

  // 必须全部通过后才能进入命中掷币步骤。
  for (const entry of expected.entries) {
    const input = {
      startScene: {
        ...copy(startScene),
        controls: {
          ...copy(startScene.controls),
          observationSide: entry.side
        }
      },
      entry: copy(entry)
    };

    const before = JSON.stringify(input);

    const result = finalPreflight(
      input.startScene,
      input.entry
    );

    if (JSON.stringify(input) !== before) {
      fail(
        "攻撃条件照合が入力状態を変更しました。" +
        "命中判定を停止します。"
      );
    }

    checks.push(
      validateHitPreflight(result, entry)
    );
  }

  return {
    prepared: expected,
    checks
  };
}

/**
 * 整批命中处理：不修改scene，不扣弹，不造成伤害。
 *
 * 只允许由完整攻击事务内部调用。
 * 返回的报告必须与弹药、伤害及计划终结同事务保存。
 *
 * 任意失败都不返回半批报告。
 * 随机源的已调用次数不能“回滚”，但失败时不得保存
 * 半结果、扣弹或推进阶段。
 */
export function resolveAttackBatchHitStep(
  scene,
  prepared,
  finalPreflight,
  coinSource
) {
  if (
    coinSource !== undefined &&
    typeof coinSource !== "function"
  ) {
    fail("命中判定のコイン関数が不正です。");
  }

  const checked = prepareBatchHitChecks(
    scene,
    prepared,
    finalPreflight
  );

  const reports = [];

  for (
    let index = 0;
    index < checked.prepared.entries.length;
    index++
  ) {
    const entry = checked.prepared.entries[index];
    const modifiers = checked.checks[index];

    const input = {
      groups: entry.projection.groups,
      coinsPerGroup: entry.projection.coinsPerGroup,
      standalone: entry.projection.standalone,
      guidance: entry.profile.guidance,
      bonuses: modifiers.bonuses,
      penalties: modifiers.penalties
    };

    const hit = coinSource === undefined
      ? resolveHitCoins(input)
      : resolveHitCoins(input, coinSource);

    reports.push({
      version: 1,
      commandId: entry.commandId,
      unitId: entry.unitId,
      groupId: entry.groupId,
      targetId: entry.targetId,
      turnNumber: checked.prepared.turnNumber,
      phaseId: checked.prepared.phaseId,
      modifiers: copy(modifiers),
      hit: copy(hit)
    });
  }

  return {
    version: 1,
    step: "attack-hit",
    turnNumber: checked.prepared.turnNumber,
    phaseId: checked.prepared.phaseId,
    reports
  };
}


