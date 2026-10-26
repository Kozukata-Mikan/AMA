// ===== 集群规则与显示 =====
// 集群保留独立成员，只合并地图显示。

import { sampleTerrain } from "./terrain-data.js";

export const CLUSTER_MAX_DISTANCE = 10;

function getMemberHeight(unit, terrain) {
  const sample = sampleTerrain(terrain, unit.x, unit.y);

  if (!sample.inside) return null;

  if (unit.branch === "air") {
    return unit.altitude ?? 80;
  }

  if (unit.branch === "navy" && unit.underwater === true) {
    return -(unit.depth ?? 12);
  }

  if (unit.branch === "special") {
    return unit.altitude ?? sample.surface;
  }

  return sample.surface;
}

export function assessCluster(
  members,
  terrain,
  { allowUnplaced = false } = {}
) {
  if (members.length < 2) {
    return {
      valid: false,
      reason: "集群には 2 個以上のユニットが必要です。"
    };
  }

  const first = members[0];

  for (const member of members) {
    if (
      member.unitId !== first.unitId ||
      member.sizeLevel !== first.sizeLevel ||
      member.side !== first.side ||
      member.underwater !== first.underwater
    ) {
      return {
        valid: false,
        reason:
          "集群の図鑑種別、サイズ、陣営、水中設定は一致させてください。"
      };
    }
  }

  const allUnplaced = members.every(
    member => member.x == null && member.y == null
  );

  if (allUnplaced && allowUnplaced) {
    return {
      valid: true,
      unplaced: true,
      reason: ""
    };
  }

  if (members.some(
    member => member.x == null || member.y == null
  )) {
    return {
      valid: false,
      reason: "集群の全メンバーを配置してください。"
    };
  }

  const positions = members.map(member => ({
    x: member.x,
    y: member.y,
    z: getMemberHeight(member, terrain)
  }));

  if (positions.some(position =>
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y) ||
    !Number.isFinite(position.z)
  )) {
    return {
      valid: false,
      reason: "集群メンバーの座標または高度が不正です。"
    };
  }

  for (let a = 0; a < positions.length; a++) {
    for (let b = a + 1; b < positions.length; b++) {
      const distance = Math.hypot(
        positions[a].x - positions[b].x,
        positions[a].y - positions[b].y,
        positions[a].z - positions[b].z
      );

      if (distance > CLUSTER_MAX_DISTANCE + 0.000001) {
        return {
          valid: false,
          reason:
            "集群メンバー間の距離はすべて 10 以下にしてください。"
        };
      }
    }
  }

  return {
    valid: true,
    unplaced: false,
    reason: ""
  };
}

// 找出目前仍满足集群条件的编队。
// 未部署集群可以用于列表拖放，但不会直接画到地图上。
export function getActiveClusters(
  instances,
  groups,
  terrain,
  spatialState,
  allowUnplaced = false
) {
  const result = [];

  for (const group of groups) {
    if (group.kind !== "cluster") continue;

    const members = instances.filter(
      unit => unit.groupId === group.id
    );

    const assessment = assessCluster(
      members,
      terrain,
      { allowUnplaced }
    );

    if (!assessment.valid) continue;

    if (
      !assessment.unplaced &&
      members.some(member => !spatialState(member).valid)
    ) {
      continue;
    }

    result.push({
      group,
      members,
      unplaced: assessment.unplaced
    });
  }

  return result;
}

// 以第一个成员作为显示参考点，避免改动成员坐标。
export function makeClusterProxy(cluster) {
  return {
    ...cluster.members[0],
    name: `${cluster.group.name} *${cluster.members.length}`,
    clusterId: cluster.group.id,
    clusterMembers: cluster.members
  };
}

export function getDisplayUnits(
  instances,
  groups,
  terrain,
  spatialState
) {
  const clusters = getActiveClusters(
    instances,
    groups,
    terrain,
    spatialState
  );

  const byMember = new Map();

  for (const cluster of clusters) {
    for (const member of cluster.members) {
      byMember.set(member.instanceId, cluster);
    }
  }

  const emitted = new Set();
  const result = [];

  for (const unit of instances) {
    const cluster = byMember.get(unit.instanceId);

    if (!cluster) {
      result.push(unit);
      continue;
    }

    if (emitted.has(cluster.group.id)) continue;

    emitted.add(cluster.group.id);
    result.push(makeClusterProxy(cluster));
  }

  return result;
}

// 集群移动保持成员相对位置。
// 朝向增加相同角度，不旋转整个队形。
export function getDeploymentUpdates(candidate) {
  const members = candidate.clusterMembers;

  if (!members) {
    return [{
      instanceId: candidate.instanceId,
      patch: {
        x: candidate.x,
        y: candidate.y,
        heading: candidate.heading
      }
    }];
  }

  const first = members[0];

  const dx = candidate.x == null
    ? 0
    : candidate.x - (first.x ?? candidate.x);

  const dy = candidate.y == null
    ? 0
    : candidate.y - (first.y ?? candidate.y);

  const headingChange = candidate.heading - first.heading;

  return members.map(member => ({
    instanceId: member.instanceId,
    patch: {
      x: candidate.x == null
        ? null
        : member.x == null
          ? candidate.x
          : member.x + dx,

      y: candidate.y == null
        ? null
        : member.y == null
          ? candidate.y
          : member.y + dy,

      heading:
        ((member.heading + headingChange) % 360 + 360) % 360
    }
  }));
}
