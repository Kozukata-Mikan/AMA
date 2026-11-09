export function createEquipmentRepairPanel({
  store,
  rescuerId
}) {
  const element = document.createElement("section");
  element.className = "simulation-equipment-repair-panel";

  const title = document.createElement("h3");
  title.textContent = "外部設備修復";

  const targetSelect = document.createElement("select");
  targetSelect.setAttribute("aria-label", "修復対象艦");

  const itemSelect = document.createElement("select");
  itemSelect.setAttribute("aria-label", "修復対象項目");

  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "修復計画を登録";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "任務計画を取消";

  const message = document.createElement("p");
  message.setAttribute("role", "status");

  const description = document.createElement("p");
  description.textContent =
    "移動後に距離2以内で開始します。" +
    "次ラウンドの特殊段階で1項目を判定します。" +
    "双方は任務中、他の行動を実行できません。";

  element.append(
    title,
    description,
    targetSelect,
    itemSelect,
    save,
    cancel,
    message
  );

  let report = null;

  function addOption(select, value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }

  function refreshItems(preferredItem) {
    const target = report?.targets.find(
      item => item.id === targetSelect.value
    );

    itemSelect.replaceChildren();

    for (const item of target?.items ?? []) {
      addOption(itemSelect, item.id, item.label);
    }

    if (
      target?.items.some(item => item.id === preferredItem)
    ) {
      itemSelect.value = preferredItem;
    }

    save.disabled =
      report?.phaseId !== "movement" ||
      !target ||
      !itemSelect.value;
  }

  function refresh() {
    const targetId = targetSelect.value;
    const itemId = itemSelect.value;

    try {
      report = store.getEquipmentRepairOptions(rescuerId);
      targetSelect.replaceChildren();

      for (const target of report.targets) {
        addOption(targetSelect, target.id, target.label);
      }

      if (report.targets.some(target => target.id === targetId)) {
        targetSelect.value = targetId;
      }

      refreshItems(itemId);
      cancel.disabled = report.phaseId !== "movement";
    } catch (error) {
      report = null;
      targetSelect.replaceChildren();
      itemSelect.replaceChildren();
      save.disabled = true;
      cancel.disabled = true;
      message.textContent = error.message;
    }
  }

  targetSelect.addEventListener("change", () => {
    refreshItems();
  });

  save.addEventListener("click", () => {
    try {
      if (!targetSelect.value || !itemSelect.value) {
        throw new Error("修復対象を選択してください。");
      }

      store.planEquipmentRepair(
        rescuerId,
        targetSelect.value,
        itemSelect.value
      );

      message.textContent =
        "修復計画を保存しました。距離は移動後に確認します。";
    } catch (error) {
      message.textContent = error.message;
    }
  });

  cancel.addEventListener("click", () => {
    try {
      store.cancelRescuePlan(rescuerId);
      message.textContent = "任務計画を取り消しました。";
    } catch (error) {
      message.textContent = error.message;
    }
  });

  const unsubscribe = store.subscribe(refresh);
  refresh();

  return {
    element,
    refresh,
    destroy() {
      unsubscribe();
      element.remove();
    }
  };
}
