export const FORMATION_RADIUS = 12.5;
export const FORMATION_ICON_SCALE = 0.45;

export function formationMembers(scene, id) {
  const ids = new Set([id]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const group of scene.groups) {
      if (ids.has(group.parentId) && !ids.has(group.id)) {
        ids.add(group.id);
        changed = true;
      }
    }
  }
  return scene.instances.filter((unit) => ids.has(unit.groupId));
}

export function formationCenter(members, formation) {
  if (
    !members.length ||
    members.some((unit) => !Number.isFinite(unit.x) || !Number.isFinite(unit.y))
  ) {
    throw new Error("編隊の全艦を地図に配置してください。");
  }
  const anchor = members.find((unit) => unit.isFormationFlagship) ?? members[0];
  const offset = formation?.positions.find(
    (point) => point.id === anchor.instanceId,
  );
  return { x: anchor.x - (offset?.x ?? 0), y: anchor.y - (offset?.y ?? 0) };
}

export function normalizeFormation(value) {
  if (value === undefined) return undefined;
  if (
    !value ||
    value.version !== 1 ||
    typeof value.overview !== "boolean" ||
    !Array.isArray(value.positions)
  ) {
    throw new Error("編隊陣形の保存形式が不正です。");
  }
  const ids = new Set();
  const positions = value.positions.map((point) => {
    if (
      !point ||
      typeof point.id !== "string" ||
      ids.has(point.id) ||
      !point.id.trim() ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      Math.hypot(point.x, point.y) > FORMATION_RADIUS + 1e-7
    ) {
      throw new Error("陣形は直径25マスの円内に配置してください。");
    }
    ids.add(point.id);
    return { id: point.id, x: point.x, y: point.y };
  });
  for (let i = 0; i < positions.length; i++)
    for (let j = 0; j < i; j++) {
      if (
        Math.hypot(
          positions[i].x - positions[j].x,
          positions[i].y - positions[j].y,
        ) < 1.1
      ) {
        throw new Error("艦船同士は1.1マス以上離してください。");
      }
    }
  return { version: 1, overview: value.overview, positions };
}

export function validateFormationMembers(members, formation) {
  if (
    !members.length ||
    members.some(
      (unit) => unit.branch !== "navy" || unit.side !== members[0].side,
    ) ||
    formation.positions.length !== members.length ||
    members.some(
      (unit) =>
        !formation.positions.some((point) => point.id === unit.instanceId),
    )
  ) {
    throw new Error(
      "同じ陣営の全艦を陣形に含めてください。編隊構成を再読込してください。",
    );
  }
}

export function formationViews(scene) {
  const views = [];
  const claimed = new Set();
  // Prefer the parent squadron when nested groups both request an overview.
  for (const group of scene.groups
    .filter((item) => item.formation?.overview && !item.parentId)
    .concat(
      scene.groups.filter((item) => item.formation?.overview && item.parentId),
    )) {
    const members = formationMembers(scene, group.id).filter(
      (unit) =>
        unit.branch === "navy" &&
        Number.isFinite(unit.x) &&
        Number.isFinite(unit.y) &&
        unit.observationLevel !== "shadow" &&
        !claimed.has(unit.instanceId),
    );
    if (!members.length) continue;
    const center = group.observationForeign
      ? {
          x: members.reduce((sum, u) => sum + u.x, 0) / members.length,
          y: members.reduce((sum, u) => sum + u.y, 0) / members.length,
        }
      : formationCenter(members, group.formation);
    for (const unit of members) claimed.add(unit.instanceId);
    views.push({ group, members, center });
  }
  return views;
}

export function drawFormationViews(layer, scene, project, select) {
  const views = formationViews(scene);
  const compactIds = new Set();
  const ns = "http://www.w3.org/2000/svg";
  for (const { group, members, center } of views) {
    const root = document.createElementNS(ns, "g");
    root.setAttribute("class", "formation-overview");
    root.setAttribute("data-formation-id", group.id);
    const points = Array.from({ length: 49 }, (_, i) => {
      const angle = (i * Math.PI) / 24;
      const p = project(
        center.x + 12.5 * Math.cos(angle),
        center.y + 12.5 * Math.sin(angle),
        0,
      );
      return `${p.x},${p.y}`;
    });
    const circle = document.createElementNS(ns, "polygon");
    circle.setAttribute("points", points.join(" "));
    circle.setAttribute("fill", "#4fa4d51a");
    circle.setAttribute("stroke", "#80caff");
    circle.setAttribute("vector-effect", "non-scaling-stroke");
    circle.style.pointerEvents = "none";
    const text = document.createElementNS(ns, "text");
    const p = project(center.x, center.y - 12.5, 0);
    text.setAttribute("x", p.x);
    text.setAttribute("y", p.y - 8);
    text.setAttribute("fill", "#bce7ff");
    text.textContent = group.name;
    text.style.cursor = "pointer";
    text.setAttribute("role", "button");
    text.addEventListener("click", () => select?.(group.id));
    root.append(circle, text);
    layer.append(root);
    for (const member of members) compactIds.add(member.instanceId);
  }
  return compactIds;
}

export function compactFormationIcon(root) {
  for (const node of root.querySelectorAll("text,.unit-stem,.unit-dot"))
    node.style.display = "none";
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "g");
  icon.setAttribute("transform", `scale(${FORMATION_ICON_SCALE})`);
  while (root.firstChild) icon.append(root.firstChild);
  root.append(icon);
}
