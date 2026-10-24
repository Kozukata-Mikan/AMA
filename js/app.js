import {
  loadUnitData,
  findUnit,
  getUnitsByBranch,
  getBranchName
} from "./data-store.js";

import {
  createBattleStore
} from "./battle-state.js";

import {
  previewAction
} from "./combat-engine.js";

const views = {
  "navy-calculator": {
    title: "海軍計算",
    branch: "navy",
    type: "calculator"
  },
  "air-calculator": {
    title: "航空機計算",
    branch: "air",
    type: "calculator"
  },
  "army-calculator": {
    title: "陸軍計算",
    branch: "army",
    type: "calculator"
  },
  "navy-catalog": {
    title: "海軍図鑑",
    branch: "navy",
    type: "catalog"
  },
  "air-catalog": {
    title: "航空機図鑑",
    branch: "air",
    type: "catalog"
  },
  "army-catalog": {
    title: "陸軍図鑑",
    branch: "army",
    type: "catalog"
  }
};

const status = document.getElementById("status");
const viewTitle = document.getElementById("view-title");
const viewContent = document.getElementById("view-content");
const battleContent = document.getElementById("battle-content");
const storageStatus = document.getElementById("storage-status");
const clearButton = document.getElementById("clear-battle");
const navigationButtons = document.querySelectorAll("[data-view]");

let units = [];
let battleStore;
let currentView = "navy-calculator";

// 各计算页面分别记住上次选择，但共用同一套参战状态。
const selections = {
  navy: { attackerId: "", targetId: "", actionType: "攻撃" },
  air: { attackerId: "", targetId: "", actionType: "攻撃" },
  army: { attackerId: "", targetId: "", actionType: "攻撃" }
};

function element(tag, text = "", className = "") {
  const node = document.createElement(tag);

  if (text) {
    node.textContent = text;
  }

  if (className) {
    node.className = className;
  }

  return node;
}

// 个体已有快照时优先使用，避免图鉴修改影响现有参战个体。
function getInstanceBase(instance) {
  const base = instance.snapshot || findUnit(units, instance.unitId);

  if (!base) {
    throw new Error(
      `参戦ユニットの図鑑資料が見つかりません：${instance.unitId}`
    );
  }

  return base;
}


function instanceLabel(instance) {
  const base = getInstanceBase(instance);


  return (
    `${base.name} · ${getBranchName(base.branch)}` +
    ` · 識別番号の末尾6桁 ${instance.instanceId.slice(-6)}` +
    ` · 現在耐性 ${instance.currentHp}`
  );
}

function makeField(labelText, control) {
  const label = element("label", "", "field");
  label.append(element("span", labelText), control);
  return label;
}

function makeInstanceSelect(list, selectedId, placeholder) {
  const select = element("select");

  select.append(new Option(placeholder, ""));

  for (const instance of list) {
    select.append(
      new Option(instanceLabel(instance), instance.instanceId)
    );
  }

  select.value = list.some(
    item => item.instanceId === selectedId
  ) ? selectedId : "";

  return select;
}

function renderCatalog(branch) {
  const description = element(
    "p",
    "これらの資料は共通データソースから取得しています。「現在のシミュレーションに追加」を押すと、独立した参戦個体が作成されます。",
    "muted"
  );

  viewContent.append(description);

  const list = getUnitsByBranch(units, branch);

  if (list.length === 0) {
    viewContent.append(element("p", "ユニット資料はまだありません。"));
    return;
  }

  const cards = element("div", "", "cards");

  for (const unit of list) {
    const card = element("article", "", "card");

    card.append(
      element("h3", unit.name),
      element("p", `図鑑番号：${unit.id}`),
      element("p", `面目：${getBranchName(unit.branch)}`),
      element("p", `種別：${unit.category || "未入力"}`),
      element("p", `基礎最大耐性：${unit.maxHp}`),
      element("p", unit.description || "説明はまだありません。", "muted")
    );

    const addButton = element(
      "button",
      "現在のシミュレーションに追加",
      "primary"
    );

    addButton.type = "button";

    addButton.addEventListener("click", () => {
      battleStore.addUnit(unit.id);

      status.textContent =
        `追加済み：${unit.name}。下部で確認できます。引き続き、他のユニットも追加できます。`;
    });

    card.append(addButton);
    cards.append(card);
  }

  viewContent.append(cards);
}

function renderCalculator(branch) {
  const instances = battleStore.getAll();
  const choice = selections[branch];

const attackers = instances.filter(instance => {
  const base = getInstanceBase(instance);
  return base.branch === branch;
});

  });

  const attackerSelect = makeInstanceSelect(
    attackers,
    choice.attackerId,
    "行動ユニットを選択してください"
  );

  choice.attackerId = attackerSelect.value;

  const targets = instances.filter(
    instance => instance.instanceId !== choice.attackerId
  );

  const targetSelect = makeInstanceSelect(
    targets,
    choice.targetId,
    "目標を選択してください。異なる面目からも選択できます"
  );

  choice.targetId = targetSelect.value;

  const actionSelect = element("select");

  for (const action of ["攻撃", "防空", "その他の行動"]) {
    actionSelect.append(new Option(action, action));
  }

  actionSelect.value = choice.actionType;

  const result = element(
    "div",
    "双方のユニットを選択後、ボタンを押してモジュール間のデータ連携を確認してください。",
    "result"
  );

  result.setAttribute("role", "status");

  attackerSelect.addEventListener("change", () => {
    choice.attackerId = attackerSelect.value;

    // 目標一覧を再生成し、選択した行動ユニットを除外します。
    renderView();
  });

  targetSelect.addEventListener("change", () => {
    choice.targetId = targetSelect.value;
    result.textContent = "選択内容が更新されました。再度プレビューしてください。";
  });

  actionSelect.addEventListener("change", () => {
    choice.actionType = actionSelect.value;
    result.textContent = "行動種別が更新されました。再度プレビューしてください。";
  });

  const previewButton = element(
    "button",
    "データ連携をプレビュー（戦闘計算なし）",
    "primary"
  );

  previewButton.type = "button";
  previewButton.disabled =
    attackers.length === 0 || instances.length < 2;

  previewButton.addEventListener("click", () => {
    try {
      result.textContent = previewAction({
        units,
        instances: battleStore.getAll(),
        attackerId: choice.attackerId,
        targetId: choice.targetId,
        actionType: choice.actionType
      });
    } catch (error) {
      result.textContent = error.message;
    }
  });

  viewContent.append(
    element(
      "p",
      "行動ユニットは本面目に限定されます。目標は全参戦ユニットから選択できます。行動種別は接続確認用の仮項目であり、正式な規則による判定は未実装です。",
      "muted"
    ),
    makeField("行動ユニット", attackerSelect),
    makeField("目標ユニット", targetSelect),
    makeField("行動種別", actionSelect),
    previewButton,
    result
  );

  if (attackers.length === 0) {
    viewContent.append(
      element(
        "p",
        `先に${getBranchName(branch)}図鑑を開き、ユニットを現在のシミュレーションに追加してください`,
        "muted"
      )
    );
  }
}

function renderView() {
  const config = views[currentView];

  viewTitle.textContent = config.title;
  viewContent.replaceChildren();

  for (const button of navigationButtons) {
    const active = button.dataset.view === currentView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  if (config.type === "catalog") {
    renderCatalog(config.branch);
  } else {
    renderCalculator(config.branch);
  }
}

function renderBattle() {
  battleContent.replaceChildren();

  storageStatus.textContent =
    battleStore.getStorageWarning() ||
    "現在のシミュレーションはこのブラウザー内にのみ保存され、他の端末には自動同期されません。";

  const instances = battleStore.getAll();

  clearButton.disabled =
  instances.length === 0 && !battleStore.isRecoveryBlocked();


  if (instances.length === 0) {
    battleContent.append(
      element("p", "参戦ユニットはまだありません。先に図鑑を開き、「現在のシミュレーションに追加」を押してください。")
    );
    return;
  }

  const wrapper = element("div", "", "table-wrapper");
  const table = element("table");
  const head = element("thead");
  const headingRow = element("tr");

  for (const title of [
    "参戦ユニット",
    "面目",
    "基礎最大耐性",
    "現在耐性",
    "操作"
  ]) {
    const th = element("th", title);
    th.scope = "col";
    headingRow.append(th);
  }

  head.append(headingRow);

  const body = element("tbody");

  for (const instance of instances) {
    const base = getInstanceBase(instance);
    const row = element("tr");

    const nameCell = element(
      "td",
      `${base.name}（${instance.instanceId.slice(-6)}）`
    );

    const branchCell = element(
      "td",
      getBranchName(base.branch)
    );

    const maxHpCell = element("td", String(base.maxHp));

    const hpCell = element("td");
    const hpInput = element("input");

    hpInput.type = "number";
    hpInput.min = "0";
    hpInput.max = String(base.maxHp);
    hpInput.step = "any";
    hpInput.value = String(instance.currentHp);
    hpInput.setAttribute(
      "aria-label",
      `${base.name} ${instance.instanceId.slice(-6)} の現在耐性`
    );

    const saveButton = element("button", "保存");
    saveButton.type = "button";

    saveButton.addEventListener("click", () => {
      try {
        if (hpInput.value.trim() === "") {
          throw new Error("現在耐性を空欄にはできません。");
        }

        battleStore.updateHp(
          instance.instanceId,
          Number(hpInput.value)
        );

        status.textContent =
          "状態を更新しました。3つの計算モジュールは、同じ最新の参戦状態を参照しています。";
      } catch (error) {
        alert(error.message);
      }
    });

    hpCell.append(hpInput, saveButton);

    const operationCell = element("td");
    const removeButton = element("button", "除外", "danger");

    removeButton.type = "button";

    removeButton.addEventListener("click", () => {
      battleStore.removeUnit(instance.instanceId);
      status.textContent = "参戦ユニットを除外しました。図鑑資料は変更されていません。";
    });

    operationCell.append(removeButton);

    row.append(
      nameCell,
      branchCell,
      maxHpCell,
      hpCell,
      operationCell
    );

    body.append(row);
  }

  table.append(head, body);
  wrapper.append(table);
  battleContent.append(wrapper);
}

async function start() {
  try {
    units = await loadUnitData();
    battleStore = createBattleStore(units);

    for (const button of navigationButtons) {
      button.addEventListener("click", () => {
        currentView = button.dataset.view;
        renderView();
      });
    }

    clearButton.addEventListener("click", () => {
      const confirmed = confirm(
  "現在の作戦を初期化しますか？ユニット、編隊、地図表示設定が消去されます。図鑑資料と旧形式のバックアップは削除されません。"
);


      if (confirmed) {
        battleStore.clear();
        status.textContent = "現在のシミュレーションを消去しました。";
      }
    });

    battleStore.subscribe(() => {
      renderView();
      renderBattle();
    });

    renderView();
    renderBattle();

    status.textContent =
      ` 読み込みに成功しました、図鑑には全 ${units.length} 種類のユニットが登録されています。現在は戦闘計算式を実装していない基本版です。`;
  } catch (error) {
    console.error(error);

    status.classList.add("error");
    status.textContent = `起動に失敗しました：${error.message}`;

    viewContent.replaceChildren(
      element(
        "p",
        "ファイルパス、コードに欠落がないか、および GitHub Pages のデプロイが完了しているかを確認してください。"
      )
    );
  }
}

start();
