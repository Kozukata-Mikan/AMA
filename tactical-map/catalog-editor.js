import {AIRCRAFT_TYPES,AIRCRAFT_WEAPON_ROLES,normalizeAircraft,aircraftMounts} from '../js/aircraft-template.js?v=aircraft-template-1';
import {mountAircraftDerivedFields,mountAircraftLoadoutEditor,appendAircraftSummary} from './aircraft-catalog-ui.js?v=aircraft-template-1';
import { SUPPORT_EFFECTS } from "./support-equipment.js?v=support-stations-1";
import { BUILDING_KINDS, FACILITY_DURABILITY, AIRPORT_TYPES, PORT_TYPES, normalizeBuilding, drawBuildingIcon, transformBuildingPath } from "./building-runtime.js?v=support-stations-1";
import { GUIDANCE_OPTIONS, getGuidanceLabel } from "./weapon-profile-runtime.js?v=aircraft-template-1";
import { NAVAL_KINDS } from "./naval-kind.js?v=catalog-layout-2";
import { NAVAL_SYMBOL_OPTIONS, navalSymbolPath } from "../js/naval-symbols.js?v=naval-formation-2";
import { getCatalogStore } from "../js/catalog-store.js?v=aircraft-template-1";
import {FACTION_OPTIONS,getFactionName} from "../js/faction-data.js";

import {
  getUnitFields,
  EQUIPMENT_FIELDS,
  EXTRA_DEFINITIONS,
  TRAINING_TRAIT_OPTIONS,
  getTrainingTraitLabel,
  getEquipmentLabel,
  getProjectionLabel
} from "../js/catalog-seed.js?v=aircraft-template-1";

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
    special: "特殊",
  building: "建築"
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

function catalogFieldSections(fields, category) {
  const sections = category === "units" ? [
    ["basic", "基本情報", ["name","branch","naval.kind","faction","naval.type","naval.iconType","aircraft.type","protected"]],
    ["hull", "船体・防御", ["sizeLevel","maxHp","aircraft.engines","aircraft.crew","naval.strength","naval.armor"]],
    ["recon", "偵察・探測", ["naval.detection","naval.seaRecon","naval.airRecon","naval.aswRecon"]],
    ["mobility", "航速・航続", ["naval.speedKnots","naval.submergedSpeedKnots","naval.endurance","aircraft.ceiling","aircraft.maneuverability","aircraft.remoteRange"]],
    ["facility", "施設設定", ["building.kind","building.permanence","building.airportType","building.runways","building.portType"]],
    ["traits", "練度・特殊能力", ["trainingTraits","aircraft.training"]]
  ] : [
    ["basic", "基本情報", ["name","kind","faction","slot","supportEffect","runwayControlLimit"]],
    ["weapon", "射撃・誘導", ["guidance","range","ceilingU","maxOrder","targetScope"]],
    ["power", "威力・投射・弾薬", ["powerRule","penetration","barrelCount","projectionCoefficient","projectionSuffix","ammo"]],
    ["notes", "補足", ["note"]]
  ];
  const result=sections.map(([id,title,keys])=>({id,title: fields.some(f=>f.key==="aircraft.type")&&id==="hull"?"機体・乗員・防御":fields.some(f=>f.key==="aircraft.type")&&id==="mobility"?"飛行性能・航続":id==="hull" && fields.some(field=>field.key==="building.kind") ? "構造・防御" : title,fields:keys.map(key=>fields.find(field=>field.key===key)).filter(Boolean)})).filter(section=>section.fields.length);
  const assigned=new Set(result.flatMap(section=>section.fields.map(field=>field.key)));
  const remaining=fields.filter(field=>!assigned.has(field.key));
  if(remaining.length)result.push({id:"other",title:"その他",fields:remaining});
  return result;
}

function ensureStyles() {
  if (document.querySelector("#catalog-styles")) return;

  const link = node("link");
  link.id = "catalog-styles";
  link.rel = "stylesheet";
  link.href = new URL("./catalog.css?v=aircraft-template-1", import.meta.url).href;

  document.head.append(link);
}

export function mountCatalogEditor({
  container,
  battleStore,
  onAdded = () => {},
  onChanged = () => {}
}) {

  ensureStyles();

  const store = getCatalogStore();

  let category = "units";
  let branchFilter = "navy";
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
    ["navy", "海軍"],
    ["army", "陸軍"],
    ["air", "航空機"],
    ["special", "特殊"],
    ["building", "建築"],
    ["equipment", "装備"]
  ], "navy");

  const factionFilter = select(FACTION_OPTIONS);
  factionFilter.options[0].textContent = "すべての色陣営";
  factionFilter.setAttribute("aria-label", "色陣営で絞り込み");


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

    function requestEditingAuthorization() {
    if (store.isEditingAuthorized()) return true;

    const password = window.prompt(
      "保護資料の編集パスワードを入力してください。"
    );

    if (password === null) return false;

    try {
      store.authorizeEditing(password);

      message(
        "保護資料の編集を許可しました。" +
        "ページ更新または「編集を再ロック」で解除されます。"
      );

      return true;
    } catch (error) {
      message(error.message, true);
      return false;
    }
  }

  function withProtectionAuthorization(action) {
    try {
      return action();
    } catch (error) {
      if (error.code !== "CATALOG_LOCKED") {
        throw error;
      }

      if (!requestEditingAuthorization()) return false;

      return action();
    }
  }

  
  function safely(action) {
    return async () => {
      try {
        await action();
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
      branch: branchFilter || "navy",
      faction: "",
      maxHp: 1,
      sizeLevel: 1,
      trainingTraits: [],
      description: "",
      protected: false,
      ...(branchFilter === "building" ? {building:normalizeBuilding()} : branchFilter === "air" ? {aircraft:normalizeAircraft()} : {}),
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
      ammo: null,
      note: "",
      slot: "",
      powerRule: "",
      penetration: "",
      ceilingU: null,
      range: null,
      maxOrder: "",
      guidance: "",
      faction: "",
      targetScope: ""
      
    };
  }

  toolbar.append(
    categorySelect,
    factionFilter,
    search,

    button("編集を再ロック", () => {
      store.lockEditing();

      message(
        "保護資料の編集をロックしました。" +
        "次の変更時にパスワードが必要です。"
      );
    }),

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

      const imported = withProtectionAuthorization(() => {
        store.importJSON(text);
        return true;
      });

      if (!imported) return;

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
      categorySelect.value = category === "equipment"
        ? "equipment"
        : branchFilter;

      return;
    }

    const value = categorySelect.value;

    category = value === "equipment" ? "equipment" : "units";
    branchFilter = value === "equipment" ? "" : value;

    selectedId = "";
    editing = false;

    renderList();
    renderDetail();
  });

  factionFilter.addEventListener("change", renderList);
  search.addEventListener("input", renderList);

  function renderList() {
    list.replaceChildren();

    const data = store.getData();
    const term = search.value.trim().toLowerCase();

    const items = data[category].filter(item =>
      item.name.toLowerCase().includes(term) &&
      (
        category === "equipment" ||
        item.branch === branchFilter
      ) &&
      (
        !factionFilter.value ||
        item.faction === factionFilter.value
      )
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

        // 允许访客创建自己的副本，不改变受保护的原条目。
        if (category === "units") {
          draft.protected = false;
        }
        renderForm(draft);
      })),

      button("削除", safely(() => {
        if (!confirm(
          `「${item.name}」を図鑑から削除しますか？` +
          "既存の参戦個体とそのスナップショットは削除されません。"
        )) return;

        if (category === "units") {
          const deleted = withProtectionAuthorization(() => {
            store.deleteUnit(item.id);
            return true;
          });

          if (!deleted) return;

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

        if (category === "units" && battleStore) {
      const deploy = node("div", "", "catalog-notice");
      deploy.append(node("h4", "地図へ追加"));

      const nameOptions = [
        ...new Set([
          ...(item.hullNames ?? []),
          item.name
        ])
      ].map(name => [name, name]);

      const selectedName = labeled(
        deploy,
        "地図上の名称",
        select(nameOptions, nameOptions[0][0])
      );

      const selectedFaction = labeled(
        deploy,
        "色陣営",
        select(FACTION_OPTIONS, item.faction ?? "")
      );

      const selectedSide = labeled(
        deploy,
        "今回の作戦関係",
        select([
          ["ally", "味方"],
          ["enemy", "敵"],
          ["neutral", "中立"]
        ], "ally")
      );

      deploy.append(
        node(
          "p",
          `体型 ${item.sizeLevel} / 最大生命 ${item.maxHp}`,
          "catalog-muted"
        ),

        button("追加してドラッグ配置へ", safely(async () => {
          const added = await battleStore.addUnit(item.id, {
            name: selectedName.value,
            faction: selectedFaction.value,
            side: selectedSide.value
          });

          editing = false;
          dialog.close();

          onAdded(added);
        }))
      );

      detail.append(deploy);
    }


    const fields = category === "units"
      ? getUnitFields(item)
      : EQUIPMENT_FIELDS;

    for (const section of catalogFieldSections(fields, category)) {
    detail.append(node("h4", section.title), table(
      ["項目", "値"],
      section.fields.filter(field=>item.branch!=="building" || !field.key.startsWith("building.") || field.key==="building.kind" || field.key==="building.permanence" || (item.building.kind==="port"?field.key==="building.portType":field.key!=="building.portType"&&(field.key!=="building.runways"||item.building.airportType==="runway"))).map(field => {
        const value = getPath(item, field.key);

        return [
          field.label,
          field.key === "branch"
            ? branchName(value)
            : field.type === "aircraft-type" ? AIRCRAFT_TYPES.find(([id])=>id===value)?.[1]
            : field.type === "support-effect" ? SUPPORT_EFFECTS.find(([id])=>id===(value??""))?.[1]
            : ["building-kind","airport-durability","airport-type","port-type"].includes(field.type)
            ? ({"building-kind":BUILDING_KINDS,"airport-durability":FACILITY_DURABILITY,"airport-type":AIRPORT_TYPES,"port-type":PORT_TYPES}[field.type].find(([id])=>id===value)?.[1] ?? value)
            : field.type === "guidance"
            ? getGuidanceLabel(value)
            : field.type === "naval-kind"
            ? NAVAL_KINDS.find(([key])=>key===(value ?? "surface"))?.[1]
            : field.type === "naval-symbol"
            ? NAVAL_SYMBOL_OPTIONS.find(([key]) => key === (value ?? "combat"))?.[1]
            : field.key === "faction"
            ? getFactionName(value)
            : field.key === "protected"
            ? (value ? "保護あり 🔒" : "保護なし")
            : field.type === "training-traits"
            ? (
                Array.isArray(value) && value.length
                  ? value.map(getTrainingTraitLabel).join(" / ")
                  : "なし"
              )
            : value



        ];
      })
    ));

    }

    if(category==='units' && item.branch==='air')appendAircraftSummary(detail,item,store.getData().equipment);
    if (category === "equipment") {
      detail.append(node(
        "p",
        `投射率：${getProjectionLabel(item)}`,
        "catalog-notice"
      ));

      const users = data.units.filter(unit =>
        aircraftMounts(unit).some(mount =>
          mount.equipmentId === item.id
        )
      );

      detail.append(node("h4", "使用ユニット"));

      for (const unit of users) {
        detail.append(button(unit.name, () => {
          category = "units";
          branchFilter = unit.branch;
          categorySelect.value = unit.branch;
          factionFilter.value = "";
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
        node("h4", item.branch === "building" ? "施設名" : "艦名"),
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
            factionFilter.value = "";
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

      if (!["building","air"].includes(item.branch)) {
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
    if (
      category === "units" &&
      source.protected &&
      !requestEditingAuthorization()
    ) {
      return;
    }

    editing = true;

    detail.replaceChildren();

    const draft = copy(source);
    if(draft.branch==="building")draft.building=normalizeBuilding(draft.building);
    if(draft.branch==="air")draft.aircraft=normalizeAircraft(draft.aircraft);

    detail.append(
      node("h3", "資料を編集"),
      node("p", `ID：${draft.id}`, "catalog-muted")
    );

    const form = node("form", "", "catalog-edit-form");
    const grid = node("div", "", "catalog-form-grid");

    const fields = category === "units"
      ? getUnitFields(draft)
      : EQUIPMENT_FIELDS;

    const controls = new Map();
    const sectionHosts = new Map();
    for (const section of catalogFieldSections(fields, category)) {
      if (section.id === "traits" && section.fields.every(f=>f.type==='training-traits')) continue;
      const group=node("fieldset", "", `catalog-section catalog-section-${section.id}`);
      group.append(node("legend", section.title));
      const host=node("div", "", "catalog-section-grid");
      group.append(host);grid.append(group);
      for (const field of section.fields) sectionHosts.set(field.key,host);
    }

    for (const field of fields) {
      const value = getPath(draft, field.key);
      let control;

           if (field.type === "training-traits") {
        const group = node("fieldset", "", "catalog-section catalog-traits");
        group.append(node("legend", field.label));
        group.append(node("small", field.definition));

        const selected = new Set(
          Array.isArray(value) ? value : []
        );

        const checkboxes = [];

        for (const trait of TRAINING_TRAIT_OPTIONS) {
          const checkbox = input("", "checkbox");
          checkbox.checked = selected.has(trait.id);
          checkbox.style.width = "auto";

          labeled(
            group,
            trait.label,
            checkbox,
            trait.definition
          );

          checkboxes.push({
            id: trait.id,
            checkbox
          });
        }

        controls.set(field.key, {
          read() {
            return checkboxes
              .filter(item => item.checkbox.checked)
              .map(item => item.id);
          }
        });

        grid.append(group);
        continue;
      }

      
     if (field.type === "checkbox") {
        control = input("", "checkbox");
        control.checked = value === true;
      } else if (field.type === "faction") {

        control = select(FACTION_OPTIONS, value ?? "");
      } else if (field.type === "branch") {
        control = select([
          ["navy", "海軍"],
          ["air", "航空機"],
          ["army", "陸軍"],
          ["special", "特殊"],
          ["building", "建築"]
        ], value);
      } else if (field.type === "aircraft-type") {control=select(AIRCRAFT_TYPES,value);
      } else if (field.type === "support-effect") {control=select(SUPPORT_EFFECTS,value ?? "");
      } else if (field.type === "building-size") {
        control=select([["1","1"]],1);control.disabled=true;
      } else if (field.type === "building-kind") {control=select(BUILDING_KINDS,value);
      } else if (field.type === "airport-durability") {control=select(FACILITY_DURABILITY,value);
      } else if (field.type === "airport-type") {control=select(AIRPORT_TYPES,value);
      } else if (field.type === "port-type") {control=select(PORT_TYPES,value);
      } else if (field.type === "runway-count") {control=select([["1","1"],["2","2"],["3","3"]],value);
      } else if (field.type === "guidance") {
        const values=GUIDANCE_OPTIONS.includes(value) || !value ? GUIDANCE_OPTIONS : [value,...GUIDANCE_OPTIONS];
        control=select([["","誘導方式を選択してください"],...values.map(id=>[id,getGuidanceLabel(id)])],value ?? "");
      } else if (field.type === "naval-kind") {
        control = select(NAVAL_KINDS, value ?? "surface");
      } else if (field.type === "naval-symbol") {
        control = select(NAVAL_SYMBOL_OPTIONS, value ?? "combat");
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

      if (field.key === "ammo") {
        control.min = "0";
        control.step = "1";
        control.max = String(Number.MAX_SAFE_INTEGER);
      }

      controls.set(field.key, control);

      labeled(
        sectionHosts.get(field.key),
        field.label,
        control,
        field.definition
      );
      control.closest("label").dataset.field = field.key;
    }

    if (category === "units" && controls.has("naval.iconType")) {
      const preview = node("div", "", "catalog-symbol-preview");
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", "-14 -22 28 42");
      svg.setAttribute("width", "56");
      svg.setAttribute("height", "84");
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", "艦船マークのプレビュー（上が艦艏）");
      const path = document.createElementNS(ns, "path");
      path.setAttribute("fill", "#a8d8f7");
      svg.append(path);
      const control = controls.get("naval.iconType");
      const update = () => path.setAttribute("d", navalSymbolPath(control.value));
      control.addEventListener("change", update);
      update();
      preview.append(svg, node("span", "上＝艦艏 / 表示専用"));
      sectionHosts.get("naval.iconType").append(preview);
    }

    let readLoadouts=null;
    if(category==='units' && draft.branch==='air'){
      mountAircraftDerivedFields(controls,sectionHosts.get('naval.endurance'));
    }
    if(category==='units' && draft.branch==='building') {
      const preview=node('div','','catalog-symbol-preview');
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','-38 -34 76 57');svg.style.width='90px';svg.style.height='96px';svg.setAttribute('role','img');svg.setAttribute('aria-label','施設マークのプレビュー');preview.append(svg,node('span','直径50マス / 標識は表示上のみ浮上'));
      sectionHosts.get('building.kind').append(preview);
      function syncBuilding(){
        const building=Object.fromEntries(['kind','permanence','airportType','portType','runways'].map(key=>[key,key==='runways'?Number(controls.get('building.'+key).value):controls.get('building.'+key).value]));
        for(const key of ['permanence','airportType','runways','portType'])controls.get('building.'+key).closest('label').hidden=key==='permanence'?false:key==='portType'?building.kind!=='port':building.kind!=='airport'||(key==='runways'&&building.airportType!=='runway');
        svg.replaceChildren();drawBuildingIcon({snapshot:{building}},svg,path=>transformBuildingPath(path,(x,y)=>({x:(x-y)*.95,y:(x+y)*.43})));
      }
      for(const key of ['kind','permanence','airportType','portType','runways'])controls.get('building.'+key).addEventListener('change',syncBuilding);
      syncBuilding();
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
        draft.branch === "building" ? "施設名候補（1 行 1 件）" : "艦名 / 名称候補（1 行 1 件）",
        hullNames,
        draft.branch === "building" ? "同じ施設資料から追加する個体の名称候補。名称による性能補正はありません。" : EXTRA_DEFINITIONS[0][1]
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
          draft.branch === "building" ? select([["露天","露天"],["地下","地下"]], value.position === "地下" ? "地下" : "露天") : draft.branch === "air" ? select(AIRCRAFT_WEAPON_ROLES.map(([,label])=>[label,label]),value.position||"主動武器") : input(value.position)
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
          if(draft.branch==='air'){
            const previous=equipmentSelect.value;
            const available=equipment.filter(e=>position.value!=='ポッド'||e.kind==='support');
            equipmentSelect.replaceChildren(...available.map(e=>new Option(getEquipmentLabel(e),e.id)));
            if(available.some(e=>e.id===previous))equipmentSelect.value=previous;
          }
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

        position.addEventListener("change",updatePreview);
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

      if(draft.branch==='air')readLoadouts=mountAircraftLoadoutEditor(form,equipment,draft.aircraft.loadouts);
      // ----- 舰载机编辑 -----
      if (!["building","air"].includes(draft.branch)) {

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

    actions.classList.add("catalog-save-actions");
    form.append(actions);

    form.addEventListener("submit", event => {
      event.preventDefault();

      safely(() => {
        const next = copy(draft);

        for (const field of fields) {
          const control = controls.get(field.key);

          if (field.type === "training-traits") {
            setPath(next, field.key, control.read());
            continue;
          }

          let value = control.value;


          if (field.type === "checkbox") {
            value = control.checked;
          } else if (
            field.type === "number" ||
            field.type === "optional-number"
          ) {

            value = readNumber(
              control,
              field.label,
              field.type === "optional-number"
            );
          } else if (["size","building-size","runway-count"].includes(field.type)) {
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

          next.embarked = ["building","air"].includes(draft.branch) ? (draft.embarked ?? []) : embarkedReaders
            .filter(reader => reader.active)
            .map(reader => reader.read());

          if(next.branch==='air'){next.aircraft.loadouts=readLoadouts();next.maxHp=next.aircraft.engines;}
          const saved = withProtectionAuthorization(() => {
            store.saveUnit(next);
            return true;
          });

          if (!saved) return;

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

    controls.get("supportEffect")?.addEventListener("change",()=>{if(controls.get("supportEffect").value)controls.get("kind").value="support";});
    controls.get("branch")?.addEventListener("change",()=>{
      const next=copy(draft);
      for(const field of fields){const control=controls.get(field.key);setPath(next,field.key,field.type==='training-traits'?control.read():field.type==='checkbox'?control.checked:['number','optional-number','size','building-size','runway-count'].includes(field.type)?(control.value.trim()?Number(control.value):null):control.value);}
      next.hullNames=hullNames.value.split(/\r?\n/).filter(Boolean);next.description=description.value;
      next.mounts=mountReaders.filter(reader=>reader.active).map(reader=>reader.read());next.embarked=["building","air"].includes(draft.branch) ? (draft.embarked ?? []) : embarkedReaders.filter(reader=>reader.active).map(reader=>reader.read());
      if(draft.branch==='air')next.aircraft.loadouts=readLoadouts();
      if(next.branch==='air')next.aircraft=normalizeAircraft(next.aircraft);
      if(next.branch==='building'){next.sizeLevel=1;next.building=normalizeBuilding(next.building);}
      renderForm(next);
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
