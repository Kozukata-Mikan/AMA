import { VIEW_SCALE_MIN,  VIEW_SCALE_MAX} from "./map-settings.js";
import { loadUnitData } from "../js/data-store.js";
import { createBattleStore } from "../js/battle-state.js";
import { mountEditor } from "./editor.js";
import { mountUnitDeployment } from "./unit-deployment.js";
import { drawTerrainFaces } from "./map-display.js";


import {
  createDemoTerrain,
  gridPosition,
  sampleTerrain
} from "./terrain-data.js";

import {
  getActiveClusters,
  getDisplayUnits,
  makeClusterProxy,
  getDeploymentUpdates
} from "./cluster-engine.js";


import { mountTerrainEditor } from "./terrain-editor.js";

let terrain = createDemoTerrain();
let terrainController = null;
let axesVisible = false;
let terrainColorVisible = false;
let axesLayer = null;

let editorController = null;
let deploymentController = null;
let deploymentPreviewLayer = null;



const NS = "http://www.w3.org/2000/svg";

const svg = document.querySelector("#map");
const viewport = document.querySelector("#viewport");

const layers = {
  grid: document.querySelector("#gridLayer"),
  terrain: document.querySelector("#terrainLayer"),
  routes: document.querySelector("#routeLayer"),
  units: document.querySelector("#unitLayer")
};

function createSVG(tag, attributes = {}, parent = null) {
  const element = document.createElementNS(NS, tag);

  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }

  if (parent) parent.appendChild(element);

  return element;
}

// 固定角度の平行投影。
// x、y は地図平面上の座標、height は地形の標高を表します。
function project(x, y, height = 0) {
  return {
    x: 500 + (x - y) * 0.95,
    y: 340 + (x + y) * 0.43 - height * 0.75
  };
}

function pointText(point) {
  return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
}

function pathFromPoints(points) {
  return points
    .map((point, index) => {
      return `${index === 0 ? "M" : "L"}${pointText(point)}`;
    })
    .join(" ");
}

function terrainHeight(x, y) {
  return sampleTerrain(terrain, x, y).height;
}

function drawAxes() {
  if (!axesLayer) {
    axesLayer = createSVG("g", {
      id: "axesLayer",
      "aria-hidden": "true",
      "pointer-events": "none"
    });

    // 坐标轴跟随地图平移、缩放，单位仍绘制在它上面。
    viewport.insertBefore(axesLayer, layers.units);
  }

  axesLayer.replaceChildren();
  axesLayer.style.display = axesVisible ? "" : "none";

  if (!axesVisible) return;

  const xLength = terrain.width / 2;
  const yLength = terrain.height / 2;

  let highest = 0;

  for (const height of terrain.heights) {
    highest = Math.max(highest, height);
  }

  const zLength = Math.max(300, Math.ceil(highest / 50) * 50);

  const origin = project(0, 0, 0);

  const definitions = [
    {
      name: "X",
      className: "axis-x",
      length: xLength,
      at: value => project(value, 0, 0),
      negative: true
    },
    {
      name: "Y",
      className: "axis-y",
      length: yLength,
      at: value => project(0, value, 0),
      negative: true
    },
    {
      name: "Z",
      className: "axis-z",
      length: zLength,
      at: value => project(0, 0, value),
      negative: false
    }
  ];

  for (const axis of definitions) {
    const group = createSVG("g", {
      class: `coordinate-axis ${axis.className}`
    }, axesLayer);

    const end = axis.at(axis.length);

    createSVG("path", {
      d: pathFromPoints([origin, end]),
      class: "axis-line"
    }, group);

    if (axis.negative) {
      createSVG("path", {
        d: pathFromPoints([axis.at(-axis.length), origin]),
        class: "axis-line axis-negative"
      }, group);
    }

    // 屏幕上的小箭头，仅表达正方向。
    const angle = Math.atan2(end.y - origin.y, end.x - origin.x);

    const arrow = [
      end,
      {
        x: end.x - 9 * Math.cos(angle - 0.45),
        y: end.y - 9 * Math.sin(angle - 0.45)
      },
      {
        x: end.x - 9 * Math.cos(angle + 0.45),
        y: end.y - 9 * Math.sin(angle + 0.45)
      }
    ];

    createSVG("path", {
      d: pathFromPoints(arrow) + " Z",
      class: "axis-arrow"
    }, group);

    const title = createSVG("text", {
      x: end.x + 9,
      y: end.y - 8,
      class: "axis-label"
    }, group);

    title.textContent = `+${axis.name}`;

    // 大地图适当增大刻度间隔，避免标签过密。
    const spacing = Math.max(
      50,
      Math.ceil(axis.length / 6 / 50) * 50
    );

    const start = axis.negative ? -axis.length : 0;
    const first = Math.ceil(start / spacing) * spacing;

    for (let value = first; value <= axis.length; value += spacing) {
      if (value === 0) continue;

      const point = axis.at(value);

      createSVG("circle", {
        cx: point.x,
        cy: point.y,
        r: 2,
        class: "axis-tick"
      }, group);

      const label = createSVG("text", {
        x: point.x + 5,
        y: point.y + 12,
        class: "axis-value"
      }, group);

      label.textContent = String(value);
    }
  }

  const label = createSVG("text", {
    x: origin.x + 7,
    y: origin.y - 7,
    class: "axis-origin"
  }, axesLayer);

  label.textContent = "O (0, 0, 0)";
}


function drawGrid() {
  layers.grid.replaceChildren();

  const halfWidth = terrain.width / 2;
  const halfHeight = terrain.height / 2;
  const spacing = Math.max(30, Math.ceil(
    Math.max(terrain.width, terrain.height) / 30
  ));

  for (let x = -halfWidth; x <= halfWidth; x += spacing) {
    createSVG("path", {
      d: pathFromPoints([
        project(x, -halfHeight),
        project(x, halfHeight)
      ]),
      class: "grid-line"
    }, layers.grid);
  }

  for (let y = -halfHeight; y <= halfHeight; y += spacing) {
    createSVG("path", {
      d: pathFromPoints([
        project(-halfWidth, y),
        project(halfWidth, y)
      ]),
      class: "grid-line"
    }, layers.grid);
  }

  createSVG("path", {
    d: pathFromPoints([
      project(-halfWidth, -halfHeight),
      project(halfWidth, -halfHeight),
      project(halfWidth, halfHeight),
      project(-halfWidth, halfHeight)
    ]) + " Z",
    class: "map-boundary"
  }, layers.grid);
}


function makeHeightGrid() {
  const result = [];

  for (let row = 0; row < terrain.rows; row++) {
    const points = [];

    for (let col = 0; col < terrain.cols; col++) {
      const point = gridPosition(terrain, col, row);

      points.push({
        ...point,
        z: terrain.heights[row * terrain.cols + col]
      });
    }

    result.push(points);
  }

  return result;
}


function contourTriangle(triangle, level) {
  const intersections = [];

  for (let i = 0; i < 3; i++) {
    const a = triangle[i];
    const b = triangle[(i + 1) % 3];

    // 2つの端点は、指定した標高を挟む位置にあります。
    if ((a.z < level) !== (b.z < level)) {
      const t = (level - a.z) / (b.z - a.z);

      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;

      intersections.push(project(x, y, level));
    }
  }

  if (intersections.length !== 2) return "";

  return (
    `M${pointText(intersections[0])} ` +
    `L${pointText(intersections[1])} `
  );
}

function drawTerrain() {
  layers.terrain.replaceChildren();

  // 必须先绘制面，再绘制水域标记和等高线。
  drawTerrainFaces({
    layer: layers.terrain,
    terrain,
    colored: terrainColorVisible
  });

  const grid = makeHeightGrid();
  const dx = terrain.width / (terrain.cols - 1);
  const dy = terrain.height / (terrain.rows - 1);

  // 水域标记按最近网格顶点的区域绘制。
  function drawWaterMask(mask, kind, className) {
    if (!mask) return;

    let pathData = "";

    for (let row = 0; row < terrain.rows; row++) {
      for (let col = 0; col < terrain.cols; col++) {
        const index = row * terrain.cols + col;

        if (mask[index] !== 1) continue;

        const center = gridPosition(terrain, col, row);
        const sample = sampleTerrain(terrain, center.x, center.y);

        // 随高度变化隐藏不再适用的水域标记。
        if (sample.kind !== kind) continue;

        const corners = [
          [center.x - dx / 2, center.y - dy / 2],
          [center.x + dx / 2, center.y - dy / 2],
          [center.x + dx / 2, center.y + dy / 2],
          [center.x - dx / 2, center.y + dy / 2]
        ].map(([x, y]) => {
          const px = Math.max(
            -terrain.width / 2,
            Math.min(terrain.width / 2, x)
          );

          const py = Math.max(
            -terrain.height / 2,
            Math.min(terrain.height / 2, y)
          );

          const height = sampleTerrain(terrain, px, py).surface;
          return project(px, py, height);
        });

        pathData += pathFromPoints(corners) + " Z ";
      }
    }

    if (pathData) {
      createSVG("path", {
        d: pathData,
        class: className
      }, layers.terrain);
    }
  }

  drawWaterMask(terrain.shallows, "shallow", "shallow-surface");
  drawWaterMask(terrain.rivers, "river", "river-surface");

  let maximum = 0;

  for (const height of terrain.heights) {
    maximum = Math.max(maximum, height);
  }

  const levels = [0];

  for (
    let level = terrain.contourInterval;
    level <= maximum;
    level += terrain.contourInterval
  ) {
    levels.push(level);
  }

  for (const level of levels) {
    let pathData = "";

    for (let row = 0; row < grid.length - 1; row++) {
      for (let col = 0; col < grid[row].length - 1; col++) {
        const a = grid[row][col];
        const b = grid[row][col + 1];
        const c = grid[row + 1][col + 1];
        const d = grid[row + 1][col];

        pathData += contourTriangle([a, b, c], level);
        pathData += contourTriangle([a, c, d], level);
      }
    }

    if (!pathData) continue;

    createSVG("path", {
      d: pathData,
      class: level === 0 ? "contour coast" : "contour"
    }, layers.terrain);
  }
}


// 参战单位来自共享存储，绘制时附加原绘图代码使用的 id。
let units = [];
let unitGroups = [];

// ===== 图标规则配置 =====
// 后续调整尺寸与航空机角度，优先修改这里。
const UNIT_ICON_RULES = {
 
  displayScale: 0.5,

  
  scales: [1, 1.5, 2, 2.5, 3],

  airAngles: [15, 30, 90, 120, 150],

  
  navyLengthRatios: [1, 1.5, 2, 2.5, 3],

  baseExtent: 24,
  centerDotRadius: 1.6
};


function getSizeLevel(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 1;
  }

  return Math.max(1, Math.min(5, Math.round(number)));
}

function getIconScale(sizeLevel) {
  const level = getSizeLevel(sizeLevel);

  return (
    UNIT_ICON_RULES.displayScale *
    UNIT_ICON_RULES.scales[level - 1]
  );
}

// 海军不使用等级整体放大。
// 它的长度变化由舰船形状函数单独处理。
function getUnitScale(unit) {
  if (unit.branch === "navy") {
    return UNIT_ICON_RULES.displayScale;
  }

  return getIconScale(unit.sizeLevel);
}


// 图标的原始前方是屏幕上方。
// 将地图朝向转换为屏幕上的旋转角度。
//
// 地图朝向：
//   0度：地图 -y 方向
//  90度：地图 +x 方向
// 180度：地图 +y 方向
// 270度：地图 -x 方向
function getHeadingRotation(heading = 0) {
  const degrees = Number(heading);
  const radians =
    (Number.isFinite(degrees) ? degrees : 0) * Math.PI / 180;

  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);

  const origin = project(0, 0, 0);
  const forward = project(dx, dy, 0);

  const screenAngle = Math.atan2(
    forward.y - origin.y,
    forward.x - origin.x
  );

  return screenAngle * 180 / Math.PI + 90;
}

// 海军：5个顶点，船头为最上方的尖端。
function makeNavyPath(sizeLevel = 1) {
  const level = getSizeLevel(sizeLevel);
  const ratio = UNIT_ICON_RULES.navyLengthRatios[level - 1];

  const bowY = -12;
  const shoulderY = -4;
  const halfWidth = 8;

  const baseLength = 24;
  const sternY = bowY + baseLength * ratio;

  return [
    `M 0 ${bowY}`,
    `L ${halfWidth} ${shoulderY}`,
    `L ${halfWidth} ${sternY}`,
    `L ${-halfWidth} ${sternY}`,
    `L ${-halfWidth} ${shoulderY}`,
    "Z"
  ].join(" ");
}


// 空军：保持指定尖头角，并归一化基础外框。
// 后面的大小倍率负责统一放大。
function makeAirPath(sizeLevel) {
  const level = getSizeLevel(sizeLevel);
  const angle = UNIT_ICON_RULES.airAngles[level - 1];
  const halfAngle = angle * Math.PI / 360;

  const rawHeight = 1;
  const rawWidth = 2 * Math.tan(halfAngle);

  const factor =
    UNIT_ICON_RULES.baseExtent / Math.max(rawWidth, rawHeight);

  const height = rawHeight * factor;
  const width = rawWidth * factor;

  return [
    `M 0 ${-height / 2}`,
    `L ${width / 2} ${height / 2}`,
    `L ${-width / 2} ${height / 2}`,
    "Z"
  ].join(" ");
}

// 陆军：矩形基座，上方有3、4或5个凸块。
// 凸块所朝的一侧就是前方。
// 方框的前方与左右两侧。
// 尾部不在这里闭合，另用虚线绘制。
function makeArmyPath() {
  return "M -12 12 L -12 -12 L 12 -12 L 12 12";
}

function makeArmyLevelPath(sizeLevel = 1) {
  const level = getSizeLevel(sizeLevel);

  switch (level) {
    case 1:
      return "";

    case 2:
      return "M 0 -5 L 0 3";

    case 3:
      return "M -3 -5 L -3 3 M 3 -5 L 3 3";

    case 4:
      return (
        "M -5 -5 L -5 3 " +
        "M 0 -5 L 0 3 " +
        "M 5 -5 L 5 3"
      );

    case 5:
      return "M -5 -5 L 0 3 L 5 -5";

    default:
      return "";
  }
}


function makeSpecialPath() {
  return "M 0 -12 L 10 0 L 0 12 L -10 0 Z";
}

function getUnitIconPath(unit) {
  switch (unit.branch) {
    case "navy":
      return makeNavyPath(unit.sizeLevel);

    case "air":
      return makeAirPath(unit.sizeLevel);

    case "army":
      return makeArmyPath();

    case "special":
    default:
      return makeSpecialPath();
  }
}


// 将图标的局部坐标转换到地图平面，再经过投影。
// 当前让整个图标位于同一个高度平面。
function projectIconPoint(unit, localX, localY) {
  const scale = getUnitScale(unit);
  const heading = Number(unit.heading) || 0;
  const angle = heading * Math.PI / 180;

  const x = localX * scale;
  const y = localY * scale;

  // 在地图平面旋转，而不是在屏幕上旋转。
  const mapX = x * Math.cos(angle) - y * Math.sin(angle);
  const mapY = x * Math.sin(angle) + y * Math.cos(angle);

  // 这里只需要投影后的相对偏移。
  const origin = project(0, 0, 0);
  const point = project(mapX, mapY, 0);

  return {
    x: point.x - origin.x,
    y: point.y - origin.y
  };
}

// 当前四种形状只使用 M、L、Z 指令。
// 将这些形状的每个顶点转换为投影后的顶点。
function projectIconPath(unit, pathData) {
  const tokens = pathData.match(
    /[MLZ]|[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?/gi
  );

  if (!tokens) return "";

  const result = [];
  let index = 0;

  while (index < tokens.length) {
    const command = tokens[index++].toUpperCase();

    if (command === "Z") {
      result.push("Z");
      continue;
    }

    if (command !== "M" && command !== "L") {
      throw new Error("图标路径暂时只支持 M、L、Z 指令。");
    }

    const x = Number(tokens[index++]);
    const y = Number(tokens[index++]);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error("图标顶点数据不正确。");
    }

    const point = projectIconPoint(unit, x, y);

    result.push(
      `${command} ${point.x.toFixed(3)} ${point.y.toFixed(3)}`
    );
  }

  return result.join(" ");
}

// 圆点也经过相同投影，会呈现为倾斜平面上的椭圆。
function makeProjectedCenterDot(unit) {
  const centerY = unit.branch === "army" ? 6 : 0;
  const radius = UNIT_ICON_RULES.centerDotRadius;
  const points = [];

  for (let index = 0; index < 24; index++) {
    const angle = index * Math.PI * 2 / 24;

    points.push(
      projectIconPoint(
        unit,
        Math.cos(angle) * radius,
        centerY + Math.sin(angle) * radius
      )
    );
  }

  return pathFromPoints(points) + " Z";
}

function drawUnitIcon(unit, parent) {
  const filled = unit.filled === true;
  const underwater =
    unit.branch === "navy" && unit.underwater === true;

  const icon = createSVG("g", {
    class: [
      "unit-icon",
      filled ? "is-filled" : "is-hollow",
      underwater ? "is-underwater" : "",
      unit.branch === "army" ? "is-army" : ""
    ].filter(Boolean).join(" ")
  }, parent);

  createSVG("path", {
    d: projectIconPath(unit, getUnitIconPath(unit)),
    class: "unit-symbol"
  }, icon);

  if (unit.branch === "army") {
    // 方框尾部：单独绘制为虚线。
    createSVG("path", {
      d: projectIconPath(
        unit,
        "M -12 12 L 12 12"
      ),
      class: "army-rear"
    }, icon);

    // 内部等级标记：无、Ⅰ、Ⅱ、Ⅲ、Ⅴ。
    const levelPath = makeArmyLevelPath(unit.sizeLevel);

    if (levelPath) {
      createSVG("path", {
        d: projectIconPath(unit, levelPath),
        class: "army-level-mark"
      }, icon);
    }
  }

  if (!filled) {
    createSVG("path", {
      d: makeProjectedCenterDot(unit),
      class: "unit-center-dot"
    }, icon);
  }

  return getUnitScale(unit);
}




function selectUnit(unit, group) {
  document.querySelectorAll(".unit.selected").forEach(element => {
    element.classList.remove("selected");
  });

  group.classList.add("selected");

  document.querySelector("#unitName").textContent = unit.name;
  const spatial = getUnitSpatialState(unit);

document.querySelector("#unitDescription").textContent = [
  unit.description || "",
  spatial.valid ? spatial.note : spatial.reason
].filter(Boolean).join(" ");
editorController?.select(unit.instanceId);

}

// 返回单位当前所在位置的显示高度与合法性。
// 后续编辑器和移动系统也应调用同一个函数。
function getUnitSpatialState(unit) {
  if (unit.x == null || unit.y == null) {
    return {
      valid: false,
      reason: "未配置です。X と Y 座標を指定してください。"
    };
  }

  const x = Number(unit.x);
  const y = Number(unit.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return {
      valid: false,
      reason: "地図座標は有効な数値で指定してください。"
    };
  }

  const sample = sampleTerrain(terrain, x, y);

  if (!sample.inside) {
    return {
      valid: false,
      reason: "地図の範囲外です。座標を修正してください。"
    };
  }

  const ground = sample.surface;

  switch (unit.branch) {
      case "navy": {
      if (sample.kind === "land") {
        return {
          valid: false,
          reason: "海軍ユニットは陸地に配置できません。"
        };
      }

      const restricted =
        sample.kind === "river" ||
        sample.kind === "shallow";

      const waterName = sample.kind === "river" ? "河川" : "浅海";

      if (restricted) {
        const level = Number(unit.sizeLevel);

        if (unit.underwater === true) {
          return {
            valid: false,
            reason: `${waterName}に水中ユニットは進入できません。`
          };
        }

        if (!Number.isInteger(level) || level < 1 || level > 2) {
          return {
            valid: false,
            reason:
              `${waterName}に進入できるのは、` +
              "サイズレベル 1～2 の水上ユニットのみです。"
          };
        }
      }

      if (unit.underwater === true) {
        const depth = Number(unit.depth ?? 12);

        if (!Number.isFinite(depth) || depth <= 0) {
          return {
            valid: false,
            reason: "水中深度は 0 より大きくしてください。"
          };
        }

        return {
          valid: true,
          height: -depth,
          ground: 0,
          note: `水中深度：${depth} 地図高度単位`
        };
      }

      return {
        valid: true,
        height: ground,
        ground,
        note: restricted
          ? `${waterName}の水面に配置されています。サイズレベル ${unit.sizeLevel}：進入可能。`
          : "海面に配置されています。"
      };
    }


      case "army":
      if (sample.kind !== "land") {
        const waterName = {
          sea: "海域",
          river: "河川",
          shallow: "浅海"
        }[sample.kind] ?? "水域";

        return {
          valid: false,
          reason: `陸軍ユニットは${waterName}に配置できません。`
        };
      }

      return {
        valid: true,
        height: ground,
        ground,
        note: `地形標高：${ground.toFixed(1)} 地図高度単位`
      };


    case "air": {
      const altitude = Number(unit.altitude ?? 80);

      if (!Number.isFinite(altitude) || altitude <= ground) {
        return {
          valid: false,
          reason: "航空機の海抜高度は地形または水面より高くしてください。"
        };
      }

      return {
        valid: true,
        height: altitude,
        ground,
        note:
          `海抜高度：${altitude} 地図高度単位；` +
          `対地・対水面高度：${(altitude - ground).toFixed(1)}`
      };
    }

    default: {
      const altitude = Number(unit.altitude ?? ground);

      if (!Number.isFinite(altitude)) {
        return {
          valid: false,
          reason: "高度は有効な数値で指定してください。"
        };
      }

      return {
        valid: true,
        height: altitude,
        ground,
        note: `海抜高度：${altitude.toFixed(1)} 地図高度単位`
      };
    }
  }
}

function drawInvalidUnit(unit, reason) {
  // 未配置单位只显示在列表。越界单位同样不画到地图范围外。
  if (unit.x == null || unit.y == null) return;

  const sample = sampleTerrain(terrain, Number(unit.x), Number(unit.y));
  if (!sample.inside) return;

  const position = project(unit.x, unit.y, sample.surface);

  const group = createSVG("g", {
    class: "unit invalid-unit",
    "data-instance-id": unit.instanceId,
    transform: `translate(${position.x} ${position.y})`,
    tabindex: "0",
    role: "button",
    "aria-label": `${unit.name}：${reason}`
  }, layers.units);

  createSVG("path", {
    d: "M -8 -8 L 8 8 M 8 -8 L -8 8",
    class: "invalid-unit-mark"
  }, group);

  const label = createSVG("text", {
    x: 12,
    y: 4
  }, group);

  label.textContent = `${unit.name} ⚠`;

  const title = createSVG("title", {}, group);
  title.textContent = reason;

  createSVG("circle", {
    cx: 0,
    cy: 0,
    r: 18,
    class: "hit-area"
  }, group);

  group.addEventListener("click", () => selectUnit(unit, group));

  group.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectUnit(unit, group);
    }
  });
}


function drawUnits() {
  // 方便以后重新绘制，避免出现重复单位。
  layers.units.replaceChildren();

  const displayUnits = getDisplayUnits(
    units,
    unitGroups,
    terrain,
    getUnitSpatialState
  );

  for (const unit of displayUnits) {

   const spatial = getUnitSpatialState(unit);

if (!spatial.valid) {
  drawInvalidUnit(unit, spatial.reason);
  continue;
}


const position = project(unit.x, unit.y, spatial.height);

    const labelHeight = unit.labelHeight ?? 65;

    const group = createSVG("g", {
      class: `unit ${unit.side}`,
      "data-instance-id": unit.instanceId,
      transform: `translate(${position.x} ${position.y})`,
      tabindex: "0",
      role: "button",
      "aria-label": unit.name
    }, layers.units);

    // 航空机：画出到海平面的高度参考线。
// 这条线与单位名称的定位线是两回事。
if (unit.branch === "air") {
  const seaPosition = project(unit.x, unit.y, 0);
  const seaOffset = seaPosition.y - position.y;

  createSVG("line", {
    x1: 0,
    y1: 0,
    x2: 0,
    y2: seaOffset,
    class: "altitude-reference"
  }, group);

  createSVG("circle", {
    cx: 0,
    cy: seaOffset,
    r: 3,
    class: "altitude-foot"
  }, group);

  const altitudeLabel = createSVG("text", {
    x: 8,
    y: seaOffset / 2,
    class: "altitude-label"
  }, group);

  altitudeLabel.textContent =
    `高度 ${spatial.height} u`;
}

    // 定位线：保持竖直，不跟随图标旋转。
    createSVG("line", {
      x1: 0,
      y1: 0,
      x2: 0,
      y2: -labelHeight,
      class: "unit-stem"
    }, group);

    // 军种图标：独立处理形状、朝向和大小。
    const scale = drawUnitIcon(unit, group);

    // 名称旁的光点，不是图标内部的小圆点。
    createSVG("circle", {
      cx: 0,
      cy: -labelHeight,
      r: 2,
      class: "unit-dot"
    }, group);

    const label = createSVG("text", {
      x: 7,
      y: -labelHeight + 4
    }, group);

    label.textContent = unit.name;

    // 点击区域随图标等级扩大。
    createSVG("circle", {
      cx: 0,
      cy: 0,
      r: 17 * scale,
      class: "hit-area"
    }, group);

    group.addEventListener("click", () => {
      selectUnit(unit, group);
    });

    // 支持键盘选择。
    group.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectUnit(unit, group);
      }
    });
  }
}


let routeElement = null;

function drawRoute() {
  const waypoints = [
    [-110, -30],
    [-65, -65],
    [5, -35],
    [55, -5],
    [95, 20]
  ];

  const projectedPoints = [];

  for (let i = 0; i < waypoints.length - 1; i++) {
    const start = waypoints[i];
    const end = waypoints[i + 1];

    for (let step = 0; step <= 20; step++) {
      const t = step / 20;

      const x = start[0] + (end[0] - start[0]) * t;
      const y = start[1] + (end[1] - start[1]) * t;

      // 地表面より少し高い位置に配置する
      const height = Math.max(0, terrainHeight(x, y)) + 3;

      projectedPoints.push(project(x, y, height));
    }
  }

  routeElement = createSVG("path", {
    d: pathFromPoints(projectedPoints),
    class: "route",
    pathLength: 1,
    "stroke-dasharray": "1 1",
    "stroke-dashoffset": 1
  }, layers.routes);
}

function playRoute() {
  routeElement.classList.remove("drawing");

  // 直前のスタイル変更をブラウザーに反映させてから、アニメーションを再開する
  void routeElement.getBoundingClientRect();

  routeElement.classList.add("drawing");
}

const view = {
  x: 0,
  y: 0,
  scale: 1
};

function updateView() {
  viewport.setAttribute(
    "transform",
    `translate(${view.x} ${view.y}) scale(${view.scale})`
  );
}

// 获取当前 SVG 显示窗口的中心。
// 这里使用 viewBox 坐标，不使用网页像素。
function getViewCenter() {
  const box = svg.viewBox.baseVal;

  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  };
}

// 完整显示当前地图。
// 包含海平面边界、地形高度范围，以及显示中的 Z 轴。
function fitMapToView() {
  const box = svg.viewBox.baseVal;

  if (box.width <= 0 || box.height <= 0) return;

  const halfWidth = terrain.width / 2;
  const halfHeight = terrain.height / 2;

  let highest = 0;

  for (const height of terrain.heights) {
    highest = Math.max(highest, height);
  }

  const points = [];

  // 使用地图四角在海平面和最高地形高度上的投影，
  // 构成一个保守的显示包围框。
  for (const x of [-halfWidth, halfWidth]) {
    for (const y of [-halfHeight, halfHeight]) {
      points.push(project(x, y, 0));
      points.push(project(x, y, highest));
    }
  }

  if (axesVisible) {
    const zLength = Math.max(
      300,
      Math.ceil(highest / 50) * 50
    );

    points.push(project(0, 0, zLength));
  }

  const minX = Math.min(...points.map(point => point.x));
  const maxX = Math.max(...points.map(point => point.x));
  const minY = Math.min(...points.map(point => point.y));
  const maxY = Math.max(...points.map(point => point.y));

  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);

  // 留出边距，避免边界和轴标题紧贴窗口。
  const padding = 40;
  const availableWidth = Math.max(1, box.width - padding * 2);
  const availableHeight = Math.max(1, box.height - padding * 2);

  const scale = Math.min(
    VIEW_SCALE_MAX,
    Math.max(
      VIEW_SCALE_MIN,
      Math.min(
        availableWidth / contentWidth,
        availableHeight / contentHeight
      )
    )
  );

  const center = getViewCenter();
  const contentCenterX = (minX + maxX) / 2;
  const contentCenterY = (minY + maxY) / 2;

  view.scale = scale;
  view.x = center.x - contentCenterX * scale;
  view.y = center.y - contentCenterY * scale;

  updateView();
}


// ブラウザーウィンドウ上の座標を、SVG の viewBox 座標に変換する
function getSVGPoint(event) {
  const point = svg.createSVGPoint();

  point.x = event.clientX;
  point.y = event.clientY;

  return point.matrixTransform(svg.getScreenCTM().inverse());
}

// 从屏幕位置寻找可见地形三角形上的地图坐标。
// 不直接按海平面反投影，否则山地上的笔刷会发生偏移。
function pickTerrainPoint(event) {
  const screen = getSVGPoint(event);

  const point = {
    x: (screen.x - view.x) / view.scale,
    y: (screen.y - view.y) / view.scale
  };

  let result = null;
  let nearestDepth = -Infinity;

  function test(vertices) {
    const projected = vertices.map(vertex =>
      project(vertex.x, vertex.y, Math.max(0, vertex.z))
    );

    const [a, b, c] = projected;

    const denominator =
      (b.y - c.y) * (a.x - c.x) +
      (c.x - b.x) * (a.y - c.y);

    if (Math.abs(denominator) < 0.000001) return;

    const wa = (
      (b.y - c.y) * (point.x - c.x) +
      (c.x - b.x) * (point.y - c.y)
    ) / denominator;

    const wb = (
      (c.y - a.y) * (point.x - c.x) +
      (a.x - c.x) * (point.y - c.y)
    ) / denominator;

    const wc = 1 - wa - wb;

    if (wa < -0.00001 || wb < -0.00001 || wc < -0.00001) return;

    const x = vertices[0].x * wa + vertices[1].x * wb + vertices[2].x * wc;
    const y = vertices[0].y * wa + vertices[1].y * wb + vertices[2].y * wc;

    // 多个坡面投影重叠时，选择朝观察者的一侧。
    const depth = x + y;

    if (depth > nearestDepth) {
      nearestDepth = depth;
      result = { x, y };
    }
  }

  const grid = makeHeightGrid();

  for (let row = 0; row < grid.length - 1; row++) {
    for (let col = 0; col < grid[row].length - 1; col++) {
      const a = grid[row][col];
      const b = grid[row][col + 1];
      const c = grid[row + 1][col + 1];
      const d = grid[row + 1][col];

      test([a, b, c]);
      test([a, c, d]);
    }
  }

  return result;
}

// 根据单位所在高度平面拾取部署位置。
// 陆军和水上海军使用地形拾取；航空机和水下单位保留高度。
function pickUnitPlacement(event, unit) {
  const fixedHeight =
    unit.branch === "air"
      ? Number(unit.altitude ?? 80)
      : unit.branch === "navy" && unit.underwater === true
        ? -Number(unit.depth ?? 12)
        : unit.branch === "special" && unit.altitude !== null
          ? Number(unit.altitude)
          : null;

  if (fixedHeight === null) {
    return pickTerrainPoint(event);
  }

  if (!Number.isFinite(fixedHeight)) return null;

  const screen = getSVGPoint(event);

  const projectedX = (screen.x - view.x) / view.scale;
  const projectedY = (screen.y - view.y) / view.scale;

  // 与 project() 的投影参数保持一致。
  const difference = (projectedX - 500) / 0.95;
  const sum = (projectedY - 340 + fixedHeight * 0.75) / 0.43;

  return {
    x: (sum + difference) / 2,
    y: (sum - difference) / 2
  };
}

// 部署预览独立于 unitLayer，避免清空真实单位。
function clearDeploymentPreview() {
  deploymentPreviewLayer?.replaceChildren();
}

function drawDeploymentPreview(unit, spatial) {
  if (!deploymentPreviewLayer) {
    deploymentPreviewLayer = createSVG("g", {
      id: "deploymentPreviewLayer",
      "pointer-events": "none",
      "aria-hidden": "true"
    }, viewport);
  }

  clearDeploymentPreview();

  const sample = sampleTerrain(terrain, unit.x, unit.y);

  // 非法位置也显示预览，便于看清拒绝原因。
  const height = spatial.valid
    ? spatial.height
    : unit.branch === "air"
      ? Number(unit.altitude ?? 80)
      : unit.branch === "navy" && unit.underwater === true
        ? -Number(unit.depth ?? 12)
        : sample.surface;

  const position = project(unit.x, unit.y, height);

  const group = createSVG("g", {
    class:
      `deployment-preview ${unit.side}` +
      (spatial.valid ? "" : " invalid"),
    transform: `translate(${position.x} ${position.y})`
  }, deploymentPreviewLayer);

  drawUnitIcon(unit, group);

  createSVG("circle", {
    cx: 0,
    cy: 0,
    r: 12,
    class: "deployment-preview-ring"
  }, group);

  const label = createSVG("text", {
    x: 14,
    y: -12
  }, group);

  label.textContent =
    `${unit.name} · ${unit.heading.toFixed(0)}°` +
    (spatial.valid ? "" : " ⚠");
}


function redrawTerrain() {
  drawGrid();
  drawTerrain();
  drawAxes();

  // 临时航路跟随地形重建，不保留旧的高度位置。
  layers.routes.replaceChildren();
  routeElement = null;
  drawRoute();

  drawUnits();
}


function zoomAt(factor, center) {
  const oldScale = view.scale;
  const newScale = Math.min(VIEW_SCALE_MAX,Math.max(VIEW_SCALE_MIN, oldScale * factor));
  const ratio = newScale / oldScale;

  view.x = center.x - (center.x - view.x) * ratio;
  view.y = center.y - (center.y - view.y) * ratio;
  view.scale = newScale;

  updateView();
}

svg.addEventListener("wheel", event => {
  event.preventDefault();

  const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
  zoomAt(factor, getSVGPoint(event));
}, { passive: false });

let drag = null;

svg.addEventListener("pointerdown", event => {
  if (event.button !== 0 || drag) return;

  // ユニットはクリックによる選択に使用し、ユニット上からは地図のドラッグを開始しない
  if (event.target.closest(".unit")) return;

  const point = getSVGPoint(event);

  drag = {
    pointerId: event.pointerId,
    startX: point.x,
    startY: point.y,
    viewX: view.x,
    viewY: view.y
  };

  svg.setPointerCapture(event.pointerId);
  svg.classList.add("dragging");
});

svg.addEventListener("pointermove", event => {
  if (!drag || event.pointerId !== drag.pointerId) return;

  const point = getSVGPoint(event);

  view.x = drag.viewX + point.x - drag.startX;
  view.y = drag.viewY + point.y - drag.startY;

  updateView();
});

function stopDragging(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;

  drag = null;
  svg.classList.remove("dragging");

  if (svg.hasPointerCapture(event.pointerId)) {
    svg.releasePointerCapture(event.pointerId);
  }
}

svg.addEventListener("pointerup", stopDragging);
svg.addEventListener("pointercancel", stopDragging);

svg.addEventListener("lostpointercapture", () => {
  drag = null;
  svg.classList.remove("dragging");
});

document.querySelector("#zoomIn").addEventListener("click", () => {
  zoomAt(1.2, getViewCenter());
});

document.querySelector("#zoomOut").addEventListener("click", () => {
  zoomAt(1 / 1.2, getViewCenter());
});

const resetViewButton = document.querySelector("#resetView");

resetViewButton.textContent = "地図全体を表示";
resetViewButton.addEventListener("click", fitMapToView);


document.querySelector("#replay").addEventListener("click", playRoute);

// ===== 射击效果绘制接口 =====
// 当前只负责绘制静态效果，不负责移动、命中或伤害。
const PROJECTILE_RULES = {
  shellRadius: 2.5,
  rodLength: 14,
  rodWidth: 3,
  laserLength: 100,
  laserWidth: 1.5
};

function drawProjectile({
  kind = "shell",
  x = 0,
  y = 0,
  height = 0,
  heading = 0,
  side = "ally",
  size = 1,
  length = PROJECTILE_RULES.laserLength
} = {}) {
  const supportedKinds = ["shell", "torpedo", "missile", "laser"];

  if (!supportedKinds.includes(kind)) {
    throw new Error(`不明な射撃エフェクトの種類です：${kind}`);
  }

  const position = project(x, y, height);
  const rotation = getHeadingRotation(heading);

  const numericSize = Number(size);
  const effectScale = Number.isFinite(numericSize)
    ? Math.max(0.1, numericSize)
    : 1;

  const group = createSVG("g", {
    class: `projectile ${side} projectile-${kind}`,
    transform:
      `translate(${position.x} ${position.y}) ` +
      `rotate(${rotation}) scale(${effectScale})`
  }, layers.routes);

  switch (kind) {
    case "shell":
      createSVG("circle", {
        cx: 0,
        cy: 0,
        r: PROJECTILE_RULES.shellRadius,
        class: "projectile-shell"
      }, group);
      break;

    case "torpedo":
    case "missile":
      createSVG("line", {
        x1: 0,
        y1: PROJECTILE_RULES.rodLength / 2,
        x2: 0,
        y2: -PROJECTILE_RULES.rodLength / 2,
        class: "projectile-rod"
      }, group);
      break;

    case "laser": {
      const numericLength = Number(length);
      const rayLength = Number.isFinite(numericLength)
        ? Math.max(0, numericLength)
        : PROJECTILE_RULES.laserLength;

      createSVG("line", {
        x1: 0,
        y1: 0,
        x2: 0,
        y2: -rayLength,
        class: "projectile-laser"
      }, group);
      break;
    }
  }

  // 以后动画或命中处理可以操作、删除这个元素。
  return group;
}


// 起動順序
// 坐标轴是辅助显示，本次不写入场景存档。
const axesButton = document.createElement("button");
axesButton.type = "button";
axesButton.textContent = "XYZ 軸を表示";
axesButton.setAttribute("aria-pressed", "false");
axesButton.setAttribute("aria-controls", "axesLayer");

axesButton.addEventListener("click", () => {
  axesVisible = !axesVisible;

  axesButton.textContent = axesVisible
    ? "XYZ 軸を非表示"
    : "XYZ 軸を表示";

  axesButton.setAttribute("aria-pressed", String(axesVisible));
  drawAxes();
});

document.querySelector(".controls").append(axesButton);
const terrainColorButton = document.createElement("button");
terrainColorButton.type = "button";
terrainColorButton.textContent = "地形着色を表示";
terrainColorButton.setAttribute("aria-pressed", "false");

terrainColorButton.addEventListener("click", () => {
  terrainColorVisible = !terrainColorVisible;

  terrainColorButton.textContent = terrainColorVisible
    ? "地形着色を非表示"
    : "地形着色を表示";

  terrainColorButton.setAttribute(
    "aria-pressed",
    String(terrainColorVisible)
  );

  // 仅重画地形显示，不改存档、不加入笔刷撤销历史。
  drawTerrain();
});

document.querySelector(".controls").append(terrainColorButton);


// ===== 启动与编辑器桥接 =====

drawGrid();
drawTerrain();
drawRoute();
updateView();

// 航路仍然只是原型演示，不代表参战单位的真实移动。
document.querySelector("#replay").textContent = "経路デモを再生";

async function startEditor() {
  const container = document.querySelector("#editor");

  try {
    const catalog = await loadUnitData();
    const store = createBattleStore(catalog);

    terrain = store.getScene().terrain;
    let terrainText = JSON.stringify(terrain);

    redrawTerrain();

    // 必须先注册：编辑器重建列表前，空间查询先切换到新地形。
    const unsubscribeTerrain = store.subscribe(() => {
      const next = store.getScene().terrain;
      const text = JSON.stringify(next);

      if (text !== terrainText) {
        terrain = next;
        terrainText = text;
        redrawTerrain();
      }
    });

    editorController = mountEditor({
      container,
      catalog,
      store,
      spatialState: getUnitSpatialState,
      
      onSceneLoaded() {
        terrainController?.resetHistory();
        clearDeploymentPreview();
      },

      
      getView() {
        return { ...view };
      },

      setView(savedView) {
        Object.assign(view, savedView);
        updateView();
      },

      renderMap(instances, selectedId) {
        units = instances.map(instance => ({
          ...instance,
          id: instance.instanceId
        }));

        unitGroups = store.getGroups();

        drawUnits();

        const displayUnits = getDisplayUnits(
          units,
          unitGroups,
          terrain,
          getUnitSpatialState
        );


         for (const element of layers.units.querySelectorAll(".unit")) {
          const displayed = displayUnits.find(
            unit =>
              unit.instanceId === element.dataset.instanceId
          );

          const selected =
            displayed?.instanceId === selectedId ||
            displayed?.clusterMembers?.some(
              member => member.instanceId === selectedId
            );

          element.classList.toggle("selected", Boolean(selected));
        }


        const selected = units.find(
          unit => unit.instanceId === selectedId
        );

        const name = document.querySelector("#unitName");
        const description = document.querySelector("#unitDescription");

        if (!selected) {
          name.textContent = "選択待ち";
          description.textContent =
            "一覧または地図からユニットを選択してください。";
          return;
        }

        const displayedSelection = displayUnits.find(unit =>
          unit.instanceId === selectedId ||
          unit.clusterMembers?.some(
            member => member.instanceId === selectedId
          )
        );

        name.textContent = displayedSelection?.name ?? selected.name;


        const spatial = getUnitSpatialState(selected);

        description.textContent = [
          selected.description,
          spatial.valid ? spatial.note : spatial.reason
        ].filter(Boolean).join(" ");
      }
    });

    // 放在单位编辑器前面，但不让 mountEditor 清空它。
    const terrainHost = document.createElement("section");
    terrainHost.className = "editor-section terrain-editor";
    container.prepend(terrainHost);

    terrainController = mountTerrainEditor({
      container: terrainHost,
      svg,
      store,
      pickPoint: pickTerrainPoint,

      getTerrain() {
        return terrain;
      },

      previewTerrain(next) {
        terrain = next;
        redrawTerrain();
      }
    });

        // 对集群逐个检查成员，而不是只检查显示图标。
    function deploymentSpatialState(candidate) {
      if (!candidate.clusterMembers) {
        return getUnitSpatialState(candidate);
      }

      const updates = getDeploymentUpdates(candidate);
      const members = candidate.clusterMembers;

      for (const update of updates) {
        const original = members.find(
          member => member.instanceId === update.instanceId
        );

        const spatial = getUnitSpatialState({
          ...original,
          ...update.patch
        });

        if (!spatial.valid) {
          return {
            valid: false,
            reason: `${original.name}：${spatial.reason}`
          };
        }
      }

      return getUnitSpatialState(candidate);
    }

    deploymentController = mountUnitDeployment({
      svg,
      editorContainer: container,
      store,
      spatialState: deploymentSpatialState,
      pickPlacement: pickUnitPlacement,
      previewUnit: drawDeploymentPreview,
      clearPreview: clearDeploymentPreview,

      resolveUnit(instanceId) {
        const instances = store.getAll();

        const clusters = getActiveClusters(
          instances,
          store.getGroups(),
          terrain,
          getUnitSpatialState,
          true
        );

        const cluster = clusters.find(item =>
          item.members.some(
            member => member.instanceId === instanceId
          )
        );

        if (cluster) {
          return makeClusterProxy(cluster);
        }

        return instances.find(
          unit => unit.instanceId === instanceId
        );
      },

      commitUnit(candidate) {
        const spatial = deploymentSpatialState(candidate);

        if (!spatial.valid) {
          throw new Error(spatial.reason);
        }

        store.updateUnits(getDeploymentUpdates(candidate));
      },

      selectUnit(instanceId) {
        editorController?.select(instanceId);
      }
    });


    
    window.addEventListener("pagehide", event => {
      if (event.persisted) return;

      deploymentController?.destroy();
      terrainController?.destroy();
      unsubscribeTerrain();
      editorController?.destroy();
      store.destroy();
    });
  } catch (error) {
    console.error(error);

    const paragraph = document.createElement("p");
    paragraph.className = "editor-note editor-status error";
    paragraph.textContent =
      `編集機能の起動に失敗しました：${error.message}`;

    container.replaceChildren(paragraph);
  }
}


startEditor();
