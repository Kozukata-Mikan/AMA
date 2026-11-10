import { getPhaseLabel } from "./simulation-rulebook.js";
import { getHitModifiers } from "./weapon-hit-runtime.js";



// 多组选装、逐组目标、批量检查与攻击计划保存。
// 页面选择和已保存计划分开管理。
// 保存计划不扣弹、不掷随机数、不执行伤害、不推进阶段。


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
  const rangeHost = element("div");
rangeHost.className = "attack-range-editor-host";

let mountedRangePanel = null;
let mountedRangeKey = "";

function clearRangePanel() {
  mountedRangePanel?.dispose();
  mountedRangePanel = null;
  mountedRangeKey = "";
  rangeHost.replaceChildren();
}

function syncRangePanel(scene) {
  const actingUnit = scene.instances.find(
    unit => unit.instanceId === actor.value
  );

  if (
    actingUnit?.observationOwn !== true ||
    actingUnit.observationLevel !== "identified"
  ) {
    clearRangePanel();
    return;
  }

  const key = JSON.stringify([
    scene.controls.observationSide,
    actingUnit.instanceId
  ]);

  // 同一单位的保存通知由范围面板自己的订阅刷新。
  if (key === mountedRangeKey) return;

  clearRangePanel();

  try {
    mountedRangePanel = store.mountRangeAttackPanel(
      rangeHost,
      actingUnit.instanceId
    );

    mountedRangeKey = key;
  } catch (error) {
    clearRangePanel();

    const message = element("p");
    message.className = "note";
    message.textContent = error.message;
    rangeHost.append(message);
  }
}


  const selectionInfo = element("p");
  selectionInfo.className = "note";

  const toolbar = element("div");
  toolbar.style.display = "flex";
  toolbar.style.flexWrap = "wrap";
  toolbar.style.gap = "6px";

   const notice = element(
    "p",
    "装備組を選択し、目標を割り当ててください。" +
    "別の組には別の目標を割り当てられます。" +
    "「攻撃計画を保存」で現在の段階の計画を保存します。" +
    "計画の保存は発射ではありません。" +
    "「現在の攻撃段階を一括結算」で全陣営の保存計画を処理します。" +
    "単体・集群を含む攻撃装備を同じ一覧に表示します。" +
    "編隊の主目標や対象メンバーの指定が必要な武器は、" +
    "このパネル内の範囲対象編集で計画を保存してください。" +
    "未対応の効果・特殊能力がある場合は、正式結算を停止します。"


  );
  notice.className = "note";

  const output = element("p");
  const phaseOutput = element("p");
  phaseOutput.id = "phaseCommandFeedback";
  phaseOutput.className = "note";
  phaseOutput.setAttribute("role", "status");
  phaseOutput.setAttribute("aria-live", "polite");
  output.className = "note";
  output.style.whiteSpace = "pre-wrap";
  output.setAttribute("aria-live", "polite");

  let report = null;
  let selectedActorId = "";
  const selectedGroupIds = new Set();
    // 当前舰船各装备组的目标分配。
  // 仅用于界面检查，尚未保存为正式攻击命令。
  const assignedTargets = new Map();


function selectableGroups() {
  if (!report) return [];

  // 恢复原列表行为。
  // 不因范围名称、解析结果或攻击次序而静默隐藏装备组。
  // 支援装备仍不列入攻击组选装。
  return report.groups.filter(
    group => group.profile?.kind !== "support"
  );
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

       try {
      const saved = store.getAttackCommands(report.unitId);
      const visibleScene = store.getScene();

      lines.push(
        "",
        `保存済み攻撃計画：${saved.commands.length}組`
      );

      for (const command of saved.commands) {
        const group = report.groups.find(
          item => item.groupId === command.groupId
        );

        const savedTarget = command.targetId
          ? visibleScene.instances.find(
              unit =>
                unit.instanceId === command.targetId &&
                unit.observationLevel === "identified"
            )
          : null;

        lines.push(
          `・${group?.label ?? "装備組"}` +
          ` / 第${(group?.groupIndex ?? 0) + 1}組` +
          ` → ${savedTarget?.name ?? "現在確認できない目標"}`
        );
      }

      lines.push("保存済み計画は未発射です。");

            const resources = store.getAttackResourceReport(
        report.unitId
      );

      lines.push(
        "",
        "【批次資源準備】",
        resources.reason
      );

      for (const entry of resources.entries) {
        const resourceGroup = report.groups.find(
          item => item.groupId === entry.groupId
        );

        lines.push(
          `・${resourceGroup?.label ?? "装備組"}` +
          ` / 第${(resourceGroup?.groupIndex ?? 0) + 1}組` +
          `：残弾 ${entry.ammoBefore}` +
          ` → 使用予定 ${entry.ammoCost}` +
          ` → 使用後予定 ${entry.ammoAfter}`
        );
      }

      lines.push("予定値です。残弾は変更していません。");

    } catch (error) {
      console.error(error);
      lines.push(`保存計画を確認できません：${error.message}`);
    }

    
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

    lines.push(
      "各装備組に割り当てた目標を確認します。",
      "目標の選択だけでは割り当ては変更されません。"
    );


        // 从观察副本读取环境，不读取完整战场内部状态。
    const environment = store.getScene().environment;

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
        `状態：${group.destroyed ? "完全破損・修復不可": group.damaged? "損傷": "正常"}`,
        `投射率：${projectionText(profile)}`,
        `完全投射時の消費：${profile?.fullAmmoCost ?? "未登録"}`,
        "",
        "【装備・段階】",
        ...(group.issues.length
          ? group.issues.map(issue => `・${issue}`)
          : ["接続済みのチェックでは阻害条件を検出していません。"])
      );

            lines.push("", "【時刻・天候の命中修正】");

      try {
        const modifiers = getHitModifiers({
          guidance: profile?.guidance,
          environment
        });

        const detail = modifiers.breakdown;

        lines.push(
          `時刻による不利判定：${detail.timePenalties}`,
          `天候による不利判定：${detail.weatherPenalties}`
        );

        if (profile?.projection?.standalone) {
          lines.push(
            "単独Rには束の有利・不利判定を適用しません。"
          );
        } else if (profile?.projection) {
          const stackCount = profile.projection.groups;
          const effectivePenalties = Math.min(
            stackCount,
            modifiers.penalties
          );

          lines.push(
            `環境要因だけの場合の適用回数：${effectivePenalties}`,
            `元の束数による上限：${stackCount}`,
            "最終判定では、他の有利・不利判定を合算し、" +
            "相殺してから上限を適用します。"
          );
        }

        lines.push(
          "練度・特殊能力はこの環境表示に含めていません。",
          "コインは投げていません。"
        );
      } catch (error) {
        console.error(error);
        lines.push(
          `環境修正を確認できません：${error.message}`
        );
      }

      
            const assignedTargetId = assignedTargets.get(group.groupId);

      if (!assignedTargetId) {
        lines.push("", "目標：未割り当て");
        continue;
      }

      // 只从当前观察副本读取目标名称。
      const visibleTarget = store.getScene().instances.find(
        unit =>
          unit.instanceId === assignedTargetId &&
          unit.observationLevel === "identified"
      );

      if (!visibleTarget) {
        lines.push("", "割り当てた目標は現在確認できません。");
        continue;
      }

      lines.push("", `割り当て目標：${visibleTarget.name}`);

      try {
        const check = store.getAttackTargetReport({
          unitId: report.unitId,
          groupId: group.groupId,
          targetId: assignedTargetId
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

               if (check.armorPreview?.length) {
          lines.push(
            "",
           "【威力・被害処理の確認】",
            ...check.armorPreview
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

    if (group.destroyed) { flags.push("完全破損");} else if (group.damaged) {flags.push("損傷");}
      if (group.lastUsedTurn === report.turnNumber) {
        flags.push("使用済み");
      }
      if (group.issues.length) flags.push("確認事項あり");

            const assignedTargetId = assignedTargets.get(group.groupId);

      const targetOption = [...target.options].find(
        option =>
          assignedTargetId &&
          option.value === assignedTargetId
      );

      const assignmentText = targetOption
        ? ` / 目標：${targetOption.textContent}`
        : " / 目標：未割り当て";


       const description = element(
        "span",
      `${group.position} / ${group.label}` +
      ` / 第${group.groupIndex + 1}組` +
      ` / 範囲 ${group.profile?.targetScope || "未登録"}` +
      ` / 残弾 ${group.remainingAmmo ?? "未登録"}` +
      assignmentText +

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

    const assignTarget = button("選択した組に目標を割り当て", () => {
    const groups = selectedGroups();

    if (!groups.length) {
      output.textContent = "装備組を選択してください。";
      return;
    }

    if (!target.value) {
      output.textContent = "割り当てる目標を選択してください。";
      return;
    }

    for (const group of groups) {
      assignedTargets.set(group.groupId, target.value);
    }

    renderEquipmentList();
    renderReport();
  });

  const removeAssignment = button("選択した組の目標を解除", () => {
    for (const group of selectedGroups()) {
      assignedTargets.delete(group.groupId);
    }

    renderEquipmentList();
    renderReport();
  });

    const saveCommands = button("攻撃計画を保存", () => {
    if (!report) {
      output.textContent = "行動するユニットを選択してください。";
      return;
    }

    const groups = selectedGroups();

    if (!groups.length) {
      output.textContent = "装備組を選択してください。";
      return;
    }

    const assignments = groups.map(group => ({
      groupId: group.groupId,
      targetId: assignedTargets.get(group.groupId)
    }));

    if (assignments.some(item => !item.targetId)) {
      output.textContent =
        "選択したすべての装備組に目標を割り当ててください。";
      return;
    }

    try {
      store.saveAttackCommands({
        unitId: report.unitId,
        assignments
      }, report.revision);

      output.textContent =
        "攻撃計画を保存しました。\n" +
        "発射・コイン判定・弾薬消費・被害適用は行っていません。";
    } catch (error) {
      console.error(error);
      output.textContent = error.message;
    }
  });

  const cancelCommands = button(
    "選択した組の保存計画を取消",
    () => {
      if (!report) {
        output.textContent = "行動するユニットを選択してください。";
        return;
      }

      const groupIds = selectedGroups().map(
        group => group.groupId
      );

      if (!groupIds.length) {
        output.textContent = "装備組を選択してください。";
        return;
      }

      try {
        store.cancelAttackCommands({
          unitId: report.unitId,
          groupIds
        }, report.revision);

        output.textContent =
          "選択した装備組の保存計画を取り消しました。";
      } catch (error) {
        console.error(error);
        output.textContent = error.message;
      }
    }
  );

  const executeBatch = button("現在の攻撃段階を一括結算", () => {
  const scene = store.getScene();

  if (!/^(order-[1-5]|pas)$/.test(scene.turn.phaseId)) {
    phaseOutput.textContent =
      "次序1～5またはPASで実行してください。";
    return;
  }

  if (!window.confirm(
    "現在の段階に保存された全陣営の攻撃計画を一括結算します。\n" +
    "画面で選択した装備組だけの実行ではありません。\n" +
    "成功すると弾薬・被害・射線固定・履歴をまとめて保存し、" +
    "次の段階へ移ります。\n" +
    "未対応の条件がある場合は、保存せず停止します。"
  )) {
    return;
  }

  executeBatch.disabled = true;

  try {
    const result = store.settleAttackPhase(scene.revision);

    phaseOutput.textContent =
      result.message + "\n" +
      `次の段階：${getPhaseLabel(result.nextPhaseId)}`;
  } catch (error) {
    console.error(error);

    // 不向其他观察阵营直接显示完整内部异常。
   const safeMessage =
  error?.name === "SimulationSettlementError" &&
  typeof error.publicMessage === "string"
    ? error.publicMessage
    : "一括結算または保存処理を完了できませんでした。";

phaseOutput.textContent =
  safeMessage + "\n" +
  "今回の弾薬・被害・履歴・段階変更は保存していません。";

  } finally {
    executeBatch.disabled =
      !/^(order-[1-5]|pas)$/.test(
        store.getScene().turn.phaseId
      );
  }
});

const finishPhase = button("特殊段階・回合終了を処理", () => {
  const scene = store.getScene();
  const phaseId = scene.turn.phaseId;

  if (!["special", "end"].includes(phaseId)) {
    phaseOutput.textContent =
      "特殊効果チェックまたはラウンド終了段階で実行してください。";
    return;
  }

  const confirmation = phaseId === "special"
    ? "全艦の火災・浸水・設備損管と、対応済みの判定時期に達した任務をまとめて処理します。\n" +
      "成功するとラウンド終了段階へ移ります。時刻は進めません。"
    : "自然沈没の計時とラウンド終了処理をまとめて保存します。\n" +
      "成功した場合だけ30分進めて次のラウンドへ移ります。";

  if (!window.confirm(confirmation)) return;

  finishPhase.disabled = true;

  try {
    const result = phaseId === "special"
      ? store.finishSpecialPhase(scene.revision)
      : store.finishTurn(scene.revision);

    phaseOutput.textContent = result.message;
  } catch (error) {
    console.error(error);

    phaseOutput.textContent =
      "段階終了処理を完了できませんでした。\n" +
      "今回の状態・履歴・段階・時刻変更は保存していません。\n" +
      "未対応の特殊能力、装備損管、開始記録、" +
      "または保存状態を確認してください。";
  } finally {
    finishPhase.disabled =
      !["special", "end"].includes(
        store.getScene().turn.phaseId
      );
  }
});

// 流程布局使用这些标记取得原按钮和反馈区。
executeBatch.id = "attackExecuteBatch";
finishPhase.id = "attackFinishPhase";
phaseOutput.id = "phaseCommandFeedback";

toolbar.append(selectAll, clearAll);

panel.append(
  labeled("行動するユニット", actor),
  element("p", "使用する装備組"),
  toolbar,
  selectionInfo,
  equipmentList,
  labeled("選択した装備組に割り当てる目標", target),
  assignTarget,
  removeAssignment,
  saveCommands,
  cancelCommands,
  rangeHost,
  executeBatch,
  finishPhase,
  notice,
  output,
  phaseOutput

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

     const visibleTargetIds = new Set(
      [...target.options]
        .map(option => option.value)
        .filter(Boolean)
    );

    // 目标失去识别或不再出现在候选列表时，清除检查分配。
    // 当前分配不是正式命令，因此不保留隐藏目标引用。
    for (const [groupId, targetId] of assignedTargets) {
      if (!visibleTargetIds.has(targetId)) {
        assignedTargets.delete(groupId);
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

      for (const id of assignedTargets.keys()) {
        if (!validIds.has(id)) assignedTargets.delete(id);
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
    const attackPhase = /^(order-[1-5]|pas)$/.test(
  scene.turn.phaseId
);

executeBatch.disabled = !attackPhase;

finishPhase.disabled =
  !["special", "end"].includes(scene.turn.phaseId);

finishPhase.textContent = scene.turn.phaseId === "end"
  ? "ラウンド終了を処理（30分進行）"
  : "特殊段階を処理";


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
      assignedTargets.clear();
      target.value = "";
      selectedActorId = actor.value;
    }

   refillTargets(scene);
   refreshReport();
   syncRangePanel(scene);

  }

 actor.addEventListener("change", () => {
  selectedGroupIds.clear();
  assignedTargets.clear();
  selectedActorId = actor.value;
  target.value = "";

  const scene = store.getScene();

  refillTargets(scene);
  refreshReport();
  syncRangePanel(scene);
});


  target.addEventListener("change", renderReport);

  const unsubscribe = store.subscribe(sync);
  sync();

 let disposed = false;

return () => {
  if (disposed) return;
  disposed = true;

  unsubscribe();
  clearRangePanel();


  // 流程布局把这些节点移到了原面板外，需单独清理。
  executeBatch.remove();
  finishPhase.remove();
  phaseOutput.remove();
  panel.remove();
};

}
