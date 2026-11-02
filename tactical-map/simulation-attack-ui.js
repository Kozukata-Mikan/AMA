import { getPhaseLabel } from "./simulation-rulebook.js";

// 多组选装、共用目标、批量检查。
// 选择仅属于当前界面，不保存为攻击命令。
// 不扣弹、不掷随机数、不执行伤害、不推进阶段。

export function mountAttackUI(store) {
  const aside = document.querySelector("aside");

  if (!aside) {
    throw new Error("推演画面のサイドバーが見つかりません。");
  }

  function element(tag, text = "") {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  }

  function labeled(text, control) {
    const label = element("label");
    label.append(element("span", text), control);
    return label;
  }

  function button(text, handler) {
    const node = element("button", text);
    node.type = "button";
    node.addEventListener("click", handler);
    return node;
  }

  function restoreOption(select, value) {
    if ([...select.options].some(option => option.value === value)) {
      select.value = value;
    }
  }

  function projectionText(profile) {
    if (!profile?.projection) return "未登録／未対応";

    return profile.projection.standalone
      ? "R"
      : `${profile.projection.groups}·` +
        `${profile.projection.coinsPerGroup}R`;
  }

  const panel = element("details");
  panel.append(element("summary", "攻撃装備・一括確認"));

  const actor = element("select");
  const target = element("select");

  const equipmentList = element("div");
  equipmentList.setAttribute("role", "group");
  equipmentList.setAttribute("aria-label", "使用する装備組");

  const selectionInfo = element("p");
  selectionInfo.className = "note";

  const toolbar = element("div");
  toolbar.style.display = "flex";
  toolbar.style.flexWrap = "wrap";
  toolbar.style.gap = "6px";

  const notice = element(
    "p",
    "複数の装備組を選び、同じ目標を一括確認できます。" +
    "選択は攻撃命令として保存されません。" +
    "正式な攻撃結算は未接続です。弾薬は消費しません。"
  );
  notice.className = "note";

  const output = element("p");
  output.className = "note";
  output.style.whiteSpace = "pre-wrap";
  output.setAttribute("aria-live", "polite");

  let report = null;
  let selectedActorId = "";
  const selectedGroupIds = new Set();

  function selectableGroups() {
    return report
      ? report.groups.filter(
        group => group.profile?.kind !== "support"
      )
      : [];
  }

  function selectedGroups() {
    return selectableGroups().filter(
      group => selectedGroupIds.has(group.groupId)
    );
  }

  function updateSelectionInfo() {
    selectionInfo.textContent =
      `選択中：${selectedGroups().length}組` +
      ` / ${selectableGroups().length}組`;

    selectAll.disabled = selectableGroups().length === 0;
    clearAll.disabled = selectedGroupIds.size === 0;
  }

  function renderReport() {
    updateSelectionInfo();

    if (!report) {
      output.textContent = "行動するユニットを選択してください。";
      return;
    }

    const groups = selectedGroups();
    const lines = [
      report.unitName,
      `ラウンド${report.turnNumber} / ${getPhaseLabel(report.phaseId)}`,
      `選択装備：${groups.length}組`
    ];

    if (report.unresolvedMountIndexes.length) {
      lines.push(
        `組数未登録の配置：${report.unresolvedMountIndexes.length}件`,
        "組数未登録の配置は選択一覧に追加していません。"
      );
    }

    if (!groups.length) {
      lines.push("", "装備組を選択してください。");
      output.textContent = lines.join("\n");
      return;
    }

    if (target.value) {
      lines.push(
        `共通目標：${target.selectedOptions[0]?.textContent ?? ""}`
      );
    } else {
      lines.push("目標を選択すると、全選択装備を一括確認します。");
    }

    for (const group of groups) {
      const profile = group.profile;

      lines.push(
        "",
        "────────────────",
        `${group.position} / ${group.label}` +
          ` / 第${group.groupIndex + 1}組`,
        `残弾：${group.remainingAmmo ?? "未登録"}`,
        `最終使用：${group.lastUsedTurn === null
          ? "未使用"
          : `ラウンド${group.lastUsedTurn}`}`,
        `状態：${group.damaged ? "損傷" : "正常"}`,
        `投射率：${projectionText(profile)}`,
        `完全投射時の消費：${profile?.fullAmmoCost ?? "未登録"}`,
        "",
        "【装備・段階】",
        ...(group.issues.length
          ? group.issues.map(issue => `・${issue}`)
          : ["接続済みのチェックでは阻害条件を検出していません。"])
      );

      if (!target.value) continue;

      try {
        const check = store.getAttackTargetReport({
          unitId: report.unitId,
          groupId: group.groupId,
          targetId: target.value
        });

        lines.push("", "【目標・三次元幾何】");

        if (check.distance3D !== null) {
          lines.push(
            `距離：${check.distance3D.toFixed(2)}`,
            `相対高度：${check.relativeHeight.toFixed(2)}`,
            `直線の地形内部通過：${check.terrainInterior
              ? "あり"
              : "なし"}`
          );
        }

        lines.push(
          ...(check.issues.length
            ? check.issues.map(issue => `・${issue}`)
            : ["接続済みのチェックでは阻害条件を検出していません。"]),
          "",
          "【実装境界】",
          ...check.boundaries.map(item => `・${item}`)
        );
      } catch (error) {
        console.error(error);

        // 一组资料异常不会阻止其他组选装结果显示。
        lines.push("", `目標確認：${error.message}`);
      }
    }

    lines.push(
      "",
      "確認結果は攻撃実行の許可ではありません。",
      "残弾の消費・使用記録の更新・被害の適用は行っていません。"
    );

    output.textContent = lines.join("\n");
  }

  function renderEquipmentList() {
    equipmentList.replaceChildren();

    const groups = selectableGroups();

    if (!groups.length) {
      equipmentList.append(element("p", "選択できる武器組がありません。"));
      updateSelectionInfo();
      return;
    }

    for (const group of groups) {
      const row = element("label");
      row.style.display = "flex";
      row.style.alignItems = "flex-start";
      row.style.gap = "8px";
      row.style.marginBottom = "6px";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selectedGroupIds.has(group.groupId);
      checkbox.style.width = "auto";
      checkbox.style.flexShrink = "0";

      const flags = [];

      if (group.damaged) flags.push("損傷");
      if (group.lastUsedTurn === report.turnNumber) {
        flags.push("使用済み");
      }
      if (group.issues.length) flags.push("確認事項あり");

      const description = element(
        "span",
        `${group.position} / ${group.label}` +
        ` / 第${group.groupIndex + 1}組` +
        ` / 残弾 ${group.remainingAmmo ?? "未登録"}` +
        (flags.length ? `［${flags.join("・")}］` : "")
      );

      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          selectedGroupIds.add(group.groupId);
        } else {
          selectedGroupIds.delete(group.groupId);
        }

        renderReport();
      });

      row.append(checkbox, description);
      equipmentList.append(row);
    }

    updateSelectionInfo();
  }

  const selectAll = button("武器組を全選択", () => {
    for (const group of selectableGroups()) {
      selectedGroupIds.add(group.groupId);
    }

    renderEquipmentList();
    renderReport();
  });

  const clearAll = button("選択を解除", () => {
    selectedGroupIds.clear();
    renderEquipmentList();
    renderReport();
  });

  toolbar.append(selectAll, clearAll);

  panel.append(
    labeled("行動するユニット", actor),
    element("p", "使用する装備組"),
    toolbar,
    selectionInfo,
    equipmentList,
    labeled("全選択装備に共通の目標", target),
    notice,
    output
  );

  aside.append(panel);

  function refillTargets(scene) {
    const previous = target.value;

    target.replaceChildren(
      new Option("選択してください", "")
    );

    const actingUnit = scene.instances.find(
      unit => unit.instanceId === actor.value
    );

    if (actingUnit) {
      for (const unit of scene.instances) {
        if (unit.observationLevel !== "identified") continue;
        if (unit.instanceId === actingUnit.instanceId) continue;
        if (unit.side === actingUnit.side) continue;
        if (unit.shipState?.status === "sunk") continue;

        target.append(new Option(unit.name, unit.instanceId));
      }
    }

    restoreOption(target, previous);
    target.disabled = !actingUnit;
  }

  function refreshReport() {
    report = null;

    if (!actor.value) {
      selectedGroupIds.clear();
      renderEquipmentList();
      renderReport();
      return;
    }

    try {
      report = store.getAttackGroupReport(actor.value);

      const validIds = new Set(
        selectableGroups().map(group => group.groupId)
      );

      // 删除已不在当前单位查询结果中的旧选择。
      for (const id of selectedGroupIds) {
        if (!validIds.has(id)) selectedGroupIds.delete(id);
      }

      renderEquipmentList();
      renderReport();
    } catch (error) {
      console.error(error);
      selectedGroupIds.clear();
      renderEquipmentList();
      output.textContent = error.message;
    }
  }

  function sync() {
    const scene = store.getScene();
    const previous = actor.value;

    actor.replaceChildren(
      new Option("選択してください", "")
    );

    for (const unit of scene.instances) {
      if (unit.observationOwn !== true) continue;
      if (unit.observationLevel !== "identified") continue;

      actor.append(new Option(unit.name, unit.instanceId));
    }

    restoreOption(actor, previous);

    if (selectedActorId !== actor.value) {
      // 组ID只在单位内唯一，不跨单位沿用。
      selectedGroupIds.clear();
      target.value = "";
      selectedActorId = actor.value;
    }

    refillTargets(scene);
    refreshReport();
  }

  actor.addEventListener("change", () => {
    selectedGroupIds.clear();
    selectedActorId = actor.value;
    target.value = "";

    refillTargets(store.getScene());
    refreshReport();
  });

  target.addEventListener("change", renderReport);

  const unsubscribe = store.subscribe(sync);
  sync();

  return () => {
    unsubscribe();
    panel.remove();
  };
}
