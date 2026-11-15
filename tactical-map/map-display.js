import {projectDisplayPoint} from './relief-display.js';
import { makeTerrainRenderGrid } from "./terrain-render-grid.js";
import {
  gridPosition,
  sampleTerrain,
  terrainMaximumHeight
} from "./terrain-data.js";

import {
  normalizeEnvironment,
  getTimePeriod,
  getWeatherInfo
} from "./environment-data.js";

const NS = "http://www.w3.org/2000/svg";

function svgNode(tag, attributes, parent) {
  const element = document.createElementNS(NS, tag);

  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }

  parent.append(element);
  return element;
}

export function projectMap(x, y, height = 0) {
  return projectDisplayPoint(x,y,height);
}

// 自定义页：着色关闭时不绘制面。
// 推演页：可设置 wireframe，关闭着色后仍保留网格线。
export function drawTerrainFaces({
  layer,
  terrain,
  colored,
  wireframe = false,
  grid
}) {
  if (!colored && !wireframe) return;
  grid ??= makeTerrainRenderGrid(terrain);

  const colors = {
    land: "#193a30",
    sea: "#0a263e",
    river: "#267fa1",
    shallow: "#286a71"
  };

  // 连续同类面合并成path；保留原来的前后绘制顺序。
  let kind = null, data = [], count = 0;
  const fragment = document.createDocumentFragment();
  function flush() {
    if (!data.length) return;
    svgNode("path", {
      d: data.join(" "), fill: colored ? colors[kind] : "none",
      stroke: wireframe ? "#35556a" : "none",
      "stroke-width": 0.4, "stroke-opacity": 0.55
    }, fragment);
    data = []; count = 0;
  }
  for (let row = 0; row < grid.length - 1; row++) {
    for (let col = 0; col < grid[row].length - 1; col++) {
      const vertices = [grid[row][col], grid[row][col+1], grid[row+1][col+1], grid[row+1][col]];
      for (const ids of [[0,1,2], [0,2,3]]) {
        const triangle = ids.map(i => vertices[i]);
        const next = triangle.some(v => v.kind === "land") ? "land"
          : triangle.some(v => v.kind === "river") ? "river"
          : triangle.some(v => v.kind === "shallow") ? "shallow" : "sea";
        if (kind !== next || count >= 256) { flush(); kind = next; }
        const points = triangle.map(v => projectMap(v.x, v.y, Math.max(0, v.z)));
        const area = points.reduce((sum, p, i) => {
          const q = points[(i+1)%3]; return sum + p.x*q.y - q.x*p.y;
        }, 0);
        if (area < 0) points.reverse();
        data.push(`M${points.map(v => `${v.x},${v.y}`).join(" L")} Z`);
        count++;
      }
    }
  }
  flush();
  layer.append(fragment);
}

export function drawMapAxes(layer, terrain, visible) {
  layer.replaceChildren();
  layer.style.display = visible ? "" : "none";

  if (!visible) return;

  const highest = terrainMaximumHeight(terrain);

  const origin = projectMap(0, 0, 0);

  const axes = [
    {
      name: "X",
      color: "#ff8f8f",
      length: terrain.width / 2,
      negative: true,
      point: value => projectMap(value, 0, 0)
    },
    {
      name: "Y",
      color: "#96e6a0",
      length: terrain.height / 2,
      negative: true,
      point: value => projectMap(0, value, 0)
    },
    {
      name: "Z",
      color: "#a8bcff",
      length: Math.max(300, Math.ceil(highest / 50) * 50),
      negative: false,
      point: value => projectMap(0, 0, value)
    }
  ];

  for (const axis of axes) {
    const end = axis.point(axis.length);

    const line = (a, b, dashed = false) => {
      svgNode("line", {
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        stroke: axis.color,
        "stroke-width": 1.6,
        "stroke-dasharray": dashed ? "5 5" : "",
        "vector-effect": "non-scaling-stroke"
      }, layer);
    };

    line(origin, end);

    if (axis.negative) {
      line(axis.point(-axis.length), origin, true);
    }

    const angle = Math.atan2(
      end.y - origin.y,
      end.x - origin.x
    );

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

    svgNode("polygon", {
      points: arrow.map(p => `${p.x},${p.y}`).join(" "),
      fill: axis.color
    }, layer);

    const spacing = Math.max(
      50,
      Math.ceil(axis.length / 6 / 50) * 50
    );

    const start = axis.negative ? -axis.length : 0;

    for (
      let value = Math.ceil(start / spacing) * spacing;
      value <= axis.length;
      value += spacing
    ) {
      if (value === 0) continue;

      const point = axis.point(value);

      svgNode("circle", {
        cx: point.x,
        cy: point.y,
        r: 2,
        fill: axis.color
      }, layer);

      const label = svgNode("text", {
        x: point.x + 5,
        y: point.y - 5,
        fill: axis.color
      }, layer);

      label.textContent = String(value);
    }

    const label = svgNode("text", {
      x: end.x + 9,
      y: end.y - 8,
      fill: axis.color
    }, layer);

    label.textContent = `+${axis.name}`;
  }

  const label = svgNode("text", {
    x: origin.x + 7,
    y: origin.y - 7,
    fill: "#e0eaf4"
  }, layer);

  label.textContent = "O (0, 0, 0)";
}

export function renderEnvironmentBadge(element, value) {
  const environment = normalizeEnvironment(value);
  const period = getTimePeriod(environment.time);
  const weather = getWeatherInfo(environment.weather);

  element.replaceChildren();
  element.style.setProperty("--weather-color", weather.color);

  const time = document.createElement("p");
  time.className = "environment-time";
  time.textContent = `${environment.time} · ${period.label}`;

  const weatherRow = document.createElement("div");
  weatherRow.className = "environment-weather";

  const dot = document.createElement("span");
  dot.className = "environment-weather-dot";
  dot.setAttribute("aria-hidden", "true");

  const text = document.createElement("span");
  text.textContent = `${weather.label} · ${weather.levelLabel}`;

  weatherRow.append(dot, text);
  element.append(time, weatherRow);
}
