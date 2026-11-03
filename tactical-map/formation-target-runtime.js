import {
  assertIdentifiedTargets
} from "./simulation-features.js";

const copy = value => JSON.parse(JSON.stringify(value));

function fail(message) {
  throw new Error(message);
}

function nonempty(value) {
  return typeof value === "string" && value.trim() !== "";
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 校验整个编队树。
 * 只读取输入，不补字段，不修改编队。
 * 空编队允许存在；悬空父节点、自引用和循环明确拒绝。
 */
export function validateFormationTopology(scene) {
  if (
    !scene ||
    !Array.isArray(scene.groups) ||
    !Array.isArray(scene.instances)
  ) {
    fail("編隊構成の保存形式が不正です。");
  }

  const groups = new Map();

  for (const group of scene.groups) {
    if (
      !group ||
      !nonempty(group.id) ||
      groups.has(group.id)
    ) {
      fail("編隊の識別番号が不正、または重複しています。");
    }

    if (
      group.parentId !== null &&
      group.parentId !== undefined &&
      !nonempty(group.parentId)
    ) {
      fail("親編隊の指定が不正です。");
    }

    groups.set(group.id, group);
  }

  for (const group of groups.values()) {
    if (
      group.parentId != null &&
      !groups.has(group.parentId)
    ) {
      fail("親編隊を確認できません。");
    }
  }

  // 0：未访问，1：当前祖先链，2：已完成。
  const colors = new Map();

  for (const id of groups.keys()) {
    if (colors.get(id) === 2) continue;

    const path = [];
    let current = id;

    while (current != null) {
      const color = colors.get(current) ?? 0;

      if (color === 1) {
        fail("編隊の親子関係に循環があります。");
      }

      if (color === 2) break;

      colors.set(current, 1);
      path.push(current);
      current = groups.get(current).parentId ?? null;
    }

    for (const visited of path) {
      colors.set(visited, 2);
    }
  }

  const unitIds = new Set();

  for (const unit of scene.instances) {
    if (
      !unit ||
      !nonempty(unit.instanceId) ||
      unitIds.has(unit.instanceId)
    ) {
      fail("編隊メンバーの識別番号が不正です。");
    }

    unitIds.add(unit.instanceId);

    if (
      unit.groupId != null &&
      !groups.has(unit.groupId)
    ) {
      fail("ユニットの所属編隊を確認できません。");
    }
  }
}

/**
 * 从传入的规则场景展开单位或编队。
 *
 * 正式结算必须传次序开始场景：
 * 不允许用受伤后的当前场景改变成员集合。
 *
 * 返回稳定排序的ID，不返回舰船内部状态。
 */
export function expandFormationMemberIds(scene, ref) {
  validateFormationTopology(scene);

  if (
    !ref ||
    !["unit", "group"].includes(ref.kind) ||
    !nonempty(ref.id)
  ) {
    fail("攻撃対象の指定が不正です。");
  }

  if (ref.kind === "unit") {
    if (!scene.instances.some(
      unit => unit.instanceId === ref.id
    )) {
      fail("攻撃対象を確認できません。");
    }

    return [ref.id];
  }

  if (!scene.groups.some(group => group.id === ref.id)) {
    fail("対象編隊を確認できません。");
  }

  const children = new Map();

  for (const group of scene.groups) {
    if (group.parentId == null) continue;

    if (!children.has(group.parentId)) {
      children.set(group.parentId, []);
    }

    children.get(group.parentId).push(group.id);
  }

  const descendants = new Set();
  const pending = [ref.id];

  while (pending.length) {
    const id = pending.pop();

    if (descendants.has(id)) continue;

    descendants.add(id);

    for (const childId of children.get(id) ?? []) {
      pending.push(childId);
    }
  }

  const ids = scene.instances
    .filter(unit => descendants.has(unit.groupId))
    .map(unit => unit.instanceId)
    .sort(compareText);

  if (ids.length === 0) {
    fail("対象編隊にメンバーがいません。");
  }

  return ids;
}

/**
 * 明确指定的整个目标集合进行逐成员预检。
 *
 * 不随机选择，不分配投射，不掷命中硬币。
 * 不默认忽略未识别、同阵营或不支持的成员。
 *
 * checkMember必须为真实单目标规则检查，
 * 不能使用始终返回allowed的占位函数。
 */
export function preflightFormationMembers(
  startScene,
  actorId,
  targetRef,
  checkMember
) {
  if (typeof checkMember !== "function") {
    fail("編隊メンバーの正式な攻撃条件照合が未接続です。");
  }

  const scene = copy(startScene);
  const actor = scene.instances.find(
    unit => unit.instanceId === actorId
  );

  if (!actor) {
    fail("攻撃主体を確認できません。");
  }

  const memberIds = expandFormationMemberIds(
    scene,
    targetRef
  );

  const targets = memberIds.map(id =>
    scene.instances.find(unit => unit.instanceId === id)
  );

  const observationScene = {
    ...scene,
    controls: {
      ...scene.controls,
      observationSide: actor.side
    }
  };

  // 整个指定集合先检查识别权限。
  // 不通过过滤隐藏单位而静默改变范围。
  assertIdentifiedTargets(observationScene, targets);

  const checks = [];

  for (const target of targets) {
    if (
      target.instanceId === actor.instanceId ||
      target.side === actor.side
    ) {
      fail("対象集合に自艦または同一陣営が含まれています。");
    }

    const input = {
      scene: copy(observationScene),
      actor: copy(actor),
      target: copy(target)
    };

    const before = JSON.stringify(input);

    const result = checkMember(
      input.scene,
      input.actor,
      input.target
    );

    if (JSON.stringify(input) !== before) {
      fail("編隊の条件照合が入力状態を変更しました。");
    }

    if (
      !result ||
      result.allowed !== true ||
      result.targetId !== target.instanceId ||
      typeof result.then === "function"
    ) {
      fail("編隊メンバーの攻撃条件が確定していません。");
    }

    checks.push(copy(result));
  }

  return {
    version: 1,
    actorId,
    targetRef: copy(targetRef),
    memberIds,
    checks
  };
}
