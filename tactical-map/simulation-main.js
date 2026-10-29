import {
  drawMapAxes,
  renderEnvironmentBadge
} from "./map-display.js";

import { drawUnitIcon } from "./unit-icon-renderer.js";

import { getDisplayUnits } from "./cluster-engine.js";
import {mountSimulationRulebook, getPhaseLabel} from "./simulation-rulebook.js";
import {
  getShipDetailLines,
  getReconConditions
} from "./ship-runtime.js";




import {
  normalizeEnvironment,
  getTimePeriod,
  getWeatherInfo
} from "./environment-data.js";


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
// 只供界面读取，不修改缓存中的数据。
// 所有写入仍然通过simulation-store的方法完成。
let renderSceneCache = null;

function getRenderScene() {
  if (!renderSceneCache) {
    renderSceneCache = store.getScene();
  }

  return renderSceneCache;
}

let selectedId = "";
let draftPreview = null;
let axesVisible = false;
let terrainColorVisible = true;

const BRANCH_LABELS = {
  navy: "海軍",
  air: "航空機",
  army: "陸軍",
  special: "特殊"
};

const SIDE_LABELS = {
  ally: "味方",
  enemy: "敵",
  neutral: "中立"
};



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

let renderedTerrain = null;
let renderedTerrainColored = null;

function renderSimulationTerrain(terrain, colored) {
  if (
    renderedTerrain === terrain &&
    renderedTerrainColored === colored
  ) {
    return;
  }

  const layer = $("terrainLayer");

  // 每个方向最多约32格。
  const colStep = Math.max(
    1,
    Math.ceil((terrain.cols - 1) / 32)
  );

  const rowStep = Math.max(
    1,
    Math.ceil((terrain.rows - 1) / 32)
  );

  const paths = {
    land: [],
    sea: [],
    river: [],
    shallow: []
  };

  const colors = {
    land: "#152d2a",
    sea: "#0a2033",
    river: "#267fa1",
    shallow: "#286a71"
  };

  // 同一个网格顶点只计算一次。
  const vertices = new Map();

  function vertex(col, row) {
    const key = row * terrain.cols + col;

    if (vertices.has(key)) {
      return vertices.get(key);
    }

    const point = gridPosition(terrain, col, row);
    const sample = sampleTerrain(
      terrain,
      point.x,
      point.y
    );

    const projected = project(
      point.x,
      point.y,
      sample.surface
    );

    vertices.set(key, projected);
    return projected;
  }

  function coordinate(point) {
    return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  }

  for (
    let row = 0;
    row < terrain.rows - 1;
    row += rowStep
  ) {
    const nextRow = Math.min(
      row + rowStep,
      terrain.rows - 1
    );

    for (
      let col = 0;
      col < terrain.cols - 1;
      col += colStep
    ) {
      const nextCol = Math.min(
        col + colStep,
        terrain.cols - 1
      );

      const corners = [
        vertex(col, row),
        vertex(nextCol, row),
        vertex(nextCol, nextRow),
        vertex(col, nextRow)
      ];

      const center = gridPosition(
        terrain,
        (col + nextCol) / 2,
        (row + nextRow) / 2
      );

      const sample = sampleTerrain(
        terrain,
        center.x,
        center.y
      );

      const kind = Object.hasOwn(paths, sample.kind)
        ? sample.kind
        : "sea";

      paths[kind].push(
        `M${coordinate(corners[0])}` +
        `L${coordinate(corners[1])}` +
        `L${coordinate(corners[2])}` +
        `L${coordinate(corners[3])}Z`
      );
    }
  }

  const fragment = document.createDocumentFragment();

  for (const [kind, segments] of Object.entries(paths)) {
    if (!segments.length) continue;

    svgNode("path", {
      d: segments.join(" "),
      fill: colored ? colors[kind] : "none",
      stroke: kind === "land" ? "#2b5146" : "#173b55",
      "stroke-width": 0.5,
      "vector-effect": "non-scaling-stroke",
      "pointer-events": "none"
    }, fragment);
  }

  layer.replaceChildren(fragment);

  renderedTerrain = terrain;
  renderedTerrainColored = colored;
}


function selectUnit(id) {
  selectedId = id;

  const unit =getRenderScene().instances.find(
    item => item.instanceId === id
  );

  if (!unit) return;

  $("unitInfo").textContent = [
    unit.name,
    `色陣営：${getFactionName(unit.faction)}`,
    `作戦関係：${SIDE_LABELS[unit.side] ?? "不明"}`,
    `体型：${unit.sizeLevel}`,
    `耐性：${unit.currentHp} / ${unit.snapshot.maxHp}`,
    `位置：X ${unit.x} / Y ${unit.y}`,
    `方位：${unit.heading}°`,
    "観察専用です。自由な位置・生命・性能編集はできません。"
  ].join("\n");


  
   const scene = getRenderScene();
    if (unit.branch === "navy") {
    $("unitInfo").textContent +=
      "\n\n【艦船性能・推演状態】\n" +
      getShipDetailLines(unit, scene.environment).join("\n");
  }

  const selectedUnit = scene.instances.find(
    item => item.instanceId === selectedId
  );

  const selectedGroup = scene.groups.find(
    group => group.id === selectedUnit?.groupId
  );

  for (const element of $("unitLayer").querySelectorAll(".unit")) {
    const displayedId = element.dataset.instanceId;

    const sameUnit = displayedId === selectedId;

    const sameCluster =
      selectedGroup?.kind === "cluster" &&
      scene.instances.some(unit =>
        unit.instanceId === displayedId &&
        unit.groupId === selectedGroup.id
      );

    element.classList.toggle(
      "selected",
      sameUnit || sameCluster
    );
  }

}

function drawMap() {
  const scene = getRenderScene();
  const terrain = scene.terrain;

  const unitLayer = $("unitLayer");

  renderSimulationTerrain(
    terrain,
    terrainColorVisible
  );



  drawMapAxes(
    $("axesLayer"),
    terrain,
    axesVisible
  );

  unitLayer.replaceChildren();

  function spatialState(unit) {
    if (unit.x == null || unit.y == null) {
      return {
        valid: false,
        reason: "未配置です。"
      };
    }

    const sample = sampleTerrain(
      terrain,
      unit.x,
      unit.y
    );

    const height = unitHeight(unit, terrain);

    return {
      valid: sample.inside && Number.isFinite(height),
      height
    };
  }

  // 恢复集群合并显示。
  // 集群仍保留独立成员，代理图标不改变成员数据。
  const displayUnits = getDisplayUnits(
    scene.instances,
    scene.groups,
    terrain,
    spatialState
  );

  for (const unit of displayUnits) {
    const spatial = spatialState(unit);

    if (!spatial.valid) continue;

    const height = spatial.height;
    const position = project(unit.x, unit.y, height);
    const labelHeight = unit.labelHeight ?? 65;

    const selected =
      unit.instanceId === selectedId ||
      unit.clusterMembers?.some(
        member => member.instanceId === selectedId
      );

    const group = svgNode("g", {
      class: `unit ${unit.side}${selected ? " selected" : ""}`,
      transform: `translate(${position.x} ${position.y})`,
      tabindex: 0,
      role: "button",
      "aria-label": unit.name,
      "data-instance-id": unit.instanceId
    }, unitLayer);

    // 航空机到海平面的高度参考线。
    if (unit.branch === "air") {
      const seaPosition = project(unit.x, unit.y, 0);
      const seaOffset = seaPosition.y - position.y;

      svgNode("line", {
        x1: 0,
        y1: 0,
        x2: 0,
        y2: seaOffset,
        class: "altitude-reference"
      }, group);

      svgNode("circle", {
        cx: 0,
        cy: seaOffset,
        r: 3,
        class: "altitude-foot"
      }, group);

      const altitudeLabel = svgNode("text", {
        x: 8,
        y: seaOffset / 2,
        class: "altitude-label"
      }, group);

      altitudeLabel.textContent = `高度 ${height} u`;
    }

    // 名称定位线，与航空高度参考线分开。
    svgNode("line", {
      x1: 0,
      y1: 0,
      x2: 0,
      y2: -labelHeight,
      class: "unit-stem"
    }, group);

    // 使用自定义模式原版图标，不再另写简化多边形。
    const scale = drawUnitIcon(unit, group);

    svgNode("circle", {
      cx: 0,
      cy: -labelHeight,
      r: 2,
      class: "unit-dot"
    }, group);

    const label = svgNode("text", {
      x: 7,
      y: -labelHeight + 4
    }, group);

    label.textContent = unit.name;

    svgNode("circle", {
      cx: 0,
      cy: 0,
      r: 17 * scale,
      class: "hit-area"
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
  const terrain = getRenderScene().terrain;
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
  for (const unit of getRenderScene().instances) {
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
  const scene = getRenderScene();

  control.replaceChildren(new Option("選択してください", ""));

  const buckets = new Map();

  function addOption(category, label, ref) {
    if (!buckets.has(category)) {
      const group = document.createElement("optgroup");
      group.label = category;
      buckets.set(category, group);
      control.append(group);
    }

    buckets.get(category).append(new Option(
      label,
      JSON.stringify(ref)
    ));
  }

  for (const branch of Object.keys(BRANCH_LABELS)) {
    for (const side of Object.keys(SIDE_LABELS)) {
      for (const unit of scene.instances.filter(item =>
        item.branch === branch && item.side === side
      )) {
        addOption(
          `${BRANCH_LABELS[branch]} / ${SIDE_LABELS[side]}`,
          `${unit.name} · ${unit.instanceId.slice(-6)}`,
          { kind: "unit", id: unit.instanceId }
        );
      }
    }
  }

  for (const group of scene.groups) {
    let entity;

    try {
      entity = resolveEntity(scene, {
        kind: "group",
        id: group.id
      });
    } catch {
      continue;
    }

    const branches = new Set(
      entity.members.map(unit => unit.branch)
    );

    const sides = new Set(
      entity.members.map(unit => unit.side)
    );

    const branchText = branches.size === 1
      ? BRANCH_LABELS[[...branches][0]] ?? "特殊"
      : "混合軍種";

    const sideText = sides.size === 1
      ? SIDE_LABELS[[...sides][0]] ?? "不明"
      : "混合作戦関係";

    addOption(
      group.kind === "cluster" ? "集群" : "編隊",
      `${group.name}（${entity.members.length}）` +
      ` / ${branchText} / ${sideText}`,
      entity.ref
    );
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

function renderUnitList() {
  const scene = getRenderScene();
  const branchFilter = $("branchFilter").value;
  const sideFilter = $("sideFilter").value;

  const filtered = scene.instances.filter(unit =>
    (!branchFilter || unit.branch === branchFilter) &&
    (!sideFilter || unit.side === sideFilter)
  );

  $("units").replaceChildren();

  $("unitCount").textContent =
    `表示 ${filtered.length} / 全 ${scene.instances.length} 個体`;

  for (const branch of Object.keys(BRANCH_LABELS)) {
    const branchMembers = filtered.filter(
      unit => unit.branch === branch
    );

    if (!branchMembers.length) continue;

    const branchSection = node("details");
    branchSection.open = true;

    branchSection.append(node(
      "summary",
      `${BRANCH_LABELS[branch]}（${branchMembers.length}）`
    ));

    for (const side of Object.keys(SIDE_LABELS)) {
      const members = branchMembers.filter(
        unit => unit.side === side
      );

      if (!members.length) continue;

      const sideSection = node("details");
      sideSection.open = true;

      sideSection.append(node(
        "summary",
        `${SIDE_LABELS[side]}（${members.length}）`
      ));

      for (const unit of members) {
        const entry = button(
          `${unit.name} / 体型 ${unit.sizeLevel}` +
          ` / 耐性 ${unit.currentHp}`,
          () => selectUnit(unit.instanceId)
        );

        entry.className = "unit-entry";
        sideSection.append(entry);
      }

      branchSection.append(sideSection);
    }

    $("units").append(branchSection);
  }
}

function renderEnvironment(scene) {
  const environment = normalizeEnvironment(scene.environment);
  const recon = getReconConditions(environment);

  renderEnvironmentBadge(
    $("environmentBadge"),
    environment
  );

  $("environmentInfo").textContent = [
    `シナリオ時刻：${environment.time} / ${recon.period.label}`,
    `天候：${recon.weather.label} / ${recon.weather.levelLabel}`,
    "時刻と天候は自定義シナリオから継承しています。",
    "",
    `偵察距離の時刻補正：−${recon.timePenalty}`,
    `偵察距離の天候補正：−${recon.weatherPenalty}`,
    `通常偵察距離の上限：${recon.normalRange}`,
    `近距離識別：${recon.identificationRange}以下`,
    "発見には等級条件と地形遮蔽の判定も必要です。",
    "現時点ではマップの表示制限には適用していません。"
  ].join("\n");

  $("turnInfo").textContent = [
    `ラウンド：${scene.turn?.number ?? 1}`,
    `段階：${getPhaseLabel(scene.turn?.phaseId ?? "start")}（処理ルール実装中）`,
    "1ラウンド：30分"
  ].join("\n");
}


$("branchFilter").addEventListener("change", safely(renderUnitList));
$("sideFilter").addEventListener("change", safely(renderUnitList));

$("axesToggle").addEventListener("click", safely(() => {
  axesVisible = !axesVisible;

  $("axesToggle").textContent = axesVisible
    ? "XYZ 軸を非表示"
    : "XYZ 軸を表示";

  $("axesToggle").setAttribute(
    "aria-pressed",
    String(axesVisible)
  );

  drawMap();
}));

$("colorToggle").addEventListener("click", safely(() => {
  terrainColorVisible = !terrainColorVisible;

  $("colorToggle").textContent = terrainColorVisible
    ? "地形着色を非表示"
    : "地形着色を表示";

  $("colorToggle").setAttribute(
    "aria-pressed",
    String(terrainColorVisible)
  );

  drawMap();
}));


function refresh() {
  const scene = getRenderScene();

  $("title").textContent = `${scene.name} / 推演モード`;

    renderUnitList();
  renderEnvironment(scene);

  $("members").replaceChildren();

  for (const unit of scene.instances) {
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
  mountSimulationRulebook(store);
    store.subscribe(() => {
    renderSceneCache = null;
    refresh();
  });


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
