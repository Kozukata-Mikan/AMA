import {launchProjectiles,dueProjectiles,markProjectileImpacts,initializeProjectiles} from './ballistic-projectiles.js?v=visual-support-bridge-1';
import {captureAttackPhaseStart} from './simulation-attack-batch.js?v=visual-support-bridge-1';
import {refreshElectronicEffects} from './electronic-warfare.js?v=visual-support-bridge-1';
import {spottingBonus} from './support-effects.js?v=visual-support-bridge-1';
import {manualPasEnabled} from './pas-control.js?v=day-catalog-pas-1';
import {airDisruptionPenalty} from './air-disruption.js?v=car-return-1';
import {resolveMartyrRams,aimedAircraftPosition} from './air-special-actions.js?v=visual-support-bridge-1';
import {resolveAceLosses} from './air-training-runtime.js?v=electronic-ballistic-1';
import {appendMissionAttacks,finishMissionAttacks} from './flight-missions.js?v=visual-support-bridge-1';
import {airborneUnit,checkAirAttackMode} from './air-ground-rules.js?v=car-return-1';
import {aircraftMayFly} from './aviation-time.js?v=visual-support-bridge-1';
import {preflightAirCombat,resolveAirCombat} from './air-combat.js?v=visual-support-bridge-1';
import {rebuildAircraftClusters} from './aviation-operations.js?v=visual-support-bridge-1';
import {buildingAlive,buildingMountAvailable,chooseBuildingSlot} from './building-state.js?v=visual-support-bridge-1';
import {readCombatTargetProfile,combatTargetState,applyCombatTargetDamage,resolveBuildingCannonImpact,buildingHitPosition,resolveAircraftCannonImpact} from './combat-target-runtime.js?v=visual-support-bridge-1';
import {explodeRunwayPayloads} from './aviation-detonation.js?v=visual-support-bridge-1';
import {aviationRunways,reconcileAviation} from './aviation-operations.js?v=visual-support-bridge-1';
import {choosePosition} from './cannon-damage-runtime.js?v=car-return-1';
import {hasAircraftTemplate,aircraftCanAct} from './aircraft-runtime.js?v=electronic-ballistic-1';
import { STATION_IDS, supportEffectOf, hasSupportEquipment } from "./support-equipment.js?v=visual-support-bridge-1";
import { navalHeight, isSubmerged } from "./naval-kind.js?v=catalog-layout-2";
import {captureRoundWitnesses} from "./simulation-round-report.js?v=visual-support-bridge-1";
import {parseDamageRule} from "./weapon-damage-rule.js?v=visual-support-bridge-1";
import {copySceneWithSpecialHistory} from './special-history-snapshot.js';
import {
  prepareAttackBatchResources,
  createAutonomousAttackValidator,
  getAttackPhaseStartScene,
  applyAttackBatchResources,
  resolveAttackBatchHitStep,
  prepareAttackCommandPreview,
  createAttackCommandPreviewer,
  prepareBatchHitChecks
} from "./simulation-attack-batch.js?v=visual-support-bridge-1";



import {
  ensureShipRuntime,
  readShipProfile,
  getReconConditions,
  applyShipDamageAttack,
  applyShipEffectAcquisition
} from "./ship-runtime.js?v=visual-support-bridge-1";

import {
  ensureUnitCombatRuntime
} from "./equipment-runtime.js?v=visual-support-bridge-1";

import {
  getObserverVisibility,
  getEquipmentReconSourceVisibility
} from "./simulation-features.js?v=visual-support-bridge-1";

import {
  getEquipmentDamagePlan,
  validateEquipmentImpactReport
} from "./equipment-damage-runtime.js?v=visual-support-bridge-1";

import {
  ensureEquipmentItemRuntime,
  applyEquipmentAttack
} from "./equipment-item-runtime.js?v=visual-support-bridge-1";


import {
  traceAttackTerrainLine,
  entersTerrainInterior
} from "./attack-terrain-runtime.js";

import { sampleTerrain } from "./terrain-data.js";

import {
  getHitModifiers
} from "./weapon-hit-runtime.js?v=visual-support-bridge-1";

import {
  getCannonDamagePreview,
  resolveCannonImpact,
  summarizeCannonImpacts
} from "./cannon-damage-runtime.js?v=car-return-1";

import {
  resolveNumericDamage
} from "./numeric-damage-runtime.js?v=car-return-1";

import {
  initializeRayTargetRuntime,
  checkRayTarget,
  registerRayTarget
} from "./ray-target-runtime.js";

import {
  initializeRescueState,
  reconcileActiveRescues
} from "./simulation-rescue.js?v=visual-support-bridge-1";

import {
  recordSinkingStarts
} from "./simulation-phase-finish.js?v=visual-support-bridge-1";


import {
  readWeaponTargetScope
} from "./weapon-profile-runtime.js?v=visual-support-bridge-1";

import {
  initializeAttackRuntime
} from "./simulation-attack-runtime.js?v=visual-support-bridge-1";

import {
  readWeaponProfile
} from "./weapon-profile-runtime.js?v=visual-support-bridge-1";

import {
  getVisibility
} from "./simulation-features.js?v=visual-support-bridge-1";

import {
  expandFormationMemberIds
} from "./formation-target-runtime.js?v=visual-support-bridge-1";

import {
  readRangeCommandTarget
} from "./simulation-range-command.js?v=visual-support-bridge-1";

import {
  readFiringArc,
  assertBroadsideQuotas, assertPlannedBroadsideQuotas
} from "./weapon-firing-arc.js?v=blast-area-1";

import {
  prepareRangeProjection
} from "./range-projection-runtime.js?v=visual-support-bridge-1";

import {
  initializeRoundTraitRuntime,
  resolveRoundTraits,
  readOneAgainstThousandBonus
} from "./simulation-round-trait-runtime.js";


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

/**
 * 每枚已命中的水下弹药独立进行诱爆判定。
 *
 * true：进入正常伤害算法。
 * false：不造成伤害、不获取进水、不消耗强度次数。
 *
 * 只由正式伤害步骤调用。
 * 不修改原始武器命中数，不扣弹、不保存。
 */
function resolveUnderwaterDetonation(hitCount, coinSource) {
  integer(hitCount, "誘爆対象の命中数");

  if (
    coinSource !== undefined &&
    typeof coinSource !== "function"
  ) {
    fail("誘爆判定の乱数関数が不正です。");
  }

  const results = [];
  let damageHitCount = 0;

  for (let index = 0; index < hitCount; index++) {
    let result;

    if (coinSource !== undefined) {
      result = coinSource();
    } else {
      if (!globalThis.crypto?.getRandomValues) {
        fail("誘爆判定に必要な乱数機能がありません。");
      }

      const buffer = new Uint32Array(1);
      globalThis.crypto.getRandomValues(buffer);

      // 32位均匀随机整数的最低位，正反各半。
      result = (buffer[0] & 1) === 1;
    }

    if (typeof result !== "boolean") {
      fail("誘爆判定の硬貨結果が不正です。");
    }

    results.push(result);

    if (result) {
      damageHitCount += 1;
    }
  }

  return {
    version: 1,
    results,
    damageHitCount
  };
}

/**
 * 读取伤害有效命中数，同时检查诱爆记录。
 *
 * 旧历史没有诱爆字段，沿用原始命中数。
 * 不给旧记录补掷诱爆，不重写旧伤害。
 */
function readDamageHitCount(hitReport) {
  const originalHitCount = integer(
    hitReport?.hit?.hitCount,
    "武器命中数"
  );

  const detonation = hitReport.underwaterDetonation;

  if (detonation === undefined) {
    return originalHitCount;
  }

  if (
    !detonation ||
    typeof detonation !== "object" ||
    Array.isArray(detonation) ||
    detonation.version !== 1 ||
    !Array.isArray(detonation.results) ||
    detonation.results.length !== originalHitCount ||
    detonation.results.some(
      result => typeof result !== "boolean"
    ) ||
    !Number.isSafeInteger(detonation.damageHitCount) ||
    detonation.damageHitCount < 0 ||
    detonation.damageHitCount !==
      detonation.results.filter(result => result).length
  ) {
    fail("水中武器の誘爆履歴が武器命中数と一致しません。");
  }

  return detonation.damageHitCount;
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

    // 新记录检查逐枚诱爆结果。
    // 旧记录没有该字段时保持原有语义，不补造结果。
    for (const hit of record.hitReports) {
      if (hit?.underwaterDetonation !== undefined) {
        readDamageHitCount(hit);
      }
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
        const emptyBlast=selection?.blast&&Number.isFinite(selection.blast.radius)&&selection.blast.radius>=0&&['x','y','z'].every(k=>Number.isFinite(selection.blast.center?.[k]))&&selection.candidateIds?.length===0&&selection.selections?.length===0&&selection.occurrences?.length===0;
        if (
          !selection ||
          selection.version !== 1 ||
          typeof selection.commandId !== "string" ||
          selection.commandId.trim() === "" ||
          selectionCommands.has(selection.commandId) ||
          !["all", "specified", "random"].includes(selection.mode) ||
          !Array.isArray(selection.candidateIds) ||
          (selection.candidateIds.length === 0&&!emptyBlast) ||
          selection.candidateIds.some(
            id => typeof id !== "string" || id.trim() === ""
          ) ||
          new Set(selection.candidateIds).size !==
            selection.candidateIds.length ||
          !Array.isArray(selection.selections) ||
          !Array.isArray(selection.occurrences) ||
          (selection.occurrences.length === 0&&!emptyBlast)
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
      equipment.damage.hitCount !== readDamageHitCount(hits[0]) ||
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

  const z = unit.branch==='building'?sample.surface:hasAircraftTemplate(unit)?unit.altitude:navalHeight(unit,sample);

  if (!Number.isFinite(z)) {
    fail("攻撃位置の高さが不正です。");
  }

  return { x: unit.x, y: unit.y, z };
}



function trainingModifiers(scene, actor, target, underwaterWeapon ,roundTraitOptions = {}) {
  if(hasAircraftTemplate(actor))return{bonuses:0,penalties:0};
  const traits = new Set([
    ...actor.trainingState.baseTraits,
    ...actor.trainingState.acquiredTraits
  ]);

  let bonuses = 0;
  let penalties = 0;

  const period = getReconConditions(scene.environment).period.id;
  const naval = actor.branch==='building'?actor.snapshot.naval:readShipProfile(actor);

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
        bonuses += readOneAgainstThousandBonus({
          actor,
          turnNumber: scene.turn.number,
          runtime: roundTraitOptions.runtime,
          requireResolved:
            roundTraitOptions.requireResolved === true
        });
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
  // 组数未登记的安装记录暂不参与战斗。
  // 不补造组数、不生成装备组、不修改部署快照。
  //
  // 已生成装备组的支援效果仍保留原有保护，
  // 避免把真实存在的支援修正擅自当成0。
  for (const unit of scene.instances) {
    if (unit.branch === "building" || hasAircraftTemplate(unit)) continue;
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

      if (source?.kind === "support" && !STATION_IDS.includes(supportEffectOf(source))) {
        fail(
          "支援装備の電子効果・追加効果の照合が未接続です。" +
          "補正を0として代用せず、結算を停止します。"
        );
      }
    }

    // unresolvedMountIndexes中的安装记录不参与结算。
  }
}


function finalPreflight(start, entry ,roundTraitOptions = {}) {
  if(entry.profile.large)return finalPreflight(start,{...entry,blastAimOnly:true,profile:{...entry.profile,large:false,targetScope:"範囲（全体）"}},roundTraitOptions);
  const actor = unitFor(start, entry.unitId);
  const target = entry.blastAimOnly?actor:unitFor(start, entry.targetId);
  const profile = entry.profile;
  const targetProfile = readCombatTargetProfile(target);

  const scope = readWeaponTargetScope(
    profile.targetScope
  );

  // 明确的目标资格失败：
  // 范围预检可以排除该成员。
  // 单体攻击没有替代目标，仍然拒绝。
    function ineligible(message, skipAttack = false) {
    const error = new Error(message);
    error.code = "TARGET_INELIGIBLE";
    error.skipAttack = skipAttack;
    throw error;
  }


  if (
    (!entry.area && (actor.instanceId === target.instanceId || actor.side === target.side)) ||
    !entry.blastAimOnly && combatTargetState(target)?.status === "destroyed" || combatTargetState(target)?.status === "sunk" || target.branch==='building'&&target.currentHp===0
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
  !["group","point"].includes(entry.targetRef?.kind)
) {
  fail("範囲武器の主目標が不正です。");
}


  const firingGroup = actor.equipmentState.groups.find(
  group => group.id === entry.groupId
);

if (!firingGroup) {
  fail("射界判定の装備組を確認できません。");
}

try {
  readFiringArc(actor, firingGroup, entry.area?{...target,...entry.area.center}:target);
} catch (error) {
  // 只有目标确实在射界外时，允许跳过本条攻击。
  // 装备位置资料错误等其他异常仍向上抛出。
  if (error.code === "TARGET_INELIGIBLE") {
    error.skipAttack = true;
  }

  throw error;
}


    let damageRule;

  try {
    damageRule = parseDamageRule(profile);
  } catch (error) {
    // 仅供开发者控制台诊断。
    // 不加入页面反馈、观察导出或正式战斗记录。
    console.error(
      "[威力规则诊断]",
      {
        unitName: actor.name,
        unitId: actor.instanceId,
        side: actor.side,
        weaponLabel: profile.label,
        equipmentId: firingGroup.equipmentId,
        groupId: firingGroup.id,
        position: firingGroup.position,
        groupIndex: firingGroup.groupIndex,
        targetName: target.name,
        powerRule: profile.powerRule,
        powerRuleType: typeof profile.powerRule,
        powerRuleJSON: JSON.stringify(profile.powerRule)
      },
      error
    );

    console.error(
      "[实际威力字段] " +
      "装备=" + profile.label +
      "；类型=" + typeof profile.powerRule +
      "；值=" + JSON.stringify(profile.powerRule)
    );
    // 保留原异常，不跳过攻击、不改变事务行为。
    throw error;
  }


  // 目标资格与伤害规则分开检查。
  const underwaterWeapon =
    profile.underwater === true ||
    damageRule.underwater;

  if (isSubmerged(actor) && !underwaterWeapon) ineligible("潜航中の水中艦は水中武器のみ使用できます。");

  const from = navalPoint(start, actor);
  const to = entry.area?.center ?? navalPoint(start, target);

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
    (entry.area?to.z<0:target.underwater === true) ||
    relativeHeight < -EPSILON && !airborneUnit(actor)
  ) {
    ineligible(
      "通常武器は水中・下方の目標を攻撃できません。"
    );
  }

  const airAttack = profile.pasOnly ? {penalty:0} : checkAirAttackMode(actor,entry.area?{branch:'navy',snapshot:{naval:{kind:'surface'}}}:target,entry.attackMethod,from.z,to.z);

  const rangeExceeded =
    trace.distance3D > profile.range + EPSILON;

  const heightExceeded =
    relativeHeight > profile.ceilingU + EPSILON;

  if (rangeExceeded || heightExceeded) {
    const sideLabels = {
      ally: "味方",
      enemy: "敵",
      neutral: "中立"
    };

    const actorLabel =
      `${actor.name}（${sideLabels[actor.side] ?? "不明"}）`;

    const targetLabel =
      `${target.name}（${sideLabels[target.side] ?? "不明"}）`;

    const reasons = [];

    if (rangeExceeded) {
      reasons.push("三次元距離が射距を超えています。");
    }

    if (heightExceeded) {
      reasons.push("目標との相対高度が射高を超えています。");
    }

    ineligible([
      ...reasons,
      `攻撃側：${actorLabel}`,
      `目標：${targetLabel}`,
      `兵装：${profile.label ?? "名称未登録"}`,
      `装備組：${firingGroup.position} / 第${firingGroup.groupIndex + 1}組`,
      `三次元距離：${trace.distance3D.toFixed(3)} / 射距：${profile.range ?? "未登録"}`,
      `相対射高：${relativeHeight.toFixed(3)} / 射高上限：${profile.ceilingU ?? "未登録"}`,
      `発射位置の高さ：${from.z.toFixed(3)}`,
      `目標位置の高さ：${to.z.toFixed(3)}`
     ].join("\n"), true);
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
      if (!entry.area && (
        getObserverVisibility(
          start,
          actor,
          target
        ) === null)
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

  if(entry.blastAimOnly)return {allowed:true,commandId:entry.commandId,bonuses:0,penalties:0};
  if(hasAircraftTemplate(target)&&!['airborne','landing'].includes(target.aircraftState?.mission))ineligible('駐機中・離陸待機中の機体は対空射撃の対象外です。');
  if(!entry.area&&hasAircraftTemplate(actor)&&hasAircraftTemplate(target)&&!profile.pasOnly)ineligible('航空機同士の攻撃は空戦計画から指定してください。');
  if(hasAircraftTemplate(target)&&(damageRule.kind==='equipment'||damageRule.underwater||profile.large||profile.guidance==='inertial'))ineligible('航空機への射撃は通常の数字威力・艦砲威力に対応しています。専用威力・慣性防御は後続規則が必要です。');
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
        combatTargetState(target).underwaterStrengthUses
    });
  }

  const training = trainingModifiers(
    start,
    actor,
    target,
    underwaterWeapon,
    roundTraitOptions
  );

    // 超过武器射距的一半，增加一次远距离不利判定。
  // 沿用正式射距检查的三维距离与浮点容差。
  const longRangePenalty =
    trace.distance3D > profile.range / 2 + EPSILON
      ? 1
      : 0;

  const modifiers = getHitModifiers({
    guidance: profile.guidance,
    environment: start.environment,
    targetIlluminated:target.searchlightIlluminated===true,
    trainingBonuses: training.bonuses,
    trainingPenalties: training.penalties,
    electronicBonuses: 0,
    electronicPenalties: 0,
    globalBonuses: spottingBonus(actor),
    globalPenalties: longRangePenalty + airAttack.penalty + airDisruptionPenalty(start, actor)
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
  const runtime = unit.branch !== "navy" ? null : ensureEquipmentItemRuntime(checked);

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
      JSON.stringify(current.buildingState)!==JSON.stringify(oldUnit.buildingState) ||
      JSON.stringify(current.aircraftState?{...current.aircraftState,flightPlan:undefined}:undefined)!==JSON.stringify(oldUnit.aircraftState?{...oldUnit.aircraftState,flightPlan:undefined}:undefined) ||
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

    if (type === null || target.branch==='building'||hasAircraftTemplate(target)) continue;

    // 隔离副本上的确定性支持检查，不消耗正式随机数。
    applyShipEffectAcquisition(
      copy(target),
      { attackId: entry.commandId, type },
      context,
      () => false
    );
  }
}

function settleBuildingHits(scene,startTarget,target,attacks,context,coin){
 const profile=readCombatTargetProfile(startTarget),hits=[],positions=[],cannonImpacts=[],numericReports=[];let strengthRemaining=profile.strength-combatTargetState(startTarget).underwaterStrengthUses;
 const sorted=[...attacks].sort((a,b)=>Number(b.rule.underwater)-Number(a.rule.underwater)||(a.rule.underwater?b.rule.power-a.rule.power:0)||compareText(a.entry.commandId,b.entry.commandId));
 for(const a of sorted){
  if(a.rule.kind==='equipment')fail('建築への設備威力は配置耐性への換算規則が必要です。');
  for(let i=0;i<a.hitCount;i++){
   if(a.rule.kind==='cannon'){
    const impact=resolveBuildingCannonImpact({penetration:a.entry.profile.penetration,armor:a.entry.profile.guidance==='inertial'?profile.strengthArmor:profile.armor},coin,target);
    hits.push({mountId:impact.position.mountId,normalCredits:impact.normalCredits,fireEligible:impact.fireEligible});positions.push(impact.position.mountId);cannonImpacts.push({commandId:a.entry.commandId,impactIndex:i,impact});
   }else{
    const slot=chooseBuildingSlot(target,coin),damage=resolveNumericDamage({powerRule:a.entry.profile.powerRule,hitCount:1,penetration:a.entry.profile.penetration,armor:profile.armor,inertial:a.entry.profile.guidance==='inertial',strength:profile.strength,strengthRemaining});
    if(a.rule.underwater)strengthRemaining=damage.strengthRemainingAfter;
    hits.push({mountId:slot.id,damage:damage.hpDamage});positions.push(slot.id);numericReports.push({commandId:a.entry.commandId,occurrenceIndex:a.entry.occurrenceIndex,damage,mountId:slot.id});
   }
  }
 }
 const detonation=explodeRunwayPayloads(scene,target,positions,coin,strengthRemaining);hits.push(...detonation.buildingHits);strengthRemaining-=detonation.strengthConsumed??0;
 const applied=applyCombatTargetDamage(target,{attackId:recordKey(context.turnNumber,context.phaseId)+':'+target.instanceId,hpDamage:0,hasDamageEffect:hits.length>0,buildingHits:hits,coinSource:coin},context);
 target.buildingState.underwaterStrengthUses=profile.strength-strengthRemaining;
 return{version:2,targetId:target.instanceId,hpDamage:applied.hpDamage,applied,detonation,cannonImpacts,numericReports,equipmentReports:[],cannonSummary:summarizeCannonImpacts(cannonImpacts.map(i=>i.impact),0),sinkingStarted:null};
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
      rule: parseDamageRule(entry.profile),

      // 仅内部引用，用于向正式命中报告追加诱爆记录。
      // 不修改 hit.hit.hitCount。
      hitReport: hit
    });

  }

  for (const entry of prepared.entries) {
    const indexes = occurrencesByCommand.get(entry.commandId);

    if (!indexes || indexes.size === 0) {
      const selected=hitStep.rangeSelections?.find(s=>s.commandId===entry.commandId);
      if(entry.area&&selected?.occurrences.length===0)continue;
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
  const queuedAircraftHosts=new Set(scene.instances.filter(p=>p.aircraftState&&['ready','launching'].includes(p.aircraftState.mission)&&p.aircraftState.status!=='destroyed').map(p=>p.aircraftState.hostId));
  const effects = [];
  const context = contextFor(scene);

  for (const targetId of [...grouped.keys()].sort(compareText)) {
    const startTarget = unitFor(start, targetId);
    const target = unitFor(scene, targetId);
    const naval = readCombatTargetProfile(startTarget);
    const attacks = grouped.get(targetId);

    const cannonImpacts = [];
    const runwayPositions=[];
    const targetRunways=queuedAircraftHosts.has(targetId)?aviationRunways(target):[];
    const numericReports = [];
    const equipmentReports = [];
    let hpDamage = 0;
    let hasDamageEffect = false;
    let strengthRemaining =
      naval.strength -
      combatTargetState(startTarget).underwaterStrengthUses;

    // 硬币调用顺序按稳定装备键，而非传入计划列表。
    attacks.sort((a, b) =>
      compareText(a.entry.unitId, b.entry.unitId) ||
      compareText(a.entry.groupId, b.entry.groupId) ||
      a.entry.occurrenceIndex - b.entry.occurrenceIndex
    );

        // 原始武器命中已经确定。
    // 在本目标的伤害处理前，按稳定顺序逐枚判定诱爆。
    for (const attack of attacks) {
      const underwaterWeapon =
        attack.entry.profile.underwater === true ||
        attack.rule.underwater === true;

      if (!underwaterWeapon) {
        continue;
      }

      // 正式命中报告应为本事务新生成的结果，
      // 不接受预先带入的诱爆记录，也不重复投币。
      if (
        attack.hitReport.underwaterDetonation !== undefined
      ) {
        fail("誘爆判定が重複しています。");
      }

      const detonation = resolveUnderwaterDetonation(
        attack.hitCount,
        coinSource
      );

      attack.hitReport.underwaterDetonation =
        copy(detonation);

      // 只替换内部伤害命中数。
      // 后面的伤害、进水与强度消耗沿用该值。
      attack.hitCount = readDamageHitCount(
        attack.hitReport
      );
    }


    if(target.branch==='building'){targetReports.push(settleBuildingHits(scene,startTarget,target,attacks,context,coinSource));continue;}

    for (const attack of attacks) {
      if (attack.rule.kind !== "cannon") continue;

      const armor = attack.entry.profile.guidance === "inertial"
        ? naval.strengthArmor
        : naval.armor;

      for (let index = 0; index < attack.hitCount; index++) {
        const firingActor=unitFor(start,attack.entry.unitId),firingGroup=firingActor.equipmentState.groups.find(g=>g.id===attack.entry.groupId),aimedPosition=aimedAircraftPosition(firingActor,target,firingGroup,attack.entry.profile);
        const impact = hasAircraftTemplate(target)?resolveAircraftCannonImpact({penetration:attack.entry.profile.penetration,armor},coinSource):target.branch==='building' ? resolveBuildingCannonImpact({penetration:attack.entry.profile.penetration,armor},coinSource) : coinSource === undefined
          ? resolveCannonImpact({
              penetration: attack.entry.profile.penetration,
              armor,aimedPosition
            })
          : resolveCannonImpact({
              penetration: attack.entry.profile.penetration,
              armor,aimedPosition
            }, coinSource);

        cannonImpacts.push({
          commandId: attack.entry.commandId,
          occurrenceIndex: attack.entry.occurrenceIndex,
          impactIndex: index,
          impact
        });


        if(targetRunways.length)runwayPositions.push(impact.position.label);
        if (impact.fireEligible && target.branch!=='building'&&!target.projectileState) {
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
      combatTargetState(startTarget).normalHitRemainder
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
        for (let index = 0; index < attack.hitCount && target.branch!=='building'; index++) {
          effects.push({
            targetId,
            attackId: attack.entry.commandId,
            type: "flooding"
          });
        }
      }

      if(targetRunways.length)for(let n=0;n<attack.hitCount;n++)runwayPositions.push(target.branch==='building'?buildingHitPosition(coinSource):(aimedAircraftPosition(unitFor(start,attack.entry.unitId),target,unitFor(start,attack.entry.unitId).equipmentState.groups.find(g=>g.id===attack.entry.groupId),attack.entry.profile)??choosePosition(coinSource)).label);
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

    const detonation=explodeRunwayPayloads(scene,target,runwayPositions,coinSource,strengthRemaining);
    effects.push(...detonation.effects);
    const combinedRemainder=cannon.normalHitRemainder+detonation.normalHitRemainder-(combatTargetState(target).normalHitRemainder??0);
    hpDamage+=detonation.hpDamage+Math.floor(combinedRemainder/3);hasDamageEffect||=detonation.hasDamageEffect;strengthRemaining-=detonation.strengthConsumed??0;
    // Resolve optional self-sealing aircraft between weapon applications, not
    // once after the phase-wide damage total. Preserve simultaneous shot rolls.
    let aircraftApplications;
    if(hasAircraftTemplate(target)&&target.snapshot.aircraft.selfSealingTank===true){
      let remainder=combatTargetState(startTarget).normalHitRemainder;
      const credits=new Map(),numbers=new Map(),key=(commandId,index)=>JSON.stringify([commandId,index]);
      for(const report of cannonImpacts){const k=key(report.commandId,report.occurrenceIndex);credits.set(k,(credits.get(k)??0)+report.impact.normalCredits);}
      for(const report of numericReports){const k=key(report.commandId,report.occurrenceIndex);numbers.set(k,(numbers.get(k)??0)+report.damage.hpDamage);}
      aircraftApplications=attacks.map(attack=>{const k=key(attack.entry.commandId,attack.entry.occurrenceIndex),total=remainder+(credits.get(k)??0),damage=Math.floor(total/3)+(numbers.get(k)??0);remainder=total%3;return{commandId:attack.entry.commandId,occurrenceIndex:attack.entry.occurrenceIndex,hit:attack.hitCount>0,durabilityDamage:damage,normalHitRemainder:remainder};});
    }
    const applied = applyCombatTargetDamage(
      target,
      {
        ...(aircraftApplications?{aircraftApplications}:{}),
        attackId: recordKey(context.turnNumber, context.phaseId) +
          ":" + targetId,
        kind: "batch",
        hitCount:attacks.reduce((n,a)=>n+a.hitCount,0),
        hpDamage,
        hasDamageEffect,
        normalHitRemainder: ((combinedRemainder%3)+3)%3
      },
      context
    );

    combatTargetState(target).underwaterStrengthUses =
      naval.strength - strengthRemaining;

    ensureShipRuntime(target);

    targetReports.push({
      version: 1,
      targetId,
      hpDamage,
      detonation,
      cannonImpacts,
      cannonSummary: cannon,
      numericReports,
      equipmentReports,
      strengthUsesBefore:
        combatTargetState(startTarget).underwaterStrengthUses,
      strengthUsesAfter:
        combatTargetState(target).underwaterStrengthUses,
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
  const automaticPas=scene.turn.phaseId==='pas';
  if (!scene.controls?.enemyAutonomy&&!automaticPas) return;

  initializeAttackRuntime(scene);
  if(automaticPas)scene.attackRuntime.commands=scene.attackRuntime.commands.filter(c=>{const u=scene.instances.find(u=>u.instanceId===c.unitId),g=u?.equipmentState.groups.find(g=>g.id===c.groupId),e=u?.snapshot.equipmentSnapshots.find(e=>e.id===g?.equipmentId);return !e||!readWeaponProfile(e,g).pasOnly||manualPasEnabled(scene,u.side);});

  const start = getAttackPhaseStartScene(scene);

  // 不静默删除开启自主行动前保存的外方手动计划。
  if (!automaticPas && scene.attackRuntime.commands.some(command => {
    const actor = unitFor(start, command.unitId);
    return actor.side !== "ally";
  })) {
    fail(
      "敵・中立の手動攻撃計画が残っています。" +
      "自律行動を無効にして、その計画を取り消してください。"
    );
  }

  // 先检查原有计划和历史。
// 原有计划已经超限或历史资料错误，仍必须明确拒绝。
// 后面只能跳过由新增自主候选造成的配额超限。
const validateCandidate = createAutonomousAttackValidator(scene, finalPreflight);

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
    .filter(unit => !unit.projectileState &&
      (!automaticPas||!manualPasEnabled(scene,unit.side)) &&
      (!hasAircraftTemplate(unit)||automaticPas&&aircraftCanAct(unit,'defend')&&aircraftMayFly(start,unit)) && (!automaticPas||(unit.snapshot.equipmentSnapshots??[]).some(e=>e.kind==='weapon'&&String(e.maxOrder).toUpperCase()==='PAS')) && (["navy","building"].includes(unit.branch) || automaticPas&&hasAircraftTemplate(unit) || !hasSupportEquipment(unit)) && (automaticPas || unit.side === "enemy" || unit.side === "neutral")
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

  // PAS needs visibility only for targets in reach of at least one participating battery.
  const pasVisibilityTargets=new Map();
  if(automaticPas)for(const actor of actors){
    const equipment=new Map(actor.snapshot.equipmentSnapshots.map(e=>[e.id,e]));let range=0;
    for(const g of actor.equipmentState.groups){const e=equipment.get(g.equipmentId);if(e?.kind==='weapon'&&String(e.maxOrder).toUpperCase()==='PAS')range=Math.max(range,Number.isFinite(e.range)?e.range:Infinity);}
    if(!pasVisibilityTargets.has(actor.side))pasVisibilityTargets.set(actor.side,new Set());const ids=pasVisibilityTargets.get(actor.side);
    for(const target of start.instances)if(target.side!==actor.side&&Math.hypot(target.x-actor.x,target.y-actor.y)<=range+EPSILON)ids.add(target.instanceId);
  }
  // All actors plan from the same phase-start state. Plans do not mutate start.
  const visibilityBySide=new Map();
  for (const actor of actors) {
    if (!["navy","building"].includes(actor.branch)&&!(automaticPas&&hasAircraftTemplate(actor))) {
      fail("海軍以外の自律攻撃は未接続です。");
    }

    if (
      actor.branch==='building'&&!buildingAlive(actor) ||
      actor.airshipBaseState&&actor.airshipBaseState.mission!=='airborne' ||
      ["sinking", "sunk"].includes(actor.shipState?.status) ||
      actor.rescueSupportLocked || actor.shipState?.rescueTaskId != null
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

    if(!visibilityBySide.has(actor.side))visibilityBySide.set(actor.side,getVisibility(observedStart,automaticPas?pasVisibilityTargets.get(actor.side):undefined));
    const visibility = visibilityBySide.get(actor.side);

    const targets = start.instances.filter(target =>
      (!hasAircraftTemplate(target)||['airborne','landing'].includes(target.aircraftState.mission)&&target.aircraftState.status!=='destroyed') &&
      target.instanceId !== actor.instanceId &&
      target.side !== actor.side &&
      visibility.get(target.instanceId) === "identified" &&
      target.shipState?.status !== "sunk" && (target.branch!=='building'||target.currentHp>0) &&
      (
        actor.side === "enemy" ? target.side === "ally" : actor.side==='ally'?target.side==='enemy':neutralAggressors.has(target.instanceId)
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

      if (scene.attackRuntime.commands.some(command =>
      command.unitId === actor.instanceId &&
      command.groupId === group.id
      )) {
      continue;
      }

      if (group.damaged || group.destroyed || !buildingMountAvailable(actor,group.mountIndex)) continue;

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


if (profile.kind !== "weapon" || profile.large) continue;
if(hasAircraftTemplate(actor)&&!aircraftCanAct(actor,profile.pasOnly&&group.position==='自衛武器'?'defend':'attack'))continue;

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
          // Airships already have BVR in their allowed mode set. Autonomous
          // fire must supply a mode just like a manually registered shot.
          ...(airborneUnit(actor)&&!profile.pasOnly?{attackMethod:'bvr'}:{}),
          ...copy(target),
          createdAt: scene.updatedAt,
          boundaries: []
        };

        if (target.targetRef.kind === "unit") {
          command.targetId = target.targetRef.id;
        }

        try {
          validateCandidate(command);
          } catch (error) {
          // 当前新增自律候选没有合法目标，尝试下一个。
          // 范围零候选只在此处跳过，不放宽已有计划检查。
          if (
            error.code === "TARGET_INELIGIBLE" ||
            error.code === "RANGE_NO_ELIGIBLE_TARGETS"
          ) {
            continue;
          }


         // 原有计划已通过基线检查。
        // 新增自主候选超过侧别配额时，尝试其他目标。
       // 所有目标均失败则本装备组待机，不生成命令。
      if (error.code === "BROADSIDE_QUOTA") {
       continue;
      }

       // 缺失历史、重复使用、坏数据、未实现效果等，
       // 仍然停止整批，不静默跳过。
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

/**
 * 对未来计划执行当前状态检查。
 * 不生成未来阶段快照，不掷正式随机数，不扣弹。
 * 到执行次序时仍须重新执行全部正式检查。
 */
export function validateDeferredAttackPlans(
  scene,
  commands,
  { includeCurrent = false, onChecked = null } = {},
  previewCommand = prepareAttackCommandPreview
) {
  const entries = [];
  for (const command of commands) {
    if (
      !includeCurrent &&
      command.phaseId === scene.turn.phaseId
    ) {
      continue;
    }


    const { current, entry } =
      previewCommand(scene, command);

    const observedCurrent = {
      ...current,
      controls: {
        ...current.controls,
        enemyAutonomy: false,
        observationSide: entry.side
      }
    };

    const effectEntries = [];
    let quotaCheck;

        const singleTarget =
      entry.scope.kind === "single" ||
      (
        entry.profile.targetScope.trim() === "集群" &&
        entry.targetRef?.kind === "unit"
      );

    if (singleTarget) {

      finalPreflight(observedCurrent, entry);
      quotaCheck={kind:"single"};
      effectEntries.push(entry);
    } else {
      const range = prepareRangeProjection({
        startScene: observedCurrent,
        commandId: entry.commandId,
        actorId: entry.unitId,
        targetRef: entry.targetRef,
        scope: entry.scope,
        projection: entry.projection,
        guidance: entry.profile.guidance,
        area: entry.area,
        aimCheck:()=>finalPreflight(observedCurrent,{...entry,blastAimOnly:true}),
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

          return {
            targetId: target.instanceId,
            allowed: true,
            bonuses: result.bonuses,
            penalties: result.penalties
          };
        } catch (error) {
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

      quotaCheck={kind:"range",range};
      for (const targetId of range.eligibleIds) {
        effectEntries.push({
          ...entry,
          targetId
        });
      }
    }

    assertEffectAlgorithms(current, current, effectEntries);
    onChecked?.({current,entry,check:quotaCheck});
    entries.push(entry);
  }
  return entries;
}

export function createDeferredAttackValidator(scene) {
  const preview = createAttackCommandPreviewer(scene);
  return commands => validateDeferredAttackPlans(scene,commands,{includeCurrent:true},(_,command)=>preview(command));
}

// 只筛掉明确可跳过的射距、射高、射界错误。
// 不投币、不扣弹；其他错误仍中断整个事务。
// 单体攻击：先检查几何，再按固定顺序分配本回合侧别额度。
// 范围攻击保留原来的候选检查与实际投射配额检查。
// 不投币、不扣弹、不修改输入场景。
export function filterUnreachableAttackCommands(
  scene,
  commands,
  {
    priorityCommandIds = [],
    skippableTargetCommandIds = [],
    skipUnavailableActors = false
  } = {}
) {
  const accepted = [];
  const skipped = [];

  const priorityIds = new Set(priorityCommandIds);
  const targetSkipIds = new Set(skippableTargetCommandIds);


  const records = scene.settlementRuntime?.attackRecords ?? [];

  // 历史本身异常必须停止，不能当作新增命令超限跳过。
  assertBroadsideQuotas(scene, [], [], records);

  const reservedEntries = [];
  const reservedChecks = [];

  const phasePriority = {
    "order-5": 0,
    "order-4": 1,
    "order-3": 2,
    "order-2": 3,
    "order-1": 4,
    pas: 5
  };

  const ordered = [...commands].sort((a, b) =>
    Number(priorityIds.has(b.id)) -
      Number(priorityIds.has(a.id)) ||
    (phasePriority[a.phaseId] ?? 99) -
      (phasePriority[b.phaseId] ?? 99) ||
    compareText(a.unitId, b.unitId) ||
    compareText(a.groupId, b.groupId) ||
    compareText(a.id, b.id)
  );


  function skip(command, reason) {
    skipped.push({
      commandId: command.id,
      unitId: command.unitId,
      groupId: command.groupId,
      turnNumber: command.turnNumber,
      phaseId: command.phaseId,
      reason
    });
  }

  for (const command of ordered) {
    let checked;
    try {
      validateDeferredAttackPlans(
        scene,
        [command],
        { includeCurrent: true, onChecked:value=>{checked=value;} }
      );
    } catch (error) {
            // 只用于正式执行当前阶段已有计划。
      // 登记和普通预览仍拒绝无法行动舰船的攻击。
      if (
        skipUnavailableActors === true &&
        ["ATTACK_ACTOR_UNAVAILABLE","ATTACK_WEAPON_UNAVAILABLE"].includes(error.code)
      ) {
        skip(command, error.message);
        continue;
      }
      const canSkipTarget =
        error.code === "TARGET_INELIGIBLE" &&
        (
          error.skipAttack === true ||
          targetSkipIds.has(command.id)
        );

      if (!canSkipTarget) {
        throw error;
      }


      skip(command, error.message);
      continue;
    }

    const {current,entry,check}=checked;
    try{
      assertPlannedBroadsideQuotas(current,[...reservedEntries,entry],[...reservedChecks,check],records);
    }catch(error){
      if(error.code!=="BROADSIDE_QUOTA")throw error;
      const actor=unitFor(current,entry.unitId),group=actor.equipmentState.groups.find(g=>g.id===entry.groupId);
      skip(command,["このラウンドの両舷装備の残り使用枠が不足しています。",`攻撃側：${actor.name}`,`兵装：${entry.profile.label??"名称未登録"}`,`装備組：${group.position} / 第${group.groupIndex+1}組`,"この組は発射せず、弾薬も消費しません。"].join("\n"));
      continue;
    }
    reservedEntries.push(entry);reservedChecks.push(check);

    accepted.push(command);
  }

  return { accepted, skipped };
}



export function prepareSettlementAttackPlan(scene) {
  const working = copySceneWithSpecialHistory(scene);
  appendMissionAttacks(working);
  preflightAirCombat(working);

  initializeSettlementRuntime(working);

  for (const unit of working.instances) {
    ensureShipRuntime(unit);
    ensureUnitCombatRuntime(unit);
  }

  initializeRescueState(working);
  initializeRayTargetRuntime(working);
  appendMissionAttacks(working);
  const currentCommands = working.attackRuntime.commands.filter(
    command =>
      command.turnNumber === working.turn.number &&
      command.phaseId === working.turn.phaseId
  );

  const filtered = filterUnreachableAttackCommands(
    working,
    currentCommands
  );

  const skippedIds = new Set(
    filtered.skipped.map(command => command.commandId)
  );

  working.attackRuntime.commands =
    working.attackRuntime.commands.filter(
      command => !skippedIds.has(command.id)
    );
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
    "支援装備の未対応効果があるため、正式結算を停止しました。",
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
    commands: copy(working.attackRuntime.commands),
    skippedCommands: copy(filtered.skipped)
  };


}

function settleProjectileImpacts(scene,coinSource){
 const due=dueProjectiles(scene);if(!due.length)return null;
 const temp=copySceneWithSpecialHistory(scene);
 temp.attackRuntime.commands=due.map(u=>({id:u.instanceId+':impact',status:'planned',createdAt:new Date().toISOString(),boundaries:[],unitId:u.instanceId,groupId:u.equipmentState.groups[0].id,turnNumber:scene.turn.number,phaseId:scene.turn.phaseId,targetRef:{kind:'point',...u.projectileState.center},specifiedTargetIds:[],attackMethod:'bvr'}));
 temp.attackBatchRuntime=undefined;captureAttackPhaseStart(temp);
 const prepared=prepareAttackBatchResources(temp),start=getAttackPhaseStartScene(temp);
 prepareBatchHitChecks(temp,prepared,finalPreflight);
 const resourceReports=applyAttackBatchResources(temp,prepared),hitStep=resolveAttackBatchHitStep(temp,prepared,finalPreflight,coinSource),damage=summarizeTargets(temp,start,prepared,hitStep,coinSource);
 for(const r of resourceReports)r.firingSides=hitStep.firingReports.find(f=>f.commandId===r.commandId).firingSides;
 scene.instances=temp.instances;scene.electronicRuntime=temp.electronicRuntime;
 markProjectileImpacts(scene,due.map(u=>u.instanceId));
 return{resourceReports,hitStep,damage,projectileIds:due.map(u=>u.instanceId)};
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

  const working = copySceneWithSpecialHistory(scene);

  initializeSettlementRuntime(working);
  initializeRoundTraitRuntime(working);
  refreshElectronicEffects(working);

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

   appendMissionAttacks(working);
  const currentCommands = working.attackRuntime.commands.filter(
    command =>
      command.turnNumber === context.turnNumber &&
      command.phaseId === context.phaseId
  );

  const executionFilter = filterUnreachableAttackCommands(
    working,
    currentCommands,
    {
      skipUnavailableActors: true
    }
  );


  const skippedIds = new Set(
    executionFilter.skipped.map(item => item.commandId)
  );

  working.attackRuntime.commands =
    working.attackRuntime.commands.filter(
      command => !skippedIds.has(command.id)
    );

   const {
    prepared,
    start,
    commands,
    skippedCommands: preparationSkipped
  } = prepareSettlementAttackPlan(working);



// 将确定性生成的自主计划放入同一个事务候选。
// 后续资源应用及命中复核都读取同一份命令。
  working.attackRuntime.commands = commands;

  // 前面的计划、资源及规则支持检查均不掷正式随机数。
  // 从这里开始，正式事务才生成单位级发动结果。
  settlementStep(
    "一騎当千のラウンド発動判定を完了できませんでした。",
    () => resolveRoundTraits(
      working,
      start,
      coinSource
    )
  );

  // 正式命中必须读取已确定的发动结果。
  // 不修改阶段开始快照，通过参数传入事务中的效果记录。
  const formalPreflight = (startScene, entry) =>
    finalPreflight(
      startScene,
      entry,
      {
        runtime: working.roundTraitRuntime,
        requireResolved: true
      }
    );

  // 在扣弹前，以正式奖励重新检查命中修正。
  settlementStep(
    "ラウンド特殊能力を含む正式命中修正を確認できませんでした。",
    () => prepareBatchHitChecks(
      working,
      prepared,
      formalPreflight
    )
  );

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
    formalPreflight,
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

  initializeProjectiles(working);
  const ballisticImpacts=settleProjectileImpacts(working,coinSource);
  if(ballisticImpacts){resourceReports.push(...ballisticImpacts.resourceReports);hitStep.reports.push(...ballisticImpacts.hitStep.reports);hitStep.rangeSelections.push(...ballisticImpacts.hitStep.rangeSelections);damage.targetReports.push(...ballisticImpacts.damage.targetReports);damage.effects.push(...ballisticImpacts.damage.effects);}
  const ballisticLaunches=launchProjectiles(working,prepared.entries,coinSource);
  const preAirAceLosses=resolveAceLosses(working,coinSource);
  const airCombatReports=resolveAirCombat(working,coinSource,{prevalidated:true});
  const ramReports=resolveMartyrRams(working,coinSource),aceLosses=preAirAceLosses.concat(resolveAceLosses(working,coinSource));
  if(airCombatReports.length||damage.targetReports.some(r=>r.applied?.aircraftHit&&r.applied.aircraftHit.before.status!==r.applied.aircraftHit.after.status))rebuildAircraftClusters(working);
  reconcileAviation(working);
  recordSinkingStarts(
    working,
    damage.targetReports.map(report => report.applied).concat(ramReports.map(r=>r.applied))
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

  finishMissionAttacks(working,hitStep.reports);
  const report = {
    version: 1,
    step: "attack-batch",
    turnNumber: context.turnNumber,
    phaseId: context.phaseId,
    elapsedMinutes: working.turn.elapsedMinutes,
    skippedCommands: copy([
      ...executionFilter.skipped,
      ...preparationSkipped
    ]),
    resourceReports,
    hitReports: hitStep.reports,
    airDisruptionReports: hitStep.airDisruptionReports,
    rangeSelections: copy(hitStep.rangeSelections),
    targetReports: damage.targetReports,
    airCombatIds:airCombatReports.map(r=>r.id),
    ramReports,aceLosses,ballisticLaunches,ballisticImpactIds:ballisticImpacts?.projectileIds??[],
    effectReports,
    rayReports,
    rescueInterruptions
  };

  if (!working.controls.enemyAutonomy && (report.hitReports.length||ramReports.length)) {
    const pairs = report.hitReports.map(hit => [hit.unitId, hit.targetId]).concat(ramReports.map(r=>[r.aircraftId,r.targetId]));
    report.roundWitnesses = captureRoundWitnesses(start, pairs);
  }
  working.settlementRuntime.attackRecords.push(copy(report));

  /// 终结当前次序的全阵营计划，保留未来次序计划。
    working.attackRuntime.commands =
    working.attackRuntime.commands.filter(command =>
    command.turnNumber !== context.turnNumber ||
    command.phaseId !== context.phaseId
  );


  // 不推进回合号码，不推进30分钟。
  working.turn.phaseId = NEXT_ATTACK_PHASE[context.phaseId];
  initializeAttackRuntime(working);

  initializeSettlementRuntime(working);

  // 只写回本正式事务负责的数据。
  scene.electronicRuntime=working.electronicRuntime;
  scene.instances = working.instances;
  scene.groups=working.groups;
  scene.airCombatRuntime=working.airCombatRuntime;
  scene.aviationRuntime = working.aviationRuntime;
  scene.rescueTasks = working.rescueTasks;
  scene.rayTargetRuntime = working.rayTargetRuntime;
  scene.attackRuntime = working.attackRuntime;
  scene.settlementRuntime = working.settlementRuntime;
  scene.roundTraitRuntime = working.roundTraitRuntime;
  scene.phaseFinishRuntime = working.phaseFinishRuntime;
  scene.turn = working.turn;
  

  // 下一阶段快照由store.commit统一建立。
  return {
    turnNumber: context.turnNumber,
    phaseId: context.phaseId,
    nextPhaseId: working.turn.phaseId
  };
}
