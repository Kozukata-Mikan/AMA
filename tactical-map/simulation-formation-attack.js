import { assertBroadsideQuotas } from "./weapon-firing-arc.js";
import { formationMembers } from "./formation-layout.js?v=fleet-cohesion-6";
import { assertManualControl, getVisibility } from "./simulation-features.js?v=aviation-operations-1";
import {
  readWeaponProfile,
  readWeaponTargetScope,
} from "./weapon-profile-runtime.js?v=aviation-operations-1";
import {
  getAttackExecutionPhase,
  initializeAttackRuntime,
} from "./simulation-attack-runtime.js?v=aviation-operations-1";
import {
  createDeferredAttackValidator,
  filterUnreachableAttackCommands,
  prepareSettlementAttackPlan,
} from "./simulation-settlement.js?v=aviation-operations-1";

function shuffle(values) {
  const result = [...values];
  const bits = new Uint32Array(1);
  for (let i = result.length - 1; i > 0; i--) {
    const bound = 0x100000000 - (0x100000000 % (i + 1));
    do {
      crypto.getRandomValues(bits);
    } while (bits[0] >= bound);
    const j = bits[0] % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Plan ordinary legal single-target shots for a whole formation in one transaction. */
export function planFormationAttack(scene, request) {
  if (!/^(order-[1-5]|pas)$/.test(scene.turn.phaseId))
    throw new Error("編隊攻撃は攻撃段階で登録してください。");
  const actors = formationMembers(scene, request.groupId);
  if (!actors.length || actors.some((unit) => unit.branch !== "navy"))
    throw new Error("艦船編隊を選択してください。");
  assertManualControl(scene, actors);
  const visibility = getVisibility(scene);
  const targetRef = request.targetRef;
  if (!targetRef || !["unit", "group"].includes(targetRef.kind))
    throw new Error("単艦または編隊を指定してください。");
  const targets = (
    targetRef.kind === "group"
      ? formationMembers(scene, targetRef.id)
      : scene.instances.filter((unit) => unit.instanceId === targetRef.id)
  ).filter(
    (unit) =>
      unit.side !== actors[0].side &&
      unit.branch === "navy" &&
      unit.shipState?.status !== "sunk" &&
      visibility.get(unit.instanceId) === "identified",
  );
  if (!targets.length) throw new Error("識別済みの敵艦がありません。");
  const validate = createDeferredAttackValidator(scene);
  const baseline = filterUnreachableAttackCommands(
    scene,
    scene.attackRuntime.commands,
  );
  let reserved = validate(baseline.accepted).filter(
    (entry) => entry.scope.kind === "single",
  );
  let planned = 0;
  let skipped = 0;
  for (const actor of actors) {
    if (
      ["sinking", "sunk"].includes(actor.shipState.status) ||
      actor.shipState.rescueTaskId !== null
    )
      continue;
    const equipment = new Map(
      actor.snapshot.equipmentSnapshots.map((item) => [item.id, item]),
    );
    for (const group of actor.equipmentState.groups) {
      const source = equipment.get(group.equipmentId);
      if (
        source?.kind !== "weapon" ||
        group.damaged ||
        group.destroyed ||
        group.lastUsedTurn === scene.turn.number
      )
        continue;
      const profile = readWeaponProfile(source, group);
      if (profile.issues.length || group.remainingAmmo < profile.fullAmmoCost) {
        skipped++;
        continue;
      }
      // This command distributes single-target shots. Scope weapons remain on their
      // existing explicit range-target panel, preserving their membership rules.
      const scope = readWeaponTargetScope(profile.targetScope);
      if (scope.kind !== "single" && profile.targetScope.trim() !== "集群") {
        skipped++;
        continue;
      }
      if (!profile.pasOnly && scene.turn.phaseId === "pas") continue;
      const phaseId = getAttackExecutionPhase(
        scene,
        actor.instanceId,
        group.id,
      );
      const candidates =
        targetRef.kind === "group" ? shuffle(targets) : targets;
      let selected = null;
      for (const target of candidates) {
        const command = {
          id: crypto.randomUUID(),
          unitId: actor.instanceId,
          groupId: group.id,
          targetId: target.instanceId,
          targetRef: { kind: "unit", id: target.instanceId },
          specifiedTargetIds: [],
          phaseId,
          turnNumber: scene.turn.number,
          status: "planned",
          createdAt: scene.updatedAt,
          boundaries: [],
        };
        try {
          const [entry] = validate([command]);
          const retained = reserved.filter(
            (item) =>
              item.unitId !== actor.instanceId || item.groupId !== group.id,
          );
          if (
            entry.profile.guidance === "ray" &&
            retained.some(
              (item) =>
                item.unitId === actor.instanceId &&
                item.profile.guidance === "ray" &&
                item.targetId !== entry.targetId,
            )
          )
            continue;
          const next = [...retained, entry];
          assertBroadsideQuotas(
            scene,
            next,
            next.map((item) => ({
              commandId: item.commandId,
              targetIds: [item.targetId],
            })),
            scene.settlementRuntime.attackRecords,
          );
          reserved = next;
          selected = command;
          break;
        } catch (error) {
          if (
            error.code === "TARGET_INELIGIBLE" ||
            error.code === "BROADSIDE_QUOTA"
          )
            continue;
          throw error;
        }
      }
      if (!selected) {
        skipped++;
        continue;
      }
      scene.attackRuntime.commands = scene.attackRuntime.commands.filter(
        (item) => item.unitId !== actor.instanceId || item.groupId !== group.id,
      );
      scene.attackRuntime.commands.push(selected);
      if (scene.attackRuntime.commands.length > 1000)
        throw new Error("未処理の攻撃計画は1000件以内にしてください。");
      planned++;
    }
  }
  if (!planned)
    throw new Error(
      "合法な攻撃を登録できませんでした。射距・射界・使用状況を確認してください。",
    );
  initializeAttackRuntime(scene);
  prepareSettlementAttackPlan(scene);
  return {
    planned,
    skipped,
    message: `編隊攻撃を${planned}組登録しました。未登録${skipped}組。発射は各攻撃段階の一括結算で行います。`,
  };
}
