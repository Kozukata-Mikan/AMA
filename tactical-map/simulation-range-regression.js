import {
  selectRangeOccurrences,
  validateRangeSelection
} from "./range-projection-runtime.js";

import {
  withRangeCommandTarget,
  readRangeCommandTarget
} from "./simulation-range-command.js";

import {
  expandFormationMemberIds,
  validateFormationTopology
} from "./formation-target-runtime.js";

const copy = value => JSON.parse(JSON.stringify(value));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function mustReject(action) {
  let rejected = false;

  try {
    action();
  } catch {
    rejected = true;
  }

  assert(rejected, "拒否されるべき入力が受理されました。");
}

function prepared(mode, maximumTargets, specifiedIds = []) {
  return {
    version: 1,
    commandId: "command-1",
    scope: { mode, maximumTargets },
    eligibleIds: ["unit-a", "unit-b"],
    specifiedTargetIds: specifiedIds
  };
}

export function runRangeRegression() {
  const results = [];

  function test(name, action) {
    try {
      action();
      results.push({ name, passed: true });
    } catch {
      results.push({ name, passed: false });
    }
  }

  test("上限3・候補2では抽選2回", () => {
    const input = prepared("random", 3);
    let calls = 0;

    const selected = selectRangeOccurrences(input, () => {
      calls++;
      return 0;
    });

    assert(calls === 2, "抽選回数が不正です。");
    assert(
      selected.occurrences.length === 2,
      "対象数が不正です。"
    );

    validateRangeSelection(input, selected);
  });

  test("同一対象の重複当選を保持", () => {
    const input = prepared("random", 3);
    const selected = selectRangeOccurrences(input, () => 0);

    assert(
      selected.occurrences.every(
        item => item.targetId === "unit-a"
      ),
      "重複当選が失われています。"
    );

    validateRangeSelection(input, selected);
  });

  test("抽選結果の追加を拒否", () => {
    const input = prepared("random", 3);
    const selected = selectRangeOccurrences(input, () => 0);

    selected.occurrences.push({
      commandId: input.commandId,
      occurrenceIndex: 2,
      targetId: "unit-a"
    });

    mustReject(() => validateRangeSelection(input, selected));
  });

  test("抽選記録と異なる対象を拒否", () => {
    const input = prepared("random", 3);
    const selected = selectRangeOccurrences(input, () => 0);

    selected.occurrences[0].targetId = "unit-b";

    mustReject(() => validateRangeSelection(input, selected));
  });

  test("全体範囲では各候補を一度ずつ選択", () => {
    const input = prepared("all", null);

    const selected = selectRangeOccurrences(input, () => {
      throw new Error("非抽選で乱数が呼ばれました。");
    });

    assert(
      selected.occurrences.map(item => item.targetId).join(",") ===
        "unit-a,unit-b",
      "全体範囲の対象が不正です。"
    );

    validateRangeSelection(input, selected);
  });

  test("指定上限3・指定2を許可", () => {
    const input = prepared(
      "specified",
      3,
      ["unit-a", "unit-b"]
    );

    const selected = selectRangeOccurrences(input);

    assert(selected.occurrences.length === 2, "対象数が不正です。");
    validateRangeSelection(input, selected);
  });

  test("編隊命令に旧targetIdを残さない", () => {
    const original = {
      id: "command-1",
      targetId: "unit-old",
      equipmentGroupId: "equipment-1"
    };

    const before = JSON.stringify(original);

    const next = withRangeCommandTarget(
      original,
      {
        targetRef: { kind: "group", id: "group-1" },
        specifiedTargetIds: ["unit-a", "unit-b"]
      },
      { mode: "specified", maximumTargets: 3 }
    );

    assert(!("targetId" in next), "旧対象が残っています。");
    assert(
      JSON.stringify(original) === before,
      "元の命令が変更されました。"
    );
  });

  test("旧単体命令の読み取り互換", () => {
    const result = readRangeCommandTarget(
      { targetId: "unit-a" },
      { mode: "all", maximumTargets: null }
    );

    assert(
      result.targetRef.kind === "unit" &&
      result.targetRef.id === "unit-a",
      "旧対象を読み取れません。"
    );
  });

  test("子編隊を含めて展開・入力不変", () => {
    const scene = {
      groups: [
        { id: "root", parentId: null },
        { id: "child", parentId: "root" }
      ],
      instances: [
        { instanceId: "unit-b", groupId: "child" },
        { instanceId: "unit-a", groupId: "root" },
        { instanceId: "unit-outside", groupId: null }
      ]
    };

    const before = JSON.stringify(scene);

    const ids = expandFormationMemberIds(
      scene,
      { kind: "group", id: "root" }
    );

    assert(
      ids.join(",") === "unit-a,unit-b",
      "編隊展開が不正です。"
    );

    assert(
      JSON.stringify(scene) === before,
      "元の編隊が変更されました。"
    );
  });

  test("編隊循環を拒否", () => {
    const scene = {
      groups: [
        { id: "a", parentId: "b" },
        { id: "b", parentId: "a" }
      ],
      instances: []
    };

    mustReject(() => validateFormationTopology(copy(scene)));
  });

  return {
    passed: results.every(result => result.passed),
    count: results.length,
    results
  };
}
