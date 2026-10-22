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
  const mountainA =
    65 * Math.exp(
      -(
        ((x + 80) / 105) ** 2 +
        ((y + 15) / 80) ** 2
      )
    );

  const mountainB =
    60 * Math.exp(
      -(
        ((x - 75) / 95) ** 2 +
        ((y - 25) / 100) ** 2
      )
    );

  const detail =
    2 * Math.sin(x / 24) * Math.cos(y / 29);

  // 標高 0 は海面を表し、 0 未満の領域は海です。
  return mountainA + mountainB + detail - 19;
}

function drawGrid() {
  const extent = 300;
  const spacing = 30;

  for (let value = -extent; value <= extent; value += spacing) {
    const horizontal = [
      project(-extent, value),
      project(extent, value)
    ];

    const vertical = [
      project(value, -extent),
      project(value, extent)
    ];

    for (const points of [horizontal, vertical]) {
      createSVG("path", {
        d: pathFromPoints(points),
        class: "grid-line"
      }, layers.grid);
    }
  }
}

function makeHeightGrid() {
  const rows = [];

  for (let y = -180; y <= 180; y += 6) {
    const row = [];

    for (let x = -240; x <= 240; x += 6) {
      row.push({
        x,
        y,
        z: terrainHeight(x, y)
      });
    }

    rows.push(row);
  }

  return rows;
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
  const grid = makeHeightGrid();

  // 標高 0 は海岸線に、それ以外の標高は山体の等高線に対応します。
  const levels = [0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60];

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

const units = [
  {
    id: "ally-01",
    name: "海軍サンプルユニット",
    side: "ally",

    branch: "navy",
    sizeLevel: 2,
    heading: 0,
    filled: false,
    underwater: false,

    x: -110,
    y: -30,
    labelHeight: 65,
    description: "五角形の艦船アイコン。輪郭のみで表示し、中央に小さな点があります。"
  },

  {
    id: "ally-02",
    name: "空軍サンプルユニット",
    side: "ally",

    branch: "air",
    sizeLevel: 3,
    heading: 45,
    filled: false,

    x: -35,
    y: 55,
    labelHeight: 90,
    description: "サイズレベル3の航空機アイコン。先端の角度は90度です。"
  },

  {
    id: "enemy-01",
    name: "陸軍サンプルユニット",
    side: "enemy",

    branch: "army",
    sizeLevel: 2,
    heading: 180,
    filled: false,
    armyBlocks: 3,

    x: 95,
    y: 20,
    labelHeight: 75,
    description: "上部に3つの突起がある陸軍アイコンです。"
  },

  {
    id: "ally-submarine",
    name: "水中サンプルユニット",
    side: "ally",

    branch: "navy",
    sizeLevel: 2,
    heading: 90,
    filled: false,
    underwater: true,

    x: -190,
    y: 100,
    labelHeight: 55,
    description: "水中ユニット。艦船アイコンの輪郭を破線で表示します。"
  },

  {
    id: "enemy-special",
    name: "特殊サンプルユニット",
    side: "enemy",

    branch: "special",
    sizeLevel: 1,
    heading: 270,
    filled: true,

    x: 170,
    y: -90,
    labelHeight: 60,
    description: "特殊ユニット。塗りつぶした菱形で表示します。"
  }
];

// ===== 图标规则配置 =====
// 后续调整尺寸与航空机角度，优先修改这里。
const UNIT_ICON_RULES = {
  scales: [1, 1.75, 2.5, 3.25, 4],
  airAngles: [15, 30, 90, 120, 150],
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
  return UNIT_ICON_RULES.scales[getSizeLevel(sizeLevel) - 1];
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
function makeNavyPath() {
  return "M 0 -12 L 8 -4 L 8 12 L -8 12 L -8 -4 Z";
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
function makeArmyPath(blocks = 3) {
  const count = [3, 4, 5].includes(Number(blocks))
    ? Number(blocks)
    : 3;

  const width = 24;
  const left = -width / 2;
  const bottom = 12;
  const shoulder = 0;
  const top = -12;

  // 凸块之间保留同宽间隔。
  const segmentWidth = width / (count * 2 - 1);

  let path = `M ${left} ${bottom} L ${left} ${shoulder}`;

  for (let index = 0; index < count; index++) {
    const blockLeft = left + index * 2 * segmentWidth;
    const blockRight = blockLeft + segmentWidth;

    path += [
      ` L ${blockLeft} ${shoulder}`,
      ` L ${blockLeft} ${top}`,
      ` L ${blockRight} ${top}`,
      ` L ${blockRight} ${shoulder}`
    ].join("");

    if (index < count - 1) {
      path += ` L ${blockRight + segmentWidth} ${shoulder}`;
    }
  }

  path += ` L ${width / 2} ${bottom} Z`;

  return path;
}

function makeSpecialPath() {
  return "M 0 -12 L 10 0 L 0 12 L -10 0 Z";
}

function getUnitIconPath(unit) {
  switch (unit.branch) {
    case "navy":
      return makeNavyPath();

    case "air":
      return makeAirPath(unit.sizeLevel);

    case "army":
      return makeArmyPath(unit.armyBlocks);

    case "special":
    default:
      return makeSpecialPath();
  }
}

// 在单位容器里绘制可旋转、可缩放的图标。
// 名称与定位线不放在这个容器里，因此不会旋转。
function drawUnitIcon(unit, parent) {
  const scale = getIconScale(unit.sizeLevel);
  const rotation = getHeadingRotation(unit.heading);
  const filled = unit.filled === true;
  const underwater =
    unit.branch === "navy" && unit.underwater === true;

  const icon = createSVG("g", {
    class: [
      "unit-icon",
      filled ? "is-filled" : "is-hollow",
      underwater ? "is-underwater" : ""
    ].filter(Boolean).join(" "),

    transform: `rotate(${rotation}) scale(${scale})`
  }, parent);

  createSVG("path", {
    d: getUnitIconPath(unit),
    class: "unit-symbol"
  }, icon);

  // 空心单位的内部标记。
  if (!filled) {
    createSVG("circle", {
      cx: 0,
      cy: unit.branch === "army" ? 6 : 0,
      r: UNIT_ICON_RULES.centerDotRadius,
      class: "unit-center-dot"
    }, icon);
  }

  return scale;
}


function selectUnit(unit, group) {
  document.querySelectorAll(".unit.selected").forEach(element => {
    element.classList.remove("selected");
  });

  group.classList.add("selected");

  document.querySelector("#unitName").textContent = unit.name;
  document.querySelector("#unitDescription").textContent =
    unit.description;
}

function drawUnits() {
  // 方便以后重新绘制，避免出现重复单位。
  layers.units.replaceChildren();

  for (const unit of units) {
    const height = Math.max(0, terrainHeight(unit.x, unit.y));
    const position = project(unit.x, unit.y, height);
    const labelHeight = unit.labelHeight ?? 65;

    const group = createSVG("g", {
      class: `unit ${unit.side}`,
      transform: `translate(${position.x} ${position.y})`,
      tabindex: "0",
      role: "button",
      "aria-label": unit.name
    }, layers.units);

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

// ブラウザーウィンドウ上の座標を、SVG の viewBox 座標に変換する
function getSVGPoint(event) {
  const point = svg.createSVGPoint();

  point.x = event.clientX;
  point.y = event.clientY;

  return point.matrixTransform(svg.getScreenCTM().inverse());
}

function zoomAt(factor, center) {
  const oldScale = view.scale;
  const newScale = Math.min(3.5, Math.max(0.6, oldScale * factor));
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
  zoomAt(1.2, { x: 500, y: 325 });
});

document.querySelector("#zoomOut").addEventListener("click", () => {
  zoomAt(1 / 1.2, { x: 500, y: 325 });
});

document.querySelector("#resetView").addEventListener("click", () => {
  view.x = 0;
  view.y = 0;
  view.scale = 1;
  updateView();
});

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
drawGrid();
drawTerrain();
drawRoute();
drawUnits();
updateView();
playRoute();

// 临时射击效果演示。
// 后续有正式动画后，可以删除这四次调用。

drawProjectile({
  kind: "shell",
  x: -210,
  y: -110,
  side: "ally"
});

drawProjectile({
  kind: "torpedo",
  x: -150,
  y: -110,
  heading: 90,
  side: "ally"
});

drawProjectile({
  kind: "missile",
  x: -90,
  y: -110,
  heading: 45,
  side: "enemy"
});

drawProjectile({
  kind: "laser",
  x: -30,
  y: -110,
  heading: 90,
  length: 70,
  side: "ally"
});


