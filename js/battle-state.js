import {normalizeAviationComplement} from './equipment-options.js';
import {aircraftFacilityCompatible} from './aircraft-template.js?v=air-training-1';
import {supportCapacity} from '../tactical-map/support-equipment.js?v=field-support-1';
import {normalizeAircraftPosition} from '../tactical-map/aircraft-runtime.js?v=car-return-1';
import { normalizeBuildingUnit } from "../tactical-map/building-runtime.js?v=facility-rules-1";
import { normalizeNavalPosition } from "../tactical-map/naval-kind.js?v=catalog-layout-2";
import { normalizeFormationEmblem } from "../tactical-map/flagship-display.js?v=fleet-cohesion-6";
import {normalizeFormation, formationOffset, formationMembers, formationCenter, validateFormationMembers} from "../tactical-map/formation-layout.js?v=fleet-cohesion-6";
import { readSave, writeSave, subscribeSaveChanges } from "./save-database.js";
import { MAX_SCENE_FILE_BYTES } from "./save-limits.js";
import { freezeSnapshot } from "../tactical-map/read-only-snapshot.js";
// ===== 共享参战状态 =====
// 界面和错误文案使用日文，代码注释使用中文。
import {
  createDemoTerrain,
  validateTerrain,
  freezeTerrainSnapshot,
  sampleTerrain
} from "../tactical-map/terrain-data.js";

import {
  VIEW_SCALE_MIN,
  VIEW_SCALE_MAX
} from "../tactical-map/map-settings.js";

import {
  createDefaultEnvironment,
  normalizeEnvironment
} from "../tactical-map/environment-data.js?v=day-catalog-pas-1";

import { normalizeFaction } from "./faction-data.js";


import { assessCluster } from "../tactical-map/cluster-engine.js?v=aviation-operations-1";

import { normalizeCampaignIntro } from "../tactical-map/campaign-intro-data.js";

const STORAGE_KEY = "junqi-battle-scene-v2";
const LEGACY_KEY = "junqi-battle-state-v1";
const VERSION = 2;

const BRANCHES = new Set(["navy", "air", "army", "special", "building"]);
const SIDES = new Set(["ally", "enemy", "neutral"]);

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function newId() {
  if (globalThis.crypto?.randomUUID) {
    return crypto.randomUUID();
  }

  throw new Error(
    "識別番号を生成できません。HTTPS または localhost で開いてください。"
  );
}

function isObject(value) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label}は空欄にできません。`);
  }

  return value.trim();
}

function requireNumber(value, label, min = -Infinity, max = Infinity) {
  // 空文字列や null を 0 として扱わない。
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(`${label}の値が不正です。`);
  }

  return value;
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`${label}の値が不正です。`);
  }

  return value;
}

function emptyScene() {
  return {
    version: VERSION,
    name: "新しい作戦",
    terrainId: "demo-islands-v1",
    terrain: createDemoTerrain(),
    environment: createDefaultEnvironment(),
    campaignIntro: normalizeCampaignIntro(),
    instances: [],
    groups: [],
    actions: [],
    view: {
      x: 0,
      y: 0,
      scale: 1
    }
  };
}

export async function createBattleStore(units) {
  if (!Array.isArray(units)) {
    throw new Error("ユニット図鑑が初期化されていません。");
  }

  // 保持与图鉴共享同一个数组。
  // 图鉴编辑会原位更新该数组，因此每次读取最新模板。
  const catalog = {
    get(unitId) {
      return units.find(unit => unit.id === unitId);
    }
  };

  const listeners = new Set();

  let scene = emptyScene();
  let snapshotSource = null;
  let snapshot = null;
  const trustedTerrains = new WeakSet();
  function normalizeTerrain(value) {
    if (trustedTerrains.has(value)) return value;
    const terrain = freezeTerrainSnapshot(value);
    trustedTerrains.add(terrain);
    return terrain;
  }
  function getSceneSnapshot() {
    if (snapshotSource !== scene) {
      scene.terrain = normalizeTerrain(scene.terrain);
      // 不可变地形可共享；其他资料仅在每次状态提交后复制一次。
      snapshot = freezeSnapshot({...copy({...scene, terrain: null}), terrain: scene.terrain});
      snapshotSource = scene;
    }
    return snapshot;
  }

  let savedRaw = null;
  let saving = false;
  const savingListeners = new Set();
  function setSaving(value) {
    saving = value;
    for (const listener of savingListeners) {
      try { listener(value); } catch (error) { console.error(error); }
    }
  }
  function subscribeSaving(listener) {
    savingListeners.add(listener); listener(saving);
    return () => savingListeners.delete(listener);
  }
  let storageWarning = "";
  let recoveryBlocked = false;

  function validateSnapshot(value, unitId) {
    if (!isObject(value)) {
      throw new Error("ユニットの図鑑スナップショットがありません。");
    }

    if (value.id !== unitId) {
      throw new Error("図鑑番号とスナップショットが一致しません。");
    }

    requireText(value.name, "図鑑名");

    if (!BRANCHES.has(value.branch)) {
      throw new Error("軍種の値が不正です。");
    }

    requireNumber(value.maxHp, "基礎最大耐性", Number.MIN_VALUE);

    // 現在の図鑑にはない将来の能力値も、スナップショット内に保管する。
    return copy(value);
  }

  function normalizeInstance(item) {
    if (!isObject(item)) {
      throw new Error("参戦ユニットの書式が不正です。");
    }

    const instanceId = requireText(item.instanceId, "参戦識別番号");
    const unitId = requireText(item.unitId, "図鑑番号");

    // 一度作成した個体は保存された資料を優先する。
    const snapshot = validateSnapshot(
      item.snapshot ?? catalog.get(unitId),
      unitId
    );

    const spatial = normalizeAircraftPosition(normalizeBuildingUnit(normalizeNavalPosition({...item,branch:snapshot.branch,snapshot})));
    const name = requireText(item.name ?? snapshot.name, "ユニット名");
    const side = item.side ?? "ally";

    if (!SIDES.has(side)) {
      throw new Error("陣営の値が不正です。");
    }

    const sizeLevel = requireNumber(
      item.sizeLevel ?? snapshot.sizeLevel ?? 1,
      "サイズレベル",
      1,
      5
    );


    if (!Number.isInteger(sizeLevel)) {
      throw new Error("サイズレベルは整数で指定してください。");
    }

    const x = item.x ?? null;
    const y = item.y ?? null;

    // 座標は両方とも未配置、または両方とも有効な数値とする。
    if ((x === null) !== (y === null)) {
      throw new Error("地図座標は X と Y を両方指定してください。");
    }

    if (x !== null) {
      requireNumber(x, "X 座標");
      requireNumber(y, "Y 座標");
    }

    const rawHeading = requireNumber(item.heading ?? 0, "方位");
    const heading = ((rawHeading % 360) + 360) % 360;

    const underwater = requireBoolean(
      spatial.underwater ?? false,
      "水中設定"
    );

    if (underwater && snapshot.branch !== "navy") {
      throw new Error("水中設定は海軍ユニットにのみ指定できます。");
    }

    const altitude = spatial.altitude ?? null;

    if (altitude !== null) {
      requireNumber(altitude, "海抜高度");
    }

    const groupId = item.groupId ?? null;

    if (groupId !== null) {
      requireText(groupId, "所属編隊番号");
    }

        // 旧场景缺少字段时按未设置处理；显式的错误类型不接受。
    const isOverallFlagship = requireBoolean(
      item.isOverallFlagship === undefined
        ? false
        : item.isOverallFlagship,
      "総旗艦設定"
    );

    const isFormationFlagship = requireBoolean(
      item.isFormationFlagship === undefined
        ? false
        : item.isFormationFlagship,
      "分旗艦設定"
    );

    if (
      (isOverallFlagship || isFormationFlagship) &&
      snapshot.branch !== "navy"
    ) {
      throw new Error("旗艦に指定できるのは海軍ユニットのみです。");
    }

    if (isFormationFlagship && groupId === null) {
      throw new Error("分旗艦には所属編隊が必要です。");
    }

    const description = item.description ?? snapshot.description ?? "";

    if (typeof description !== "string") {
      throw new Error("説明は文字列で指定してください。");
    }

    return {
      instanceId,
      unitId,
      snapshot,
      name,
      branch: snapshot.branch,
      side,

      faction: normalizeFaction(
        item.faction ?? snapshot.faction ?? ""
      ),

      currentHp: requireNumber(

        item.currentHp,
        "現在耐性",
        0,
        snapshot.maxHp
      ),
      sizeLevel,
      heading,
      filled: requireBoolean(item.filled ?? false, "塗りつぶし設定"),
      underwater,
      x,
      y,
      altitude,
      depth: requireNumber(
        spatial.depth ?? 0,
        "水中深度",
        0
      ),
      labelHeight: requireNumber(
        item.labelHeight ?? 65,
        "名称表示の高さ",
        0,
        500
      ),
      description,
      groupId,
      isOverallFlagship,
      formationEmblem: normalizeFormationEmblem(item.formationEmblem),
      isFormationFlagship
    };
  }

    function normalizeGroup(item) {
    if (!isObject(item)) {
      throw new Error("編隊の書式が不正です。");
    }

    const parentId = item.parentId ?? null;

    if (parentId !== null) {
      requireText(parentId, "上位編隊番号");
    }

    const kind = item.kind ?? "formation";

    if (!["formation", "cluster"].includes(kind)) {
      throw new Error("編隊種別が不正です。");
    }

    return {
      id: requireText(item.id, "編隊番号"),
      name: requireText(item.name, "編隊名"),
      parentId,
      kind,
      ...(item.formation === undefined ? {} : {formation:normalizeFormation(item.formation)})
    };
  }

    // 行动记录保存历史摘要，不要求对应个体现在仍然存在。
  function normalizeActionActor(value) {
    if (!isObject(value)) {
      throw new Error("行動記録のユニット資料が不正です。");
    }

    const x = value.x ?? null;
    const y = value.y ?? null;

    if ((x === null) !== (y === null)) {
      throw new Error("行動記録の座標が不正です。");
    }

    if (x !== null) {
      requireNumber(x, "記録 X");
      requireNumber(y, "記録 Y");
    }

    const altitude = value.altitude ?? null;

    if (altitude !== null) {
      requireNumber(altitude, "記録高度");
    }

    if (!BRANCHES.has(value.branch) || !SIDES.has(value.side)) {
      throw new Error("行動記録の軍種または陣営が不正です。");
    }

    return {
      instanceId: requireText(value.instanceId, "記録識別番号"),
      unitId: requireText(value.unitId, "記録図鑑番号"),
      name: requireText(value.name, "記録ユニット名"),
      branch: value.branch,
      side: value.side,
      currentHp: requireNumber(value.currentHp, "記録耐性", 0),
      x,
      y,
      altitude,
      heading: requireNumber(value.heading, "記録方位"),
      underwater: requireBoolean(value.underwater, "記録水中設定"),
      depth: requireNumber(value.depth, "記録水中深度", 0)
    };
  }

  function normalizeAction(item) {
    if (!isObject(item)) {
      throw new Error("行動記録の書式が不正です。");
    }

    if (!["攻撃", "防空", "その他の行動"].includes(item.actionType)) {
      throw new Error("行動種別が不正です。");
    }

    if (item.status !== "unresolved") {
      throw new Error("対応していない行動記録状態です。");
    }

    const createdAt = requireText(item.createdAt, "記録日時");

    if (!Number.isFinite(Date.parse(createdAt))) {
      throw new Error("記録日時が不正です。");
    }

    if (typeof item.note !== "string" || item.note.length > 2000) {
      throw new Error("行動メモは 2000 文字以内で指定してください。");
    }

    const attacker = normalizeActionActor(item.attacker);
    const target = normalizeActionActor(item.target);

    if (attacker.instanceId === target.instanceId) {
      throw new Error("行動ユニットと目標は別の個体を指定してください。");
    }

    return {
      id: requireText(item.id, "行動記録番号"),
      createdAt,
      status: "unresolved",
      actionType: item.actionType,
      note: item.note,
      attacker,
      target
    };
  }

  function normalizeScene(input) {
    if (!isObject(input) || input.version !== VERSION) {
      throw new Error("対応していない作戦データ形式です。");
    }

    if (
      !Array.isArray(input.instances) ||
      !Array.isArray(input.groups)
    ) {
      throw new Error("ユニット一覧または編隊一覧の書式が不正です。");
    }

    if (input.terrainId !== "demo-islands-v1") {
      throw new Error("この地形データには対応していません。");
    }

    const instances = input.instances.map(normalizeInstance);
    const groups = input.groups.map(normalizeGroup);
        // 第一阶段保存文件没有 actions 字段，按空记录迁移。
    const rawActions = input.actions ?? [];

    if (!Array.isArray(rawActions) || rawActions.length > 5000) {
      throw new Error("行動記録は 5000 件以内の一覧で指定してください。");
    }

    const actions = rawActions.map(normalizeAction);
    const actionIds = new Set();

    for (const action of actions) {
      if (actionIds.has(action.id)) {
        throw new Error("行動記録番号が重複しています。");
      }

      actionIds.add(action.id);
    }

    const instanceIds = new Set();
    const groupMap = new Map();

    for (const instance of instances) {
      if (instanceIds.has(instance.instanceId)) {
        throw new Error("参戦識別番号が重複しています。");
      }

      instanceIds.add(instance.instanceId);
    }

    for (const group of groups) {
      if (groupMap.has(group.id)) {
        throw new Error("編隊番号が重複しています。");
      }

      groupMap.set(group.id, group);
    }

    for (const group of groups) {
      if (group.parentId !== null && !groupMap.has(group.parentId)) {
        throw new Error("上位編隊が見つかりません。");
      }

      // 再帰を使わず、親をたどって循環参照を検出する。
      const visited = new Set();
      let cursor = group.id;

      while (cursor !== null) {
        if (visited.has(cursor)) {
          throw new Error("編隊の所属関係を循環させることはできません。");
        }

        visited.add(cursor);
        cursor = groupMap.get(cursor).parentId;
      }
    }

    for (const instance of instances) {
      if (
        instance.groupId !== null &&
        !groupMap.has(instance.groupId)
      ) {
        throw new Error("ユニットの所属編隊が見つかりません。");
      }
    }
        // 按直接所属 groupId 限制；上层编队不吞并子编队的旗舰名额。
    const formationFlagships = new Map();

    for (const instance of instances) {
      if (!instance.isFormationFlagship) continue;

      if (formationFlagships.has(instance.groupId)) {
        throw new Error(
          "同じ編隊に複数の分旗艦は指定できません。"
        );
      }

      formationFlagships.set(
        instance.groupId,
        instance.instanceId
      );
    }


    const view = input.view ?? { x: 0, y: 0, scale: 1 };

    if (!isObject(view)) {
      throw new Error("地図表示設定の書式が不正です。");
    }

    return {
      version: VERSION,
      name: requireText(input.name, "作戦名"),
      terrainId: input.terrainId,
      terrain: normalizeTerrain(input.terrain ?? createDemoTerrain()),
      environment: normalizeEnvironment(input.environment),
      campaignIntro: normalizeCampaignIntro(input.campaignIntro),
      instances,
      groups,
      actions,
      view: {
        x: requireNumber(view.x, "表示 X"),
        y: requireNumber(view.y, "表示 Y"),
        scale: requireNumber( view.scale, "表示倍率",VIEW_SCALE_MIN, VIEW_SCALE_MAX)

      }
    };
  }

  function migrateLegacy(input) {
    if (!Array.isArray(input)) {
      throw new Error("旧保存データの書式が不正です。");
    }

    const migrated = emptyScene();
    migrated.instances = input;

    // 不正な個体を黙って削除せず、場面全体の検証を行う。
    return normalizeScene(migrated);
  }

  function getAll() {
    return copy(scene.instances);
  }

  function getScene() {
    return copy(scene);
  }

  function emit() {
    for (const listener of listeners) {
      try {
        Promise.resolve(listener(getAll())).catch(console.error);
      } catch (error) {
        // ある画面の描画失敗で、他の購読者まで停止させない。
        console.error(error);
      }
    }
  }

  async function commit(candidate, allowRecovery = false) {
    if (saving) throw new Error("保存中です。完了してから次の操作を行ってください。");
    if (recoveryBlocked && !allowRecovery) {
      throw new Error("保存データを復元できませんでした。元データ保護のため編集を停止しています。バックアップと復元が必要です。");
    }
    setSaving(true);
    try {
      const next = normalizeScene(candidate);
      const raw = JSON.stringify(next);
      await writeSave(STORAGE_KEY, raw, {expectedRaw: savedRaw, name: next.name});
      // Only committed writes replace the visible scene.
      savedRaw = raw;
      scene = next;
      recoveryBlocked = false;
      storageWarning = "";
      emit();
    } catch (error) {
      storageWarning = "保存できませんでした。今回の変更は確定していません。" + error.message;
      throw error;
    } finally {
      setSaving(false);
    }
  }

  async function change(callback) {
    const candidate = {...copy({...scene, terrain: null}), terrain: scene.terrain};
    callback(candidate);
    await commit(candidate);
  }

  // ===== 起動時の復元 =====
  try {
    const savedText = await readSave(STORAGE_KEY);
    savedRaw = savedText;

    if (savedText !== null) {
      scene = normalizeScene(JSON.parse(savedText));
    } else {
      const legacyText = await readSave(LEGACY_KEY);

      if (legacyText !== null) {
        scene = migrateLegacy(JSON.parse(legacyText));
        storageWarning =
          "旧保存データを復元しました。座標のないユニットは未配置です。次回の変更時に新形式で保存します。";
      }
    }
  } catch (error) {
    recoveryBlocked = true;
    storageWarning =
      "保存データの復元に失敗しました。元データは上書きしていません。編集前にバックアップと復元が必要です。";
    console.warn(error);
  }

    async function addUnit(unitId, options = {}) {
    const base = catalog.get(unitId);

    if (!base) {
      throw new Error("該当ユニットの図鑑資料が見つかりません。");
    }

    if (!isObject(options)) {
      throw new Error("参戦追加設定の書式が不正です。");
    }

    const instance = normalizeInstance({
      instanceId: newId(),
      unitId,
      snapshot: copy(base),

      name: options.name ?? base.name,
      side: options.side ?? "ally",

      faction: normalizeFaction(
        options.faction ?? base.faction ?? ""
      ),

      currentHp: base.maxHp,
      sizeLevel: base.sizeLevel ?? 1,

      altitude: base.branch === "air" ? Math.min(80,base.aircraft?.ceiling??80) : null
    });

    await change(candidate => {
      candidate.instances.push(instance);
    });

    return copy(instance);
  }

    async function updateUnit(instanceId, patch) {
    // 单体和批量更新共用同一套旗舰及编队约束。
    await updateUnits([{ instanceId, patch }]);
  }

  // 批量更新先验证，再一次性提交。
  // 避免集群移动或旗舰替换产生中间状态。
  async function updateUnits(updates) {
    if (!Array.isArray(updates) || !updates.length) {
      throw new Error("更新ユニット一覧が不正です。");
    }

    const editable = new Set([
      "aviationComplement",
      "refreshAviationEquipment",
      "name",
      "side",
      "faction",
      "currentHp",
      "sizeLevel",
      "heading",
      "filled",
      "underwater",
      "x",
      "y",
      "altitude",
      "depth",
      "labelHeight",
      "description",
      "groupId",
      "isOverallFlagship",
      "formationEmblem",
      "isFormationFlagship"
    ]);

    const ids = new Set();

    for (const update of updates) {
      if (
        !isObject(update) ||
        !isObject(update.patch) ||
        typeof update.instanceId !== "string"
      ) {
        throw new Error("ユニット更新データが不正です。");
      }

      if (ids.has(update.instanceId)) {
        throw new Error("更新ユニット番号が重複しています。");
      }

      ids.add(update.instanceId);

      for (const key of Object.keys(update.patch)) {
        if (!editable.has(key)) {
          throw new Error(`変更できないユニット項目です：${key}`);
        }
      }

      for (const key of [
        "isOverallFlagship",
        "isFormationFlagship"
      ]) {
        if (Object.prototype.hasOwnProperty.call(update.patch, key)) {
          requireBoolean(
            update.patch[key],
            key === "isOverallFlagship"
              ? "総旗艦設定"
              : "分旗艦設定"
          );
        }
      }
    }

    await change(candidate => {
      const requestedFlagshipIds = [];

      // 先应用所有普通更新及编队变更。
      for (const update of updates) {
        const index = candidate.instances.findIndex(
          unit => unit.instanceId === update.instanceId
        );

        if (index < 0) {
          throw new Error("更新対象のユニットが見つかりません。");
        }

        const previous = candidate.instances[index];
        const next = {
          ...previous,
          ...update.patch
        };

        if(update.patch.refreshAviationEquipment!==undefined){
          requireBoolean(update.patch.refreshAviationEquipment,'航空支援設備の更新');delete next.refreshAviationEquipment;
          if(update.patch.refreshAviationEquipment){
            if(!['navy','building'].includes(previous.branch))throw Error('航空支援設備は母艦・施設で更新してください。');const template=catalog.get(previous.unitId);if(!template)throw Error('元の図鑑資料がありません。');
            const effects=new Set(['parking-stand','preparation-area','runway','catapult','ground-crew','remote-station','night-observation']),oldEq=new Map((previous.snapshot.equipmentSnapshots??[]).map(e=>[e.id,e])),newEq=new Map((template.equipmentSnapshots??[]).map(e=>[e.id,e]));
            const aviationMount=(m,map)=>map.get(m.equipmentId)?.kind==='support'&&(effects.has(map.get(m.equipmentId).supportEffect)||m.equipmentId==='eq-seaplane-catapult');
            const mounts=[...previous.snapshot.mounts.filter(m=>!aviationMount(m,oldEq)),...template.mounts.filter(m=>aviationMount(m,newEq))];const equipment=new Map(oldEq);for(const m of template.mounts.filter(m=>aviationMount(m,newEq)))equipment.set(m.equipmentId,newEq.get(m.equipmentId));
            next.snapshot={...copy(previous.snapshot),mounts:copy(mounts),equipmentSnapshots:copy([...equipment.values()])};
          }
        }
        if(Object.prototype.hasOwnProperty.call(update.patch,'aviationComplement')){
          if(!['navy','building'].includes(previous.branch))throw Error('搭載航空機は母艦・飛行場で設定してください。');
          const complement=normalizeAviationComplement(update.patch.aviationComplement),unchanged=JSON.stringify(complement)===JSON.stringify(previous.snapshot.aviationComplement??[]),templates=new Map();let slots=0;
          for(const entry of complement){const template=(unchanged?previous.snapshot.aircraftSnapshots?.find(a=>a.id===entry.unitId):null)??catalog.get(entry.unitId);if(!template?.aircraft||!aircraftFacilityCompatible(template.aircraft.type,previous))throw Error('この母艦・施設で運用できる航空機テンプレートを指定してください。');templates.set(template.id,copy(template));slots+=entry.count*template.aircraft.engines;}
          const capacity=supportCapacity(next,'parking-stand');if(slots>capacity)throw Error(`必要駐機枠${slots}が登録駐機枠${capacity}を超えています。`);
          if(!unchanged)next.snapshot={...copy(next.snapshot),aviationComplement:complement,aircraftSnapshots:[...templates.values()]};delete next.aviationComplement;
        }

        // 编队变更默认取消分旗舰身份。
        // 若本次明确勾选，则视为在新编队重新指定。
        if (next.groupId !== previous.groupId) {
          next.isFormationFlagship =
            update.patch.isFormationFlagship === true;
        }

        candidate.instances[index] = next;

        if (update.patch.isFormationFlagship === true) {
          requestedFlagshipIds.push(next.instanceId);
        }
      }

      // 先验证所有明确的设置请求，避免同一批操作互相覆盖。
      const requestedGroups = new Set();

      for (const instanceId of requestedFlagshipIds) {
        const unit = candidate.instances.find(
          item => item.instanceId === instanceId
        );

        if (unit.branch !== "navy") {
          throw new Error("分旗艦に指定できるのは海軍ユニットのみです。");
        }

        if (
          unit.groupId == null ||
          !candidate.groups.some(group => group.id === unit.groupId)
        ) {
          throw new Error("分旗艦には有効な所属編隊が必要です。");
        }

        if (requestedGroups.has(unit.groupId)) {
          throw new Error(
            "同じ更新で、同一編隊の複数ユニットを分旗艦には指定できません。"
          );
        }

        requestedGroups.add(unit.groupId);
      }

      // 指定新分旗舰时，在同一候选副本中取消原分旗舰。
      for (const instanceId of requestedFlagshipIds) {
        const unit = candidate.instances.find(
          item => item.instanceId === instanceId
        );

        for (const member of candidate.instances) {
          if (
            member.instanceId !== unit.instanceId &&
            member.groupId === unit.groupId
          ) {
            member.isFormationFlagship = false;
          }
        }
      }
    });
  }


  // 将已有单体合并为集群。
  async function createCluster(instanceIds, name) {
    if (
      !Array.isArray(instanceIds) ||
      new Set(instanceIds).size !== instanceIds.length
    ) {
      throw new Error("集群メンバー一覧が不正です。");
    }

    const group = {
      id: newId(),
      name: requireText(name, "集群名"),
      parentId: null,
      kind: "cluster"
    };

    await change(candidate => {
      const members = instanceIds.map(id => {
        const member = candidate.instances.find(
          unit => unit.instanceId === id
        );

        if (!member) {
          throw new Error("集群メンバーが見つかりません。");
        }

        return member;
      });

      // 不静默改变已有编队归属。
      if (members.some(member => member.groupId !== null)) {
        throw new Error(
          "合併するユニットは、先に既存の編隊から外してください。"
        );
      }

      const assessment = assessCluster(
        members,
        candidate.terrain
      );

      if (!assessment.valid) {
        throw new Error(assessment.reason);
      }

      candidate.groups.push(group);

      for (const member of members) {
        member.groupId = group.id;
      }
    });

    return copy(group);
  }

  // 直接新增一个未部署集群。
  async function addCluster(unitId, count, sizeLevel, name) {
    const base = catalog.get(unitId);

    if (!base) {
      throw new Error("該当ユニットの図鑑資料が見つかりません。");
    }

    if (!Number.isInteger(count) || count < 2 || count > 100) {
      throw new Error("集群数は 2～100 の整数で指定してください。");
    }

    const group = {
      id: newId(),
      name: requireText(name, "集群名"),
      parentId: null,
      kind: "cluster"
    };

    const members = Array.from({ length: count }, (_, index) =>
      normalizeInstance({
        instanceId: newId(),
        unitId,
        snapshot: copy(base),
        name: `${base.name} ${index + 1}`,
        currentHp: base.maxHp,
        sizeLevel,
        groupId: group.id,
        altitude: base.branch === "air" ? Math.min(80,base.aircraft?.ceiling??80) : null
      })
    );

    await change(candidate => {
      candidate.groups.push(group);
      candidate.instances.push(...members);
    });

    return {
      group: copy(group),
      members: copy(members)
    };
  }

    async function setEnvironment(value) {
    const environment = normalizeEnvironment(value);

    await change(candidate => {
      candidate.environment = environment;
    });
  }
  
  async function setCampaignIntro(value) {
  const intro = normalizeCampaignIntro(value);

  await change(candidate => {
    candidate.campaignIntro = intro;
  });
}

  
  async function updateHp(instanceId, currentHp) {
    await updateUnit(instanceId, { currentHp });
  }

  async function removeUnit(instanceId) {
    await change(candidate => {
      candidate.instances = candidate.instances.filter(
        item => item.instanceId !== instanceId
      );
    });
  }

  async function addGroup(name, parentId = null) {
    const group = {
      id: newId(),
      name,
      parentId
    };

    await change(candidate => {
      candidate.groups.push(group);
    });

    return copy(group);
  }

  async function saveFormation(id, value) {
    const formation = normalizeFormation(value);
    await change(candidate => {
      const group = candidate.groups.find(item => item.id === id);
      if (!group) throw new Error('編隊が見つかりません。');
      const members = formationMembers(candidate, id);
      validateFormationMembers(members, formation);
      const center = formationCenter(members,group.formation);
      for (const point of formation.positions) {
        const unit = members.find(item => item.instanceId === point.id);
        const offset = formationOffset(point, formation);
        const x=center.x+offset.x,y=center.y+offset.y;
        const sample=sampleTerrain(candidate.terrain,x,y);
        if(!sample.inside || (sample.kind==='land' && !unit.underwater)) throw new Error('陣形の艦船を地図内の海域へ配置してください。');
        unit.x=x;unit.y=y;
      }
      if (formation.emblem) {
        const flagship = members.find(unit=>unit.isFormationFlagship);
        if (flagship) flagship.formationEmblem = formation.emblem;
      }
      group.formation = formation;
    });
  }

  async function updateGroup(id, patch) {
    if (!isObject(patch)) {
      throw new Error("編隊更新データの書式が不正です。");
    }

    for (const key of Object.keys(patch)) {
      if (key !== "name" && key !== "parentId") {
        throw new Error(`変更できない編隊項目です：${key}`);
      }
    }

    await change(candidate => {
      const index = candidate.groups.findIndex(item => item.id === id);

      if (index < 0) {
        throw new Error("該当する編隊が見つかりません。");
      }

      candidate.groups[index] = {
        ...candidate.groups[index],
        ...patch
      };
    });
  }

  async function removeGroup(id) {
    await change(candidate => {
      const group = candidate.groups.find(item => item.id === id);

      if (!group) {
        throw new Error("該当する編隊が見つかりません。");
      }

      // 删除编队后，直接下属提升到原上级；不删除任何单位。
      for (const child of candidate.groups) {
        if (child.parentId === id) {
          child.parentId = group.parentId;
        }
      }

      for (const instance of candidate.instances) {
        if (instance.groupId === id) {
          instance.groupId = group.parentId;

          // 原编队已解除；不将分旗舰身份带入上级编队。
          instance.isFormationFlagship = false;
        }
      }


      candidate.groups = candidate.groups.filter(item => item.id !== id);
    });
  }

  async function updateView(patch) {
    if (!isObject(patch)) {
      throw new Error("地図表示更新データの書式が不正です。");
    }

    for (const key of Object.keys(patch)) {
      if (!["x", "y", "scale"].includes(key)) {
        throw new Error(`変更できない表示項目です：${key}`);
      }
    }

    await change(candidate => {
      candidate.view = {
        ...candidate.view,
        ...patch
      };
    });
  }

  async function renameScene(name) {
    await change(candidate => {
      candidate.name = name;
    });
  }

  async function newScene(name = "新しい作戦") {
    if (recoveryBlocked) {
      throw new Error(
        "保存データを復元してから新しい作戦を作成してください。"
      );
    }

    const candidate = emptyScene();

    candidate.name = requireText(name, "作戦名");

    // 新地图使用默认尺寸和网格，但不保留演示岛屿。
    candidate.terrain.heights.fill(-20);
    candidate.terrain.rivers.fill(0);
    candidate.terrain.shallows.fill(0);

    await commit(candidate);
  }

  
  async function clear() {
    // 明确的清空操作允许解除恢复保护。
    await commit(emptyScene(), true);
  }

  function exportScene() {
    if (recoveryBlocked) {
      throw new Error(
        "復元に失敗した元データは、この書き出しでは取得できません。先にブラウザーの保存領域からバックアップしてください。"
      );
    }

    return JSON.stringify(scene, null, 2);
  }

  async function importScene(text) {
    if (typeof text !== "string") {
      throw new Error("作戦データは JSON テキストで指定してください。");
    }

    if (text.length > MAX_SCENE_FILE_BYTES || new Blob([text]).size > MAX_SCENE_FILE_BYTES) {
      throw new Error("作戦JSONは128 MiB以内で指定してください。");
    }

    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("JSON の書式が不正です。");
    }

    const candidate = Array.isArray(parsed)
      ? migrateLegacy(parsed)
      : normalizeScene(parsed);

    await commit(candidate, true);
  }

    function actionActor(instance) {
    return {
      instanceId: instance.instanceId,
      unitId: instance.unitId,
      name: instance.name,
      branch: instance.branch,
      side: instance.side,
      currentHp: instance.currentHp,
      x: instance.x,
      y: instance.y,
      altitude: instance.altitude,
      heading: instance.heading,
      underwater: instance.underwater,
      depth: instance.depth
    };
  }

  async function addAction({ attackerId, targetId, actionType, note = "" }) {
    const attacker = scene.instances.find(
      item => item.instanceId === attackerId
    );

    const target = scene.instances.find(
      item => item.instanceId === targetId
    );

    if (!attacker || !target) {
      throw new Error("行動ユニットまたは目標が見つかりません。");
    }

    const record = normalizeAction({
      id: newId(),
      createdAt: new Date().toISOString(),
      status: "unresolved",
      actionType,
      note,
      attacker: actionActor(attacker),
      target: actionActor(target)
    });

    await change(candidate => {
      if (candidate.actions.length >= 5000) {
        throw new Error(
          "行動記録が 5000 件に達しました。書き出した後、不要な記録を削除してください。"
        );
      }

      candidate.actions.push(record);
    });

    return copy(record);
  }

  async function removeAction(id) {
    await change(candidate => {
      candidate.actions = candidate.actions.filter(
        item => item.id !== id
      );
    });
  }
    async function setTerrain(terrain) {
    const validated = freezeTerrainSnapshot(terrain);

    await change(candidate => {
      candidate.terrain = validated;
    });
  }

  function subscribe(listener) {
    if (typeof listener !== "function") {
      throw new Error("更新通知の登録先が不正です。");
    }

    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  let destroyed = false;
  const unsubscribeStorage = subscribeSaveChanges(async key => {
    if (key !== STORAGE_KEY || destroyed || saving) return;
    try {
      const text = await readSave(STORAGE_KEY);
      if (destroyed || saving || text === savedRaw) return;
      if (text === null) throw new Error("別の画面で保存データが削除されました。");
      const next = normalizeScene(JSON.parse(text));
      scene = next; savedRaw = text; recoveryBlocked = false; storageWarning = "";
      emit();
    } catch (error) {
      storageWarning = "別の画面の保存データを読み込めませんでした。現在の表示を保持しています。";
      console.warn(error); emit();
    }
  });
  function destroy() {
    destroyed = true;
    unsubscribeStorage();
    listeners.clear();
    savingListeners.clear();
  }

  return {
    // 原页面已有接口。
    getAll,
    addUnit,
    updateHp,
    setEnvironment,
    setCampaignIntro,
    removeUnit,
    clear,
    subscribe,
    getStorageWarning: () => storageWarning,

    // 第一阶段新增接口。
    getScene,
    getSceneSnapshot,
    setTerrain,
    getGroups: () => copy(scene.groups),
    updateUnit,
    updateUnits,
    createCluster,
    addCluster,
    addGroup,
    updateGroup,
    saveFormation,
    removeGroup,
    updateView,
    renameScene,
    newScene,
    exportScene,
    importScene,
    getActions: () => copy(scene.actions),
    addAction,
    removeAction,
    isRecoveryBlocked: () => recoveryBlocked,
    isSaving: () => saving,
    subscribeSaving,
    destroy
  };
}
