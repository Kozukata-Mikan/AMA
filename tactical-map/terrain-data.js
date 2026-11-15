// ===== 地形数据与查询 =====
// v1保留旧密集网格；v2保存原地形和稀疏精细顶点，不为整张大地图预分配数组。
// 两种格式共用精确三角面插值，显示抽样不得用于规则判定。
export const MAX_TERRAIN_SAMPLES = 7201;
export const DENSE_TERRAIN_LIMIT = 10000;

const inheritedVertices = new WeakMap();
const maximumHeights = new WeakMap();

export function readTerrainVertex(terrain, col, row) {
  const index = row * terrain.cols + col;
  if (terrain.version === 1) {
    return [terrain.heights[index], terrain.rivers[index], terrain.shallows?.[index] ?? 0];
  }
  const patch = terrain.vertices[index];
  if (patch !== undefined) return patch;
  let cache = inheritedVertices.get(terrain);
  if (!cache) { cache = new Map(); inheritedVertices.set(terrain, cache); }
  if (cache.has(index)) return cache.get(index);
  const p = gridPosition(terrain, col, row);
  const vertex = terrain.base ? sampleTerrainVertex(terrain.base, p.x, p.y) : [-20, 0, 0];
  // 基底是创建/验证时的独立快照，不会被笔刷修改。限制查询缓存的内存占用。
  if (cache.size >= 16384) cache.clear();
  cache.set(index, vertex);
  return vertex;
}

// 保留被高度暂时隐藏的河流/浅海标记，与旧版网格语义一致。
function sampleTerrainVertex(terrain, x, y) {
  const sample = sampleTerrain(terrain, x, y);
  if (!sample.inside) return [-20, 0, 0];
  const col = Math.min(terrain.cols - 1, Math.max(0, Math.round(
    (x + terrain.width / 2) / terrain.width * (terrain.cols - 1))));
  const row = Math.min(terrain.rows - 1, Math.max(0, Math.round(
    (y + terrain.height / 2) / terrain.height * (terrain.rows - 1))));
  const vertex = readTerrainVertex(terrain, col, row);
  return [sample.height, vertex[1], vertex[2]];
}

function writeTerrainVertex(terrain, col, row, vertex) {
  const index = row * terrain.cols + col;
  if (terrain.version === 2) terrain.vertices[index] = vertex;
  else {
    terrain.heights[index] = vertex[0];
    terrain.rivers[index] = vertex[1];
    terrain.shallows[index] = vertex[2];
  }
}

export function terrainMaximumHeight(terrain) {
  if (Object.isFrozen(terrain) && maximumHeights.has(terrain)) return maximumHeights.get(terrain);
  let maximum = 0;
  if (terrain.version === 2) {
    if (terrain.base) maximum = terrainMaximumHeight(terrain.base);
    for (const v of Object.values(terrain.vertices)) maximum = Math.max(maximum, v[0]);
  } else {
    for (const h of terrain.heights) maximum = Math.max(maximum, h);
  }
  if (Object.isFrozen(terrain)) maximumHeights.set(terrain, maximum);
  return maximum;
}

export function cloneTerrain(value) {
  return JSON.parse(JSON.stringify(value));
}

function demoHeight(x, y) {
  const a = 65 * Math.exp(
    -(((x + 80) / 105) ** 2 + ((y + 15) / 80) ** 2)
  );

  const b = 60 * Math.exp(
    -(((x - 75) / 95) ** 2 + ((y - 25) / 100) ** 2)
  );

  return a + b + 2 * Math.sin(x / 24) * Math.cos(y / 29) - 19;
}

export function createDemoTerrain() {
  const terrain = {
    version: 1,
    width: 600,
    height: 600,
    cols: 81,
    rows: 81,
    contourInterval: 6,
    heights: [],
    rivers: [],
    shallows: []
    
  };

  for (let row = 0; row < terrain.rows; row++) {
    for (let col = 0; col < terrain.cols; col++) {
      const { x, y } = gridPosition(terrain, col, row);
      terrain.heights.push(demoHeight(x, y));
      terrain.rivers.push(0);
      terrain.shallows.push(0);
    }
  }

  return terrain;
}

export function validateTerrain(value, depth = 0) {
  if (!value || typeof value !== "object" || ![1, 2].includes(value.version) || depth > 16) {
    throw new Error("地形データ形式が不正です。");
  }

  for (const key of ["width", "height"]) {
    if (
      typeof value[key] !== "number" ||
      !Number.isFinite(value[key]) ||
      value[key] < 120 ||
      value[key] > 7200
    ) {
      throw new Error("地図の幅と高さは 120～7200 で指定してください。");
    }
  }

  for (const key of ["cols", "rows"]) {
    if (
      !Number.isInteger(value[key]) ||
      value[key] < 9 ||
      value[key] > MAX_TERRAIN_SAMPLES
    ) {
      throw new Error("地形の列数と行数は 9～7201 の整数で指定してください。");
    }
  }

  const count = value.cols * value.rows;
  if (
    typeof value.contourInterval !== "number" ||
    !Number.isFinite(value.contourInterval) ||
    value.contourInterval < 5 ||
    value.contourInterval > 100
  ) {
    throw new Error("等高線間隔は 5～100 で指定してください。");
  }

  if (value.version === 2) {
    if (!value.vertices || typeof value.vertices !== "object" || Array.isArray(value.vertices)) {
      throw new Error("精細地形の頂点データが不正です。");
    }
    const vertices = {};
    for (const [key, v] of Object.entries(value.vertices)) {
      const index = Number(key);
      if (!Number.isSafeInteger(index) || index < 0 || index >= count || String(index) !== key ||
          !Array.isArray(v) || v.length !== 3 || !Number.isFinite(v[0]) ||
          v[0] < -200 || v[0] > 600 || ![0, 1].includes(v[1]) || ![0, 1].includes(v[2])) {
        throw new Error("精細地形の頂点が範囲外です。");
      }
      vertices[key] = v.slice();
    }
    return {
      version: 2, width: value.width, height: value.height,
      cols: value.cols, rows: value.rows, contourInterval: value.contourInterval,
      base: value.base === null ? null : validateTerrain(value.base, depth + 1), vertices
    };
  }
  if (count > DENSE_TERRAIN_LIMIT) {
    throw new Error("大きい地形は精細地形形式で保存してください。");
  }
  const shallows = value.shallows === undefined ? Array(count).fill(0) : value.shallows;
  if (!Array.isArray(shallows) || shallows.length !== count) {
    throw new Error("浅海マスクの長さが一致しません。");
  }

  if (
    !Array.isArray(value.heights) ||
    !Array.isArray(value.rivers) ||
    value.heights.length !== count ||
    value.rivers.length !== count
  ) {
    throw new Error("地形グリッドの長さが一致しません。");
  }

  for (let index = 0; index < count; index++) {
    const height = value.heights[index];
    const river = value.rivers[index];
    const shallow = shallows[index];


    if (
      typeof height !== "number" ||
      !Number.isFinite(height) ||
      height < -200 ||
      height > 600
    ) {
      throw new Error("地形高度は -200～600 の範囲で指定してください。");
    }

    if (river !== 0 && river !== 1) {
      throw new Error("河川マスクの値が不正です。");
    }
        if (shallow !== 0 && shallow !== 1) {
      throw new Error("浅海マスクの値が不正です。");
    }

  }

  return {
    version: 1,
    width: value.width,
    height: value.height,
    cols: value.cols,
    rows: value.rows,
    contourInterval: value.contourInterval,
    heights: value.heights.slice(),
    rivers: value.rivers.slice(),
    shallows: shallows.slice()
  };
}

export function gridPosition(terrain, col, row) {
  return {
    x: -terrain.width / 2 + col * terrain.width / (terrain.cols - 1),
    y: -terrain.height / 2 + row * terrain.height / (terrain.rows - 1)
  };
}

export function sampleTerrain(terrain, x, y) {
  const inside =
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Math.abs(x) <= terrain.width / 2 &&
    Math.abs(y) <= terrain.height / 2;

  if (!inside) {
    return {
      inside: false,
      height: -20,
      surface: 0,
      kind: "outside"
    };
  }

  const gx = (x + terrain.width / 2) / terrain.width * (terrain.cols - 1);
  const gy = (y + terrain.height / 2) / terrain.height * (terrain.rows - 1);

  const col = Math.min(terrain.cols - 2, Math.floor(gx));
  const row = Math.min(terrain.rows - 2, Math.floor(gy));
  const u = gx - col;
  const v = gy - row;

  const at = (c, r) => readTerrainVertex(terrain, c, r)[0];

  const a = at(col, row);
  const b = at(col + 1, row);
  const c = at(col + 1, row + 1);
  const d = at(col, row + 1);

  // 与等高线采用相同的 a-b-c / a-c-d 三角形划分。
  const height = u >= v
    ? a + (b - a) * u + (c - b) * v
    : a + (c - d) * u + (d - a) * v;

  // 河流标记采用最近网格顶点的分区。
  const nearestCol = Math.min(terrain.cols - 1, Math.round(gx));
  const nearestRow = Math.min(terrain.rows - 1, Math.round(gy));
  const marker = readTerrainVertex(terrain, nearestCol, nearestRow);
  const river = marker[1] === 1;
  const shallow = marker[2] === 1;

  const kind = height <= 0
    ? shallow ? "shallow" : "sea"
    : river ? "river" : "land";


  return {
    inside: true,
    height,
    surface: Math.max(0, height),
    kind
  };
}

export function resizeTerrain(source, settings) {
  const width = Number(settings.width);
  const height = Number(settings.height);
  const cols = Number(settings.cols);
  const rows = Number(settings.rows);

  // 先验证参数，避免创建过大的数组。
  if (
    !Number.isFinite(width) || width < 120 || width > 7200 ||
    !Number.isFinite(height) || height < 120 || height > 7200 ||
    !Number.isInteger(cols) || cols < 9 || cols > MAX_TERRAIN_SAMPLES ||
    !Number.isInteger(rows) || rows < 9 || rows > MAX_TERRAIN_SAMPLES
  ) {
    throw new Error("地図サイズまたはグリッド数が範囲外です。");
  }

  if (cols * rows > DENSE_TERRAIN_LIMIT) {
    // 基底保留原始精度。细网格只保存实际修改的顶点。
    // 尺寸/精度未变时不增加嵌套，也不丢弃既有精细编辑。
    if (source.version === 2 && width === source.width && height === source.height &&
        cols === source.cols && rows === source.rows) {
      return validateTerrain({...source, contourInterval: Number(settings.contourInterval)});
    }
    return validateTerrain({
      version: 2, width, height, cols, rows,
      contourInterval: Number(settings.contourInterval),
      base: source, vertices: {}
    });
  }

  const result = {
    version: 1,
    width,
    height,
    cols,
    rows,
    contourInterval: Number(settings.contourInterval),
    heights: [],
    rivers: [],
    shallows: []
  };

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const point = gridPosition(result, col, row);
      const sample = sampleTerrain(source, point.x, point.y);

      // 新增范围默认是海洋，不复制旧地图边缘。
      result.heights.push(sample.inside ? sample.height : -20);
      result.rivers.push(sample.kind === "river" ? 1 : 0);
      result.shallows.push(sample.kind === "shallow" ? 1 : 0);
    }
  }

  return validateTerrain(result);
}

export function applyBrush(terrain, point, brush) {
  const radius = Number(brush.radius);
  const strength = Number(brush.strength);
  const target = Number(brush.target);

  if (
    !Number.isFinite(radius) || radius < 5 || radius > 200 ||
    !Number.isFinite(strength) || strength < 0.1 || strength > 50 ||
    !Number.isFinite(target) || target < -200 || target > 600
  ) {
    throw new Error("ブラシ設定が範囲外です。");
  }

  const modes = [
    "raise",
    "lower",
    "smooth",
    "level",
    "land",
    "sea",
    "river",
    "eraseRiver",
    "shallow",
    "eraseShallow"
  ];

  if (!modes.includes(brush.mode)) {
    throw new Error("不明なブラシです。");
  }

// 防御性兼容：工作副本也允许从没有浅海字段的旧地图生成。
  if (terrain.version === 1 && !terrain.shallows) {
    terrain.shallows = Array(terrain.cols * terrain.rows).fill(0);
  }
  
  // 只在平滑笔刷需要邻域快照，避免每次移动都复制整张高度网格。
  const old = new Map();
  const dx = terrain.width / (terrain.cols - 1);
  const dy = terrain.height / (terrain.rows - 1);

  const minCol = Math.max(0, Math.floor(
    (point.x - radius + terrain.width / 2) / dx
  ));

  const maxCol = Math.min(terrain.cols - 1, Math.ceil(
    (point.x + radius + terrain.width / 2) / dx
  ));

  const minRow = Math.max(0, Math.floor(
    (point.y - radius + terrain.height / 2) / dy
  ));

  const maxRow = Math.min(terrain.rows - 1, Math.ceil(
    (point.y + radius + terrain.height / 2) / dy
  ));

  if (brush.mode === "smooth") {
    for (let r = Math.max(0, minRow - 1); r <= Math.min(terrain.rows - 1, maxRow + 1); r++) {
      for (let c = Math.max(0, minCol - 1); c <= Math.min(terrain.cols - 1, maxCol + 1); c++) {
        old.set(r * terrain.cols + c, readTerrainVertex(terrain, c, r)[0]);
      }
    }
  }

  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const position = gridPosition(terrain, col, row);
      const distance = Math.hypot(position.x - point.x, position.y - point.y);
      if (distance > radius) continue;

      const index = row * terrain.cols + col;
      const weight = 1 - distance / radius;
      const vertex = readTerrainVertex(terrain, col, row).slice();
      const height = old.get(index) ?? vertex[0];
      let next = height;

      switch (brush.mode) {
        case "raise":
          next = height + strength * weight;
          break;

        case "lower":
          next = height - strength * weight;
          break;

        case "level":
          next = height + (target - height) *
            Math.min(1, strength / 10) * weight;
          break;

        case "land":
          next = Math.max(1, height + strength * weight);
          vertex[1] = 0;
          vertex[2] = 0;
          break;

        case "sea":
          next = Math.min(-1, height - strength * weight);
          vertex[1] = 0;
          vertex[2] = 0;
          break;


        case "river":
          // 河流不强制降低到海平面。
          if (height > 0) vertex[1] = 1;
          break;

        case "eraseRiver":
          vertex[1] = 0;
          break;

        case "shallow":
          // 浅海只在海域上绘制，不修改高度。
          if (height <= 0) vertex[2] = 1;
          break;

        case "eraseShallow":
          vertex[2] = 0;
          break;


        case "smooth": {
          let sum = 0;
          let count = 0;

          for (let r = Math.max(0, row - 1); r <= Math.min(terrain.rows - 1, row + 1); r++) {
            for (let c = Math.max(0, col - 1); c <= Math.min(terrain.cols - 1, col + 1); c++) {
              sum += old.get(r * terrain.cols + c);
              count++;
            }
          }

          next = height + (sum / count - height) *
            Math.min(1, strength / 10) * weight;
          break;
        }
      }

      vertex[0] = Math.max(-200, Math.min(600, next));
      writeTerrainVertex(terrain, col, row, vertex);
    }
  }
}
