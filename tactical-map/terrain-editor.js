import {
  cloneTerrain,
  resizeTerrain,
  applyBrush
} from "./terrain-data.js";

import {
  mountEnvironmentEditor
} from "./environment-editor.js";


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

function numberInput(value) {
  const result = node("input");
  result.type = "number";
  result.step = "any";
  result.value = value;
  return result;
}

export function mountTerrainEditor({
  container,
  svg,
  store,
  pickPoint,
  previewTerrain,
  getTerrain
}) {
  
  const host = container;
  const disclosure = node("details", "", "editor-disclosure");

  disclosure.setAttribute("name", "ama-editor-sections");

  const summary = node(
    "summary",
    "地図と地形",
    "editor-disclosure-title"
  );

  const body = node("div", "", "editor-disclosure-body");

  disclosure.append(summary, body);
  host.append(disclosure);

  // 后续原有控件全部添加到折叠面板内部。
  container = body;


  const status = node("p", "", "editor-note editor-status");
  status.setAttribute("role", "status");

  const editing = node("input");
  editing.type = "checkbox";
  field(container, "地形編集モード", editing);

   const mode = node("select");

  const brushOptions = [
    ["raise", "標高を上げる"],
    ["lower", "標高を下げる"],
    ["smooth", "平滑化"],
    ["level", "指定標高に近づける"],
    ["land", "陸地を描く"],
    ["sea", "海域を描く"],
    ["river", "河川を描く"],
    ["eraseRiver", "河川を消す"],
    ["shallow", "浅海を描く"],
    ["eraseShallow", "浅海を消す"]
  ];

  for (const [value, title] of brushOptions) {
    mode.append(new Option(title, value));
  }

  field(container, "ブラシ", mode);

  const radius = field(container, "半径（5～200）", numberInput(30));
  const strength = field(container, "強度（0.1～50）", numberInput(5));
  const target = field(container, "指定標高（-200～600）", numberInput(20));

  container.append(node(
    "p",
    "編集モードでは地図上をドラッグして描画します。河川は陸地上、浅海は海域上に描けます。河川と浅海には、サイズレベル 1～2 の水上海軍ユニットのみ配置できます。",
    "editor-note"
  ));

  const sizeSection = node("section", "", "editor-section");
  sizeSection.append(node("h3", "地図サイズ"));

  const width = field(sizeSection, "幅（120～3200）", numberInput(600));
  const height = field(sizeSection, "高さ（120～3200）", numberInput(600));
  for (const control of [width, height]) {
    control.min = "120";
    control.max = "3200";
  }
  const cols = field(sizeSection, "列数（9～121）", numberInput(81));
  const rows = field(sizeSection, "行数（9～121）", numberInput(81));
  const interval = field(sizeSection, "等高線間隔（5～100）", numberInput(6));

  const actions = node("div", "", "editor-actions");
  const historyActions = node("div", "", "editor-actions");

  container.append(sizeSection, historyActions, status);
  sizeSection.append(actions);

  let undo = [];
  let redo = [];
  let stroke = null;
  let frame = null;
  let known = JSON.stringify(getTerrain());

  const environmentController = mountEnvironmentEditor({
    container,
    svg,
    store,

    canApply() {
      return stroke === null;
    }
  });


  function show(text, error = false) {
    status.textContent = [
      text,
      store.getStorageWarning()
    ].filter(Boolean).join("\n");

    status.classList.toggle("error", error);
  }

  function updateFields() {
    const terrain = getTerrain();
    width.value = terrain.width;
    height.value = terrain.height;
    cols.value = terrain.cols;
    rows.value = terrain.rows;
    interval.value = terrain.contourInterval;
  }

  function addButton(parent, title, action) {
    const result = node("button", title);
    result.type = "button";

    result.addEventListener("click", () => {
      try {
        if (stroke) throw new Error("描画を終了してから操作してください。");
        action();
      } catch (error) {
        show(error.message, true);
      }
    });

    parent.append(result);
    return result;
  }

  function saveTerrain(next, before) {
    // 先验证并保存，成功后才加入撤销历史。
    known = JSON.stringify(next);

    try {
      store.setTerrain(next);
    } catch (error) {
      known = JSON.stringify(before);
      previewTerrain(before);
      throw error;
    }

    undo.push(cloneTerrain(before));
    if (undo.length > 20) undo.shift();
    redo = [];
    updateFields();

    show("地形を保存し、配置条件を再検証しました。");
  }

  addButton(actions, "サイズと等高線間隔を適用", () => {
    if (!confirm(
      "地図サイズとグリッドを変更しますか？ユニット座標は変更されません。範囲外の地形は切り取られ、新しい範囲は海域になります。"
    )) return;

    const before = cloneTerrain(getTerrain());

    const next = resizeTerrain(before, {
      width: Number(width.value),
      height: Number(height.value),
      cols: Number(cols.value),
      rows: Number(rows.value),
      contourInterval: Number(interval.value)
    });

    saveTerrain(next, before);
  });

  addButton(historyActions, "地形を元に戻す", () => {
    if (!undo.length) {
      show("元に戻せる地形操作はありません。");
      return;
    }

    const current = cloneTerrain(getTerrain());
    const previous = undo[undo.length - 1];
    known = JSON.stringify(previous);

    try {
      store.setTerrain(previous);
    } catch (error) {
      known = JSON.stringify(current);
      throw error;
    }

    undo.pop();
    redo.push(current);
    updateFields();
    show("地形操作を元に戻しました。");
  });

  addButton(historyActions, "地形をやり直す", () => {
    if (!redo.length) {
      show("やり直せる地形操作はありません。");
      return;
    }

    const current = cloneTerrain(getTerrain());
    const next = redo[redo.length - 1];
    known = JSON.stringify(next);

    try {
      store.setTerrain(next);
    } catch (error) {
      known = JSON.stringify(current);
      throw error;
    }

    redo.pop();
    undo.push(current);
    updateFields();
    show("地形操作をやり直しました。");
  });

  function schedulePreview() {
    if (frame !== null) return;

    frame = requestAnimationFrame(() => {
      frame = null;
      if (stroke) previewTerrain(stroke.working);
    });
  }

  function paint(event) {
    const point = pickPoint(event);
    if (!point) return;

    // 按地图距离插值，避免快速拖动留下断裂。
    const start = stroke.last ?? point;
    const distance = Math.hypot(point.x - start.x, point.y - start.y);
    const stepLength = Math.max(3, stroke.brush.radius / 3);
    const steps = Math.max(1, Math.ceil(distance / stepLength));

    for (let index = 1; index <= steps; index++) {
      const ratio = index / steps;

      applyBrush(stroke.working, {
        x: start.x + (point.x - start.x) * ratio,
        y: start.y + (point.y - start.y) * ratio
      }, stroke.brush);
    }

    stroke.last = point;
    stroke.changed = true;
    schedulePreview();
  }

  function release(pointerId) {
    if (svg.hasPointerCapture(pointerId)) {
      svg.releasePointerCapture(pointerId);
    }
  }

  function finish(event, cancel = false) {
    if (!stroke || stroke.pointerId !== event.pointerId) return;

    const completed = stroke;
    stroke = null;

    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }

    release(event.pointerId);

    try {
      if (cancel || !completed.changed) {
        previewTerrain(completed.before);
        show("地形描画を取り消しました。");
      } else {
        saveTerrain(completed.working, completed.before);
      }
    } catch (error) {
      previewTerrain(completed.before);
      show(error.message, true);
    }
  }

  // 捕获阶段处理笔刷，阻止原来的地图平移监听器启动。
  function down(event) {
    if (!editing.checked || event.button !== 0 || stroke) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (store.isRecoveryBlocked()) {
      show("保存データを復元してから編集してください。", true);
      return;
    }

    try {
      const before = cloneTerrain(getTerrain());
      const brush = {
        mode: mode.value,
        radius: Number(radius.value),
        strength: Number(strength.value),
        target: Number(target.value)
      };

      // 在修改工作副本之前检查笔刷参数。
      applyBrush(cloneTerrain(before), { x: 100000, y: 100000 }, brush);

      stroke = {
        pointerId: event.pointerId,
        before,
        working: cloneTerrain(before),
        brush,
        last: null,
        changed: false
      };

      svg.setPointerCapture(event.pointerId);
      paint(event);
    } catch (error) {
      if (stroke) {
        const id = stroke.pointerId;
        stroke = null;
        release(id);
      }

      show(error.message, true);
    }
  }

  function move(event) {
    if (!stroke || stroke.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    try {
      paint(event);
    } catch (error) {
      finish(event, true);
      show(error.message, true);
    }
  }

  function up(event) {
    if (!stroke || stroke.pointerId !== event.pointerId) return;
    event.stopImmediatePropagation();
    finish(event);
  }

  function cancel(event) {
    finish(event, true);
  }

  function lost(event) {
    // 正常松开时 stroke 已经清空；意外失去捕获时取消操作。
    finish(event, true);
  }

  function click(event) {
    if (!editing.checked) return;
    event.stopImmediatePropagation();
  }

  editing.addEventListener("change", () => {
    if (stroke) finish({ pointerId: stroke.pointerId }, true);
    svg.classList.toggle("terrain-editing", editing.checked);
  });
  
    function handleDisclosureToggle() {
    if (disclosure.open) {
      // 兼容不支持 details.name 的浏览器。
      const panel = host.closest("#editor") ?? host;

      for (const other of panel.querySelectorAll(
        "details.editor-disclosure"
      )) {
        if (other !== disclosure) other.open = false;
      }

      return;
    }

    // 隐藏地形面板时，取消尚未提交的笔刷操作。
    if (stroke) {
      finish({ pointerId: stroke.pointerId }, true);
    }

    editing.checked = false;
    svg.classList.remove("terrain-editing");
  }

  disclosure.addEventListener("toggle", handleDisclosureToggle);


  svg.addEventListener("pointerdown", down, true);
  svg.addEventListener("pointermove", move, true);
  svg.addEventListener("pointerup", up, true);
  svg.addEventListener("pointercancel", cancel, true);
  svg.addEventListener("lostpointercapture", lost, true);
  svg.addEventListener("click", click, true);

  const unsubscribe = store.subscribe(() => {
    const incoming = JSON.stringify(store.getScene().terrain);

    // 另一页面修改地形或导入场景时，不能重做旧地图上的操作。
    if (incoming !== known) {
      if (stroke) finish({ pointerId: stroke.pointerId }, true);

      undo = [];
      redo = [];
      known = incoming;
      show("地形データが更新されました。地形操作履歴をリセットしました。");
    }

    updateFields();
  });

  updateFields();
  show("地形編集モードを有効にして描画してください。");

  return {
    resetHistory() {
      // 切换场景时清理上一张地图的撤销、重做记录。
      if (stroke) {
        finish({ pointerId: stroke.pointerId }, true);
      }

      undo = [];
      redo = [];
      known = JSON.stringify(getTerrain());

      editing.checked = false;
      svg.classList.remove("terrain-editing");

      updateFields();
      environmentController.refresh();
      show("作戦を切り替えました。地形操作履歴をリセットしました。");
    },

    destroy() {

      if (stroke) finish({ pointerId: stroke.pointerId }, true);
      unsubscribe();

      disclosure.removeEventListener("toggle", handleDisclosureToggle);
      svg.classList.remove("terrain-editing");

      svg.removeEventListener("pointerdown", down, true);
      svg.removeEventListener("pointermove", move, true);
      svg.removeEventListener("pointerup", up, true);
      svg.removeEventListener("pointercancel", cancel, true);
      svg.removeEventListener("lostpointercapture", lost, true);
      svg.removeEventListener("click", click, true);
    }
  };
}
