import {
  openSimulation,
  resolveEntity
} from "./simulation-store.js";

import {
  gridPosition,
  sampleTerrain
} from "./terrain-data.js";

import { getFactionName } from "../js/faction-data.js";

// ===== 推演页面 =====
// 不挂载 mountEditor、mountTerrainEditor 或 mountUnitDeployment。

const $ = id => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";

let store = null;
let selectedId = "";
let draftPreview = null;

const svg = $("map");
const viewport = $("viewport");
const view = { x: 0, y: 0, scale: 1 };

function node(tag, text = "") {
  const result = document.createElement(tag);
  result.textContent = text;
  return result;
}

function svgNode(tag, attrs, parent) {
  const result = document.createElementNS(NS, tag);

  for (const [key, value] of Object.entries(attrs)) {
    result.setAttribute(key, value);
  }

  parent.append(result);

  return result;
}

function show(text, error = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
}

function safely(action) {
  return () => {
    try {
      if (!store) {
        throw new Error("推演データを読み込めていません。");
      }

      action();
    } catch (error) {
      console.error(error);
      show(error.message, true);
    }
  };
}

function button(text, action) {
  const result = node("button", text);
  result.type = "button";
  result.addEventListener("click", safely(action));
  return result;
}

function project(x, y, z = 0) {
  return {
    x: 500 + (x - y) * 0.95,
    y: 340 + (x + y) * 0.43 - z * 0.75
  };
}

function pointsText(points) {
  return points.map(point => `${point.x},${point.y}`).join(" ");
}

function unitHeight(unit, terrain) {
  const sample = sampleTerrain(terrain, unit.x, unit.y);

  if (unit.branch === "air") {
    return unit.altitude ?? 80;
  }

  if (unit.branch === "navy" && unit.underwater) {
    return -(unit.depth ?? 12);
  }

  if (unit.branch === "special") {
    return unit.altitude ?? sample.surface;
  }

  return sample.surface;
}

function relationColor(side) {
  return {
    ally: "#75cfff",
    enemy: "#ff8d68",
    neutral: "#c1c8d0"
  }[side] ?? "#c1c8d0";
}

function selectUnit(id) {
  selectedId = id;

  const unit = store.getScene().instances.find(
    item => item.instanceId === id
  );

  if (!unit) return;

  $("unitInfo").textContent = [
    unit.name,
    `色陣営：${getFactionName(unit.faction)}`,
    `作戦関係：${unit.side}`,
    `体型：${unit.sizeLevel}`,
    `耐性：${unit.currentHp} / ${unit.snapshot.maxHp}`,
    `位置：X ${unit.x} / Y ${unit.y}`,
    `方位：${unit.heading}°`,
    "観察専用です。自由な位置・生命・性能編集はできません。"
  ].join("\n");

  drawMap();
}

function drawMap() {
  const scene = store.getScene();
  const terrain = scene.terrain;

  $("terrainLayer").replaceChildren();
  $("unitLayer").replaceChildren();

  // 简化的投影网格地形，不复用原编辑器的事件。
  // 大网格采样绘制，控制观察页 DOM 数量。
  const stride = Math.max(
    1,
    Math.ceil(Math.max(terrain.rows, terrain.cols) / 45)
  );

  for (let row = 0; row < terrain.rows - 1; row += stride) {
    for (let col = 0; col < terrain.cols - 1; col += stride) {
      const nextRow = Math.min(row + stride, terrain.rows - 1);
      const nextCol = Math.min(col + stride, terrain.cols - 1);

      const corners = [
        [col, row],
        [nextCol, row],
        [nextCol, nextRow],
        [col, nextRow]
      ].map(([c, r]) => {
        const point = gridPosition(terrain, c, r);
        const sample = sampleTerrain(terrain, point.x, point.y);

        return {
          ...project(point.x, point.y, sample.surface),
          kind: sample.kind
        };
      });

      const land = corners.some(point => point.kind === "land");

      svgNode("polygon", {
        points: pointsText(corners),
        fill: land ? "#152d2a" : "#0a2033",
        stroke: land ? "#2b5146" : "#173b55",
        "stroke-width": 0.5
      }, $("terrainLayer"));
    }
  }

  for (const unit of scene.instances) {
    const height = unitHeight(unit, terrain);
    const position = project(unit.x, unit.y, height);
    const color = relationColor(unit.side);

    const group = svgNode("g", {
      tabindex: 0,
      role: "button",
      "aria-label": unit.name,
      style: "cursor:pointer"
    }, $("unitLayer"));

    const level = Math.max(1, Math.min(5, unit.sizeLevel));
    const scale = 0.5 * [1, 1.75, 2.5, 3.25, 4][level - 1];

    let localPoints;

    if (unit.branch === "navy") {
      const stern = -12 + 24 * [1, 1.5, 2, 2.5, 3][level - 1];

      localPoints = [
        [0, -12], [8, -4], [8, stern],
        [-8, stern], [-8, -4]
      ];
    } else if (unit.branch === "air") {
      const angle = [15, 30, 90, 120, 150][level - 1];
      const width = 2 * Math.tan(angle * Math.PI / 360);
      const factor = 24 / Math.max(1, width);

      localPoints = [
        [0, -factor / 2],
        [width * factor / 2, factor / 2],
        [-width * factor / 2, factor / 2]
      ];
    } else if (unit.branch === "army") {
      localPoints = [
        [-12, -12], [12, -12], [12, 12], [-12, 12]
      ];
    } else {
      localPoints = [[0, -12], [10, 0], [0, 12], [-10, 0]];
    }

    const iconScale = unit.branch === "navy" ? 0.5 : scale;
    const angle = unit.heading * Math.PI / 180;

    const iconPoints = localPoints.map(([x, y]) => {
      const sx = x * iconScale;
      const sy = y * iconScale;

      return project(
        unit.x + sx * Math.cos(angle) - sy * Math.sin(angle),
        unit.y + sx * Math.sin(angle) + sy * Math.cos(angle),
        height
      );
    });

    svgNode("polygon", {
      points: pointsText(iconPoints),
      fill: unit.filled ? color : "#09121e",
      stroke: color,
      "stroke-width": selectedId === unit.instanceId ? 2.5 : 1.2,
      "stroke-dasharray": unit.underwater ? "3 2" : ""
    }, group);

    const labelHeight = unit.labelHeight ?? 65;

    svgNode("line", {
      x1: position.x,
      y1: position.y,
      x2: position.x,
      y2: position.y - labelHeight,
      stroke: color,
      "stroke-width": 0.7
    }, group);

    const label = svgNode("text", {
      x: position.x + 5,
      y: position.y - labelHeight,
      fill: color
    }, group);

    label.textContent = unit.name;

    svgNode("circle", {
      cx: position.x,
      cy: position.y,
      r: 12,
      fill: "transparent"
    }, group);

    group.addEventListener("click", () => {
      selectUnit(unit.instanceId);
    });

    group.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectUnit(unit.instanceId);
      }
    });
  }
}

function updateView() {
  viewport.setAttribute(
    "transform",
    `translate(${view.x} ${view.y}) scale(${view.scale})`
  );
}

function fitMap() {
  const terrain = store.getScene().terrain;
  let highest = 0;

  for (const height of terrain.heights) {
    highest = Math.max(highest, height);
  }

  const points = [];

  for (const x of [-terrain.width / 2, terrain.width / 2]) {
    for (const y of [-terrain.height / 2, terrain.height / 2]) {
      points.push(project(x, y, 0));
      points.push(project(x, y, highest));
    }
  }

  // 同时考虑空中和水下单位，避免初始视角将其裁掉。
  for (const unit of store.getScene().instances) {
    const p = project(unit.x, unit.y, unitHeight(unit, terrain));
    points.push(p, { x: p.x, y: p.y - (unit.labelHeight ?? 65) });
  }

  const minX = Math.min(...points.map(p => p.x));
  const maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y));
  const maxY = Math.max(...points.map(p => p.y));

  view.scale = Math.max(0.01, Math.min(
    8,
    900 / Math.max(1, maxX - minX),
    550 / Math.max(1, maxY - minY)
  ));

  view.x = 500 - (minX + maxX) / 2 * view.scale;
  view.y = 325 - (minY + maxY) / 2 * view.scale;

  updateView();
}

function refillEntities(id) {
  const control = $(id);
  const previous = control.value;

  control.replaceChildren(new Option("選択してください", ""));

  for (const entity of store.getEntities()) {
    control.append(new Option(
      entity.label,
      JSON.stringify(entity.ref)
    ));
  }

  if ([...control.options].some(option =>
    option.value === previous
  )) {
    control.value = previous;
  }
}

function requestFromForm() {
  if (!$("attacker").value || !$("target").value) {
    throw new Error("行動側と目標側を選択してください。");
  }

  return {
    attacker: JSON.parse($("attacker").value),
    target: JSON.parse($("target").value),
    actionType: $("actionType").value,
    note: $("note").value
  };
}

function actorText(actor) {
  return [
    `${actor.name}（${actor.members.length} 個体）`,
    ...actor.members.map(unit =>
      `・${unit.name} / 耐性 ${unit.currentHp}` +
      ` / X ${unit.x}, Y ${unit.y}`
    )
  ].join("\n");
}

function invalidatePreview() {
  draftPreview = null;
  $("preview").textContent = "";
}

function renderHistory(scene) {
  $("history").replaceChildren();

  $("history").append(node(
    "p",
    `草案記録：${scene.actions.length} 件`
  ));

  for (const record of scene.actions.slice(-30).reverse()) {
    const details = node("details");

    details.append(node(
      "summary",
      `${record.actionType}：` +
      `${record.attacker.name} → ${record.target.name}`
    ));

    const text = node("p", [
      `日時：${new Date(record.createdAt).toLocaleString()}`,
      "状態：草案 / 未実行",
      "",
      "【行動側】",
      actorText(record.attacker),
      "",
      "【目標側】",
      actorText(record.target),
      "",
      `メモ：${record.note}`,
      `裁定：${record.ruling.reason}`
    ].join("\n"));

    text.className = "note";

    details.append(text);
    $("history").append(details);
  }
}

function renderGroups(scene) {
  $("groups").replaceChildren();

  for (const group of scene.groups) {
    const card = node("details");
    let count = 0;

    try {
      count = resolveEntity(scene, {
        kind: "group",
        id: group.id
      }).members.length;
    } catch {
      // 空编队显示为0。
    }

    card.append(node(
      "summary",
      `${group.name} / ` +
      `${group.kind === "cluster" ? "集群" : "編隊"} / ${count} 個体`
    ));

    try {
      const entity = resolveEntity(scene, {
        kind: "group",
        id: group.id
      });

      const names = node("p",
        entity.members.map(unit => unit.name).join("\n")
      );

      names.className = "note";
      card.append(names);
    } catch {
      card.append(node("p", "メンバーなし"));
    }

    card.append(
      button("名称変更", () => {
        const name = prompt("編隊名", group.name);

        if (name === null) return;

        store.renameGroup(group.id, name);
        show("編隊名を変更しました。");
      }),

      button("編隊を解除", () => {
        if (!confirm(
          `「${group.name}」を解除しますか？個体は削除されません。`
        )) return;

        store.dissolveGroup(group.id);
        show("編隊を解除しました。個体は保持されています。");
      })
    );

    $("groups").append(card);
  }
}

function refresh() {
  const scene = store.getScene();

  $("title").textContent = `${scene.name} / 推演モード`;

  $("units").replaceChildren();
  $("members").replaceChildren();

  for (const unit of scene.instances) {
    const entry = button(
      `${unit.name} / 体型 ${unit.sizeLevel}` +
      ` / 耐性 ${unit.currentHp}`,
      () => selectUnit(unit.instanceId)
    );

    entry.className = "unit-entry";
    $("units").append(entry);

    const label = node("label");
    label.className = "member-entry";

    const check = node("input");
    check.type = "checkbox";
    check.value = unit.instanceId;

    label.append(check, node("span", unit.name));
    $("members").append(label);
  }

  refillEntities("attacker");
  refillEntities("target");

  invalidatePreview();
  renderGroups(scene);
  renderHistory(scene);
  drawMap();
}

$("createGroup").addEventListener("click", safely(() => {
  const memberIds = [...$("members").querySelectorAll(
    "input:checked"
  )].map(control => control.value);

  if (!memberIds.length) {
    throw new Error("メンバーを選択してください。");
  }

  if (!confirm(
    "選択した個体を新しい編隊へ移しますか？" +
    "現在の所属から外れるため、元の集群表示が解除される場合があります。"
  )) return;

  store.createGroup({
    name: $("groupName").value,
    kind: $("groupKind").value,
    memberIds
  });

  show("編隊を作成しました。生命と位置は変更していません。");
}));

$("previewAction").addEventListener("click", safely(() => {
  const request = requestFromForm();
  const preview = store.previewDraft(request);

  draftPreview = {
    requestKey: JSON.stringify(request),
    revision: preview.revision
  };

  $("preview").textContent = [
    "【行動側】",
    actorText(preview.attacker),
    "",
    "【目標側】",
    actorText(preview.target),
    "",
    preview.ruling.reason,
    "草案として保存できますが、参戦状態は変化しません。"
  ].join("\n");

  show("草案をプレビューしました。実行可否の裁定ではありません。");
}));

$("saveDraft").addEventListener("click", safely(() => {
  const request = requestFromForm();

  if (
    !draftPreview ||
    draftPreview.requestKey !== JSON.stringify(request)
  ) {
    throw new Error("現在の内容を先にプレビューしてください。");
  }

  store.saveDraft(request, draftPreview.revision);

  $("note").value = "";
  show("草案を保存しました。生命・位置・行動回数は変更していません。");
}));

for (const id of ["attacker", "target", "actionType", "note"]) {
  $(id).addEventListener("input", invalidatePreview);
  $(id).addEventListener("change", invalidatePreview);
}

$("back").addEventListener("click", () => {
  // 回到独立的自定义页面，不把推演状态写回编辑器。
  location.href = new URL("./index.html", import.meta.url).href;
});

$("fit").addEventListener("click", safely(fitMap));

$("export").addEventListener("click", safely(() => {
  const blob = new Blob(
    [store.exportJSON()],
    { type: "application/json;charset=utf-8" }
  );

  const url = URL.createObjectURL(blob);
  const link = node("a");

  link.href = url;
  link.download = "推演データ.json";

  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}));

function screenPoint(event) {
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;

  return point.matrixTransform(svg.getScreenCTM().inverse());
}

// 只有观察视角移动，没有单位拖放。
svg.addEventListener("wheel", event => {
  event.preventDefault();

  const point = screenPoint(event);
  const oldScale = view.scale;

  const nextScale = Math.max(
    0.01,
    Math.min(8, oldScale * (event.deltaY < 0 ? 1.1 : 1 / 1.1))
  );

  const ratio = nextScale / oldScale;

  view.x = point.x - (point.x - view.x) * ratio;
  view.y = point.y - (point.y - view.y) * ratio;
  view.scale = nextScale;

  updateView();
}, { passive: false });

let drag = null;

svg.addEventListener("pointerdown", event => {
  if (event.button !== 0 || event.target.closest('[role="button"]')) {
    return;
  }

  const point = screenPoint(event);

  drag = {
    id: event.pointerId,
    x: point.x,
    y: point.y,
    viewX: view.x,
    viewY: view.y
  };

  svg.setPointerCapture(event.pointerId);
});

svg.addEventListener("pointermove", event => {
  if (!drag || drag.id !== event.pointerId) return;

  const point = screenPoint(event);

  view.x = drag.viewX + point.x - drag.x;
  view.y = drag.viewY + point.y - drag.y;

  updateView();
});

function endDrag(event) {
  if (!drag || drag.id !== event.pointerId) return;

  drag = null;

  if (svg.hasPointerCapture(event.pointerId)) {
    svg.releasePointerCapture(event.pointerId);
  }
}

svg.addEventListener("pointerup", endDrag);
svg.addEventListener("pointercancel", endDrag);
svg.addEventListener("lostpointercapture", () => {
  drag = null;
});

try {
  const id = new URL(location.href).searchParams.get("id");

  if (!id) {
    throw new Error("自定義モードから推演を開始してください。");
  }

  store = openSimulation(id);
  store.subscribe(refresh);

  refresh();
  fitMap();

  show(
    "推演框架モードです。自由な追加・削除・地形編集は禁止されています。\n" +
    "ルール未登録のため、編隊操作と行動草案の記録だけが可能です。"
  );
} catch (error) {
  console.error(error);
  show(error.message, true);
}
