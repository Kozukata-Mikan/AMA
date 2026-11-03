import {
  readRangeCommandTarget
} from "./simulation-range-command.js";

function fail(message) {
  throw new Error(message);
}

function validId(value) {
  return typeof value === "string" && value.trim() !== "";
}

function checkOptions(options) {
  if (!Array.isArray(options)) {
    fail("表示可能な対象一覧が不正です。");
  }

  const keys = new Set();

  for (const option of options) {
    const ref = option?.targetRef;

    if (
      !ref ||
      !["unit", "group"].includes(ref.kind) ||
      !validId(ref.id) ||
      typeof option.label !== "string" ||
      !Array.isArray(option.members)
    ) {
      fail("表示可能な対象の形式が不正です。");
    }

    const key = JSON.stringify([ref.kind, ref.id]);

    if (keys.has(key)) {
      fail("表示対象が重複しています。");
    }

    keys.add(key);

    const ids = new Set();

    for (const member of option.members) {
      if (
        !validId(member?.id) ||
        typeof member.label !== "string" ||
        ids.has(member.id)
      ) {
        fail("表示可能な編隊メンバーが不正です。");
      }

      ids.add(member.id);
    }

    if (
      ref.kind === "unit" &&
      (
        option.members.length !== 1 ||
        option.members[0].id !== ref.id
      )
    ) {
      fail("単体目標とメンバー一覧が一致しません。");
    }
  }
}

/**
 * optionsは観測権限で許可された情報だけを渡す。
 *
 * [
 *   {
 *     targetRef: { kind: "group", id: "..." },
 *     label: "表示名",
 *     members: [{ id: "...", label: "表示名" }]
 *   }
 * ]
 *
 * membersは界面で選択可能な候補。
 * 正式な射距・地形・被害資格は結算時に再検査する。
 *
 * 戻り値：
 *   element  : 既存の攻撃草案画面へ追加するDOM
 *   read()   : 保存時に読む選択値
 *   setDisabled(bool)
 *
 * このUI自体は保存、乱数、扣弾、射線登録を行わない。
 */
export function createRangeTargetEditor({
  options,
  scope,
  initial = null
}) {
  checkOptions(options);

  if (
    !scope ||
    !["all", "specified", "random"].includes(scope.mode) ||
    (
      scope.mode === "all"
        ? scope.maximumTargets !== null
        : (
            !Number.isSafeInteger(scope.maximumTargets) ||
            scope.maximumTargets < 1
          )
    )
  ) {
    fail("装備の正式な範囲定義がありません。");
  }

  const root = document.createElement("fieldset");
  root.className = "simulation-range-target";

  const legend = document.createElement("legend");
  legend.textContent = "主目標と範囲対象";
  root.append(legend);

  const mainLabel = document.createElement("label");
  mainLabel.textContent = "主目標 ";

  const select = document.createElement("select");

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "選択してください";
  select.append(placeholder);

  options.forEach((option, index) => {
    const item = document.createElement("option");
    item.value = String(index);
    item.textContent = option.label;
    select.append(item);
  });

  mainLabel.append(select);
  root.append(mainLabel);

  const explanation = document.createElement("p");

  explanation.textContent = scope.mode === "all"
    ? "攻撃可能な各メンバーへ、完全な投射を一回ずつ行います。"
    : scope.mode === "specified"
      ? `最大${scope.maximumTargets}名を指定できます。上限未満でも攻撃できます。`
      : `最大${scope.maximumTargets}回の抽選を行います。同じ対象の重複当選があります。`;

  root.append(explanation);

  const membersBox = document.createElement("div");
  root.append(membersBox);

  const errorBox = document.createElement("p");
  errorBox.setAttribute("role", "alert");
  root.append(errorBox);

    let checks = [];

  // 旧目标失去观察权限时，必须明确重新指定。
  // 不允许保存时静默删除不可见成员。
  let requiresReselection = false;

  function selectedOption() {
    if (select.value === "") return null;

    const index = Number(select.value);

    return Number.isSafeInteger(index)
      ? options[index] ?? null
      : null;
  }

  function renderMembers(selectedIds = []) {
    membersBox.replaceChildren();
    checks = [];
    errorBox.textContent = "";

    const option = selectedOption();
    if (!option) return;

    if (scope.mode !== "specified") {
      const note = document.createElement("p");
      note.textContent = scope.mode === "random"
        ? "対象の抽選は正式な攻撃処理時に実行します。"
        : "対象資格は正式な攻撃処理時に再確認します。";
      membersBox.append(note);
      return;
    }

    for (const member of option.members) {
      const label = document.createElement("label");
      label.style.display = "block";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = member.id;
      checkbox.checked = selectedIds.includes(member.id);

      checkbox.addEventListener("change", () => {
        const count = checks.filter(item => item.checked).length;

        if (count > scope.maximumTargets) {
          checkbox.checked = false;
          errorBox.textContent =
            `指定できるのは最大${scope.maximumTargets}名です。`;
        } else {
          errorBox.textContent = "";
        }
      });

      checks.push(checkbox);

      label.append(
        checkbox,
        document.createTextNode(` ${member.label}`)
      );

      membersBox.append(label);
    }
  }

    select.addEventListener("change", () => {
    requiresReselection = false;
    renderMembers();
  });


   if (initial) {
    const saved = readRangeCommandTarget(initial, scope);

    const index = options.findIndex(option =>
      option.targetRef.kind === saved.targetRef.kind &&
      option.targetRef.id === saved.targetRef.id
    );

    if (index >= 0) {
      const visibleIds = new Set(
        options[index].members.map(member => member.id)
      );

      const hasUnavailableMember =
        saved.specifiedTargetIds.some(
          memberId => !visibleIds.has(memberId)
        );

      if (hasUnavailableMember) {
        // 不恢复部分集合，也不显示隐藏成员的名称或数量。
        // 保持主目标未选择，要求用户明确重新指定。
        requiresReselection = true;
        select.value = "";
        renderMembers();

        errorBox.textContent =
          "以前の指定対象を表示できません。主目標と対象を再指定してください。";
      } else {
        select.value = String(index);
        renderMembers(saved.specifiedTargetIds);
      }
    } else {
      requiresReselection = true;
      select.value = "";
      renderMembers();

      errorBox.textContent =
        "以前の主目標を表示できません。主目標を再指定してください。";
    }
  }


  return {
    element: root,

    read() {
      if (requiresReselection) {
        fail("以前の対象を保存できません。主目標と対象を再指定してください。");
      }

      const option = selectedOption();


      if (!option) {
        fail("主目標を選択してください。");
      }

      const selection = {
        targetRef: {
          kind: option.targetRef.kind,
          id: option.targetRef.id
        },
        specifiedTargetIds: scope.mode === "specified"
          ? checks
              .filter(item => item.checked)
              .map(item => item.value)
          : []
      };

      // 保存前にも上限・方式・重複を検査する。
      return readRangeCommandTarget(selection, scope);
    },

    setDisabled(disabled) {
      root.disabled = Boolean(disabled);
    }
  };
}
