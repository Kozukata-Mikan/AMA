import {observedAviationLosses} from './aviation-losses.js?v=day-catalog-pas-1';
import {airRetreating,hasAirTrait} from './air-training-runtime.js?v=air-training-1';
import {ensureRetreatMissions,martyrRoutes,applyLowCloud} from './air-special-actions.js?v=air-exercises-1';
import {airborneUnit} from './air-ground-rules.js';
import {flightMissionRoutes,finishMissionMovement} from './flight-missions.js?v=air-exercises-1';
import {observedAirCombat} from './air-combat-report.js?v=air-defense-1';
import {aircraftMayFly} from './aviation-time.js?v=day-catalog-pas-1';
import {buildingAlive} from './building-state.js?v=facility-rules-1';
import {checkDroneRoute,enforceRemoteControl,remoteStations} from './aviation-services.js?v=air-losses-1';
import {reconcileAviation} from './aviation-operations.js?v=air-exercises-1';
import {hasAircraftTemplate,normalizeAircraftPosition,aircraftCanAct,readAircraftProfile} from './aircraft-runtime.js?v=air-losses-1';
import { supportRadius, hasSupportEquipment } from "./support-equipment.js?v=air-training-1";
import { initializeSupportRuntime, interruptSupportForMovement, reconcileSupports } from "./simulation-support.js?v=day-catalog-pas-1";
import { normalizeBuildingUnit } from "./building-runtime.js?v=facility-rules-1";
import { normalizeNavalPosition, navalKind, navalHeight, isSubmerged, setNavalVertical } from "./naval-kind.js?v=catalog-layout-2";
import {formationCircleMembers,formationMovementMembers,formationMembers,formationCenter,formationOffset,normalizeFormation,validateFormationMembers} from "./formation-layout.js?v=fleet-cohesion-6";
import {getAutonomousEngagementRange} from "./simulation-autonomous-weapon.js?v=day-catalog-pas-1";
import {copySceneWithSpecialHistory} from './special-history-snapshot.js';
import {
  readShipProfile,
  getReconConditions,
  applyShipCollisionDamage
} from "./ship-runtime.js?v=day-catalog-pas-1";

import { sampleTerrain } from "./terrain-data.js";

import {
  startPlannedRescues,
  reconcileActiveRescues
} from "./simulation-rescue.js?v=air-exercises-1";

import {
  createShipEffectsState,
  getFloodingMovementFactor
} from "./ship-effects-runtime.js?v=support-stations-1";

import {
  ensureEquipmentItemRuntime,
  isEquipmentReconAvailable,
  readEquipmentItemState
} from "./equipment-item-runtime.js?v=air-training-1";

import {
  appendAutonomousRescuePlans
} from "./simulation-autonomous-rescue.js?v=air-exercises-1";

import {
  routeLength,
  trimRoute,
  clipLandRoute,
  routeHeading,
  resolveMovementRoutes
} from "./simulation-movement-route.js?v=catalog-layout-2";


const SIDES = ["ally", "enemy", "neutral"];
const GRADES = ["F", "E", "D", "C", "B", "A", "S", "U"];
const EPSILON = 1e-7;

const clone = value => JSON.parse(JSON.stringify(value));

function fail(message) {
  throw new Error(message);
}

function positioned(unit) {
  return Number.isFinite(unit.x) && Number.isFinite(unit.y);
}

function setUnitVertical(unit,value){
  if(!hasAircraftTemplate(unit))return setNavalVertical(unit,value);
  if(value.depth!==undefined)fail('航空機の潜深は変更できません。');
  if(value.altitude!==undefined)unit.altitude=value.altitude;
  return normalizeAircraftPosition(unit);
}
function operational(unit) {
  if (!positioned(unit)) return false;

  if(unit.airshipBaseState&&unit.airshipBaseState.mission!=='airborne')return false;
  if(unit.branch==='building')return buildingAlive(unit);
  if (unit.branch === "navy") {
    return !unit.rescueSupportLocked && !["sinking", "sunk"].includes(unit.shipState?.status) &&
      unit.shipState?.rescueTaskId === null;
  }

  if(hasAircraftTemplate(unit))return aircraftCanAct(unit,'recon');
  // 其他兵种的完整行动规则尚未定义。
  // 已经明确耐性为0的单位不作为侦察来源。
  return Number.isFinite(unit.currentHp) && unit.currentHp > 0;
}

export function initializeSimulationFeatures(scene) {
  initializeSupportRuntime(scene);
  for (const unit of scene.instances) normalizeAircraftPosition(normalizeBuildingUnit(normalizeNavalPosition(unit)));
  for (const group of scene.groups) if (group.formation !== undefined) normalizeFormation(group.formation);
  scene.controls ??= {};
  scene.controls.enemyAutonomy =
    scene.controls.enemyAutonomy === true;

  if (scene.controls.observationSide === undefined) {
    scene.controls.observationSide = "ally";
  }

  if (!SIDES.includes(scene.controls.observationSide)) {
    fail("観察陣営の保存値が不正です。");
  }

  if (scene.controls.enemyAutonomy) {
    scene.controls.observationSide = "ally";
  }

  scene.movementPlans ??= [];

  if (!Array.isArray(scene.movementPlans)) {
    fail("移動計画の保存形式が不正です。");
  }

    if (scene.movementRuntime !== undefined) {
    const runtime = scene.movementRuntime;

    if (
      !runtime ||
      runtime.version !== 1 ||
      !Array.isArray(runtime.records)
    ) {
      fail("移動履歴の保存形式が不正です。");
    }

    const turns = new Set();

    for (const record of runtime.records) {
      if (
        !record ||
        record.version !== 1 ||
        record.phaseId !== "movement" ||
        !Number.isSafeInteger(record.turnNumber) ||
        record.turnNumber < 1 ||
        record.turnNumber > scene.turn.number ||
        turns.has(record.turnNumber) ||
        !Number.isSafeInteger(record.elapsedMinutes) ||
        record.elapsedMinutes < 0 ||
        !Array.isArray(record.destinations) ||
        !Array.isArray(record.collisions) ||
        !Array.isArray(record.damageReports)
      ) {
        fail("移動履歴の保存値が不正です。");
      }

      turns.add(record.turnNumber);

      for (const collision of record.collisions) {
        if (
          !Number.isFinite(collision.time) ||
          collision.time < 0 ||
          collision.time > 1 ||
          !Array.isArray(collision.unitIds) ||
          collision.unitIds.length !== 2 ||
          collision.unitIds[0] === collision.unitIds[1] ||
          collision.unitIds.some(id =>
            !scene.instances.some(unit => unit.instanceId === id)
          )
        ) {
          fail("撞撃履歴の保存値が不正です。");
        }
      }
    }
  }

  if (!Array.isArray(scene.instances)) {
  fail("ユニットの保存形式が不正です。");
}

for (const unit of scene.instances) {
  if (unit.branch === "navy") {
    ensureEquipmentItemRuntime(unit);
  }
}

}

export function getObservationSide(scene) {
  return scene.controls?.enemyAutonomy
    ? "ally"
    : scene.controls?.observationSide ?? "ally";
}

/**
 * 直线与真实网格三角面的交点参数。
 * 每个区间内地形高度是线性的，最大值必在区间端点。
 * 不使用显示层的降采样网格，也不使用固定步长采样。
 */
function terrainBreaks(terrain, from, to) {
  const x0 =
    (from.x + terrain.width / 2) *
    (terrain.cols - 1) / terrain.width;

  const y0 =
    (from.y + terrain.height / 2) *
    (terrain.rows - 1) / terrain.height;

  const dx =
    (to.x - from.x) *
    (terrain.cols - 1) / terrain.width;

  const dy =
    (to.y - from.y) *
    (terrain.rows - 1) / terrain.height;

  const values = [0, 1];

  function crossings(origin, delta, first, last) {
    if (Math.abs(delta) < EPSILON) return;

    first = Math.max(first, Math.ceil(Math.min(origin, origin + delta)));
    last = Math.min(last, Math.floor(Math.max(origin, origin + delta)));
    for (let n = first; n <= last; n++) {
      const t = (n - origin) / delta;
      if (t > 0 && t < 1) values.push(t);
    }
  }

  crossings(x0, dx, 0, terrain.cols - 1);
  crossings(y0, dy, 0, terrain.rows - 1);

  // 每个单元的a-c对角线满足gx-gy为整数。
  crossings(
    x0 - y0,
    dx - dy,
    -(terrain.rows - 1),
    terrain.cols - 1
  );

  return values.sort((a, b) => a - b);
}

// Rule coordinates only: no icon/label offsets or display exaggeration.
function reconnaissanceHeight(unit, sample) {
  if (unit.branch === "air") return unit.altitude ?? 1;
  if (unit.branch === "navy") return navalHeight(unit, sample);
  if (unit.branch === "building") return sample.surface;
  return Number.isFinite(unit.altitude) ? unit.altitude : sample.surface;
}

export function isTerrainBlocked(terrain, from, to) {
  if (!positioned(from) || !positioned(to)) return true;
  const fromSample = sampleTerrain(terrain, from.x, from.y);
  const toSample = sampleTerrain(terrain, to.x, to.y);
  if (!fromSample.inside || !toSample.inside) return true;

  const fromHeight = reconnaissanceHeight(from, fromSample);
  const toHeight = reconnaissanceHeight(to, toSample);
  if (!Number.isFinite(fromHeight) || !Number.isFinite(toHeight)) return true;

  // Ground and sight-line height are linear within each real terrain triangle.
  // The extrema of their difference therefore occur at these exact cuts.
  // Compare against the seabed, not sea level, so ASW sight lines may enter water.
  // Surface contact is allowed; only entering terrain blocks the line. This also
  // permits ground-level buildings/ships without inventing a mast-height bonus.
  for (const t of terrainBreaks(terrain, from, to)) {
    const height = t === 0 ? fromSample.height : t === 1 ? toSample.height :
      sampleTerrain(terrain, from.x+(to.x-from.x)*t, from.y+(to.y-from.y)*t).height;
    const sightHeight = fromHeight+(toHeight-fromHeight)*t;
    if (height > sightHeight + EPSILON) return true;
  }
  return false;
}

function navalGrade(unit, key) {
  const value = unit.snapshot?.naval?.[key];
  return GRADES.includes(value) ? GRADES.indexOf(value) : null;
}

/**
 * 判断一个侦察来源对一个目标的可见性。
 * 返回identified、shadow或null。
 * 不修改观察阵营，不修改场景。
 */
/**
 * 原有侦察算法。
 * 仅计算正常能力下的结果，不应用设备损伤或历史保持。
 */
function getNormalObserverVisibility(scene, observer, target) {
  if (!operational(observer) || !positioned(target)) {
    return null;
  }

  const range =
    getReconConditions(scene.environment).normalRange;

  const distance = Math.hypot(
    observer.x - target.x,
    observer.y - target.y
  );

  if (distance > Math.max(100, range)) return null;

  if (isTerrainBlocked(scene.terrain, observer, target)) {
    return null;
  }

  if (isSubmerged(target) && (!["navy","building","air"].includes(observer.branch) || navalGrade(observer,"aswRecon") === null)) return null;
  if (distance <= 100) return "identified";
  if(airborneUnit(target)&&(target.altitude??1)-sampleTerrain(scene.terrain,target.x,target.y).surface<=10)return null;

  if (
    !["navy","building","air"].includes(observer.branch) ||
    !["navy","building","air"].includes(target.branch) ||
    distance > range
  ) {
    return null;
  }

  const detection = navalGrade(target, "detection");
  const recon = navalGrade(observer, isSubmerged(target) ? "aswRecon" : target.branch==='air'||target.branch==='navy'&&navalKind(target)==='air'?"airRecon":"seaRecon");

  return (
    detection !== null &&
    recon !== null &&
    recon >= detection
  ) ? "shadow" : null;
}

/**
 * 设备攻击前读取单一侦察来源。
 *
 * 目前正式源码只实现海军对海军的对海侦察。
 * 对空适配没有定义，不能伪造空中发现结果。
 */
export function getEquipmentReconSourceVisibility(
  scene,
  observer,
  target,
  itemId
) {
  if (
    observer.branch !== "navy" ||
    !operational(observer) ||
    !positioned(target)
  ) {
    return null;
  }

  if (itemId === "sea-recon") {
    if (isSubmerged(target)) return null;
    if (target.branch !== "navy") return null;

    if (
      !isEquipmentReconAvailable(observer, "sea-recon")
    ) {
      return null;
    }

    return getNormalObserverVisibility(
      scene,
      observer,
      target
    );
  }

  if (itemId === "air-recon") {
    // 当前文件没有对空侦察算法。
    return null;
  }

  fail("偵察項目の指定が不正です。");
}

/**
 * 正式观察查询。
 *
 * 对海能力损坏：
 * - 不再产生新的对海发现；
 * - 当回合保留该来源在受损前发现的目标；
 * - 下一回合不再返回保留结果。
 *
 * 多观察者合并仍由getVisibility负责。
 */
function observerVisibility(scene, observer, target, readRecon) {
  if (!operational(observer) || !positioned(target)) return null;
  if (isSubmerged(target)) return getNormalObserverVisibility(scene,observer,target);
  if (observer.branch === "navy" && target.branch === "navy") {
    const state=readRecon(observer);
    if(state.damaged){
      if(state.damagedTurn!==scene.turn?.number)return null;
      return state.discoveries.find(entry=>entry.targetId===target.instanceId)?.level??null;
    }
  }
  return getNormalObserverVisibility(scene,observer,target);
}

export function getObserverVisibility(scene, observer, target) {
  return observerVisibility(scene,observer,target,unit=>readEquipmentItemState(unit,"sea-recon"));
}

export function getVisibility(scene, targetIds) {
  const side = getObservationSide(scene);

  const sources = scene.instances.filter(
    unit => unit.side === side && operational(unit)
  );

  const result = new Map();
  // Only this synchronous query owns the cache. Mutable states are never cached across calls.
  const reconStates=new Map();
  const readRecon=observer=>{
    if(!reconStates.has(observer))reconStates.set(observer,readEquipmentItemState(observer,"sea-recon"));
    return reconStates.get(observer);
  };

  for (const target of scene.instances) {
    if(hasAircraftTemplate(target)&&target.aircraftState?.status==='destroyed')continue;
    if (targetIds && !targetIds.has(target.instanceId)) continue;
    if(hasAircraftTemplate(target)&&target.side!==side&&!['airborne','landing'].includes(target.aircraftState?.mission))continue;
    if (target.side === side) {
      result.set(target.instanceId, "identified");
      continue;
    }

    let visibility = null;

    for (const observer of sources) {
      const level = observerVisibility(scene,observer,target,readRecon);

      if (level === "identified") {
        visibility = level;
        break;
      }

      if (level === "shadow") visibility = level;
    }

    if (visibility) {
      result.set(target.instanceId, visibility);
    }
  }

  return result;
}


/**
 * 返回页面可用的观察副本，而不是完整战场。
 * 普通发现不携带真实名称、耐性、军种、阵营或图鉴快照。
 */
export function getObservedScene(scene, {shareTerrain = false} = {}) {
  const visibility = getVisibility(scene);
  const side = getObservationSide(scene);

  const instances = [];

  for (const unit of scene.instances) {
    if(hasAircraftTemplate(unit)&&unit.aircraftState?.status==='destroyed')continue;
    const level = visibility.get(unit.instanceId);
    if (!level) continue;

        if (level === "identified") {
      const observed = clone(unit);
      const observationOwn = unit.side === side;
            // 从完整运行状态生成白名单式公开词条。
      // 外方只能看到是否起火，不能看到进水或损管历史。
      observed.observedEffects = {
        fire: (unit.branch === "navy" && unit.shipState?.effects?.fire != null)||unit.branch==='building'&&Boolean(unit.buildingState?.slots?.some(s=>s.effects.fire))
      };

            // 此标记只提供给已识别单位，不公开内部救助任务。
      // 最终资格仍由planRescue和移动后结算重新检查。
      observed.rescueCandidate =
        unit.branch === "navy" &&
        unit.shipState?.status === "sinking" &&
        unit.shipState?.rescueTaskId === null;


      if (!observationOwn) {
        // 外方识别只开放可识别资料，不开放内部运行状态。
        delete observed.equipmentState;
        delete observed.trainingState;
        observed.acePilotMarker=unit.aircraftState?.acePilot&&unit.aircraftState.status!=='destroyed'?unit.aircraftState.acePilotName:null;
        delete observed.aircraftState;
        delete observed.flightPlan;
        delete observed.snapshot.aircraftSnapshots;
        delete observed.snapshot.aviationComplement;
        delete observed.supportLocked;
        delete observed.buildingState;
        delete observed.airshipBaseState;
        delete observed.groundCrewLastTurn;
        delete observed.rescueSupportLocked;

        if (observed.shipState) {
          // 损伤等级保留；续航、损管、救助计时等不对外公开。
          observed.shipState = {
            status: observed.shipState.status
          };
        }
      }

      instances.push({
        ...observed,
        observationOwn,
        aviationStored: hasAircraftTemplate(unit)&&!['airborne','landing'].includes(unit.aircraftState?.mission),
        observationLevel: "identified"
      });
      continue;
    }


    instances.push({
      instanceId: unit.instanceId,
      name: "未識別の影",
      branch: "special",
      side: "neutral",
      faction: "",
      x: unit.x,
      y: unit.y,
      heading: 0,
      altitude: 0,
      sizeLevel: 1,
      filled: false,
      labelHeight: 20,
      currentHp: null,
      snapshot: { maxHp: null },
      groupId: null,
      observationLevel: "shadow",
      // 被发现的影也可见火焰，但不公开真实军种或内部状态。
      observedEffects: {
        fire: (unit.branch === "navy" && unit.shipState?.effects?.fire != null)||unit.branch==='building'&&Boolean(unit.buildingState?.slots?.some(s=>s.effects.fire))
      }
    });
  }

  // 编队名、数量和归属也属于资料。
  // 外方单位即使已识别，本批仍以单体显示，不泄露其编队结构。
  const ownGroupIds = new Set(
    scene.instances
      .filter(unit => unit.side === side)
      .map(unit => unit.groupId)
      .filter(Boolean)
  );

  let changed = true;
  while (changed) {
    changed = false;
    for (const group of scene.groups) {
      if (
        ownGroupIds.has(group.id) &&
        group.parentId &&
        !ownGroupIds.has(group.parentId)
      ) {
        ownGroupIds.add(group.parentId);
        changed = true;
      }
    }
  }

  const safeGroups = scene.groups.filter(group => {
    if (!ownGroupIds.has(group.id)) return false;

    const descendants = new Set([group.id]);
    let added = true;

    while (added) {
      added = false;
      for (const item of scene.groups) {
        if (
          descendants.has(item.parentId) &&
          !descendants.has(item.id)
        ) {
          descendants.add(item.id);
          added = true;
        }
      }
    }

    return !scene.instances.some(
      unit => descendants.has(unit.groupId) && unit.side !== side
    );
  });

  const visibleForeign = new Set(instances.filter(unit => !unit.observationOwn && unit.observationLevel === "identified").map(unit => unit.groupId).filter(Boolean));
  for(let changed=true;changed;){
    changed=false;
    for(const group of scene.groups){
      if(visibleForeign.has(group.id) && group.parentId && !visibleForeign.has(group.parentId)){
        visibleForeign.add(group.parentId);changed=true;
      }
    }
  }
  for (const group of scene.groups) {
    if (visibleForeign.has(group.id) && !safeGroups.some(item => item.id === group.id)) {
      safeGroups.push({id:group.id,name:group.name,kind:group.kind,parentId:group.parentId ?? null,observationForeign:true,
        ...(group.formation ? {formation:{version:1,overview:group.formation.overview,positions:[]}} : {})});
    }
  }
  const safeGroupIds = new Set(safeGroups.map(group => group.id));

  for (const unit of instances) {
    if (!safeGroupIds.has(unit.groupId)) unit.groupId = null;
  }

  // 不用历史快照暴露外方名称、耐性或旧位置。
  const actions = scene.actions.filter(record =>
    record.attacker?.members?.every(unit => unit.side === side) &&
    record.target?.members?.every(unit => unit.side === side)
  );

  const observedScene = clone({
    version: scene.version,
    mode: scene.mode,
    id: scene.id,
    revision: scene.revision,
    name: scene.name,
    createdAt: scene.createdAt,
    updatedAt: scene.updatedAt,
    ruleset: scene.ruleset,
    // 战役介绍是作者公开内容，不读取外方战斗资料。
    // 战役公开介绍，不包含外方内部战斗资料。
// 兼容旧推演：只读取其原始快照已有的介绍，不写回历史。
    campaignIntro:
    scene.campaignIntro ??
    scene.initialScene?.campaignIntro ??
    null,
    terrain: shareTerrain ? null : scene.terrain,
    environment: scene.environment,
    turn: scene.turn,
    controls: scene.controls,
    view: scene.view,
    instances,
        groups: safeGroups.map(group => ({
      ...group,
      parentId: safeGroupIds.has(group.parentId)
        ? group.parentId
        : null
    })),
    actions,
    airCombatRuntime:observedAirCombat(scene,side),
    aviationRuntime: {version:1,lossReports:observedAviationLosses(scene,side),runwayUse:(scene.aviationRuntime?.runwayUse??[]).filter(r=>scene.instances.some(u=>u.instanceId===r.hostId&&u.side===side)),preparationUse:(scene.aviationRuntime?.preparationUse??[]).filter(r=>scene.instances.some(u=>u.instanceId===r.hostId&&u.side===side))},
    supportRuntime: {version:1, tasks:(scene.supportRuntime?.tasks??[]).filter(task=>visibility.get(task.providerId)==='identified'&&visibility.get(task.targetId)==='identified').map(task=>({id:task.id,kind:task.kind,providerId:task.providerId,targetId:task.targetId,status:task.status,startedTurn:task.startedTurn}))},
    rescuePlans: (scene.rescuePlans ?? []).filter(plan =>
      scene.instances.some(unit =>
        unit.instanceId === plan.rescuerId &&
        unit.side === side
      )
    ).map(plan => ({
      kind: plan.kind ?? "rescue",

     itemId: scene.instances.some(unit =>
      unit.instanceId === plan.rescuerId &&
       unit.side === side
     ) ? (plan.itemId ?? null) : null,

      rescuerId: plan.rescuerId,
      turnNumber: plan.turnNumber,

      // 目标重新变成未识别时，不泄露目标引用。
      targetId: visibility.get(plan.targetId) === "identified"
        ? plan.targetId
        : null
    })),

    rescueTasks: (scene.rescueTasks ?? []).filter(task =>
      scene.instances.some(unit =>
        [task.rescuerId, task.targetId].includes(unit.instanceId) &&
        unit.side === side
      )
    ).map(task => ({
      id: task.id,
      kind: task.kind ?? "rescue",
  itemId: scene.instances.some(unit =>
    unit.instanceId === task.targetId &&
    unit.side === side
  ) ? (task.itemId ?? null) : null,
      startedTurn: task.startedTurn,
      status: task.status,
      resolvedTurn: task.resolvedTurn,
      guaranteed: task.guaranteed,
      coinHeads: task.coinHeads,

      rescuerId: visibility.get(task.rescuerId) === "identified"
        ? task.rescuerId
        : null,

      targetId: visibility.get(task.targetId) === "identified"
        ? task.targetId
        : null
    })),


    movementPlans: (scene.movementPlans ?? []).filter(plan =>
      plan.memberIds.every(id =>
        scene.instances.some(
          unit => unit.instanceId === id && unit.side === side
        )
      )
    )
  });
  if (shareTerrain) observedScene.terrain = scene.terrain;
  return observedScene;
}

export function assertManualControl(scene, members) {
  const side = getObservationSide(scene);

  if (!members.length || members.some(unit => unit.side !== side)) {
    fail("現在の観察陣営に属するユニットだけを操作できます。");
  }

  if (
    scene.controls?.enemyAutonomy &&
    members.some(unit => unit.side !== "ally")
  ) {
    fail("自律行動が有効な場合、手動操作は味方に限られます。");
  }
}

export function assertIdentifiedTargets(scene, members) {
  const visibility = getVisibility(scene);

  if (members.some(
    unit => visibility.get(unit.instanceId) !== "identified"
  )) {
    fail("未発見または未識別の対象の詳細は参照できません。");
  }
}

function entityMembers(scene, ref) {
  if (!ref || !["unit", "group"].includes(ref.kind)) {
    fail("移動主体の指定が不正です。");
  }

  if (ref.kind === "unit") {
    const unit = scene.instances.find(item => item.instanceId === ref.id);
    if (!unit) fail("ユニットが見つかりません。");
    return [unit];
  }

  if (!scene.groups.some(group => group.id === ref.id)) {
    fail("編隊が見つかりません。");
  }

  const ids = new Set([ref.id]);
  let changed = true;

  while (changed) {
    changed = false;
    for (const group of scene.groups) {
      if (ids.has(group.parentId) && !ids.has(group.id)) {
        ids.add(group.id);
        changed = true;
      }
    }
  }

  const members = scene.instances.filter(unit => ids.has(unit.groupId));
  if (!members.length) fail("編隊にメンバーがいません。");
  return members;
}

function movementGroupMembers(scene,id){
  return scene.groups.find(g=>g.id===id)?.aviationCluster ? scene.instances.filter(u=>u.groupId===id&&hasAircraftTemplate(u)&&u.aircraftState?.mission==='airborne'&&u.aircraftState.status!=='destroyed') : formationMovementMembers(scene,id);
}
function movementMembers(scene, ref, supportPreview=false) {
  const members = ref.kind === "group" ? movementGroupMembers(scene,ref.id) : entityMembers(scene,ref);
  if (!members.length) fail("編隊円内に移動する艦船がいません。");
  assertManualControl(scene, members);
  if(members.some(u=>hasAircraftTemplate(u)&&!aircraftMayFly(scene,u)))fail('この時間帯は夜間観測のない航空機を移動できません。');

  if (scene.turn.phaseId !== "movement") {
    fail("移動計画は移動段階でのみ指定できます。");
  }

  if (members.some(unit => unit.branch !== "navy" && !hasAircraftTemplate(unit)) || (ref.kind==='group' && members.some(hasAircraftTemplate) && !scene.groups.find(g=>g.id===ref.id)?.aviationCluster)) {
    fail("この移動処理は艦船専用です。混合軍種の移動は未定義です。");
  }

  if (members.some(unit => (!(hasAircraftTemplate(unit)?aircraftCanAct(unit,'move'):operational(unit)) || unit.supportLocked) && !(supportPreview && unit.supportLocked && !["sinking","sunk"].includes(unit.shipState?.status) && unit.shipState?.rescueTaskId===null))) {
    fail("行動不能または救助中の艦船は移動できません。");
  }

  return members;
}

function limitFor(members) {
  return Math.min(...members.map(unit => {
    if(hasAircraftTemplate(unit))return Math.min(readAircraftProfile(unit).movementLimit,unit.aircraftState.remainingEndurance);
    const profile = readShipProfile(unit);

    // 旧框架尚无词条字段时，仅按无进水计算。
    // 不在观察或查询函数中写回运行状态。
    const effects = unit.shipState.effects ??
      createShipEffectsState();

    const floodingFactor = getFloodingMovementFactor(effects);

    // 减益始终基于原始最大移动力，不逐回合乘当前值。
    // 最终可移动格数向下取整。
    const effectiveMovementLimit = Math.floor(
      profile.movementLimit * floodingFactor
    );

    return Math.min(
      effectiveMovementLimit,
      unit.shipState.remainingEndurance
    );
  }));
}


function pointOnSegment(point, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const square = dx * dx + dy * dy;

  if (square < EPSILON * EPSILON) {
    return Math.hypot(point.x - to.x, point.y - to.y) <= EPSILON;
  }

  const t =
    ((point.x - from.x) * dx + (point.y - from.y) * dy) / square;

  if (t <= EPSILON || t > 1 + EPSILON) return false;

  return Math.hypot(
    point.x - (from.x + t * dx),
    point.y - (from.y + t * dy)
  ) <= EPSILON;
}

function validateRoute(scene, unit, to) {
  if (!sampleTerrain(scene.terrain, to.x, to.y).inside) {
    fail("移動先が地図の範囲外です。");
  }

  if(hasAircraftTemplate(unit))return;
  for (const wreck of scene.instances) {
    if (
      wreck.instanceId !== unit.instanceId &&
      wreck.shipState?.status === "sunk" &&
      positioned(wreck) &&
      Math.hypot(
        wreck.x - to.x,
        wreck.y - to.y
      ) <= EPSILON
    ) {
      // 仅禁止终点占用沉船坐标。
      // 不透露隐藏沉船的名称、资料或确切坐标。
      fail("この位置への移動は完了できません。");
    }
  }

  // 尚未定义经过沉船的限制，不增加路径禁行规则。
  // 尚未定义完整地形通行规则，不擅自增加陆地或河流禁行。
}


function buildPlan(scene, ref, x, y, {preserveOffsets = false, membersOverride = null} = {}) {
  const pending = !membersOverride && ref.kind === "group" && scene.movementPlans?.find(plan=>plan.mode === "formation-layout" && plan.ref.id===ref.id);
  if (pending) {
    const members = movementMembers(scene,ref);
    const planning = clone(scene);
    planning.groups.find(group=>group.id===ref.id).formation = pending.formation;
    return {...buildPlan(planning,ref,x,y,{preserveOffsets,membersOverride:members}),mode:"formation-layout",formation:pending.formation};
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    fail("移動先の座標は有限の数値で指定してください。");
  }

  const members = membersOverride ?? movementMembers(scene, ref);
  const anchor = ref.kind === "group" ? formationCenter(members,scene.groups.find(group=>group.id===ref.id)?.formation) : members[0];
  const dx = x - anchor.x;
  const dy = y - anchor.y;
  const distance = Math.hypot(dx, dy);

  if (distance > limitFor(members) + EPSILON) {
    fail("速力または残り航続距離の上限を超えています。");
  }

  const formation = ref.kind === "group" ? scene.groups.find(group => group.id === ref.id)?.formation : null;
  if(formation)validateFormationMembers(formationMembers(scene,ref.id),formation);
  const destinations = members.map(unit => {
    const point = formation?.positions.find(point => point.id === unit.instanceId);
    const offset = point && !preserveOffsets ? formationOffset(point, formation) : null;
    const to = offset ? {x:x+offset.x,y:y+offset.y} : {x:unit.x+dx,y:unit.y+dy};
    if (Math.hypot(to.x-unit.x,to.y-unit.y) > limitFor([unit])+EPSILON) fail("陣形移動が速力または航続距離を超えています。");
    validateRoute(scene, unit, to);

    return {
      instanceId: unit.instanceId,
      fromX: unit.x,
      fromY: unit.y,
      x: to.x,
      y: to.y
    };
  });

  return {
    turnNumber: scene.turn.number,
    ref: clone(ref),
    ...(ref.kind === "group" ? {requestedX:x,requestedY:y,
      ...(distance > EPSILON ? {heading:routeHeading([anchor,{x,y}])} : {})} : {}),
    memberIds: members.map(unit => unit.instanceId),
    distance,
    destinations
  };
}

function buildFollowPlan(scene, ref, x, y) {
  if (ref?.kind !== "unit") fail("分旗艦単体を選択して編隊追随を指定してください。");
  const [leader] = movementMembers(scene, ref);
  if (!leader.isFormationFlagship || !scene.groups.some(group=>group.id===leader.groupId))
    fail("所属編隊の分旗艦のみ編隊追随を指示できます。");
  const groupRef = {kind:"group",id:leader.groupId};
  const members = movementMembers(scene,groupRef);
  if (!members.some(unit=>unit.instanceId===leader.instanceId)) fail("分旗艦が編隊円内にいません。");
  const memberIds = new Set(members.map(unit=>unit.instanceId));
  const pending = scene.movementPlans.find(plan=>plan.formation && plan.ref.kind === "group" && plan.ref.id===leader.groupId && ["formation-layout","formation-follow"].includes(plan.mode));
  if (scene.movementPlans.some(plan=>plan.memberIds.some(id=>memberIds.has(id)) &&
      plan !== pending &&
      !(plan.mode === "formation-follow" && plan.leaderId === leader.instanceId) &&
      !(plan.ref.kind === "unit" && plan.ref.id === leader.instanceId)))
    fail("編隊艦が別の移動計画に参加しています。先に取消してください。");
  const group = scene.groups.find(item=>item.id===leader.groupId);
  const center = formationCenter(members,group.formation);
  let plan;
  if (pending) {
    const formation = normalizeFormation(pending.formation);
    if (formation.positions.length !== members.length || formation.positions.some(point=>!memberIds.has(point.id))) fail("円内の陣形構成が変更されています。");
    validateFormationMembers(formationMembers(scene,leader.groupId),formation);
    const offset = formationOffset(formation.positions.find(point=>point.id===leader.instanceId),formation);
    const planning = clone(scene);
    planning.groups.find(item=>item.id===leader.groupId).formation = formation;
    plan = buildPlan(planning,groupRef,x-offset.x,y-offset.y,{membersOverride:members});
    plan.formation = formation;
  } else {
    plan = buildPlan(scene,groupRef,center.x+x-leader.x,center.y+y-leader.y,{preserveOffsets:true});
  }
  return {...plan,mode:"formation-follow",leaderId:leader.instanceId,leaderRequestedX:x,leaderRequestedY:y,
    ...(Math.hypot(x-leader.x,y-leader.y)>EPSILON ? {heading:routeHeading([leader,{x,y}])} : {})};
}

/**
 * 自动移动策略。
 *
 * 正式规则仍由buildPlan校验：
 * 不修改图鉴、不放宽移动力、不绕过终点限制。
 *
 * 决策使用隔离副本，并按行动者阵营计算观察结果。
 * 不修改正式场景的观察阵营或手动权限。
 */
/**
 * 移动前选择救助配对，并规划接近目标。
 * 任务仍由移动后的startPlannedRescues正式启动。
 */
function createAutonomousRescueApproachPlans(scene) {
  if (!scene.controls.enemyAutonomy) return [];

  const planning = copySceneWithSpecialHistory(scene);
  planning.controls.enemyAutonomy = false;

  const reserved = new Set();

  for (const plan of scene.rescuePlans ?? []) {
    reserved.add(plan.rescuerId);
    reserved.add(plan.targetId);
  }

  for (const task of scene.rescueTasks ?? []) {
    if (task.status !== "active") continue;

    reserved.add(task.rescuerId);
    reserved.add(task.targetId);
  }

  const movementPlans = [];
  const rescuePlans = [];

  for (const side of ["enemy", "neutral"]) {
    planning.controls.observationSide = side;

    const visibility = getVisibility(planning);

    const threats = planning.instances.filter(unit =>
      unit.side !== side &&
      positioned(unit) &&
      visibility.has(unit.instanceId) &&
      unit.shipState?.status !== "sunk"
    );

    const targets = planning.instances.filter(unit =>
      unit.side === side &&
      unit.branch === "navy" &&
      positioned(unit) &&
      unit.shipState.status === "sinking" &&
      !unit.supportLocked && unit.shipState.rescueTaskId === null &&
      !reserved.has(unit.instanceId)
    ).sort((a, b) =>
      b.shipState.sinkingElapsedMinutes -
        a.shipState.sinkingElapsedMinutes ||
      (a.instanceId < b.instanceId ? -1 :
        a.instanceId > b.instanceId ? 1 : 0)
    );

    for (const target of targets) {
      if (reserved.has(target.instanceId)) continue;

      const rescuers = planning.instances.filter(unit =>
        unit.side === side &&
        unit.branch === "navy" &&
        operational(unit) &&
        !reserved.has(unit.instanceId) &&
        unit.instanceId !== target.instanceId
      ).sort((a, b) =>
        Number(readShipProfile(b).isRepairShip) -
          Number(readShipProfile(a).isRepairShip) ||
        Math.hypot(a.x - target.x, a.y - target.y) -
          Math.hypot(b.x - target.x, b.y - target.y) ||
        (a.instanceId < b.instanceId ? -1 :
          a.instanceId > b.instanceId ? 1 : 0)
      );

      for (const rescuer of rescuers) {
        const dx = target.x - rescuer.x;
        const dy = target.y - rescuer.y;
        const distance = Math.hypot(dx, dy);

        // 本回合必须能够到达救助有效距离，才登记配对。
        const travel = Math.max(0, distance - (supportRadius(rescuer) - .5));

        if (travel > limitFor([rescuer]) + EPSILON) continue;

        const destination = distance > EPSILON
          ? {
              x: rescuer.x + dx / distance * travel,
              y: rescuer.y + dy / distance * travel
            }
          : { x: rescuer.x, y: rescuer.y };

        // 中立优先自身存活：
        // 不向已发现威胁靠近，也不在近邻威胁旁锁定行动。
        if (
          side === "neutral" &&
          threats.some(threat => {
            const before = Math.hypot(
              threat.x - rescuer.x,
              threat.y - rescuer.y
            );

            const after = Math.hypot(
              threat.x - destination.x,
              threat.y - destination.y
            );

            return (
              after <= 2 ||
              Math.hypot(
                threat.x - target.x,
                threat.y - target.y
              ) <= 2 ||
              after < before - EPSILON
            );
          })
        ) {
          continue;
        }

        let move;

        try {
          move = buildPlan(
            planning,
            { kind: "unit", id: rescuer.instanceId },
            destination.x,
            destination.y
          );
        } catch (error) {
          if (
            error.message === "移動先が地図の範囲外です。" ||
            error.message === "この位置への移動は完了できません。"
          ) {
            continue;
          }

          throw error;
        }

        movementPlans.push(move);

        rescuePlans.push({
          kind: "rescue",
          rescuerId: rescuer.instanceId,
          targetId: target.instanceId,
          turnNumber: scene.turn.number
        });

        reserved.add(rescuer.instanceId);
        reserved.add(target.instanceId);
        break;
      }
    }
  }

  // 自律支援任务改在特殊阶段、支援圈内注册。

  return movementPlans;
}

function createAutonomousMovementPlans(
  scene,
  excludedIds = new Set()
) {

  if (!scene.controls.enemyAutonomy) return [];

  const planning = copySceneWithSpecialHistory(scene);

  // 只在内部隔离副本关闭手动操作门禁。
  // 正式场景仍保持自主开启、玩家仅操作我方。
  planning.controls.enemyAutonomy = false;

  const plans = [];
  const damageByProfile = new Map();
  const autonomousUnits = planning.instances
    .filter(unit =>
    ["enemy", "neutral"].includes(unit.side) &&
    unit.branch !== "building" && !hasAircraftTemplate(unit) && (unit.branch === "navy" || !hasSupportEquipment(unit)) &&
    !excludedIds.has(unit.instanceId)
  )

    .sort((a, b) =>
      a.instanceId < b.instanceId
        ? -1
        : a.instanceId > b.instanceId
          ? 1
          : 0
    );

  const rigidActors=new Map();
  const rigidMembers=new Set();
  for(const group of planning.groups.filter(item=>item.formation && !item.parentId)
    .concat(planning.groups.filter(item=>item.formation && item.parentId))){
    const members=formationMovementMembers(planning,group.id);
    if(!members.length || members.some(item=>rigidMembers.has(item.instanceId)))continue;
    if(members.some(item=>!["enemy","neutral"].includes(item.side)))continue;
    for(const member of members)rigidMembers.add(member.instanceId);
    if(members.some(item=>excludedIds.has(item.instanceId) || item.supportLocked || !operational(item)))continue;
    const anchor=members.find(item=>item.isFormationFlagship) ?? members[0];
    rigidActors.set(anchor.instanceId,{ref:{kind:"group",id:group.id},members});
  }

  const visibilityBySide=new Map();
  for (const unit of autonomousUnits) {
    const rigid=rigidActors.get(unit.instanceId);
    if(rigidMembers.has(unit.instanceId) && !rigid)continue;
    const moveRef=rigid?.ref ?? {kind:"unit",id:unit.instanceId};
    const origin=rigid ? formationCenter(rigid.members,planning.groups.find(group=>group.id===moveRef.id)?.formation) : unit;
    if (unit.branch !== "navy") {
      fail(
        "海軍以外の自律移動は未接続です。" +
        "未対応のユニットを省略して移動処理できません。"
      );
    }

    // 濒临沉没、沉没、正在执行任务的舰船不生成移动。
    if (unit.supportLocked || !operational(unit)) continue;

    planning.controls.observationSide = unit.side;

    if(!visibilityBySide.has(unit.side))visibilityBySide.set(unit.side,getVisibility(planning));
    const visibility = visibilityBySide.get(unit.side);

    const relevantTargets = planning.instances.filter(target => {
      if (
        hasAircraftTemplate(target) ||
        target.instanceId === unit.instanceId ||
        target.side === unit.side ||
        !positioned(target) ||
        target.shipState?.status === "sunk" ||
        !visibility.has(target.instanceId)
      ) {
        return false;
      }

      // 敌方只追踪我方；中立保守地避开其他阵营。
      return unit.side === "enemy"
        ? target.side === "ally"
        : true;
    });

    // 不使用未发现单位的真实位置。
    // 暂无可见目标时保持位置，不伪造追踪情报。
    if (!relevantTargets.length) continue;

    const movementLimit = limitFor(rigid?.members ?? [unit]);

    if (
      !Number.isFinite(movementLimit) ||
      movementLimit < 0
    ) {
      fail("自律移動の移動上限が不正です。");
    }

    if (movementLimit === 0) continue;

    function nearestDistance(x, y) {
      return Math.min(
        ...relevantTargets.map(target =>
          Math.hypot(target.x - x, target.y - y)
        )
      );
    }

    const initialDistance = nearestDistance(origin.x, origin.y);
    const holdsRange = unit.side === "enemy" &&
      !["moderate", "heavy"].includes(unit.shipState.status);
    const engagementRange = holdsRange
      ? getAutonomousEngagementRange(unit, planning.turn.number, damageByProfile)
      : 1;
    if (engagementRange === null) continue;

    // Capping all sampled travel by the nearest starting gap also prevents a
    // straight path from crossing inside the engagement range en route.
    const travelLimit = holdsRange
      ? Math.min(movementLimit, initialDistance - engagementRange)
      : movementLimit;
    if (travelLimit <= EPSILON) continue;

    // 候选采样属于决策策略，不是新增移动规则。
    const candidates = [{ x: origin.x, y: origin.y }];

    function addDirection(dx, dy) {
      const length = Math.hypot(dx, dy);
      if (length <= EPSILON) return;

      for (const fraction of [0.25, 0.5, 0.75, 1]) {
        const distance = travelLimit * fraction;

        candidates.push({
          x: origin.x + dx / length * distance,
          y: origin.y + dy / length * distance
        });
      }
    }

    for (let index = 0; index < 16; index++) {
      const angle = index * Math.PI * 2 / 16;
      addDirection(Math.cos(angle), Math.sin(angle));
    }

    for (const target of relevantTargets) {
      const dx = target.x - origin.x;
      const dy = target.y - origin.y;

      addDirection(dx, dy);
      addDirection(-dx, -dy);

      // 敌方可接近到目标附近，但不把目标位置
      // 当作必须占据的位置。
      if (unit.side === "enemy") {
        const distance = Math.hypot(dx, dy);
        const travel = Math.min(
          travelLimit,
          Math.max(0, distance - engagementRange)
        );

        if (distance > EPSILON && travel > EPSILON) {
          candidates.push({
            x: origin.x + dx / distance * travel,
            y: origin.y + dy / distance * travel
          });
        }
      }
    }

    let bestPlan = null;
    let bestDistance = initialDistance;
    let bestTravel = 0;

    for (const destination of candidates) {
      const distance = nearestDistance(destination.x, destination.y);
      if (holdsRange && distance > bestDistance + EPSILON) continue;
      let plan;

      try {
        plan = buildPlan(
          planning,
          moveRef,
          destination.x,
          destination.y
        );
      } catch (error) {
        // 只排除当前正式移动检查中明确非法的候选位置。
        // 数据、装备、性能或未实现规则错误必须向上抛出。
        const invalidDestination =
          error.message === "移動先が地図の範囲外です。" ||
          error.message === "この位置への移動は完了できません。" ||
          error.message ===
            "速力または残り航続距離の上限を超えています。";

        if (invalidDestination) continue;
        throw error;
      }


      const improved = unit.side === "enemy"
        ? distance < bestDistance - EPSILON
        : distance > bestDistance + EPSILON;

      const equivalent =
        Math.abs(distance - bestDistance) <= EPSILON;

      if (
        improved ||
        (
          bestPlan &&
          equivalent &&
          plan.distance < bestTravel - EPSILON
        )
      ) {
        bestPlan = plan;
        bestDistance = distance;
        bestTravel = plan.distance;
      }
    }

    if (bestPlan && bestPlan.distance > EPSILON) {
      plans.push(bestPlan);
    }
  }

  return plans;
}

export function createSimulationFeatures(getState, commit, commitBackground = null) {
  return {
    getMovementInfo(ref, options = {}) {
      const scene = getState();
      let members = movementMembers(scene, ref, true);
      if (options.depth !== undefined || options.altitude !== undefined) {
        if (ref.kind !== "unit") fail("高度／深度の確認には単艦を選択してください。");
        const unit=members[0];
        const copy={...unit,snapshot:{...unit.snapshot,naval:{...unit.snapshot.naval}}};
        members=[setUnitVertical(copy,options)];
      }

      const anchor = ref.kind === "group" ? formationCenter(members,scene.groups.find(group=>group.id===ref.id)?.formation) : members[0];
      return {
        x: anchor.x,
        y: anchor.y,
        limit: limitFor(members),
        memberIds: members.map(unit => unit.instanceId)
      };
    },

    async saveFormation(id, value) {
      const formation = normalizeFormation(value);
      await commit(scene => {
        const group = scene.groups.find(item => item.id === id);
        const allMembers = formationMembers(scene,id);
        const members = group?.formation?.overview ? formationCircleMembers(scene,id) : allMembers;
        if (formation.positions.length !== members.length || formation.positions.some(point=>!members.some(unit=>unit.instanceId===point.id)))
          fail("陣形編集は現在の編隊円内にいる本編隊艦だけ指定してください。");
        if (members.length !== allMembers.length) formation.membersOnly = true;
        validateFormationMembers(allMembers,formation);
        assertManualControl(scene,members);
        if (!group) fail("編隊が見つかりません。");
        if (scene.turn.phaseId !== "movement") fail("陣形変更は移動段階で計画してください。");
        const center = formationCenter(members,group.formation);
        const planning = clone(scene);
        planning.groups.find(item=>item.id===id).formation = formation;
        const plan = buildPlan(planning,{kind:"group",id},center.x,center.y,{membersOverride:members});
        plan.formation = formation;
        const ids = new Set(plan.memberIds);
        scene.movementPlans = scene.movementPlans.filter(old => !old.memberIds.some(id => ids.has(id)));
        plan.mode = "formation-layout";
        delete plan.heading;
        scene.movementPlans.push(plan);
      });
    },

    async setObservationSide(side) {
      if (!SIDES.includes(side)) {
        fail("観察陣営の指定が不正です。");
      }

      if (getState().controls.enemyAutonomy && side !== "ally") {
        fail("自律行動が有効な場合、観察陣営は味方に固定されます。");
      }

      await commit(scene => {
        scene.controls.observationSide = side;
      });
    },

    async beginMovement() {
      await commit(scene => {
        if (scene.turn.phaseId !== "start") {
          fail("ラウンド開始段階ではありません。");
        }

        if (scene.movementPlans.length) {
          fail("未処理の移動計画が存在します。");
        }

        scene.turn.phaseId = "movement";
      });
    },

        async planMovement(ref, x, y, options = {}) {
      if (
        !options ||
        typeof options !== "object" ||
        Array.isArray(options) ||
        (
          options.followFormationMovement !== undefined &&
          typeof options.followFormationMovement !== "boolean"
        )
      ) {
        fail("移動追随の指定が不正です。");
      }

      await commit(scene => {
        const moving = ref.kind === 'unit' && options.followFormationMovement!==true ? scene.instances.filter(u=>u.instanceId===ref.id) : movementGroupMembers(scene,ref.kind==='group'?ref.id:scene.instances.find(u=>u.instanceId===ref.id)?.groupId);
        assertManualControl(scene,moving);
        if(moving.some(airRetreating))fail("恐慌で撤退中の機体は自動帰投します。");
        if(moving.some(p=>p.aircraftState?.status==='heavy'&&hasAirTrait(p,'martyr')))fail("殉道の大破機は自動体当たりを実行します。");
        interruptSupportForMovement(scene,moving.map(u=>u.instanceId),options.confirmSupportInterruption);
        const follow = options.followFormationMovement === true;
        const changingVertical = options.depth !== undefined || options.altitude !== undefined;
        let planning = scene, vertical = null;
        if (changingVertical) {
          if (ref.kind !== "unit" || follow) fail("高度／深度の変更は単艦で指定し、編隊追随を解除してください。");
          const unit = scene.instances.find(item=>item.instanceId===ref.id);
          if (!unit || (unit.branch !== "navy" && !hasAircraftTemplate(unit))) fail("この操作は艦船・航空機に指定してください。");
          assertManualControl(scene,[unit]);
          vertical = {id:unit.instanceId,fromDepth:unit.depth,fromAltitude:unit.altitude ?? null,
            ...(options.depth === undefined ? {} : {depth:options.depth}),
            ...(options.altitude === undefined ? {} : {altitude:options.altitude})};
          planning = clone(scene);
          setUnitVertical(planning.instances.find(item=>item.instanceId===unit.instanceId),vertical);
        }
        const plan = follow
          ? buildFollowPlan(planning, ref, x, y)
          : buildPlan(planning, ref, x, y);
        if (vertical) plan.vertical = vertical;

        const ids = new Set(plan.memberIds);

        scene.movementPlans = scene.movementPlans.filter(old => {
          if (
            old.mode === "follow" &&
            old.ref?.kind === "unit" &&
            old.ref.id === ref.id &&
            ref.kind === "unit"
          ) {
            return false;
          }

          return !old.memberIds.some(id => ids.has(id));
        });

        scene.movementPlans.push(plan);
      });
    },


    async cancelMovement(ref) {
      await commit(scene => {
        const members = movementMembers(scene, ref);
        const ids = new Set(members.map(unit => unit.instanceId));

        scene.movementPlans = scene.movementPlans.filter(
          plan => !plan.memberIds.some(id => ids.has(id))
        );
      });
    },

    async resolveMovement() {
      if (commitBackground) await commitBackground('movement');
      else await commit(scene => resolveMovementScene(scene));
    }
  };
}

// Shared verbatim movement rules: main-thread compatibility and worker execution.
export function resolveMovementScene(scene) {
        if (scene.turn.phaseId !== "movement") {
          fail("移動段階ではありません。");
        }

        const autonomyEnabled = scene.controls.enemyAutonomy;

if (autonomyEnabled) {
  // 开启前手动保存的非我方计划不能静默覆盖或删除。
  // 明确停止，由玩家先处理旧计划。
  const hasNonAllyManualPlan = scene.movementPlans.some(
    plan => plan.memberIds.some(id => {
      const unit = scene.instances.find(
        item => item.instanceId === id
      );

      return unit && unit.side !== "ally";
    })
  );

  if (hasNonAllyManualPlan) {
    fail(
      "敵・中立の手動移動計画が残っています。" +
      "自律行動を一度無効にして、その計画を取り消してください。"
    );
  }
}

const rescueApproachPlans =
  createAutonomousRescueApproachPlans(scene);

const rescueMovingIds = new Set(
  rescueApproachPlans.flatMap(plan => plan.memberIds)
);

const movementPlans = [
  ...scene.movementPlans,
  ...rescueApproachPlans,
  ...createAutonomousMovementPlans(scene, rescueMovingIds)
];


// 下面的重新校验在独立副本上进行，
// 不放宽正式场景的观察与手动权限。
const validationScene = copySceneWithSpecialHistory(scene);
validationScene.controls.enemyAutonomy = false;



                const checked = [];
        const used = new Set();

        for (const saved of movementPlans) {
          if (saved.turnNumber !== scene.turn.number) {
            fail("別ラウンドの移動計画が混在しています。");
          }

          let rebuilt;

          if (saved.vertical) {
            const unit = validationScene.instances.find(item=>item.instanceId===saved.vertical.id);
            if (saved.ref.kind !== "unit" || saved.ref.id !== saved.vertical.id || saved.memberIds.length !== 1 ||
                !unit || unit.depth !== saved.vertical.fromDepth || (unit.altitude ?? null)!==saved.vertical.fromAltitude)
              fail("高度／深度の開始状態が変わりました。計画を再登録してください。");
            setUnitVertical(unit,saved.vertical);
          }
          if (saved.mode === "formation-layout") {
            const group = validationScene.groups.find(item=>item.id===saved.ref.id);
            if (!group) fail("編隊が見つかりません。");
            const members = group.formation?.overview ? formationCircleMembers(validationScene,group.id) : formationMembers(validationScene,group.id);
            if (members.length !== saved.memberIds.length || members.some(unit=>!saved.memberIds.includes(unit.instanceId)))
              fail("編隊円内の構成が変更されています。陣形計画を再指定してください。");
            validationScene.controls.observationSide = members[0]?.side;
            const formation = normalizeFormation(saved.formation);
            validateFormationMembers(formationMembers(validationScene,group.id),formation);
            assertManualControl(validationScene,members);
            const planning = clone(validationScene);
            planning.groups.find(item=>item.id===group.id).formation = formation;
            rebuilt = buildPlan(planning,saved.ref,saved.requestedX,saved.requestedY,{membersOverride:members});
            rebuilt.formation = formation;
          } else if (saved.mode === "formation-follow") {
            const leader = scene.instances.find(unit=>unit.instanceId===saved.leaderId);
            if (!leader || leader.groupId !== saved.ref.id) fail("追随編隊が変更されています。計画を再指定してください。");
            validationScene.controls.observationSide = leader.side;
            rebuilt = buildFollowPlan(validationScene,{kind:"unit",id:leader.instanceId},saved.leaderRequestedX,saved.leaderRequestedY);
            if (JSON.stringify(rebuilt) !== JSON.stringify(saved)) fail("編隊追随条件が変更されています。計画を再指定してください。");
          } else if (saved.mode === "follow") {
            const leader = scene.instances.find(
              unit => unit.instanceId === saved.ref?.id
            );

            if (
              !leader ||
              leader.groupId !== saved.formationId
            ) {
              fail("追随編隊が変更されています。計画を再指定してください。");
            }

            validationScene.controls.observationSide = leader.side;

            rebuilt = buildFollowPlan(
              validationScene,
              saved.ref,
              saved.requestedX,
              saved.requestedY
            );

            // 包括成员顺序、起点、路线和各舰距离。
            if (JSON.stringify(rebuilt) !== JSON.stringify(saved)) {
              fail("追随条件が変更されています。計画を再指定してください。");
            }
          } else {
            const members = saved.ref.kind === "group" ? movementGroupMembers(scene,saved.ref.id) : entityMembers(scene,saved.ref);

            if (
              members.length !== saved.memberIds.length ||
              members.some(unit =>
                !saved.memberIds.includes(unit.instanceId)
              )
            ) {
              fail("編隊構成が変更されています。移動計画を再指定してください。");
            }

            validationScene.controls.observationSide = members[0].side;

            const anchor = saved.destinations.find(
              item => item.instanceId === members[0].instanceId
            );

            if (!anchor) fail("移動計画の座標が不正です。");

            rebuilt = buildPlan(
              validationScene,
              saved.ref,
              saved.requestedX ?? anchor.x,
              saved.requestedY ?? anchor.y
            );
          }

          if (
            saved.destinations.length !== saved.memberIds.length ||
            new Set(saved.destinations.map(item => item.instanceId)).size !==
              saved.memberIds.length
          ) {
            fail("移動計画の終点一覧が不正です。");
          }

          for (const destination of saved.destinations) {
            const unit = scene.instances.find(
              item => item.instanceId === destination.instanceId
            );

            if (
              !unit ||
              !saved.memberIds.includes(unit.instanceId) ||
              unit.x !== destination.fromX ||
              unit.y !== destination.fromY ||
              used.has(unit.instanceId)
            ) {
              fail("移動計画が重複しているか、開始位置が変更されています。");
            }

            used.add(unit.instanceId);
          }

          if (saved.mode === "formation-layout") {
            rebuilt.mode = saved.mode;
            delete rebuilt.heading;
          }
          if (saved.vertical) rebuilt.vertical = clone(saved.vertical);
          checked.push(rebuilt);
        }

        for (const plan of checked) if (plan.vertical)
          setUnitVertical(scene.instances.find(unit=>unit.instanceId===plan.vertical.id),plan.vertical);

        const routes = checked.flatMap(plan =>
          plan.destinations.map(destination => ({
            instanceId: destination.instanceId,
            rigidGroup:plan.ref.kind === "group" ? plan.ref.id : null,
            route: destination.route ?? [
              { x: destination.fromX, y: destination.fromY },
              { x: destination.x, y: destination.y }
            ]
          }))
        );

        ensureRetreatMissions(scene);
        const ramRoutes=martyrRoutes(scene,new Set(routes.map(r=>r.instanceId)));routes.push(...ramRoutes);
        const missionRoutes=flightMissionRoutes(scene,new Set(routes.map(r=>r.instanceId)));
        routes.push(...missionRoutes);
        const movement = resolveMovementRoutes(
          scene,
          routes,
          unit => limitFor([unit])
        );

        // 航空機の直線移動。空戦・空中衝突規則は後続更新で接続する。
        for(const destination of routes){
          const unit=scene.instances.find(u=>u.instanceId===destination.instanceId);
          if(!hasAircraftTemplate(unit))continue;
          const proxy={...unit,branch:'navy',snapshot:{...unit.snapshot,naval:{...unit.snapshot.naval,kind:'air'}}};
          const clipped=clipLandRoute(scene.terrain,proxy,destination.route);
          const route=trimRoute(clipped.route,limitFor([unit])),last=route.at(-1);
          movement.destinations.push({instanceId:unit.instanceId,x:last.x,y:last.y,distance:routeLength(route),route});
        }
        const formationHeadings = new Map();
        for (const plan of checked) {
          if (Number.isFinite(plan.heading))
            for (const id of plan.memberIds) formationHeadings.set(id, plan.heading);
        }
        // 到这里全场路线、陆地截停与接触事件均已确定。
        const controlStations=remoteStations(scene);
        for (const destination of movement.destinations) {
          const unit = scene.instances.find(
            item => item.instanceId === destination.instanceId
          );

          checkDroneRoute(scene,unit,destination.route,controlStations);
          unit.x = destination.x;
          unit.y = destination.y;
          if (destination.distance > EPSILON) {
            unit.heading = formationHeadings.get(unit.instanceId) ??
              routeHeading(destination.route, unit.heading);
          }

          const movingState=hasAircraftTemplate(unit)?unit.aircraftState:unit.shipState;
          movingState.remainingEndurance=Math.max(0,movingState.remainingEndurance-destination.distance);
        }

        finishMissionMovement(scene,movement.destinations,missionRoutes);
        const movedIds=new Set(movement.destinations.map(d=>d.instanceId));applyLowCloud(scene,scene.instances.filter(p=>p.branch==='air'&&movedIds.has(p.instanceId)));
        for (const plan of checked.filter(item=>item.formation && ["formation-layout","formation-follow"].includes(item.mode))) {
          const complete = plan.destinations.every(target=>{
            const unit = scene.instances.find(item=>item.instanceId===target.instanceId);
            return Math.hypot(unit.x-target.x, unit.y-target.y) <= EPSILON;
          });
          if (complete) {
            scene.groups.find(item=>item.id===plan.ref.id).formation = plan.formation;
            const flagship = scene.instances.find(unit=>plan.memberIds.includes(unit.instanceId) && unit.isFormationFlagship);
            if (flagship && plan.formation.emblem) flagship.formationEmblem = plan.formation.emblem;
          }
        }

        const damageByUnit = new Map();

        for (const collision of movement.collisions) {
          for (const id of collision.unitIds) {
            const unit = scene.instances.find(
              item => item.instanceId === id
            );

            const maxHp = readShipProfile(unit).maxHp;
            const damage = Math.max(1, Math.ceil(maxHp / 2));

            if (!Number.isSafeInteger(damage)) {
              fail("撞撃被害の計算結果が不正です。");
            }

            const total = (damageByUnit.get(id) ?? 0) + damage;

            if (!Number.isSafeInteger(total)) {
              fail("撞撃被害の合計が範囲外です。");
            }

            damageByUnit.set(id, total);
          }
        }

        const damageReports = [];

        for (const [id, damage] of damageByUnit) {
          const unit = scene.instances.find(
            item => item.instanceId === id
          );

          damageReports.push(
            applyShipCollisionDamage(
              unit,
              damage,
              {
                turnNumber: scene.turn.number,
                phaseId: "movement"
              }
            )
          );
        }

        reconcileActiveRescues(scene);
        reconcileAviation(scene);

        scene.movementRuntime ??= {
          version: 1,
          records: []
        };

        scene.movementRuntime.records.push({
          version: 1,
          turnNumber: scene.turn.number,
          phaseId: "movement",
          elapsedMinutes: scene.turn.elapsedMinutes,
          destinations: clone(movement.destinations),
          collisions: clone(movement.collisions),
          damageReports: clone(damageReports)
        });

        // 全部舰船已完成移动，使用移动后的真实位置决策。
// 自主计划与玩家计划一起进入原任务启动流程。
        // 自律支援统一在特殊阶段注册。

        startPlannedRescues(scene);

        scene.movementPlans = [];
        scene.turn.phaseId = "order-5";


        // 移動処理ではラウンド番号も時刻も進めない。
}
