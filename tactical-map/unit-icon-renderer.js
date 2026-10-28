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
