import {
  openSimulation
} from "./simulation-store.js";

import {
  readWeaponTargetScope
} from "./weapon-profile-runtime.js";

// 专用范围攻击页面。
// 不创建推演，不清理存档，不改部署快照。
// 攻击与取消操作统一调用原store事务入口。

const PREFIX = "junqi-simulation-v1:";

function element(tag, text) {
  const node = document.createElement(tag);

  if (text !== undefined) {
    node.textContent = text;
  }

  return node;
}

function fail(message) {
  throw new Error(message);
}

function listSaves() {
  const result = [];

  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);

    if (!key?.startsWith(PREFIX)) continue;

    try {
      const raw = localStorage.getItem(key);
      if (raw === null) continue;

      const value = JSON.parse(raw);

      if (
        value.version !== 1 ||
        value.mode !== "simulation" ||
        typeof value.id !== "string" ||
        key !== PREFIX + value.id
      ) {
        continue;
      }

      result.push({
        id: value.id,
        name: typeof value.name === "string"
          ? value.name
          : value.id
      });
    } catch {
      // 不修改或删除无法读取的旧存档。
    }
  }

  return result.sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );
}

function downloadJSON(name, value) {
  const blob = new Blob(
    [JSON.stringify(value, null, 2)],
    { type: "application/json;charset=utf-8" }
  );

  const url = URL.createObjectURL(blob);
  const link = element("a");

  link.href = url;
  link.download = name;
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function mountSimulationRangeWorkbench(container) {
  if (!(container instanceof Element)) {
    fail("表示先が不正です。");
  }

  const root = element("div");
  const setup = element("section");
  const status = element("p");
  const message = element("p");
  const auditBox = element("section");
  const panelBox = element("div");

  message.setAttribute("role", "alert");

  const saveSelect = element("select");
  const unitSelect = element("select");
  const openButton = element("button", "推演を開く");
  const settleButton = element(
    "button",
    "この攻撃段階の全計画を正式結算"
  );
  const exportButton = element(
    "button",
    "範囲表記の確認結果をダウンロード"
  );

  openButton.type = "button";
  settleButton.type = "button";
  exportButton.type = "button";

  settleButton.disabled = true;
  exportButton.disabled = true;
  unitSelect.disabled = true;

  const saveLabel = element("label", "推演データ ");
  saveLabel.append(saveSelect);

  const unitLabel = element("label", "操作するユニット ");
  unitLabel.append(unitSelect);

  setup.append(
    saveLabel,
    openButton,
    unitLabel,
    settleButton,
    exportButton,
    status
  );

  root.append(setup, message, auditBox, panelBox);
  container.append(root);

  let store = null;
  let unsubscribe = null;
  let attackPanel = null;
  let currentAudit = null;
  let disposed = false;

  function disposePanel() {
    if (attackPanel) {
      attackPanel.dispose();
      attackPanel = null;
    }

    panelBox.replaceChildren();
  }

  function closeStore() {
    disposePanel();

    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

    store = null;
    currentAudit = null;
  }

  function fillSaves() {
    saveSelect.replaceChildren();

    const saves = listSaves();

    for (const save of saves) {
      const option = element("option", save.name);
      option.value = save.id;
      saveSelect.append(option);
    }

    openButton.disabled = saves.length === 0;

    if (saves.length === 0) {
      message.textContent =
        "同じブラウザー・同じサイトに推演データがありません。";
    }
  }

  function getControllableReports() {
    const observed = store.getScene();
    const reports = [];

    for (const unit of observed.instances) {
      try {
        // 使用原store检查操作权限。
        // 被观察到不等于有权读取装备内部状态。
        const report = store.getAttackGroupReport(
          unit.instanceId
        );

        reports.push(report);
      } catch {
        // 不显示不可操作单位的内部资料或拒绝原因。
      }
    }

    return reports;
  }

  function renderAudit(reports) {
    auditBox.replaceChildren();

    auditBox.append(
      element("h2", "配置装備の範囲表記確認"),
      element(
        "p",
        "現在操作できるユニットの配置スナップショットだけを確認します。未公開の装備情報は取得しません。"
      )
    );

    const rows = [];
    const seen = new Set();

    for (const report of reports) {
      for (const group of report.groups) {
        if (group.profile?.kind !== "weapon") continue;

        const raw = group.profile.targetScope;
        const key = JSON.stringify([
          report.unitId,
          group.equipmentId,
          raw
        ]);

        if (seen.has(key)) continue;
        seen.add(key);

        let scope = null;
        let error = null;

        try {
          scope = readWeaponTargetScope(raw);
        } catch (caught) {
          error = caught.message;
        }

        rows.push({
          unitId: report.unitId,
          unitName: report.unitName,
          equipmentId: group.equipmentId,
          equipmentLabel: group.label,
          targetScope: raw,
          supported: error === null,
          scope,
          error
        });
      }
    }

    const table = element("table");
    const head = element("thead");
    const header = element("tr");

    for (const title of [
      "ユニット",
      "装備",
      "配置時の範囲表記",
      "確認結果"
    ]) {
      header.append(element("th", title));
    }

    head.append(header);
    table.append(head);

    const body = element("tbody");

    for (const row of rows) {
      const tr = element("tr");

      let result;

      if (!row.supported) {
        result = row.error;
      } else if (row.scope.kind === "single") {
        result = "単体";
      } else {
        result =
          `${row.scope.mode}／上限：` +
          (
            row.scope.maximumTargets === null
              ? "全体"
              : row.scope.maximumTargets
          );
      }

      tr.append(
        element("td", row.unitName),
        element("td", row.equipmentLabel),
        element("td", row.targetScope || "未登録"),
        element("td", result)
      );

      body.append(tr);
    }

    table.append(body);
    auditBox.append(table);

    const unsupported = rows.filter(row => !row.supported);

    auditBox.append(element(
      "p",
      unsupported.length === 0
        ? "表示対象の範囲表記はすべて解析できました。これは戦闘全体の動作検証完了を意味しません。"
        : `解析できない範囲表記が${unsupported.length}件あります。配置資料を書き換えて回避しないでください。`
    ));

    currentAudit = {
      format: "junqi-range-scope-audit-v1",
      generatedAt: new Date().toISOString(),
      visibilityScope: "currently-controllable-units",
      rows
    };

    exportButton.disabled = false;
  }

  function renderUnits(reports) {
    const previousId = unitSelect.value;
    unitSelect.replaceChildren();

    for (const report of reports) {
      const option = element("option", report.unitName);
      option.value = report.unitId;
      unitSelect.append(option);
    }

    if (reports.some(report => report.unitId === previousId)) {
      unitSelect.value = previousId;
    }

    unitSelect.disabled = reports.length === 0;
  }

  function mountSelectedPanel() {
    disposePanel();

    if (!store || unitSelect.disabled || !unitSelect.value) {
      return;
    }

    attackPanel = store.mountRangeAttackPanel(
      panelBox,
      unitSelect.value
    );
  }

  function refresh() {
    if (disposed || !store) return;

    const scene = store.getScene();
    const reports = getControllableReports();

    status.textContent =
      `ラウンド：${scene.turn.number}／` +
      `段階：${scene.turn.phaseId}／` +
      `経過：${scene.turn.elapsedMinutes}分`;

    settleButton.disabled =
      !/^(order-[1-5]|pas)$/.test(scene.turn.phaseId);

    renderUnits(reports);
    renderAudit(reports);
  }

  openButton.addEventListener("click", () => {
    try {
      message.textContent = "";
      closeStore();

      if (!saveSelect.value) {
        fail("推演データを選択してください。");
      }

      store = openSimulation(saveSelect.value);

      // 原store同步保存成功后触发刷新。
      unsubscribe = store.subscribe(refresh);

      refresh();
      mountSelectedPanel();
    } catch (error) {
      closeStore();

      settleButton.disabled = true;
      exportButton.disabled = true;
      unitSelect.disabled = true;

      message.textContent = error.message;
    }
  });

  unitSelect.addEventListener("change", () => {
    try {
      message.textContent = "";
      mountSelectedPanel();
    } catch (error) {
      message.textContent = error.message;
    }
  });

  settleButton.addEventListener("click", () => {
    try {
      if (!store) {
        fail("推演を開いてください。");
      }

      // 同一批次包括所有阵营，不只结算当前单位。
      const report = store.getAttackCommands(unitSelect.value);

      const confirmed = globalThis.confirm(
        "この攻撃段階の全陣営の計画を正式結算します。" +
        "成功すると弾薬を消費し、次の段階へ移ります。" +
        "実行しますか？"
      );

      if (!confirmed) return;

      const receipt = store.settleAttackPhase(report.revision);
      message.textContent = receipt.message;

      // 阶段已变化，重建目标编辑器。
      mountSelectedPanel();
    } catch {
      // 不将全批内部失败详情直接显示给当前观察玩家。
      message.textContent =
        "全批次を結算できませんでした。" +
        "開始記録・攻撃条件・未対応の効果・保存状態を確認してください。" +
        "この画面では内部の目標情報を表示しません。";
    }
  });

  exportButton.addEventListener("click", () => {
    if (!currentAudit) return;

    downloadJSON(
      "junqi-range-scope-audit.json",
      currentAudit
    );
  });

  fillSaves();

  return {
    element: root,

    dispose() {
      if (disposed) return;
      disposed = true;
      closeStore();
      root.remove();
    }
  };
}
