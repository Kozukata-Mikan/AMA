// 装甲与穿深的确定性比较。
// 不掷硬币，不造成伤害，不修改场景。

const GRADES = ["F", "E", "D", "C", "B", "A", "S", "U"];

const SUFFIX_OFFSETS = new Map([
  ["--", -2],
  ["-", -1],
  ["", 0],
  ["+", 1],
  ["++", 2]
]);

export const PENETRATION_LABELS = Object.freeze({
  major: "大貫通",
  penetration: "貫通",
  normal: "通常命中",
  shatter: "破砕"
});

export function readArmorGrade(value) {
  if (typeof value !== "string") {
    throw new Error("装甲・貫通等級は文字列で指定してください。");
  }

  // 兼容文本中不同的减号表记。
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[−–—－]/g, "-");

    const match = /^([FEDCBASU])(\+\+|\+|--|-)?$/
    .exec(normalized);

  if (!match || !GRADES.includes(match[1])) {
    throw new Error("装甲・貫通等級の表記に対応していません。");
  }

  const grade = match[1];
  const suffix = match[2] ?? "";

  // U的其他阶只用于解释阶序，不接受图鉴显示为U++等。
  if (grade === "U" && suffix !== "") {
    throw new Error("U級は「U」と登録してください。");
  }

  return {
    label: normalized,
    grade,
    suffix,
    // 以F本阶为0；每级占5阶，U使用其隐藏本阶。
    rank: GRADES.indexOf(grade) * 5 +
      SUFFIX_OFFSETS.get(suffix)
  };
}

export function compareArmorGrades(
  penetrationValue,
  armorValue
) {
  const penetration = readArmorGrade(penetrationValue);
  const armor = readArmorGrade(armorValue);
  const difference = penetration.rank - armor.rank;

  let category;

  if (difference > 10) {
    category = "major";
  } else if (difference > 0) {
    category = "penetration";
  } else if (difference >= -10) {
    category = "normal";
  } else {
    category = "shatter";
  }

  return {
    penetration,
    armor,
    difference,
    category,
    label: PENETRATION_LABELS[category]
  };
}

// 只说明随机处理前的基础比较，不当作最终伤害。
export function getArmorPreview({
  penetration,
  armor,
  powerRule
}) {
  const power = typeof powerRule === "string"
    ? powerRule.trim()
    : "";

  const underwater = /[（(]\s*水下\s*[）)]/.test(power);
  const equipment = /[（(]\s*(设备|設備)\s*[）)]/.test(power);

  if (underwater) {
    return [
      "水下威力：装甲を無視します。",
      "残存する強度防御があれば、威力を1に固定します。",
      "強度消費と浸水判定は正式な結算時に処理します。"
    ];
  }

  if (equipment) {
    return [
      "設備への攻撃：装甲を無視し、耐性を直接減らしません。",
      "設備・偵察機能・空き枠の抽選は正式な結算時に処理します。"
    ];
  }

  // "-"明确表示穿深0，而非资料缺失。
  // 此处不擅自把数值0改写为某个装甲等阶。
  if (typeof penetration === "string" &&
      penetration.trim() === "-") {
    return [
      "貫通値「-」は0として扱います。未登録ではありません。",
      "この等級比較プレビューでは、数値0を装甲等級に変換しません。",
      "最終被害はまだ計算していません。"
    ];
  }

  const result = compareArmorGrades(penetration, armor);

  return [
    `貫通：${result.penetration.label}`,
    `判定用装甲：${result.armor.label}`,
    `階差：${result.difference}`,
    `基本比較：${result.label}`,
    "艦砲ルールでは、この比較だけで最終被害は決まりません。",
    "進失・水中命中・命中部位・通常命中の累積は未判定です。"
  ];
}
