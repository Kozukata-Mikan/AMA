import {
  readWeaponProfile,
  readWeaponTargetScope
} from "./weapon-profile-runtime.js";

import {
  replaceAttackCommands
} from "./simulation-attack-runtime.js";

import {
  filterUnreachableAttackCommands
} from "./simulation-settlement.js";

import {
  assertManualControl,
  assertIdentifiedTargets
} from "./simulation-features.js";

// ===== 分旗舰攻击追随 =====
// 只在store的候选事务内调用。
// 不扣弹、不投币、不造成伤害、不推进阶段。
// 首版仅登记scope.kind === "single"的武器。

function fail(message) {
  throw new Error(message);
}

function groupLabel(group, profile) {
  return (
    `${group.position} / ${profile?.label ?? "装備組"}` +
    ` / 第${group.groupIndex + 1}組`
  );
}

export function appendFormationAttackFollowers(
  scene,
  { leaderId, targetId },
  createId
) {
  const leader = scene.instances.find(
    unit => unit.instanceId === leaderId
  );

  if (
    !leader ||
    leader.branch !== "navy" ||
    leader.isFormationFlagship !== true ||
    !scene.groups.some(group => group.id === leader.groupId)
  ) {
    fail("攻撃追随を指示できるのは所属編隊の分旗艦のみです。");
  }

  assertManualControl(scene, [leader]);

  const target = scene.instances.find(
    unit => unit.instanceId === targetId
  );

  if (!target) {
    fail("追随攻撃の目標を確認できません。");
  }

  assertIdentifiedTargets(scene, [target]);

  if (
    target.branch !== "navy" ||
    target.side === leader.side ||
    target.shipState?.status === "sunk"
  ) {
    fail("追随攻撃には別陣営の未沈没艦を指定してください。");
  }

  const baselineIds = scene.attackRuntime.commands.map(
    command => command.id
  );

  const newIds = new Set();
  const labels = new Map();
  const skipped = [];

  // 实例保存顺序；不按地图位置重新排序。
  const followers = scene.instances.filter(unit =>
    unit.instanceId !== leader.instanceId &&
    unit.groupId === leader.groupId &&
    unit.side === leader.side &&
    unit.branch === "navy"
  );

  function skip(unit, group, profile, reason) {
    skipped.push({
      unitId: unit.instanceId,
      unitName: unit.name,
      groupId: group?.id ?? null,
      groupLabel: group ? groupLabel(group, profile) : "艦船",
      reason
    });
  }

  for (const unit of followers) {
    assertManualControl(scene, [unit]);

    if (
      !Number.isFinite(unit.x) ||
      !Number.isFinite(unit.y) ||
      ["sinking", "sunk"].includes(unit.shipState?.status) ||
      unit.shipState?.rescueTaskId !== null
    ) {
      skip(
        unit,
        null,
        null,
        "行動不能・未配置または任務中のため追随しません。"
      );
      continue;
    }

    const sources = unit.snapshot?.equipmentSnapshots;

    if (
      !Array.isArray(sources) ||
      !Array.isArray(unit.equipmentState?.groups)
    ) {
      fail("追随艦の装備資料または装備組の保存形式が不正です。");
    }

    const occupied = new Set(
      scene.attackRuntime.commands
        .filter(command => command.unitId === unit.instanceId)
        .map(command => command.groupId)
    );

    const requests = [];

    for (const group of unit.equipmentState.groups) {
      // 手动或此前已保存的任务优先，完全不替换。
      if (occupied.has(group.id)) {
        skip(
          unit,
          group,
          null,
          "保存済みの攻撃計画があるため変更しません。"
        );
        continue;
      }

      const source = sources.find(
        item => item.id === group.equipmentId
      );

      if (!source) {
        fail("追随艦の装備性能スナップショットがありません。");
      }

      if (source.kind === "support") continue;

      const profile = readWeaponProfile(source, group);

      if (profile.kind !== "weapon") continue;

      if (group.damaged || group.destroyed) {
        skip(unit, group, profile, "装備組が損傷または完全破損しています。");
        continue;
      }

      if (
        group.lastUsedTurn !== null &&
        (
          !Number.isSafeInteger(group.lastUsedTurn) ||
          group.lastUsedTurn < 1 ||
          group.lastUsedTurn > scene.turn.number
        )
      ) {
        fail("追随艦の装備使用履歴が不正です。");
      }

      if (group.lastUsedTurn === scene.turn.number) {
        skip(unit, group, profile, "このラウンドで使用済みです。");
        continue;
      }

      // PASでは通常武器を新規登録しない。
      if (scene.turn.phaseId === "pas" && !profile.pasOnly) {
        skip(unit, group, profile, "PAS段階では通常武器を追随登録しません。");
        continue;
      }

      if (profile.issues.length) {
        fail(
          "追随艦の武器性能を確認できません。\n" +
          profile.issues.join("\n")
        );
      }

      const scope = readWeaponTargetScope(profile.targetScope);

      if (scope.kind !== "single") {
        skip(
          unit,
          group,
          profile,
          "初版の追随は単体武器のみ対応しています。"
        );
        continue;
      }

      if (
        !Number.isSafeInteger(group.remainingAmmo) ||
        group.remainingAmmo < 0 ||
        !Number.isSafeInteger(profile.fullAmmoCost) ||
        profile.fullAmmoCost < 1
      ) {
        fail("追随艦の残弾または投射率が未登録、または不正です。");
      }

      if (group.remainingAmmo < profile.fullAmmoCost) {
        skip(
          unit,
          group,
          profile,
          group.remainingAmmo === 0
            ? "残弾がありません。"
            : "完全投射の残弾が不足しています。減量攻撃は生成しません。"
        );
        continue;
      }

      requests.push({
        groupId: group.id,
        targetRef: { kind: "unit", id: target.instanceId },
        specifiedTargetIds: [],
        boundaries: []
      });

      labels.set(
        JSON.stringify([unit.instanceId, group.id]),
        {
          unitName: unit.name,
          groupLabel: groupLabel(group, profile)
        }
      );
    }

    if (!requests.length) continue;

    const selectedGroups = new Set(
      requests.map(request => request.groupId)
    );

    // 只向该舰闲置炮组追加请求，仍使用原命令创建和次序分类。
    replaceAttackCommands(
      scene,
      unit.instanceId,
      requests,
      createId
    );

    for (const command of scene.attackRuntime.commands) {
      if (
        command.unitId === unit.instanceId &&
        selectedGroups.has(command.groupId)
      ) {
        newIds.add(command.id);
      }
    }
  }

  if (!newIds.size) {
    return { commands: [], skipped };
  }

  const filtered = filterUnreachableAttackCommands(
    scene,
    scene.attackRuntime.commands,
    {
      priorityCommandIds: baselineIds,
      skippableTargetCommandIds: [...newIds]
    }
  );

  // 只删除这一次新生成的不合格追随命令。
  // 已有计划以及分旗舰计划均不在这里删除。
  const rejected = filtered.skipped.filter(
    item => newIds.has(item.commandId)
  );

  const rejectedIds = new Set(
    rejected.map(item => item.commandId)
  );

  scene.attackRuntime.commands =
    scene.attackRuntime.commands.filter(
      command => !rejectedIds.has(command.id)
    );

  for (const item of rejected) {
    const label = labels.get(
      JSON.stringify([item.unitId, item.groupId])
    );

    skipped.push({
      unitId: item.unitId,
      unitName: label?.unitName ?? "追随艦",
      groupId: item.groupId,
      groupLabel: label?.groupLabel ?? "装備組",
      phaseId: item.phaseId,
      reason: item.reason
    });
  }

  const commands = scene.attackRuntime.commands
    .filter(command => newIds.has(command.id))
    .map(command => {
      const label = labels.get(
        JSON.stringify([command.unitId, command.groupId])
      );

      return {
        unitId: command.unitId,
        unitName: label.unitName,
        groupId: command.groupId,
        groupLabel: label.groupLabel,
        phaseId: command.phaseId
      };
    });

  return { commands, skipped };
}
