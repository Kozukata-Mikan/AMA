export const FORMATION_EMBLEMS = [["queen","♛ 后"],["knight","♞ 馬"],["rook","♜ 車"],["bishop","♝ 主教"]];
export function normalizeFormationEmblem(value = "knight") {
  if (!FORMATION_EMBLEMS.some(([key])=>key===value)) throw new Error("分艦隊徽章の指定が不正です。");
  return value;
}
export function formationEmblemGlyph(value = "knight") {
  return FORMATION_EMBLEMS.find(([key])=>key===value)?.[1].split(" ")[0] ?? "♞";
}

// ===== 旗舰显示 =====
// 仅生成显示名称，不修改原始舰名或任何身份字段。

export function getFlagshipMarks(unit) {
  if (!unit) return "";

  // 集群合并显示时检查所有真实成员，
  // 不依赖代理从第一个成员继承的字段。
  const members = Array.isArray(unit.clusterMembers)
    ? unit.clusterMembers
    : [unit];

  const ships = members.filter(
    member => member.branch === "navy"
  );

  const marks = [];

  if (ships.some(member => member.isOverallFlagship === true)) {
    marks.push("👑");
  }

  if (ships.some(member => member.isFormationFlagship === true)) {
    const flagship = ships.find(member => member.isFormationFlagship === true);
    marks.push(formationEmblemGlyph(flagship.formationEmblem));
  }

  return marks.join(" ");
}

export function getFlagshipDisplayName(unit) {
  if (!unit) return "";

  const marks = getFlagshipMarks(unit);

  return marks
    ? `${marks} ${unit.name}`
    : unit.name;
}
