import { getPhaseLabel } from "./simulation-rulebook.js";

// 当前只接入装备组选择和只读检查。
// 不保存攻击计划，不扣弹，不执行伤害或推进阶段。

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

  const panel = element("details");
  panel.append(element("summary", "攻撃装備・組別確認"));

  const actor = element("select");
  const equipmentGroup = element("select");

  const actorLabel = element("label");
  actorLabel.append(element("span", "行動するユニット"), actor);

  const groupLabel = element("label");
  groupLabel.append(element("span", "使用する装備組"), equipmentGroup);

  const notice = element(
    "p",
    "装備組ごとの残弾・使用記録・損傷・次序を確認します。" +
    "攻撃結算は未接続です。この操作では弾薬を消費しません。"
  );
  notice.className = "note";

  const output = element("p");
  output.className = "note";
  output.style.whiteSpace = "pre-wrap";
  output.setAttribute("aria-live", "polite");

  panel.append(actorLabel, groupLabel, notice, output);
  aside.append(panel);

  let report = null;

  function showGroup() {
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

    const use = group.lastUsedTurn === null
      ? "未使用"
      : `ラウンド${group.lastUsedTurn}`;

    output.textContent = [
      `${report.unitName} / ${group.label}`,
      `${group.position} / 第${group.groupIndex + 1}組`,
      `現在：ラウンド${report.turnNumber}` +
        ` / ${getPhaseLabel(report.phaseId)}`,
      "",
      `残弾：${group.remainingAmmo ?? "未登録"}`,
      `最終使用：${use}`,
      `装備状態：${group.damaged ? "損傷" : "正常"}`,
      `投射率：${projection}`,
      `完全投射時の消費：${profile?.fullAmmoCost ?? "未登録"}`,
      "",
      "【装備・段階の確認】",
      ...(group.issues.length
        ? group.issues.map(issue => `・${issue}`)
        : ["接続済みの装備チェックでは阻害条件を検出していません。"]),
      "",
      "【未接続】",
      "目標資格・射程・地形・命中・被害の統合判定。",
      "正式な攻撃結算は実行できません。"
    ].join("\n");
  }

  function refillGroups() {
    const previous = equipmentGroup.value;
    report = null;
    equipmentGroup.replaceChildren(
      new Option("選択してください", "")
    );

    if (!actor.value) {
      equipmentGroup.disabled = true;
      showGroup();
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

      showGroup();
    } catch (error) {
      console.error(error);
      equipmentGroup.disabled = true;
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
      if (unit.side !== scene.controls.observationSide) continue;
      if (unit.observationLevel === "shadow") continue;

      actor.append(new Option(unit.name, unit.instanceId));
    }

    if ([...actor.options].some(
      option => option.value === previous
    )) {
      actor.value = previous;
    }

    refillGroups();
  }

  actor.addEventListener("change", () => {
    // 不把上一单位的同名组ID当作新单位的选择。
    equipmentGroup.value = "";
    refillGroups();
  });

  equipmentGroup.addEventListener("change", showGroup);

  const unsubscribe = store.subscribe(sync);
  sync();

  return () => {
    unsubscribe();
    panel.remove();
  };
}
