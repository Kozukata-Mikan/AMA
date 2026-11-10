import { TRAINING_TRAIT_OPTIONS } from "../js/catalog-seed.js";

// ===== 推演装备与词条运行状态 =====
// 不修改图鉴快照，不消耗弹药，不执行攻击。
// 多组装备按安装记录顺序展开，每组独立保存状态。

const TRAIT_IDS = new Set(
  TRAINING_TRAIT_OPTIONS.map(item => item.id)
);

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function readAmmo(value) {
  if (value === undefined || value === null) return null;

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("装備の予備弾数が不正です。");
  }

  return value;
}

// 原始 initialAmmo 始终保留部署快照中的值。
// 补录只保存于独立运行字段 ammoRegistration。
export function readEffectiveInitialAmmo(group) {
  const initial = readAmmo(group.initialAmmo);
  const registration = group.ammoRegistration;

  if (registration === undefined) return initial;

  if (
    initial !== null ||
    !isObject(registration) ||
    registration.version !== 1 ||
    !Number.isSafeInteger(registration.ammo) ||
    registration.ammo < 0 ||
    !Number.isSafeInteger(registration.turnNumber) ||
    registration.turnNumber < 1 ||
    typeof registration.phaseId !== "string" ||
    !registration.phaseId.trim() ||
    !Number.isSafeInteger(registration.revisionBefore) ||
    registration.revisionBefore < 0 ||
    typeof registration.registeredAt !== "string" ||
    !Number.isFinite(Date.parse(registration.registeredAt)) ||
    typeof registration.note !== "string" ||
    !registration.note.trim()
  ) {
    throw new Error("装備組の弾薬補完記録が不正です。");
  }

  return registration.ammo;
}


function readTraits(value, label) {
  if (value === undefined) return [];

  if (
    !Array.isArray(value) ||
    value.some(id =>
      typeof id !== "string" || !TRAIT_IDS.has(id)
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(`${label}の保存状態が不正です。`);
  }

  return [...value];
}

function readEquipmentLayout(unit) {
  if (!isObject(unit.snapshot)) {
    throw new Error("図鑑スナップショットがありません。");
  }

  const mounts = unit.snapshot.mounts ?? [];
  const equipment = unit.snapshot.equipmentSnapshots ?? [];

  if (!Array.isArray(mounts) || !Array.isArray(equipment)) {
    throw new Error("装備スナップショットの書式が不正です。");
  }

  const equipmentMap = new Map();

  for (const item of equipment) {
    if (
      !isObject(item) ||
      typeof item.id !== "string" ||
      !item.id.trim() ||
      equipmentMap.has(item.id)
    ) {
      throw new Error("装備スナップショットの識別番号が不正です。");
    }

    equipmentMap.set(item.id, item);
  }

  const groups = [];
  const unresolvedMountIndexes = [];

  mounts.forEach((mount, mountIndex) => {
    if (
      !isObject(mount) ||
      typeof mount.equipmentId !== "string" ||
      !mount.equipmentId.trim() ||
      typeof mount.position !== "string" ||
      !mount.position.trim()
    ) {
      throw new Error("装備配置のスナップショットが不正です。");
    }

    // 组数未登记时不猜数量，也不生成虚构装备。
    if (mount.count === null || mount.count === undefined) {
      unresolvedMountIndexes.push(mountIndex);
      return;
    }

    if (!Number.isSafeInteger(mount.count) || mount.count < 1) {
      throw new Error("装備組数のスナップショットが不正です。");
    }

    const profile = equipmentMap.get(mount.equipmentId);
    const initialAmmo = readAmmo(profile?.ammo);

    for (let groupIndex = 0; groupIndex < mount.count; groupIndex++) {
      groups.push({
        id: `mount-${mountIndex}-group-${groupIndex}`,
        mountIndex,
        groupIndex,
        position: mount.position,
        equipmentId: mount.equipmentId,

        // 性能只从冻结快照读取，不回查当前图鉴。
        profileAvailable: profile !== undefined,
        initialAmmo
      });
    }
  });

  return { groups, unresolvedMountIndexes };
}

export function ensureEquipmentRuntime(unit) {
  const layout = readEquipmentLayout(unit);

  if (unit.equipmentState === undefined) {
    unit.equipmentState = {
      version: 1,
      unresolvedMountIndexes: [...layout.unresolvedMountIndexes],
      groups: layout.groups.map(group => ({
        ...group,
        remainingAmmo: group.initialAmmo,
        lastUsedTurn: null,
        damaged: false,
        destroyed: false
      }))
    };
  }

  const state = unit.equipmentState;

  if (
    !isObject(state) ||
    state.version !== 1 ||
    !Array.isArray(state.groups) ||
    state.groups.length !== layout.groups.length ||
    JSON.stringify(state.unresolvedMountIndexes) !==
      JSON.stringify(layout.unresolvedMountIndexes)
  ) {
    throw new Error("装備の推演状態がスナップショットと一致しません。");
  }

  const savedGroups = new Map();

  for (const group of state.groups) {
    if (
      !isObject(group) ||
      typeof group.id !== "string" ||
      savedGroups.has(group.id)
    ) {
      throw new Error("装備組の保存状態が不正です。");
    }

    savedGroups.set(group.id, group);
  }

  for (const expected of layout.groups) {
    const group = savedGroups.get(expected.id);

    if (
      !group ||
      group.mountIndex !== expected.mountIndex ||
      group.groupIndex !== expected.groupIndex ||
      group.position !== expected.position ||
      group.equipmentId !== expected.equipmentId ||
      group.profileAvailable !== expected.profileAvailable ||
      group.initialAmmo !== expected.initialAmmo
    ) {
      throw new Error("装備組の保存状態がスナップショットと一致しません。");
    }

   const effectiveInitialAmmo = readEffectiveInitialAmmo(group);
  const remainingAmmo = readAmmo(group.remainingAmmo);

  if (
  group.remainingAmmo === undefined ||
  (
    effectiveInitialAmmo === null
      ? remainingAmmo !== null
      : remainingAmmo === null ||
        remainingAmmo > effectiveInitialAmmo
  )
) {
  throw new Error("装備組の残弾数が不正です。");
}


    if (
      group.lastUsedTurn !== null &&
      (
        !Number.isSafeInteger(group.lastUsedTurn) ||
        group.lastUsedTurn < 1
      )
    ) {
      throw new Error("装備組の使用ラウンドが不正です。");
    }

        if (typeof group.damaged !== "boolean") {
      throw new Error("装備組の損傷状態が不正です。");
    }

    // 旧存档没有记录彻底损坏时，仅补false。
    // 不凭已有damaged猜测损坏历史。
    if (group.destroyed === undefined) {
      group.destroyed = false;
    }

    if (
      typeof group.destroyed !== "boolean" ||
      (group.destroyed && !group.damaged)
    ) {
      throw new Error("装備組の完全破損状態が不正です。");
    }
  }
}

export function ensureTrainingRuntime(unit) {
  const baseTraits = readTraits(
    unit.snapshot?.trainingTraits,
    "図鑑の特殊能力"
  );

  if (unit.trainingState === undefined) {
    unit.trainingState = {
      version: 1,
      baseTraits: copy(baseTraits),

      // 战斗中获得的词条独立保存，绝不回写图鉴快照。
      acquiredTraits: []
    };
  }

  const state = unit.trainingState;

  if (!isObject(state) || state.version !== 1) {
    throw new Error("練度・特殊能力の推演状態が不正です。");
  }

  const savedBase = readTraits(state.baseTraits, "初期特殊能力");
  readTraits(state.acquiredTraits, "獲得特殊能力");

  if (
    !Array.isArray(state.baseTraits) ||
    !Array.isArray(state.acquiredTraits) ||
    JSON.stringify(savedBase) !== JSON.stringify(baseTraits)
  ) {
    throw new Error("初期特殊能力がスナップショットと一致しません。");
  }
}

export function ensureUnitCombatRuntime(unit) {
  ensureEquipmentRuntime(unit);
  ensureTrainingRuntime(unit);
}
/**
 * 应用已经由正式设备分配算法生成的装备组损坏结果。
 *
 * assignments:
 * [
 *   {
 *     groupId: "mount-0-group-0",
 *     outcome: "damaged" // 或 "destroyed"
 *   }
 * ]
 *
 * 必须在正式保存事务的工作副本上调用。
 * 不允许页面请求直接充当正式分配结果。
 *
 * 本函数不决定：
 * - 命中位置和损坏数量；
 * - 重复命中的分配规则；
 * - 何时产生彻底损坏；
 * - 侦察项和空槽的处理。
 *
 * 同一组可以在列表中重复出现，逐项保留报告。
 * 是否允许这种分配，由上游正式规则算法决定。
 */
export function applyEquipmentDamageAssignments(
  unit,
  assignments
) {
  if (
    !isObject(unit) ||
    !Array.isArray(assignments)
  ) {
    throw new Error("装備損傷の適用データが不正です。");
  }

  // 使用单位副本，避免初始化或中途错误修改原单位。
  const working = copy(unit);
  ensureEquipmentRuntime(working);

  const groups = new Map(
    working.equipmentState.groups.map(
      group => [group.id, group]
    )
  );

  // 先检查全部输入，再进行状态应用。
  for (const assignment of assignments) {
    if (
      !isObject(assignment) ||
      typeof assignment.groupId !== "string" ||
      !assignment.groupId.trim() ||
      !["damaged", "destroyed"].includes(
        assignment.outcome
      ) ||
      !groups.has(assignment.groupId)
    ) {
      throw new Error("装備損傷の割当結果が不正です。");
    }
  }

  const results = [];

  for (
    let assignmentIndex = 0;
    assignmentIndex < assignments.length;
    assignmentIndex++
  ) {
    const assignment = assignments[assignmentIndex];
    const group = groups.get(assignment.groupId);

    const before = {
      damaged: group.damaged,
      destroyed: group.destroyed
    };

    group.damaged = true;

    // 不允许一次普通损坏覆盖既有的彻底损坏。
    // 是否应彻底损坏必须由上游明确提供，不能在这里猜测。
    if (assignment.outcome === "destroyed") {
      group.destroyed = true;
    }

    const after = {
      damaged: group.damaged,
      destroyed: group.destroyed
    };

    results.push({
      assignmentIndex,
      groupId: group.id,
      equipmentId: group.equipmentId,
      position: group.position,
      outcome: assignment.outcome,
      before,
      after,
      changed:
        before.damaged !== after.damaged ||
        before.destroyed !== after.destroyed
    });
  }

  ensureEquipmentRuntime(working);

  // 只写装备运行状态。
  // 不修改耐性、弹药、使用记录、图鉴快照或初始场景。
  unit.equipmentState = copy(working.equipmentState);

  return {
    version: 1,
    kind: "equipment-damage",
    assignmentCount: assignments.length,
    changedGroupCount: new Set(
      results
        .filter(result => result.changed)
        .map(result => result.groupId)
    ).size,
    results
  };
}

/**
 * 创建新推演前，补齐输入副本中缺失的装备备弹。
 *
 * catalogUnits：main.js 中共享的图鉴单位数组。
 * 不修改传入场景、部署快照、图鉴或已有推演。
 * 不猜弹药；图鉴缺值或存在冲突时明确拒绝。
 */
export function prepareSimulationAmmoSource(
  source,
  catalogUnits
) {
  if (
    !isObject(source) ||
    !Array.isArray(source.instances) ||
    !Array.isArray(catalogUnits)
  ) {
    throw new Error("推演開始用の装備資料が不正です。");
  }

  const registeredAmmo = new Map();

  for (const unit of catalogUnits) {
    const equipment = unit.equipmentSnapshots ?? [];

    if (!Array.isArray(equipment)) {
      throw new Error("図鑑の装備資料が不正です。");
    }

    for (const item of equipment) {
      if (
        !isObject(item) ||
        typeof item.id !== "string" ||
        !item.id.trim()
      ) {
        throw new Error("図鑑の装備IDが不正です。");
      }

      if (item.kind !== "weapon") continue;

      const ammo = readAmmo(item.ammo);

      // 未登记不是0，也不覆盖其他单位中的有效登记。
      if (ammo === null) continue;

      if (
        registeredAmmo.has(item.id) &&
        registeredAmmo.get(item.id) !== ammo
      ) {
        throw new Error(
          "図鑑内で同一装備の予備弾数が一致しません。"
        );
      }

      registeredAmmo.set(item.id, ammo);
    }
  }

  const working = copy(source);

  for (const unit of working.instances) {
    // 不能拿运行中的推演当成新部署资料进行补齐。
    if (unit.equipmentState !== undefined) {
      throw new Error(
        "戦闘中の保存状態から初期弾薬を変更できません。"
      );
    }

    if (
      !isObject(unit.snapshot) ||
      !Array.isArray(unit.snapshot.equipmentSnapshots)
    ) {
      throw new Error(
        "配置された部隊の装備スナップショットがありません。"
      );
    }

    const equipment = new Map();

    for (const item of unit.snapshot.equipmentSnapshots) {
      if (
        !isObject(item) ||
        typeof item.id !== "string" ||
        !item.id.trim() ||
        equipment.has(item.id)
      ) {
        throw new Error(
          "配置された装備の識別情報が不正です。"
        );
      }

      equipment.set(item.id, item);
    }

    const mounts = unit.snapshot.mounts ?? [];

    if (!Array.isArray(mounts)) {
      throw new Error("装備配置の書式が不正です。");
    }

    for (const mount of mounts) {
      const item = equipment.get(mount?.equipmentId);

      if (!item) {
        throw new Error(
          "配置された装備の性能資料がありません。"
        );
      }

      if (item.kind !== "weapon") continue;

      // 已有初始登记保持原样，0也必须保留。
      if (readAmmo(item.ammo) !== null) continue;

      if (!registeredAmmo.has(item.id)) {
        throw new Error(
          "図鑑の予備弾数が未登録のため、" +
          "推演を開始できません。"
        );
      }

      item.ammo = registeredAmmo.get(item.id);
    }
  }

  return working;
}

