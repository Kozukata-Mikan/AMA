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
        damaged: false
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

    const remainingAmmo = readAmmo(group.remainingAmmo);

    if (
      group.remainingAmmo === undefined ||
      (
        group.initialAmmo === null
          ? remainingAmmo !== null
          : remainingAmmo === null ||
            remainingAmmo > group.initialAmmo
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
