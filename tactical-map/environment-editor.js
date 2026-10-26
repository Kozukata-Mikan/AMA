import {
  WEATHER_GROUPS,
  normalizeEnvironment,
  getTimePeriod,
  getWeatherInfo
} from "./environment-data.js";

function node(tag, text = "", className = "") {
  const result = document.createElement(tag);
  result.textContent = text;

  if (className) result.className = className;

  return result;
}

function field(parent, title, control) {
  const label = node("label");
  label.append(node("span", title), control);
  parent.append(label);
  return control;
}

export function mountEnvironmentEditor({
  container,
  svg,
  store,
  canApply = () => true
}) {
  // ===== 面板 =====

  const section = node(
    "section",
    "",
    "editor-section environment-editor"
  );

  section.append(node("h3", "時間と天候"));

  const timeInput = node("input");
  timeInput.type = "time";
  timeInput.step = "60";
  timeInput.required = true;

  field(section, "沙盤時刻", timeInput);

  const periodNote = node("p", "", "editor-note");
  section.append(periodNote);

  const weatherSelect = node("select");

  for (const group of WEATHER_GROUPS) {
    const options = node("optgroup");
    options.label = group.label;

    for (const [id, label] of group.options) {
      options.append(new Option(label, id));
    }

    weatherSelect.append(options);
  }

  field(section, "天候", weatherSelect);

  section.append(node(
    "p",
    "時刻と天候は地図全体に適用されます。" +
    "時刻は自動で進みません。現在は環境表示のみで、能力補正は行いません。",
    "editor-note"
  ));

  const actions = node("div", "", "editor-actions");

  const apply = node("button", "時間と天候を適用");
  apply.type = "button";
  actions.append(apply);

  const status = node(
    "p",
    "",
    "editor-note editor-status"
  );

  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  section.append(actions, status);
  container.append(section);

  // ===== 沙盘角落标识 =====

    // 优先挂到沙盘面板，而不是可能存在的 SVG 外层包装。
  const mapHost = svg.closest(".map-panel") ?? svg.parentElement;

  if (getComputedStyle(mapHost).position === "static") {
    mapHost.style.position = "relative";
  }


  const addedHostClass = !mapHost.classList.contains(
    "environment-map-host"
  );

  mapHost.classList.add("environment-map-host");

  const badge = node(
    "div",
    "",
    "map-environment-badge"
  );

    // 直接定位作为兜底，避免 CSS 未更新时落入普通文档流。
  Object.assign(badge.style, {
    position: "absolute",
    left: "auto",
    top: "auto",
    right: "16px",
    bottom: "48px",
    zIndex: "3",

    display: "block",
    width: "max-content",
    maxWidth: "calc(100% - 32px)",
    boxSizing: "border-box",
    margin: "0",
    padding: "10px 14px",

    border: "1px solid var(--weather-color, #f1f5f9)",
    borderLeft: "4px solid var(--weather-color, #f1f5f9)",
    borderRadius: "6px",
    background: "rgba(7, 16, 27, 0.96)",
    color: "#e8eef6",

    fontSize: "12px",
    lineHeight: "1.6",
    pointerEvents: "none",
    userSelect: "none"
  });

  badge.setAttribute("role", "status");
  badge.setAttribute("aria-live", "polite");
  badge.setAttribute("aria-atomic", "true");

  const timeLine = node("div", "", "environment-time");

  const weatherLine = node(
    "div",
    "",
    "environment-weather"
  );

  const dot = node("span", "", "environment-weather-dot");
  dot.setAttribute("aria-hidden", "true");

  const weatherText = node("span");

  weatherLine.append(dot, weatherText);
  badge.append(timeLine, weatherLine);
  mapHost.append(badge);

  let known = "";

  function show(text, error = false) {
    status.textContent = [
      text,
      store.getStorageWarning()
    ].filter(Boolean).join("\n");

    status.classList.toggle("error", error);
  }

  function updateTimePreview() {
    if (!timeInput.value) {
      periodNote.textContent = "時刻を指定してください。";
      return;
    }

    try {
      const period = getTimePeriod(timeInput.value);
      periodNote.textContent =
        `時間帯：${period.label} · 適用ボタンで保存`;
    } catch {
      periodNote.textContent = "有効な時刻を指定してください。";
    }
  }

  function drawBadge(environment) {
    const period = getTimePeriod(environment.time);
    const weather = getWeatherInfo(environment.weather);

    timeLine.textContent =
      `時刻 ${environment.time} · ${period.label}`;

    weatherText.textContent =
      `${weather.levelLabel} · ${weather.label}`;

    badge.style.setProperty(
      "--weather-color",
      weather.color
    );

    badge.dataset.weatherLevel = weather.level;
    badge.dataset.timePeriod = period.id;
  }

  function sync(force = false) {
    const environment = normalizeEnvironment(
      store.getScene().environment
    );

    const serialized = JSON.stringify(environment);

    // 单位或视角变化时，不反复覆盖尚未应用的环境输入。
    if (!force && serialized === known) return;

    known = serialized;

    timeInput.value = environment.time;
    weatherSelect.value = environment.weather;

    updateTimePreview();
    drawBadge(environment);

    status.textContent = "";
    status.classList.remove("error");
  }

  timeInput.addEventListener("input", updateTimePreview);

  apply.addEventListener("click", () => {
    try {
      if (!canApply()) {
        throw new Error(
          "地形描画を終了してから環境を変更してください。"
        );
      }

      if (!timeInput.reportValidity()) return;

      store.setEnvironment({
        time: timeInput.value,
        weather: weatherSelect.value
      });

      // 即使数值未变，也明确同步面板。
      sync(true);
      show("時刻と天候を保存しました。");
    } catch (error) {
      show(error.message, true);
      console.error(error);
    }
  });

  const unsubscribe = store.subscribe(() => sync());

  sync(true);

  return {
    // 读取另一张地图时，即使环境值相同，
    // 也丢弃上一张地图尚未应用的输入。
    refresh() {
      sync(true);
    },

    destroy() {
      unsubscribe();
      section.remove();
      badge.remove();

      if (addedHostClass) {
        mapHost.classList.remove("environment-map-host");
      }
    }
  };
}
