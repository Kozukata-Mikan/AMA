// 纯计算模块：不读取或保存存档，不直接修改舰船。
// 所有随机结果由原批次事务提供。
// 不另行定义R的概率，也不建立第二套持久化状态。

function fail(message) {
  throw new Error(message);
}

function requireId(value, label) {
  if (
    typeof value !== "string" ||
    value.trim() === ""
  ) {
    fail(`${label}が不正です。`);
  }

  return value;
}

function requireInteger(value, minimum, label) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    fail(`${label}が不正です。`);
  }

  return value;
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") {
    fail(`${label}の判定結果が不足しています。`);
  }

  return value;
}

function requireLevel(value, label) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 4
  ) {
    fail(`${label}の状態が不正です。`);
  }

  return value;
}

function readSlots(slots) {
  if (!Array.isArray(slots)) {
    fail("設備位置の開始記録が不足しています。");
  }

  const result = new Map();

  for (const slot of slots) {
    if (!slot || typeof slot !== "object") {
      fail("設備位置の開始記録が不正です。");
    }

    const id = requireId(slot.id, "設備位置ID");

    if (
      result.has(id) ||
      typeof slot.damaged !== "boolean" ||
      typeof slot.destroyed !== "boolean"
    ) {
      fail("設備位置の状態が不正です。");
    }

    if (slot.damaged && slot.destroyed) {
      fail("修理可能な損傷と完全破損が重複しています。");
    }

    result.set(id, {
      id,
      damaged: slot.damaged,
      destroyed: slot.destroyed
    });
  }

  return result;
}

/**
 * 设备威力计划。
 *
 * slots：
 *   原运行时提供的设备位置快照。
 *   id必须是稳定的位置ID，不能用装备名称代替。
 *
 * hits：
 *   每次实际命中的设备目标分配记录：
 *   { occurrenceId, power, targetSlotIds }
 *
 * 本函数不猜测设备命中的分配方法。
 * 每次命中必须提供与威力相同数量的设备位置；
 * 同一次命中不重复位置，不同命中可再次命中同一位置。
 */
export function planEquipmentDamage({
  slots,
  hits
}) {
  const slotMap = readSlots(slots);

  if (!Array.isArray(hits)) {
    fail("設備攻撃の命中記録が不足しています。");
  }

  const occurrenceIds = new Set();
  const newlyDamaged = new Set();
  const reports = [];

  for (const hit of hits) {
    if (!hit || typeof hit !== "object") {
      fail("設備攻撃の命中記録が不正です。");
    }

    const occurrenceId = requireId(
      hit.occurrenceId,
      "設備命中ID"
    );

    if (occurrenceIds.has(occurrenceId)) {
      fail("設備命中IDが重複しています。");
    }

    occurrenceIds.add(occurrenceId);

    const power = requireInteger(
      hit.power,
      1,
      "設備威力"
    );

    if (
      !Array.isArray(hit.targetSlotIds) ||
      hit.targetSlotIds.length !== power ||
      new Set(hit.targetSlotIds).size !== power
    ) {
      fail("設備威力と損傷対象の数が一致しません。");
    }

    const targets = [];

    for (const id of hit.targetSlotIds) {
      requireId(id, "設備損傷対象ID");

      const slot = slotMap.get(id);

      if (!slot || slot.destroyed) {
        fail("設備損傷の対象位置が不正です。");
      }

      const alreadyDamaged =
        slot.damaged || newlyDamaged.has(id);

      if (!alreadyDamaged) {
        newlyDamaged.add(id);
      }

      targets.push({
        slotId: id,
        newlyDamaged: !alreadyDamaged
      });
    }

    reports.push({
      occurrenceId,
      power,
      targets
    });
  }

  return {
    kind: "equipment-damage",
    hpLoss: 0,
    newlyDamagedSlotIds: [...newlyDamaged],
    reports
  };
}

/**
 * 特殊阶段损管计划。
 *
 * fireLevel / floodingLevel：
 *   0：没有状态
 *   1：小火 / 轻度进水
 *   2：中火 / 中度进水
 *   3：大火 / 重度进水
 *   4：失控
 *
 * checks：
 *   使用原R算法得到的成功布尔值。
 *   有该状态才允许且必须提供对应判定。
 *
 * repairIndex：
 *   设备损管成功后，原随机算法从
 *   repairableSlotIds中抽出的下标。
 */
export function planSpecialDamageControl({
  fireLevel,
  floodingLevel,
  maximumMovement,
  slots,
  checks,
  repairIndex
}) {
  requireLevel(fireLevel, "火災");
  requireLevel(floodingLevel, "浸水");

  if (
    typeof maximumMovement !== "number" ||
    !Number.isFinite(maximumMovement) ||
    maximumMovement < 0
  ) {
    fail("最高速力による移動力が不正です。");
  }

  const slotMap = readSlots(slots);

  if (!checks || typeof checks !== "object") {
    fail("損傷管制の判定記録が不足しています。");
  }

  const allowedKeys = new Set([
    "fire",
    "flooding",
    "equipment"
  ]);

  if (
    Object.keys(checks).some(key => !allowedKeys.has(key))
  ) {
    fail("未知の損傷管制判定があります。");
  }

  const repairableSlotIds = [...slotMap.values()]
    .filter(slot => slot.damaged && !slot.destroyed)
    .map(slot => slot.id);

  const hasFire = fireLevel > 0;
  const hasFlooding = floodingLevel > 0;
  const hasEquipmentDamage = repairableSlotIds.length > 0;

  // 失控发生时即应进入濒临沉没。
  // 不让后续损管在这里擅自撤销原救助状态。
  if (fireLevel === 4 || floodingLevel === 4) {
    fail(
      "制御不能状態は既に瀕死処理へ移行している必要があります。" +
      "通常の損傷管制として再処理できません。"
    );
  }

  for (const [key, active] of [
    ["fire", hasFire],
    ["flooding", hasFlooding],
    ["equipment", hasEquipmentDamage]
  ]) {
    if (active) {
      requireBoolean(checks[key], key);
    } else if (checks[key] !== undefined) {
      fail("存在しない状態に損傷管制判定があります。");
    }
  }

  let nextFireLevel = fireLevel;
  let nextFloodingLevel = floodingLevel;
  let hpLoss = 0;
  let movementLoss = 0;
  let repairedSlotId = null;

  const reports = [];

  if (hasFire) {
    if (checks.fire) {
      nextFireLevel = 0;
    } else {
      hpLoss = 1;
      nextFireLevel = fireLevel + 1;
    }

    reports.push({
      kind: "fire",
      success: checks.fire,
      previousLevel: fireLevel,
      nextLevel: nextFireLevel,
      hpLoss
    });
  }

  if (hasFlooding) {
    if (checks.flooding) {
      nextFloodingLevel = 0;
    } else {
      // 基数始终是最高航速，不是当前移动力。
      movementLoss = maximumMovement * 0.25;
      nextFloodingLevel = floodingLevel + 1;
    }

    reports.push({
      kind: "flooding",
      success: checks.flooding,
      previousLevel: floodingLevel,
      nextLevel: nextFloodingLevel,
      movementLoss
    });
  }

  if (hasEquipmentDamage) {
    if (checks.equipment) {
      requireInteger(
        repairIndex,
        0,
        "設備修理の抽選位置"
      );

      if (repairIndex >= repairableSlotIds.length) {
        fail("設備修理の抽選位置が範囲外です。");
      }

      repairedSlotId = repairableSlotIds[repairIndex];
    } else if (repairIndex !== undefined) {
      fail("修理失敗時に修理対象の抽選があります。");
    }

    reports.push({
      kind: "equipment",
      success: checks.equipment,
      repairedSlotId
    });
  } else if (repairIndex !== undefined) {
    fail("損傷設備がないのに修理対象の抽選があります。");
  }

  return {
    kind: "special-damage-control",
    nextFireLevel,
    nextFloodingLevel,
    hpLoss,
    movementLoss,
    repairedSlotId,
    enterCritical:
      nextFireLevel === 4 ||
      nextFloodingLevel === 4,
    reports
  };
}

/**
 * 地图词条可见性。
 * ownerDetailsVisible必须由原观察权限入口决定，
 * 不能仅依据“已侦察到”设置为true。
 */
export function getSpecialTermMarkers({
  fireLevel,
  floodingLevel,
  hasEquipmentDamage,
  unitVisible,
  ownerDetailsVisible
}) {
  requireLevel(fireLevel, "火災");
  requireLevel(floodingLevel, "浸水");
  requireBoolean(hasEquipmentDamage, "設備損傷");
  requireBoolean(unitVisible, "ユニット表示権限");
  requireBoolean(ownerDetailsVisible, "内部情報表示権限");

  if (!unitVisible) return [];

  const markers = [];

  if (fireLevel > 0) {
    markers.push({
      kind: "fire",
      symbol: "🔥",
      label: "火災"
    });
  }

  if (ownerDetailsVisible && floodingLevel > 0) {
    markers.push({
      kind: "flooding",
      symbol: "💧",
      label: "浸水"
    });
  }

  if (ownerDetailsVisible && hasEquipmentDamage) {
    markers.push({
      kind: "equipment-damage",
      symbol: "🔧",
      label: "設備損傷"
    });
  }

  return markers;
}
