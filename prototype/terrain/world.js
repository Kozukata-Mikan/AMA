import {
  createDemoTerrain,
  sampleTerrain,
  validateTerrain,
} from "../../tactical-map/terrain-data.js";

const format = "AMA-preview-world-v1";
export const worldSize = 14401;
export function createLargeWorld() {
  return {
    format,
    width: worldSize,
    height: worldSize,
    base: createDemoTerrain(),
  };
}
export function readWorld(value) {
  if (value?.format !== format) return validateTerrain(value);
  if (value.width !== worldSize || value.height !== worldSize)
    throw Error("大地图尺寸无效");
  return {
    format,
    width: worldSize,
    height: worldSize,
    base: validateTerrain(value.base),
  };
}
export function sampleWorld(t, x, y) {
  if (t.format !== format) return sampleTerrain(t, x, y);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    Math.abs(x) > t.width / 2 ||
    Math.abs(y) > t.height / 2
  )
    return { inside: false, height: -20, surface: 0, kind: "outside" };
  return sampleTerrain(
    t.base,
    (x / t.width) * t.base.width,
    (y / t.height) * t.base.height,
  );
}
