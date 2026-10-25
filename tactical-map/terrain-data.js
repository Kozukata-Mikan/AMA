// ===== 地形数据与查询 =====
// 高度和河流标记分开存储。高度单位暂时沿用原地图单位。

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

export function validateTerrain(value) {
  if (!value || typeof value !== "object" || value.version !== 1) {
    throw new Error("地形データ形式が不正です。");
  }

  for (const key of ["width", "height"]) {
    if (
      typeof value[key] !== "number" ||
      !Number.isFinite(value[key]) ||
      value[key] < 120 ||
      value[key] > 1600
    ) {
      throw new Error("地図の幅と高さは 120～1600 で指定してください。");
    }
  }

  for (const key of ["cols", "rows"]) {
    if (
      !Number.isInteger(value[key]) ||
      value[key] < 9 ||
      value[key] > 121
    ) {
      throw new Error("地形の列数と行数は 9～121 の整数で指定してください。");
    }
  }

  const count = value.cols * value.rows;
    // 旧地图没有浅海字段，自动补为全零，不改变已有地形。
  const shallows = value.shallows === undefined
    ? Array(count).fill(0)
    : value.shallows;

  if (!Array.isArray(shallows) || shallows.length !== count) {
    throw new Error("浅海マスクの長さが一致しません。");
  }


  if (count > 10000) {
    throw new Error("地形の頂点数は 10000 以下にしてください。");
  }

  if (
    typeof value.contourInterval !== "number" ||
    !Number.isFinite(value.contourInterval) ||
    value.contourInterval < 5 ||
    value.contourInterval > 100
  ) {
    throw new Error("等高線間隔は 5～100 で指定してください。");
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

  const at = (c, r) => terrain.heights[r * terrain.cols + c];

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
  const river = terrain.rivers[nearestRow * terrain.cols + nearestCol] === 1;
  const shallow = terrain.shallows?.[nearestRow * terrain.cols + nearestCol] === 1;

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
    !Number.isFinite(width) || width < 120 || width > 1600 ||
    !Number.isFinite(height) || height < 120 || height > 1600 ||
    !Number.isInteger(cols) || cols < 9 || cols > 121 ||
    !Number.isInteger(rows) || rows < 9 || rows > 121 ||
    cols * rows > 10000
  ) {
    throw new Error("地図サイズまたはグリッド数が範囲外です。");
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
  if (!terrain.shallows) {
    terrain.shallows = Array(terrain.cols * terrain.rows).fill(0);
  }
  
  const old = terrain.heights.slice();
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

  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const position = gridPosition(terrain, col, row);
      const distance = Math.hypot(position.x - point.x, position.y - point.y);
      if (distance > radius) continue;

      const index = row * terrain.cols + col;
      const weight = 1 - distance / radius;
      const height = old[index];
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
          terrain.rivers[index] = 0;
          terrain.shallows[index] = 0;
          break;

        case "sea":
          next = Math.min(-1, height - strength * weight);
          terrain.rivers[index] = 0;
          terrain.shallows[index] = 0;
          break;


        case "river":
          // 河流不强制降低到海平面。
          if (height > 0) terrain.rivers[index] = 1;
          break;

        case "eraseRiver":
          terrain.rivers[index] = 0;
          break;

        case "shallow":
          // 浅海只在海域上绘制，不修改高度。
          if (height <= 0) terrain.shallows[index] = 1;
          break;

        case "eraseShallow":
          terrain.shallows[index] = 0;
          break;


        case "smooth": {
          let sum = 0;
          let count = 0;

          for (let r = Math.max(0, row - 1); r <= Math.min(terrain.rows - 1, row + 1); r++) {
            for (let c = Math.max(0, col - 1); c <= Math.min(terrain.cols - 1, col + 1); c++) {
              sum += old[r * terrain.cols + c];
              count++;
            }
          }

          next = height + (sum / count - height) *
            Math.min(1, strength / 10) * weight;
          break;
        }
      }

      terrain.heights[index] = Math.max(-200, Math.min(600, next));
    }
  }
}
