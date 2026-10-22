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
      -((x + 80) / 105) ** 2
      -((y + 15) / 80) ** 2
    );

  const mountainB =
    60 * Math.exp(
      -((x - 75) / 95) ** 2
      -((y - 25) / 100) ** 2
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
    name: "友軍編隊 01",
    side: "ally",
    x: -110,
    y: -30,
    labelHeight: 65,
    description: "任務：指定航路に沿って中央区域へ接近する。"
  },
  {
    id: "ally-02",
    name: "友軍編隊 02",
    side: "ally",
    x: -35,
    y: 55,
    labelHeight: 90,
    description: "任務：待機を維持し、側面支援に備える。"
  },
  {
    id: "enemy-01",
    name: "敵方目標 A",
    side: "enemy",
    x: 95,
    y: 20,
    labelHeight: 75,
    description: "主要目標：島東部の敵方施設。"
  }
];

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
  for (const unit of units) {
    const height = Math.max(0, terrainHeight(unit.x, unit.y));
    const position = project(unit.x, unit.y, height);

    const group = createSVG("g", {
      class: `unit ${unit.side}`,
      transform: `translate(${position.x} ${position.y})`
    }, layers.units);

    // 位置を示す垂直線
    createSVG("line", {
      x1: 0,
      y1: 0,
      x2: 0,
      y2: -unit.labelHeight,
      class: "unit-stem"
    }, group);

    // 地表面の菱形マーカー
    createSVG("path", {
      d: "M 0 -5 L 10 0 L 0 5 L -10 0 Z",
      class: "unit-symbol"
    }, group);

    // ラベル上端の光点
    createSVG("circle", {
      cx: 0,
      cy: -unit.labelHeight,
      r: 2,
      class: "unit-dot"
    }, group);

    const label = createSVG("text", {
      x: 7,
      y: -unit.labelHeight + 4
    }, group);

    label.textContent = unit.name;

    // ユニットのクリック判定範囲を広げる
    createSVG("circle", {
      cx: 0,
      cy: 0,
      r: 17,
      class: "hit-area"
    }, group);

    group.addEventListener("click", () => {
      selectUnit(unit, group);
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

// 起動順序
drawGrid();
drawTerrain();
drawRoute();
drawUnits();
updateView();
playRoute();



