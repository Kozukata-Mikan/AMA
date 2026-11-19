// Display metadata only: independent of naval type codes and combat rules.
export const NAVAL_SYMBOL_OPTIONS = [
  ["combat", "戦闘艦"],
  ["auxiliary", "補助艦"],
  ["recon", "偵察艦"],
  ["armored", "装甲艦"],
  ["carrier", "航空艦"],
];
// Both map renderers use 55% of the previous standalone naval icon size.
export const NAVAL_ICON_SCALE = 0.5 * 0.55;
export function normalizeNavalSymbol(value) {
  if (value === undefined || value === null || value === "") return "combat";
  if (!NAVAL_SYMBOL_OPTIONS.some(([key]) => key === value))
    throw new Error("艦船マークの種類が不正です。");
  return value;
}
export function navalSymbolFor(unit) {
  const type = unit.snapshot?.naval?.iconType ?? unit.naval?.iconType;
  return NAVAL_SYMBOL_OPTIONS.some(([key]) => key === type) ? type : "combat";
}
const pathCache = new Map();
export function navalSymbolPath(type = "combat", sizeLevel = 1) {
  type = normalizeNavalSymbol(type);
  const level = Math.max(1, Math.min(5, Math.round(Number(sizeLevel) || 1)));
  const cacheKey = `${type}:${level}`;
  if (pathCache.has(cacheKey)) return pathCache.get(cacheKey);
  const length = 24 * [1, 1.5, 2, 2.5, 3][level - 1];
  const bow = -length * 0.65, stern = length * 0.35, width = 8;
  let points;
  const arc = (cx, cy, radius, start, end) => Array.from({length: 17}, (_, i) => {
    const a = start + (end - start) * i / 16;
    return [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius];
  });
  switch (type) {
    case "auxiliary":
      points = [...arc(0, bow + width, width, Math.PI, 2 * Math.PI), [width, stern], [-width, stern]];
      break;
    case "recon":
      points = [[0, bow], [width, stern - width], ...arc(0, stern - width, width, 0, Math.PI)];
      break;
    case "armored":
      points = [[0, bow], [width, bow + length * .34], [width * .65, stern], [-width * .65, stern], [-width, bow + length * .34]];
      break;
    case "carrier":
      points = [[-width * .55, bow], [width * .55, bow], [width, bow + length * .25], [width, stern - width], ...arc(0, stern - width, width, 0, Math.PI), [-width, bow + length * .25]];
      break;
    default:
      points = [[0, bow], [width, stern - length * .18], [0, stern], [-width, stern - length * .18]];
  }
  const path = points.map(([x,y], i) => `${i ? "L" : "M"} ${x.toFixed(4)} ${y.toFixed(4)}`).join(" ") + " Z";
  pathCache.set(cacheKey, path);
  return path;
}
