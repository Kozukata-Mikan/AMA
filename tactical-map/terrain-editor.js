import {forkTerrainForEditing, MAX_TERRAIN_SAMPLES} from "./terrain-data.js";
import {applyTerrainFrame} from "./terrain-edit-history.js";
import {createTerrainStrokeSession} from "./terrain-stroke-session.js?v=support-stations-1";
import {mountTerrainGenerator} from './terrain-generator-panel.js?v=support-stations-1';
import {runBackgroundTask} from "./background-client.js?v=support-stations-1";

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

  const width = field(sizeSection, "幅（120～7200）", numberInput(600));
  const height = field(sizeSection, "高さ（120～7200）", numberInput(600));
  for (const control of [width, height]) {
    control.min = "120";
    control.max = "7200";
  }
  const cols = field(sizeSection, "列数（9～7201）", numberInput(81));
  const rows = field(sizeSection, "行数（9～7201）", numberInput(81));
  for (const control of [cols, rows]) {
    control.min = "9"; control.max = String(MAX_TERRAIN_SAMPLES); control.step = "1";
  }
  sizeSection.append(node("p", "格子ごとの編集には、列数＝幅＋1・行数＝高さ＋1を指定します。拡大すると詳細が表示されます。", "editor-note"));
  const interval = field(sizeSection, "等高線間隔（5～100）", numberInput(6));

  const actions = node("div", "", "editor-actions");
  const historyActions = node("div", "", "editor-actions");

  container.append(sizeSection, historyActions, status);
  sizeSection.append(actions);

  let undo = [];
  let redo = [];
  let stroke = null;
  let frame = null;
  let known = getTerrain();
  let saving = false;
  let finishing = false;

  const environmentController = mountEnvironmentEditor({
    container,
    svg,
    store,

    canApply() {
      return stroke === null && !finishing;
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

    result.addEventListener("click", async () => {
      try {
        if (stroke || finishing) throw new Error("描画・計算が完了してから操作してください。");
        await action();
      } catch (error) {
        show(error.message, true);
      }
    });

    parent.append(result);
    return result;
  }

  async function saveTerrain(next, before, historyFrame) {
    if (store.getSceneSnapshot().terrain !== before) throw new Error("描画中に地形が更新されました。今回の描画は保存していません。");
    known = next;
    try {
      saving = true;
      await store.setTerrain(next);
      known = store.getSceneSnapshot().terrain;
    } catch (error) {
      known = store.getSceneSnapshot().terrain;
      previewTerrain(known);
      throw error;
    } finally { saving = false; }
    undo.push(historyFrame.kind === 'replace' ? {...historyFrame, after:known} : historyFrame);
    if (undo.length > 20) undo.shift();
    redo = [];
    updateFields();
    show("地形を保存し、配置条件を再検証しました。");
  }

  addButton(actions, "サイズと等高線間隔を適用", async () => {
    if (!confirm("地図サイズとグリッドを変更しますか？ユニット座標は変更されません。範囲外の地形は切り取られ、新しい範囲は海域になります。")) return;
    const before = store.getSceneSnapshot().terrain;
    finishing = true;
    try {
      const resized = await runBackgroundTask('terrain-resize', {source:before, settings:{
        width:Number(width.value),height:Number(height.value),cols:Number(cols.value),rows:Number(rows.value),contourInterval:Number(interval.value)
      }});
      const next = forkTerrainForEditing(resized);
      await saveTerrain(next,before,{kind:'replace',before,after:next});
    } finally { finishing = false; }
  });

  async function restoreHistory(forward) {
    const source = forward ? redo : undo, destination = forward ? undo : redo;
    if (!source.length) {show(forward ? "やり直せる地形操作はありません。" : "元に戻せる地形操作はありません。");return;}
    const current=store.getSceneSnapshot().terrain, entry=source.at(-1);
    const next=applyTerrainFrame(current,entry,forward);
    finishing=true;saving=true;
    try {
      await store.setTerrain(next);
      known=store.getSceneSnapshot().terrain;
      source.pop();destination.push(entry);
      updateFields();show(forward?"地形操作をやり直しました。":"地形操作を元に戻しました。");
    } catch(error) {known=store.getSceneSnapshot().terrain;previewTerrain(known);throw error;}
    finally {saving=false;finishing=false;}
  }
  addButton(historyActions,"地形を元に戻す",()=>restoreHistory(false));
  addButton(historyActions,"地形をやり直す",()=>restoreHistory(true));

  const generatorController = mountTerrainGenerator({
    container, store,
    canAct:()=>!stroke&&!finishing&&!store.isSaving()&&!store.isRecoveryBlocked(),
    setBusy:value=>{finishing=value},
    async saveGenerated(next,before){
      await saveTerrain(next,before,{kind:'replace',before,after:next});
      previewTerrain(store.getSceneSnapshot().terrain);
    }
  });

  function schedulePreview() {
    if (frame !== null) return;

    frame = requestAnimationFrame(() => {
      frame = null;
      if (stroke) previewTerrain(stroke.working);
    });
  }

  async function paint(event) {
    const active=stroke, point=pickPoint(event);
    if(!active || !point)return;
    const start=active.last??point, distance=Math.hypot(point.x-start.x,point.y-start.y);
    const steps=Math.max(1,Math.ceil(distance/Math.max(3,active.brush.radius/3)));
    const points=[];
    for(let index=1;index<=steps;index++)points.push({x:start.x+(point.x-start.x)*index/steps,y:start.y+(point.y-start.y)*index/steps});
    active.last=point;active.changed=true;
    await active.session.enqueue(points);
    if(stroke===active)schedulePreview();
  }

  function release(pointerId) {
    if (svg.hasPointerCapture(pointerId)) {
      svg.releasePointerCapture(pointerId);
    }
  }

  async function finish(event, cancel = false) {
    if (!stroke || stroke.pointerId !== event.pointerId) return;
    const completed=stroke;stroke=null;finishing=true;
    if(frame!==null){cancelAnimationFrame(frame);frame=null;}
    release(event.pointerId);
    try {
      if(cancel || !completed.changed){
        await completed.session.cancel();previewTerrain(store.getSceneSnapshot().terrain);
        show("地形描画を取り消しました。");
      } else {
        const result=await completed.session.finish();
        if(result.frame.changes.length)await saveTerrain(result.terrain,completed.before,result.frame);
        else {previewTerrain(store.getSceneSnapshot().terrain);show("地形を保存しました（変更なし）。");}
      }
    } catch(error) {
      await completed.session.cancel().catch(()=>{});
      previewTerrain(store.getSceneSnapshot().terrain);show(error.message,true);
    } finally {finishing=false;}
  }

  async function down(event) {
    if(!editing.checked || event.button!==0 || stroke)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(finishing || store.isSaving()){show("計算・保存中です。完了してから次の描画を開始してください。",true);return;}
    if(store.isRecoveryBlocked()){show("保存データを復元してから編集してください。",true);return;}
    try {
      const before=store.getSceneSnapshot().terrain;
      const brush={mode:mode.value,radius:Number(radius.value),strength:Number(strength.value),target:Number(target.value)};
      const session=createTerrainStrokeSession(before,brush);
      stroke={pointerId:event.pointerId,before,working:session.working,session,brush,last:null,changed:false};
      svg.setPointerCapture(event.pointerId);
      await paint(event);
    } catch(error) {await finish(event,true);show(error.message,true);}
  }

  async function move(event) {
    if (!stroke || stroke.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    try {
      await paint(event);
    } catch (error) {
      await finish(event, true);
      show(error.message, true);
    }
  }

  async function up(event) {
    if (!stroke || stroke.pointerId !== event.pointerId) return;
    event.stopImmediatePropagation();
    await finish(event);
  }

  async function cancel(event) {
    await finish(event, true);
  }

  async function lost(event) {
    // 正常松开时 stroke 已经清空；意外失去捕获时取消操作。
    await finish(event, true);
  }

  function click(event) {
    if (!editing.checked) return;
    event.stopImmediatePropagation();
  }

  editing.addEventListener("change", async () => {
    if (stroke) await finish({ pointerId: stroke.pointerId }, true);
    svg.classList.toggle("terrain-editing", editing.checked);
  });
  
    async function handleDisclosureToggle() {
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
      await finish({ pointerId: stroke.pointerId }, true);
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

  const unsubscribe = store.subscribe(async () => {
    const incoming = store.getSceneSnapshot().terrain;

    // 另一页面修改地形或导入场景时，不能重做旧地图上的操作。
    if (!saving && incoming !== known) {
      if (stroke) await finish({ pointerId: stroke.pointerId }, true);

      generatorController.invalidate();
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
    canChangeDisplay:()=>stroke===null&&!finishing,
    async resetHistory() {
      generatorController.invalidate();
      // 切换场景时清理上一张地图的撤销、重做记录。
      if (stroke) {
        await finish({ pointerId: stroke.pointerId }, true);
      }

      undo = [];
      redo = [];
      known = getTerrain();

      editing.checked = false;
      svg.classList.remove("terrain-editing");

      updateFields();
      environmentController.refresh();
      show("作戦を切り替えました。地形操作履歴をリセットしました。");
    },

    async destroy() {

      generatorController.destroy();
      environmentController.destroy();

      if (stroke) await finish({ pointerId: stroke.pointerId }, true);
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
