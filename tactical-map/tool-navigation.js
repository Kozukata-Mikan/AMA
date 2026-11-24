const CUSTOM_TABS = [
  ["operation", "作戦"],
  ["terrain", "地形"],
  ["units", "艦船"],
  ["formations", "編隊"],
  ["catalog", "図鑑"],
  ["simulation", "推演"],
];
const SIMULATION_TABS = [
  ["progress", "進行"],
  ["movement", "移動"],
  ["attack", "攻撃"],
  ["units", "艦船"],
  ["formations", "編隊"],
  ["reference", "資料"],
];

function element(tag, text = "", className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function customCategory(node) {
  const title = node.querySelector("summary")?.textContent.trim();
  if (node.classList.contains("terrain-editor")) return "terrain";
  if (title === "編隊陣形" || title === "編隊" || title === "集群")
    return "formations";
  if (title === "図鑑 / 資料編集") return "catalog";
  if (["図鑑から追加", "参戦ユニット", "ユニット設定"].includes(title))
    return "units";
  if (title === "推演モード") return "simulation";
  return "operation";
}

/** Reparent the original controls so their listeners, unsaved input and IDs survive. */
export function mountToolNavigation(store, host, mode) {
  const definitions = mode === "custom" ? CUSTOM_TABS : SIMULATION_TABS;
  const nodes = [...host.children];
  const pinned = nodes.filter(
    (node) =>
      node.classList.contains("workflow-overview") ||
      node.classList.contains("workflow-feedback") ||
      node.classList.contains("weapon-coverage-legend") ||
      node.matches('p[role="status"]'),
  );
  const panels = nodes.filter((node) => !pinned.includes(node));
  const categories = new Map();
  const regions = new Map();
  const tabs = new Map();
  const navigation = element("section", "", "tool-navigation");
  navigation.setAttribute("aria-label", "機能ナビゲーション");
  const searchRow = element("div", "", "tool-search");
  const search = element("input");
  search.type = "search";
  search.placeholder = "機能を検索…";
  search.setAttribute("aria-label", "機能を検索");
  const clear = element("button", "クリア");
  clear.type = "button";
  clear.hidden = true;
  searchRow.append(search, clear);
  const tablist = element("div", "", "tool-tabs");
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute(
    "aria-label",
    mode === "custom" ? "作戦編集の分類" : "推演の分類",
  );
  const result = element("p", "", "tool-search-result");
  result.setAttribute("role", "status");
  result.hidden = true;
  navigation.append(searchRow, tablist, result);

  for (const [key, label] of definitions) {
    const tab = element("button", label);
    tab.type = "button";
    tab.id = `tool-tab-${mode}-${key}`;
    tab.setAttribute("role", "tab");
    const region = element("section", "", "tool-pane");
    region.id = `tool-pane-${mode}-${key}`;
    region.setAttribute("role", "tabpanel");
    region.setAttribute("aria-labelledby", tab.id);
    tab.setAttribute("aria-controls", region.id);
    tablist.append(tab);
    region.append(element("h2", label, "tool-search-heading"));
    regions.set(key, region);
    tabs.set(key, tab);
  }
  for (const node of panels) {
    const key =
      mode === "custom"
        ? customCategory(node)
        : (node.dataset.toolCategory ?? "reference");
    categories.set(node, key);
    regions.get(key).append(node);
    node.classList.add("tool-section");
  }
  host.replaceChildren(
    navigation,
    ...pinned.filter((node) => !node.classList.contains("workflow-feedback")),
    ...regions.values(),
    ...pinned.filter((node) => node.classList.contains("workflow-feedback")),
  );
  host.classList.add("tool-sidebar");
  document.body.classList.add(`ui-${mode}`);
  let active = definitions[0][0];

  function activate(key, openPanel = true) {
    active = key;
    search.value = "";
    clear.hidden = true;
    result.hidden = true;
    host.classList.remove("tool-searching");
    for (const [id, region] of regions) {
      region.hidden = id !== key;
      for (const panel of region.querySelectorAll(":scope > .tool-section"))
        panel.hidden = false;
      const tab = tabs.get(id);
      tab.setAttribute("aria-selected", String(id === key));
      tab.tabIndex = id === key ? 0 : -1;
    }
    if (openPanel) {
      const first = regions.get(key).querySelector("details");
      if (first && !regions.get(key).querySelector("details[open]"))
        first.open = true;
    }
  }
  function termsFor(value) {
    const aliases = {
      地图绘制: "地図 描",
      地图: "地図",
      地形绘制: "地形 描",
      编队: "編隊",
      阵型: "陣形",
      图鉴: "図鑑",
      舰船: "艦船",
      攻击: "攻撃",
      侦察: "偵察",
      损管: "損管",
      存档: "保存",
      导入: "読み込み",
      导出: "書き出し",
      时间: "時間",
      自主: "自律",
    };
    for (const [word, replacement] of Object.entries(aliases))
      value = value.replaceAll(word, replacement);
    return value.split(/\s+/).filter(Boolean);
  }
  function filter() {
    const term = search.value.trim().toLocaleLowerCase();
    if (!term) {
      activate(active, false);
      return;
    }
    const terms = termsFor(term);
    clear.hidden = false;
    result.hidden = false;
    host.classList.add("tool-searching");
    let matches = 0;
    for (const [key, region] of regions) {
      let visible = 0;
      for (const panel of region.querySelectorAll(":scope > .tool-section")) {
        // Search on demand, never traverse the battlefield or recalculate rules.
        const text = panel.textContent.toLocaleLowerCase();
        const found = terms.every((word) => text.includes(word));
        panel.hidden = !found;
        if (found) visible++;
      }
      region.hidden = visible === 0;
      matches += visible;
      tabs.get(key).setAttribute("aria-selected", "false");
    }
    result.textContent = matches
      ? `${matches}件の機能が見つかりました`
      : "該当する機能はありません";
  }
  for (const [key, tab] of tabs) {
    tab.addEventListener("click", () => {
      activate(key);
      host.scrollTop = 0;
    });
    tab.addEventListener("keydown", (event) => {
      const keys = [...tabs.keys()];
      const index = keys.indexOf(key);
      const positions = {
        ArrowRight: (index + 1) % keys.length,
        ArrowLeft: (index + keys.length - 1) % keys.length,
        Home: 0,
        End: keys.length - 1,
      };
      if (!(event.key in positions)) return;
      event.preventDefault();
      const next = keys[positions[event.key]];
      activate(next);
      tabs.get(next).focus();
    });
  }
  search.addEventListener("input", filter);
  search.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      activate(active, false);
      search.focus();
    }
  });
  clear.addEventListener("click", () => {
    activate(active, false);
    search.focus();
  });

  // Ignore toggle events already queued by panels before navigation mounted.
  const openStates = new WeakMap(
    [...host.querySelectorAll("details")].map((node) => [node, node.open]),
  );
  function followOpenedPanel(event) {
    const wasOpen = openStates.get(event.target);
    openStates.set(event.target, event.target.open);
    if (!event.target.open || wasOpen === event.target.open) return;
    // Nested unit-list disclosures can be rebuilt during every store update;
    // only an original top-level section is allowed to navigate the workspace.
    const panel = panels.find((node) => node === event.target);
    if (!panel) return;
    const key = categories.get(panel);
    if (key !== active || search.value) activate(key, false);
  }
  host.addEventListener("toggle", followOpenedPanel, true);
  let previousPhase;
  function followPhase() {
    if (mode !== "simulation") return;
    const phase = store.getSceneSnapshot().turn.phaseId;
    if (phase === previousPhase) return;
    previousPhase = phase;
    activate(
      phase === "movement"
        ? "movement"
        : /^(order-[1-5]|pas)$/.test(phase)
          ? "attack"
          : "progress",
    );
  }
  const unsubscribe = store.subscribe(followPhase);
  activate(active, false);
  followPhase();
  return () => {
    unsubscribe();
    host.removeEventListener("toggle", followOpenedPanel, true);
  };
}

/** Keep map display controls together while retaining their original listeners. */
export function mountViewSettings(toolbar, controls) {
  const menu = element("details", "", "map-view-settings");
  const summary = element("summary", "表示設定");
  const content = element("div", "", "map-view-settings-content");
  content.append(...controls.filter(Boolean));
  menu.append(summary, content);
  toolbar.append(menu);
  const outside = (event) => {
    if (!menu.contains(event.target)) menu.open = false;
  };
  const escape = (event) => {
    if (event.key === "Escape" && menu.open) {
      menu.open = false;
      summary.focus();
    }
  };
  document.addEventListener("pointerdown", outside);
  menu.addEventListener("keydown", escape);
  return () => {
    document.removeEventListener("pointerdown", outside);
    menu.removeEventListener("keydown", escape);
  };
}
