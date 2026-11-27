import {supportEffectOf} from '../tactical-map/support-equipment.js?v=electronic-ballistic-1';
import {normalizeAviationComplement} from './equipment-options.js?v=aviation-operations-1';
import {normalizeAircraft,aircraftMounts,aircraftAirTime,AIRCRAFT_WEAPON_ROLES} from './aircraft-template.js?v=self-sealing-1';
import { STATION_IDS, supportEquipmentSeed } from "../tactical-map/support-equipment.js?v=electronic-ballistic-1";
import { normalizeBuilding } from "../tactical-map/building-runtime.js?v=facility-rules-1";
import { normalizeNavalKind } from "../tactical-map/naval-kind.js?v=catalog-layout-2";
import { normalizeNavalSymbol } from "./naval-symbols.js?v=naval-formation-2";
import { createCatalogSeed,TRAINING_TRAIT_OPTIONS } from "./catalog-seed.js?v=electronic-ballistic-1";
import { normalizeFaction } from "./faction-data.js";


// ===== 图鉴存储 =====
// 图鉴与作战场景使用不同的保存键。
// 对外提供的单位数组保持同一个引用，方便现有编辑器同步。

const STORAGE_KEY = "junqi-catalog-v1";
const VERSION = 1;
const BRANCHES = new Set(["navy", "air", "army", "special", "building"]);

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

function normalizeProtected(value = false) {
  if (typeof value !== "boolean") {
    throw new Error("編集保護の値が不正です。");
  }

  return value;
}

function protectionError() {
  const error = new Error(
    "保護された資料を変更するには編集パスワードが必要です。"
  );

  error.code = "CATALOG_LOCKED";
  return error;
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

// 空值表示未登记；0表示没有备弹，不把两者混为一谈。
function normalizeAmmo(value) {
  const result = number(
    value ?? null,
    "予備弾数",
    { nullable: true, min: 0, integer: true }
  );

  if (result !== null && !Number.isSafeInteger(result)) {
    throw new Error(
      "予備弾数は0以上の安全に扱える整数で指定してください。"
    );
  }

  return result;
}


function normalizeEquipment(value) {
  if (!object(value)) {
    throw new Error("装備資料の書式が不正です。");
  }

  if (!["weapon", "support"].includes(value.kind)) {
    throw new Error("装備種別が不正です。");
  }

  if(value.supportEffect && value.supportEffect!=='control-tower' && (value.kind!=="support" || !STATION_IDS.includes(value.supportEffect)))throw new Error("支援装備の機能を確認してください。");
  return {
    id: text(value.id, "装備 ID", true),
    name: text(value.name, "装備名", true),
    faction: normalizeFaction(value.faction ?? ""),
    protected: normalizeProtected(value.protected ?? false),
    kind: value.kind,
    updatedAt: typeof value.updatedAt==='string'?value.updatedAt:null,
    supportEffect: text(value.supportEffect === 'control-tower' ? '' : supportEffectOf(value), "支援機能"),
    remoteRange: number(value.remoteRange ?? null,"遠隔操作範囲",{nullable:true,min:0}),

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

    ammo: normalizeAmmo(value.ammo),

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

const TRAINING_TRAIT_IDS = new Set(
  TRAINING_TRAIT_OPTIONS.map(item => item.id)
);

function normalizeTrainingTraits(value) {
  // 兼容旧图鉴：缺少字段表示没有词条，不默认添加奖励或惩罚。
  if (value === undefined) return [];

  if (!Array.isArray(value)) {
    throw new Error(
      "練度・特訓・特殊能力は一覧で指定してください。"
    );
  }

  const selected = new Set();

  for (const id of value) {
    if (typeof id !== "string" || !TRAINING_TRAIT_IDS.has(id)) {
      throw new Error(
        "未対応の練度・特訓・特殊能力が含まれています。"
      );
    }

    selected.add(id);
  }

  // 固定顺序并去重，避免重复词条导致补正重复计算。
  return TRAINING_TRAIT_OPTIONS
    .filter(item => selected.has(item.id))
    .map(item => item.id);
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

  if (value.branch === "building" && sizeLevel !== 1) throw new Error("建築の体型は現在1のみです。");

  if (sizeLevel > 5) {
    throw new Error("体型は 1～5 で指定してください。");
  }

  const aircraft = value.branch==='air' && value.aircraft!==undefined ? normalizeAircraft(value.aircraft) : null;
  const naval = value.naval ?? {};

  if (!object(naval)) {
    throw new Error("艦船属性の書式が不正です。");
  }

  const {surfaceSpeedKnots: legacySurfaceSpeed, ...navalFields} = naval;
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

    maxHp: number(aircraft?.engines ?? value.maxHp, "最大生命", {
      min: Number.MIN_VALUE
    }),

    sizeLevel,
    ...(aircraft ? {aircraft} : {}),
    ...(value.branch === "building" ? {building: normalizeBuilding(value.building)} : {}),
    trainingTraits: normalizeTrainingTraits(value.trainingTraits),
    aviationComplement: normalizeAviationComplement(value.aviationComplement),
    description: text(value.description ?? "", "説明"),


    naval: {
      ...copy(navalFields),
      type: text(naval.type ?? "", "属性"),
      iconType: normalizeNavalSymbol(naval.iconType),
      ...(naval.kind === undefined || naval.kind === "" ? {} : {kind:normalizeNavalKind(naval.kind)}),
      aswRecon: text(naval.aswRecon ?? "", "対潜偵察"),
      submergedSpeedKnots: number(naval.submergedSpeedKnots ?? null,"水中航速",{nullable:true,min:0}),

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
        legacySurfaceSpeed ?? naval.speedKnots ?? null,
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
        position: aircraft ? AIRCRAFT_WEAPON_ROLES.find(([id,label])=>id===item.role||label===item.position)?.[1] ?? text(item.position,"航空機の装備区分",true) : value.branch === "building" ? (["地下","中心"].includes(item.position) ? item.position : "露天") : text(item.position, "装備位置", true),
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
  delete result.aircraftSnapshots;
  if(aircraft){
    if(result.mounts.some(m=>!AIRCRAFT_WEAPON_ROLES.some(([,label])=>label===m.position)))throw new Error('航空機の固定装備は主動武器・自衛武器・ポッドで指定してください。');
    aircraftAirTime(result.naval.endurance,result.naval.speedKnots);
  }

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

  const retired=new Set(value.equipment.filter(e=>e.supportEffect==='control-tower'||e.id==='eq-support-control-tower').map(e=>e.id));
  const units = value.units.map(u=>normalizeUnit({...u,mounts:(u.mounts??[]).filter(m=>!retired.has(m.equipmentId))}));
  const equipment = value.equipment.filter(e=>!retired.has(e.id)).map(normalizeEquipment);

  const unitIds = new Set();
  const equipmentIds = new Set();

  for (const item of equipment) {
    if (equipmentIds.has(item.id)) {
      throw new Error(`装備 ID が重複しています：${item.id}`);
    }

    equipmentIds.add(item.id);
  }

  const equipmentById=new Map(equipment.map(e=>[e.id,e]));
  for(const u of units)if(u.branch==='building'&&u.mounts.filter(m=>m.position==='中心').length>1)throw Error('建築の中心配置は1か所にしてください。');
  const aircraftById=new Map(units.filter(u=>u.branch==='air'&&u.aircraft).map(u=>[u.id,u]));
  for (const unit of units) {
    if (unitIds.has(unit.id)) {
      throw new Error(`ユニット ID が重複しています：${unit.id}`);
    }

    unitIds.add(unit.id);

    for(const entry of unit.aviationComplement){if(!['navy','building'].includes(unit.branch)||!aircraftById.has(entry.unitId))throw new Error(`${unit.name}：搭載航空機の図鑑参照が不正です。`);}
    for (const mount of aircraftMounts(unit)) {
      if (!equipmentIds.has(mount.equipmentId)) {
        throw new Error(
          `${unit.name}：参照する装備がありません。${mount.equipmentId}`
        );
      }
    }
    if(unit.branch==='air' && unit.aircraft){
      if(unit.aircraft.loadouts.some(l=>l.mounts.some(m=>equipmentById.get(m.equipmentId)?.kind!=='weapon')))throw new Error(`${unit.name}：掛載には武器だけを登録してください。`);
      if(unit.mounts.some(m=>m.position==='ポッド'&&equipmentById.get(m.equipmentId)?.kind!=='support'))throw new Error(`${unit.name}：ポッドには支援装備だけを搭載できます。`);
    }
  }

  return { version: VERSION, units, equipment, supportStationsVersion: value.supportStationsVersion ?? 0 };
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

  if(!recoveryError && data.supportStationsVersion<4){
    const existing=new Set(data.equipment.map(item=>item.id));
    data=normalizeCatalog({...data,supportStationsVersion:4,equipment:[...data.equipment,...supportEquipmentSeed().filter(item=>(data.supportStationsVersion<1||(data.supportStationsVersion<2?['preparation-area','runway','catapult','remote-station','ground-crew','night-observation']:data.supportStationsVersion<3?['remote-station','ground-crew','night-observation']:['night-observation']).includes(item.supportEffect))&&!existing.has(item.id))]});
    localStorage.setItem(STORAGE_KEY,JSON.stringify(data));
  }

  if(!recoveryError&&data.supportStationsVersion<5){const existing=new Set(data.equipment.map(e=>e.id));const additions=supportEquipmentSeed().filter(e=>['mine','mine-guard','boat','observation-balloon','spotter','rato'].includes(e.supportEffect)&&!existing.has(e.id));data=normalizeCatalog({...data,supportStationsVersion:5,equipment:[...data.equipment,...additions]});localStorage.setItem(STORAGE_KEY,JSON.stringify(data));}

  if(!recoveryError&&data.supportStationsVersion<6){const existing=new Set(data.equipment.map(e=>e.id));const additions=supportEquipmentSeed().filter(e=>['electronic-warfare-pod','flare'].includes(e.supportEffect)&&!existing.has(e.id));data=normalizeCatalog({...data,supportStationsVersion:6,equipment:[...data.equipment,...additions]});localStorage.setItem(STORAGE_KEY,JSON.stringify(data));}
  const units = [];
  const listeners = new Set();
  // 只在当前页面内有效，不写入 localStorage。
  // 刷新页面后需要重新输入密码。
  let editingAuthorized = false;

  function requireEditingAuthorization() {
    if (!editingAuthorized) {
      throw protectionError();
    }
  }


  function syncUnits() {
    const equipmentMap = new Map(
      data.equipment.map(item => [item.id, item])
    );

    const snapshotFor=unit=>({...copy(unit),equipmentSnapshots:[...new Set(aircraftMounts(unit).map(m=>m.equipmentId))].map(id=>copy(equipmentMap.get(id)))});
    const aircraftMap=new Map(data.units.filter(u=>u.branch==='air').map(u=>[u.id,u]));
    const next = data.units.map(unit => ({
      ...copy(unit),

      aircraftSnapshots: [...new Set(unit.aviationComplement.map(e=>e.unitId))].map(id=>snapshotFor(aircraftMap.get(id))),
      // 参战快照携带当时的装备性能，不只保存装备 ID。
      equipmentSnapshots: [
        ...new Set(aircraftMounts(unit).map(mount => mount.equipmentId))
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
    if (collection === "units") {
      const existing = data.units.find(
        unit => unit.id === item.id
      );

      // 修改已保护单位，以及首次开启保护，都需要授权。
      // 因此不能通过取消勾选来绕过保护。
      if (existing?.protected || item.protected === true) {
        requireEditingAuthorization();
      }
    }

    const candidate = copy(data);
    const last=candidate[collection].reduce((n,i)=>Math.max(n,Number.isFinite(Date.parse(i.updatedAt))?Date.parse(i.updatedAt):0),0);
    item={...copy(item),updatedAt:new Date(Math.max(Date.now(),last+1)).toISOString()};

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
  isEditingAuthorized() {
      return editingAuthorized;
    },

    authorizeEditing(password) {
      // 前端编辑锁：不能视为服务器权限验证或真正加密。
      if (password !== "shireisenyuri") {
        throw new Error("編集パスワードが違います。");
      }

      editingAuthorized = true;
    },

    lockEditing() {
      editingAuthorized = false;
    },

    moveItem(collection,id,otherId){
      if(!['units','equipment'].includes(collection))throw Error('並び順の分類が不正です。');const candidate=copy(data),list=candidate[collection],a=list.findIndex(i=>i.id===id),b=list.findIndex(i=>i.id===otherId);if(a<0||b<0)throw Error('並べ替える資料がありません。');[list[a],list[b]]=[list[b],list[a]];commit(candidate);
    },
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
      const existing = data.units.find(unit => unit.id === id);
      if(data.units.some(u=>u.aviationComplement.some(e=>e.unitId===id)))throw new Error("搭載航空機として参照されています。");

      if (existing?.protected) {
        requireEditingAuthorization();
      }

      const candidate = copy(data);

      candidate.units = candidate.units.filter(
        item => item.id !== id
      );

      commit(candidate);
    },


    deleteEquipment(id) {
      const users = data.units.filter(unit =>
        aircraftMounts(unit).some(mount => mount.equipmentId === id)
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

            // 先完整验证，导入失败不改变当前图鉴。
      const next = normalizeCatalog(parsed);

      const nextUnits = new Map(
        next.units.map(unit => [unit.id, unit])
      );

      // 不允许通过导入删除、修改或解除现有单位的保护。
      const changesProtectedUnits = data.units.some(unit => {
        if (!unit.protected) return false;

        const replacement = nextUnits.get(unit.id);

        return !replacement ||
          JSON.stringify(unit) !== JSON.stringify(replacement);
      });

      // 导入新的受保护单位，也需要授权。
      const currentUnits = new Map(
        data.units.map(unit => [unit.id, unit])
      );

      const enablesProtection = next.units.some(unit =>
        unit.protected &&
        !currentUnits.get(unit.id)?.protected
      );

      if (changesProtectedUnits || enablesProtection) {
        requireEditingAuthorization();
      }

      commit(next, true);

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
