const EPSILON = 1e-7;
const copy = value => JSON.parse(JSON.stringify(value));

function fail(message, code) {
  const error = new Error(message);
  if (code) error.code = code;
  throw error;
}

function unitFor(scene, id) {
  const unit = scene.instances.find(
    item => item.instanceId === id
  );

  if (!unit) fail("射界のユニットを確認できません。");
  return unit;
}

function groupFor(unit, id) {
  const group = unit.equipmentState.groups.find(
    item => item.id === id
  );

  if (!group) fail("射界の装備組を確認できません。");
  return group;
}

function positionKind(value) {
  const key = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, "");

  const aliases = {
    front: "front",
    bow: "front",
    前部: "front",

    middle1: "middle",
    middle2: "middle",
    mid1: "middle",
    mid2: "middle",
    center1: "middle",
    center2: "middle",
    中部1: "middle",
    中部2: "middle",
    中部１: "middle",
    中部２: "middle",

    sides: "sides",
    side: "sides",
    broadside: "sides",
    両舷: "sides",
    两舷: "sides",

    rear: "rear",
    aft: "rear",
    後部: "rear",
    后部: "rear",

    tail: "tail",
    stern: "tail",
    尾部: "tail"
  };

  const kind = aliases[key];

  if (!kind) {
    fail(
      "装備位置の射界定義を確認できません：" +
      String(value)
    );
  }

  return kind;
}

/**
 * 与projectIconPoint使用相同地图旋转：
 * 舰首向量 = (sin heading, -cos heading)
 * 右舷向量 = (cos heading, sin heading)
 */
export function readFiringArc(actor, group, target) {
  const heading = Number(actor.heading);

  if (
    actor.heading === null ||
    actor.heading === undefined ||
    actor.heading === "" ||
    !Number.isFinite(heading) ||
    !Number.isFinite(actor.x) ||
    !Number.isFinite(actor.y) ||
    !Number.isFinite(target.x) ||
    !Number.isFinite(target.y)
  ) {
    fail("射界の位置または艦首方向が不正です。");
  }

  const dx = target.x - actor.x;
  const dy = target.y - actor.y;

  if (Math.hypot(dx, dy) <= EPSILON) {
    fail(
      "同一座標の目標は射界方向を確定できません。",
      "TARGET_INELIGIBLE"
    );
  }

  const radians = heading * Math.PI / 180;
  const forward =
    dx * Math.sin(radians) - dy * Math.cos(radians);

  const right =
    dx * Math.cos(radians) + dy * Math.sin(radians);

  // 正値は右舷、負値は左舷。範囲は-180～180度。
  const relativeDegrees =
    Math.atan2(right, forward) * 180 / Math.PI;

  const kind = positionKind(group.position);
  const bowAngle = Math.abs(relativeDegrees);
  const sternAngle = 180 - bowAngle;

  const allowed =
    kind === "middle" ||
    kind === "sides" ||
    (kind === "front" && bowAngle <= 120 + EPSILON) ||
    (kind === "rear" && sternAngle <= 120 + EPSILON) ||
    (kind === "tail" && sternAngle <= 90 + EPSILON);

  if (!allowed) {
    fail(
      "目標がこの装備位置の射界外です。",
      "TARGET_INELIGIBLE"
    );
  }

  // 正前方・正後方の境界線は右舷へ固定。
  // プレイヤーもAIも同じ扱い。
  const side = Math.abs(right) <= EPSILON || right > 0
    ? "right"
    : "left";

  return {
    positionKind: kind,
    relativeDegrees,
    side
  };
}

/**
 * assignments:
 * [{ commandId, targetIds }]
 *
 * targetIdsは実際の投射対象。
 * 同じ対象への複数出現は、配額では重複計上しない。
 *
 * 返却値:
 * [{ commandId, firingSides: [] | ["left"] | ... }]
 */
export function assertBroadsideQuotas(
  start,
  entries,
  assignments,
  records = []
) {
  const counts = new Map();
  const usedGroups = new Set();

  function add(actor, group, sides) {
    if (positionKind(group.position) !== "sides") {
      if (sides.length) {
        fail("両舷以外の装備に側別使用記録があります。");
      }
      return;
    }

    if (
      !Number.isSafeInteger(group.mountIndex) ||
      group.mountIndex < 0 ||
      !Array.isArray(sides) ||
      sides.length < 1 ||
      sides.length > 2 ||
      sides.some(side => !["left", "right"].includes(side)) ||
      new Set(sides).size !== sides.length
    ) {
      fail("両舷装備の側別使用記録が不正です。");
    }

    const usedKey = JSON.stringify([
      actor.instanceId,
      group.id
    ]);

    if (usedGroups.has(usedKey)) {
      fail("同じ両舷装備組の使用記録が重複しています。");
    }

    usedGroups.add(usedKey);

    const key = JSON.stringify([
      actor.instanceId,
      group.mountIndex
    ]);

    let count = counts.get(key);

    if (!count) {
      const mounted = actor.equipmentState.groups.filter(
        item => item.mountIndex === group.mountIndex
      );

      if (
        !mounted.length ||
        mounted.some(item =>
          positionKind(item.position) !== "sides"
        )
      ) {
        fail("両舷装備の配置構成が不正です。");
      }

      // 损坏和已使用装备仍属于原安装组数，
      // 不因运行损伤重算左右基础名额。
      count = {
        total: mounted.length,
        left: 0,
        right: 0
      };

      counts.set(key, count);
    }

    for (const side of sides) count[side] += 1;
  }

  // 本回合之前次序的实际发射记录。
  for (const record of records) {
    if (record.turnNumber !== start.turn.number) continue;

    for (const report of record.resourceReports) {
      const actor = unitFor(start, report.unitId);
      const group = groupFor(actor, report.groupId);

      if (positionKind(group.position) !== "sides") continue;

      if (report.firingSides === undefined) {
        fail(
          "このラウンドの旧両舷攻撃に側別記録がありません。" +
          "過去の射撃方向を推測せず、結算を停止します。"
        );
      }

      add(actor, group, report.firingSides);
    }
  }

  const byCommand = new Map();

  for (const assignment of assignments) {
    if (
      !assignment ||
      byCommand.has(assignment.commandId) ||
      !Array.isArray(assignment.targetIds) ||
      !assignment.targetIds.length
    ) {
      fail("射界の投射対象記録が不正です。");
    }

    byCommand.set(assignment.commandId, assignment.targetIds);
  }

  const result = [];

  for (const entry of entries) {
    const actor = unitFor(start, entry.unitId);
    const group = groupFor(actor, entry.groupId);
    const targetIds = byCommand.get(entry.commandId);

    if (!targetIds) {
      fail("射界の投射対象記録が不足しています。");
    }

    const sides = new Set();

    for (const id of new Set(targetIds)) {
      const arc = readFiringArc(
        actor,
        group,
        unitFor(start, id)
      );

      if (arc.positionKind === "sides") {
        sides.add(arc.side);
      }
    }

    const firingSides = [...sides].sort();

    add(actor, group, firingSides);

    result.push({
      commandId: entry.commandId,
      firingSides
    });
  }

  for (const count of counts.values()) {
    const base = Math.floor(count.total / 2);
    const extra = count.total % 2;

    const extraUsed =
      Math.max(0, count.left - base) +
      Math.max(0, count.right - base);

    if (extraUsed > extra) {
      fail(
        "このラウンドの両舷装備の側別使用上限を超えています。",
        "BROADSIDE_QUOTA"
      );
    }
  }

  return copy(result);
}
