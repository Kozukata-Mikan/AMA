import { assessCluster } from "./cluster-engine.js";
import { RULESET, TURN_PHASES, evaluateAction } from "./rules-engine.js";
import { normalizeEnvironment } from "./environment-data.js";
import { ensureShipRuntime } from "./ship-runtime.js";
import {initializeSimulationFeatures,getObservedScene,assertManualControl,assertIdentifiedTargets,createSimulationFeatures} from "./simulation-features.js";

import {initializeRescueState,createRescueFeatures} from "./simulation-rescue.js";
import { ensureUnitCombatRuntime } from "./equipment-runtime.js";
import { readWeaponProfile, readWeaponTargetScope } from "./weapon-profile-runtime.js";
import { getObserverVisibility , getVisibility} from "./simulation-features.js";

import {traceAttackTerrainLine,entersTerrainInterior} from "./attack-terrain-runtime.js";

import { sampleTerrain } from "./terrain-data.js";
import { getArmorPreview } from "./armor-runtime.js";
import { getCannonDamagePreview } from "./cannon-damage-runtime.js";

import { getNumericDamagePreview, readNumericPower } from "./numeric-damage-runtime.js";

import { initializeRescueRuntime } from "./simulation-rescue-runtime.js";

import { initializeSpecialRuntime } from "./simulation-special-runtime.js";
import { initializeRayTargetRuntime, checkRayTarget } from "./ray-target-runtime.js";

import { initializeAttackRuntime, isAttackPhase, replaceAttackCommands,getAttackExecutionPhase,readAttackCommandTarget } from "./simulation-attack-runtime.js";

import {initializeAttackBatchRuntime, captureAttackPhaseStart, prepareAttackBatchResources } from "./simulation-attack-batch.js";

import { initializeUnifiedDamageRuntime } from "./simulation-unified-damage.js";
import { initializeSettlementRuntime, settleAttackPhase,prepareSettlementAttackPlan , validateDeferredAttackPlans } from "./simulation-settlement.js";

import { initializePhaseFinishRuntime, finishSpecialPhase,  finishTurn} from "./simulation-phase-finish.js";

import { readRangeCommandTarget } from "./simulation-range-command.js";
import { createRangeAttackPanel } from "./simulation-range-target-ui.js";

import { ensureEquipmentItemRuntime, getEquipmentControlCandidates} from "./equipment-item-runtime.js";

import { EQUIPMENT_HIT_ITEMS, tryReadEquipmentPower} from "./equipment-damage-runtime.js";

import { createEquipmentRepairPanel} from "./simulation-equipment-repair-ui.js";

import { readFiringArc } from "./weapon-firing-arc.js";
import { normalizeCampaignIntro } from "./campaign-intro-data.js";

import { buildBattleReport } from "./simulation-battle-report.js";







// ===== 独立推演状态 =====
// 不调用 createBattleStore，避免读取或覆盖自定义模式存档。

const PREFIX = "junqi-simulation-v1:";
const VERSION = 1;
// 只属于推演运行状态，不写入initialScene。
function initializeSimulationEndRuntime(scene) {
  if (scene.simulationEndRuntime === undefined) {
    scene.simulationEndRuntime = {
      version: 1,
      endedAt: null,
      turnNumber: null,
      phaseId: null
    };
  }

  const runtime = scene.simulationEndRuntime;

  if (
    !runtime ||
    typeof runtime !== "object" ||
    Array.isArray(runtime) ||
    runtime.version !== 1
  ) {
    throw new Error("推演終了状態の保存形式が不正です。");
  }

  if (runtime.endedAt === null) {
    if (
      runtime.turnNumber !== null ||
      runtime.phaseId !== null
    ) {
      throw new Error("未終了の推演に終了段階が記録されています。");
    }

    return;
  }

  if (
    typeof runtime.endedAt !== "string" ||
    !Number.isFinite(Date.parse(runtime.endedAt)) ||
    !Number.isSafeInteger(runtime.turnNumber) ||
    runtime.turnNumber < 1 ||
    runtime.turnNumber !== scene.turn.number ||
    runtime.phaseId !== scene.turn.phaseId
  ) {
    throw new Error("推演終了日時または終了段階が不正です。");
  }
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

// 只校验推演运行状态，不修改initialScene或部署快照。
function initializeCombatRuntime(scene) {
  const turn = scene.turn;

  if (
    !turn ||
    typeof turn !== "object" ||
    Array.isArray(turn) ||
    !Number.isSafeInteger(turn.number) ||
    turn.number < 1 ||
    typeof turn.phaseId !== "string" ||
    !TURN_PHASES.some(phase => phase.id === turn.phaseId) ||
    !Number.isSafeInteger(turn.elapsedMinutes) ||
    turn.elapsedMinutes < 0
  ) {
    throw new Error("推演のラウンド・段階・経過時間が不正です。");
  }

  if (!Array.isArray(scene.instances)) {
    throw new Error("推演のユニット一覧が不正です。");
  }

  for (const unit of scene.instances) {
    ensureShipRuntime(unit);
    ensureUnitCombatRuntime(unit);

    if (unit.branch !== "navy") continue;

const itemRuntime = ensureEquipmentItemRuntime(unit);

for (const item of Object.values(itemRuntime.items)) {
  if (
    item.damagedTurn !== null &&
    item.damagedTurn > turn.number
  ) {
    throw new Error("設備損傷の記録が未来のラウンドになっています。");
  }
}

const effects = unit.shipState.effects;


    // 兼容尚未应用特殊状态初始化补丁的文件。
    // 正式特殊阶段接入时会要求该字段存在。
    if (effects === undefined) continue;

    if (effects.lastResolvedTurn > turn.number) {
      throw new Error(
        "特殊状態の処理記録が現在のラウンドより未来になっています。"
      );
    }

    for (const type of ["fire", "flooding"]) {
      const effect = effects[type];

      if (
        effect !== null &&
        effect.acquiredTurn > turn.number
      ) {
        throw new Error(
          "特殊状態の取得記録が現在のラウンドより未来になっています。"
        );
      }
    }
  }
}


function newId() {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error(
      "識別番号を生成できません。HTTPS または localhost で開いてください。"
    );
  }

  return crypto.randomUUID();
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label}は空欄にできません。`);
  }

  return value.trim();
}

// 仅对完全相同的初始资料去重。
// 发生过编队重组等变化的资料仍分别保存。
function packSaved(value) {
  const packed = { ...value };

  delete packed.initialSceneReferences;

  if (
    value.initialScene &&
    typeof value.initialScene === "object"
  ) {
    packed.initialScene = { ...value.initialScene };

    const references = [];

    for (const key of [
      "terrain",
      "instances",
      "groups",
      "environment",
      "view"
    ]) {
      if (
        value[key] !== undefined &&
        value.initialScene[key] !== undefined &&
        JSON.stringify(value[key]) ===
          JSON.stringify(value.initialScene[key])
      ) {
        delete packed.initialScene[key];
        references.push(key);
      }
    }

    if (references.length) {
      packed.initialSceneReferences = references;
    }
  }

  return JSON.stringify(packed);
}

function unpackSaved(value) {
  const references = value.initialSceneReferences;

  // 兼容以前未经去重的存档。
  if (references === undefined) return value;

  const allowed = new Set([
    "terrain",
    "instances",
    "groups",
    "environment",
    "view"
  ]);

  if (
    !Array.isArray(references) ||
    !value.initialScene ||
    references.some(key =>
      !allowed.has(key) || value[key] === undefined
    )
  ) {
    throw new Error("推演スナップショットの書式が不正です。");
  }

  for (const key of references) {
    // 独立恢复初始快照，不让后续修改改变历史资料。
    value.initialScene[key] = copy(value[key]);
  }

  delete value.initialSceneReferences;

  return value;
}

// 压缩已经存在的推演存档。
// 不删除存档；单个写入失败时，原存档仍保留。
export function compactSimulationSaves() {
  const keys = [];

  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);

    if (key?.startsWith(PREFIX)) {
      keys.push(key);
    }
  }

  let compacted = 0;
  let failed = 0;

  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;

      const value = unpackSaved(JSON.parse(raw));

      if (
        value.version !== VERSION ||
        value.mode !== "simulation" ||
        key !== PREFIX + value.id
      ) {
        continue;
      }

      const packed = packSaved(value);

      if (packed.length < raw.length) {
        localStorage.setItem(key, packed);
        compacted += 1;
      }
    } catch (error) {
      console.warn("推演存档压缩失败：", key, error);
      failed += 1;
    }
  }

  return { compacted, failed };
}


function readSaved(id) {
  const raw = localStorage.getItem(PREFIX + id);

  if (raw === null) {
    throw new Error("推演データが見つかりません。");
  }

 const value = unpackSaved(JSON.parse(raw));


  if (
    value.version !== VERSION ||
    value.id !== id ||
    value.mode !== "simulation" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !Array.isArray(value.instances) ||
    !Array.isArray(value.groups) ||
    !Array.isArray(value.actions) ||
    !value.terrain
  ) {
    throw new Error("推演データの書式が不正です。");
  }

    // 兼容之前创建的框架推演。
  value.environment = normalizeEnvironment(value.environment);
    value.controls = {
    ...value.controls,
    enemyAutonomy: value.controls?.enemyAutonomy === true
  };

    if (value.turn === undefined) {
    value.turn = {
      number: 1,
      phaseId: "start",
      elapsedMinutes: 0
    };
  }

  initializeCombatRuntime(value);


  initializeSimulationFeatures(value);

  // 救助属于整个场景，只初始化一次，空实例场景也不能漏掉。
  initializeRescueState(value);
  initializeRescueRuntime(value);
  initializeSpecialRuntime(value);
  initializeRayTargetRuntime(value);
  initializeAttackRuntime(value);
  initializeAttackBatchRuntime(value);
  initializeUnifiedDamageRuntime(value);
  initializeSettlementRuntime(value);
  initializePhaseFinishRuntime(value);
  initializeSimulationEndRuntime(value);




  return value;

}

function writeSaved(value) {
  const key = PREFIX + value.id;
  const text = packSaved(value);

  try {
    localStorage.setItem(key, text);
    return;
  } catch (firstError) {
    // 容量不足时，先对旧推演去重，再重试。
    // 不自动删除任何存档。
    if (
      firstError.name === "QuotaExceededError" ||
      firstError.name === "NS_ERROR_DOM_QUOTA_REACHED"
    ) {
      compactSimulationSaves();

      try {
        localStorage.setItem(key, text);
        return;
      } catch {
        // 继续交给下面的错误提示。
      }
    }

    throw new Error(
      "推演データを保存できません。" +
      "既存の推演を圧縮しても容量が不足しているか、" +
      "ブラウザーが保存を許可していません。" +
      "既存データは削除していません。"
    );
  }
}


// 展开单体或编队，包括已有的嵌套编队。
// 使用 visited 防止异常数据造成死循环。
export function resolveEntity(scene, ref) {
  if (!ref || !["unit", "group"].includes(ref.kind)) {
    throw new Error("行動主体の指定が不正です。");
  }

  if (ref.kind === "unit") {
    const unit = scene.instances.find(
      item => item.instanceId === ref.id
    );

    if (!unit) {
      throw new Error("ユニットが見つかりません。");
    }

    return {
      ref: { kind: "unit", id: unit.instanceId },
      name: unit.name,
      members: [unit]
    };
  }

  const group = scene.groups.find(item => item.id === ref.id);

  if (!group) {
    throw new Error("編隊が見つかりません。");
  }

  const groupIds = new Set();
  const tasks = [group.id];

  while (tasks.length) {
    const id = tasks.pop();

    if (groupIds.has(id)) continue;

    groupIds.add(id);

    for (const child of scene.groups) {
      if (child.parentId === id) {
        tasks.push(child.id);
      }
    }
  }

  const members = scene.instances.filter(
    unit => groupIds.has(unit.groupId)
  );

  if (!members.length) {
    throw new Error("選択した編隊にメンバーがいません。");
  }

  return {
    ref: { kind: "group", id: group.id },
    name: group.name,
    members
  };
}

export function listEntities(scene) {
  const result = scene.instances.map(unit => ({
    ref: { kind: "unit", id: unit.instanceId },
    label: `個体：${unit.name}`
  }));

  for (const group of scene.groups) {
    try {
      const entity = resolveEntity(scene, {
        kind: "group",
        id: group.id
      });

      result.push({
        ref: entity.ref,
        label:
          `${group.kind === "cluster" ? "集群" : "編隊"}：` +
          `${group.name}（${entity.members.length}）`
      });
    } catch {
      // 空编队允许存在，但不能作为行动主体。
    }
  }

  return result;
}

function actorSnapshot(entity) {
  return {
    ref: copy(entity.ref),
    name: entity.name,

    members: entity.members.map(unit => ({
      instanceId: unit.instanceId,
      unitId: unit.unitId,
      name: unit.name,
      branch: unit.branch,
      side: unit.side,
      faction: unit.faction ?? "",
      currentHp: unit.currentHp,
      sizeLevel: unit.sizeLevel,
      x: unit.x,
      y: unit.y,
      heading: unit.heading,
      altitude: unit.altitude,
      underwater: unit.underwater,
      depth: unit.depth
    }))
  };
}

// 从已经部署好的自定义场景创建一次独立推演。
// spatialState 使用现有地图的部署条件，不增加战斗公式。
export function createSimulation(scene, spatialState) {
  if (
    !scene ||
    !Array.isArray(scene.instances) ||
    !Array.isArray(scene.groups) ||
    typeof spatialState !== "function"
  ) {
    throw new Error("推演開始データが不正です。");
  }

  if (!scene.instances.length) {
    throw new Error("参戦ユニットを配置してから推演を開始してください。");
  }

  const problems = [];

  for (const unit of scene.instances) {
    const spatial = spatialState(unit);

    if (!spatial.valid) {
      problems.push(`${unit.name}：${spatial.reason}`);
    }

    if (!unit.snapshot) {
      problems.push(`${unit.name}：図鑑スナップショットがありません。`);
    }
  }

  if (problems.length) {
    throw new Error(
      "推演を開始できません。\n" +
      problems.slice(0, 15).join("\n") +
      (
        problems.length > 15
          ? `\nほか ${problems.length - 15} 件`
          : ""
      )
    );
  }

  const id = newId();
  const now = new Date().toISOString();

  const value = {
    version: VERSION,
    mode: "simulation",
    id,
    revision: 0,
    controls: {
      enemyAutonomy: false
    },
    name: scene.name,
    createdAt: now,
    updatedAt: now,

    ruleset: copy(RULESET),

    // 初始完整快照用于追溯，不随推演中的编队重组变化。
    initialScene: copy(scene),

    terrain: copy(scene.terrain),
    environment: normalizeEnvironment(scene.environment),
    
    // 从自定义战役复制，不修改initialScene。
    campaignIntro: normalizeCampaignIntro(scene.campaignIntro),



    turn: {
      number: 1,
      phaseId: "start",
      elapsedMinutes: 0
    },

    instances: copy(scene.instances),
    groups: copy(scene.groups),

    // 原编辑器的历史记录留在 initialScene.actions。
    // 新推演记录使用新的结构，不混入旧记录。
    actions: [],
    view: copy(scene.view)
  };

  initializeCombatRuntime(value);
  initializeSimulationFeatures(value);
  initializeRescueState(value);
  initializeRescueRuntime(value);
  initializeSpecialRuntime(value);
  initializeRayTargetRuntime(value);
  initializeAttackRuntime(value);
  initializeAttackBatchRuntime(value);
  initializeUnifiedDamageRuntime(value);
  initializeSettlementRuntime(value);
  initializePhaseFinishRuntime(value);
  initializeSimulationEndRuntime(value);



  writeSaved(value);

  return id;

}

export function openSimulation(id) {
  requireText(id, "推演番号");

  let state = readSaved(id);
  const listeners = new Set();

  function notify() {
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        console.error(error);
      }
    }
  }

    function commit(change) {
    if (typeof change !== "function") {
      throw new Error("保存処理の指定が不正です。");
    }

    const latest = readSaved(id);

    // 防止其他页面覆盖当前页面的修改。
    if (latest.revision !== state.revision) {
      throw new Error(
        "別の画面で推演が更新されています。" +
        "ページを再読み込みしてください。"
      );
    }

    // 已结束的推演保留数据，但拒绝后续状态写入。
// 查看、报告、地图操作和导出不经过commit，不受影响。
    if (state.simulationEndRuntime.endedAt !== null) {
     throw new Error(
    "この推演は終了しています。" +
    "行動・計画・段階・設定は変更できません。" +
    "戦闘記録と地図は引き続き確認できます。"
  );
}

    // 所有修改只发生在独立候选副本。
    const candidate = copy(state);

    const previousTurn = state.turn.number;
    const previousPhase = state.turn.phaseId;
    const previousRevision = state.revision;

    // 初始场景包含原始部署资料与图鉴快照，禁止事务修改。
    const initialSceneBefore = JSON.stringify(state.initialScene);

    const snapshotBefore = JSON.stringify(
      state.instances.map(unit => ({
        instanceId: unit.instanceId,
        snapshot: unit.snapshot
      }))
    );

    const result = change(candidate);

    // 当前localStorage事务必须同步完成。
    // 不允许异步回调先返回，再修改候选状态。
    if (
      result !== null &&
      result !== undefined &&
      typeof result.then === "function"
    ) {
      throw new Error(
        "非同期の処理は、この保存トランザクションでは実行できません。"
      );
    }

    // 事务不能变更存档身份或自行递增更新号。
    if (
      candidate.id !== state.id ||
      candidate.mode !== state.mode ||
      candidate.version !== state.version ||
      candidate.createdAt !== state.createdAt ||
      candidate.revision !== previousRevision
    ) {
      throw new Error(
        "保存データの識別情報または更新番号を変更できません。"
      );
    }

    if (
      JSON.stringify(candidate.initialScene) !== initialSceneBefore
    ) {
      throw new Error(
        "初期場面のスナップショットは変更できません。"
      );
    }

    // 正式战斗通过运行状态记录损伤，不改部署图鉴快照。
    const snapshotAfter = JSON.stringify(
      candidate.instances?.map(unit => ({
        instanceId: unit.instanceId,
        snapshot: unit.snapshot
      }))
    );

    if (snapshotAfter !== snapshotBefore) {
      throw new Error(
        "配置ユニットの一覧または図鑑スナップショットを変更できません。"
      );
    }

    // 规则未完整实现时，不能通过保存事务宣称已就绪。
    if (
      RULESET.ready !== false ||
      candidate.ruleset?.ready !== false
    ) {
      throw new Error(
        "規則の実装が完了していないため、準備完了には変更できません。"
      );
    }

    initializeCombatRuntime(candidate);

    // 正式伤害事务必须先协调救助中断。
    // 保存层只校验，不擅自抽签、补算或修复战斗结果。
    initializeRescueState(candidate);
    initializeRescueRuntime(candidate);
    initializeSpecialRuntime(candidate);
    initializeRayTargetRuntime(candidate);
    initializeAttackRuntime(candidate);
    initializeSettlementRuntime(candidate);
    initializePhaseFinishRuntime(candidate);
    initializeSimulationEndRuntime(candidate);


    const enteredNewPhase =
      candidate.turn.number !== previousTurn ||
      candidate.turn.phaseId !== previousPhase;

    if (enteredNewPhase) {
      // 允许合法未来计划和刚到执行次序的计划。
     // 已错过次序、非攻击阶段残留、跨回合计划均拒绝。
     initializeAttackRuntime(candidate);


      // 只重建运行快照，不修改initialScene。
      candidate.attackBatchRuntime = {
        version: 1,
        snapshot: null
      };

      // 移动结束及后续攻击次序入口在此统一捕获快照。
      if (isAttackPhase(candidate.turn.phaseId)) {
        captureAttackPhaseStart(candidate);
      }
    }

    initializeAttackBatchRuntime(candidate);

    // 这里只校验既有记录，不执行旧统一伤害模块。
    initializeUnifiedDamageRuntime(candidate);



    if (
      !Number.isSafeInteger(previousRevision) ||
      previousRevision < 0 ||
      previousRevision >= Number.MAX_SAFE_INTEGER
    ) {
      throw new Error("推演の保存更新番号が範囲外です。");
    }

    candidate.revision = previousRevision + 1;
    candidate.updatedAt = new Date().toISOString();

    // 回调可能触发其他同步保存，写入前再次检查。
    const beforeWrite = readSaved(id);

    if (beforeWrite.revision !== previousRevision) {
      throw new Error(
        "保存処理中に推演が更新されました。" +
        "今回の変更は保存していません。"
      );
    }

    // 沿用现有压缩、容量不足重试与存档键。
    // 写入失败会抛出错误，不更新内存、不通知界面。
    writeSaved(candidate);

    state = candidate;
    notify();
  }


  function previewDraft({
    attacker,
    target,
    actionType,
    note = ""
  }) {
    requireText(actionType, "行動種別");

    if (
      !["攻撃", "防空", "その他の行動"].includes(actionType)
    ) {
      throw new Error("対応していない行動種別です。");
    }

    if (typeof note !== "string" || note.length > 2000) {
      throw new Error("メモは 2000 文字以内にしてください。");
    }

        // 外方编队结构没有公开，不能用已知ID绕过观察过滤。
    if (
      target?.kind === "group" &&
      !getObservedScene(state).groups.some(
        group => group.id === target.id
      )
    ) {
      throw new Error(
        "未公開の編隊を目標として指定できません。"
      );
    }

    const actingEntity = resolveEntity(state, attacker);
    const targetEntity = resolveEntity(state, target);
    assertManualControl(state, actingEntity.members);
    assertIdentifiedTargets(state, targetEntity.members);

    if (actingEntity.members.some(unit =>
      unit.branch === "navy" &&
      (
        ["sinking", "sunk"].includes(unit.shipState.status) ||
        unit.shipState.rescueTaskId !== null
      )
    )) {
      throw new Error(
        "行動不能または救助中の艦船は、行動を指定できません。"
      );
    }

        if (
      state.controls?.enemyAutonomy === true &&
      actingEntity.members.some(unit =>
        unit.side === "enemy" || unit.side === "neutral"
      )
    ) {
      throw new Error(
        "自律行動が有効な場合、敵と中立の行動は手動指定できません。" +
        "自律行動の計画処理はまだ実装されていません。"
      );

    }


    const actingIds = new Set(
      actingEntity.members.map(unit => unit.instanceId)
    );

    // 不只排除同一个选择项，也排除父子编队和单体/编队成员重叠。
    if (targetEntity.members.some(unit =>
      actingIds.has(unit.instanceId)
    )) {
      throw new Error(
        "行動側と目標側のメンバーが重複しています。" +
        "別の個体または編隊を指定してください。"
      );
    }

    return {
      revision: state.revision,
      actionType,
      note,
      attacker: actorSnapshot(actingEntity),
      target: actorSnapshot(targetEntity),
      ruling: evaluateAction()
    };
  }

       const api = {
  ...createSimulationFeatures(() => state, commit),
  ...createRescueFeatures(() => state, commit),

  getSimulationStatus() {
  const runtime = state.simulationEndRuntime;

  return copy({
    revision: state.revision,
    ended: runtime.endedAt !== null,
    endedAt: runtime.endedAt,
    endedTurnNumber: runtime.turnNumber,
    endedPhaseId: runtime.phaseId,
    turnNumber: state.turn.number,
    phaseId: state.turn.phaseId
  });
},

endSimulation(expectedRevision) {
  if (expectedRevision !== state.revision) {
    throw new Error(
      "状態が変更されています。もう一度確認してください。"
    );
  }

  // 重复调用不增加更新号，也不重复保存。
  if (state.simulationEndRuntime.endedAt !== null) {
    return api.getSimulationStatus();
  }

  commit(candidate => {
    candidate.simulationEndRuntime = {
      version: 1,
      endedAt: new Date().toISOString(),
      turnNumber: candidate.turn.number,
      phaseId: candidate.turn.phaseId
    };

    // 不推进阶段、不结算、不扣弹、不清空等待计划。
  });

  // 只有保存成功才返回已结束状态。
  return api.getSimulationStatus();
},

getBattleReport() {
  if (state.simulationEndRuntime.endedAt === null) {
    throw new Error(
      "全陣営の戦闘記録は、推演終了後に確認できます。"
    );
  }

  // 结束后的专用复盘入口。
  // 只返回报告摘要，不返回完整场景、部署快照或内部命令对象。
  return copy(buildBattleReport(state));
},



    getEquipmentRepairOptions(rescuerId) {
  const rescuer = state.instances.find(
    unit => unit.instanceId === rescuerId
  );

  if (!rescuer || rescuer.branch !== "navy") {
    throw new Error("修復艦を確認できません。");
  }

  assertManualControl(state, [rescuer]);

  const observed = getObservedScene(state);
  const labels = new Map(
    EQUIPMENT_HIT_ITEMS.map(item => [item.id, item.label])
  );

  // 面板不枚举外方内部损伤。
  const targets = observed.instances.filter(unit =>
    unit.observationOwn === true &&
    unit.branch === "navy" &&
    unit.instanceId !== rescuerId &&
    unit.shipState?.status !== "sunk" &&
    unit.shipState?.rescueTaskId === null
  ).map(unit => ({
    id: unit.instanceId,
    label: unit.name,
    items: getEquipmentControlCandidates(unit).map(id => ({
      id,
      label: labels.get(id)
    }))
  })).filter(target => target.items.length > 0);

  return copy({
    revision: state.revision,
    phaseId: state.turn.phaseId,
    targets
  });
},

mountEquipmentRepairPanel(container, rescuerId) {
  if (!(container instanceof Element)) {
    throw new Error("修復画面の表示先が不正です。");
  }

  const panel = createEquipmentRepairPanel({
    store: api,
    rescuerId
  });

  container.append(panel.element);
  return panel;
},

           


    getControlSettings() {

      return {
        enemyAutonomy: state.controls?.enemyAutonomy === true
      };
    },

    setEnemyAutonomy(enabled) {
      if (typeof enabled !== "boolean") {
        throw new Error("自律行動の設定には真偽値を指定してください。");
      }

      if (enabled === (state.controls?.enemyAutonomy === true)) {
        return;
      }

      commit(candidate => {
  if (!["start", "movement"].includes(candidate.turn.phaseId)) {
    throw new Error(
      "自律行動の切替はラウンド開始または移動段階で行ってください。"
    );
  }

  if (enabled) {
    const unitSide = id =>
      candidate.instances.find(
        unit => unit.instanceId === id
      )?.side;

    const foreignMovement = candidate.movementPlans.some(
      plan => plan.memberIds.some(id => unitSide(id) !== "ally")
    );

    const foreignRescue = candidate.rescuePlans.some(
      plan => unitSide(plan.rescuerId) !== "ally"
    );

    const foreignAttack = candidate.attackRuntime.commands.some(
      command => unitSide(command.unitId) !== "ally"
    );

    if (foreignMovement || foreignRescue || foreignAttack) {
      throw new Error(
        "敵・中立の手動計画が残っています。" +
        "その計画を取り消してから自律行動を有効にしてください。"
      );
    }
  }

  candidate.controls = {
    ...candidate.controls,
    enemyAutonomy: enabled,
    observationSide: enabled
      ? "ally"
      : candidate.controls.observationSide
  };
});

    },

    getScene() {
      return getObservedScene(state);
    },



    getEntities() {
      return listEntities(getObservedScene(state));
    },

            getAttackEquipmentProfiles(instanceId) {
      const unit = state.instances.find(
        item => item.instanceId === instanceId
      );

      if (!unit) {
        throw new Error("ユニットが見つかりません。");
      }

      assertManualControl(state, [unit]);

      const equipment = unit.snapshot?.equipmentSnapshots;

      if (equipment === undefined) {
        return {
          profiles: [],
          issues: [
            "配置スナップショットに装備資料がありません。" +
            "現在の図鑑から自動補完しません。"
          ]
        };
      }

      if (!Array.isArray(equipment)) {
        throw new Error(
          "装備スナップショットの一覧形式が不正です。"
        );
      }

      return {
        profiles: equipment.map(item => readWeaponProfile(item)),
        issues: []
      };
    },

    getAttackGroupReport(instanceId) {
      const unit = state.instances.find(
        item => item.instanceId === instanceId
      );

      if (!unit) {
        throw new Error("ユニットが見つかりません。");
      }

      // 必须在完整状态入口检查权限，不能只靠界面过滤。
      assertManualControl(state, [unit]);

      const equipment = new Map(
        (unit.snapshot.equipmentSnapshots ?? [])
          .map(item => [item.id, item])
      );

      const phaseId = state.turn.phaseId;
      const turnNumber = state.turn.number;
      const orderMatch = /^order-([1-5])$/.exec(phaseId);
      const currentOrder = orderMatch
        ? Number(orderMatch[1])
        : null;

      const unitIssues = [];

      if (unit.branch === "navy") {
        if (["sinking", "sunk"].includes(unit.shipState.status)) {
          unitIssues.push("沈没寸前・沈没の艦船は行動できません。");
        }

        if (unit.shipState.rescueTaskId !== null) {
          unitIssues.push("救助中の艦船は他の行動を実行できません。");
        }
      } else {
        // 当前缺少其他军种的正式行动限制适配。
        unitIssues.push(
          "この軍種の正式な攻撃資格判定は未接続です。"
        );
      }

     const groups = unit.equipmentState.groups.map(group => {
     const source = equipment.get(group.equipmentId);
     const profile = source
    ? readWeaponProfile(source, group)
    : null;

        const issues = [...unitIssues];

        if (!profile) {
          issues.push("配置スナップショットに装備性能がありません。");
        } else if (profile.kind !== "weapon") {
          issues.push("この装備は武器ではありません。");
        } else {
          issues.push(...profile.issues);

        if (profile.pasOnly) {
        if (!isAttackPhase(phaseId)) {
        issues.push(
        "PAS装備の計画は次序1～5またはPASで登録してください。"
         );
       }
           } else if (profile.maxOrder !== null) {

            if (currentOrder === null) {
              issues.push("通常武器は次序1～5で使用します。");
            } 
          }
        }

        if (group.destroyed) {
        issues.push("この装備組は完全破損しています。修復できません。");
        } else if (group.damaged) {
        issues.push("この装備組は損傷しています。");
        }

        if (group.lastUsedTurn === turnNumber) {
          issues.push("この装備組はこのラウンドで使用済みです。");
        } else if (
          group.lastUsedTurn !== null &&
          group.lastUsedTurn > turnNumber
        ) {
          issues.push("使用記録が現在のラウンドより後になっています。");
        }

        if (group.remainingAmmo === null) {
          issues.push("残弾が未登録です。無限弾薬として扱いません。");
        } else if (group.remainingAmmo === 0) {
          issues.push("残弾がありません。");
        } else if (
          profile?.fullAmmoCost !== null &&
          profile?.fullAmmoCost !== undefined &&
          group.remainingAmmo < profile.fullAmmoCost
        ) {
          // 登记实现边界；不猜测减量攻击的叠分配。
          issues.push(
            "完全投射には残弾が不足しています。" +
            "減量投射の処理は未接続のため、結算できません。"
          );
        }

        return {
          // groupId只在本单位内唯一，不能单独用于全场查找。
          unitId: unit.instanceId,
          groupId: group.id,
          equipmentId: group.equipmentId,
          position: group.position,
          groupIndex: group.groupIndex,
          label: profile?.label ?? "性能未登録の装備",
          remainingAmmo: group.remainingAmmo,
          lastUsedTurn: group.lastUsedTurn,
          damaged: group.damaged,
          destroyed: group.destroyed,
          profile,
          issues: [...new Set(issues)]
        };
      });

      // 返回独立数据，调用方不能修改状态缓存。
      return copy({
        revision: state.revision,
        turnNumber,
        phaseId,
        unitId: unit.instanceId,
        unitName: unit.name,
        unresolvedMountIndexes:
          unit.equipmentState.unresolvedMountIndexes,
        groups,
        settlementConnected: true
      });
    },

        getAttackTargetReport({
      unitId,
      groupId,
      targetId
    }) {
      const actor = state.instances.find(
        unit => unit.instanceId === unitId
      );

      if (!actor) {
        throw new Error("行動側のユニットが見つかりません。");
      }

      assertManualControl(state, [actor]);

      const target = state.instances.find(
        unit => unit.instanceId === targetId
      );

      // 不用错误提示区分隐藏目标是否存在。
      if (!target) {
        throw new Error("目標を確認できません。");
      }

      assertIdentifiedTargets(state, [target]);

      const group = actor.equipmentState.groups.find(
        item => item.id === groupId
      );

      if (!group) {
        throw new Error("指定した装備組が見つかりません。");
      }

      const source = (
        actor.snapshot.equipmentSnapshots ?? []
      ).find(item => item.id === group.equipmentId);

      if (!source) {
        throw new Error("装備性能のスナップショットがありません。");
      }

      const profile = readWeaponProfile(source, group);


      if (profile.kind !== "weapon") {
        throw new Error("この装備は武器ではありません。");
      }

      const issues = [];
      const boundaries = [
        "これは現在状態の確認です。正式結算では段階開始状態と全批次の条件を再確認します。"
      ];

      if (actor.instanceId === target.instanceId) {
        issues.push("自分自身を攻撃目標には指定できません。");
      }

      if (actor.side === target.side) {
        // 友军攻击规则没有依据，不把它当成默认允许。
        boundaries.push("同一陣営への攻撃ルールは未接続です。");
      }

      if (actor.branch !== "navy" || target.branch !== "navy") {
        return {
          revision: state.revision,
          distance3D: null,
          relativeHeight: null,
          terrainInterior: null,
          issues,
          boundaries: [
            ...boundaries,
            "この確認は海軍から海軍への攻撃に限ります。"
          ],
          settlementConnected: true
        };
      }

      if (target.shipState.status === "sunk") {
        boundaries.push("沈没艦への攻撃ルールは未接続です。");
      }

      function navalPoint(unit) {
        if (
          !Number.isFinite(unit.x) ||
          !Number.isFinite(unit.y)
        ) {
          throw new Error("艦船の位置が不正です。");
        }

        const sample = sampleTerrain(
          state.terrain,
          unit.x,
          unit.y
        );

        if (!sample.inside) {
          throw new Error("艦船が地図の範囲外にあります。");
        }

        // 与现有地图显示的舰船高度规则保持一致。
        const z = unit.underwater
          ? -(unit.depth ?? 12)
          : sample.surface;

        if (!Number.isFinite(z)) {
          throw new Error("艦船の深度が不正です。");
        }

        return { x: unit.x, y: unit.y, z };
      }

      try {
  const arc = readFiringArc(actor, group, target);

  boundaries.push(
    `射界内：艦首基準 ${arc.relativeDegrees.toFixed(1)}°`
  );

  if (arc.positionKind === "sides") {
    boundaries.push(
      "両舷装備の左右別使用数は、" +
      "このラウンドの既存射撃と全攻撃計画を合わせて確認します。"
    );
  }
} catch (error) {
  if (error.code !== "TARGET_INELIGIBLE") throw error;
  issues.push(error.message);
}

      const from = navalPoint(actor);
      const to = navalPoint(target);

      const trace = traceAttackTerrainLine(
        state.terrain,
        from,
        to
      );

      const relativeHeight = to.z - from.z;
      const terrainInterior = entersTerrainInterior(trace);
      const tolerance = 1e-7;

                  // “数字（水下）”威力或“平射（水下）”引导，
      // 任一条件成立即属于水下武器。
      // 同时兼容标准化后的profile和部署快照原始引导文本。
      const underwaterPower =
        typeof profile.powerRule === "string" &&
        /^\s*\d+(?:\.\d+)?\s*[（(]\s*水下\s*[）)]\s*$/
          .test(profile.powerRule);

      const underwaterDirect = [
        profile.guidance,
        source.guidance
      ].some(value =>
        typeof value === "string" &&
        /^\s*平射\s*[（(]\s*水下\s*[）)]\s*$/.test(value)
      );

      const underwaterWeapon =
        profile.underwater === true ||
        underwaterPower ||
        underwaterDirect;

      // 水下平射仍按平射检查真实地形。
      // 只有“平射（水下）”需要在这里归一为direct；
      // 不把其他引导方式的水下数字武器强行改为平射。
      const attackGuidance = underwaterDirect
        ? "direct"
        : profile.guidance;

      if (underwaterWeapon) {
        // 海平面是高度0，而不是发射舰自身的高度。
        // 水下武器可以攻击水面和水下，不能攻击海平面以上。
        if (to.z > tolerance) {
          issues.push(
            "水中武器は海面より上の目標を攻撃できません。"
          );
        }
      } else {
        // 普通舰船武器保持现有向下攻击限制。
        if (relativeHeight < -tolerance) {
          issues.push(
            "通常の艦船武器は下方の目標を攻撃できません。"
          );
        }

        // 明确禁止普通武器攻击水下单位。
        // 即使发射者也在水下，不能因相对高度不为负而绕过。
        if (target.underwater === true) {
          issues.push(
            "通常の艦船武器は水中の目標を攻撃できません。"
          );
        }
      }



      if (
        profile.ceilingU !== null &&
        relativeHeight > profile.ceilingU + tolerance
      ) {
        issues.push("目標との相対高度が射高を超えています。");
      }

      if (
        profile.range !== null &&
        trace.distance3D > profile.range + tolerance
      ) {
        issues.push("三次元距離が射距を超えています。");
      }

      switch (attackGuidance) {
        case "direct":
          if (terrainInterior) {
            issues.push("三次元の射撃直線が地形内部を通過します。");
          }
          break;

        case "lobbed":
          // 高度30以下は越えられる。侦察の「30以上」と別条件。
          if (trace.maxGroundHeight > 30 + tolerance) {
            issues.push("高度30を超える地形を越えられません。");
          }
          break;

        case "inertial":
          // 地形では拒否しない。
          break;

        case "radar":
          if (
            getObserverVisibility(state, actor, target) === null
          ) {
            issues.push(
              "レーダー誘導には発射艦自身による目標発見が必要です。"
            );
          }

          boundaries.push(
            "正式結算では発射艦自身の発見状態を段階開始記録で再確認します。"
          );
          break;

        case "computer":
          // 上のassertIdentifiedTargetsにより、
          // 現在の陣営が識別した対象であることは確認済み。
          boundaries.push(
            "正式結算では攻撃陣営の目標識別を段階開始記録で再確認します。"
          );
          break;

                        case "ray": {
          if (terrainInterior) {
            issues.push(
              "三次元の射撃直線が地形内部を通過します。"
            );
          }

          const rayCheck = checkRayTarget({
            scene: state,
            unitId: actor.instanceId,
            targetId: target.instanceId,
            turnNumber: state.turn.number
          });

          if (!rayCheck.allowed) {
            issues.push(rayCheck.reason);
          }

          boundaries.push(
            "正式発射時に、このラウンドの射線目標を固定します。命中の有無には依存しません。"
          );

          break;
        }



        default:
          issues.push("引導方式を確認できません。");
      }

      if (profile.large) {
        boundaries.push(
          "大型の区分は保存されていますが、専用効果は未接続です。"
        );
      }

            let armorPreview;

const equipmentPower = tryReadEquipmentPower(
  profile.powerRule
);

if (equipmentPower) {
  armorPreview = [
    "【設備威力】",
    `武器1枚の命中につき${equipmentPower.power}回、設備項目を抽選します。`,
    "六つの装備位置と対海・対空偵察の固定8項目から、等確率で抽選します。",
    "空位置・損傷済み・完全破損済みの項目も抽選対象です。",
    "同じ項目への重複命中は損傷を重ねません。",
    "耐性を減らさず、貫通・装甲・慣性防御を適用しません。"
  ];
} else {
  try {

        const naval = target.snapshot.naval;

        const effectiveArmor = profile.guidance === "inertial"
          ? ["F", "E", "D", "C", "B", "A", "S", "U"][
              naval.strength
            ]
          : naval.armor;

        armorPreview = getArmorPreview({
          penetration: profile.penetration,
          armor: effectiveArmor,
          powerRule: profile.powerRule
        });

          if (/舰炮规则|艦砲規則|艦砲ルール/.test(profile.powerRule)) {
          if (profile.penetration.trim() === "-") {
            armorPreview.push(
              "貫通値0の艦砲結算は未接続です。" +
              "資料欠落とは扱わず、正式結算を停止します。"
            );
          } else {
            armorPreview.push(
              "",
              "【艦砲命中後の処理】",
              ...getCannonDamagePreview({
                penetration: profile.penetration,
                armor: effectiveArmor
              })
            );
          }
        }

                // 先判断是否为本模块支持的威力。
        // 舰炮和设备威力仍由各自模块处理。
        let isNumericPower = false;

        try {
          readNumericPower(profile.powerRule);
          isNumericPower = true;
        } catch {
          // 不在这里把其他威力类型误判为数字威力。
        }

        if (isNumericPower) {
          armorPreview.push(
            "",
            "【数字威力の被害規則】",
            ...getNumericDamagePreview({
              powerRule: profile.powerRule,
              penetration: profile.penetration,
              armor: naval.armor,
              inertial: profile.guidance === "inertial",
              strength: naval.strength
            })
          );
        }

        
        if (profile.guidance === "inertial") {
          armorPreview.unshift(
            "慣性攻撃：本来の装甲ではなく、強度対応等級を使用します。"
          );
        }
        } catch (error) {
    armorPreview = [
      `装甲比較を確認できません：${error.message}`
      ];
      }
     }

     return {

        revision: state.revision,
        distance3D: trace.distance3D,
        relativeHeight,
        terrainInterior,
        armorPreview,
        issues: [...new Set(issues)],
        boundaries: [...new Set(boundaries)],
        settlementConnected: true
      };
    },


          
       previewDraft,

        getAttackResourceReport(instanceId) {
      const unit = state.instances.find(
        item => item.instanceId === instanceId
      );

      if (!unit) {
        throw new Error("ユニットが見つかりません。");
      }

      assertManualControl(state, [unit]);

      // 检查的是全场批次。
      // 不向页面返回外方命令、装备、目标或具体失败原因。
      let prepared;

      try {
        prepared = prepareAttackBatchResources(copy(state));
      } catch {
        return {
          revision: state.revision,
          resourcePreparationPassed: false,
          settlementConnected: true,
          entries: [],
          reason:
            "全批次の準備条件を満たしていません。" +
            "段階開始記録、目標識別、計画、装備、残弾、" +
            "または未接続処理を確認してください。"

        };
      }

      const ownEntries = prepared.entries.filter(
        entry => entry.unitId === instanceId
      );

      return copy({
        revision: state.revision,
        resourcePreparationPassed: true,
        settlementConnected: true,
        entries: ownEntries.map(entry => ({
          groupId: entry.groupId,
          ammoBefore: entry.ammoBefore,
          ammoCost: entry.ammoCost,
          ammoAfter: entry.ammoAfter,
          groups: entry.projection.groups,
          coinsPerGroup: entry.projection.coinsPerGroup,
          standalone: entry.projection.standalone
        })),
        reason:
          "段階開始時の目標識別と装備・資源の準備を確認しました。" +
          "射距・射高・地形・特殊能力を含む正式照合、" +
          "命中、被害および段階終了は未実行です。"

      });
    },

   
        getAttackCommands(instanceId) {
      const unit = state.instances.find(
        item => item.instanceId === instanceId
      );

      if (!unit) {
        throw new Error("ユニットが見つかりません。");
      }

      assertManualControl(state, [unit]);

      const visibility = getVisibility(state);
      const observed = getObservedScene(state);
      const visibleGroups = new Set(
        observed.groups.map(group => group.id)
      );

      return copy({
        revision: state.revision,
        turnNumber: state.turn.number,
        phaseId: state.turn.phaseId,
        commands: state.attackRuntime.commands
          .filter(command => command.unitId === instanceId)
          .map(command => {
            const target = readAttackCommandTarget(command);

            let visible =
              target.targetRef.kind === "unit"
                ? visibility.get(target.targetRef.id) === "identified"
                : visibleGroups.has(target.targetRef.id);

            if (visible && target.targetRef.kind === "group") {
              try {
                const entity = resolveEntity(state, target.targetRef);

                visible = entity.members.every(member =>
                  visibility.get(member.instanceId) === "identified"
                );
              } catch {
                visible = false;
              }
            }

            visible &&= target.specifiedTargetIds.every(id =>
              visibility.get(id) === "identified"
            );

            return {
              id: command.id,
              groupId: command.groupId,
              turnNumber: command.turnNumber,
              phaseId: command.phaseId,
              status: command.status,
              targetId:
                visible && target.targetRef.kind === "unit"
                  ? target.targetRef.id
                  : null,
              targetRef: visible ? target.targetRef : null,
              specifiedTargetIds:
                visible ? target.specifiedTargetIds : [],
              requiresReselection: !visible
            };
          })
      });
    },


        settleAttackPhase(expectedRevision) {
      if (expectedRevision !== state.revision) {
        throw new Error(
          "状態が変更されています。もう一度確認してください。"
        );
      }

      if (!isAttackPhase(state.turn.phaseId)) {
        throw new Error(
          "正式攻撃は次序1～5またはPASで実行してください。"
        );
      }

      let receipt;

      commit(candidate => {
        receipt = settleAttackPhase(candidate);
      });

      // 不返回内部命中、目标耐性或外方计划。
      // 完整报告保留在存档根字段，不进入观察白名单。
      return {
        ...receipt,
        revision: state.revision,
        message:
          "この段階の全陣営の攻撃計画を結算しました。" +
          "次の段階へ移りました。時刻は進めていません。"
      };
    },

        finishSpecialPhase(expectedRevision) {
      if (expectedRevision !== state.revision) {
        throw new Error(
          "状態が変更されています。もう一度確認してください。"
        );
      }

      let receipt;

      commit(candidate => {
        receipt = finishSpecialPhase(candidate);
      });

      return {
        ...receipt,
        revision: state.revision
      };
    },

    finishTurn(expectedRevision) {
      if (expectedRevision !== state.revision) {
        throw new Error(
          "状態が変更されています。もう一度確認してください。"
        );
      }

      let receipt;

      commit(candidate => {
        receipt = finishTurn(candidate);
      });

      return {
        ...receipt,
        revision: state.revision
      };
    },

    getRangeAttackTargetOptions(instanceId) {
      const actor = state.instances.find(
        unit => unit.instanceId === instanceId
      );

      if (!actor) {
        throw new Error("行動艦を確認できません。");
      }

      assertManualControl(state, [actor]);

      const observed = getObservedScene(state);
      const visibility = getVisibility(state);
      const options = [];

      for (const group of observed.groups) {
        let entity;

        try {
          entity = resolveEntity(state, {
            kind: "group",
            id: group.id
          });
        } catch {
          continue;
        }

        if (!entity.members.every(member =>
          visibility.get(member.instanceId) === "identified"
        )) {
          continue;
        }

        // 不显示包含己方成员的攻击主编队。
        if (entity.members.some(member =>
          member.side === actor.side
        )) {
          continue;
        }

        options.push({
          targetRef: { kind: "group", id: group.id },
          label: group.name,
          members: entity.members.map(member => ({
            id: member.instanceId,
            label: member.name
          }))
        });
      }

      return copy({
        revision: state.revision,
        options
      });
    },

    mountRangeAttackPanel(container, instanceId) {
      if (!(container instanceof Element)) {
        throw new Error("攻撃画面の表示先が不正です。");
      }

      const panel = createRangeAttackPanel({
        store: api,
        unitId: instanceId
      });

      container.append(panel.element);
      return panel;
    },

           
           saveAttackCommands(request, expectedRevision) {
      if (expectedRevision !== state.revision) {
        throw new Error(
          "状態が変更されています。もう一度確認してください。"
        );
      }

      if (
        !request ||
        typeof request.unitId !== "string" ||
        !Array.isArray(request.assignments) ||
        request.assignments.length === 0
      ) {
        throw new Error("攻撃計画の指定が不正です。");
      }

      const input = copy(request);
      let savedOrders = [];

      commit(candidate => {
        if (!isAttackPhase(candidate.turn.phaseId)) {
          throw new Error(
            "攻撃計画は次序1～5またはPASで登録してください。"
          );
        }

        const groupReport =
          api.getAttackGroupReport(input.unitId);
        const observed = getObservedScene(candidate);
        const usedGroups = new Set();
        const checked = [];

        for (const assignment of input.assignments) {
          if (
            !assignment ||
            typeof assignment.groupId !== "string" ||
            usedGroups.has(assignment.groupId)
          ) {
            throw new Error(
              "装備組の指定が不正、または重複しています。"
            );
          }

          usedGroups.add(assignment.groupId);

          const group = groupReport.groups.find(
            item => item.groupId === assignment.groupId
          );

          if (!group || group.profile?.kind !== "weapon") {
            throw new Error("指定した武器組を確認できません。");
          }

          if (group.issues.length) {
            throw new Error(
              "攻撃計画を登録できません。\n" +
              group.issues.join("\n")
            );
          }

          const scope = readWeaponTargetScope(
            group.profile.targetScope
          );

          const target =
            readAttackCommandTarget(assignment);

          const clusterWeapon =
            group.profile.targetScope.trim() === "集群";

          if (scope.kind === "single") {
            if (
              target.targetRef.kind !== "unit" ||
              target.specifiedTargetIds.length !== 0
            ) {
              throw new Error(
                "単体武器には一つのユニットを指定してください。"
              );
            }
          } else if (
            clusterWeapon &&
            target.targetRef.kind === "unit"
          ) {
            if (target.specifiedTargetIds.length !== 0) {
              throw new Error(
                "単体を主目標にする場合、編隊メンバーは指定できません。"
              );
            }
          } else {
            if (target.targetRef.kind !== "group") {
              throw new Error(
                clusterWeapon
                  ? "集群武器には一つのユニットまたは一つの編隊を指定してください。"
                  : "範囲武器には一つの編隊を指定してください。"
              );
            }

            readRangeCommandTarget(assignment, scope);

            if (!observed.groups.some(
              item => item.id === target.targetRef.id
            )) {
              throw new Error("主目標を確認できません。");
            }
          }

          if (target.targetRef.kind === "unit") {
            const unit = candidate.instances.find(
              item =>
                item.instanceId === target.targetRef.id
            );

            if (!unit) {
              throw new Error("主目標を確認できません。");
            }

            assertIdentifiedTargets(candidate, [unit]);
          } else {
            const entity = resolveEntity(
              candidate,
              target.targetRef
            );

            assertIdentifiedTargets(
              candidate,
              entity.members
            );
          }

          checked.push({
            groupId: assignment.groupId,
            targetRef: target.targetRef,
            specifiedTargetIds: target.specifiedTargetIds,
            boundaries: []
          });
        }

        replaceAttackCommands(
          candidate,
          input.unitId,
          checked,
          newId
        );

        savedOrders = checked.map(item => ({
          groupId: item.groupId,
          phaseId: getAttackExecutionPhase(
            candidate,
            input.unitId,
            item.groupId
          )
        }));

        // 当前计划正式预检；
        // 未来计划只检查登记时状态，到执行次序再正式复核。
        try {
          const selectedIds = new Set(
            checked.map(item => item.groupId)
          );

          const savedSelection =
            candidate.attackRuntime.commands.filter(
              command =>
                command.unitId === input.unitId &&
                selectedIds.has(command.groupId)
            );

          validateDeferredAttackPlans(
            candidate,
            savedSelection
          );

          prepareSettlementAttackPlan(candidate);
      } catch (error) {
        const reason =
       typeof error?.message === "string" && error.message
       ? error.message
       : "詳細な原因を取得できませんでした。";

       const wrapped = new Error(
       "攻撃計画の事前検証に失敗しました。\n" +
       "原因：" + reason + "\n" +
        "今回の計画は保存していません。",
       { cause: error }
      );

      if (typeof error?.code === "string") {
      wrapped.code = error.code;
     }

     throw wrapped;
    }

      });

      // 只有事务保存成功，才返回给界面。
      return copy({
        revision: state.revision,
        commands: savedOrders
      });
    },

    cancelAttackCommands(
      { unitId, groupIds },
      expectedRevision
    ) {
      if (expectedRevision !== state.revision) {
        throw new Error(
          "状態が変更されています。もう一度確認してください。"
        );
      }

      if (
        typeof unitId !== "string" ||
        !Array.isArray(groupIds) ||
        !groupIds.length ||
        groupIds.some(id => typeof id !== "string") ||
        new Set(groupIds).size !== groupIds.length
      ) {
        throw new Error("攻撃計画の取消指定が不正です。");
      }

      const selected = new Set(groupIds);

      commit(candidate => {
        if (!isAttackPhase(candidate.turn.phaseId)) {
          throw new Error("攻撃計画を取り消せる段階ではありません。");
        }

        const unit = candidate.instances.find(
          item => item.instanceId === unitId
        );

        if (!unit) {
          throw new Error("ユニットが見つかりません。");
        }

        assertManualControl(candidate, [unit]);

        candidate.attackRuntime.commands =
          candidate.attackRuntime.commands.filter(
            command =>
              command.unitId !== unitId ||
              !selected.has(command.groupId)
          );
      });
    },

    saveDraft(request, expectedRevision) {
      if (expectedRevision !== state.revision) {
        throw new Error(
          "状態が変更されています。もう一度プレビューしてください。"
        );
      }

      const preview = previewDraft(request);

      commit(candidate => {
        if (candidate.actions.length >= 1000) {
          throw new Error("草案記録は 1000 件以内にしてください。");
        }

        candidate.actions.push({
          id: newId(),
          createdAt: new Date().toISOString(),
          status: "draft",
          ruleset: copy(candidate.ruleset),
          actionType: preview.actionType,
          note: preview.note,
          attacker: preview.attacker,
          target: preview.target,
          ruling: preview.ruling
        });
      });
    },

    createGroup({ name, kind, memberIds }) {
      const groupName = requireText(name, "編隊名");

      if (!["formation", "cluster"].includes(kind)) {
        throw new Error("編隊種別が不正です。");
      }

      if (
        !Array.isArray(memberIds) ||
        !memberIds.length ||
        new Set(memberIds).size !== memberIds.length
      ) {
        throw new Error("メンバーを選択してください。");
      }

      commit(candidate => {
        const members = memberIds.map(instanceId => {
          const unit = candidate.instances.find(
            item => item.instanceId === instanceId
          );

          if (!unit) {
            throw new Error("メンバーが見つかりません。");
          }

          return unit;
        });

        assertManualControl(candidate, members);

        const plannedIds = new Set(
          candidate.movementPlans.flatMap(plan => plan.memberIds)
        );

        if (members.some(unit => plannedIds.has(unit.instanceId))) {
          throw new Error(
            "移動計画があるメンバーの編隊変更はできません。" +
            "先に移動計画を取り消してください。"
          );
        }

        
        if (kind === "cluster") {
          // 仅沿用已有的集群结构/显示条件。
          // 未来若推演规则另有要求，在这里接入。
          const assessment = assessCluster(
            members,
            candidate.terrain
          );

          if (!assessment.valid) {
            throw new Error(assessment.reason);
          }
        }

        const group = {
          id: newId(),
          name: groupName,
          kind,
          parentId: null
        };

        candidate.groups.push(group);

        // 明确的重组操作：移动归属，不新增或删除个体。
        for (const unit of members) {
          unit.groupId = group.id;
        }
      });
    },

    renameGroup(groupId, name) {
      const nextName = requireText(name, "編隊名");

      commit(candidate => {
        const group = candidate.groups.find(
          item => item.id === groupId
        );

        if (!group) {
          throw new Error("編隊が見つかりません。");
        }

          const entity = resolveEntity(candidate, {
          kind: "group",
          id: groupId
        });

        assertManualControl(candidate, entity.members);

        const plannedIds = new Set(
          candidate.movementPlans.flatMap(plan => plan.memberIds)
        );

        if (entity.members.some(unit => plannedIds.has(unit.instanceId))) {
          throw new Error(
            "移動計画がある編隊は変更できません。" +
            "先に移動計画を取り消してください。"
          );
        }

        group.name = nextName;
      });
    },

    dissolveGroup(groupId) {
      commit(candidate => {
        const group = candidate.groups.find(
          item => item.id === groupId
        );

        if (!group) {
          throw new Error("編隊が見つかりません。");
        }

        const entity = resolveEntity(candidate, {
          kind: "group",
          id: groupId
        });

        assertManualControl(candidate, entity.members);

        const plannedIds = new Set(
          candidate.movementPlans.flatMap(plan => plan.memberIds)
        );

        if (entity.members.some(unit => plannedIds.has(unit.instanceId))) {
          throw new Error(
            "移動計画がある編隊は変更できません。" +
            "先に移動計画を取り消してください。"
          );
        }

        
        for (const child of candidate.groups) {
          if (child.parentId === groupId) {
            child.parentId = group.parentId ?? null;
          }
        }

        for (const unit of candidate.instances) {
          if (unit.groupId === groupId) {
            unit.groupId = group.parentId ?? null;
          }
        }

        candidate.groups = candidate.groups.filter(
          item => item.id !== groupId
        );
      });
    },

    executeAction() {
      // 未配置规则时，状态层也拒绝执行，不只禁用按钮。
      throw new Error(evaluateAction().reason);
    },

    exportJSON() {
      return JSON.stringify({
        ...getObservedScene(state),
        exportType: "observation",
        restorable: false
      }, null, 2);
    },


    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };

  return api;
}

