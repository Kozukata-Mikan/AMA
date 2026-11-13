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
    marks.push("♞");
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
