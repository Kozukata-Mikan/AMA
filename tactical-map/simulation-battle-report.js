// 战斗报告只读取真实结算历史。
// 不结算、不投币、不扣弹、不修改场景或旧记录。

const PHASE_LABELS = {
  start: "ラウンド開始",
  movement: "移動段階",
  "order-5": "次序5",
  "order-4": "次序4",
  "order-3": "次序3",
  "order-2": "次序2",
  "order-1": "次序1",
  pas: "PAS",
  special: "特殊効果判定",
  end: "ラウンド終了"
};

const SIDE_LABELS = {
  ally: "味方",
  enemy: "敵",
  neutral: "中立"
};

const STATUS_LABELS = {
  normal: "正常",
  light: "軽微な損傷",
  moderate: "中破",
  heavy: "大破",
  sinking: "沈没寸前",
  sunk: "沈没"
};

function count(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label}の記録が不正です。`);
  }

  return value;
}

function phaseLabel(id) {
  return PHASE_LABELS[id] ?? id ?? "未記録";
}

function unitName(unit, id) {
  return unit?.name || `名称未記録（${id}）`;
}

function weaponLabel(actor, groupId) {
  const group = actor?.equipmentState?.groups?.find(
    item => item.id === groupId
  );

  const equipment = actor?.snapshot?.equipmentSnapshots?.find(
    item => item.id === group?.equipmentId
  );

  return equipment?.name ||
    equipment?.label ||
    equipment?.id ||
    "兵装名未記録";
}

function add(map, key, create) {
  if (!map.has(key)) map.set(key, create());
  return map.get(key);
}

export function buildBattleReport(scene) {
  const ending = scene.simulationEndRuntime;

  if (!ending || ending.endedAt === null) {
    throw new Error(
      "全陣営の戦闘記録は、推演終了後に確認できます。"
    );
  }

  const records = scene.settlementRuntime?.attackRecords;

  if (!Array.isArray(records)) {
    throw new Error("正式結算の履歴を確認できません。");
  }

  const unitsById = new Map(
    scene.instances.map(unit => [unit.instanceId, unit])
  );

  const summaries = new Map();

  for (const unit of scene.instances) {
    summaries.set(unit.instanceId, {
      id: unit.instanceId,
      name: unitName(unit, unit.instanceId),
      side: SIDE_LABELS[unit.side] ?? "不明",
      attackCommandKeys: new Set(),
      receivedProjections: 0,
      receivedHits: 0,
      receivedWeapons: new Map(),
      calculatedDamage: 0,
      currentHp: unit.currentHp,
      status: STATUS_LABELS[unit.shipState?.status] ??
        unit.shipState?.status ??
        "状態未記録"
    });
  }

  function summaryFor(id) {
    return add(summaries, id, () => ({
      id,
      name: unitName(unitsById.get(id), id),
      side: "不明",
      attackCommandKeys: new Set(),
      receivedProjections: 0,
      receivedHits: 0,
      receivedWeapons: new Map(),
      calculatedDamage: 0,
      currentHp: null,
      status: "状態未記録"
    }));
  }

  const rounds = new Map();
  const commands = new Set();
  const hitKeys = new Set();

  let projectionCount = 0;
  let totalHits = 0;

  for (const record of records) {
    const round = add(rounds, record.turnNumber, () => ({
      number: record.turnNumber,
      phases: new Set(),
      attacks: new Map(),
      damage: new Map()
    }));

    round.phases.add(record.phaseId);

    for (const hit of record.hitReports) {
      if (
        !hit ||
        typeof hit.commandId !== "string" ||
        typeof hit.unitId !== "string" ||
        typeof hit.groupId !== "string" ||
        typeof hit.targetId !== "string"
      ) {
        throw new Error("攻撃者・兵装・目標の履歴が不正です。");
      }

      const occurrenceIndex = count(
        hit.occurrenceIndex ?? 0,
        "対象別投射番号"
      );

      const hitCount = count(hit.hit?.hitCount, "命中数");

      const commandKey = JSON.stringify([
        record.turnNumber,
        record.phaseId,
        hit.commandId
      ]);

      const hitKey = JSON.stringify([
        commandKey,
        occurrenceIndex
      ]);

      if (hitKeys.has(hitKey)) {
        throw new Error("対象別投射の履歴が重複しています。");
      }

      hitKeys.add(hitKey);
      commands.add(commandKey);

      const actor = unitsById.get(hit.unitId);
      const target = unitsById.get(hit.targetId);
      const weapon = weaponLabel(actor, hit.groupId);

      const source = hit.commandId.startsWith("autonomy:")
        ? "自律"
        : "手動";

      // 同一回合、攻击者、实际目标、兵装和来源合并展示。
      const rowKey = JSON.stringify([
        hit.unitId,
        hit.targetId,
        weapon,
        source
      ]);

      const row = add(round.attacks, rowKey, () => ({
        actor: unitName(actor, hit.unitId),
        target: unitName(target, hit.targetId),
        weapon,
        source,
        projections: 0,
        hits: 0,
        phases: new Set()
      }));

      row.projections += 1;
      row.hits += hitCount;
      row.phases.add(record.phaseId);

      projectionCount += 1;
      totalHits += hitCount;

      summaryFor(hit.unitId).attackCommandKeys.add(commandKey);

      const victim = summaryFor(hit.targetId);
      victim.receivedProjections += 1;
      victim.receivedHits += hitCount;

      const received = add(victim.receivedWeapons, weapon, () => ({
        weapon,
        projections: 0,
        hits: 0
      }));

      received.projections += 1;
      received.hits += hitCount;
    }

    // 伤害是按目标合算的，不擅自归因给某一次攻击。
    for (const targetReport of record.targetReports) {
      const damage = count(
        targetReport.hpDamage,
        "算定耐性被害"
      );

      const id = targetReport.targetId;
      const row = add(round.damage, id, () => ({
        target: unitName(unitsById.get(id), id),
        calculatedDamage: 0
      }));

      row.calculatedDamage += damage;
      summaryFor(id).calculatedDamage += damage;
    }
  }

  const pending = scene.attackRuntime?.commands ?? [];

  return {
    name: scene.name,
    endedAt: ending.endedAt,
    endedTurnNumber: ending.turnNumber,
    endedPhase: phaseLabel(ending.phaseId),
    elapsedMinutes: scene.turn.elapsedMinutes,
    recordCount: records.length,
    commandCount: commands.size,
    projectionCount,
    totalHits,

    rounds: [...rounds.values()]
      .sort((a, b) => a.number - b.number)
      .map(round => ({
        number: round.number,
        phases: [...round.phases].map(phaseLabel),
        attacks: [...round.attacks.values()].map(row => ({
          ...row,
          phases: [...row.phases].map(phaseLabel)
        })),
        damage: [...round.damage.values()]
      })),

    units: [...summaries.values()].map(unit => ({
      id: unit.id,
      name: unit.name,
      side: unit.side,
      attackCommands: unit.attackCommandKeys.size,
      receivedProjections: unit.receivedProjections,
      receivedHits: unit.receivedHits,
      receivedWeapons: [...unit.receivedWeapons.values()],
      calculatedDamage: unit.calculatedDamage,
      currentHp: unit.currentHp,
      status: unit.status
    })),

    // 只读保存的计划，不执行、不取消、不重新判断目标。
    pending: pending.map(command => {
      const actor = unitsById.get(command.unitId);

      const targetRef = command.targetRef ??
        (
          command.targetId
            ? { kind: "unit", id: command.targetId }
            : null
        );

      let target = "目標未記録";

      if (targetRef?.kind === "unit") {
        target = unitName(
          unitsById.get(targetRef.id),
          targetRef.id
        );
      } else if (targetRef?.kind === "group") {
        target = scene.groups.find(
          group => group.id === targetRef.id
        )?.name || `編隊名未記録（${targetRef.id}）`;
      }

      return {
        actor: unitName(actor, command.unitId),
        target,
        weapon: weaponLabel(actor, command.groupId),
        phase: phaseLabel(command.phaseId)
      };
    })
  };
}

// ===== 界面 =====

function element(tag, text = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function paragraph(text) {
  const node = element("p", text);
  node.className = "note";
  return node;
}

function table(headers, rows) {
  const wrap = element("div");
  wrap.className = "battle-report-table-wrap";

  const result = element("table");
  result.className = "battle-report-table";

  const head = element("thead");
  const heading = element("tr");

  for (const label of headers) {
    const cell = element("th", label);
    cell.scope = "col";
    heading.append(cell);
  }

  head.append(heading);

  const body = element("tbody");

  for (const values of rows) {
    const row = element("tr");

    for (const value of values) {
      row.append(element("td", String(value)));
    }

    body.append(row);
  }

  result.append(head, body);
  wrap.append(result);

  return wrap;
}

function renderBattleReport(report, nodes) {
  nodes.battleReportStatus.textContent =
    "推演終了後の全陣営復盤記録です。\n" +
    "保存された正式結算履歴だけを集計しています。" +
    "履歴のない過去の行動は推定しません。\n" +
    "実行命令数＝装備組の攻撃命令数。" +
    "対象別投射数＝実際の対象に対する投射回数。" +
    "範囲攻撃では両者が異なります。";

  nodes.battleReportOverview.replaceChildren(paragraph([
    `シナリオ：${report.name}`,
    `終了：ラウンド${report.endedTurnNumber} / ${report.endedPhase}`,
    `終了日時：${new Date(report.endedAt).toLocaleString("ja-JP")}`,
    `経過時間：${report.elapsedMinutes}分`,
    `結算済み攻撃段階：${report.recordCount}`,
    `実行命令：${report.commandCount}件`,
    `対象別投射：${report.projectionCount}回 / 命中：${report.totalHits}枚`,
    "終了ラウンドは、途中までの記録を含む場合があります。"
  ].join("\n")));

  nodes.battleReportRounds.replaceChildren();

  if (!report.rounds.length) {
    nodes.battleReportRounds.append(
      paragraph("保存された正式攻撃履歴はありません。")
    );
  }

  for (const round of report.rounds) {
    const section = element("details");
    section.open = true;

    section.append(element(
      "summary",
      `ラウンド${round.number} / ${round.phases.join("・")}`
    ));

    if (round.attacks.length) {
      section.append(table(
        ["攻撃側 → 目標", "兵装", "投射 / 命中", "段階", "操作"],
        round.attacks.map(row => [
          `${row.actor} → ${row.target}`,
          row.weapon,
          `${row.projections}回 / ${row.hits}枚`,
          row.phases.join("・"),
          row.source
        ])
      ));
    } else {
      section.append(paragraph("このラウンドの実行攻撃はありません。"));
    }

    if (round.damage.length) {
      section.append(paragraph(
        "【目標別の算定耐性被害】\n" +
        round.damage.map(row =>
          `${row.target}：${row.calculatedDamage}`
        ).join("\n") +
        "\n耐性被害は目標ごとの合算値です。" +
        "個々の攻撃への割当てや、終了時耐性との差とは区別します。"
      ));
    }

    nodes.battleReportRounds.append(section);
  }

  nodes.battleReportUnits.replaceChildren();

  if (report.units.length) {
    nodes.battleReportUnits.append(table(
      ["ユニット", "実行命令", "受けた投射・命中", "算定耐性被害", "終了時状態"],
      report.units.map(unit => [
        `${unit.name} / ${unit.side}`,
        unit.attackCommands
          ? `${unit.attackCommands}件`
          : "実行された攻撃なし",
        unit.receivedWeapons.length
          ? unit.receivedWeapons.map(item =>
              `${item.weapon}：投射${item.projections}回 / 命中${item.hits}枚`
            ).join("\n")
          : "記録なし",
        String(unit.calculatedDamage),
        `耐性：${unit.currentHp ?? "未記録"} / ${unit.status}`
      ])
    ));
  }

  nodes.battleReportUnits.append(paragraph(
    "「実行された攻撃なし」は、保存履歴内に実行攻撃がないことを示します。" +
    "待機理由や行動不能の原因を推定する表示ではありません。"
  ));

  nodes.battleReportPending.replaceChildren();

  if (report.pending.length) {
    nodes.battleReportPending.append(table(
      ["行動側 → 主目標", "兵装", "予定段階"],
      report.pending.map(plan => [
        `${plan.actor} → ${plan.target}`,
        plan.weapon,
        plan.phase
      ])
    ));
  } else {
    nodes.battleReportPending.append(
      paragraph("未実行の攻撃計画はありません。")
    );
  }
}

export function mountBattleReportUI(store) {
  const required = [
    "endSimulation",
    "showBattleReport",
    "battleReportDialog",
    "battleReportStatus",
    "battleReportOverview",
    "battleReportRounds",
    "battleReportUnits",
    "battleReportPending"
  ];

  const nodes = {};

  for (const id of required) {
    nodes[id] = document.getElementById(id);

    if (!nodes[id]) {
      throw new Error(`戦闘記録の表示要素がありません：${id}`);
    }
  }

  const aside = document.querySelector(".workspace > aside");
  const controller = new AbortController();
  let disposed = false;

  function showError(error) {
    console.error(error);

    const status = document.getElementById("status");
    if (!status) return;

    const ended = store.getSimulationStatus().ended;

    status.textContent = ended
      ? "推演は終了しています。\n" +
        `戦闘記録の表示処理：${error.message}`
      : error.message;

    status.classList.add("error");
  }

  function freezeControls() {
    if (!aside || !store.getSimulationStatus().ended) return;

    // 保留单位浏览与筛选；禁止操作面板继续写入。
    for (const control of aside.querySelectorAll(
      "button, input, select, textarea"
    )) {
      const browseControl =
        control.id === "branchFilter" ||
        control.id === "sideFilter" ||
        (
          control.tagName === "BUTTON" &&
          control.closest("#units")
        );

      if (!browseControl && !control.disabled) {
        control.disabled = true;
      }
    }
  }

  function sync() {
    if (disposed) return;

    const status = store.getSimulationStatus();

    nodes.endSimulation.disabled = status.ended;
    nodes.endSimulation.textContent = status.ended
      ? "推演終了済み"
      : "推演を終了";

    nodes.showBattleReport.disabled = !status.ended;

    freezeControls();
  }

  function openReport() {
    const report = store.getBattleReport();

    renderBattleReport(report, nodes);

    if (!nodes.battleReportDialog.open) {
      nodes.battleReportDialog.showModal();
    }
  }

  nodes.endSimulation.addEventListener("click", () => {
    try {
      const status = store.getSimulationStatus();

      if (status.ended) {
        openReport();
        return;
      }

      if (!window.confirm(
        "推演を終了し、全陣営の戦闘記録を表示します。\n" +
        "未実行の攻撃計画は実行されません。\n" +
        "終了後は行動や設定を変更できません。"
      )) {
        return;
      }

      store.endSimulation(status.revision);

      const message = document.getElementById("status");

      if (message) {
        message.textContent =
          "推演を終了しました。保存済みの戦闘記録を表示します。";
        message.classList.remove("error");
      }

      openReport();
    } catch (error) {
      // 报告渲染失败不冒充结束保存失败。
      showError(error);
    }
  }, { signal: controller.signal });

  nodes.showBattleReport.addEventListener("click", () => {
    try {
      openReport();
    } catch (error) {
      showError(error);
    }
  }, { signal: controller.signal });

  // 动态面板重建后，也保持结束后的只读显示。
  const observer = aside
    ? new MutationObserver(freezeControls)
    : null;

  observer?.observe(aside, {
    childList: true,
    subtree: true
  });

  const unsubscribe = store.subscribe(sync);

  sync();

  // 刷新已结束的推演时，自动重新展示报告。
  if (store.getSimulationStatus().ended) {
    try {
      openReport();
    } catch (error) {
      showError(error);
    }
  }

  return () => {
    disposed = true;
    controller.abort();
    observer?.disconnect();
    unsubscribe();

    if (nodes.battleReportDialog.open) {
      nodes.battleReportDialog.close();
    }
  };
}
