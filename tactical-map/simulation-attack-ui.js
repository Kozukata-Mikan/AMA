import {createRangeTargetEditor} from './simulation-range-target-ui.js?v=blast-area-1';
import {readWeaponTargetScope} from './weapon-profile-runtime.js?v=catalog-symbols-1';
import {manualPasEnabled} from './pas-control.js?v=day-catalog-pas-1';
import {AIR_ATTACK_MODES,airborneUnit,airAttackModes} from './air-ground-rules.js?v=car-return-1';
import { createFleetUnitSelector } from "./fleet-unit-selector.js?v=air-training-1";
import { getPhaseLabel } from "./simulation-rulebook.js?v=blast-area-1";
import { getHitModifiers } from "./weapon-hit-runtime.js?v=day-catalog-pas-1";



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



  const manualPas=element("input");manualPas.type="checkbox";manualPas.style.width="auto";
  const manualPasControl=labeled("手動PAS（観察中の陣営）",manualPas);
  const manualPasNote=element("p","自動ではPASを一覧から隠し、PAS段階に自動射撃します。手動では指定した計画だけをPAS段階に実行し、未指定の組は待機します。");manualPasNote.className="note";
  manualPas.addEventListener("change",async()=>{manualPas.disabled=true;try{await store.setManualPas(manualPas.checked);}catch(e){saveFeedback.textContent=e.message;}finally{manualPas.disabled=false;}});
  const actor = element("select");
  const fleetPicker = createFleetUnitSelector(actor, {label:"攻撃する編隊"});
  const target = element("select");
  const attackMethod=element("select"),attackMethodControl=labeled("対地・対艦攻撃方式",attackMethod);
  function syncAttackMethod(scene){const unit=scene.instances.find(u=>u.instanceId===actor.value),old=attackMethod.value;attackMethodControl.hidden=!airborneUnit(unit);attackMethod.replaceChildren(new Option("攻撃方式を選択",""),...AIR_ATTACK_MODES.filter(m=>airAttackModes(unit).includes(m[0])).map(m=>new Option(m[1]+(m[2]?`（不利${m[2]}）`:""),m[0])));restoreOption(attackMethod,old);}

    const followFormationAttack = element("input");
  followFormationAttack.type = "checkbox";
  followFormationAttack.style.width = "auto";

  const followControl = labeled(
    "分旗艦の攻撃に編隊が追随する",
    followFormationAttack
  );

  const followNote = element("p");
  followNote.className = "note";

  function syncFollowControl(scene, reset = false) {
    const unit = scene.instances.find(
      item => item.instanceId === actor.value
    );

    const allowed =
      unit?.observationOwn === true &&
      unit.observationLevel === "identified" &&
      unit.branch === "navy" &&
      unit.isFormationFlagship === true &&
      scene.groups.some(group => group.id === unit.groupId);

    followFormationAttack.disabled = !allowed;

    if (reset || !allowed) {
      followFormationAttack.checked = false;
    }

    followNote.textContent = allowed
      ? "勾選時は、選択した単体武器の全組に同じ艦船目標を割り当ててください。" +
        "同編隊の他艦は、保存済み計画を変更せず、使用可能な単体武器だけ追随登録します。" +
        "追随の保存も発射ではありません。"
      : "攻撃追随は所属編隊の分旗艦のみ指定できます。";
  }


  const equipmentList = element("div");
  equipmentList.setAttribute("role", "group");
  equipmentList.setAttribute("aria-label", "使用する装備組");
  const rangeEditors = new Map();
  function rangeScope(group) {
    try { const scope=readWeaponTargetScope(group.profile?.targetScope); return scope.kind==='range'?scope:null; }
    catch { return null; }
  }
  function clearRangePanel() { rangeEditors.clear(); }

  const selectionInfo = element("p");
  selectionInfo.className = "note";

  const toolbar = element("div");
  toolbar.style.display = "flex";
  toolbar.style.flexWrap = "wrap";
  toolbar.style.gap = "6px";

   const notice = element(
    "p",
    "装備組を選択し、目標を割り当ててください。" +
    "別の組には別の目標を割り当てられます。範囲武器を選択すると、その組の直下に範囲目標の設定欄が開きます。" +
    "「攻撃計画を保存」で計画を保存します。" +
    "PASは上の手動PAS設定に従います。手動の計画もPAS段階に実行し、通常次序では発射しません。" +
    "現在より低い最高次序の武器は、その次序に自動分類します。" +
    "待機中の計画は実行前に変更・取消できます。" +
    "計画の保存は発射ではありません。" +
    "射距・射高・射界の条件を満たさない単体攻撃は、" +
    "その組だけ登録を見送り、他の合法な計画は保存します。" +
    "登録を見送った組と理由は、保存結果に表示します。" +
    "「現在の攻撃段階を一括結算」で全陣営の保存計画を処理します。" +
    "範囲武器は各装備組の下で目標を指定し、単体武器と同じ保存ボタンで一括登録できます。" +
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
  const saveFeedback = element("p");
  saveFeedback.className = "note";
  saveFeedback.style.whiteSpace = "pre-wrap";
  saveFeedback.setAttribute("role", "status");
  saveFeedback.setAttribute("aria-live", "polite");


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
    group => group.profile?.kind !== "support" && (!group.profile?.pasOnly||manualPas.checked)
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
      const visibleScene = store.getSceneSnapshot();

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
          ` → ${command.targetRef?.kind==='point'?`座標（${command.targetRef.x}, ${command.targetRef.y}, ${command.targetRef.z}）`:command.targetRef?.kind==='group'?visibleScene.groups.find(g=>g.id===command.targetRef.id)?.name??"現在確認できない編隊":savedTarget?.name ?? "現在確認できない目標"}` +
         ` / 実行：${getPhaseLabel(command.phaseId)}` +
         (command.phaseId === saved.phaseId
         ? "［現在の段階］"
          : "［実行待ち］")

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
        "組数未登録の配置は暫定的に戦闘対象外です。" +
        "攻撃・装備組としての損傷処理には参加しません。"
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
    const environment = store.getSceneSnapshot().environment;

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

      
      if(rangeScope(group)){
        try{const selection=rangeEditors.get(group.groupId)?.read();const ref=selection?.targetRef;const scene=store.getSceneSnapshot();const name=ref?.kind==='point'?`座標（${ref.x}, ${ref.y}, ${ref.z}）`:ref?.kind==='group'?scene.groups.find(g=>g.id===ref.id)?.name:scene.instances.find(u=>u.instanceId===ref?.id)?.name;lines.push("",`範囲目標：${name??"未指定"}`);}catch{lines.push("","範囲目標：装備組の下で指定してください。");}
        continue;
      }
      const assignedTargetId = assignedTargets.get(group.groupId);

      if (!assignedTargetId) {
        lines.push("", "目標：未割り当て");
        continue;
      }

      // 只从当前观察副本读取目标名称。
      const visibleTarget = store.getSceneSnapshot().instances.find(
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
      const row = element("div");
      row.className = "attack-weapon-card";
      row.style.display = "block";
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

      const assignmentText = rangeScope(group)
        ? " / 範囲目標：この組の下で指定"
        : targetOption
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

      const scope=rangeScope(group);
      let rangeEditor=null;
      if(scope){
        rangeEditor=rangeEditors.get(group.groupId);
        if(!rangeEditor){
          const current=store.getAttackCommands(report.unitId).commands.find(c=>c.groupId===group.groupId);
          const available=store.getRangeAttackTargetOptions(report.unitId);
          rangeEditor=createRangeTargetEditor({options:available.options,coordinateMembers:available.coordinateMembers,penetration:group.profile.penetration,scope,initial:current?.targetRef?current:null});
          rangeEditor.element.addEventListener('change',renderReport);
          rangeEditors.set(group.groupId,rangeEditor);
        }
        rangeEditor.element.hidden=!checkbox.checked;
      }
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          selectedGroupIds.add(group.groupId);
        } else {
          selectedGroupIds.delete(group.groupId);
        }

        if(rangeEditor)rangeEditor.element.hidden=!checkbox.checked;
        updateSelectionInfo();
        renderReport();
      });

      const heading=element("label");heading.className="attack-weapon-card-heading";heading.append(checkbox,description);row.append(heading);
      if(rangeEditor)row.append(rangeEditor.element);
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

    const assignTarget = button("単体武器に目標を割り当て", () => {
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
      if(!rangeScope(group))assignedTargets.set(group.groupId, target.value);
    }

    renderEquipmentList();
    renderReport();
  });

  const removeAssignment = button("選択した組の目標を解除", () => {
    for (const group of selectedGroups()) {
      assignedTargets.delete(group.groupId);
      const scope=rangeScope(group);if(scope){const available=store.getRangeAttackTargetOptions(report.unitId);rangeEditors.set(group.groupId,createRangeTargetEditor({options:available.options,coordinateMembers:available.coordinateMembers,penetration:group.profile.penetration,scope}));}
    }

    renderEquipmentList();
    renderReport();
  });

       const saveCommands = button("攻撃計画を保存", async () => {
    saveFeedback.textContent = "";

    if (!report) {
      saveFeedback.textContent =
        "行動するユニットを選択してください。";
      return;
    }

    const groups = selectedGroups();

    if (!groups.length) {
      saveFeedback.textContent = "装備組を選択してください。";
      return;
    }

    let assignments;
    try{assignments=groups.map(group=>({groupId:group.groupId,...(rangeScope(group)?rangeEditors.get(group.groupId).read():{targetId:assignedTargets.get(group.groupId)})}));}
    catch(error){saveFeedback.textContent=error.message;return;}

    if (assignments.some(item => !item.targetId&&!item.targetRef)) {
      saveFeedback.textContent =
        "選択したすべての装備組に目標を割り当ててください。";
      return;
    }

    // 保存通知会同步刷新report，因此先保留此次提交的标签。
    const submittedGroups = new Map(
      groups.map(group => [
        group.groupId,
        `${group.position} / ${group.label}` +
        ` / 第${group.groupIndex + 1}組`
      ])
    );

    const submittedActorName = report.unitName;
    const submittedActorId = report.unitId;
    const submittedRevision = report.revision;

    try {
      const receipt = await store.saveAttackCommands({
        unitId: submittedActorId,
        assignments,
        followFormationAttack: followFormationAttack.checked,
        attackMethod:attackMethod.value||null
      }, submittedRevision);


      const saved = receipt.commands;
      const skipped = receipt.skippedCommands ?? [];

      const lines = [
        submittedActorName,
        `保存した攻撃計画：${saved.length}件`,
        `登録しなかった攻撃：${skipped.length}件`
      ];

      if (saved.length) {
        lines.push("", "【保存済み・未発射】");

        for (const command of saved) {
          lines.push(
            `・${submittedGroups.get(command.groupId) ?? "装備組"}` +
            ` / 実行：${getPhaseLabel(command.phaseId)}`
          );
        }

        lines.push(
          "未来の次序の計画は、その次序まで待機します。"
        );
      } else {
        lines.push(
          "今回の選択から保存された攻撃計画はありません。"
        );
      }

      if (skipped.length) {
        lines.push("", "【射距・射高・射界・側別使用枠による計画除外】");

        for (const command of skipped) {
          const groupLabel = command.unitId === submittedActorId
            ? submittedGroups.get(command.groupId) ?? "装備組"
            : "別ユニットの待機計画";

          lines.push(
            `・${groupLabel}`,
            command.reason,
            ""
          );
        }


        lines.push(
          "上記の攻撃計画は保存結果に含まれていません。" +
          "目標・位置・方位を変更した後、再登録できます。"
        );
      }

            if (receipt.follow?.enabled) {
        const followed = receipt.follow.commands;
        const followSkipped = receipt.follow.skipped;

        lines.push(
          "",
          "【編隊の攻撃追随】",
          `追随登録：${followed.length}組`,
          `追随を見送った項目：${followSkipped.length}件`
        );

        for (const command of followed) {
          lines.push(
            `・${command.unitName}`,
            `  ${command.groupLabel}`,
            `  実行：${getPhaseLabel(command.phaseId)}`
          );
        }

        if (followSkipped.length) {
          lines.push("", "【追随見送り・既存計画の保持】");

          for (const item of followSkipped) {
            lines.push(
              `・${item.unitName} / ${item.groupLabel}`,
              item.reason,
              ""
            );
          }
        }

        lines.push(
          "他艦の保存済み計画は変更していません。",
          "追随計画も未発射です。実行段階で条件を再確認します。"
        );
      }

      
      lines.push(
        "",
        "発射・コイン判定・弾薬消費・被害適用は行っていません。",
        "保存された計画も、実行段階で条件を再確認します。"
      );

      saveFeedback.textContent = lines.join("\n");
    } catch (error) {
      console.error(error);

      saveFeedback.textContent =
        error.message + "\n" +
        "今回の登録変更は保存していません。" +
        "以前に保存された計画は、この失敗では変更されません。";
      if (error.code === "ATTACK_SELECTION_INELIGIBLE") {
        saveFeedback.textContent += "\n射距などの条件を満たす目標・装備組を選び直してください。" +
          "攻撃を登録せずに「現在の攻撃段階を一括結算」で段階を進めることもできます。";
      }
    }
  });



  const cancelCommands = button(
    "選択した組の保存計画を取消",
    async () => {
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
        await store.cancelAttackCommands({
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

  const executeBatch = button("現在の攻撃段階を一括結算", async () => {
  const scene = store.getSceneSnapshot();

  if (!/^(order-[1-5]|pas)$/.test(scene.turn.phaseId)) {
    phaseOutput.textContent =
      "次序1～5またはPASで実行してください。";
    return;
  }

  if (!window.confirm(
    "実行段階が現在の段階である全陣営の攻撃計画を一括結算します。\n" +
    "未来の次序の計画は発射せず、そのまま保存します。\n" +
    "画面で選択した装備組だけの実行ではありません。\n" +
    "成功すると弾薬・被害・射線固定・履歴をまとめて保存し、" +
    "次の段階へ移ります。\n" +
    "未対応の条件がある場合は、保存せず停止します。"
  )) {
    return;
  }

  executeBatch.disabled = true;

  try {
    const result = await store.settleAttackPhase(scene.revision);

    phaseOutput.textContent =
      result.message + "\n" +
      `次の段階：${getPhaseLabel(result.nextPhaseId)}`;
    } catch (error) {
    console.error(error);
    console.error("結算の内部原因：", error.cause ?? error);

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
        store.getSceneSnapshot().turn.phaseId
      );
  }
});

const finishPhase = button("特殊段階・回合終了を処理", async () => {
  const scene = store.getSceneSnapshot();
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
      ? await store.finishSpecialPhase(scene.revision)
      : await store.finishTurn(scene.revision);

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
        store.getSceneSnapshot().turn.phaseId
      );
  }
});

// 流程布局使用这些标记取得原按钮和反馈区。
executeBatch.id = "attackExecuteBatch";
finishPhase.id = "attackFinishPhase";
phaseOutput.id = "phaseCommandFeedback";

toolbar.append(selectAll, clearAll);

panel.append(
  fleetPicker.field,
  labeled("行動する単艦", actor),
  attackMethodControl,
  element("p", "使用する装備組"),
  toolbar,
  manualPasControl,
  manualPasNote,
  selectionInfo,
  equipmentList,
  labeled("単体武器の目標（範囲武器は各組の下で指定）", target),
  assignTarget,
  removeAssignment,
  followControl,
  followNote,
  saveCommands,
  cancelCommands,
  executeBatch,
  finishPhase,
  notice,
  saveFeedback,
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
    const current=store.getSceneSnapshot();manualPas.checked=manualPasEnabled(current,current.controls.enemyAutonomy?"ally":current.controls.observationSide);manualPas.disabled=["special","end"].includes(current.turn.phaseId);
    report = null;

    if (!actor.value) {
      selectedGroupIds.clear();
      renderEquipmentList();
      renderReport();
      return;
    }

    try {
      clearRangePanel();
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
    const scene = store.getSceneSnapshot();
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


    fleetPicker.sync(scene, scene.instances.filter(unit =>
      !unit.aviationStored && unit.observationOwn === true && unit.observationLevel === "identified"));

    if (selectedActorId !== actor.value) {
      // 组ID只在单位内唯一，不跨单位沿用。
      selectedGroupIds.clear();
      assignedTargets.clear();
      clearRangePanel();
      target.value = "";
      selectedActorId = actor.value;
    }

   syncAttackMethod(scene);
   syncFollowControl(scene);
   refillTargets(scene);
   refreshReport();


  }

 actor.addEventListener("change", () => {
  saveFeedback.textContent = "";
  selectedGroupIds.clear();
  assignedTargets.clear();
  clearRangePanel();
  selectedActorId = actor.value;
  target.value = "";

  const scene = store.getSceneSnapshot();

  syncAttackMethod(scene);
  syncFollowControl(scene, true);
  refillTargets(scene);
  refreshReport();

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
