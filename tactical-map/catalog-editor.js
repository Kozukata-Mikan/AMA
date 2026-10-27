import { getCatalogStore } from "../js/catalog-store.js";

import {
  UNIT_FIELDS,
  EQUIPMENT_FIELDS,
  EXTRA_DEFINITIONS,
  getEquipmentLabel,
  getProjectionLabel
} from "../js/catalog-seed.js";

// ===== 图鉴界面 =====

function node(tag, text = "", className = "") {
  const element = document.createElement(tag);
  element.textContent = text;

  if (className) element.className = className;

  return element;
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function button(text, action) {
  const element = node("button", text);
  element.type = "button";
  element.addEventListener("click", action);
  return element;
}

function select(options, value = "") {
  const element = node("select");

  for (const [id, label] of options) {
    element.append(new Option(label, id));
  }

  element.value = String(value ?? "");
  return element;
}

function input(value = "", type = "text") {
  const element = node("input");
  element.type = type;
  element.value = value ?? "";

  if (type === "number") element.step = "any";

  return element;
}

function getPath(value, path) {
  return path.split(".").reduce(
    (current, key) => current?.[key],
    value
  );
}

function setPath(value, path, next) {
  const keys = path.split(".");
  let cursor = value;

  for (const key of keys.slice(0, -1)) {
    cursor[key] ??= {};
    cursor = cursor[key];
  }

  cursor[keys.at(-1)] = next;
}

function readNumber(control, label, optional = false) {
  if (!control.value.trim()) {
    if (optional) return null;

    throw new Error(`${label}は空欄にできません。`);
  }

  const result = Number(control.value);

  if (!Number.isFinite(result)) {
    throw new Error(`${label}は有効な数値で指定してください。`);
  }

  return result;
}

function branchName(value) {
  return {
    navy: "海軍",
    air: "航空機",
    army: "陸軍",
    special: "特殊"
  }[value] ?? value;
}

function displayValue(value) {
  return value === null ||
    value === undefined ||
    value === ""
    ? "未設定"
    : String(value);
}

function newId(prefix) {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error(
      "ID を生成できません。HTTPS または localhost で開いてください。"
    );
  }

  return `${prefix}-${crypto.randomUUID()}`;
}

function download(text, name) {
  const blob = new Blob(
    [text],
    { type: "application/json;charset=utf-8" }
  );

  const url = URL.createObjectURL(blob);
  const link = node("a");

  link.href = url;
  link.download = name;

  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function table(headers, rows) {
  const wrapper = node("div", "", "catalog-table-wrap");
  const element = node("table", "", "catalog-table");
  const head = node("thead");
  const headRow = node("tr");

  for (const header of headers) {
    headRow.append(node("th", header));
  }

  head.append(headRow);

  const body = node("tbody");

  for (const row of rows) {
    const tr = node("tr");

    for (const value of row) {
      const td = node("td");

      if (value instanceof Node) {
        td.append(value);
      } else {
        td.textContent = displayValue(value);
      }

      tr.append(td);
    }

    body.append(tr);
  }

  element.append(head, body);
  wrapper.append(element);

  return wrapper;
}

function labeled(parent, labelText, control, definition = "") {
  const label = node("label", "", "catalog-field");

  label.append(node("span", labelText), control);

  if (definition) {
    label.append(node("small", definition));
  }

  parent.append(label);

  return control;
}

function ensureStyles() {
  if (document.querySelector("#catalog-styles")) return;

  const link = node("link");
  link.id = "catalog-styles";
  link.rel = "stylesheet";
  link.href = new URL("./catalog.css", import.meta.url).href;

  document.head.append(link);
}

export function mountCatalogEditor({
  container,
  onChanged = () => {}
}) {
  ensureStyles();

  const store = getCatalogStore();

  let category = "units";
  let selectedId = "navy-yamato-class-1941";
  let editing = false;

  const openButton = button("図鑑を開く / 編集", () => {
    renderList();
    renderDetail();
    dialog.showModal();
    search.focus();
  });

  container.append(node(
    "p",
    "艦船・装備の資料を閲覧、追加、編集します。" +
    "変更後の資料は新しく追加する参戦ユニットに適用されます。",
    "editor-note"
  ), openButton);

  const dialog = node("dialog", "", "catalog-dialog");
  dialog.setAttribute("aria-labelledby", "catalog-title");

  const shell = node("div", "", "catalog-shell");
  const header = node("header", "", "catalog-header");

  const heading = node("h2", "図鑑 / 資料編集");
  heading.id = "catalog-title";

  function confirmDiscard() {
    return !editing || confirm(
      "編集中の未保存入力を破棄しますか？"
    );
  }

  header.append(
    heading,
    button("閉じる", () => {
      if (!confirmDiscard()) return;
      editing = false;
      dialog.close();
    })
  );

  dialog.addEventListener("cancel", event => {
    if (!confirmDiscard()) {
      event.preventDefault();
    } else {
      editing = false;
    }
  });

  const toolbar = node("div", "", "catalog-toolbar");

  const categorySelect = select([
    ["units", "ユニット"],
    ["equipment", "装備"]
  ], category);

  const search = input();
  search.placeholder = "名称で検索";
  search.setAttribute("aria-label", "図鑑を検索");

  const fileInput = input("", "file");
  fileInput.accept = ".json,application/json";
  fileInput.hidden = true;

  const status = node("p", "", "catalog-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const body = node("div", "", "catalog-body");
  const list = node("nav", "", "catalog-list");
  list.setAttribute("aria-label", "図鑑資料一覧");

  const detail = node("section", "", "catalog-detail");

  body.append(list, detail);

  function message(text, error = false) {
    status.textContent = text;
    status.classList.toggle("error", error);
  }

  function safely(action) {
    return () => {
      try {
        action();
      } catch (error) {
        console.error(error);
        message(error.message, true);
      }
    };
  }

  function blankUnit() {
    return {
      id: newId("unit"),
      name: "",
      branch: "navy",
      maxHp: 1,
      sizeLevel: 1,
      description: "",
      naval: {
        type: "",
        strength: null,
        detection: "",
        seaRecon: "",
        airRecon: "",
        armor: "",
        speedKnots: null,
        endurance: ""
      },
      hullNames: [],
      mounts: [],
      embarked: []
    };
  }

  function blankEquipment() {
    return {
      id: newId("eq"),
      name: "",
      kind: "weapon",
      barrelCount: null,
      projectionCoefficient: null,
      projectionSuffix: "R",
      note: "",
      slot: "",
      powerRule: "",
      penetration: "",
      ceilingU: null,
      range: null,
      maxOrder: "",
      guidance: "",
      targetScope: ""
    };
  }

  toolbar.append(
    categorySelect,
    search,

    button("新規追加", safely(() => {
      if (!confirmDiscard()) return;

      renderForm(
        category === "units"
          ? blankUnit()
          : blankEquipment()
      );
    })),

    button("JSON 書き出し", safely(() => {
      download(store.exportJSON(), "図鑑データ.json");
      message("現在の図鑑データを書き出しました。");
    })),

    button("JSON 読み込み", () => {
      fileInput.value = "";
      fileInput.click();
    }),

    button("保存原文を書き出し", safely(() => {
      download(store.exportSavedRaw(), "図鑑保存原文.json");
      message("ブラウザー内の保存原文を書き出しました。");
    }))
  );

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;

    try {
      if (file.size > 10_000_000) {
        throw new Error("ファイルは 10 MB 以内にしてください。");
      }

      const text = await file.text();

      if (!confirm(
        "現在の図鑑全体を読み込んだ資料で置き換えますか？" +
        "未保存の編集も破棄されます。"
      )) return;

      store.importJSON(text);

      editing = false;
      selectedId = "";

      renderList();
      renderDetail();

      message("図鑑を読み込みました。");
    } catch (error) {
      message(error.message, true);
    }
  });

  categorySelect.addEventListener("change", () => {
    if (!confirmDiscard()) {
      categorySelect.value = category;
      return;
    }

    category = categorySelect.value;
    selectedId = "";
    editing = false;

    renderList();
    renderDetail();
  });

  search.addEventListener("input", renderList);

  function renderList() {
    list.replaceChildren();

    const data = store.getData();
    const term = search.value.trim().toLowerCase();

    const items = data[category].filter(item =>
      item.name.toLowerCase().includes(term)
    );

    for (const item of items) {
      const text = category === "units"
        ? `${item.name} · ${branchName(item.branch)}`
        : getEquipmentLabel(item);

      const entry = button(text, () => {
        if (!confirmDiscard()) return;

        selectedId = item.id;
        editing = false;

        renderList();
        renderDetail();
      });

      entry.classList.toggle(
        "active",
        item.id === selectedId
      );

      list.append(entry);
    }

    if (!items.length) {
      list.append(node("p", "該当する資料はありません。"));
    }
  }

  function showDefinitions(fields) {
    const definitions = node("details", "", "catalog-definitions");

    definitions.append(node("summary", "項目の定義"));

    const rows = fields.map(field => [
      field.label,
      field.definition
    ]);

    if (category === "units") {
      rows.push(...EXTRA_DEFINITIONS);
    }

    definitions.append(table(
      ["項目", "定義 / 現在の用途"],
      rows
    ));

    return definitions;
  }

  function renderDetail() {
    detail.replaceChildren();

    const data = store.getData();

    const item = data[category].find(
      value => value.id === selectedId
    );

    if (!item) {
      detail.append(node(
        "p",
        "一覧から資料を選択するか、新規追加してください。"
      ));

      return;
    }

    const title = category === "units"
      ? item.name
      : getEquipmentLabel(item);

    detail.append(
      node("h3", title),
      node("p", `ID：${item.id}`, "catalog-muted"),
      node(
        "p",
        "資料編集段階です。戦闘計算・等級換算はまだ実行しません。",
        "catalog-notice"
      )
    );

    const actions = node("div", "", "catalog-actions");

    actions.append(
      button("編集", () => renderForm(copy(item))),

      button("複製して編集", safely(() => {
        const draft = copy(item);

        draft.id = newId(
          category === "units" ? "unit" : "eq"
        );

        draft.name += "（複製）";

        renderForm(draft);
      })),

      button("削除", safely(() => {
        if (!confirm(
          `「${item.name}」を図鑑から削除しますか？` +
          "既存の参戦個体とそのスナップショットは削除されません。"
        )) return;

        if (category === "units") {
          store.deleteUnit(item.id);
        } else {
          store.deleteEquipment(item.id);
        }

        selectedId = "";
        editing = false;

        renderList();
        renderDetail();

        message("資料を削除しました。");
      }))
    );

    detail.append(actions);

    const fields = category === "units"
      ? UNIT_FIELDS
      : EQUIPMENT_FIELDS;

    detail.append(table(
      ["項目", "値"],
      fields.map(field => {
        const value = getPath(item, field.key);

        return [
          field.label,
          field.key === "branch"
            ? branchName(value)
            : value
        ];
      })
    ));

    if (category === "equipment") {
      detail.append(node(
        "p",
        `投射率：${getProjectionLabel(item)}`,
        "catalog-notice"
      ));

      const users = data.units.filter(unit =>
        unit.mounts.some(mount =>
          mount.equipmentId === item.id
        )
      );

      detail.append(node("h4", "使用ユニット"));

      for (const unit of users) {
        detail.append(button(unit.name, () => {
          category = "units";
          categorySelect.value = category;
          selectedId = unit.id;
          search.value = "";

          renderList();
          renderDetail();
        }));
      }

      if (!users.length) {
        detail.append(node("p", "未使用"));
      }
    } else {
      detail.append(
        node("h4", "艦名"),
        node(
          "p",
          item.hullNames.join(" / ") || "未登録"
        ),
        node("h4", "装備配置")
      );

      const equipmentMap = new Map(
        data.equipment.map(value => [value.id, value])
      );

      const rows = item.mounts.map(mount => {
        const equipment = equipmentMap.get(mount.equipmentId);

        const link = button(
          getEquipmentLabel(equipment),
          () => {
            category = "equipment";
            categorySelect.value = category;
            selectedId = equipment.id;
            search.value = "";

            renderList();
            renderDetail();
          }
        );

        const quantity = mount.count === null
          ? "組数未設定"
          : `${mount.count} 組` + (
            equipment.barrelCount === null
              ? ""
              : ` · ${mount.count * equipment.barrelCount} 管`
          );

        return [mount.position, link, quantity];
      });

      if (rows.length) {
        detail.append(table(
          ["位置", "装備", "数量"],
          rows
        ));
      } else {
        detail.append(node("p", "装備未登録"));
      }

      detail.append(node("h4", "搭載機"));

      if (item.embarked.length) {
        detail.append(table(
          ["航空機", "機数"],
          item.embarked.map(aircraft => [
            aircraft.name,
            aircraft.count
          ])
        ));
      } else {
        detail.append(node("p", "搭載機未登録"));
      }

      if (item.description) {
        detail.append(
          node("h4", "説明"),
          node("p", item.description, "catalog-description")
        );
      }
    }

    detail.append(showDefinitions(fields));
  }

  function renderForm(source) {
    editing = true;
    detail.replaceChildren();

    const draft = copy(source);

    detail.append(
      node("h3", "資料を編集"),
      node("p", `ID：${draft.id}`, "catalog-muted")
    );

    const form = node("form");
    const grid = node("div", "", "catalog-form-grid");

    const fields = category === "units"
      ? UNIT_FIELDS
      : EQUIPMENT_FIELDS;

    const controls = new Map();

    for (const field of fields) {
      const value = getPath(draft, field.key);
      let control;

      if (field.type === "branch") {
        control = select([
          ["navy", "海軍"],
          ["air", "航空機"],
          ["army", "陸軍"],
          ["special", "特殊"]
        ], value);
      } else if (field.type === "size") {
        control = select(
          [1, 2, 3, 4, 5].map(size => [
            String(size),
            String(size)
          ]),
          value ?? 1
        );
      } else if (field.type === "equipment-kind") {
        control = select([
          ["weapon", "武器"],
          ["support", "支援装備"]
        ], value);
      } else {
        control = input(
          value,
          field.type.includes("number")
            ? "number"
            : "text"
        );
      }

      controls.set(field.key, control);

      labeled(
        grid,
        field.label,
        control,
        field.definition
      );
    }

    form.append(grid);

    let hullNames;
    let description;

    const mountReaders = [];
    const embarkedReaders = [];

    if (category === "equipment") {
      const preview = node("p", "", "catalog-notice");

      function updatePreview() {
        const barrelText = controls.get("barrelCount").value;
        const coefficientText = controls.get(
          "projectionCoefficient"
        ).value;

        const item = {
          name: controls.get("name").value || "装備名",
          barrelCount: barrelText.trim()
            ? Number(barrelText)
            : null,
          projectionCoefficient: coefficientText.trim()
            ? Number(coefficientText)
            : null,
          projectionSuffix: controls.get(
            "projectionSuffix"
          ).value
        };

        preview.textContent =
          `${getEquipmentLabel(item)} / ` +
          `投射率：${getProjectionLabel(item)}`;
      }

      for (const key of [
        "name",
        "barrelCount",
        "projectionCoefficient",
        "projectionSuffix"
      ]) {
        controls.get(key).addEventListener(
          "input",
          updatePreview
        );
      }

      updatePreview();
      form.append(preview);
    } else {
      hullNames = node("textarea");
      hullNames.value = (draft.hullNames ?? []).join("\n");

      labeled(
        form,
        "艦名 / 名称候補（1 行 1 件）",
        hullNames,
        EXTRA_DEFINITIONS[0][1]
      );

      description = node("textarea");
      description.value = draft.description ?? "";

      labeled(form, "説明・備考", description);

      // ----- 装备配置编辑 -----

      form.append(node("h4", "装備配置"));

      const mountHost = node("div", "", "catalog-repeat-list");
      const equipment = store.getData().equipment;

      function addMount(value = {
        position: "",
        equipmentId: equipment[0]?.id ?? "",
        count: 1
      }) {
        const row = node("div", "", "catalog-repeat-row");

        const position = labeled(
          row,
          "位置",
          input(value.position)
        );

        const equipmentSelect = labeled(
          row,
          "装備",
          select(
            equipment.map(item => [
              item.id,
              getEquipmentLabel(item)
            ]),
            value.equipmentId
          )
        );

        const count = labeled(
          row,
          "組数（不明なら空欄）",
          input(value.count, "number")
        );

        count.min = "1";
        count.step = "1";

        const preview = node("p", "", "catalog-muted");

        function updatePreview() {
          const item = equipment.find(
            candidate => candidate.id === equipmentSelect.value
          );

          const quantity = Number(count.value);

          preview.textContent =
            item &&
            count.value.trim() &&
            Number.isInteger(quantity) &&
            quantity > 0 &&
            item.barrelCount !== null
              ? `総砲身数：${quantity * item.barrelCount} 管`
              : "総砲身数：未設定 / 対象外";
        }

        count.addEventListener("input", updatePreview);

        equipmentSelect.addEventListener(
          "change",
          updatePreview
        );

        updatePreview();

        const reader = {
          active: true,

          read() {
            return {
              position: position.value,
              equipmentId: equipmentSelect.value,
              count: readNumber(count, "装備組数", true)
            };
          }
        };

        mountReaders.push(reader);

        row.append(
          preview,
          button("この配置を削除", () => {
            reader.active = false;
            row.remove();
          })
        );

        mountHost.append(row);
      }

      for (const mount of draft.mounts ?? []) {
        addMount(mount);
      }

      form.append(
        mountHost,
        button("装備配置を追加", () => {
          if (!equipment.length) {
            message(
              "先に装備図鑑で装備を登録してください。",
              true
            );
            return;
          }

          addMount();
        })
      );

      // ----- 舰载机编辑 -----

      form.append(node("h4", "搭載機"));

      const embarkedHost = node(
        "div",
        "",
        "catalog-repeat-list"
      );

      function addEmbarked(value = { name: "", count: 1 }) {
        const row = node("div", "", "catalog-repeat-row");

        const name = labeled(
          row,
          "航空機名",
          input(value.name)
        );

        const count = labeled(
          row,
          "機数",
          input(value.count, "number")
        );

        count.min = "1";
        count.step = "1";

        const reader = {
          active: true,

          read() {
            return {
              name: name.value,
              count: readNumber(count, "搭載機数")
            };
          }
        };

        embarkedReaders.push(reader);

        row.append(button("この搭載機を削除", () => {
          reader.active = false;
          row.remove();
        }));

        embarkedHost.append(row);
      }

      for (const aircraft of draft.embarked ?? []) {
        addEmbarked(aircraft);
      }

      form.append(
        embarkedHost,
        button("搭載機を追加", () => addEmbarked()),
        node(
          "p",
          "搭載機は名称と機数の登録です。" +
          "今回の図鑑編集では航空機個体を自動生成しません。",
          "catalog-muted"
        )
      );
    }

    const actions = node("div", "", "catalog-actions");
    const save = node("button", "図鑑に保存");
    save.type = "submit";

    actions.append(
      save,
      button("キャンセル", () => {
        if (!confirmDiscard()) return;

        editing = false;
        renderDetail();
      })
    );

    form.append(actions);

    form.addEventListener("submit", event => {
      event.preventDefault();

      safely(() => {
        const next = copy(draft);

        for (const field of fields) {
          const control = controls.get(field.key);

          let value = control.value;

          if (
            field.type === "number" ||
            field.type === "optional-number"
          ) {
            value = readNumber(
              control,
              field.label,
              field.type === "optional-number"
            );
          } else if (field.type === "size") {
            value = Number(value);
          }

          setPath(next, field.key, value);
        }

        if (category === "units") {
          next.hullNames = hullNames.value
            .split(/\r?\n/)
            .map(value => value.trim())
            .filter(Boolean);

          next.description = description.value;

          next.mounts = mountReaders
            .filter(reader => reader.active)
            .map(reader => reader.read());

          next.embarked = embarkedReaders
            .filter(reader => reader.active)
            .map(reader => reader.read());

          store.saveUnit(next);
        } else {
          store.saveEquipment(next);
        }

        selectedId = next.id;
        editing = false;

        renderList();
        renderDetail();

        message(
          "図鑑を保存しました。" +
          "既存の参戦個体の生命・装備スナップショットは変更していません。"
        );
      })();
    });

    detail.append(form);
  }

  shell.append(header, toolbar, status, body, fileInput);
  dialog.append(shell);
  document.body.append(dialog);

  const unsubscribe = store.subscribe(() => {
    onChanged();

    if (!editing) {
      renderList();
      renderDetail();
    }
  });

  renderList();
  renderDetail();

  if (store.getRecoveryError()) {
    message(store.getRecoveryError(), true);
  } else {
    message(
      "耐性は生命値です。投射率の第 2 数は砲身数から生成します。"
    );
  }

  return {
    destroy() {
      unsubscribe();
      dialog.remove();
      openButton.remove();
    }
  };
}
