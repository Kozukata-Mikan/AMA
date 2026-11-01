import { parseArmorGrade } from "./armor-grades.js";

function fail(message) {
  throw new Error(message);
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail(`${label}は${minimum}以上の整数で指定してください。`);
  }
  return value;
}

function number(value, label) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    fail(`${label}は0以上の数値で指定してください。`);
  }
  return value;
}

function normalizeGuidance(value) {
  const table = {
    "抛射": ["lobbed", false],
    "平射": ["direct", false],
    "平射（水下）": ["direct", true],
    "平射(水下)": ["direct", true],
    "射线": ["ray", false],
    "射線": ["ray", false],
    "惯性": ["inertial", false],
    "慣性": ["inertial", false],
    "惯性（大型）": ["inertial", true],
    "惯性(大型)": ["inertial", true],
    "慣性（大型）": ["inertial", true],
    "雷达": ["radar", true],
    "レーダー": ["radar", true],
    "数控": ["computer", true]
  };

  const key = typeof value === "string" ? value.trim() : "";
  const entry = table[key];

  if (!entry) fail("未対応の誘導方式です。");

  return {
    type: entry[0],
    physical: entry[1],
    original: key
  };
}

function normalizePower(value) {
  const text = typeof value === "string" ? value.trim() : "";

  if (["舰炮规则", "艦砲規則"].includes(text)) {
    return { type: "naval-gun", value: null };
  }

  const match = text.match(
    /^(\d+(?:\.\d+)?)\s*(?:[（(](水下|设备|設備)[）)])?$/
  );

  if (!match) fail("威力の表記が未対応または未登録です。");

  const power = Number(match[1]);

  if (!Number.isFinite(power) || power <= 0) {
    fail("威力は0より大きい数値で指定してください。");
  }

  const type = match[2] === "水下"
    ? "underwater"
    : ["设备", "設備"].includes(match[2])
      ? "equipment"
      : "numeric";

  if (type === "equipment") {
    integer(power, "損傷対象数", 1);
  }

  return { type, value: power };
}

function normalizeScope(value) {
  const text = typeof value === "string" ? value.trim() : "";

  if (["单体", "単体"].includes(text)) {
    return { type: "unit", radius: null };
  }

  if (text === "集群") {
    return { type: "cluster", radius: null };
  }

  const match = text.match(
    /^(?:范围|範囲)\s*[:：]\s*(\d+(?:\.\d+)?)$/
  );

  if (!match) fail("攻撃範囲の表記が未対応です。");

  return {
    type: "area",
    radius: number(Number(match[1]), "攻撃半径")
  };
}

export function readCatalogWeapon(equipment) {
  if (
    !equipment ||
    equipment.kind !== "weapon" ||
    typeof equipment.id !== "string" ||
    !equipment.id.trim()
  ) {
    fail("武器の図鑑資料が不正です。");
  }

  if (
    typeof equipment.projectionSuffix !== "string" ||
    equipment.projectionSuffix.trim().toUpperCase() !== "R"
  ) {
    fail("武器の投射記号はRである必要があります。");
  }

  const groups = integer(
    equipment.projectionCoefficient,
    "硬貨の束数",
    1
  );

  const coinsPerGroup = integer(
    equipment.barrelCount,
    "束内の硬貨数",
    1
  );

  const fullAttackAmmo = groups * coinsPerGroup;

  if (!Number.isSafeInteger(fullAttackAmmo)) {
    fail("攻撃時の弾薬消費量が範囲外です。");
  }

  const guidance = normalizeGuidance(equipment.guidance);
  const power = normalizePower(equipment.powerRule);

  let penetration = null;

  if (["naval-gun", "numeric"].includes(power.type)) {
    penetration = parseArmorGrade(equipment.penetration).value;
  }

  const orderText = String(equipment.maxOrder).trim().toUpperCase();

  if (orderText !== "PAS" && !/^[1-5]$/.test(orderText)) {
    fail("最高次序は1～5またはPASで指定してください。");
  }

  const ammo = equipment.ammo === null ||
    equipment.ammo === undefined
    ? null
    : integer(equipment.ammo, "予備弾数");

  return {
    id: equipment.id,
    name: equipment.name,
    hit: {
      type: "stacks",
      groups,
      coinsPerGroup
    },
    fullAttackAmmo,
    initialAmmo: ammo,
    guidance,
    power,
    penetration,
    range: number(equipment.range, "射距"),
    ceiling: number(equipment.ceilingU, "射高"),
    maxOrder: orderText === "PAS" ? "PAS" : Number(orderText),
    scope: normalizeScope(equipment.targetScope)
  };
}
