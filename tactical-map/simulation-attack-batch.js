import { readWeaponProfile ,readWeaponTargetScope} from "./weapon-profile-runtime.js";
import { initializeAttackRuntime } from "./simulation-attack-runtime.js";
import {ensureUnitCombatRuntime,readEffectiveInitialAmmo} from "./equipment-runtime.js";
import { ensureShipRuntime } from "./ship-runtime.js";
import { initializeRayTargetRuntime } from "./ray-target-runtime.js";
import { assertIdentifiedTargets  } from "./simulation-features.js";
import { resolveHitCoins } from "./weapon-hit-runtime.js";
import { validateFormationTopology, expandFormationMemberIds} from "./formation-target-runtime.js";
import { readAttackCommandTarget } from "./simulation-attack-runtime.js";
import { readRangeCommandTarget } from "./simulation-range-command.js";
import { prepareRangeProjection, selectRangeOccurrences, resolveRangeProjectionHits } from "./range-projection-runtime.js";
import { assertBroadsideQuotas } from "./weapon-firing-arc.js";



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

  return readWeaponProfile(source, group);
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

  // 原始阶段快照不变。
// 仅在独立规则场景副本上应用明确登记的缺失资料补完。
// 不把当前损伤、位置、编队或其他资源覆盖进历史场景。
for (const startUnit of start.instances) {
  const currentUnit = scene.instances.find(
    unit => unit.instanceId === startUnit.instanceId
  );

  if (!currentUnit) {
    fail("弾薬補完のユニットを確認できません。");
  }

  for (const startGroup of startUnit.equipmentState.groups) {
    const currentGroup = currentUnit.equipmentState.groups.find(
      group => group.id === startGroup.id
    );

    if (!currentGroup) {
      fail("弾薬補完の装備組を確認できません。");
    }

    const oldRecord = startGroup.ammoRegistration;
    const newRecord = currentGroup.ammoRegistration;

    if (oldRecord !== undefined) {
      if (
        JSON.stringify(oldRecord) !== JSON.stringify(newRecord)
      ) {
        fail("段階開始後に弾薬補完記録が変更されています。");
      }

      continue;
    }

    if (newRecord === undefined) continue;

    const ammo = readEffectiveInitialAmmo(currentGroup);

    if (
      startGroup.initialAmmo !== null ||
      startGroup.remainingAmmo !== null ||
      startGroup.lastUsedTurn !== null ||
      currentGroup.initialAmmo !== null ||
      currentGroup.remainingAmmo !== ammo ||
      currentGroup.lastUsedTurn !== null ||
      currentGroup.equipmentId !== startGroup.equipmentId ||
      currentGroup.mountIndex !== startGroup.mountIndex ||
      currentGroup.groupIndex !== startGroup.groupIndex ||
      currentGroup.position !== startGroup.position ||
      currentGroup.profileAvailable !== startGroup.profileAvailable ||
      newRecord.turnNumber !== start.turnNumber ||
      newRecord.phaseId !== start.phaseId
    ) {
      fail(
        "この段階に適用できない弾薬補完記録があります。" +
        "過去の消費弾数は推測しません。"
      );
    }

    startGroup.ammoRegistration = copy(newRecord);
    startGroup.remainingAmmo = ammo;
  }

  ensureUnitCombatRuntime(startUnit);
}


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
  const group = findGroup(actor, command.groupId);
  const profile = profileFor(actor, group);
  const weaponScope = readWeaponTargetScope(
  profile.targetScope
);


  if (actor.branch !== "navy") {
    fail("この軍種の正式な攻撃批次処理は未接続です。");
  }

  if (
    ["sinking", "sunk"].includes(actor.shipState?.status) ||
    actor.shipState?.rescueTaskId !== null
  ) {
    fail("段階開始時に行動不能または救助中の艦船があります。");
  }

  if (profile.kind !== "weapon" || profile.issues.length) {
    fail(
      "攻撃装備の性能を確認できません。" +
      (profile.issues.length
        ? "\n" + profile.issues.join("\n")
        : "")
    );
  }

  const target = readAttackCommandTarget(command);

// 武器性能范围不变；本次执行范围由实际指定的目标决定。
// 集群武器直接指定单体时，只攻击该单体，
// 不展开该单体所属的集群。
const clusterSingleTarget =
  profile.targetScope.trim() === "集群" &&
  target.targetRef.kind === "unit";

const scope = clusterSingleTarget
  ? { kind: "single" }
  : weaponScope;

let memberIds;


  if (scope.kind === "single") {
    if (
      target.targetRef.kind !== "unit" ||
      target.specifiedTargetIds.length !== 0
    ) {
      fail("単体武器には一つのユニットを指定してください。");
    }

    memberIds = [target.targetRef.id];
  } else {
    if (target.targetRef.kind !== "group") {
      fail("範囲武器には一つの編隊を主目標として指定してください。");
    }

    readRangeCommandTarget(command, scope);

    memberIds = expandFormationMemberIds(
      startScene,
      target.targetRef
    );
  }

  if (!memberIds.length) {
    fail("主目標の編隊にメンバーがいません。");
  }

  const members = memberIds.map(id => findUnit(startScene, id));

  // 未接入军种不能当作“不合格成员”静默跳过。
  if (members.some(unit => unit.branch !== "navy")) {
    fail("範囲に未対応の軍種が含まれているため、結算できません。");
  }

  const observationScene = {
    ...startScene,
    controls: {
  ...startScene.controls,

  // 仅内部规则查询使用攻击阵营视野。
  // 不修改正式自主开关，也不开放玩家操作权限。
  enemyAutonomy: false,
  observationSide: actor.side
}

  };

  assertIdentifiedTargets(observationScene, members);

  if (scope.kind === "single") {
    const singleTarget = members[0];

    if (
      actor.instanceId === singleTarget.instanceId ||
      actor.side === singleTarget.side
    ) {
      fail("自分自身または同一陣営への攻撃は結算できません。");
    }

    if (singleTarget.shipState.status === "sunk") {
      fail("段階開始時に沈没している目標は攻撃できません。");
    }
  }

  if (group.destroyed === true) {
  fail("段階開始時に完全破損している装備組は使用できません。");
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
  } else if (
    !orderMatch ||
    profile.maxOrder === null ||
    Number(orderMatch[1]) > profile.maxOrder
  ) {
    fail("この装備組は現在の次序で使用できません。");
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

  if (group.remainingAmmo < profile.fullAmmoCost) {
    fail(
      "完全投射には残弾が不足しています。" +
      "減量投射は未接続のため、結算を停止します。"
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

  const entry = {
    commandId: command.id,
    unitId: actor.instanceId,
    groupId: group.id,
    side: actor.side,
    profile: copy(profile),
    targetRef: copy(target.targetRef),
    specifiedTargetIds: [...target.specifiedTargetIds],
    scope: copy(scope),
    memberIds: [...memberIds],
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

  if (scope.kind === "single") {
    entry.targetId = target.targetRef.id;
  } else if (profile.guidance === "ray") {
    // 射线当前固定的是单位目标，不具有编队锁定契约。
    fail(
      "射線の編隊目標固定が未接続です。" +
      "範囲射線を単体射線として代用できません。"
    );
  }

  return entry;
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



    const startScene = getAttackPhaseStartScene(scene);

  // 用次序开始编队树检查，不能用当前列表临时补造。
  // 全批预检时执行，错误发生在扣弹与随机数之前。
  validateFormationTopology(startScene);

 const commands = scene.attackRuntime.commands
  .filter(command =>
    command.turnNumber === scene.turn.number &&
    command.phaseId === scene.turn.phaseId
  )
  .sort((a, b) =>
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
      group.damaged !== startGroup.damaged ||
      (group.destroyed === true) !== (startGroup.destroyed === true) ||
      JSON.stringify(group.ammoRegistration ?? null) !==
      JSON.stringify(startGroup.ammoRegistration ?? null)

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
export function prepareBatchHitChecks(
  scene,
  prepared,
  finalPreflight
) {
  if (typeof finalPreflight !== "function") {
    fail("正式な攻撃条件照合が未接続です。");
  }

  const expected = prepareAttackBatchResources(copy(scene));

  if (JSON.stringify(prepared) !== JSON.stringify(expected)) {
    fail("命中判定の批次と現在の攻撃計画が一致しません。");
  }

  const startScene = getAttackPhaseStartScene(copy(scene));
  const checks = [];

  for (const entry of expected.entries) {
    const observedStart = {
      ...copy(startScene),
      controls: {
      ...copy(startScene.controls),
      enemyAutonomy: false,
      observationSide: entry.side
      }

    };

    if (entry.scope.kind === "range") {
      const range = prepareRangeProjection({
        startScene: observedStart,
        commandId: entry.commandId,
        actorId: entry.unitId,
        targetRef: entry.targetRef,
        scope: entry.scope,
        projection: entry.projection,
        guidance: entry.profile.guidance,
        specifiedTargetIds: entry.specifiedTargetIds
      }, (memberScene, actor, target) => {
        const memberEntry = {
          ...copy(entry),
          targetId: target.instanceId
        };

        try {
          const result = finalPreflight(
            memberScene,
            memberEntry
          );

          const checked = validateHitPreflight(
            result,
            memberEntry
          );

          return {
            targetId: target.instanceId,
            allowed: true,
            bonuses: checked.bonuses,
            penalties: checked.penalties
          };
        } catch (error) {
          // 只有明确资格失败可排除。
          // 未实现、坏数据和算法错误继续整批抛出。
          if (error.code !== "TARGET_INELIGIBLE") {
            throw error;
          }

          return {
            targetId: target.instanceId,
            allowed: false,
            code: error.code,
            reason: error.message
          };
        }
      });

      checks.push({
        commandId: entry.commandId,
        kind: "range",
        range
      });

      continue;
    }

    const input = {
      startScene: observedStart,
      entry: copy(entry)
    };

    const before = JSON.stringify(input);
    const result = finalPreflight(input.startScene, input.entry);

    if (JSON.stringify(input) !== before) {
      fail("攻撃条件照合が入力状態を変更しました。");
    }

    const checked = validateHitPreflight(result, entry);

    // 单体参数也在整批随机前验证。
    resolveHitCoins({
      ...entry.projection,
      guidance: entry.profile.guidance,
      bonuses: checked.bonuses,
      penalties: checked.penalties
    }, () => false);

    checks.push({
      ...checked,
      kind: "single"
    });
  }

 // 单体命令的左右侧在随机前已经确定。
// 提前检查，供手动保存和自主选目标使用。
// 范围命令的实际侧向在目标选择后统一检查。
const singleEntries = expected.entries.filter(
  (_, index) => checks[index].kind === "single"
);

assertBroadsideQuotas(
  startScene,
  singleEntries,
  singleEntries.map(entry => ({
    commandId: entry.commandId,
    targetIds: [entry.targetId]
  })),
  scene.settlementRuntime?.attackRecords ?? []
);

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
  coinSource,
  indexSource
) {
  if (
    (coinSource !== undefined && typeof coinSource !== "function") ||
    (indexSource !== undefined && typeof indexSource !== "function")
  ) {
    fail("命中または範囲抽選の乱数関数が不正です。");
  }

  // 全部命令、全部成员先预检，再进行任何正式随机。
  const checked = prepareBatchHitChecks(
    scene,
    prepared,
    finalPreflight
  );

  const selections = new Map();

  // 先完成范围目标选择；保留每一次重复结果。
  for (const check of checked.checks) {
    if (check.kind !== "range") continue;

    const selected = indexSource === undefined
      ? selectRangeOccurrences(check.range)
      : selectRangeOccurrences(check.range, indexSource);

    selections.set(check.commandId, selected);
  }


 // 范围目标已经选择，但尚未掷正式命中硬币。
// 用真实投射出现项检查左右配额，不能用编队中心代替。
const firingAssignments = checked.prepared.entries.map(
  (entry, index) => {
    const check = checked.checks[index];

    if (check.kind === "single") {
      return {
        commandId: entry.commandId,
        targetIds: [entry.targetId]
      };
    }

    const selected = selections.get(entry.commandId);

    if (!Array.isArray(selected?.occurrences)) {
      fail("範囲射撃の対象記録が不足しています。");
    }

    return {
      commandId: entry.commandId,
      targetIds: selected.occurrences.map(
        occurrence => occurrence.targetId
      )
    };
  }
);

const firingReports = assertBroadsideQuotas(
  getAttackPhaseStartScene(copy(scene)),
  checked.prepared.entries,
  firingAssignments,
  scene.settlementRuntime?.attackRecords ?? []
);

  const reports = [];
  const rangeSelections = [];

  for (let index = 0; index < checked.prepared.entries.length; index++) {
    const entry = checked.prepared.entries[index];
    const check = checked.checks[index];

    if (check.kind === "range") {
      const selected = selections.get(entry.commandId);

      const rangeHit = resolveRangeProjectionHits(
        check.range,
        selected,
        coinSource
      );

      rangeSelections.push(copy(selected));

           const memberChecks = new Map(
        check.range.checks
          .filter(member => member.allowed)
          .map(member => [member.targetId, member])
      );

      for (const occurrence of rangeHit.reports) {
        const modifiers = memberChecks.get(
          occurrence.targetId
        );

        if (!modifiers) {
          fail("範囲命中の正式な修正記録が不足しています。");
        }

        reports.push({
          version: 1,
          commandId: entry.commandId,
          unitId: entry.unitId,
          groupId: entry.groupId,
          targetId: occurrence.targetId,
          occurrenceIndex: occurrence.occurrenceIndex,
          turnNumber: checked.prepared.turnNumber,
          phaseId: checked.prepared.phaseId,
          modifiers: {
            commandId: entry.commandId,
            bonuses: modifiers.bonuses,
            penalties: modifiers.penalties
          },
          hit: copy(occurrence.hit)
        });
      }


      continue;
    }

    const input = {
      ...entry.projection,
      guidance: entry.profile.guidance,
      bonuses: check.bonuses,
      penalties: check.penalties
    };

    reports.push({
      version: 1,
      commandId: entry.commandId,
      unitId: entry.unitId,
      groupId: entry.groupId,
      targetId: entry.targetId,
      occurrenceIndex: 0,
      turnNumber: checked.prepared.turnNumber,
      phaseId: checked.prepared.phaseId,
      modifiers: {
        commandId: entry.commandId,
        bonuses: check.bonuses,
        penalties: check.penalties
      },
      hit: copy(
        coinSource === undefined
          ? resolveHitCoins(input)
          : resolveHitCoins(input, coinSource)
      )
    });
  }

  return {
    version: 1,
    step: "attack-hit",
    turnNumber: checked.prepared.turnNumber,
    phaseId: checked.prepared.phaseId,
    firingReports,
    rangeSelections,
    reports
  };
}

/**
 * 只检查登记时的当前状态。
 * 改变的是预览副本的规则上下文，不创建阶段开始快照。
 * 不可用于正式扣弹、命中或结算。
 */
export function prepareAttackCommandPreview(scene, command) {
  initializeAttackRuntime(scene);

  const current = copy({
    terrain: scene.terrain,
    environment: scene.environment,
    controls: scene.controls,
    turn: scene.turn,
    instances: scene.instances,
    groups: scene.groups,
    rayTargetRuntime: scene.rayTargetRuntime
  });

  current.turn.phaseId = command.phaseId;

  validateFormationTopology(current);

  return {
    current,
    entry: prepareCommand(current, command)
  };
}



