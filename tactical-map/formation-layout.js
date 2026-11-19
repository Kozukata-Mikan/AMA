import { getFlagshipMarks, normalizeFormationEmblem } from "./flagship-display.js?v=fleet-cohesion-6";
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
export function formationEditingDraft(members, formation, actual = false) {
  const reference = formationReference(members);
  const heading = Number(reference.heading) || 0;
  const center = formationCenter(members, formation);
  const memberIds = new Set(members.map(unit=>unit.instanceId));
  const positions = (!actual && formation?.positions.filter(point=>memberIds.has(point.id))) || members.map(unit => ({
    id: unit.instanceId, x: unit.x - center.x, y: unit.y - center.y,
  }));
  return {version: 2, overview: formation?.overview ?? true, heading,
    positions: positions.map(point => ({id: point.id, ...rotateFormationPoint(
      formation && !actual ? formationOffset(point, formation) : point, -heading)}))};
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
    ...(value.membersOnly === true ? {membersOnly:true} : {}),
    ...(value.emblem === undefined ? {} : {emblem:normalizeFormationEmblem(value.emblem)}),
    ...(value.version === 2 ? {heading: ((value.heading % 360) + 360) % 360} : {}) };
}

export function validateFormationMembers(members, formation) {
  if (
    !members.length ||
    members.some(
      (unit) => unit.branch !== "navy" || unit.side !== members[0].side,
    ) ||
    !formation.positions.length ||
    (formation.membersOnly !== true && formation.positions.length !== members.length) ||
    formation.positions.some(point=>!members.some(unit=>unit.instanceId===point.id))
  ) {
    throw new Error(
      "同じ陣営の全艦を陣形に含めてください。編隊構成を再読込してください。",
    );
  }
}

export function formationParticipants(scene, id) {
  const members = formationMembers(scene,id);
  const formation = scene.groups.find(group=>group.id===id)?.formation;
  if (!formation?.membersOnly) return members;
  const ids = new Set(formation.positions.map(point=>point.id));
  return members.filter(unit=>ids.has(unit.instanceId));
}
export function formationCircleMembers(scene,id) {
  return formationViews(scene).find(view=>view.group.id===id)?.members ?? [];
}
export function formationMovementMembers(scene,id) {
  const group = scene.groups.find(item=>item.id===id);
  return group?.formation?.overview ? formationCircleMembers(scene,id) : formationParticipants(scene,id);
}
export function formationSide(members) {
  const sides = new Set(members.map(unit=>unit.side));
  return sides.size === 1 ? [...sides][0] : sides.size ? "mixed" : "empty";
}
export const FORMATION_SIDE_COLORS = {ally:"#83dcff",enemy:"#ff9b65",neutral:"#b7bdcf",mixed:"#c9b6ed",empty:"#b7bdcf"};

export function formationViews(scene) {
  const views = [];
  const claimed = new Set();
  // Prefer the parent squadron when nested groups both request an overview.
  for (const group of scene.groups
    .filter((item) => item.formation?.overview && !item.parentId)
    .concat(
      scene.groups.filter((item) => item.formation?.overview && item.parentId),
    )) {
    let members = formationParticipants(scene, group.id).filter(
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
    members = members.filter(unit=>Math.hypot(unit.x-center.x, unit.y-center.y) <= FORMATION_RADIUS + 1e-7);
    if (!members.length) continue;
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
    const side = formationSide(members), color = FORMATION_SIDE_COLORS[side];
    root.setAttribute("class", `formation-overview ${side}`);
    root.setAttribute("data-side", side);
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
    circle.setAttribute("fill", `${color}1a`);
    circle.setAttribute("stroke", color);
    circle.setAttribute("vector-effect", "non-scaling-stroke");
    circle.style.pointerEvents = "none";
    const text = document.createElementNS(ns, "text");
    const p = project(center.x, center.y - FORMATION_RADIUS, 0);
    text.setAttribute("x", p.x);
    text.setAttribute("y", p.y - 8);
    text.setAttribute("fill", color);
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
  const height = unit.labelHeight ?? 65;
  const leader = document.createElementNS("http://www.w3.org/2000/svg", "line");
  for (const [key,value] of Object.entries({x1:0,y1:0,x2:0,y2:-height,stroke:"currentColor","stroke-width":1,"vector-effect":"non-scaling-stroke","pointer-events":"none",class:"formation-flagship-leader"})) leader.setAttribute(key,value);
  root.append(leader);
  const badge = document.createElementNS("http://www.w3.org/2000/svg", "text");
  badge.setAttribute("class", "formation-flagship-mark");
  badge.setAttribute("x", "7"); badge.setAttribute("y", String(-height + 4));
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
