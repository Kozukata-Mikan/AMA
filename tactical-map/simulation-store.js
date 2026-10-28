import { assessCluster } from "./cluster-engine.js";
import { RULESET, evaluateAction } from "./rules-engine.js";
import { normalizeEnvironment } from "./environment-data.js";

// ===== 独立推演状态 =====
// 不调用 createBattleStore，避免读取或覆盖自定义模式存档。

const PREFIX = "junqi-simulation-v1:";
const VERSION = 1;

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function newId() {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error(
      "識別番号を生成できません。HTTPS または localhost で開いてください。"
    );
  }

  return crypto.randomUUID();
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label}は空欄にできません。`);
  }

  return value.trim();
}

function readSaved(id) {
  const raw = localStorage.getItem(PREFIX + id);

  if (raw === null) {
    throw new Error("推演データが見つかりません。");
  }

  const value = JSON.parse(raw);

  if (
    value.version !== VERSION ||
    value.id !== id ||
    value.mode !== "simulation" ||
    !Number.isInteger(value.revision) ||
    !Array.isArray(value.instances) ||
    !Array.isArray(value.groups) ||
    !Array.isArray(value.actions) ||
    !value.terrain
  ) {
    throw new Error("推演データの書式が不正です。");
  }

    // 兼容之前创建的框架推演。
  value.environment = normalizeEnvironment(value.environment);

  if (value.turn === undefined) {
    value.turn = {
      number: 1,
      phaseId: "start",
      elapsedMinutes: 0
    };
  }

  return value;
}

function writeSaved(value) {
  try {
    localStorage.setItem(
      PREFIX + value.id,
      JSON.stringify(value)
    );
  } catch {
    throw new Error(
      "推演データを保存できません。保存容量とブラウザー設定を確認してください。"
    );
  }
}

// 展开单体或编队，包括已有的嵌套编队。
// 使用 visited 防止异常数据造成死循环。
export function resolveEntity(scene, ref) {
  if (!ref || !["unit", "group"].includes(ref.kind)) {
    throw new Error("行動主体の指定が不正です。");
  }

  if (ref.kind === "unit") {
    const unit = scene.instances.find(
      item => item.instanceId === ref.id
    );

    if (!unit) {
      throw new Error("ユニットが見つかりません。");
    }

    return {
      ref: { kind: "unit", id: unit.instanceId },
      name: unit.name,
      members: [unit]
    };
  }

  const group = scene.groups.find(item => item.id === ref.id);

  if (!group) {
    throw new Error("編隊が見つかりません。");
  }

  const groupIds = new Set();
  const tasks = [group.id];

  while (tasks.length) {
    const id = tasks.pop();

    if (groupIds.has(id)) continue;

    groupIds.add(id);

    for (const child of scene.groups) {
      if (child.parentId === id) {
        tasks.push(child.id);
      }
    }
  }

  const members = scene.instances.filter(
    unit => groupIds.has(unit.groupId)
  );

  if (!members.length) {
    throw new Error("選択した編隊にメンバーがいません。");
  }

  return {
    ref: { kind: "group", id: group.id },
    name: group.name,
    members
  };
}

export function listEntities(scene) {
  const result = scene.instances.map(unit => ({
    ref: { kind: "unit", id: unit.instanceId },
    label: `個体：${unit.name}`
  }));

  for (const group of scene.groups) {
    try {
      const entity = resolveEntity(scene, {
        kind: "group",
        id: group.id
      });

      result.push({
        ref: entity.ref,
        label:
          `${group.kind === "cluster" ? "集群" : "編隊"}：` +
          `${group.name}（${entity.members.length}）`
      });
    } catch {
      // 空编队允许存在，但不能作为行动主体。
    }
  }

  return result;
}

function actorSnapshot(entity) {
  return {
    ref: copy(entity.ref),
    name: entity.name,

    members: entity.members.map(unit => ({
      instanceId: unit.instanceId,
      unitId: unit.unitId,
      name: unit.name,
      branch: unit.branch,
      side: unit.side,
      faction: unit.faction ?? "",
      currentHp: unit.currentHp,
      sizeLevel: unit.sizeLevel,
      x: unit.x,
      y: unit.y,
      heading: unit.heading,
      altitude: unit.altitude,
      underwater: unit.underwater,
      depth: unit.depth
    }))
  };
}

// 从已经部署好的自定义场景创建一次独立推演。
// spatialState 使用现有地图的部署条件，不增加战斗公式。
export function createSimulation(scene, spatialState) {
  if (
    !scene ||
    !Array.isArray(scene.instances) ||
    !Array.isArray(scene.groups) ||
    typeof spatialState !== "function"
  ) {
    throw new Error("推演開始データが不正です。");
  }

  if (!scene.instances.length) {
    throw new Error("参戦ユニットを配置してから推演を開始してください。");
  }

  const problems = [];

  for (const unit of scene.instances) {
    const spatial = spatialState(unit);

    if (!spatial.valid) {
      problems.push(`${unit.name}：${spatial.reason}`);
    }

    if (!unit.snapshot) {
      problems.push(`${unit.name}：図鑑スナップショットがありません。`);
    }
  }

  if (problems.length) {
    throw new Error(
      "推演を開始できません。\n" +
      problems.slice(0, 15).join("\n") +
      (
        problems.length > 15
          ? `\nほか ${problems.length - 15} 件`
          : ""
      )
    );
  }

  const id = newId();
  const now = new Date().toISOString();

  const value = {
    version: VERSION,
    mode: "simulation",
    id,
    revision: 0,
    name: scene.name,
    createdAt: now,
    updatedAt: now,

    ruleset: copy(RULESET),

    // 初始完整快照用于追溯，不随推演中的编队重组变化。
    initialScene: copy(scene),

    terrain: copy(scene.terrain),
    environment: normalizeEnvironment(scene.environment),

    turn: {
      number: 1,
      phaseId: "start",
      elapsedMinutes: 0
    },

    instances: copy(scene.instances),
    groups: copy(scene.groups),

    // 原编辑器的历史记录留在 initialScene.actions。
    // 新推演记录使用新的结构，不混入旧记录。
    actions: [],
    view: copy(scene.view)
  };

  writeSaved(value);

  return id;
}

export function openSimulation(id) {
  requireText(id, "推演番号");

  let state = readSaved(id);
  const listeners = new Set();

  function notify() {
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        console.error(error);
      }
    }
  }

  function commit(change) {
    const latest = readSaved(id);

    // 防止两个页面同时修改同一次推演，后保存者覆盖前者。
    if (latest.revision !== state.revision) {
      throw new Error(
        "別の画面で推演が更新されています。ページを再読み込みしてください。"
      );
    }

    const candidate = copy(state);

    change(candidate);

    candidate.revision += 1;
    candidate.updatedAt = new Date().toISOString();

    // 保存成功后才改变内存状态。
    writeSaved(candidate);
    state = candidate;

    notify();
  }

  function previewDraft({
    attacker,
    target,
    actionType,
    note = ""
  }) {
    requireText(actionType, "行動種別");

    if (
      !["攻撃", "防空", "その他の行動"].includes(actionType)
    ) {
      throw new Error("対応していない行動種別です。");
    }

    if (typeof note !== "string" || note.length > 2000) {
      throw new Error("メモは 2000 文字以内にしてください。");
    }

    const actingEntity = resolveEntity(state, attacker);
    const targetEntity = resolveEntity(state, target);

    const actingIds = new Set(
      actingEntity.members.map(unit => unit.instanceId)
    );

    // 不只排除同一个选择项，也排除父子编队和单体/编队成员重叠。
    if (targetEntity.members.some(unit =>
      actingIds.has(unit.instanceId)
    )) {
      throw new Error(
        "行動側と目標側のメンバーが重複しています。" +
        "別の個体または編隊を指定してください。"
      );
    }

    return {
      revision: state.revision,
      actionType,
      note,
      attacker: actorSnapshot(actingEntity),
      target: actorSnapshot(targetEntity),
      ruling: evaluateAction()
    };
  }

  return {
    getScene() {
      return copy(state);
    },

    getEntities() {
      return listEntities(state);
    },

    previewDraft,

    saveDraft(request, expectedRevision) {
      if (expectedRevision !== state.revision) {
        throw new Error(
          "状態が変更されています。もう一度プレビューしてください。"
        );
      }

      const preview = previewDraft(request);

      commit(candidate => {
        if (candidate.actions.length >= 1000) {
          throw new Error("草案記録は 1000 件以内にしてください。");
        }

        candidate.actions.push({
          id: newId(),
          createdAt: new Date().toISOString(),
          status: "draft",
          ruleset: copy(candidate.ruleset),
          actionType: preview.actionType,
          note: preview.note,
          attacker: preview.attacker,
          target: preview.target,
          ruling: preview.ruling
        });
      });
    },

    createGroup({ name, kind, memberIds }) {
      const groupName = requireText(name, "編隊名");

      if (!["formation", "cluster"].includes(kind)) {
        throw new Error("編隊種別が不正です。");
      }

      if (
        !Array.isArray(memberIds) ||
        !memberIds.length ||
        new Set(memberIds).size !== memberIds.length
      ) {
        throw new Error("メンバーを選択してください。");
      }

      commit(candidate => {
        const members = memberIds.map(instanceId => {
          const unit = candidate.instances.find(
            item => item.instanceId === instanceId
          );

          if (!unit) {
            throw new Error("メンバーが見つかりません。");
          }

          return unit;
        });

        if (kind === "cluster") {
          // 仅沿用已有的集群结构/显示条件。
          // 未来若推演规则另有要求，在这里接入。
          const assessment = assessCluster(
            members,
            candidate.terrain
          );

          if (!assessment.valid) {
            throw new Error(assessment.reason);
          }
        }

        const group = {
          id: newId(),
          name: groupName,
          kind,
          parentId: null
        };

        candidate.groups.push(group);

        // 明确的重组操作：移动归属，不新增或删除个体。
        for (const unit of members) {
          unit.groupId = group.id;
        }
      });
    },

    renameGroup(groupId, name) {
      const nextName = requireText(name, "編隊名");

      commit(candidate => {
        const group = candidate.groups.find(
          item => item.id === groupId
        );

        if (!group) {
          throw new Error("編隊が見つかりません。");
        }

        group.name = nextName;
      });
    },

    dissolveGroup(groupId) {
      commit(candidate => {
        const group = candidate.groups.find(
          item => item.id === groupId
        );

        if (!group) {
          throw new Error("編隊が見つかりません。");
        }

        for (const child of candidate.groups) {
          if (child.parentId === groupId) {
            child.parentId = group.parentId ?? null;
          }
        }

        for (const unit of candidate.instances) {
          if (unit.groupId === groupId) {
            unit.groupId = group.parentId ?? null;
          }
        }

        candidate.groups = candidate.groups.filter(
          item => item.id !== groupId
        );
      });
    },

    executeAction() {
      // 未配置规则时，状态层也拒绝执行，不只禁用按钮。
      throw new Error(evaluateAction().reason);
    },

    exportJSON() {
      return JSON.stringify(state, null, 2);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
