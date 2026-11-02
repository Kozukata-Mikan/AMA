import { sampleTerrain } from "./terrain-data.js";

// 只查询三维直线与真实地形的关系。
// 不修改场景，不判命中，不处理伤害，不推进阶段。

const EPSILON = 1e-10;

function requirePoint(value, label) {
  if (
    !value ||
    typeof value !== "object" ||
    !["x", "y", "z"].every(key =>
      typeof value[key] === "number" &&
      Number.isFinite(value[key])
    )
  ) {
    throw new Error(`${label}の三次元座標が不正です。`);
  }

  return {
    x: value.x,
    y: value.y,
    z: value.z
  };
}

function interpolate(start, end, t) {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
    z: start.z + (end.z - start.z) * t
  };
}

function normalizeCuts(values) {
  const sorted = values
    .filter(t =>
      Number.isFinite(t) &&
      t >= 0 &&
      t <= 1
    )
    .sort((a, b) => a - b);

  const result = [];

  for (const t of sorted) {
    if (
      !result.length ||
      t - result[result.length - 1] > EPSILON
    ) {
      result.push(t);
    }
  }

  // 保留精确端点，避免浮点合并缩短线段。
  result[0] = 0;
  result[result.length - 1] = 1;

  return result;
}

/**
 * 沿a-b-c / a-c-d真实三角网格划分三维线段。
 *
 * 输入地形应为场景内已经验证的地形。
 * start / end的z必须由调用方提供，不猜测单位高度。
 *
 * groundClearance：
 *   三维线高度减去真实地形高度，海域使用海床高度。
 *
 * surfaceClearance：
 *   三维线高度减去sampleTerrain返回的surface。
 *   海域surface为0，但不能据此认定海平面阻挡水下攻击。
 */
export function traceAttackTerrainLine(
  terrain,
  startValue,
  endValue
) {
  const start = requirePoint(startValue, "発射位置");
  const end = requirePoint(endValue, "目標位置");

  const startSample = sampleTerrain(
    terrain,
    start.x,
    start.y
  );

  const endSample = sampleTerrain(
    terrain,
    end.x,
    end.y
  );

  if (!startSample.inside || !endSample.inside) {
    throw new Error("攻撃線の両端を地図内に指定してください。");
  }

  const cellWidth = terrain.width / (terrain.cols - 1);
  const cellHeight = terrain.height / (terrain.rows - 1);

  const gx0 = (start.x + terrain.width / 2) / cellWidth;
  const gy0 = (start.y + terrain.height / 2) / cellHeight;
  const gx1 = (end.x + terrain.width / 2) / cellWidth;
  const gy1 = (end.y + terrain.height / 2) / cellHeight;

  const dgx = gx1 - gx0;
  const dgy = gy1 - gy0;

  const cuts = [0, 1];

  // 先沿网格纵线和横线分段。
  if (dgx !== 0) {
    for (let col = 1; col < terrain.cols - 1; col++) {
      const t = (col - gx0) / dgx;
      if (t > 0 && t < 1) cuts.push(t);
    }
  }

  if (dgy !== 0) {
    for (let row = 1; row < terrain.rows - 1; row++) {
      const t = (row - gy0) / dgy;
      if (t > 0 && t < 1) cuts.push(t);
    }
  }

  const cellCuts = normalizeCuts(cuts);

  // 每个单元内部再沿a-c对角线分段，即局部u=v。
  const diagonalDelta = dgx - dgy;

  if (diagonalDelta !== 0) {
    for (let index = 0; index < cellCuts.length - 1; index++) {
      const from = cellCuts[index];
      const to = cellCuts[index + 1];
      const middle = (from + to) / 2;

      const col = Math.max(
        0,
        Math.min(
          terrain.cols - 2,
          Math.floor(gx0 + dgx * middle)
        )
      );

      const row = Math.max(
        0,
        Math.min(
          terrain.rows - 2,
          Math.floor(gy0 + dgy * middle)
        )
      );

      const t = (
        col - row - (gx0 - gy0)
      ) / diagonalDelta;

      if (t > from && t < to) cuts.push(t);
    }
  }

  const triangleCuts = normalizeCuts(cuts);

  function readPoint(t) {
    const point = interpolate(start, end, t);
    const sample = sampleTerrain(
      terrain,
      point.x,
      point.y
    );

    if (!sample.inside) {
      throw new Error("攻撃線の地形を取得できません。");
    }

    return {
      t,
      ...point,
      groundHeight: sample.height,
      surfaceHeight: sample.surface,
      groundClearance: point.z - sample.height,
      surfaceClearance: point.z - sample.surface
    };
  }

  const points = triangleCuts.map(readPoint);
  const segments = [];

  for (let index = 0; index < points.length - 1; index++) {
    const from = points[index];
    const to = points[index + 1];

    const minGroundClearance = Math.min(
      from.groundClearance,
      to.groundClearance
    );

    segments.push({
      from,
      to,
      minGroundClearance,
      maxGroundHeight: Math.max(
        from.groundHeight,
        to.groundHeight
      )
    });
  }

  return {
    version: 1,
    start,
    end,
    distance3D: Math.hypot(
      end.x - start.x,
      end.y - start.y,
      end.z - start.z
    ),
    points,
    segments,
    minGroundClearance: Math.min(
      ...points.map(point => point.groundClearance)
    ),
    maxGroundHeight: Math.max(
      ...points.map(point => point.groundHeight)
    )
  };
}

/**
 * 几何诊断：直线是否进入真实地形内部。
 *
 * 接触表面不在本函数中自动判为阻挡，
 * 避免地面发射点、地面目标在端点被误判。
 *
 * 返回false不等于允许攻击：
 * 仍需检查观察、引导、射程、射高和目标资格。
 */
export function entersTerrainInterior(
  trace,
  tolerance = 1e-7
) {
  if (
    !trace ||
    !Number.isFinite(trace.minGroundClearance)
  ) {
    throw new Error("攻撃線の地形照合結果が不正です。");
  }

  if (
    typeof tolerance !== "number" ||
    !Number.isFinite(tolerance) ||
    tolerance < 0
  ) {
    throw new Error("地形照合の許容誤差が不正です。");
  }

  return trace.minGroundClearance < -tolerance;
}
