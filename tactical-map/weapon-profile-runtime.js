import { parseHitExpression } from "./weapon-hit-runtime.js";
import { getEquipmentLabel } from "../js/catalog-seed.js";

// 只适配已经确认的图鉴字段。
// 不修改装备快照，不初始化备弹，不进行随机判定。

const GUIDANCE = new Map([
  ["抛射", { id: "lobbed", underwater: false }],
  ["拋射", { id: "lobbed", underwater: false }],
  ["平射", { id: "direct", underwater: false }],
  ["平射（水下）", { id: "direct", underwater: true }],
  ["平射(水下)", { id: "direct", underwater: true }],
  ["惯性", { id: "inertial", underwater: false }],
  ["慣性", { id: "inertial", underwater: false }],
  ["惯性（大型）", { id: "inertial", underwater: false, large: true }],
  ["慣性（大型）", { id: "inertial", underwater: false, large: true }],
  ["惯性(大型)", { id: "inertial", underwater: false, large: true }],
  ["慣性(大型)", { id: "inertial", underwater: false, large: true }],
  ["射线", { id: "ray", underwater: false }],
  ["射線", { id: "ray", underwater: false }],
  ["雷达", { id: "radar", underwater: false }],
  ["レーダー", { id: "radar", underwater: false }],
  ["数控", { id: "computer", underwater: false }],
  ["数控誘導", { id: "computer", underwater: false }]
]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function nonnegativeNumber(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
  );
}

export function readWeaponProfile(equipment) {
  if (
    !equipment ||
    typeof equipment !== "object" ||
    Array.isArray(equipment)
  ) {
    throw new Error("装備スナップショットの書式が不正です。");
  }

  const issues = [];
  const weapon = equipment.kind === "weapon";

  const result = {
    equipmentId: text(equipment.id),
    label: getEquipmentLabel(equipment),
    kind: equipment.kind,
    projection: null,
    fullAmmoCost: null,
    guidance: null,
    underwater: false,
    large: false,
    maxOrder: null,
    pasOnly: false,
    range: null,
    ceilingU: null,
    initialAmmo: null,

    // 保留原表记，尚未在此裁定伤害和范围规则。
    powerRule: text(equipment.powerRule),
    penetration: text(equipment.penetration),
    targetScope: text(equipment.targetScope),
    issues
  };

  if (!result.equipmentId) {
    issues.push("装備IDが未登録です。");
  }

  // 支援装备不被误当成武器，也不要求填写武器参数。
  if (!weapon) {
    if (equipment.kind !== "support") {
      issues.push("装備種別に対応していません。");
    }

    return result;
  }

  const x = equipment.projectionCoefficient;
  const y = equipment.barrelCount;
  const suffix = text(equipment.projectionSuffix);

  try {
    if (!/^R$/i.test(suffix)) {
      throw new Error("投射率の接尾記号に対応していません。");
    }

    const absent = value => value === null || value === undefined;

    if (absent(x) && absent(y)) {
      // XとYが両方未登録、接尾記号Rのみの場合。
      result.projection = parseHitExpression("R");
    } else if (positiveInteger(x) && positiveInteger(y)) {
      result.projection = parseHitExpression(`${x}·${y}R`);
    } else {
      throw new Error(
        "投射率のXとYは両方とも正の整数で登録してください。"
      );
    }

    const cost =
      result.projection.groups *
      result.projection.coinsPerGroup;

    if (!Number.isSafeInteger(cost)) {
      throw new Error("投射弾数が範囲外です。");
    }

    result.fullAmmoCost = cost;
  } catch (error) {
    result.projection = null;
    issues.push(error.message);
  }

  const guidance = GUIDANCE.get(text(equipment.guidance));

  if (guidance) {
    result.guidance = guidance.id;
    result.underwater = guidance.underwater;
    result.large = guidance.large === true;
  } else {
    issues.push("引導方式が未登録、または未対応です。");
  }

  const order = String(equipment.maxOrder ?? "").trim();

  if (/^PAS$/i.test(order)) {
    result.pasOnly = true;
  } else if (/^[1-5]$/.test(order)) {
    result.maxOrder = Number(order);
  } else {
    issues.push("最高次序は1～5またはPASで登録してください。");
  }

  for (const [key, label] of [
    ["range", "射距"],
    ["ceilingU", "射高"]
  ]) {
    if (nonnegativeNumber(equipment[key])) {
      result[key] = equipment[key];
    } else {
      issues.push(`${label}が未登録、または不正です。`);
    }
  }

  if (
    Number.isSafeInteger(equipment.ammo) &&
    equipment.ammo >= 0
  ) {
    result.initialAmmo = equipment.ammo;
  } else if (
    equipment.ammo === null ||
    equipment.ammo === undefined
  ) {
    issues.push(
      "初期予備弾数が未登録です。無限弾薬として扱いません。"
    );
  } else {
    issues.push("初期予備弾数は0以上の整数で登録してください。");
  }

  if (!result.powerRule) {
    issues.push("威力／参照ルールが未登録です。");
  }

  if (!result.penetration) {
    issues.push("穿深が未登録です。");
  }

  if (!result.targetScope) {
    issues.push("攻撃範囲が未登録です。");
  }

  return result;
}

// 正式范围解析：只接受语义明确的表记。
// 不读玩家请求中的scope，不修改装备快照。
export function readWeaponTargetScope(value) {
  if (typeof value !== "string") {
    throw new Error("装備の攻撃範囲が未登録です。");
  }

  const source = value.trim();

  if (/^(单体|單體|単体)$/.test(source)) {
  return { kind: "single" };
}

// 正式规则：以一个集群为目标，同时攻击其中每个单体。
// 沿用已有全体范围接口，不增加人数限制或随机抽选。
if (source === "集群") {
  return {
    kind: "range",
    mode: "all",
    maximumTargets: null
  };
}


  const match = source.match(
    /^(?:范围|範圍|範囲|集群)\s*[（(]\s*(全体|全體|指定|随机|隨機|ランダム)\s*(\d+)?\s*(?:名|体|體)?\s*[）)]$/
  );

  if (!match) {
    throw new Error(
      "装備の攻撃範囲を正式に解釈できません。" +
      "範囲方式・人数上限を推測せず、処理を停止します。"
    );
  }

  const modeText = match[1];
  const numberText = match[2];

  if (/^(全体|全體)$/.test(modeText)) {
    if (numberText !== undefined) {
      throw new Error("全体範囲には人数上限を指定できません。");
    }

    return {
      kind: "range",
      mode: "all",
      maximumTargets: null
    };
  }

  const maximumTargets = Number(numberText);

  if (
    numberText === undefined ||
    !Number.isSafeInteger(maximumTargets) ||
    maximumTargets < 1
  ) {
    throw new Error("範囲攻撃の人数上限が不正です。");
  }

  return {
    kind: "range",
    mode: modeText === "指定" ? "specified" : "random",
    maximumTargets
  };
}
