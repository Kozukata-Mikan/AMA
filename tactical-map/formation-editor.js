import {
  formationMembers,
  formationCenter,
  normalizeFormation,
  validateFormationMembers,
} from "./formation-layout.js";

export function mountFormationEditor(store, parent) {
  const element = (tag, text = "") => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  };
  const style = element("link");
  style.rel = "stylesheet";
  style.href = new URL("./formation-editor.css", import.meta.url).href;
  document.head.append(style);
  const panel = element("details");
  panel.append(element("summary", "編隊陣形"));
  const select = element("select");
  select.setAttribute("aria-label", "陣形を編集する編隊");
  const open = element("button", "編隊陣形を編集");
  open.type = "button";
  const message = element("p");
  message.className = "note";
  message.setAttribute("role", "status");
  panel.append(select, open, message);
  parent.prepend(panel);
  const dialog = element("dialog");
  dialog.className = "formation-dialog";
  dialog.setAttribute("aria-label", "編隊陣形");
  const header = element("header");
  const title = element("h2", "編隊陣形");
  const close = element("button", "閉じる");
  close.type = "button";
  header.append(title, close);
  const workspace = element("div");
  workspace.className = "formation-editor-workspace";
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "-14 -14 28 28");
  svg.setAttribute("aria-label", "直径25マスの陣形編集円");
  const info = element("div");
  info.className = "formation-editor-info";
  workspace.append(svg, info);
  const membersBar = element("div");
  membersBar.className = "formation-editor-members";
  const actions = element("div");
  actions.className = "formation-editor-actions";
  const overview = element("input");
  overview.type = "checkbox";
  const overviewLabel = element("label");
  overviewLabel.append(overview, element("span", "編隊名・円で表示"));
  const apply = element("button", "陣形を適用");
  apply.type = "button";
  const reset = element("button", "円内へ均等配置");
  reset.type = "button";
  actions.append(overviewLabel, reset, apply);
  const status = element("p");
  status.className = "formation-editor-status";
  status.setAttribute("role", "status");
  dialog.append(header, workspace, membersBar, actions, status);
  document.body.append(dialog);
  let draft = [],
    members = [],
    selected = null,
    groupId = null,
    revision = null,
    drag = null;
  let applying = false;
  const scene = () => store.getSceneSnapshot();
  function eligibleGroups() {
    const current = scene();
    return current.groups.filter((group) => {
      const units = formationMembers(current, group.id);
      return (
        !group.observationForeign &&
        units.length &&
        units.every(
          (unit) =>
            unit.branch === "navy" &&
            (unit.observationOwn === undefined || unit.observationOwn),
        )
      );
    });
  }
  function sync() {
    const old = select.value;
    select.replaceChildren();
    for (const group of eligibleGroups())
      select.append(new Option(group.name, group.id));
    if ([...select.options].some((option) => option.value === old))
      select.value = old;
    open.disabled = !select.options.length;
    if (
      dialog.open &&
      !applying &&
      ((scene().revision ?? scene().updatedAt) !== revision ||
        !eligibleGroups().some((group) => group.id === groupId))
    ) {
      dialog.close();
      message.textContent = "状態が更新されました。陣形を開き直してください。";
    }
  }
  function showInfo() {
    const unit = members.find((item) => item.instanceId === selected);
    if (!unit) {
      info.textContent = "艦船を選択してください。";
      return;
    }
    const point = draft.find((item) => item.id === selected);
    const naval = unit.snapshot?.naval;
    info.textContent = [
      unit.name,
      `耐性 ${unit.currentHp} / ${unit.snapshot?.maxHp ?? "—"}`,
      `状態 ${{ intact: "無傷", minor: "軽微", light: "小破", moderate: "中破", heavy: "大破", sinking: "沈没寸前", sunk: "沈没" }[unit.shipState?.status] ?? "配置中"}`,
      `速力 ${naval?.speedKnots ?? "—"} kn`,
      `艦種 ${naval?.type ?? "—"} / 装甲 ${naval?.armor ?? "—"}`,
      `陣形位置 X ${point.x.toFixed(2)} / Y ${point.y.toFixed(2)}`,
      ...(unit.equipmentState?.groups?.map(
        (group) =>
          `${unit.snapshot?.equipmentSnapshots?.find((item) => item.id === group.equipmentId)?.name ?? group.position} / 残弾 ${group.remainingAmmo ?? "—"}${group.damaged ? " / 損傷" : ""}`,
      ) ?? []),
    ].join("\n");
  }
  function draw() {
    svg.replaceChildren();
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("r", "12.5");
    circle.setAttribute("fill", "#132d40");
    circle.setAttribute("stroke", "#81c9f2");
    circle.setAttribute("stroke-width", ".12");
    svg.append(circle);
    for (const point of draft) {
      const icon = document.createElementNS(ns, "g");
      icon.setAttribute("data-ship", point.id);
      icon.setAttribute("transform", `translate(${point.x} ${point.y})`);
      icon.setAttribute("tabindex", "0");
      icon.setAttribute("role", "button");
      const unit = members.find((item) => item.instanceId === point.id);
      icon.setAttribute("aria-label", unit.name);
      const body = document.createElementNS(ns, "path");
      body.setAttribute("d", "M 0,-.8 L .38,.35 L 0,.65 L -.38,.35 Z");
      body.setAttribute("fill", selected === point.id ? "#ffd27b" : "#a8d8f7");
      icon.append(body);
      icon.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        selected = point.id;
        drag = { id: event.pointerId, ship: point.id };
        svg.setPointerCapture(event.pointerId);
        showInfo();
      });
      icon.addEventListener("keydown", (event) => {
        const offsets = {
          ArrowLeft: [-0.5, 0],
          ArrowRight: [0.5, 0],
          ArrowUp: [0, -0.5],
          ArrowDown: [0, 0.5],
        };
        if (!offsets[event.key]) return;
        event.preventDefault();
        selected = point.id;
        const [dx, dy] = offsets[event.key];
        if (Math.hypot(point.x + dx, point.y + dy) <= 12.5) {
          point.x += dx;
          point.y += dy;
          draw();
          svg.querySelector(`[data-ship="${CSS.escape(point.id)}"]`).focus();
        }
      });
      svg.append(icon);
    }
    showInfo();
  }
  function arrange() {
    draft = members.map((unit, i) => {
      const angle = i * Math.PI * (3 - Math.sqrt(5)),
        radius =
          members.length === 1 ? 0 : 11 * Math.sqrt((i + 0.5) / members.length);
      return {
        id: unit.instanceId,
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
      };
    });
    draw();
  }
  open.addEventListener("click", () => {
    try {
      const current = scene(),
        group = current.groups.find((item) => item.id === select.value);
      groupId = group.id;
      members = formationMembers(current, group.id);
      const center = formationCenter(members, group.formation);
      revision = current.revision ?? current.updatedAt;
      overview.checked = group.formation?.overview ?? true;
      title.textContent = `編隊陣形 / ${group.name}`;
      draft =
        group.formation?.positions.map((point) => ({ ...point })) ??
        members.map((unit) => ({
          id: unit.instanceId,
          x: unit.x - center.x,
          y: unit.y - center.y,
        }));
      selected = members[0].instanceId;
      try {
        const value = normalizeFormation({
          version: 1,
          overview: overview.checked,
          positions: draft,
        });
        validateFormationMembers(members, value);
      } catch {
        arrange();
      }
      membersBar.replaceChildren();
      for (const unit of members) {
        const button = element("button", unit.name);
        button.type = "button";
        button.addEventListener("click", () => {
          selected = unit.instanceId;
          draw();
        });
        membersBar.append(button);
      }
      status.textContent =
        current.mode === "simulation"
          ? "ドラッグまたは矢印キーで配置。適用すると移動計画を登録し、移動処理後に反映します。"
          : "ドラッグまたは矢印キーで配置。適用すると地図の配置を更新します。";
      draw();
      dialog.showModal();
    } catch (error) {
      message.textContent = error.message;
    }
  });
  svg.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      svg.getScreenCTM().inverse(),
    );
    const point = draft.find((item) => item.id === drag.ship);
    const length = Math.hypot(p.x, p.y),
      factor = length > 12.5 ? 12.5 / length : 1;
    point.x = p.x * factor;
    point.y = p.y * factor;
    draw();
  });
  const stop = () => {
    if (drag && svg.hasPointerCapture(drag.id))
      svg.releasePointerCapture(drag.id);
    drag = null;
  };
  svg.addEventListener("pointerup", stop);
  svg.addEventListener("pointercancel", stop);
  reset.addEventListener("click", arrange);
  close.addEventListener("click", () => dialog.close());
  apply.addEventListener("click", async () => {
    apply.disabled = true;
    applying = true;
    try {
      await store.saveFormation(groupId, {
        version: 1,
        overview: overview.checked,
        positions: draft,
      });
      dialog.close();
      message.textContent = "陣形を保存しました。";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      apply.disabled = false;
      applying = false;
      sync();
    }
  });
  const unsubscribe = store.subscribe(sync);
  sync();
  return () => {
    unsubscribe();
    dialog.remove();
    panel.remove();
    style.remove();
  };
}
