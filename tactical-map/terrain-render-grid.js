import { gridPosition, readTerrainVertex, terrainMaximumHeight } from './terrain-data.js';

// 仅供显示：原始地形不重采样保存，规则继续读取terrain-data的完整网格。
export function terrainRenderWindow(terrain, view, box, maxCells = 128) {
  let x0 = -terrain.width / 2, x1 = terrain.width / 2;
  let y0 = -terrain.height / 2, y1 = terrain.height / 2;
  if (view && box && view.scale > 0) {
    const xs = [], ys = [];
    const highest = terrainMaximumHeight(terrain);
    for (const sx of [box.x, box.x + box.width]) {
      for (const sy of [box.y, box.y + box.height]) {
        for (const z of [0, highest]) {
          const difference = ((sx - view.x) / view.scale - 500) / 0.95;
          const sum = ((sy - view.y) / view.scale - 340 + z * 0.75) / 0.43;
          xs.push((sum + difference) / 2);
          ys.push((sum - difference) / 2);
        }
      }
    }
    x0 = Math.max(x0, Math.min(...xs)); x1 = Math.min(x1, Math.max(...xs));
    y0 = Math.max(y0, Math.min(...ys)); y1 = Math.min(y1, Math.max(...ys));
  }
  if (x0 > x1 || y0 > y1) return {cols: [], rows: [], key: 'outside'};
  const indices = (min, max, length, count) => {
    const lo = Math.max(0, Math.floor((min + length / 2) / length * (count - 1)) - 1);
    const hi = Math.min(count - 1, Math.ceil((max + length / 2) / length * (count - 1)) + 1);
    const step = 2 ** Math.max(0, Math.ceil(Math.log2(Math.max(1, (hi - lo) / maxCells))));
    const values = [];
    const start = Math.max(0, Math.floor(lo / step) * step);
    const end = Math.min(count - 1, Math.ceil(hi / step) * step);
    for (let n = start; n < end; n += step) values.push(n);
    values.push(end);
    return values;
  };
  const cols = indices(x0, x1, terrain.width, terrain.cols);
  const rows = indices(y0, y1, terrain.height, terrain.rows);
  return { cols, rows, key: `${cols[0]}:${cols.at(-1)}:${cols[1]-cols[0]}:${rows[0]}:${rows.at(-1)}:${rows[1]-rows[0]}` };
}

export function makeTerrainRenderGrid(terrain, window = terrainRenderWindow(terrain)) {
  return window.rows.map(row => window.cols.map(col => {
    const vertex = readTerrainVertex(terrain, col, row);
    const z = vertex[0];
    return { ...gridPosition(terrain, col, row), z, col, row,
      kind: z <= 0 ? vertex[2] ? 'shallow' : 'sea' : vertex[1] ? 'river' : 'land' };
  }));
}
