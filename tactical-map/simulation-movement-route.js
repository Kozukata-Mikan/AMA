import { sampleTerrain } from "./terrain-data.js";

const EPS = 1e-7;
const CONTACT = 1;
const copy = value => JSON.parse(JSON.stringify(value));

function fail(message) {
  throw new Error(message);
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function interpolate(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t
  };
}

export function routeLength(route) {
  let result = 0;

  for (let i = 1; i < route.length; i++) {
    result += distance(route[i - 1], route[i]);
  }

  return result;
}

export function trimRoute(route, budget) {
  if (!Number.isFinite(budget) || budget < 0) {
    fail("移動経路の距離予算が不正です。");
  }

  const result = [copy(route[0])];
  let remaining = budget;

  for (let i = 1; i < route.length; i++) {
    const from = route[i - 1];
    const to = route[i];
    const length = distance(from, to);

    if (length <= EPS) continue;

    if (length > remaining) {
      if (remaining > EPS) {
        result.push(interpolate(from, to, remaining / length));
      }

      break;
    }

    result.push(copy(to));
    remaining = Math.max(0, remaining - length);
  }

  return result;
}

// 精确划分网格三角面与最近顶点遮罩分区。
// 不用固定步长采样，避免漏过狭窄陆地。
function terrainIntervals(terrain, from, to) {
  const x0 = (from.x + terrain.width / 2) *
    (terrain.cols - 1) / terrain.width;
  const y0 = (from.y + terrain.height / 2) *
    (terrain.rows - 1) / terrain.height;

  const dx = (to.x - from.x) *
    (terrain.cols - 1) / terrain.width;
  const dy = (to.y - from.y) *
    (terrain.rows - 1) / terrain.height;

  const values = [0, 1];

  function add(origin, delta, first, last, offset = 0) {
    if (Math.abs(delta) <= EPS) return;

    for (let n = first; n <= last; n++) {
      const t = (n + offset - origin) / delta;
      if (t > 0 && t < 1) values.push(t);
    }
  }

  add(x0, dx, 0, terrain.cols - 1);
  add(y0, dy, 0, terrain.rows - 1);
  add(x0 - y0, dx - dy, -(terrain.rows - 1), terrain.cols - 1);

  // 河流、浅海mask使用最近顶点分区。
  add(x0, dx, 0, terrain.cols - 2, 0.5);
  add(y0, dy, 0, terrain.rows - 2, 0.5);

  // 每个三角面内地形高度线性，加入海岸零高度交点。
  const base = [...new Set(values)].sort((a, b) => a - b);

  for (let i = 1; i < base.length; i++) {
    const a = base[i - 1];
    const b = base[i];
    const pa = interpolate(from, to, a);
    const pb = interpolate(from, to, b);
    const ha = sampleTerrain(terrain, pa.x, pa.y).height;
    const hb = sampleTerrain(terrain, pb.x, pb.y).height;

    if ((ha < 0 && hb > 0) || (ha > 0 && hb < 0)) {
      values.push(a + (b - a) * (-ha) / (hb - ha));
    }
  }

  return [...new Set(values)].sort((a, b) => a - b);
}

export function clipLandRoute(terrain, unit, route) {
  for (const point of route) {
    if (!sampleTerrain(terrain, point.x, point.y).inside) {
      fail("移動経路が地図の範囲外です。");
    }
  }

  // 本批不增加水下通行规则。
  if (unit.underwater === true) {
    return { route: copy(route), blocked: false };
  }

  if (sampleTerrain(terrain, route[0].x, route[0].y).kind === "land") {
    fail("水面艦の開始位置が陸地です。配置を確認してください。");
  }

  const result = [copy(route[0])];

  for (let i = 1; i < route.length; i++) {
    const from = route[i - 1];
    const to = route[i];
    const length = distance(from, to);

    if (length <= EPS) continue;

    const breaks = terrainIntervals(terrain, from, to);

    for (let j = 1; j < breaks.length; j++) {
      const middle = interpolate(
        from, to, (breaks[j - 1] + breaks[j]) / 2
      );

      if (sampleTerrain(terrain, middle.x, middle.y).kind !== "land") {
        continue;
      }

      // 停在陆地边界之前，不把终点放入陆地。
      const t = Math.max(0, breaks[j - 1] - EPS / length);

      if (t > EPS) result.push(interpolate(from, to, t));

      return { route: result, blocked: true };
    }

    if (sampleTerrain(terrain, to.x, to.y).kind === "land") {
      const t = Math.max(0, 1 - EPS / length);
      if (t > EPS) result.push(interpolate(from, to, t));
      return { route: result, blocked: true };
    }

    result.push(copy(to));
  }

  return { route: result, blocked: false };
}

function sameLayer(a, b) {
  if ((a.underwater === true) !== (b.underwater === true)) {
    return false;
  }

  if (a.underwater !== true) return true;

  if (
    !Number.isFinite(a.depth) || a.depth < 0 ||
    !Number.isFinite(b.depth) || b.depth < 0
  ) {
    fail("水中艦の衝突判定に必要な深度が不正です。");
  }

  return Math.abs(a.depth - b.depth) <= EPS;
}

function trajectory(unit, route, speed) {
  const length = routeLength(route);

  if (!Number.isFinite(speed) || speed < 0 || (length > EPS && speed <= 0)) {
    fail("移動時間軸の速力が不正です。");
  }

  const knots = [{ t: 0, ...copy(route[0]) }];
  let elapsed = 0;

  for (let i = 1; i < route.length; i++) {
    const part = distance(route[i - 1], route[i]);
    if (part <= EPS) continue;

    elapsed += part / speed;
    knots.push({ t: elapsed, ...copy(route[i]) });
  }

  if (elapsed > 1 + EPS) {
    fail("移動経路が本ラウンドの移動予算を超えています。");
  }

  return {
    unit,
    route,
    knots,
    stop: Math.min(1, elapsed),
    moving: length > EPS,
    reason: null
  };
}

function positionAt(track, time) {
  const t = Math.min(time, track.stop);
  const knots = track.knots;

  for (let i = 1; i < knots.length; i++) {
    if (t <= knots[i].t) {
      const span = knots[i].t - knots[i - 1].t;
      return interpolate(
        knots[i - 1],
        knots[i],
        span <= EPS ? 0 : (t - knots[i - 1].t) / span
      );
    }
  }

  return copy(knots[knots.length - 1]);
}

function firstContact(a, b, now) {
  const times = [
    now, 1, a.stop, b.stop,
    ...a.knots.map(k => k.t),
    ...b.knots.map(k => k.t)
  ].filter(t => t >= now && t <= 1);

  const ordered = [...new Set(times)].sort((x, y) => x - y);

  for (let i = 1; i < ordered.length; i++) {
    const start = ordered[i - 1];
    const end = ordered[i];
    const span = end - start;
    if (span <= EPS) continue;

    const pa = positionAt(a, start);
    const pb = positionAt(b, start);
    const qa = positionAt(a, end);
    const qb = positionAt(b, end);

    const rx = pa.x - pb.x;
    const ry = pa.y - pb.y;
    const vx = ((qa.x - pa.x) - (qb.x - pb.x)) / span;
    const vy = ((qa.y - pa.y) - (qb.y - pb.y)) / span;

    const aa = vx * vx + vy * vy;
    const bb = 2 * (rx * vx + ry * vy);
    const cc = rx * rx + ry * ry - CONTACT * CONTACT;

    // 已经接触但正在分离或保持间距，不重复认定撞击。
    if (cc <= EPS) {
      if (bb < -EPS) return start;
      continue;
    }

    if (aa <= EPS) continue;

    const disc = bb * bb - 4 * aa * cc;
    if (disc < 0) continue;

    const offset = (-bb - Math.sqrt(disc)) / (2 * aa);

    if (offset >= -EPS && offset <= span + EPS) {
      return Math.max(start, Math.min(end, start + offset));
    }
  }

  return null;
}

/**
 * 全场同一时间轴：
 * 发现首次接触 -> 同时截停 -> 重算后续接触。
 * 返回实际航迹和撞击对；不应用伤害、不修改scene。
 */
export function resolveMovementRoutes(scene, destinations, getLimit) {
  const requested = new Map();

  for (const item of destinations) {
    if (requested.has(item.instanceId)) {
      fail("同じ艦船の移動経路が重複しています。");
    }
    requested.set(item.instanceId, item);
  }

  const tracks = [];

  for (const unit of scene.instances) {
    if (
      unit.branch !== "navy" ||
      !Number.isFinite(unit.x) ||
      !Number.isFinite(unit.y)
    ) continue;

    const item = requested.get(unit.instanceId);
    const input = item?.route ?? [{ x: unit.x, y: unit.y }];
    const clipped = clipLandRoute(
      scene.terrain,
      unit,
      input
    );

    const track = trajectory(
      unit,
      clipped.route,
      item ? getLimit(unit) : 0
    );

    if (clipped.blocked) track.reason = "land";
    tracks.push(track);
  }

  // 旧集群可能重叠部署。不能把这种状态自动当作新撞击扣血。
  // 有移动参与时要求先使用合法的分散部署。
  for (let i = 0; i < tracks.length; i++) {
    for (let j = i + 1; j < tracks.length; j++) {
      const a = tracks[i];
      const b = tracks[j];

      if (
        sameLayer(a.unit, b.unit) &&
        (a.moving || b.moving) &&
        distance(a.route[0], b.route[0]) < CONTACT - EPS
      ) {
        fail(
          "移動開始時に艦船の占位が重複しています。" +
          "重複した集群は、この衝突規則で移動できません。"
        );
      }
    }
  }

  const contacted = new Set();
  const collisions = [];
  let now = 0;

  while (now < 1 - EPS) {
    let earliest = null;
    let events = [];

    for (let i = 0; i < tracks.length; i++) {
      for (let j = i + 1; j < tracks.length; j++) {
        const a = tracks[i];
        const b = tracks[j];
        const key = JSON.stringify([i, j]);

        if (
          contacted.has(key) ||
          !sameLayer(a.unit, b.unit) ||
          (
            (!a.moving || a.stop <= now + EPS) &&
            (!b.moving || b.stop <= now + EPS)
          )
        ) continue;

        const time = firstContact(a, b, now);
        if (time === null) continue;

        if (earliest === null || time < earliest - EPS) {
          earliest = time;
          events = [{ a, b, key }];
        } else if (Math.abs(time - earliest) <= EPS) {
          events.push({ a, b, key });
        }
      }
    }

    if (earliest === null) break;

    // 先收集同时接触的双方，再统一截停。
    for (const event of events) {
      contacted.add(event.key);

      const wreck =
        event.a.unit.shipState.status === "sunk" ||
        event.b.unit.shipState.status === "sunk";

      event.a.stop = Math.min(event.a.stop, earliest);
      event.b.stop = Math.min(event.b.stop, earliest);
      event.a.reason = wreck ? "wreck" : "collision";
      event.b.reason = wreck ? "wreck" : "collision";

      if (!wreck) {
        collisions.push({
          time: earliest,
          unitIds: [
            event.a.unit.instanceId,
            event.b.unit.instanceId
          ]
        });
      }
    }

    now = earliest;
  }

  const results = [];

  for (const track of tracks) {
    if (!requested.has(track.unit.instanceId)) continue;

    const actualDistance = Math.min(
      routeLength(track.route),
      getLimit(track.unit) * track.stop
    );

    const route = trimRoute(track.route, actualDistance);
    const end = route[route.length - 1];

    results.push({
      instanceId: track.unit.instanceId,
      route,
      x: end.x,
      y: end.y,
      distance: routeLength(route),
      stoppedBy: track.reason
    });
  }

  return { destinations: results, collisions };
}
