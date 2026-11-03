const copy = value => JSON.parse(JSON.stringify(value));

function fail(message) {
  throw new Error(message);
}

function validId(value) {
  return typeof value === "string" && value.trim() !== "";
}

function readRef(value) {
  if (
    !value ||
    !["unit", "group"].includes(value.kind) ||
    !validId(value.id)
  ) {
    fail("主目標の指定が不正です。");
  }

  return {
    kind: value.kind,
    id: value.id
  };
}

function readIds(value) {
  if (!Array.isArray(value)) {
    fail("範囲内の指定メンバーが不正です。");
  }

  if (
    value.some(id => !validId(id)) ||
    new Set(value).size !== value.length
  ) {
    fail("指定メンバーの識別番号が不正、または重複しています。");
  }

  return [...value];
}

/**
 * 旧単体命令も読み取れる対象アダプター。
 *
 * targetIdは常にユニットIDとして扱う。
 * 編隊IDをtargetIdへ流用しない。
 *
 * scopeは図鑑から正式に解釈済みの値を渡す。
 * プレイヤーの選択で範囲方式や上限を変更しない。
 */
export function readRangeCommandTarget(command, scope) {
  if (
    !command ||
    typeof command !== "object" ||
    Array.isArray(command)
  ) {
    fail("攻撃命令の形式が不正です。");
  }

  const hasRef = command.targetRef != null;
  const hasLegacyId = command.targetId != null;

  if (!hasRef && !hasLegacyId) {
    fail("主目標が指定されていません。");
  }

  const targetRef = hasRef
    ? readRef(command.targetRef)
    : readRef({
        kind: "unit",
        id: command.targetId
      });

  if (
    hasLegacyId &&
    (
      !validId(command.targetId) ||
      targetRef.kind !== "unit" ||
      targetRef.id !== command.targetId
    )
  ) {
    fail("旧形式の対象と主目標が一致しません。");
  }

  if (
    !scope ||
    !["all", "specified", "random"].includes(scope.mode)
  ) {
    fail("装備の正式な範囲定義がありません。");
  }

  if (scope.mode === "all") {
    if (scope.maximumTargets !== null) {
      fail("全体範囲の上限指定が不正です。");
    }
  } else if (
    !Number.isSafeInteger(scope.maximumTargets) ||
    scope.maximumTargets < 1
  ) {
    fail("範囲の対象数上限が不正です。");
  }

  const specifiedTargetIds = readIds(
    command.specifiedTargetIds ?? []
  );

  if (scope.mode === "specified") {
    if (specifiedTargetIds.length === 0) {
      fail("範囲内の対象メンバーを指定してください。");
    }

    if (specifiedTargetIds.length > scope.maximumTargets) {
      fail("指定メンバー数が範囲上限を超えています。");
    }
  } else if (specifiedTargetIds.length !== 0) {
    fail("この範囲方式では個別メンバーを指定できません。");
  }

  return {
    targetRef,
    specifiedTargetIds
  };
}

/**
 * 既存命令の対象部分だけを置き換える。
 * 装備、投射、使用回数、弾薬などは変更しない。
 *
 * 未保存の命令草案に使用する。
 * 実際の保存は既存のトランザクション入口に任せる。
 */
export function withRangeCommandTarget(
  command,
  selection,
  scope
) {
  if (
    !command ||
    typeof command !== "object" ||
    Array.isArray(command) ||
    !selection
  ) {
    fail("攻撃命令の対象を更新できません。");
  }

  const next = copy(command);

  // 古い対象指定を残して矛盾させない。
  delete next.targetId;
  delete next.targetRef;
  delete next.specifiedTargetIds;

  next.targetRef = readRef(selection.targetRef);
  next.specifiedTargetIds = readIds(
    selection.specifiedTargetIds ?? []
  );

  // 旧単体経路への互換情報。
  // 編隊命令にはtargetIdを作らない。
  if (next.targetRef.kind === "unit") {
    next.targetId = next.targetRef.id;
  }

  readRangeCommandTarget(next, scope);

  return next;
}
