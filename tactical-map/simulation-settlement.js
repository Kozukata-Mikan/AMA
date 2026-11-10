import {
  prepareAttackBatchResources,
  getAttackPhaseStartScene,
  applyAttackBatchResources,
  resolveAttackBatchHitStep,
  prepareBatchHitChecks
} from "./simulation-attack-batch.js";

 
import {
  ensureShipRuntime,
  readShipProfile,
  getReconConditions,
  applyShipDamageAttack,
  applyShipEffectAcquisition
} from "./ship-runtime.js";

import {
  ensureUnitCombatRuntime
} from "./equipment-runtime.js";

import {
  getObserverVisibility,
  getEquipmentReconSourceVisibility
} from "./simulation-features.js";

import {
  tryReadEquipmentPower,
  getEquipmentDamagePlan,
  validateEquipmentImpactReport
} from "./equipment-damage-runtime.js";

import {
  ensureEquipmentItemRuntime,
  applyEquipmentAttack
} from "./equipment-item-runtime.js";


import {
  traceAttackTerrainLine,
  entersTerrainInterior
} from "./attack-terrain-runtime.js";

import { sampleTerrain } from "./terrain-data.js";

import {
  getHitModifiers
} from "./weapon-hit-runtime.js";

import {
  getCannonDamagePreview,
  resolveCannonImpact,
  summarizeCannonImpacts
} from "./cannon-damage-runtime.js";

import {
  readNumericPower,
  resolveNumericDamage
} from "./numeric-damage-runtime.js";

import {
  initializeRayTargetRuntime,
  checkRayTarget,
  registerRayTarget
} from "./ray-target-runtime.js";

import {
  initializeRescueState,
  reconcileActiveRescues
} from "./simulation-rescue.js";

import {
  recordSinkingStarts
} from "./simulation-phase-finish.js";


import {
  readWeaponTargetScope
} from "./weapon-profile-runtime.js";

import {
  initializeAttackRuntime
} from "./simulation-attack-runtime.js";

import {
  readWeaponProfile
} from "./weapon-profile-runtime.js";

import {
  getVisibility
} from "./simulation-features.js";

import {
  expandFormationMemberIds
} from "./formation-target-runtime.js";

import {
  readRangeCommandTarget
} from "./simulation-range-command.js";

import {
  readFiringArc
} from "./weapon-firing-arc.js";

const copy = value => JSON.parse(JSON.stringify(value));
const EPSILON = 1e-7;
const GRADES = ["F", "E", "D", "C", "B", "A", "S", "U"];

const NEXT_ATTACK_PHASE = {
  "order-5": "order-4",
  "order-4": "order-3",
  "order-3": "order-2",
  "order-2": "order-1",
  "order-1": "pas",
  pas: "special"
};

function fail(message) {
  throw new Error(message);
}
// 只公开固定步骤提示，不公开内部异常资料。
// 不重试、不吞掉异常、不改变事务回滚行为。
function settlementStep(publicMessage, action) {
  try {
    return action();
  } catch (cause) {
    const error = new Error(publicMessage);
    error.name = "SimulationSettlementError";
    error.publicMessage = publicMessage;
    error.cause = cause;
    throw error;
  }
}

function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${label}の値が不正です。`);
  }
  return value;
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function unitFor(scene, id) {
  const unit = scene.instances.find(
    item => item.instanceId === id
  );

  if (!unit) {
    fail("結算対象を確認できません。");
  }

  return unit;
}

function contextFor(scene) {
  return {
    turnNumber: scene.turn.number,
    phaseId: scene.turn.phaseId
  };
}

function recordKey(turnNumber, phaseId) {
  return JSON.stringify([turnNumber, phaseId]);
}

// 独立的新运行记录。
// 不读取、清除或重写旧unifiedDamageRuntime。
export function initializeSettlementRuntime(scene) {
  if (
    !scene ||
    !Array.isArray(scene.instances) ||
    !Number.isSafeInteger(scene.turn?.number) ||
    scene.turn.number < 1
  ) {
    fail("正式結算の保存状態が不正です。");
  }

  if (scene.settlementRuntime === undefined) {
    scene.settlementRuntime = {
      version: 1,
      attackRecords: []
    };
  }

  const runtime = scene.settlementRuntime;

  if (
    !runtime ||
    runtime.version !== 1 ||
    !Array.isArray(runtime.attackRecords)
  ) {
    fail("正式結算の履歴形式が不正です。");
  }

  const keys = new Set();

  for (const record of runtime.attackRecords) {
    if (
      !record ||
      record.version !== 1 ||
      record.step !== "attack-batch" ||
      !Number.isSafeInteger(record.turnNumber) ||
      record.turnNumber < 1 ||
      record.turnNumber > scene.turn.number ||
      !Object.hasOwn(NEXT_ATTACK_PHASE, record.phaseId) ||
      !Number.isSafeInteger(record.elapsedMinutes) ||
      record.elapsedMinutes < 0 ||
      !Array.isArray(record.resourceReports) ||
      !Array.isArray(record.hitReports) ||
      !Array.isArray(record.targetReports) ||
      !Array.isArray(record.effectReports) ||
      !Array.isArray(record.rayReports) ||
      !Array.isArray(record.rescueInterruptions)
    ) {
      fail("正式攻撃の履歴が不正です。");
    }
    // 旧记录允许缺失；实际需要本回合两舷历史时，
// 配额检查会明确拒绝缺失数据，不补造历史。
for (const resource of record.resourceReports) {
  if (resource.firingSides === undefined) continue;

  if (
    !Array.isArray(resource.firingSides) ||
    resource.firingSides.length > 2 ||
    resource.firingSides.some(
      side => !["left", "right"].includes(side)
    ) ||
    new Set(resource.firingSides).size !==
      resource.firingSides.length
  ) {
    fail("攻撃資源の側別使用履歴が不正です。");
  }
}

        // 兼容旧记录：旧单体报告可以没有该字段。
    // 新范围报告保留抽签和重复出现项。
    if (record.rangeSelections !== undefined) {
      if (!Array.isArray(record.rangeSelections)) {
        fail("範囲攻撃の選択履歴が不正です。");
      }

      const selectionCommands = new Set();

      for (const selection of record.rangeSelections) {
        if (
          !selection ||
          selection.version !== 1 ||
          typeof selection.commandId !== "string" ||
          selection.commandId.trim() === "" ||
          selectionCommands.has(selection.commandId) ||
          !["all", "specified", "random"].includes(selection.mode) ||
          !Array.isArray(selection.candidateIds) ||
          selection.candidateIds.length === 0 ||
          selection.candidateIds.some(
            id => typeof id !== "string" || id.trim() === ""
          ) ||
          new Set(selection.candidateIds).size !==
            selection.candidateIds.length ||
          !Array.isArray(selection.selections) ||
          !Array.isArray(selection.occurrences) ||
          selection.occurrences.length === 0
        ) {
          fail("範囲攻撃の選択履歴が不正です。");
        }

        selectionCommands.add(selection.commandId);

        for (
          let index = 0;
          index < selection.occurrences.length;
          index++
        ) {
          const occurrence = selection.occurrences[index];

          if (
            !occurrence ||
            occurrence.commandId !== selection.commandId ||
            occurrence.occurrenceIndex !== index ||
            !selection.candidateIds.includes(occurrence.targetId)
          ) {
            fail("範囲攻撃の出現履歴が不正です。");
          }

          const matchingHits = record.hitReports.filter(hit =>
            hit.commandId === selection.commandId &&
            hit.occurrenceIndex === index
          );

          if (
            matchingHits.length !== 1 ||
            matchingHits[0].targetId !== occurrence.targetId
          ) {
            fail("範囲選択と命中履歴が一致しません。");
          }
        }

        if (selection.mode === "random") {
          if (
            selection.selections.length !==
              selection.occurrences.length
          ) {
            fail("範囲攻撃の抽選履歴が不足しています。");
          }

          selection.selections.forEach((draw, index) => {
            if (
              !draw ||
              draw.drawIndex !== index ||
              !Number.isSafeInteger(draw.candidateIndex) ||
              draw.candidateIndex < 0 ||
              draw.candidateIndex >= selection.candidateIds.length ||
              draw.targetId !==
                selection.candidateIds[draw.candidateIndex] ||
              draw.targetId !==
                selection.occurrences[index].targetId
            ) {
              fail("範囲攻撃の抽選履歴が一致しません。");
            }
          });
        } else {
          if (selection.selections.length !== 0) {
            fail("非抽選の範囲攻撃に抽選履歴があります。");
          }

          const selectedIds = selection.occurrences.map(
            occurrence => occurrence.targetId
          );

          if (
            new Set(selectedIds).size !== selectedIds.length ||
            (
              selection.mode === "all" &&
              (
                selectedIds.length !== selection.candidateIds.length ||
                selectedIds.some(
                  (id, index) => id !== selection.candidateIds[index]
                )
              )
            )
          ) {
            fail("範囲攻撃の対象集合が不正です。");
          }
        }
      }
    }

    // 兼容旧目标报告没有equipmentReports的存档。
// 新设备报告必须与正式武器命中对应。
for (const targetReport of record.targetReports) {
  if (targetReport.equipmentReports === undefined) continue;

  if (!Array.isArray(targetReport.equipmentReports)) {
    fail("設備攻撃の履歴形式が不正です。");
  }

  const equipmentKeys = new Set();

  for (const equipment of targetReport.equipmentReports) {
    if (
      !equipment ||
      typeof equipment.commandId !== "string" ||
      !Number.isSafeInteger(equipment.occurrenceIndex) ||
      equipment.occurrenceIndex < 0
    ) {
      fail("設備攻撃の命令履歴が不正です。");
    }

    const equipmentKey = JSON.stringify([
      equipment.commandId,
      equipment.occurrenceIndex
    ]);

    if (equipmentKeys.has(equipmentKey)) {
      fail("設備攻撃の出現履歴が重複しています。");
    }

    equipmentKeys.add(equipmentKey);

    validateEquipmentImpactReport(equipment.damage);

    const hits = record.hitReports.filter(hit =>
      hit.commandId === equipment.commandId &&
      (hit.occurrenceIndex ?? 0) ===
        equipment.occurrenceIndex &&
      hit.targetId === targetReport.targetId
    );

    if (
      hits.length !== 1 ||
      equipment.damage.hitCount !== hits[0].hit?.hitCount ||
      equipment.damage.turnNumber !== record.turnNumber ||
      !Array.isArray(equipment.damage.applications) ||
      equipment.damage.applications.length !==
        equipment.damage.allocationCount
    ) {
      fail("設備被害と正式命中の履歴が一致しません。");
    }

    equipment.damage.applications.forEach((application, index) => {
      if (
        !application ||
        application.allocationIndex !== index ||
        application.itemId !==
          equipment.damage.draws[index].itemId ||
        typeof application.empty !== "boolean" ||
        typeof application.changed !== "boolean" ||
        !Array.isArray(application.groupIds)
      ) {
        fail("設備被害の適用履歴が不正です。");
      }
    });
  }
}

    const key = recordKey(record.turnNumber, record.phaseId);

    if (keys.has(key)) {
      fail("同じ攻撃段階の結算履歴が重複しています。");
    }

    keys.add(key);
  }
}

function navalPoint(scene, unit) {
  if (
    !Number.isFinite(unit.x) ||
    !Number.isFinite(unit.y)
  ) {
    fail("艦船の位置が不正です。");
  }

  const sample = sampleTerrain(
    scene.terrain,
    unit.x,
    unit.y
  );

  if (!sample.inside) {
    fail("攻撃位置が地図の範囲外です。");
  }

  let z = sample.surface;

  if (unit.underwater === true) {
    // 正式結算では欠落深度を12で代用しない。
    if (
      !Number.isFinite(unit.depth) ||
      unit.depth < 0
    ) {
      fail("水中艦船の深度が未登録、または不正です。");
    }

    z = -unit.depth;
  }

  if (!Number.isFinite(z)) {
    fail("攻撃位置の高さが不正です。");
  }

  return { x: unit.x, y: unit.y, z };
}

function parseDamageRule(profile) {
  if (/^(舰炮规则|艦砲規則|艦砲ルール)$/.test(
    profile.powerRule.trim()
  )) {
    return { kind: "cannon", underwater: false };
  }

  const equipment = tryReadEquipmentPower(
    profile.powerRule
  );

  if (equipment) {
    return {
      kind: "equipment",
      underwater: false,
      power: equipment.power
    };
  }

  const parsed = readNumericPower(profile.powerRule);

  return {
    kind: parsed.underwater ? "underwater" : "numeric",
    underwater: parsed.underwater,
    power: parsed.power
  };
}


function trainingModifiers(scene, actor, target, underwaterWeapon) {
  const traits = new Set([
    ...actor.trainingState.baseTraits,
    ...actor.trainingState.acquiredTraits
  ]);

  let bonuses = 0;
  let penalties = 0;

  const period = getReconConditions(scene.environment).period.id;
  const naval = readShipProfile(actor);

  for (const trait of traits) {
    switch (trait) {
      case "high-training":
        bonuses += 1;
        break;

      case "low-training":
        penalties += 1;
        break;

      case "night-training":
        if (period === "night") bonuses += 1;
        break;

      case "underwater-training":
        if (underwaterWeapon) bonuses += 1;
        break;

      case "excellent-sea-fire-control":
        if (
          ["navy", "army"].includes(target.branch) &&
          GRADES.indexOf(naval.seaRecon) >= GRADES.indexOf("A")
        ) {
          bonuses += 1;
        }
        break;

      case "excellent-air-fire-control":
        if (
          ["air", "special"].includes(target.branch) &&
          GRADES.indexOf(naval.airRecon) >= GRADES.indexOf("A")
        ) {
          bonuses += 1;
        }
        break;

      case "poor-sea-armament":
        if (["navy", "army"].includes(target.branch)) {
          penalties += 1;
        }
        break;

      case "poor-air-armament":
        if (["air", "special"].includes(target.branch)) {
          penalties += 1;
        }
        break;

      case "one-against-thousand":
        // 每回合一次的50%发动车制尚无持久化契约。
        // 不能每次攻击各投一次，也不能假定未发动。
        if (
          ["moderate", "heavy", "sinking", "sunk"]
            .includes(actor.shipState.status)
        ) {
          fail(
            "一騎当千のラウンド発動記録が未接続です。" +
            "命中判定前に結算を停止します。"
          );
        }
        break;

      default:
        fail("未対応の練度・特殊能力があります。");
    }
  }

  return {
    bonuses: integer(bonuses, "練度の有利判定"),
    penalties: integer(penalties, "練度の不利判定")
  };
}

function assertNoUnconnectedSupport(scene) {
  // 支援装备可能改变其他舰船命中，必须检查整场而非仅攻击者。
  for (const unit of scene.instances) {
    if (
      unit.branch === "navy" &&
      unit.shipState.status === "sunk"
    ) {
      continue;
    }

    const equipment = new Map(
      (unit.snapshot?.equipmentSnapshots ?? [])
        .map(item => [item.id, item])
    );

    for (const group of unit.equipmentState.groups) {
      if (group.damaged) continue;

      const source = equipment.get(group.equipmentId);

      if (source?.kind === "support") {
        fail(
          "支援装備の電子効果・追加効果の照合が未接続です。" +
          "補正を0として代用せず、結算を停止します。"
        );
      }
    }

    if (unit.equipmentState.unresolvedMountIndexes.length) {
      fail(
        "組数未登録の装備配置があります。" +
        "支援・追加効果の有無を確定できないため結算を停止します。"
      );
    }
  }
}

function finalPreflight(start, entry) {
  const actor = unitFor(start, entry.unitId);
  const target = unitFor(start, entry.targetId);
  const profile = entry.profile;
  const targetProfile = readShipProfile(target);

  const scope = readWeaponTargetScope(
    profile.targetScope
  );

  // 明确的目标资格失败：
  // 范围预检可以排除该成员。
  // 单体攻击没有替代目标，仍然拒绝。
  function ineligible(message) {
    const error = new Error(message);
    error.code = "TARGET_INELIGIBLE";
    throw error;
  }

  if (
    actor.instanceId === target.instanceId ||
    actor.side === target.side ||
    target.shipState.status === "sunk"
  ) {
    ineligible(
      "自艦・同一陣営・沈没艦は攻撃対象外です。"
    );
  }

 const clusterSingleTarget =
  profile.targetScope.trim() === "集群" &&
  entry.targetRef?.kind === "unit";

if (scope.kind === "single" || clusterSingleTarget) {
  if (
    entry.targetRef?.kind !== "unit" ||
    entry.targetId !== entry.targetRef.id ||
    !Array.isArray(entry.specifiedTargetIds) ||
    entry.specifiedTargetIds.length !== 0
  ) {
    fail("単体目標の指定が不正です。");
  }

  // 集群武器指定单体时，正式检查和结算的目标
  // 必须就是该单体，不能自动扩展所属集群。
} else if (
  scope.kind === "range" &&
  entry.targetRef?.kind !== "group"
) {
  fail("範囲武器の主目標が不正です。");
}


  // 未接入的效果必须整批拒绝，不能排除成员后继续。
  if (profile.large) {
    fail(
      "大型武器の専用効果が未接続です。" +
      "通常武器として代用せず、結算を停止します。"
    );
  }

  const firingGroup = actor.equipmentState.groups.find(
  group => group.id === entry.groupId
);

if (!firingGroup) {
  fail("射界判定の装備組を確認できません。");
}

readFiringArc(actor, firingGroup, target);

  const damageRule = parseDamageRule(profile);

  // 目标资格与伤害规则分开检查。
  const underwaterWeapon =
    profile.underwater === true ||
    damageRule.underwater;

  const from = navalPoint(start, actor);
  const to = navalPoint(start, target);

  const trace = traceAttackTerrainLine(
    start.terrain,
    from,
    to
  );

  const relativeHeight = to.z - from.z;

  if (underwaterWeapon) {
    if (to.z > EPSILON) {
      ineligible(
        "水中武器は海面より上の目標を攻撃できません。"
      );
    }
  } else if (
    target.underwater === true ||
    relativeHeight < -EPSILON
  ) {
    ineligible(
      "通常武器は水中・下方の目標を攻撃できません。"
    );
  }

  if (
    trace.distance3D > profile.range + EPSILON ||
    relativeHeight > profile.ceilingU + EPSILON
  ) {
    ineligible(
      "射距または射高の条件を満たしていません。"
    );
  }

  switch (profile.guidance) {
    case "direct":
    case "ray":
      if (entersTerrainInterior(trace)) {
        ineligible(
          "攻撃直線が地形内部を通過します。"
        );
      }
      break;

    case "lobbed":
      if (trace.maxGroundHeight > 30 + EPSILON) {
        ineligible(
          "高度30を超える地形を越えられません。"
        );
      }
      break;

    case "inertial":
      break;

    case "radar":
      if (
        getObserverVisibility(
          start,
          actor,
          target
        ) === null
      ) {
        ineligible(
          "レーダー誘導には発射艦自身の目標発見が必要です。"
        );
      }
      break;

    case "computer":
      // 阵营识别已由批次资源准备检查。
      break;

    default:
      fail("引導方式が未対応です。");
  }

  if (profile.guidance === "ray") {
    const check = checkRayTarget({
      scene: start,
      unitId: entry.unitId,
      targetId: entry.targetId,
      turnNumber: start.turn.number
    });

    // 射线锁定冲突不作为范围成员排除条件。
    if (!check.allowed) {
      fail(check.reason);
    }
  }

  // 正式随机之前验证真实伤害算法。
  // 算法不支持或资料错误必须整批拒绝。
  if (damageRule.kind === "cannon") {
  getCannonDamagePreview({
    penetration: profile.penetration,
    armor: profile.guidance === "inertial"
      ? targetProfile.strengthArmor
      : targetProfile.armor
  });
} else if (damageRule.kind === "equipment") {
  getEquipmentDamagePlan({
    powerRule: profile.powerRule,
    hitCount: entry.ammoCost
  });

  const checkedTarget = copy(target);
  ensureEquipmentItemRuntime(checkedTarget);

  if (
    checkedTarget.equipmentState
      .unresolvedMountIndexes.length
  ) {
    fail(
      "装備組数が未登録のため、設備損傷を適用できません。"
    );
  }

  if (
    typeof getEquipmentReconSourceVisibility !==
      "function"
  ) {
    fail("設備攻撃の偵察処理が接続されていません。");
  }
} else {
    resolveNumericDamage({
      powerRule: profile.powerRule,
      hitCount: entry.ammoCost,
      penetration: profile.penetration,
      armor: targetProfile.armor,
      inertial: profile.guidance === "inertial",
      strength: targetProfile.strength,
      strengthRemaining:
        targetProfile.strength -
        target.shipState.underwaterStrengthUses
    });
  }

  const training = trainingModifiers(
    start,
    actor,
    target,
    underwaterWeapon
  );

  const modifiers = getHitModifiers({
    guidance: profile.guidance,
    environment: start.environment,
    trainingBonuses: training.bonuses,
    trainingPenalties: training.penalties,
    electronicBonuses: 0,
    electronicPenalties: 0,
    globalBonuses: 0,
    globalPenalties: 0
  });

  return {
    allowed: true,
    commandId: entry.commandId,
    bonuses: modifiers.bonuses,
    penalties: modifiers.penalties
  };
}

// 只比较装备损伤，不比较允许由正式资源流程改变的残弹和使用记录。
// 旧阶段快照没有destroyed字段时，按旧状态语义视为false。
function equipmentDamageSignature(unit) {
  const checked = copy(unit);
  const runtime = ensureEquipmentItemRuntime(checked);

  return JSON.stringify({
    groups: checked.equipmentState.groups.map(group => ({
      id: group.id,
      damaged: group.damaged,
      destroyed: group.destroyed
    })).sort((a, b) => compareText(a.id, b.id)),

    itemDamage: runtime
  });
}



function assertStartStateUnchanged(scene, start) {
  for (const oldUnit of start.instances) {
    const current = unitFor(scene, oldUnit.instanceId);

    if (
      JSON.stringify(current.shipState) !==
        JSON.stringify(oldUnit.shipState) ||
      current.currentHp !== oldUnit.currentHp ||
      equipmentDamageSignature(current) !==
      equipmentDamageSignature(oldUnit) ||
      current.groupId !== oldUnit.groupId ||
      current.heading !== oldUnit.heading ||
      current.x !== oldUnit.x ||
      current.y !== oldUnit.y ||
      current.underwater !== oldUnit.underwater ||
      current.depth !== oldUnit.depth ||
      JSON.stringify(current.trainingState) !==
        JSON.stringify(oldUnit.trainingState) ||
      JSON.stringify(current.snapshot) !==
        JSON.stringify(oldUnit.snapshot)
    ) {
      fail(
        "段階開始後に戦闘状態が変更されています。" +
        "現在状態で開始記録を代用せず結算を停止します。"
      );
    }
  }

  if (
    JSON.stringify(scene.environment) !==
      JSON.stringify(start.environment) ||
    scene.controls.enemyAutonomy !==
      start.controls.enemyAutonomy ||
    JSON.stringify(scene.groups) !== JSON.stringify(start.groups) ||
    JSON.stringify(scene.rayTargetRuntime) !==
      JSON.stringify(start.rayTargetRuntime)
  ) {
    fail("段階開始後に攻撃条件が変更されています。");
  }

  // 玩家在本次序可切换观察阵营，故不比较observationSide。
}

function assertEffectAlgorithms(scene, start, entries) {
  const context = contextFor(scene);

  for (const entry of entries) {
    const rule = parseDamageRule(entry.profile);
    const target = unitFor(start, entry.targetId);

    const type = rule.kind === "cannon"
      ? "fire"
      : rule.underwater
        ? "flooding"
        : null;

    if (type === null) continue;

    // 隔离副本上的确定性支持检查，不消耗正式随机数。
    applyShipEffectAcquisition(
      copy(target),
      { attackId: entry.commandId, type },
      context,
      () => false
    );
  }
}

function summarizeTargets(scene, start, prepared, hitStep, coinSource) {
    // 资源条目仍然是一命令一条；
  // 命中报告允许同命令包含多个范围出现项。
  const entries = new Map();

  for (const entry of prepared.entries) {
    if (entries.has(entry.commandId)) {
      fail("攻撃資源の命令識別番号が重複しています。");
    }

    entries.set(entry.commandId, entry);
  }

  if (!Array.isArray(hitStep?.reports)) {
    fail("命中報告の形式が不正です。");
  }

  const grouped = new Map();
  const occurrencesByCommand = new Map();

  for (const hit of hitStep.reports) {
    const entry = entries.get(hit?.commandId);

    if (!entry) {
      fail("命中報告に未登録の攻撃命令があります。");
    }

    const occurrenceIndex =
      hit.occurrenceIndex === undefined
        ? 0
        : hit.occurrenceIndex;

    integer(occurrenceIndex, "範囲の出現番号");

    if (
      hit.unitId !== entry.unitId ||
      hit.groupId !== entry.groupId ||
      hit.turnNumber !== prepared.turnNumber ||
      hit.phaseId !== prepared.phaseId ||
      typeof hit.targetId !== "string" ||
      hit.targetId.trim() === ""
    ) {
      fail("命中報告と攻撃命令が一致しません。");
    }

    let indexes = occurrencesByCommand.get(entry.commandId);

    if (!indexes) {
      indexes = new Set();
      occurrencesByCommand.set(entry.commandId, indexes);
    }

    if (indexes.has(occurrenceIndex)) {
      fail("同じ攻撃命令の出現番号が重複しています。");
    }

    indexes.add(occurrenceIndex);

    const hitCount = integer(
      hit.hit?.hitCount,
      "命中数"
    );

    if (hitCount > entry.ammoCost) {
      fail("一回の命中数が完全投射数を超えています。");
    }

    // 当前单体路径必须仍与原目标一致。
    // 范围路径未来使用targetRef，不把编队ID塞入targetId。
    if (
      entry.targetId !== undefined &&
      hit.targetId !== entry.targetId
    ) {
      fail("単体命令の目標と命中報告が一致しません。");
    }

    unitFor(start, hit.targetId);

    if (!grouped.has(hit.targetId)) {
      grouped.set(hit.targetId, []);
    }

    // 不用commandId覆盖，不对targetId去重。
    // 重复目标的每次完整投射都进入同目标伤害集合。
    grouped.get(hit.targetId).push({
      entry: {
        ...entry,
        targetId: hit.targetId,
        occurrenceIndex
      },
      hitCount,
      rule: parseDamageRule(entry.profile)
    });
  }

  for (const entry of prepared.entries) {
    const indexes = occurrencesByCommand.get(entry.commandId);

    if (!indexes || indexes.size === 0) {
      fail("攻撃命令の命中報告が不足しています。");
    }

    for (let index = 0; index < indexes.size; index++) {
      if (!indexes.has(index)) {
        fail("範囲の出現番号が連続していません。");
      }
    }

    if (
      entry.targetId !== undefined &&
      indexes.size !== 1
    ) {
      fail("単体攻撃に複数の投射報告があります。");
    }
  }


  const targetReports = [];
  const effects = [];
  const context = contextFor(scene);

  for (const targetId of [...grouped.keys()].sort(compareText)) {
    const startTarget = unitFor(start, targetId);
    const target = unitFor(scene, targetId);
    const naval = readShipProfile(startTarget);
    const attacks = grouped.get(targetId);

    const cannonImpacts = [];
    const numericReports = [];
    const equipmentReports = [];
    let hpDamage = 0;
    let hasDamageEffect = false;
    let strengthRemaining =
      naval.strength -
      startTarget.shipState.underwaterStrengthUses;

    // 硬币调用顺序按稳定装备键，而非传入计划列表。
    attacks.sort((a, b) =>
      compareText(a.entry.unitId, b.entry.unitId) ||
      compareText(a.entry.groupId, b.entry.groupId) ||
      a.entry.occurrenceIndex - b.entry.occurrenceIndex
    );


    for (const attack of attacks) {
      if (attack.rule.kind !== "cannon") continue;

      const armor = attack.entry.profile.guidance === "inertial"
        ? naval.strengthArmor
        : naval.armor;

      for (let index = 0; index < attack.hitCount; index++) {
        const impact = coinSource === undefined
          ? resolveCannonImpact({
              penetration: attack.entry.profile.penetration,
              armor
            })
          : resolveCannonImpact({
              penetration: attack.entry.profile.penetration,
              armor
            }, coinSource);

        cannonImpacts.push({
          commandId: attack.entry.commandId,
          occurrenceIndex: attack.entry.occurrenceIndex,
          impactIndex: index,
          impact
        });


        if (impact.fireEligible) {
          effects.push({
            targetId,
            attackId: attack.entry.commandId,
            type: "fire"
          });
        }
      }
    }

    const cannon = summarizeCannonImpacts(
      cannonImpacts.map(item => item.impact),
      startTarget.shipState.normalHitRemainder
    );

    hpDamage += cannon.hpDamage;
    hasDamageEffect = cannon.damagingImpactCount > 0;

    // 高威力优先获得剩余强度防御。
    // 同威力仅用稳定键排序，伤害总量不受其影响。
    const numeric = attacks
      .filter(attack =>
  ["numeric", "underwater"].includes(attack.rule.kind)
)
      .sort((a, b) =>
        Number(b.rule.underwater) - Number(a.rule.underwater) ||
        (a.rule.underwater ? b.rule.power - a.rule.power : 0) ||
        compareText(a.entry.unitId, b.entry.unitId) ||
        compareText(a.entry.groupId, b.entry.groupId) ||
        a.entry.occurrenceIndex - b.entry.occurrenceIndex
      );


    for (const attack of numeric) {
      const damage = resolveNumericDamage({
        powerRule: attack.entry.profile.powerRule,
        hitCount: attack.hitCount,
        penetration: attack.entry.profile.penetration,
        armor: naval.armor,
        inertial: attack.entry.profile.guidance === "inertial",
        strength: naval.strength,
        strengthRemaining
      });

      hpDamage += damage.hpDamage;
      integer(hpDamage, "合算耐性被害");

      hasDamageEffect ||= damage.hasDamageEffect;

      if (attack.rule.underwater) {
        strengthRemaining = damage.strengthRemainingAfter;

        // 获取资格按每枚水下数字威力命中记录。
        for (let index = 0; index < attack.hitCount; index++) {
          effects.push({
            targetId,
            attackId: attack.entry.commandId,
            type: "flooding"
          });
        }
      }

      numericReports.push({
        commandId: attack.entry.commandId,
        occurrenceIndex: attack.entry.occurrenceIndex,
        damage
      });

    }
    // 全批资源和武器命中已确定。
// 八项抽选属于伤害步骤，不重新计算武器命中数。
for (const attack of attacks) {
  if (attack.rule.kind !== "equipment") continue;

  const damage = applyEquipmentAttack(
    scene,
    target,
    {
      powerRule: attack.entry.profile.powerRule,
      hitCount: attack.hitCount
    },
    {
      // 发现来源读取次序开始场景，避免目标处理顺序
      // 影响同次序设备攻击的侦察来源记录。
      observeBeforeDamage: (observer, observedTarget, itemId) =>
        getEquipmentReconSourceVisibility(
          start,
          unitFor(start, observer.instanceId),
          unitFor(start, observedTarget.instanceId),
          itemId
        )
    }
  );

  equipmentReports.push({
    commandId: attack.entry.commandId,
    occurrenceIndex: attack.entry.occurrenceIndex,
    damage
  });
}

    const applied = applyShipDamageAttack(
      target,
      {
        attackId: recordKey(context.turnNumber, context.phaseId) +
          ":" + targetId,
        kind: "batch",
        hpDamage,
        hasDamageEffect,
        normalHitRemainder: cannon.normalHitRemainder
      },
      context
    );

    target.shipState.underwaterStrengthUses =
      naval.strength - strengthRemaining;

    ensureShipRuntime(target);

    targetReports.push({
      version: 1,
      targetId,
      hpDamage,
      cannonImpacts,
      cannonSummary: cannon,
      numericReports,
      equipmentReports,
      strengthUsesBefore:
        startTarget.shipState.underwaterStrengthUses,
      strengthUsesAfter:
        target.shipState.underwaterStrengthUses,
      applied,

      // 不重置既有计时；本报告永久保留第一次实际进入记录。
      sinkingStarted: applied.sinkingStarted
        ? {
            ...applied.sinkingStarted,
            elapsedMinutes: scene.turn.elapsedMinutes
          }
        : null
    });
  }

  return { targetReports, effects };
}

/**
 * 自主攻击决策：
 * - 敌方攻击已识别的我方目标。
 * - 中立只反击曾攻击本阵营的、当前已识别的单位。
 * - 使用阶段开始状态，不使用本次序尚未结算的伤害。
 * - 候选命令经过原整批资源及命中预检。
 * - 不掷正式随机数、不扣弹、不保存。
 */
function appendAutonomousAttackCommands(scene) {
  if (!scene.controls?.enemyAutonomy) return;

  initializeAttackRuntime(scene);

  const start = getAttackPhaseStartScene(scene);

  // 不静默删除开启自主行动前保存的外方手动计划。
  if (scene.attackRuntime.commands.some(command => {
    const actor = unitFor(start, command.unitId);
    return actor.side !== "ally";
  })) {
    fail(
      "敵・中立の手動攻撃計画が残っています。" +
      "自律行動を無効にして、その計画を取り消してください。"
    );
  }

  const neutralAggressors = new Set();

  // 中立知道自身阵营遭到的攻击，不读取其他阵营私有计划。
  for (const record of scene.settlementRuntime.attackRecords) {
    for (const hit of record.hitReports) {
      const victim = start.instances.find(
        unit => unit.instanceId === hit.targetId
      );

      if (victim?.side === "neutral") {
        neutralAggressors.add(hit.unitId);
      }
    }
  }

  const actors = start.instances
    .filter(unit =>
      unit.side === "enemy" || unit.side === "neutral"
    )
    .sort((a, b) =>
      compareText(a.instanceId, b.instanceId)
    );

  // 已有锁定和本次序选定的射线目标统一管理。
  const rayTargets = new Map(
    start.rayTargetRuntime.locks
      .filter(lock => lock.turnNumber === start.turn.number)
      .map(lock => [lock.unitId, lock.targetId])
  );

  for (const actor of actors) {
    if (actor.branch !== "navy") {
      fail("海軍以外の自律攻撃は未接続です。");
    }

    if (
      ["sinking", "sunk"].includes(actor.shipState.status) ||
      actor.shipState.rescueTaskId !== null
    ) {
      continue;
    }

    const observedStart = {
      ...start,
      controls: {
        ...start.controls,
        enemyAutonomy: false,
        observationSide: actor.side
      }
    };

    const visibility = getVisibility(observedStart);

    const targets = start.instances.filter(target =>
      target.instanceId !== actor.instanceId &&
      target.side !== actor.side &&
      visibility.get(target.instanceId) === "identified" &&
      target.shipState?.status !== "sunk" &&
      (
        actor.side === "enemy"
          ? target.side === "ally"
          : neutralAggressors.has(target.instanceId)
      )
    ).sort((a, b) => {
      // 优先完成击沉，再以距离和稳定ID排序。
      const priority = unit =>
        unit.shipState?.status === "sinking" ? 0 :
        unit.shipState?.status === "heavy" ? 1 : 2;

      return (
        priority(a) - priority(b) ||
        Math.hypot(a.x - actor.x, a.y - actor.y) -
          Math.hypot(b.x - actor.x, b.y - actor.y) ||
        compareText(a.instanceId, b.instanceId)
      );
    });

    if (!targets.length) continue;

    const targetIds = new Set(
      targets.map(target => target.instanceId)
    );

    const groups = [...actor.equipmentState.groups]
      .sort((a, b) => compareText(a.id, b.id));

    for (const group of groups) {
      if (group.damaged || group.destroyed) continue;

      if (
        group.lastUsedTurn !== null &&
        group.lastUsedTurn > start.turn.number
      ) {
        fail("自律攻撃装備の使用記録が未来になっています。");
      }

      if (group.lastUsedTurn === start.turn.number) continue;

      const source = actor.snapshot.equipmentSnapshots.find(
        item => item.id === group.equipmentId
      );

      if (!source) {
        fail("自律攻撃装備の性能スナップショットがありません。");
      }

      // 支援装备不是攻击命令；原整批支援门禁仍保留。
      if (source.kind === "support") continue;

     const profile = readWeaponProfile(source, group);


if (profile.kind !== "weapon") continue;

const order = /^order-([1-5])$/.exec(start.turn.phaseId);

// 先判断是否属于本次序。
// 不属于本次序的装备不生成命令，
// 不因该装备的弹药登记问题阻断当前阶段。
if (profile.pasOnly) {
  if (start.turn.phaseId !== "pas") continue;
} else {
  if (!order) continue;

  if (
    !Number.isSafeInteger(profile.maxOrder) ||
    profile.maxOrder < 1 ||
    profile.maxOrder > 5
  ) {
    fail("自律攻撃装備の最高次序が未登録、または不正です。");
  }

  if (Number(order[1]) > profile.maxOrder) continue;
}

// 只有属于本次序的装备，才继续检查完整攻击性能。
// 缺失弹药、未支持规则等仍然明确拒绝，不伪造数据。
if (profile.issues.length) {
  fail(
    "自律攻撃装備の性能を確認できません。\n" +
    profile.issues.join("\n")
  );
}


      if (
        !Number.isSafeInteger(group.remainingAmmo) ||
        group.remainingAmmo < 0 ||
        !Number.isSafeInteger(profile.fullAmmoCost) ||
        profile.fullAmmoCost < 1
      ) {
        fail("自律攻撃装備の残弾または投射率が不正です。");
      }

      if (group.remainingAmmo === 0) continue;

      // 自主决策只选择能够完成正式投射的装备组。
     // 剩余弹药不足时，本组待机，不生成减量攻击命令。
    // 不影响其他装备组，也不阻塞全阵营阶段结算。
      if (group.remainingAmmo < profile.fullAmmoCost) {
     continue;
      }


      const scope = readWeaponTargetScope(profile.targetScope);
      const candidates = [];

      const singleAllowed =
        scope.kind === "single" ||
        profile.targetScope.trim() === "集群";

      if (singleAllowed) {
        for (const target of targets) {
          const locked = rayTargets.get(actor.instanceId);

          if (
            profile.guidance === "ray" &&
            locked &&
            locked !== target.instanceId
          ) {
            continue;
          }

          candidates.push({
            targetRef: {
              kind: "unit",
              id: target.instanceId
            },
            specifiedTargetIds: []
          });
        }
      }

      if (scope.kind === "range") {
        for (const formation of [...start.groups].sort(
          (a, b) => compareText(a.id, b.id)
        )) {
          const ref = { kind: "group", id: formation.id };
          const members = expandFormationMemberIds(start, ref);

          // 保留原主编队识别门禁：
          // 不采用含己方、未识别或其他战略目标的编队。
          if (
            !members.length ||
            members.some(id => !targetIds.has(id))
          ) {
            continue;
          }

          /*
           * 用现有目标解析器确定合法指定人数。
           * 不猜测scope的人数字段，不改变范围规则。
           */
          const specifications = [[]];

          for (let count = 1; count <= members.length; count++) {
            specifications.push(members.slice(0, count));
          }

          let validShape = null;

          for (const specifiedTargetIds of specifications) {
            const candidate = {
              targetRef: ref,
              specifiedTargetIds
            };

            try {
              readRangeCommandTarget(candidate, scope);
              validShape = candidate;
              break;
            } catch {
              // 这里只尝试纯目标结构，不运行规则或随机算法。
              // 若所有结构均失败，下面明确拒绝。
            }
          }

          if (!validShape) {
            fail(
              "範囲武器の自律目標指定を構成できません。" +
              "未対応の指定を省略して結算できません。"
            );
          }

          candidates.push(validShape);
        }
      }

      for (const target of candidates) {
        const command = {
          id: "autonomy:" + JSON.stringify([
            start.turn.number,
            start.turn.phaseId,
            actor.instanceId,
            group.id
          ]),
          status: "planned",
          turnNumber: start.turn.number,
          phaseId: start.turn.phaseId,
          unitId: actor.instanceId,
          groupId: group.id,
          ...copy(target),
          createdAt: scene.updatedAt,
          boundaries: []
        };

        if (target.targetRef.kind === "unit") {
          command.targetId = target.targetRef.id;
        }

        const trial = copy(scene);
        trial.attackRuntime.commands.push(command);

        try {
          initializeAttackRuntime(trial);

          const prepared = prepareAttackBatchResources(trial);

          prepareBatchHitChecks(
            trial,
            prepared,
            finalPreflight
          );
        } catch (error) {
          // 射程、射高、地形等明确资格失败允许换目标。
          // 坏数据、未实现效果和算法错误不得静默吞掉。
          if (
         error.code === "TARGET_INELIGIBLE" ||
         error.code === "BROADSIDE_QUOTA"
         ) {
         continue;
          }
 
          throw error;

        }

        scene.attackRuntime.commands.push(command);

        if (profile.guidance === "ray") {
          rayTargets.set(actor.instanceId, command.targetId);
        }

        // 每个装备组只生成一个命令。
        break;
      }
    }
  }

  initializeAttackRuntime(scene);
}

export function prepareSettlementAttackPlan(scene) {
  const working = copy(scene);

  initializeSettlementRuntime(working);

  for (const unit of working.instances) {
    ensureShipRuntime(unit);
    ensureUnitCombatRuntime(unit);
  }

  initializeRescueState(working);
  initializeRayTargetRuntime(working);

  settlementStep(
  "自律攻撃計画の作成・候補照合を完了できませんでした。",
  () => appendAutonomousAttackCommands(working)
);


  const prepared = settlementStep(
  "全陣営の攻撃計画・段階開始記録・資源条件を確認できませんでした。",
  () => prepareAttackBatchResources(working)
);


  const start = getAttackPhaseStartScene(working);

  assertStartStateUnchanged(working, start);

   if (prepared.entries.length > 0) {
  settlementStep(
    "支援装備または組数未登録の配置があるため、正式結算を停止しました。",
    () => assertNoUnconnectedSupport(start)
  );
}


  const checked = settlementStep(
  "射界・射距・目標資格・命中修正・威力処理の正式照合を完了できませんでした。",
  () => prepareBatchHitChecks(
    working,
    prepared,
    finalPreflight
  )
);

  const effectEntries = [];

  for (let index = 0; index < prepared.entries.length; index++) {
    const entry = prepared.entries[index];
    const check = checked.checks[index];

    if (check.kind === "single") {
      effectEntries.push(entry);
      continue;
    }

    // 所有合格候选在随机抽选前检查特殊效果算法。
    for (const targetId of check.range.eligibleIds) {
      effectEntries.push({
        ...entry,
        targetId
      });
    }
  }

  assertEffectAlgorithms(working, start, effectEntries);

  return {
  prepared,
  start,
  commands: copy(working.attackRuntime.commands)
};

}

// 只能从store的完整保存事务内部调用。
// 本函数另用工作副本，内部失败也不留下半结算。
export function settleAttackPhase(scene, coinSource) {
  if (
    !Object.hasOwn(NEXT_ATTACK_PHASE, scene.turn?.phaseId)
  ) {
    fail("正式攻撃を実行できる段階ではありません。");
  }

  if (
    coinSource !== undefined &&
    typeof coinSource !== "function"
  ) {
    fail("コイン関数の指定が不正です。");
  }

  const working = copy(scene);

  initializeSettlementRuntime(working);

  const context = contextFor(working);
  const key = recordKey(context.turnNumber, context.phaseId);

  if (working.settlementRuntime.attackRecords.some(record =>
    recordKey(record.turnNumber, record.phaseId) === key
  )) {
    fail("この攻撃段階はすでに結算済みです。");
  }

  for (const unit of working.instances) {
    ensureShipRuntime(unit);
    ensureUnitCombatRuntime(unit);
  }

  initializeRescueState(working);
  initializeRayTargetRuntime(working);

 const { prepared, start, commands } =
  prepareSettlementAttackPlan(working);

// 将确定性生成的自主计划放入同一个事务候选。
// 后续资源应用及命中复核都读取同一份命令。
working.attackRuntime.commands = commands;


  // 先验证全批当前装备资源并在候选副本扣弹。
  // 后续失败时，候选副本被丢弃，不保存扣弹。
  const resourceReports = applyAttackBatchResources(
    working,
    prepared
  );

  // 该接口重新执行全批正式预检，通过后才开始掷币。
  const hitStep = settlementStep(
  "範囲対象の選択・左右別使用数・正式命中判定を完了できませんでした。",
  () => resolveAttackBatchHitStep(
    working,
    prepared,
    finalPreflight,
    coinSource
  )
);

  const firingByCommand = new Map(
  hitStep.firingReports.map(report => [
    report.commandId,
    report.firingSides
  ])
);

for (const report of resourceReports) {
  const sides = firingByCommand.get(report.commandId);

  if (!sides) {
    fail("攻撃資源の射撃方向記録が不足しています。");
  }

  report.firingSides = copy(sides);
}

  const damage = summarizeTargets(
    working,
    start,
    prepared,
    hitStep,
    coinSource
  );

  recordSinkingStarts(
    working,
    damage.targetReports.map(report => report.applied)
  );
  const rayReports = [];

  // 发射即锁定，与是否命中无关。
  for (const entry of prepared.entries) {
    if (entry.profile.guidance !== "ray") continue;

    rayReports.push(registerRayTarget(
      working,
      {
        unitId: entry.unitId,
        targetId: entry.targetId
      },
      context
    ));
  }

  const effectReports = [];

  // 全部目标损伤先完成，再处理获取；
  // 本批最终沉没目标不再进行获取掷币。
  for (const effect of damage.effects) {
    effectReports.push(applyShipEffectAcquisition(
      unitFor(working, effect.targetId),
      {
        attackId: effect.attackId,
        type: effect.type
      },
      context,
      coinSource
    ));
  }

  const rescueInterruptions = reconcileActiveRescues(working);

  for (const unit of working.instances) {
    ensureShipRuntime(unit);
    ensureUnitCombatRuntime(unit);
  }

  initializeRescueState(working);

  const report = {
    version: 1,
    step: "attack-batch",
    turnNumber: context.turnNumber,
    phaseId: context.phaseId,
    elapsedMinutes: working.turn.elapsedMinutes,
    resourceReports,
    hitReports: hitStep.reports,
    rangeSelections: copy(hitStep.rangeSelections),
    targetReports: damage.targetReports,
    effectReports,
    rayReports,
    rescueInterruptions
  };

  working.settlementRuntime.attackRecords.push(copy(report));

  // 所有计划一起终结，绝不只清除当前观察阵营的计划。
  working.attackRuntime.commands = [];

  // 不推进回合号码，不推进30分钟。
  working.turn.phaseId = NEXT_ATTACK_PHASE[context.phaseId];

  initializeSettlementRuntime(working);

  // 只写回本正式事务负责的数据。
  scene.instances = working.instances;
  scene.rescueTasks = working.rescueTasks;
  scene.rayTargetRuntime = working.rayTargetRuntime;
  scene.attackRuntime = working.attackRuntime;
  scene.settlementRuntime = working.settlementRuntime;
  scene.phaseFinishRuntime = working.phaseFinishRuntime;
  scene.turn = working.turn;
  

  // 下一阶段快照由store.commit统一建立。
  return {
    turnNumber: context.turnNumber,
    phaseId: context.phaseId,
    nextPhaseId: working.turn.phaseId
  };
}
