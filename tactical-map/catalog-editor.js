import {drawCatalogSymbol} from './catalog-symbols.js?v=visual-support-bridge-1';
import {AIR_TRAITS} from '../js/aircraft-training.js?v=self-sealing-1';
import {AIR_ATTACK_MODES,ARMOR_OPTIONS} from './air-ground-rules.js?v=car-return-1';
import {fillEquipmentOptions} from '../js/equipment-options.js?v=aviation-operations-1';
import {mountAviationComplementEditor} from './aviation-complement-ui.js?v=field-support-1';
import {AIRCRAFT_TYPES,AIRCRAFT_WEAPON_ROLES,normalizeAircraft,aircraftMounts} from '../js/aircraft-template.js?v=self-sealing-1';
import {mountAircraftDerivedFields,mountAircraftLoadoutEditor,appendAircraftSummary} from './aircraft-catalog-ui.js?v=self-sealing-1';
import { SUPPORT_EFFECTS } from "./support-equipment.js?v=visual-support-bridge-1";
import { BUILDING_KINDS, FACILITY_DURABILITY, AIRPORT_TYPES, PORT_TYPES, normalizeBuilding, drawBuildingIcon, transformBuildingPath } from "./building-runtime.js?v=facility-rules-1";
import { GUIDANCE_OPTIONS, getGuidanceLabel } from "./weapon-profile-runtime.js?v=visual-support-bridge-1";
import { NAVAL_KINDS } from "./naval-kind.js?v=catalog-layout-2";
import { NAVAL_SYMBOL_OPTIONS, navalSymbolPath } from "../js/naval-symbols.js?v=naval-formation-2";
import { getCatalogStore } from "../js/catalog-store.js?v=visual-support-bridge-1";
import {FACTION_OPTIONS,getFactionName} from "../js/faction-data.js";

import {
  getUnitFields,
  EQUIPMENT_FIELDS,
  EXTRA_DEFINITIONS,
  TRAINING_TRAIT_OPTIONS,
  getTrainingTraitLabel,
  getEquipmentLabel,
  getProjectionLabel
} from "../js/catalog-seed.js?v=visual-support-bridge-1";

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
    ["hull", "船体・防御", ["sizeLevel","maxHp","aircraft.engines","aircraft.crew","aircraft.selfSealingTank","naval.strength","naval.armor"]],
    ["recon", "偵察・探測", ["naval.detection","naval.seaRecon","naval.airRecon","naval.aswRecon"]],
    ["mobility", "航速・航続", ["naval.speedKnots","naval.submergedSpeedKnots","naval.endurance","aircraft.ceiling","aircraft.maneuverability","aircraft.remoteRange"]],
    ["facility", "施設設定", ["building.kind","building.permanence","building.airportType","building.runways","building.portType"]],
    ["traits", "練度・特殊能力", ["trainingTraits","aircraft.training","aircraft.acePilotName","aircraft.traits"]]
  ] : [
    ["basic", "基本情報", ["name","kind","faction","slot","supportEffect","remoteRange"]],
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

function catalogVisual(item) {
  const box=node('span','','catalog-visual');box.setAttribute('aria-hidden','true');
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','-40 -40 80 80');
  if(item.branch==='building')drawBuildingIcon({snapshot:{building:normalizeBuilding(item.building)}},svg,path=>transformBuildingPath(path,(x,y)=>({x,y})));
  else if(!drawCatalogSymbol(svg,item)){const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',item.branch==='navy'?navalSymbolPath(item.naval?.iconType??'combat'):item.kind==='support'?'M-12 -27 L12 -27 L12 -12 L27 -12 L27 12 L12 12 L12 27 L-12 27 L-12 12 L-27 12 L-27 -12 L-12 -12 Z':'M0 -28 L25 0 L0 28 L-25 0 Z');path.setAttribute('fill','currentColor');path.setAttribute('stroke','currentColor');svg.append(path);}
  box.append(svg);return box;
}
function catalogOverview(item,category) {
  const hero=node('div','','catalog-overview'),identity=node('div','','catalog-identity'),title=node('div');
  title.append(node('h3',category==='units'?item.name:getEquipmentLabel(item)),node('p',`${category==='units'?(item.branch==='air'?(AIRCRAFT_TYPES.find(([id])=>id===item.aircraft?.type)?.[1]??'航空機'):branchName(item.branch)):item.kind==='support'?'支援装備':`武器 · ${getGuidanceLabel(item.guidance)||'引導方式未設定'}`} · ${getFactionName(item.faction)}${item.protected?' · 保護あり':''}`,'catalog-muted'));
  identity.append(catalogVisual(item),title);hero.append(identity);
  const stats=category==='units'?[['耐性',item.maxHp],['装甲',item.naval?.armor],['速度',item.naval?.speedKnots],['対海',item.naval?.seaRecon],['対空',item.naval?.airRecon],['対潜',item.naval?.aswRecon]]:item.kind==='support'?[['支援効果',SUPPORT_EFFECTS.find(([id])=>id===item.supportEffect)?.[1]],['遠隔範囲',item.remoteRange]]:[['投射',getProjectionLabel(item)],['威力',item.powerRule],['穿深',item.penetration],['射距',item.range],['射高',item.ceilingU],['次序',item.maxOrder]];
  const cards=node('dl','','catalog-stat-cards');for(const [label,value]of stats){const card=node('div');card.append(node('dt',label),node('dd',displayValue(value)));cards.append(card);}hero.append(cards);return hero;
}
function catalogSectionNavigation(host,sections) {
  const nav=node('nav','','catalog-section-nav');nav.setAttribute('aria-label','資料内の項目');
  for(const section of sections){const title=section.querySelector('legend')?.textContent??section.textContent;nav.append(button(title,()=>section.scrollIntoView({block:'start'})));}
  host.prepend(nav);return nav;
}

function ensureStyles() {
  if (document.querySelector("#catalog-styles")) return;

  const link = node("link");
  link.id = "catalog-styles";
  link.rel = "stylesheet";
  link.href = new URL("./catalog.css?v=self-sealing-1", import.meta.url).href;

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
  let equipmentFilter="weapon";
  let selectedId = "navy-yamato-class-1941";
  let editing = false;
  let listLimit=80;

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
    ["equipment-weapon", "武器"],
    ["equipment-support", "支援装備"]
  ], "navy");

  categorySelect.className='catalog-category-select';categorySelect.setAttribute('aria-label','資料の分類');
  const categories=node('nav','','catalog-categories');categories.setAttribute('aria-label','図鑑の分類');
  for(const option of categorySelect.options){const tab=button(option.textContent,()=>{categorySelect.value=option.value;categorySelect.dispatchEvent(new Event('change'));});tab.dataset.category=option.value;categories.append(tab);}
  const factionFilter = select(FACTION_OPTIONS);
  factionFilter.options[0].textContent = "すべての色陣営";
  factionFilter.setAttribute("aria-label", "色陣営で絞り込み");


  const sortOrder=select([['updated','最近編集した順'],['name','名称順'],['manual','登録順・手動並べ替え']],'updated');sortOrder.setAttribute('aria-label','図鑑の並び順');sortOrder.addEventListener('change',renderList);
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

  list.id="catalog-items";
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
      kind: equipmentFilter,
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
    sortOrder,
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

  const dataMenu=node('details','','catalog-data-menu');dataMenu.append(node('summary','データ管理'));
  const dataActions=node('div','','catalog-data-actions');
  for(const action of [...toolbar.querySelectorAll('button')])if(action.textContent!=='新規追加')dataActions.append(action);
  dataMenu.append(dataActions);toolbar.append(dataMenu);

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
        ? "equipment-"+equipmentFilter
        : branchFilter;

      return;
    }

    const value = categorySelect.value;
    listLimit=80;

    category = value.startsWith("equipment-") ? "equipment" : "units";
    if(category==="equipment")equipmentFilter=value.slice(10);
    branchFilter = category==="equipment" ? "" : value;

    selectedId = "";
    editing = false;

    renderList();
    renderDetail();
  });

  const refilter=()=>{listLimit=80;renderList();if(!editing)renderDetail();};
  factionFilter.addEventListener("change",refilter);
  search.addEventListener("input",refilter);

  function renderList() {
    const oldScroll=list.scrollTop;
    list.replaceChildren();
    for(const tab of categories.children)tab.setAttribute("aria-pressed",String(tab.dataset.category===categorySelect.value));

    const data = store.getData();
    const term = search.value.trim().toLowerCase();

    const items = data[category].filter(item =>
      item.name.toLowerCase().includes(term) &&
      (category!=="equipment"||item.kind===equipmentFilter) &&
      (
        category === "equipment" ||
        item.branch === branchFilter
      ) &&
      (
        !factionFilter.value ||
        item.faction === factionFilter.value
      )
    );


    if(sortOrder.value==='updated')items.sort((a,b)=>String(b.updatedAt??'').localeCompare(String(a.updatedAt??''))||a.name.localeCompare(b.name,'ja'));
    if(sortOrder.value==='name')items.sort((a,b)=>a.name.localeCompare(b.name,'ja'));
    list.append(node('p',`${items.length}件 / ${category==='units'?branchName(branchFilter):equipmentFilter==='weapon'?'武器':'支援装備'}`,'catalog-list-count'));
    if(!editing&&!items.some(item=>item.id===selectedId))selectedId=items[0]?.id??'';
    for (const item of items.slice(0,listLimit)) {
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

      entry.setAttribute('aria-label',text);
      entry.classList.add('catalog-entry');
      const caption=node('span','','catalog-entry-caption');caption.append(node('strong',item.name),node('small',category==='units'?`${item.branch==='air'?(AIRCRAFT_TYPES.find(([id])=>id===(item.aircraft?.type??'carrier'))?.[1]??'航空機'):branchName(item.branch)} · 耐性 ${item.maxHp} · ${getFactionName(item.faction)}`:item.kind==='support'?(SUPPORT_EFFECTS.find(([id])=>id===item.supportEffect)?.[1]??'支援装備'):`${getGuidanceLabel(item.guidance)||'引導方式未設定'} · 射距 ${displayValue(item.range)} · 次序 ${displayValue(item.maxOrder)}`));
      entry.replaceChildren(catalogVisual(item),caption);
      entry.classList.toggle(
        "active",
        item.id === selectedId
      );

      if(sortOrder.value==='manual'){
        const row=node('div','','catalog-order-row'),index=items.indexOf(item);row.append(entry);
        for(const [direction,label]of [[-1,'上へ'],[1,'下へ']]){const move=button(label,()=>safely(()=>store.moveItem(category,item.id,items[index+direction].id))());move.setAttribute('aria-label',`${item.name}を${label}`);move.disabled=!items[index+direction];row.append(move);}list.append(row);
      }else list.append(entry);
    }

    if(items.length>listLimit)list.append(button(`次の80件を表示（残り${items.length-listLimit}件）`,()=>{listLimit+=80;renderList();}));
    list.scrollTop=oldScroll;
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
      catalogOverview(item,category),
      node(
        "p",
        "① 分類と資料を選択 → ② 性能・装備を確認／編集 → ③ 地図へ追加。図鑑の変更は新しく配置する個体に適用します。",
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
            : field.type === "air-traits" ? (value??[]).map(id=>AIR_TRAITS.find(t=>t[0]===id)?.slice(1).join("：")??id).join(" / ")
            : field.type === "air-attack-modes" ? (value??[]).map(id=>AIR_ATTACK_MODES.find(m=>m[0]===id)?.[1]??id).join(" / ")
            : field.type === "aircraft-type" ? AIRCRAFT_TYPES.find(([id])=>id===value)?.[1]
            : field.type === "air-training" ? ({novice:'見習い（反応力0）',regular:'普通（反応力1）',elite:'精鋭（反応力2）',ace:'エース（反応力3）'}[value] ?? value ?? '普通（反応力1）')
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
            : field.type === "checkbox" ? (value ? "あり" : "なし")
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

    if(category==='units'&&item.aviationComplement?.length)detail.append(node('h4','搭載航空機（航空運用）'),table(['機体','機数','航空編隊'],item.aviationComplement.map(e=>[store.units.find(u=>u.id===e.unitId)?.name??e.unitId,e.count,e.groupId??'なし'])));
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
        node("h4", item.branch === "building" ? "施設名" : item.branch === "air" ? "機体名" : "艦名"),
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
            equipmentFilter=equipment.kind;categorySelect.value = "equipment-"+equipmentFilter;
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


      if (item.description) {
        detail.append(
          node("h4", "説明"),
          node("p", item.description, "catalog-description")
        );
      }
    }

    detail.append(showDefinitions(fields));
    catalogSectionNavigation(detail,[...detail.querySelectorAll(':scope > h4')]);
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
      node("h3", draft.name?`${draft.name}を編集`:"新規資料を作成"),
      node("p", "入力後は保存してください。分類・資料を切り替える前に未保存の変更を確認します。", "catalog-muted")
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
      } else if (field.type === "air-traits") {
        control=node("div");control.className="catalog-air-traits";const boxes=AIR_TRAITS.map(([id,name,note])=>{const box=input("","checkbox");box.checked=(value??[]).includes(id);labeled(control,name,box,note);return[id,box];});control.read=()=>boxes.filter(([,b])=>b.checked).map(([id])=>id);
      } else if (field.type === "air-attack-modes") {
        control=node("div");const boxes=AIR_ATTACK_MODES.map(([id,name])=>{const box=input("","checkbox");box.checked=(value??[]).includes(id);labeled(control,name,box);return[id,box];});control.read=()=>boxes.filter(([,b])=>b.checked).map(([id])=>id);
      } else if (["armor-grade","penetration-grade"].includes(field.type)) {
        const penetration=field.type==="penetration-grade";
        const values=penetration?["-",...ARMOR_OPTIONS.filter(v=>v!=="0")]:ARMOR_OPTIONS;
        const old=value===0||value==="0"?(penetration?"-":"0"):String(value??"").trim().toUpperCase().replace(/[−–—－]/g,"-");
        control=select([["","未設定"],...values.map(v=>[v,v==="-"?"0（穿深なし）":v==="0"?"0（装甲なし）":v]),...(old&&!values.includes(old)?[[old,old+"（旧資料・要確認）"]]:[])],old);
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
      } else if(field.type==='air-training'){const aliases={'见习':'novice','見習い':'novice','普通':'regular','精锐':'elite','精鋭':'elite','王牌':'ace','エース':'ace'};control=select([['novice','見習い（反応力0）'],['regular','普通（反応力1）'],['elite','精鋭（反応力2）'],['ace','エース（反応力3）']],aliases[value]??value??'regular');if(!control.value)control.value='regular';
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
      if(["air-attack-modes","air-traits"].includes(field.type)){const box=node("fieldset");box.dataset.field=field.key;box.append(node("legend",field.label),control,node("small",field.definition));sectionHosts.get(field.key).append(box);continue;}

      labeled(
        sectionHosts.get(field.key),
        field.label,
        control,
        field.definition
      );
      control.closest("label").dataset.field = field.key;
    }

    if(controls.has('aircraft.traits')){
      const traits=controls.get('aircraft.traits'),training=controls.get('aircraft.training'),name=controls.get('aircraft.acePilotName'),boxes=[...traits.querySelectorAll('input[type="checkbox"]')];
      const sync=()=>{const eligible=['elite','ace'].includes(training.value);for(const [i,b]of boxes.entries())if(!eligible||AIR_TRAITS[i][0]==='sifu'&&training.value!=='ace')b.checked=false;const count=boxes.filter(b=>b.checked).length;for(const [i,b]of boxes.entries()){const permitted=eligible&&(AIR_TRAITS[i][0]!=='sifu'||training.value==='ace');b.disabled=!permitted||!b.checked&&count>=3;}name.closest('label').hidden=training.value!=='ace';};
      training.addEventListener('change',sync);traits.addEventListener('change',sync);sync();
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

    let readLoadouts=null,readComplement=null,aircraftEquipmentCategory=null;
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
        draft.branch === "building" ? "施設名候補（1 行 1 件）" : draft.branch === "air" ? "機体名候補（1 行 1 件）" : "艦名 / 名称候補（1 行 1 件）",
        hullNames,
        draft.branch === "building" ? "同じ施設資料から追加する個体の名称候補。名称による性能補正はありません。" : draft.branch === "air" ? "同じ航空機資料から追加する機体の名称候補。名称による性能補正はありません。" : EXTRA_DEFINITIONS[0][1]
      );

      description = node("textarea");
      description.value = draft.description ?? "";

      labeled(form, "説明・備考", description);

      // ----- 装备配置编辑 -----

      form.append(node("h4", "装備配置"));
      if(draft.branch==='air'){
        aircraftEquipmentCategory=select([['主動武器','主動武器'],['自衛武器','自衛武器'],['ポッド','ポッド'],['掛載','掛載（構成を登録）']],'主動武器');
        labeled(form,'航空機の装備区分',aircraftEquipmentCategory,'掛載は固定武装とは別枠です。掛載を選択して「装備配置を追加」を押すと、新しい掛載構成を追加します。');
      }

      const mountHost = node("div", "", "catalog-repeat-list");
      const allocation=node('p','','catalog-muted');
      function updateAllocation(){
        if(draft.branch!=='building')return;const rows=mountReaders.filter(r=>r.active).map(r=>r.read()),n=rows.filter(r=>r.position!=='中心').length+1,hp=Number(controls.get('maxHp')?.value??draft.maxHp),base=Math.floor(hp/n),extra=hp%n;
        allocation.textContent=`配置耐性：${n}か所（中心1か所を含む）。通常配置 ${base}、中心 ${base+extra}。装備組数ではなく配置行数で均等配分します。中心には複数の支援設備を置けますが、耐性区画は常に1か所です。`;
      }
      if(draft.branch==='building'){form.append(allocation);controls.get('maxHp')?.addEventListener('input',updateAllocation);}
      const equipment = store.getData().equipment;
      const compartment=['navy','building'].includes(draft.branch)?node('fieldset','','catalog-section'):null;
      const compartmentHost=compartment?node('div','','catalog-repeat-list'):null;
      if(compartment){compartment.append(node('legend',draft.branch==='navy'?'艦橋｜偵察・支援設備':'中心｜偵察・支援設備'),node('p',draft.branch==='navy'?'対海・対空・対潜偵察と追加の支援設備をまとめた区画です。設備威力で艦橋が損傷すると同時に停止します。':'中心は建築に1か所です。複数の支援設備を収容でき、装備を追加しても中心耐性を分割しません。中心停止中は偵察を含む全設備が停止します。'));
       const sensors=node('div','','catalog-section-grid');for(const key of ['naval.seaRecon','naval.airRecon','naval.aswRecon']){const control=controls.get(key);if(control)sensors.append(control.closest('label'));}compartment.append(sensors,compartmentHost);
      }

      function addMount(value = {
        position: "",
        equipmentId: equipment[0]?.id ?? "",
        count: 1
      }) {
        const row = node("div", "", "catalog-repeat-row");

        const position = labeled(
          row,
          "位置",
          draft.branch === "building" ? select([["露天","露天"],["地下","地下"],["中心","中心"]], ["地下","中心"].includes(value.position) ? value.position : "露天") : draft.branch === "air" ? select(AIRCRAFT_WEAPON_ROLES.map(([,label])=>[label,label]),(AIRCRAFT_WEAPON_ROLES.some(([,label])=>label===value.position)?value.position:"主動武器")) : draft.branch==='navy'?select([...new Set(['前部','中部①','中部②','両舷','後部','尾部','艦橋',value.position].filter(Boolean))].map(p=>[p,p]),value.position||'前部'):input(value.position)
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
          if(draft.branch==='air'||compartment){
            const previous=equipmentSelect.value;
            const restricted=position.value==='ポッド'||position.value==='艦橋'||position.value==='中心';
            const available=equipment.filter(e=>!restricted||e.kind==='support'||e.id===value.equipmentId&&value.position==='中心'&&position.value==='中心');
            fillEquipmentOptions(equipmentSelect,available,previous,getEquipmentLabel);
            if(available.some(e=>e.id===previous))equipmentSelect.value=previous;
          }
          if(compartment){const host=['艦橋','中心'].includes(position.value)?compartmentHost:mountHost;if(row.parentElement!==host)host.append(row);}
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
        fillEquipmentOptions(equipmentSelect,equipment,value.equipmentId,getEquipmentLabel);
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
            updateAllocation();
          })
        );

        (["艦橋","中心"].includes(position.value)&&compartmentHost?compartmentHost:mountHost).append(row);
        position.addEventListener("change",updateAllocation);
        updateAllocation();
      }

      for (const mount of draft.mounts ?? []) {
        addMount(mount);
      }
      updateAllocation();

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

          if(draft.branch==='air'&&aircraftEquipmentCategory.value==='掛載')readLoadouts.add();
          else addMount({position:draft.branch==='air'?aircraftEquipmentCategory.value:'',equipmentId:equipment[0]?.id??'',count:1});
        })
      );

      if(compartment){compartment.append(button('支援設備を'+(draft.branch==='navy'?'艦橋':'中心')+'に追加',()=>{const support=equipment.find(e=>e.kind==='support');if(!support){message('先に支援装備を登録してください。',true);return;}addMount({position:draft.branch==='navy'?'艦橋':'中心',equipmentId:support.id,count:1});}));form.append(compartment);}
      if(['navy','building'].includes(draft.branch))readComplement=mountAviationComplementEditor(form,store.units,draft.aviationComplement??[]);
      if(draft.branch==='air')readLoadouts=mountAircraftLoadoutEditor(form,equipment,draft.aircraft.loadouts);

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

          if (typeof control.read === "function") {
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

          next.embarked = copy(draft.embarked ?? []);

          if(readComplement)next.aviationComplement=readComplement();
          if(next.branch==='air'){next.aircraft.loadouts=readLoadouts();next.maxHp=next.aircraft.engines;}
          const saved = withProtectionAuthorization(() => {
            store.saveUnit(next);
            return true;
          });

          if (!saved) return;

        } else {
          store.saveEquipment(next);
          equipmentFilter=next.kind;categorySelect.value="equipment-"+equipmentFilter;
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
      for(const field of fields){const control=controls.get(field.key);setPath(next,field.key,typeof control.read==='function'?control.read():field.type==='checkbox'?control.checked:['number','optional-number','size','building-size','runway-count'].includes(field.type)?(control.value.trim()?Number(control.value):null):control.value);}
      next.hullNames=hullNames.value.split(/\r?\n/).filter(Boolean);next.description=description.value;
      next.mounts=mountReaders.filter(reader=>reader.active).map(reader=>reader.read());next.embarked=copy(draft.embarked??[]);
      if(readComplement)next.aviationComplement=readComplement();
      if(draft.branch==='air')next.aircraft.loadouts=readLoadouts();
      if(next.branch==='air')next.aircraft=normalizeAircraft(next.aircraft);
      if(next.branch==='building'){next.sizeLevel=1;next.building=normalizeBuilding(next.building);}
      renderForm(next);
    });
    const guide=node('div','','catalog-edit-guide');guide.append(node('strong','編集の手順'),node('p','基本情報 → 性能・偵察 → 装備配置・掛載 → 保存。項目を選ぶと、その入力欄へ移動できます。'));
    const help=input('', 'checkbox');help.checked=false;const helpLabel=node('label');helpLabel.append(help,node('span','項目の説明を表示'));guide.append(helpLabel);help.addEventListener('change',()=>form.classList.toggle('catalog-show-help',help.checked));
    guide.append(button('保存',()=>form.requestSubmit()));detail.append(guide,form);
    catalogSectionNavigation(guide,[...form.querySelectorAll(':scope > .catalog-form-grid > fieldset, :scope > h4, :scope > fieldset')]);
  }

  shell.append(header,categories,toolbar,status,body,fileInput);
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
