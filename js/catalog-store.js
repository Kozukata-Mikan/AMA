import { createCatalogSeed } from "./catalog-seed.js";
import { normalizeFaction } from "./faction-data.js";


// ===== 图鉴存储 =====
// 图鉴与作战场景使用不同的保存键。
// 对外提供的单位数组保持同一个引用，方便现有编辑器同步。

const STORAGE_KEY = "junqi-catalog-v1";
const VERSION = 1;
const BRANCHES = new Set(["navy", "air", "army", "special"]);

let currentStore = null;

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function object(value) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function text(value, label, required = false) {
  if (typeof value !== "string") {
    throw new Error(`${label}は文字列で指定してください。`);
  }

  const result = value.trim();

  if (required && !result) {
    throw new Error(`${label}は空欄にできません。`);
  }

  return result;
}

function number(value, label, {
  nullable = false,
  min = 0,
  integer = false
} = {}) {
  if (nullable && value === null) return null;

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    (integer && !Number.isInteger(value))
  ) {
    throw new Error(`${label}の値が不正です。`);
  }

  return value;
}

function normalizeEquipment(value) {
  if (!object(value)) {
    throw new Error("装備資料の書式が不正です。");
  }

  if (!["weapon", "support"].includes(value.kind)) {
    throw new Error("装備種別が不正です。");
  }

  return {
    id: text(value.id, "装備 ID", true),
    name: text(value.name, "装備名", true),
    faction: normalizeFaction(value.faction ?? ""),
    kind: value.kind,

    barrelCount: number(
      value.barrelCount ?? null,
      "砲身数",
      { nullable: true, min: 1, integer: true }
    ),

    projectionCoefficient: number(
      value.projectionCoefficient ?? null,
      "投射率の X",
      { nullable: true, min: 0 }
    ),

    projectionSuffix: text(
      value.projectionSuffix ?? "",
      "投射率の接尾記号"
    ),

    note: text(value.note ?? "", "備考"),
    slot: text(value.slot ?? "", "スロット"),
    powerRule: text(value.powerRule ?? "", "威力"),
    penetration: text(value.penetration ?? "", "穿深"),

    ceilingU: number(
      value.ceilingU ?? null,
      "射高",
      { nullable: true }
    ),

    range: number(
      value.range ?? null,
      "射距",
      { nullable: true }
    ),

    maxOrder: text(value.maxOrder ?? "", "最高次序"),
    guidance: text(value.guidance ?? "", "引導方式"),
    targetScope: text(value.targetScope ?? "", "攻撃範囲")
  };
}

function normalizeUnit(value) {
  if (!object(value)) {
    throw new Error("ユニット資料の書式が不正です。");
  }

  if (!BRANCHES.has(value.branch)) {
    throw new Error("軍種が不正です。");
  }

  const sizeLevel = number(
    value.sizeLevel ?? 1,
    "体型",
    { min: 1, integer: true }
  );

  if (sizeLevel > 5) {
    throw new Error("体型は 1～5 で指定してください。");
  }

  const naval = value.naval ?? {};

  if (!object(naval)) {
    throw new Error("艦船属性の書式が不正です。");
  }

  const hullNames = value.hullNames ?? [];
  const mounts = value.mounts ?? [];
  const embarked = value.embarked ?? [];

  if (
    !Array.isArray(hullNames) ||
    !Array.isArray(mounts) ||
    !Array.isArray(embarked)
  ) {
    throw new Error("艦名・装備・搭載機は一覧で指定してください。");
  }

  // 保留旧单位模板中的其他字段，不随本次编辑丢弃。
  const result = {
    ...copy(value),

    id: text(value.id, "ユニット ID", true),
    name: text(value.name, "名称", true),
    branch: value.branch,
    faction: normalizeFaction(value.faction ?? ""),

    maxHp: number(value.maxHp, "最大生命", {
      min: Number.MIN_VALUE
    }),

    sizeLevel,
    description: text(value.description ?? "", "説明"),

    naval: {
      ...copy(naval),
      type: text(naval.type ?? "", "属性"),

      strength: number(
        naval.strength ?? null,
        "強度",
        { nullable: true }
      ),

      detection: text(naval.detection ?? "", "探測強度"),
      seaRecon: text(naval.seaRecon ?? "", "対海偵察"),
      airRecon: text(naval.airRecon ?? "", "対空偵察"),
      armor: text(naval.armor ?? "", "装甲"),

      speedKnots: number(
        naval.speedKnots ?? null,
        "航速",
        { nullable: true }
      ),

      endurance: text(naval.endurance ?? "", "続航力")
    },

    hullNames: hullNames.map(name =>
      text(name, "艦名", true)
    ),

    mounts: mounts.map(item => {
      if (!object(item)) {
        throw new Error("装備取付資料の書式が不正です。");
      }

      return {
        position: text(item.position, "装備位置", true),
        equipmentId: text(item.equipmentId, "装備 ID", true),

        count: number(
          item.count,
          "装備組数",
          { nullable: true, min: 1, integer: true }
        )
      };
    }),

    embarked: embarked.map(item => {
      if (!object(item)) {
        throw new Error("搭載機資料の書式が不正です。");
      }

      return {
        name: text(item.name, "搭載機名", true),

        count: number(
          item.count,
          "搭載機数",
          { min: 1, integer: true }
        )
      };
    })
  };

  // 此字段由当前装备资料重新生成，不接受导入文件中的旧副本。
  delete result.equipmentSnapshots;

  return result;
}

function normalizeCatalog(value) {
  if (
    !object(value) ||
    value.version !== VERSION ||
    !Array.isArray(value.units) ||
    !Array.isArray(value.equipment)
  ) {
    throw new Error("対応していない図鑑データ形式です。");
  }

  if (
    value.units.length > 10000 ||
    value.equipment.length > 10000
  ) {
    throw new Error("図鑑資料は各 10000 件以内にしてください。");
  }

  const units = value.units.map(normalizeUnit);
  const equipment = value.equipment.map(normalizeEquipment);

  const unitIds = new Set();
  const equipmentIds = new Set();

  for (const item of equipment) {
    if (equipmentIds.has(item.id)) {
      throw new Error(`装備 ID が重複しています：${item.id}`);
    }

    equipmentIds.add(item.id);
  }

  for (const unit of units) {
    if (unitIds.has(unit.id)) {
      throw new Error(`ユニット ID が重複しています：${unit.id}`);
    }

    unitIds.add(unit.id);

    for (const mount of unit.mounts) {
      if (!equipmentIds.has(mount.equipmentId)) {
        throw new Error(
          `${unit.name}：参照する装備がありません。${mount.equipmentId}`
        );
      }
    }
  }

  return { version: VERSION, units, equipment };
}

export function initializeCatalog(baseUnits) {
  if (currentStore) return currentStore;

  const seed = createCatalogSeed();

  // 新条目不能静默覆盖原 JSON 中相同 ID 的单位。
  const baseIds = new Set(baseUnits.map(unit => unit.id));

  for (const unit of seed.units) {
    if (baseIds.has(unit.id)) {
      throw new Error(
        `初期図鑑 ID が既存資料と重複しています：${unit.id}`
      );
    }
  }

  let data = normalizeCatalog({
    version: VERSION,
    units: [...copy(baseUnits), ...seed.units],
    equipment: seed.equipment
  });

  // 使用单独的恢复错误，不覆盖损坏的本地图鉴。
  let recoveryError = "";

  try {
    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved !== null) {
      data = normalizeCatalog(JSON.parse(saved));
    }
  } catch (error) {
    recoveryError =
      "保存図鑑を復元できませんでした。" +
      "元データ保護のため編集を停止しています。" +
      "「保存原文を書き出し」でバックアップし、有効な図鑑 JSON を読み込んでください。";

    console.error(error);
  }

  const units = [];
  const listeners = new Set();

  function syncUnits() {
    const equipmentMap = new Map(
      data.equipment.map(item => [item.id, item])
    );

    const next = data.units.map(unit => ({
      ...copy(unit),

      // 参战快照携带当时的装备性能，不只保存装备 ID。
      equipmentSnapshots: [
        ...new Set(unit.mounts.map(mount => mount.equipmentId))
      ].map(id => copy(equipmentMap.get(id)))
    }));

    units.splice(0, units.length, ...next);
  }

  function notify() {
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        console.error(error);
      }
    }
  }

  function commit(candidate, allowRecovery = false) {
    if (recoveryError && !allowRecovery) {
      throw new Error(recoveryError);
    }

    const next = normalizeCatalog(candidate);

    // 本地保存成功后才更新内存，失败不报告“保存成功”。
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      throw new Error(
        "図鑑を保存できません。保存領域の容量とブラウザー設定を確認してください。"
      );
    }

    data = next;
    recoveryError = "";
    syncUnits();
    notify();
  }

  function upsert(collection, item) {
    const candidate = copy(data);
    const list = candidate[collection];
    const index = list.findIndex(value => value.id === item.id);

    if (index < 0) {
      list.push(copy(item));
    } else {
      list[index] = copy(item);
    }

    commit(candidate);
  }

  syncUnits();

  currentStore = {
    units,

    getData() {
      return copy(data);
    },

    getRecoveryError() {
      return recoveryError;
    },

    saveUnit(item) {
      upsert("units", item);
    },

    saveEquipment(item) {
      upsert("equipment", item);
    },

    deleteUnit(id) {
      const candidate = copy(data);
      candidate.units = candidate.units.filter(item => item.id !== id);
      commit(candidate);
    },

    deleteEquipment(id) {
      const users = data.units.filter(unit =>
        unit.mounts.some(mount => mount.equipmentId === id)
      );

      if (users.length) {
        throw new Error(
          "この装備は使用中です：" +
          users.map(unit => unit.name).join("、")
        );
      }

      const candidate = copy(data);

      candidate.equipment = candidate.equipment.filter(
        item => item.id !== id
      );

      commit(candidate);
    },

    exportJSON() {
      return JSON.stringify(data, null, 2);
    },

    exportSavedRaw() {
      const raw = localStorage.getItem(STORAGE_KEY);

      if (raw === null) {
        throw new Error("保存原文はありません。");
      }

      return raw;
    },

    importJSON(value) {
      if (
        typeof value !== "string" ||
        value.length > 10_000_000
      ) {
        throw new Error("図鑑 JSON は 10 MB 相当以内にしてください。");
      }

      let parsed;

      try {
        parsed = JSON.parse(value);
      } catch {
        throw new Error("JSON の書式が不正です。");
      }

      commit(parsed, true);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };

  return currentStore;
}

export function getCatalogStore() {
  if (!currentStore) {
    throw new Error("図鑑が初期化されていません。");
  }

  return currentStore;
}
