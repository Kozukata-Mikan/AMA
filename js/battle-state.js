// ===== 共享参战状态 =====
// 界面和错误文案使用日文，代码注释使用中文。
import {
  createDemoTerrain,
  validateTerrain
} from "../tactical-map/terrain-data.js";

import {
  VIEW_SCALE_MIN,
  VIEW_SCALE_MAX
} from "../tactical-map/map-settings.js";

import {
  createDefaultEnvironment,
  normalizeEnvironment
} from "../tactical-map/environment-data.js";


import { assessCluster } from "../tactical-map/cluster-engine.js";

const STORAGE_KEY = "junqi-battle-scene-v2";
const LEGACY_KEY = "junqi-battle-state-v1";
const VERSION = 2;

const BRANCHES = new Set(["navy", "air", "army", "special"]);
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

export function createBattleStore(units) {
  const catalog = new Map(units.map(unit => [unit.id, unit]));
  const listeners = new Set();

  let scene = emptyScene();
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

    const name = requireText(item.name ?? snapshot.name, "ユニット名");
    const side = item.side ?? "ally";

    if (!SIDES.has(side)) {
      throw new Error("陣営の値が不正です。");
    }

    const sizeLevel = requireNumber(
      item.sizeLevel ?? 1,
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
      item.underwater ?? false,
      "水中設定"
    );

    if (underwater && snapshot.branch !== "navy") {
      throw new Error("水中設定は海軍ユニットにのみ指定できます。");
    }

    const altitude = item.altitude ?? null;

    if (altitude !== null) {
      requireNumber(altitude, "海抜高度");
    }

    const groupId = item.groupId ?? null;

    if (groupId !== null) {
      requireText(groupId, "所属編隊番号");
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
        item.depth ?? 12,
        "水中深度",
        Number.MIN_VALUE
      ),
      labelHeight: requireNumber(
        item.labelHeight ?? 65,
        "名称表示の高さ",
        0,
        500
      ),
      description,
      groupId
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
      kind
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
      depth: requireNumber(value.depth, "記録水中深度", Number.MIN_VALUE)
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

    const view = input.view ?? { x: 0, y: 0, scale: 1 };

    if (!isObject(view)) {
      throw new Error("地図表示設定の書式が不正です。");
    }

    return {
      version: VERSION,
      name: requireText(input.name, "作戦名"),
      terrainId: input.terrainId,
      terrain: validateTerrain(input.terrain ?? createDemoTerrain()),
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
        listener(getAll());
      } catch (error) {
        // ある画面の描画失敗で、他の購読者まで停止させない。
        console.error(error);
      }
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(scene));
      storageWarning = "";
    } catch (error) {
      storageWarning =
        "保存できませんでした。現在の変更はメモリー内にのみ保持されています。作戦データを書き出してください。";
      console.warn(error);
    }
  }

  function commit(candidate, allowRecovery = false) {
    if (recoveryBlocked && !allowRecovery) {
      throw new Error(
        "保存データを復元できませんでした。元データ保護のため、編集を停止しています。バックアップ後に初期化するか、有効な作戦データを読み込んでください。"
      );
    }

    // 検証が成功するまで現在の場面には触れない。
    const next = normalizeScene(candidate);

    scene = next;
    recoveryBlocked = false;
    persist();
    emit();
  }

  function change(callback) {
    const candidate = getScene();
    callback(candidate);
    commit(candidate);
  }

  // ===== 起動時の復元 =====
  try {
    const savedText = localStorage.getItem(STORAGE_KEY);

    if (savedText !== null) {
      scene = normalizeScene(JSON.parse(savedText));
    } else {
      const legacyText = localStorage.getItem(LEGACY_KEY);

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

  function addUnit(unitId) {
    const base = catalog.get(unitId);

    if (!base) {
      throw new Error("該当ユニットの図鑑資料が見つかりません。");
    }

    const instance = normalizeInstance({
      instanceId: newId(),
      unitId,
      snapshot: copy(base),
      currentHp: base.maxHp,
      altitude: base.branch === "air" ? 80 : null
    });

    change(candidate => {
      candidate.instances.push(instance);
    });

    return copy(instance);
  }

  function updateUnit(instanceId, patch) {
    if (!isObject(patch)) {
      throw new Error("ユニット更新データの書式が不正です。");
    }

    // 個体番号・図鑑番号・軍種・快照は、この編集接口では変更させない。
    const editable = new Set([
      "name",
      "side",
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
      "groupId"
    ]);

    for (const key of Object.keys(patch)) {
      if (!editable.has(key)) {
        throw new Error(`変更できないユニット項目です：${key}`);
      }
    }

    change(candidate => {
      const index = candidate.instances.findIndex(
        item => item.instanceId === instanceId
      );

      if (index < 0) {
        throw new Error("該当する参戦ユニットが見つかりません。");
      }

      candidate.instances[index] = {
        ...candidate.instances[index],
        ...patch
      };
    });
  }

  // 批量更新先验证，再一次性提交。
  // 避免集群移动到一半时被中间状态打断。
  function updateUnits(updates) {
    if (!Array.isArray(updates) || !updates.length) {
      throw new Error("更新ユニット一覧が不正です。");
    }

    const editable = new Set([
      "name",
      "side",
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
      "groupId"
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
    }

    change(candidate => {
      for (const update of updates) {
        const index = candidate.instances.findIndex(
          unit => unit.instanceId === update.instanceId
        );

        if (index < 0) {
          throw new Error("更新対象のユニットが見つかりません。");
        }

        candidate.instances[index] = {
          ...candidate.instances[index],
          ...update.patch
        };
      }
    });
  }

  // 将已有单体合并为集群。
  function createCluster(instanceIds, name) {
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

    change(candidate => {
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
  function addCluster(unitId, count, sizeLevel, name) {
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
        altitude: base.branch === "air" ? 80 : null
      })
    );

    change(candidate => {
      candidate.groups.push(group);
      candidate.instances.push(...members);
    });

    return {
      group: copy(group),
      members: copy(members)
    };
  }

  
  function updateHp(instanceId, currentHp) {
    updateUnit(instanceId, { currentHp });
  }

  function removeUnit(instanceId) {
    change(candidate => {
      candidate.instances = candidate.instances.filter(
        item => item.instanceId !== instanceId
      );
    });
  }

  function addGroup(name, parentId = null) {
    const group = {
      id: newId(),
      name,
      parentId
    };

    change(candidate => {
      candidate.groups.push(group);
    });

    return copy(group);
  }

  function updateGroup(id, patch) {
    if (!isObject(patch)) {
      throw new Error("編隊更新データの書式が不正です。");
    }

    for (const key of Object.keys(patch)) {
      if (key !== "name" && key !== "parentId") {
        throw new Error(`変更できない編隊項目です：${key}`);
      }
    }

    change(candidate => {
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

  function removeGroup(id) {
    change(candidate => {
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
        }
      }

      candidate.groups = candidate.groups.filter(item => item.id !== id);
    });
  }

  function updateView(patch) {
    if (!isObject(patch)) {
      throw new Error("地図表示更新データの書式が不正です。");
    }

    for (const key of Object.keys(patch)) {
      if (!["x", "y", "scale"].includes(key)) {
        throw new Error(`変更できない表示項目です：${key}`);
      }
    }

    change(candidate => {
      candidate.view = {
        ...candidate.view,
        ...patch
      };
    });
  }

  function renameScene(name) {
    change(candidate => {
      candidate.name = name;
    });
  }

  function newScene(name = "新しい作戦") {
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

    commit(candidate);
  }

  
  function clear() {
    // 明确的清空操作允许解除恢复保护。
    commit(emptyScene(), true);
  }

  function exportScene() {
    if (recoveryBlocked) {
      throw new Error(
        "復元に失敗した元データは、この書き出しでは取得できません。先にブラウザーの保存領域からバックアップしてください。"
      );
    }

    return JSON.stringify(scene, null, 2);
  }

  function importScene(text) {
    if (typeof text !== "string") {
      throw new Error("作戦データは JSON テキストで指定してください。");
    }

    if (text.length > 5_000_000) {
      throw new Error("作戦データが大きすぎます。");
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

    commit(candidate, true);
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

  function addAction({ attackerId, targetId, actionType, note = "" }) {
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

    change(candidate => {
      if (candidate.actions.length >= 5000) {
        throw new Error(
          "行動記録が 5000 件に達しました。書き出した後、不要な記録を削除してください。"
        );
      }

      candidate.actions.push(record);
    });

    return copy(record);
  }

  function removeAction(id) {
    change(candidate => {
      candidate.actions = candidate.actions.filter(
        item => item.id !== id
      );
    });
  }
    function setTerrain(terrain) {
    const validated = validateTerrain(terrain);

    change(candidate => {
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

  function handleStorage(event) {
    if (event.key !== STORAGE_KEY && event.key !== null) {
      return;
    }

    try {
      // 读取此刻的保存结果，而不是可能已过期的事件内容。
      const text = localStorage.getItem(STORAGE_KEY);

      if (text === null) {
        storageWarning =
          "別の画面で保存データが削除されました。現在の表示は変更していません。";
        emit();
        return;
      }

      const next = normalizeScene(JSON.parse(text));

      scene = next;
      recoveryBlocked = false;
      storageWarning = "";
      emit();
    } catch (error) {
      storageWarning =
        "別の画面の保存データを読み込めませんでした。現在の表示は変更していません。";
      console.warn(error);
      emit();
    }
  }

  window.addEventListener("storage", handleStorage);

  function destroy() {
    window.removeEventListener("storage", handleStorage);
    listeners.clear();
  }

  return {
    // 原页面已有接口。
    getAll,
    addUnit,
    updateHp,
    removeUnit,
    clear,
    subscribe,
    getStorageWarning: () => storageWarning,

    // 第一阶段新增接口。
    getScene,
    setTerrain,
    getGroups: () => copy(scene.groups),
    updateUnit,
    updateUnits,
    createCluster,
    addCluster,
    addGroup,
    updateGroup,
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
    destroy
  };
}
