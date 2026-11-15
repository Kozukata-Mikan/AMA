import {getVerticalExaggeration,unprojectDisplayPoint} from './relief-display.js';
import { gridPosition, readTerrainVertex, terrainMaximumHeight } from './terrain-data.js';
import { projectMap as project } from './map-display.js';

// 精确拾取完整网格。只检查视线穿过的单元，不使用显示层LOD。
export function pickProjectedTerrainPoint(terrain, point) {
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

  // 同一屏幕点反投影到不同高度时，x/y沿同一条线变化。
  // 按每个网格交点划分，只检查这条线经过的真实细网格三角面。
  const from = unprojectDisplayPoint(point);
  const delta = terrainMaximumHeight(terrain) * 0.75 * getVerticalExaggeration() / 0.43 / 2;
  const to = {x: from.x + delta, y: from.y + delta};
  const gx = x => (x + terrain.width / 2) / terrain.width * (terrain.cols - 1);
  const gy = y => (y + terrain.height / 2) / terrain.height * (terrain.rows - 1);
  const times = [0, 1];
  function crossings(a, b) {
    if (Math.abs(b-a) < 1e-9) return;
    for (let n = Math.ceil(Math.min(a,b)); n <= Math.floor(Math.max(a,b)); n++) {
      const t = (n-a)/(b-a); if (t > 0 && t < 1) times.push(t);
    }
  }
  crossings(gx(from.x), gx(to.x)); crossings(gy(from.y), gy(to.y));
  times.sort((a,b) => a-b);
  const visited = new Set();
  for (let i = 0; i < times.length; i++) {
    const t = i ? (times[i-1] + times[i])/2 : times[i];
    const col = Math.floor(gx(from.x + delta*t));
    const row = Math.floor(gy(from.y + delta*t));
    for (const r of [row-1, row, row+1]) for (const c of [col-1, col, col+1]) {
      if (c < 0 || r < 0 || c >= terrain.cols-1 || r >= terrain.rows-1) continue;
      const key = r * terrain.cols + c;
      if (visited.has(key)) continue;
      visited.add(key);
      const vertices = [[c,r], [c+1,r], [c+1,r+1], [c,r+1]].map(([cx,cy]) =>
        ({...gridPosition(terrain,cx,cy), z: readTerrainVertex(terrain,cx,cy)[0]}));
      test([vertices[0], vertices[1], vertices[2]]);
      test([vertices[0], vertices[2], vertices[3]]);
    }
  }

  return result;
}
