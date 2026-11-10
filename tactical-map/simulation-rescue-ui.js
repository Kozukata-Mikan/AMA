import {
  EQUIPMENT_HIT_ITEMS
} from "./equipment-damage-runtime.js";


export function mountRescueUI(store) {
  const aside = document.querySelector("aside");

  function element(tag, text = "") {
    const result = document.createElement(tag);
    result.textContent = text;
    return result;
  }

  const panel = element("details");
  panel.append(element("summary", "艦船救助"));

  const rescuer = element("select");
  const target = element("select");

  const rescuerLabel = element("label");
  rescuerLabel.append(element("span", "救助する艦船"), rescuer);

  const targetLabel = element("label");
  targetLabel.append(element("span", "救助される艦船"), target);

  const note = element("p",
    "移動段階で計画を提出します。移動処理後の距離が2以下なら開始します。" +
    "開始ラウンドが第1ラウンドです。救助中は両艦が行動できません。"
  );
  note.className = "note";

  const message = element("p");
  message.className = "note";
  message.setAttribute("aria-live", "polite");

  const tasks = element("div");

  function run(action) {
    try {
      action();
    } catch (error) {
      console.error(error);
      message.textContent = error.message;
    }
  }

  const save = element("button", "救助計画を保存");
  save.type = "button";
  save.addEventListener("click", () => run(() => {
    if (!rescuer.value || !target.value) {
      throw new Error("救助艦と救助対象を選択してください。");
    }

    store.planRescue(rescuer.value, target.value);

    message.textContent =
      "救助計画を保存しました。開始条件は移動処理後に確認します。";
  }));

  const cancel = element("button", "救助計画を取消");
  cancel.type = "button";
  cancel.addEventListener("click", () => run(() => {
    if (!rescuer.value) {
      throw new Error("救助艦を選択してください。");
    }

    store.cancelRescuePlan(rescuer.value);
    message.textContent = "救助計画を取り消しました。";
  }));

  const buttons = element("div");
  buttons.className = "buttons";
  buttons.append(save, cancel);

  panel.append(
    rescuerLabel,
    targetLabel,
    note,
    buttons,
    message,
    tasks
  );

  aside.append(panel);

  function refill(control, units) {
    const previous = control.value;

    control.replaceChildren(new Option("選択してください", ""));

    for (const unit of units) {
      control.append(new Option(unit.name, unit.instanceId));
    }

    if ([...control.options].some(option => option.value === previous)) {
      control.value = previous;
    }
  }

  function sync() {
    const scene = store.getScene();
    const side = scene.controls.observationSide;

    refill(rescuer, scene.instances.filter(unit =>
      unit.side === side &&
      unit.branch === "navy" &&
      !["sinking", "sunk"].includes(unit.shipState.status) &&
      unit.shipState.rescueTaskId === null
    ));

    refill(target, scene.instances.filter(unit =>
      unit.branch === "navy" &&
      unit.observationLevel === "identified" &&
      unit.rescueCandidate === true
    ));


    save.disabled = cancel.disabled =
      scene.turn.phaseId !== "movement";

    tasks.replaceChildren();

    const names = new Map(
      scene.instances
        .filter(unit => unit.observationLevel === "identified")
        .map(unit => [unit.instanceId, unit.name])
    );

    for (const plan of scene.rescuePlans ?? []) {
      const p = element("p",
        "計画：" +
        `${names.get(plan.rescuerId) ?? "艦船"} → ` +
        `${names.get(plan.targetId) ?? "未識別の対象"}`
      );
      p.className = "note";
      tasks.append(p);
    }

    for (const task of scene.rescueTasks ?? []) {
      const state = {
        active: "救助中",
        success: "救助成功",
        failure: "救助失敗",
        interrupted: "救助中断"
      }[task.status] ?? "不明な救助状態";

      const elapsed = scene.turn.number - task.startedTurn + 1;


      const p = element("p",
        `${state}：` +
        `${names.get(task.rescuerId) ?? "艦船"} → ` +
        `${names.get(task.targetId) ?? "未識別の対象"}` +
        (task.status === "active"
          ? ` / 救助第${elapsed}ラウンド`
          : Number.isInteger(task.resolvedTurn)
            ? ` / 結果確定：ラウンド${task.resolvedTurn}`
            : "")

      );

      p.className = "note";
      tasks.append(p);
    }
  }

  store.subscribe(sync);
  sync();
}
