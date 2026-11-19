import { formationMembers } from "./formation-layout.js?v=fleet-cohesion-6";
export function mountFormationAttackUI(store, parent) {
  const element = (tag, text = "") => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  };
  const panel = element("details");
  panel.append(element("summary", "編隊一括攻撃"));
  const actor = element("select");
  actor.setAttribute("aria-label", "攻撃する編隊");
  const kind = element("select");
  kind.setAttribute("aria-label", "目標の種類");
  kind.append(new Option("単艦", "unit"), new Option("編隊", "group"));
  const target = element("select");
  target.setAttribute("aria-label", "編隊攻撃の目標");
  const save = element("button", "編隊攻撃計画を保存");
  save.type = "button";
  const output = element("p");
  output.className = "note";
  output.setAttribute("role", "status");
  function label(text, input) {
    const node = element("label");
    node.append(element("span", text), input);
    return node;
  }
  panel.append(
    label("攻撃編隊", actor),
    label("目標の種類", kind),
    label("目標", target),
    save,
    element(
      "p",
      "使用可能な単体武器を一括登録します。編隊目標は識別済みの艦から無作為に選び、射距・射界を再確認します。範囲専用武器は従来の攻撃欄で指定してください。",
    ),
    output,
  );
  parent.append(panel);
  function fill(select, options) {
    const old = select.value;
    select.replaceChildren();
    for (const [name, id] of options) select.append(new Option(name, id));
    if ([...select.options].some((option) => option.value === old))
      select.value = old;
  }
  function sync() {
    const scene = store.getSceneSnapshot(),
      side = scene.controls.observationSide;
    fill(
      actor,
      scene.groups
        .filter(
          (group) =>
            !group.observationForeign &&
            formationMembers(scene, group.id).some(
              (unit) => unit.observationOwn && unit.branch === "navy",
            ),
        )
        .map((group) => [group.name, group.id]),
    );
    const targets = scene.instances.filter(
      (unit) =>
        unit.side !== side &&
        unit.observationLevel === "identified" &&
        unit.branch === "navy" &&
        unit.shipState?.status !== "sunk",
    );
    fill(
      target,
      kind.value === "unit"
        ? targets.map((unit) => [unit.name, unit.instanceId])
        : scene.groups
            .filter((group) =>
              formationMembers(scene, group.id).some((unit) =>
                targets.includes(unit),
              ),
            )
            .map((group) => [group.name, group.id]),
    );
    save.disabled =
      !actor.value ||
      !target.value ||
      !/^(order-[1-5]|pas)$/.test(scene.turn.phaseId) ||
      store.getSimulationStatus().ended;
  }
  kind.addEventListener("change", sync);
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      const result = await store.saveFormationAttack(
        {
          groupId: actor.value,
          targetRef: { kind: kind.value, id: target.value },
        },
        store.getSceneSnapshot().revision,
      );
      output.textContent = result.message;
    } catch (error) {
      output.textContent = error.message;
    } finally {
      sync();
    }
  });
  const selectFormation = (event) => {
    if ([...actor.options].some((option) => option.value === event.detail))
      actor.value = event.detail;
    else {
      kind.value = "group";
      sync();
      if ([...target.options].some((option) => option.value === event.detail))
        target.value = event.detail;
    }
  };
  document.addEventListener("formation-select", selectFormation);
  const unsubscribe = store.subscribe(sync);
  sync();
  return () => {
    unsubscribe();
    document.removeEventListener("formation-select", selectFormation);
    panel.remove();
  };
}
