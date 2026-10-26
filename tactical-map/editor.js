import { getBranchName } from "../js/data-store.js";
import { mountActionPanel } from "./action-panel.js";
import { mountSceneLibrary } from "./scene-library.js";



// ===== 编辑器 DOM 工具 =====
// 所有动态文字都通过 textContent 或表单 value 写入。

function node(tag, text = "", className = "") {
  const result = document.createElement(tag);
  result.textContent = text;
  if (className) result.className = className;
  return result;
}

function button(text, action) {
  const result = node("button", text);
  result.type = "button";
  result.addEventListener("click", action);
  return result;
}

function field(parent, labelText, control) {
  const label = node("label");
  label.append(node("span", labelText), control);
  parent.append(label);
  return control;
}

function select(options, value = "") {
  const result = node("select");

  for (const [id, name] of options) {
    result.append(new Option(name, id));
  }

  result.value = value;
  return result;
}

function input(value, type = "text") {
  const result = node("input");
  result.type = type;

  if (type === "checkbox") {
    result.checked = value === true;
  } else {
    result.value = value ?? "";
  }

  if (type === "number") result.step = "any";
  return result;
}

function numberValue(control, label, nullable = false) {
  if (!control.value.trim()) {
    if (nullable) return null;
    throw new Error(`${label}は空欄にできません。`);
  }

  const value = Number(control.value);

  if (!Number.isFinite(value)) {
    throw new Error(`${label}は有効な数値で指定してください。`);
  }

  return value;
}

export function mountEditor({
  container,
  catalog,
  store,
  spatialState,
  renderMap,
  getView,
  setView
}) {
  let selectedId = "";
  let selectedGroupId = "";
  let lastSavedView = "";

  container.replaceChildren();

  const status = node("p", "", "editor-note editor-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  container.append(node("h2", "作戦編集"), status);

  function message(text, error = false) {
    status.textContent = [
      text,
      store.getStorageWarning()
    ].filter(Boolean).join("\n");

    status.classList.toggle("error", error);
  }

  function safely(action) {
    return (...args) => {
      try {
        action(...args);
      } catch (error) {
        console.error(error);
        message(error.message, true);
      }
    };
  }

    function section(title) {
    const details = node("details", "", "editor-disclosure");

    // 相同 name 的折叠面板组成一组。
    // 支持该属性的浏览器会在展开新面板时关闭旧面板。
    details.setAttribute("name", "ama-editor-sections");

    const summary = node("summary", title, "editor-disclosure-title");
    const body = node("div", "", "editor-disclosure-body");

     details.addEventListener("toggle", () => {
      if (!details.open) return;

      const panel = container.closest("#editor") ?? container;

      for (const other of panel.querySelectorAll(
        "details.editor-disclosure"
      )) {
        if (other !== details) other.open = false;
      }
    });

      
    details.append(summary, body);
    container.append(details);

    // 原有代码继续向 body 中添加表单和按钮。
    return body;
  }

  function openSection(body) {
    const details = body.closest("details.editor-disclosure");
    if (!details) return;

    // 显式关闭其他面板，也兼容不支持 details.name 的浏览器。
    const panel = container.closest("#editor") ?? container;

    for (const other of panel.querySelectorAll(
      "details.editor-disclosure"
    )) {
      if (other !== details) other.open = false;
    }

    details.open = true;
  }


  // ===== 场景操作 =====

  const sceneSection = section("作戦データ");
  const sceneName = field(
    sceneSection,
    "作戦名",
    input(store.getScene().name)
  );

  const sceneActions = node("div", "", "editor-actions");
  const fileInput = input("", "file");
  fileInput.accept = ".json,application/json";
  fileInput.hidden = true;
  fileInput.setAttribute("aria-label", "作戦データのファイル");

  sceneActions.append(
    button("作戦名を保存", safely(() => {
      store.renameScene(sceneName.value);
      message("作戦名を保存しました。");
    })),
    button("表示位置を保存", safely(() => {
      store.updateView(getView());
      message("地図の表示位置を保存しました。");
    })),
    button("JSON 書き出し", safely(() => {
      // 本地保存失败时仍允许导出内存中的有效场景。
      store.updateView(getView());

      const blob = new Blob(
        [store.exportScene()],
        { type: "application/json;charset=utf-8" }
      );

      const url = URL.createObjectURL(blob);
      const link = node("a");
      link.href = url;
      link.download = "作戦データ.json";
      document.body.append(link);
      link.click();
      link.remove();

      setTimeout(() => URL.revokeObjectURL(url), 1000);
      message("作戦データを書き出しました。");
    })),
    button("JSON 読み込み", () => {
      fileInput.value = "";
      fileInput.click();
    }),
    button("作戦を初期化", safely(() => {
      if (!confirm(
        "現在のユニット、編隊、行動記録、表示設定を初期化しますか？必要なデータは先に書き出してください。復元に失敗している場合は、保存領域の元データを先にバックアップしてください。"
      )) return;

      selectedId = "";
      selectedGroupId = "";
      store.clear();
      message("作戦を初期化しました。");
    }))
  );

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;

    try {
      if (file.size > 5_000_000) {
        throw new Error("ファイルが大きすぎます。");
      }

      const text = await file.text();

      if (!confirm(
        "現在の作戦を読み込んだデータで置き換えますか？"
      )) return;

      // 存储层先完整验证，失败时不修改当前场景。
      store.importScene(text);
      message(
        "作戦データを読み込みました。配置条件に合わないユニットは一覧から修正してください。"
      );
    } catch (error) {
      message(error.message, true);
    }
  });

  sceneSection.append(sceneActions, fileInput);

  // ===== 图鉴新增 =====

  const catalogSection = section("図鑑から追加");

  const branchSelect = field(
    catalogSection,
    "軍種",
    select([
      ["navy", "海軍"],
      ["air", "航空機"],
      ["army", "陸軍"]
    ], "navy")
  );

  const catalogSelect = field(
    catalogSection,
    "ユニット資料",
    select([])
  );

  function updateCatalog() {
    catalogSelect.replaceChildren();

    for (const unit of catalog) {
      if (unit.branch === branchSelect.value) {
        catalogSelect.append(new Option(unit.name, unit.id));
      }
    }
  }

  branchSelect.addEventListener("change", updateCatalog);
  updateCatalog();

  catalogSection.append(
    button("参戦ユニットを追加", safely(() => {
      const added = store.addUnit(catalogSelect.value);
      selectedId = added.instanceId;
      refresh();
      openSection(unitSection);
      message("追加しました。座標を入力して配置してください。");
    }))
  );

  // ===== 单位列表与属性 =====

  const listSection = section("参戦ユニット");
  const unitList = node("div", "", "unit-list");
  listSection.append(unitList);

  const unitSection = section("ユニット設定");
  const unitFormHost = node("div");
  unitSection.append(unitFormHost);

  function placement(unit) {
    if (unit.x === null || unit.y === null) {
      return { valid: false, reason: "未配置" };
    }

    return spatialState(unit);
  }

  function groupOptions() {
    return [
      ["", "所属なし"],
      ...store.getGroups().map(group => [group.id, group.name])
    ];
  }

  function renderUnitForm(instances) {
    unitFormHost.replaceChildren();

    const unit = instances.find(
      item => item.instanceId === selectedId
    );

    if (!unit) {
      unitFormHost.append(
        node("p", "一覧または地図からユニットを選択してください。", "editor-note")
      );
      return;
    }

    const form = node("form");
    const base = unit.snapshot;

    form.append(node(
      "p",
      `${base.name} · ${getBranchName(unit.branch)}\n` +
      `識別番号：${unit.instanceId}\n` +
      `基礎最大耐性：${base.maxHp}`,
      "editor-note"
    ));

    const name = field(form, "表示名", input(unit.name));
    const side = field(form, "陣営", select([
      ["ally", "味方"],
      ["enemy", "敵"],
      ["neutral", "中立"]
    ], unit.side));

    const group = field(
      form,
      "所属編隊",
      select(groupOptions(), unit.groupId ?? "")
    );

    const grid = node("div", "", "editor-grid");
    form.append(grid);

    const x = field(grid, "X 座標", input(unit.x, "number"));
    const y = field(grid, "Y 座標", input(unit.y, "number"));

    const heading = field(
      grid,
      "方位（度）",
      input(unit.heading, "number")
    );

    const level = field(grid, "サイズレベル", select(
      [1, 2, 3, 4, 5].map(value => [String(value), String(value)]),
      String(unit.sizeLevel)
    ));

    const hp = field(
      grid,
      "現在耐性",
      input(unit.currentHp, "number")
    );
    hp.min = "0";
    hp.max = String(base.maxHp);

    const labelHeight = field(
      grid,
      "名称表示の高さ",
      input(unit.labelHeight, "number")
    );
    labelHeight.min = "0";
    labelHeight.max = "500";

    const filled = field(
      form,
      "アイコンを塗りつぶす",
      input(unit.filled, "checkbox")
    );

    let underwater;
    let depth;
    let altitude;

    if (unit.branch === "navy") {
      underwater = field(
        form,
        "水中ユニット",
        input(unit.underwater, "checkbox")
      );

      depth = field(
        form,
        "水中深度（地図高度単位）",
        input(unit.depth, "number")
      );
    }

    if (unit.branch === "air" || unit.branch === "special") {
      altitude = field(
        form,
        "海抜高度（地図高度単位）",
        input(unit.altitude, "number")
      );
    }

    const description = node("textarea");
    description.value = unit.description;
    field(form, "説明・備考", description);

    const state = placement(unit);
    form.append(node(
      "p",
      state.valid ? state.note : state.reason,
      "editor-note"
    ));

    form.append(node(
      "p",
      "座標を空欄にすると未配置になります。方位は 0°＝−Y、90°＝＋X です。配置編集では移動ルールを判定しません。",
      "editor-note"
    ));

    const actions = node("div", "", "editor-actions");
    const save = node("button", "設定を保存");
    save.type = "submit";

    actions.append(
      save,
      button("配置を解除", safely(() => {
        store.updateUnit(unit.instanceId, { x: null, y: null });
        message("配置を解除しました。");
      })),
      button("参戦から除外", safely(() => {
        if (!confirm(`${unit.name}を参戦から除外しますか？`)) return;

        selectedId = "";
        store.removeUnit(unit.instanceId);
        message("参戦ユニットを除外しました。");
      }))
    );

    form.append(actions);

    form.addEventListener("submit", event => {
      event.preventDefault();

      safely(() => {
        const patch = {
          name: name.value,
          side: side.value,
          groupId: group.value || null,
          x: numberValue(x, "X 座標", true),
          y: numberValue(y, "Y 座標", true),
          heading: numberValue(heading, "方位"),
          sizeLevel: Number(level.value),
          currentHp: numberValue(hp, "現在耐性"),
          labelHeight: numberValue(labelHeight, "名称表示の高さ"),
          filled: filled.checked,
          description: description.value
        };

        if ((patch.x === null) !== (patch.y === null)) {
          throw new Error("X と Y は両方入力するか、両方空欄にしてください。");
        }

        if (underwater) {
          patch.underwater = underwater.checked;
          patch.depth = numberValue(depth, "水中深度");
        }

        if (altitude) {
          patch.altitude = numberValue(altitude, "海抜高度", true);
        }

        // 已部署单位保存前检查海陆和高度条件。
        if (patch.x !== null) {
          const spatial = spatialState({ ...unit, ...patch });

          if (!spatial.valid) {
            throw new Error(spatial.reason);
          }
        }

        store.updateUnit(unit.instanceId, patch);
        message("ユニット設定を保存しました。");
      })();
    });

    unitFormHost.append(form);
  }

  // ===== 编队编辑 =====

  const groupSection = section("編隊");
  const groupHost = node("div");
  groupSection.append(groupHost);

  function isDescendant(candidateId, ancestorId, groups) {
    const map = new Map(groups.map(group => [group.id, group]));
    let cursor = candidateId;

    while (cursor) {
      if (cursor === ancestorId) return true;
      cursor = map.get(cursor)?.parentId ?? null;
    }

    return false;
  }

  function renderGroups(instances) {
    groupHost.replaceChildren();

    const groups = store.getGroups();
    const chosen = groups.find(group => group.id === selectedGroupId);

    if (!chosen) selectedGroupId = "";

    const groupSelect = field(
      groupHost,
      "編集する編隊",
      select([
        ["", "新しい編隊"],
        ...groups.map(group => [group.id, group.name])
      ], selectedGroupId)
    );

    groupSelect.addEventListener("change", () => {
      selectedGroupId = groupSelect.value;
      renderGroups(store.getAll());
    });

    const form = node("form");
    const name = field(form, "編隊名", input(chosen?.name ?? ""));

    const parents = groups.filter(group =>
      !selectedGroupId ||
      !isDescendant(group.id, selectedGroupId, groups)
    );

    const parent = field(form, "上位編隊", select([
      ["", "上位編隊なし"],
      ...parents.map(group => [group.id, group.name])
    ], chosen?.parentId ?? ""));

    const actions = node("div", "", "editor-actions");
    const save = node("button", chosen ? "編隊を保存" : "編隊を作成");
    save.type = "submit";
    actions.append(save);

    if (chosen) {
      actions.append(button("編隊を解除", safely(() => {
        if (!confirm(
          "この編隊を解除しますか？直属の下位編隊とユニットは上位編隊に移されます。ユニット自体は削除されません。"
        )) return;

        selectedGroupId = "";
        store.removeGroup(chosen.id);
        message("編隊を解除しました。");
      })));
    }

    form.append(actions);

    form.addEventListener("submit", event => {
      event.preventDefault();

      safely(() => {
        if (chosen) {
          store.updateGroup(chosen.id, {
            name: name.value,
            parentId: parent.value || null
          });
        } else {
          const created = store.addGroup(
            name.value,
            parent.value || null
          );

          selectedGroupId = created.id;
          renderGroups(store.getAll());
        }

        message("編隊設定を保存しました。");
      })();
    });

    groupHost.append(form);

    // 以迭代方式构造树，避免深层嵌套导致 JS 递归溢出。
    const root = node("ul", "", "group-tree");
    const tasks = [{ parentId: null, host: root }];

    while (tasks.length) {
      const { parentId, host } = tasks.pop();

      for (const group of groups.filter(
        item => item.parentId === parentId
      )) {
        const li = node("li", group.name);
        const children = node("ul", "", "group-tree");

        for (const unit of instances.filter(
          item => item.groupId === group.id
        )) {
          children.append(node("li", unit.name));
        }

        li.append(children);
        host.append(li);
        tasks.push({ parentId: group.id, host: children });
      }
    }

    groupHost.append(node("p", "編隊構成", "editor-note"), root);
  }
  // 行动草案使用同一个场景存储。
  const actionSection = section("行動と記録");

  const actionPanel = mountActionPanel({
    container: actionSection,
    store,
    spatialState
  });

  // ===== 状态与地图同步 =====

  function refresh() {
    const instances = store.getAll();
    const scene = store.getScene();

    if (!instances.some(item => item.instanceId === selectedId)) {
      selectedId = "";
    }

    const viewText = JSON.stringify(scene.view);

    // 普通单位更新不重置用户尚未保存的平移、缩放。
    if (viewText !== lastSavedView) {
      setView(scene.view);
      lastSavedView = viewText;
    }

    sceneName.value = scene.name;
    unitList.replaceChildren();

    for (const unit of instances) {
      const state = placement(unit);

      const item = button(unit.name, () => {
        selectedId = unit.instanceId;
        refresh();
        openSection(unitSection);
        message("ユニットを選択しました。");
      });

      item.classList.toggle("active", unit.instanceId === selectedId);
      const deployHandle = node(
        "span",
        "↗ ドラッグ配置",
        "unit-deploy-handle"
      );

      deployHandle.dataset.deployInstanceId = unit.instanceId;
      deployHandle.title =
        "地図へドラッグして配置します。ドラッグ中のホイールで方位を変更できます。";

      item.append(deployHandle);


      item.append(node(
        "small",
        `${getBranchName(unit.branch)} · 耐性 ${unit.currentHp}` +
        ` · ${state.valid ? "配置済み" : state.reason}`
      ));

      unitList.append(item);
    }

    if (!instances.length) {
      unitList.append(node(
        "p",
        "参戦ユニットはありません。",
        "editor-note"
      ));
    }

    renderUnitForm(instances);
    renderGroups(instances);
    actionPanel.refresh();
    renderMap(instances, selectedId);
  }

  const unsubscribe = store.subscribe(() => {
    refresh();
    message(
      "作戦状態が更新されました。編集中の未保存入力は再表示されています。"
    );
  });

  refresh();
  message(
    "図鑑から追加し、座標を入力して配置してください。変更はこのブラウザー内に自動保存されます。"
  );

  return {
    select(instanceId) {
      selectedId = instanceId;
      refresh();
      openSection(unitSection);
      message("地図からユニットを選択しました。");
    },

    destroy() {
      unsubscribe();
      container.replaceChildren();
    }
  };
}
