import { getPhaseLabel } from "./simulation-rulebook.js";

// 装备组、目标及几何检查入口。
// 不扣弹，不随机判定，不推进阶段。

export function mountAttackUI(store) {
  const aside = document.querySelector("aside");

  if (!aside) {
    throw new Error("推演画面のサイドバーが見つかりません。");
  }

  function element(tag, text = "") {
    const result = document.createElement(tag);
    result.textContent = text;
    return result;
  }

  function labeled(text, control) {
    const label = element("label");
    label.append(element("span", text), control);
    return label;
  }

  const panel = element("details");
  panel.append(element("summary", "攻撃装備・目標確認"));

  const actor = element("select");
  const equipmentGroup = element("select");
  const target = element("select");

  const notice = element(
    "p",
    "装備組と目標を選び、資料・段階・射程・地形を確認します。" +
    "正式な攻撃結算は未接続です。残弾は消費しません。"
  );
  notice.className = "note";

  const output = element("p");
  output.className = "note";
  output.style.whiteSpace = "pre-wrap";
  output.setAttribute("aria-live", "polite");

  panel.append(
    labeled("行動するユニット", actor),
    labeled("使用する装備組", equipmentGroup),
    labeled("確認する目標", target),
    notice,
    output
  );

  aside.append(panel);

  let report = null;

  function renderReport() {
    if (!report) {
      output.textContent = "ユニットを選択してください。";
      return;
    }

    const group = report.groups.find(
      item => item.groupId === equipmentGroup.value
    );

    if (!group) {
      output.textContent = [
        "装備組を選択してください。",
        report.unresolvedMountIndexes.length
          ? `組数未登録の配置：${report.unresolvedMountIndexes.length}件`
          : ""
      ].filter(Boolean).join("\n");
      return;
    }

    const profile = group.profile;

    const projection = profile?.projection
      ? profile.projection.standalone
        ? "R"
        : `${profile.projection.groups}·` +
          `${profile.projection.coinsPerGroup}R`
      : "未登録／未対応";

    const lines = [
      `${report.unitName} / ${group.label}`,
      `${group.position} / 第${group.groupIndex + 1}組`,
      `ラウンド${report.turnNumber} / ${getPhaseLabel(report.phaseId)}`,
      "",
      `残弾：${group.remainingAmmo ?? "未登録"}`,
      `最終使用：${group.lastUsedTurn === null
        ? "未使用"
        : `ラウンド${group.lastUsedTurn}`}`,
      `状態：${group.damaged ? "損傷" : "正常"}`,
      `投射率：${projection}`,
      `完全投射時の消費：${profile?.fullAmmoCost ?? "未登録"}`,
      "",
      "【装備・段階】",
      ...(group.issues.length
        ? group.issues.map(issue => `・${issue}`)
        : ["接続済みの装備チェックでは阻害条件を検出していません。"])
    ];

    if (target.value) {
      try {
        const check = store.getAttackTargetReport({
          unitId: actor.value,
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
            : ["接続済みの目標チェックでは阻害条件を検出していません。"]),
          "",
          "【実装境界】",
          ...check.boundaries.map(item => `・${item}`)
        );
      } catch (error) {
        console.error(error);
        lines.push("", `目標確認：${error.message}`);
      }
    } else {
      lines.push("", "目標を選択してください。");
    }

    lines.push(
      "",
      "上記の確認結果は、攻撃実行の許可ではありません。"
    );

    output.textContent = lines.join("\n");
  }

  function refillGroups() {
    const previous = equipmentGroup.value;
    report = null;

    equipmentGroup.replaceChildren(
      new Option("選択してください", "")
    );

    if (!actor.value) {
      equipmentGroup.disabled = true;
      renderReport();
      return;
    }

    try {
      report = store.getAttackGroupReport(actor.value);

      for (const group of report.groups) {
        if (group.profile?.kind === "support") continue;

        equipmentGroup.append(new Option(
          `${group.position} / ${group.label}` +
          ` / 第${group.groupIndex + 1}組`,
          group.groupId
        ));
      }

      equipmentGroup.disabled =
        equipmentGroup.options.length <= 1;

      if ([...equipmentGroup.options].some(
        option => option.value === previous
      )) {
        equipmentGroup.value = previous;
      }

      renderReport();
    } catch (error) {
      console.error(error);
      equipmentGroup.disabled = true;
      output.textContent = error.message;
    }
  }

  function refillTargets(scene) {
    const previous = target.value;

    target.replaceChildren(
      new Option("選択してください", "")
    );

    const actingUnit = scene.instances.find(
      unit => unit.instanceId === actor.value
    );

    for (const unit of scene.instances) {
      if (unit.observationLevel !== "identified") continue;
      if (unit.instanceId === actor.value) continue;
      if (actingUnit && unit.side === actingUnit.side) continue;
      if (unit.shipState?.status === "sunk") continue;

      target.append(new Option(unit.name, unit.instanceId));
    }

    if ([...target.options].some(
      option => option.value === previous
    )) {
      target.value = previous;
    }

    target.disabled = !actor.value;
  }

  function sync() {
    const scene = store.getScene();
    const previous = actor.value;

    actor.replaceChildren(
      new Option("選択してください", "")
    );

    for (const unit of scene.instances) {
      if (unit.side !== scene.controls.observationSide) continue;
      if (unit.observationLevel === "shadow") continue;

      actor.append(new Option(unit.name, unit.instanceId));
    }

    if ([...actor.options].some(
      option => option.value === previous
    )) {
      actor.value = previous;
    }

    refillTargets(scene);
    refillGroups();
  }

  actor.addEventListener("change", () => {
    // 组ID仅在单位内唯一，换单位后取消旧组选择。
    equipmentGroup.value = "";
    refillTargets(store.getScene());
    refillGroups();
  });

  equipmentGroup.addEventListener("change", renderReport);
  target.addEventListener("change", renderReport);

  const unsubscribe = store.subscribe(sync);
  sync();

  return () => {
    unsubscribe();
    panel.remove();
  };
}
