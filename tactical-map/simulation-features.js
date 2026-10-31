import {
  readShipProfile,
  getReconConditions
} from "./ship-runtime.js";
import { sampleTerrain } from "./terrain-data.js";

const SIDES = ["ally", "enemy", "neutral"];
const GRADES = ["F", "E", "D", "C", "B", "A", "S", "U"];
const EPSILON = 1e-7;

const clone = value => JSON.parse(JSON.stringify(value));

function fail(message) {
  throw new Error(message);
}

function positioned(unit) {
  return Number.isFinite(unit.x) && Number.isFinite(unit.y);
}

function operational(unit) {
  if (!positioned(unit)) return false;

  if (unit.branch === "navy") {
    return !["sinking", "sunk"].includes(unit.shipState?.status) &&
      unit.shipState?.rescueTaskId === null;
  }

  // 其他兵种的完整行动规则尚未定义。
  // 已经明确耐性为0的单位不作为侦察来源。
  return Number.isFinite(unit.currentHp) && unit.currentHp > 0;
}

export function initializeSimulationFeatures(scene) {
  scene.controls ??= {};
  scene.controls.enemyAutonomy =
    scene.controls.enemyAutonomy === true;

  if (scene.controls.observationSide === undefined) {
    scene.controls.observationSide = "ally";
  }

  if (!SIDES.includes(scene.controls.observationSide)) {
    fail("観察陣営の保存値が不正です。");
  }

  if (scene.controls.enemyAutonomy) {
    scene.controls.observationSide = "ally";
  }

  scene.movementPlans ??= [];

  if (!Array.isArray(scene.movementPlans)) {
    fail("移動計画の保存形式が不正です。");
  }
}

export function getObservationSide(scene) {
  return scene.controls?.enemyAutonomy
    ? "ally"
    : scene.controls?.observationSide ?? "ally";
}

/**
 * 直线与真实网格三角面的交点参数。
 * 每个区间内地形高度是线性的，最大值必在区间端点。
 * 不使用显示层的降采样网格，也不使用固定步长采样。
 */
function terrainBreaks(terrain, from, to) {
  const x0 =
    (from.x + terrain.width / 2) *
    (terrain.cols - 1) / terrain.width;

  const y0 =
    (from.y + terrain.height / 2) *
    (terrain.rows - 1) / terrain.height;

  const dx =
    (to.x - from.x) *
    (terrain.cols - 1) / terrain.width;

  const dy =
    (to.y - from.y) *
    (terrain.rows - 1) / terrain.height;

  const values = [0, 1];

  function crossings(origin, delta, first, last) {
    if (Math.abs(delta) < EPSILON) return;

    for (let n = first; n <= last; n++) {
      const t = (n - origin) / delta;
      if (t > 0 && t < 1) values.push(t);
    }
  }

  crossings(x0, dx, 0, terrain.cols - 1);
  crossings(y0, dy, 0, terrain.rows - 1);

  // 每个单元的a-c对角线满足gx-gy为整数。
  crossings(
    x0 - y0,
    dx - dy,
    -(terrain.rows - 1),
    terrain.cols - 1
  );

  return values.sort((a, b) => a - b);
}

export function isTerrainBlocked(terrain, from, to) {
  if (!positioned(from) || !positioned(to)) return true;

  if (
    !sampleTerrain(terrain, from.x, from.y).inside ||
    !sampleTerrain(terrain, to.x, to.y).inside
  ) {
    return true;
  }

  if (Math.hypot(to.x - from.x, to.y - from.y) < EPSILON) {
    return false;
  }

  for (const t of terrainBreaks(terrain, from, to)) {
    // 本规则检查两点之间的地形，不把单位自身所在端点算作障碍。
    if (t <= 0 || t >= 1) continue;

    const sample = sampleTerrain(
      terrain,
      from.x + (to.x - from.x) * t,
      from.y + (to.y - from.y) * t
    );

    if (sample.height >= 30) return true;
  }

  // 若端点高度超过30，其邻近的开放区间也超过30。
  // 若端点恰好为30且立即下降，则端点自身不阻挡。
  for (const point of [from, to]) {
    if (sampleTerrain(terrain, point.x, point.y).height > 30) {
      return true;
    }
  }

  return false;
}

function navalGrade(unit, key) {
  const value = unit.snapshot?.naval?.[key];
  return GRADES.includes(value) ? GRADES.indexOf(value) : null;
}

/**
 * 其他兵种的侦察字段映射尚未提供，不猜测其字段名。
 * 100以内识别仍可依据已知位置和地形规则执行。
 */
export function getVisibility(scene) {
  const side = getObservationSide(scene);
  const sources = scene.instances.filter(
    unit => unit.side === side && operational(unit)
  );

  const range = getReconConditions(scene.environment).normalRange;
  const result = new Map();

  for (const target of scene.instances) {
    if (target.side === side) {
      result.set(target.instanceId, "identified");
      continue;
    }

    if (!positioned(target)) continue;

    let visibility = null;

    for (const observer of sources) {
      const distance = Math.hypot(
        observer.x - target.x,
        observer.y - target.y
      );

      if (distance > Math.max(100, range)) continue;
      if (isTerrainBlocked(scene.terrain, observer, target)) continue;

      if (distance <= 100) {
        visibility = "identified";
        break;
      }

      if (
        observer.branch !== "navy" ||
        target.branch !== "navy" ||
        distance > range
      ) {
        continue;
      }

      const detection = navalGrade(target, "detection");
      const recon = navalGrade(observer, "seaRecon");

      if (
        detection !== null &&
        recon !== null &&
        recon >= detection
      ) {
        visibility = "shadow";
      }
    }

    if (visibility) result.set(target.instanceId, visibility);
  }

  return result;
}

/**
 * 返回页面可用的观察副本，而不是完整战场。
 * 普通发现不携带真实名称、耐性、军种、阵营或图鉴快照。
 */
export function getObservedScene(scene) {
  const visibility = getVisibility(scene);
  const side = getObservationSide(scene);

  const instances = [];

  for (const unit of scene.instances) {
    const level = visibility.get(unit.instanceId);
    if (!level) continue;

    if (level === "identified") {
      instances.push({
        ...clone(unit),
        observationLevel: "identified"
      });
      continue;
    }

    instances.push({
      instanceId: unit.instanceId,
      name: "未識別の影",
      branch: "special",
      side: "neutral",
      faction: "",
      x: unit.x,
      y: unit.y,
      heading: 0,
      altitude: 0,
      sizeLevel: 1,
      filled: false,
      labelHeight: 20,
      currentHp: null,
      snapshot: { maxHp: null },
      groupId: null,
      observationLevel: "shadow"
    });
  }

  // 编队名、数量和归属也属于资料。
  // 外方单位即使已识别，本批仍以单体显示，不泄露其编队结构。
  const ownGroupIds = new Set(
    scene.instances
      .filter(unit => unit.side === side)
      .map(unit => unit.groupId)
      .filter(Boolean)
  );

  let changed = true;
  while (changed) {
    changed = false;
    for (const group of scene.groups) {
      if (
        ownGroupIds.has(group.id) &&
        group.parentId &&
        !ownGroupIds.has(group.parentId)
      ) {
        ownGroupIds.add(group.parentId);
        changed = true;
      }
    }
  }

  const safeGroups = scene.groups.filter(group => {
    if (!ownGroupIds.has(group.id)) return false;

    const descendants = new Set([group.id]);
    let added = true;

    while (added) {
      added = false;
      for (const item of scene.groups) {
        if (
          descendants.has(item.parentId) &&
          !descendants.has(item.id)
        ) {
          descendants.add(item.id);
          added = true;
        }
      }
    }

    return !scene.instances.some(
      unit => descendants.has(unit.groupId) && unit.side !== side
    );
  });

  const safeGroupIds = new Set(safeGroups.map(group => group.id));

  for (const unit of instances) {
    if (!safeGroupIds.has(unit.groupId)) unit.groupId = null;
  }

  // 不用历史快照暴露外方名称、耐性或旧位置。
  const actions = scene.actions.filter(record =>
    record.attacker?.members?.every(unit => unit.side === side) &&
    record.target?.members?.every(unit => unit.side === side)
  );

  return clone({
    version: scene.version,
    mode: scene.mode,
    id: scene.id,
    revision: scene.revision,
    name: scene.name,
    createdAt: scene.createdAt,
    updatedAt: scene.updatedAt,
    ruleset: scene.ruleset,
    terrain: scene.terrain,
    environment: scene.environment,
    turn: scene.turn,
    controls: scene.controls,
    view: scene.view,
    instances,
    groups: safeGroups,
    actions,
    movementPlans: (scene.movementPlans ?? []).filter(plan =>
      plan.memberIds.every(id =>
        scene.instances.some(
          unit => unit.instanceId === id && unit.side === side
        )
      )
    )
  });
}

export function assertManualControl(scene, members) {
  const side = getObservationSide(scene);

  if (!members.length || members.some(unit => unit.side !== side)) {
    fail("現在の観察陣営に属するユニットだけを操作できます。");
  }

  if (
    scene.controls?.enemyAutonomy &&
    members.some(unit => unit.side !== "ally")
  ) {
    fail("自律行動が有効な場合、手動操作は味方に限られます。");
  }
}

export function assertIdentifiedTargets(scene, members) {
  const visibility = getVisibility(scene);

  if (members.some(
    unit => visibility.get(unit.instanceId) !== "identified"
  )) {
    fail("未発見または未識別の対象の詳細は参照できません。");
  }
}

function entityMembers(scene, ref) {
  if (!ref || !["unit", "group"].includes(ref.kind)) {
    fail("移動主体の指定が不正です。");
  }

  if (ref.kind === "unit") {
    const unit = scene.instances.find(item => item.instanceId === ref.id);
    if (!unit) fail("ユニットが見つかりません。");
    return [unit];
  }

  if (!scene.groups.some(group => group.id === ref.id)) {
    fail("編隊が見つかりません。");
  }

  const ids = new Set([ref.id]);
  let changed = true;

  while (changed) {
    changed = false;
    for (const group of scene.groups) {
      if (ids.has(group.parentId) && !ids.has(group.id)) {
        ids.add(group.id);
        changed = true;
      }
    }
  }

  const members = scene.instances.filter(unit => ids.has(unit.groupId));
  if (!members.length) fail("編隊にメンバーがいません。");
  return members;
}

function movementMembers(scene, ref) {
  const members = entityMembers(scene, ref);
  assertManualControl(scene, members);

  if (scene.turn.phaseId !== "movement") {
    fail("移動計画は移動段階でのみ指定できます。");
  }

  if (members.some(unit => unit.branch !== "navy")) {
    fail("この移動処理は艦船専用です。混合軍種の移動は未定義です。");
  }

  if (members.some(unit => !operational(unit))) {
    fail("行動不能または救助中の艦船は移動できません。");
  }

  return members;
}

function limitFor(members) {
  return Math.min(...members.map(unit =>
    Math.min(
      readShipProfile(unit).movementLimit,
      unit.shipState.remainingEndurance
    )
  ));
}

function pointOnSegment(point, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const square = dx * dx + dy * dy;

  if (square < EPSILON * EPSILON) {
    return Math.hypot(point.x - to.x, point.y - to.y) <= EPSILON;
  }

  const t =
    ((point.x - from.x) * dx + (point.y - from.y) * dy) / square;

  if (t <= EPSILON || t > 1 + EPSILON) return false;

  return Math.hypot(
    point.x - (from.x + t * dx),
    point.y - (from.y + t * dy)
  ) <= EPSILON;
}

function validateRoute(scene, unit, to) {
  if (!sampleTerrain(scene.terrain, to.x, to.y).inside) {
    fail("移動先が地図の範囲外です。");
  }

  for (const wreck of scene.instances) {
    if (
      wreck.shipState?.status === "sunk" &&
      positioned(wreck) &&
      pointOnSegment(wreck, unit, to)
    ) {
      // 不透露隐藏沉船的名称或坐标。
      fail("この経路では移動を完了できません。");
    }
  }

  // 未定义地形通行规则，不擅自添加陆地或河流禁行。
}

function buildPlan(scene, ref, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    fail("移動先の座標は有限の数値で指定してください。");
  }

  const members = movementMembers(scene, ref);
  const anchor = members[0];
  const dx = x - anchor.x;
  const dy = y - anchor.y;
  const distance = Math.hypot(dx, dy);

  if (distance > limitFor(members) + EPSILON) {
    fail("速力または残り航続距離の上限を超えています。");
  }

  const destinations = members.map(unit => {
    const to = { x: unit.x + dx, y: unit.y + dy };
    validateRoute(scene, unit, to);

    return {
      instanceId: unit.instanceId,
      fromX: unit.x,
      fromY: unit.y,
      x: to.x,
      y: to.y
    };
  });

  return {
    turnNumber: scene.turn.number,
    ref: clone(ref),
    memberIds: members.map(unit => unit.instanceId),
    distance,
    destinations
  };
}

export function createSimulationFeatures(getState, commit) {
  return {
    getMovementInfo(ref) {
      const scene = getState();
      const members = movementMembers(scene, ref);

      return {
        x: members[0].x,
        y: members[0].y,
        limit: limitFor(members),
        memberIds: members.map(unit => unit.instanceId)
      };
    },

    setObservationSide(side) {
      if (!SIDES.includes(side)) {
        fail("観察陣営の指定が不正です。");
      }

      if (getState().controls.enemyAutonomy && side !== "ally") {
        fail("自律行動が有効な場合、観察陣営は味方に固定されます。");
      }

      commit(scene => {
        scene.controls.observationSide = side;
      });
    },

    beginMovement() {
      commit(scene => {
        if (scene.turn.phaseId !== "start") {
          fail("ラウンド開始段階ではありません。");
        }

        if (scene.movementPlans.length) {
          fail("未処理の移動計画が存在します。");
        }

        scene.turn.phaseId = "movement";
      });
    },

    planMovement(ref, x, y) {
      commit(scene => {
        const plan = buildPlan(scene, ref, x, y);
        const ids = new Set(plan.memberIds);

        // 同じユニットの旧計画を置換する。移動予算はまだ消費しない。
        scene.movementPlans = scene.movementPlans.filter(
          old => !old.memberIds.some(id => ids.has(id))
        );

        scene.movementPlans.push(plan);
      });
    },

    cancelMovement(ref) {
      commit(scene => {
        const members = movementMembers(scene, ref);
        const ids = new Set(members.map(unit => unit.instanceId));

        scene.movementPlans = scene.movementPlans.filter(
          plan => !plan.memberIds.some(id => ids.has(id))
        );
      });
    },

    resolveMovement() {
      commit(scene => {
        if (scene.turn.phaseId !== "movement") {
          fail("移動段階ではありません。");
        }

        if (scene.controls.enemyAutonomy) {
          fail(
            "敵・中立の自律移動計画は未実装です。" +
            "自律行動を無効にして各陣営の移動を指定してください。"
          );
        }

        const originalSide = scene.controls.observationSide;
        const checked = [];
        const used = new Set();

        for (const saved of scene.movementPlans) {
          if (saved.turnNumber !== scene.turn.number) {
            fail("別ラウンドの移動計画が混在しています。");
          }

          const members = entityMembers(scene, saved.ref);

          if (
            members.length !== saved.memberIds.length ||
            members.some(unit => !saved.memberIds.includes(unit.instanceId))
          ) {
            fail("編隊構成が変更されています。移動計画を再指定してください。");
          }

          scene.controls.observationSide = members[0].side;

          const anchor = saved.destinations.find(
            item => item.instanceId === members[0].instanceId
          );

          if (!anchor) fail("移動計画の座標が不正です。");

          for (const destination of saved.destinations) {
            const unit = members.find(
              item => item.instanceId === destination.instanceId
            );

            if (
              !unit ||
              unit.x !== destination.fromX ||
              unit.y !== destination.fromY ||
              used.has(unit.instanceId)
            ) {
              fail("移動計画が重複しているか、開始位置が変更されています。");
            }

            used.add(unit.instanceId);
          }

          checked.push(buildPlan(scene, saved.ref, anchor.x, anchor.y));
        }

        scene.controls.observationSide = originalSide;

        // 全計画の検証が成功してから、同じトランザクションで適用する。
        for (const plan of checked) {
          for (const destination of plan.destinations) {
            const unit = scene.instances.find(
              item => item.instanceId === destination.instanceId
            );

            unit.x = destination.x;
            unit.y = destination.y;
            unit.shipState.remainingEndurance = Math.max(
              0,
              unit.shipState.remainingEndurance - plan.distance
            );
          }
        }

        scene.movementPlans = [];
        scene.turn.phaseId = "order-5";

        // 移動処理ではラウンド番号も時刻も進めない。
      });
    }
  };
}
