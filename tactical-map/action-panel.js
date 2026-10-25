import { getBranchName } from "../js/data-store.js";

// ===== 行动草案面板 =====
// 这里只记录意图，不执行战斗裁定或修改参战状态。

function node(tag, text = "", className = "") {
  const result = document.createElement(tag);
  result.textContent = text;
  if (className) result.className = className;
  return result;
}

function field(parent, title, control) {
  const label = node("label");
  label.append(node("span", title), control);
  parent.append(label);
  return control;
}

function button(text, action) {
  const result = node("button", text);
  result.type = "button";
  result.addEventListener("click", action);
  return result;
}

export function mountActionPanel({ container, store, spatialState }) {
  let previewText = "";
  let previewKey = "";

  container.append(node("h3", "行動草案"));

  container.append(node(
    "p",
    "この面板は行動の意図を記録します。命中・損害・移動・射程の判定は行いません。",
    "editor-note"
  ));

  const attackerSelect = field(
    container,
    "行動ユニット",
    node("select")
  );

  const targetSelect = field(
    container,
    "目標ユニット",
    node("select")
  );

  const actionSelect = node("select");

  for (const type of ["攻撃", "防空", "その他の行動"]) {
    actionSelect.append(new Option(type, type));
  }

  field(container, "行動種別", actionSelect);

  const note = node("textarea");
  note.maxLength = 2000;
  field(container, "行動メモ（2000 文字以内）", note);

  const result = node("p", "", "editor-note editor-status");
  result.setAttribute("role", "status");
  result.setAttribute("aria-live", "polite");

  const actions = node("div", "", "editor-actions");
  const history = node("div");
  container.append(actions, result, history);

  function show(text, error = false) {
    result.textContent = [
      text,
      store.getStorageWarning()
    ].filter(Boolean).join("\n");

    result.classList.toggle("error", error);
  }

  function safely(action) {
    try {
      action();
    } catch (error) {
      console.error(error);
      show(error.message, true);
    }
  }

  function selectedPair() {
    const instances = store.getAll();

    const attacker = instances.find(
      item => item.instanceId === attackerSelect.value
    );

    const target = instances.find(
      item => item.instanceId === targetSelect.value
    );

    if (!attacker || !target) {
      throw new Error("行動ユニットと目標を選択してください。");
    }

    if (attacker.instanceId === target.instanceId) {
      throw new Error("別の個体を目標に指定してください。");
    }

    return { attacker, target };
  }

  function actorSummary(unit) {
    const spatial = spatialState(unit);

    const position = unit.x === null || unit.y === null
      ? "未配置"
      : `X ${unit.x} / Y ${unit.y}`;

    return [
      `${unit.name} · ${getBranchName(unit.branch)}`,
      `現在耐性：${unit.currentHp}`,
      `位置：${position}`,
      `配置条件：${spatial.valid ? spatial.note : spatial.reason}`
    ].join("\n");
  }

  function currentKey(attacker, target) {
    // 双方的最新资料及草案内容变化后，需要重新预览。
    return JSON.stringify({
      attacker,
      target,
      actionType: actionSelect.value,
      note: note.value
    });
  }

  actions.append(
    button("配置をプレビュー", () => safely(() => {
      const { attacker, target } = selectedPair();

      previewKey = currentKey(attacker, target);
      previewText = [
        `行動種別：${actionSelect.value}`,
        "",
        "【行動ユニット】",
        actorSummary(attacker),
        "",
        "【目標】",
        actorSummary(target),
        "",
        "未配置・配置条件エラーがあっても草案として記録できます。",
        "この表示は攻撃可否や命中を保証しません。"
      ].join("\n");

      show(previewText);
    })),

    button("未裁定の記録として保存", () => safely(() => {
      const { attacker, target } = selectedPair();

      if (
        !previewKey ||
        previewKey !== currentKey(attacker, target)
      ) {
        throw new Error(
          "現在の内容を先にプレビューしてください。状態または入力が変更されています。"
        );
      }

      store.addAction({
        attackerId: attacker.instanceId,
        targetId: target.instanceId,
        actionType: actionSelect.value,
        note: note.value
      });

      note.value = "";
      previewKey = "";
      previewText = "";

      show(
        "未裁定の行動記録を保存しました。耐性と位置は変更していません。"
      );
    }))
  );

  function invalidate() {
    previewKey = "";
    previewText = "";
    show("入力が変更されました。配置を再度プレビューしてください。");
  }

  attackerSelect.addEventListener("change", () => {
    refillTargets();
    invalidate();
  });

  targetSelect.addEventListener("change", invalidate);
  actionSelect.addEventListener("change", invalidate);
  note.addEventListener("input", invalidate);

  function refill(select, instances, selected, placeholder) {
    select.replaceChildren(new Option(placeholder, ""));

    for (const unit of instances) {
      select.append(new Option(
        `${unit.name} · ${unit.instanceId.slice(-6)}`,
        unit.instanceId
      ));
    }

    select.value = instances.some(
      unit => unit.instanceId === selected
    ) ? selected : "";
  }

  function refillTargets() {
    const selected = targetSelect.value;

    refill(
      targetSelect,
      store.getAll().filter(
        unit => unit.instanceId !== attackerSelect.value
      ),
      selected,
      "目標を選択してください"
    );
  }

  function renderHistory() {
    history.replaceChildren();

    const records = store.getActions();
    history.append(node(
      "p",
      `行動記録：${records.length} 件（すべて未裁定）`,
      "editor-note"
    ));

    // 界面只展开最近 30 条，完整记录仍保存在场景 JSON 中。
    for (const record of records.slice(-30).reverse()) {
      const details = node("details", "", "editor-section");

      details.append(node(
        "summary",
        `${record.actionType}：${record.attacker.name} → ${record.target.name}`
      ));

      details.append(node(
        "p",
        [
          `記録日時：${new Date(record.createdAt).toLocaleString("ja-JP")}`,
          "状態：未裁定",
          "",
          "記録時の資料",
          `行動方：${record.attacker.name}`,
          `識別番号：${record.attacker.instanceId}`,
          `耐性：${record.attacker.currentHp}`,
          `座標：${record.attacker.x ?? "未配置"} / ${record.attacker.y ?? "未配置"}`,
          "",
          `目標：${record.target.name}`,
          `識別番号：${record.target.instanceId}`,
          `耐性：${record.target.currentHp}`,
          `座標：${record.target.x ?? "未配置"} / ${record.target.y ?? "未配置"}`,
          "",
          `メモ：${record.note || "なし"}`
        ].join("\n"),
        "editor-note"
      ));

      details.append(button("この記録を削除", () => safely(() => {
        if (!confirm("この行動記録を削除しますか？")) return;
        store.removeAction(record.id);
        show("行動記録を削除しました。");
      })));

      history.append(details);
    }

    if (records.length > 30) {
      history.append(node(
        "p",
        "最新 30 件を表示しています。全件は JSON 書き出しで確認できます。",
        "editor-note"
      ));
    }
  }

  function refresh() {
    const selected = attackerSelect.value;

    refill(
      attackerSelect,
      store.getAll(),
      selected,
      "行動ユニットを選択してください"
    );

    refillTargets();
    renderHistory();

    if (previewKey) {
      try {
        const { attacker, target } = selectedPair();

        if (previewKey !== currentKey(attacker, target)) {
          invalidate();
        }
      } catch {
        invalidate();
      }
    }
  }

  refresh();
  show("双方を選択し、配置をプレビューしてください。");

  return { refresh };
}
