import { projectMap as project } from "./map-display.js";

const NS = "http://www.w3.org/2000/svg";

function createSVG(tag, attributes = {}, parent = null) {
  const element = document.createElementNS(NS, tag);

  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }

  if (parent) parent.appendChild(element);

  return element;
}

function pointText(point) {
  return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
}

function pathFromPoints(points) {
  return points
    .map((point, index) =>
      `${index === 0 ? "M" : "L"}${pointText(point)}`
    )
    .join(" ");
}
// ===== 图标规则配置 =====
// 后续调整尺寸与航空机角度，优先修改这里。
const UNIT_ICON_RULES = {
 
  displayScale: 0.5,

  
  scales: [1, 1.75, 2.5, 3.25, 4],

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
