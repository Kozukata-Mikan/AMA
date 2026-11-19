import { getFlagshipMarks } from "./flagship-display.js";
export const FORMATION_RADIUS = 25;
export function formationReference(members) {
  return members.find((unit) => unit.isFormationFlagship) ?? members[0];
}

export function rotateFormationPoint(point, heading) {
  const angle = heading * Math.PI / 180;
  return {x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
    y: point.x * Math.sin(angle) + point.y * Math.cos(angle)};
}

export function formationOffset(point, formation) {
  return rotateFormationPoint(point, formation?.version === 2 ? formation.heading : 0);
}

// Legacy v1 positions are map-relative. Convert only the editing draft, keeping
// their world placement and the stored original untouched until Apply.
export function formationEditingDraft(members, formation) {
  const reference = formationReference(members);
  const heading = Number(reference.heading) || 0;
  const center = formationCenter(members, formation);
  const positions = formation?.positions ?? members.map(unit => ({
    id: unit.instanceId, x: unit.x - center.x, y: unit.y - center.y,
  }));
  return {version: 2, overview: formation?.overview ?? true, heading,
    positions: positions.map(point => ({id: point.id, ...rotateFormationPoint(
      formation ? formationOffset(point, formation) : point, -heading)}))};
}

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
  const anchor = formationReference(members);
  const offset = formation?.positions.find(
    (point) => point.id === anchor.instanceId,
  );
  const world = offset ? formationOffset(offset, formation) : {x: 0, y: 0};
  return { x: anchor.x - world.x, y: anchor.y - world.y };
}

export function normalizeFormation(value) {
  if (value === undefined) return undefined;
  if (
    !value ||
    ![1, 2].includes(value.version) ||
    typeof value.overview !== "boolean" ||
    !Array.isArray(value.positions)
  ) {
    throw new Error("編隊陣形の保存形式が不正です。");
  }
  if (value.version === 2 && !Number.isFinite(value.heading))
    throw new Error("陣形の基準艦艏方位が不正です。");
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
      throw new Error("陣形は直径50マスの円内に配置してください。");
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
  return { version: value.version, overview: value.overview, positions,
    ...(value.version === 2 ? {heading: ((value.heading % 360) + 360) % 360} : {}) };
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
        center.x + FORMATION_RADIUS * Math.cos(angle),
        center.y + FORMATION_RADIUS * Math.sin(angle),
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
    const p = project(center.x, center.y - FORMATION_RADIUS, 0);
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

export function compactFormationIcon(root, unit) {
  for (const node of root.querySelectorAll("text,.unit-stem,.unit-dot"))
    node.style.display = "none";
  const marks = getFlagshipMarks(unit);
  if (!marks) return;
  const badge = document.createElementNS("http://www.w3.org/2000/svg", "text");
  badge.setAttribute("class", "formation-flagship-mark");
  badge.setAttribute("x", "7"); badge.setAttribute("y", "-7");
  badge.setAttribute("fill", "#ffd27b");
  badge.setAttribute("font-size", "11");
  badge.setAttribute("stroke", "#07131f");
  badge.setAttribute("stroke-width", "2");
  badge.setAttribute("paint-order", "stroke");
  badge.setAttribute("pointer-events", "none");
  badge.setAttribute("role", "img");
  badge.setAttribute("aria-label", [unit.isOverallFlagship ? "総旗艦" : "", unit.isFormationFlagship ? "分旗艦" : ""].filter(Boolean).join(" / "));
  badge.textContent = marks;
  root.append(badge);
}
