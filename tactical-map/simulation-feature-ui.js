export function mountSimulationFeatures(store, context) {
  const {
    svg, viewport, view, project, screenPoint
  } = context;

  const NS = "http://www.w3.org/2000/svg";
  const aside = document.querySelector("aside");

  function element(tag, text = "") {
    const result = document.createElement(tag);
    result.textContent = text;
    return result;
  }

  function svgElement(tag, attributes, parent) {
    const result = document.createElementNS(NS, tag);

    for (const [key, value] of Object.entries(attributes)) {
      result.setAttribute(key, value);
    }

    parent.append(result);
    return result;
  }

  const panel = element("details");
  panel.open = true;
  panel.append(element("summary", "観察陣営・艦船移動"));

  const side = element("select");
  side.append(
    new Option("味方", "ally"),
    new Option("敵", "enemy"),
    new Option("中立", "neutral")
  );

  const sideLabel = element("label");
  sideLabel.append(element("span", "観察陣営"), side);

  const actor = element("select");
  const actorLabel = element("label");
  actorLabel.append(element("span", "移動する艦船・編隊"), actor);

  const x = element("input");
  const y = element("input");
  x.type = y.type = "number";
  x.step = y.step = "any";

  const xLabel = element("label");
  xLabel.append(element("span", "移動先 X"), x);

  const yLabel = element("label");
  yLabel.append(element("span", "移動先 Y"), y);

  const status = element("p");
  status.className = "note";
  status.setAttribute("aria-live", "polite");

  const buttons = element("div");
  buttons.className = "buttons";

  function run(action) {
    try {
      action();
    } catch (error) {
      console.error(error);
      status.textContent = error.message;
    }
  }

  function addButton(text, action) {
    const result = element("button", text);
    result.type = "button";
    result.addEventListener("click", () => run(action));
    buttons.append(result);
    return result;
  }

  function ref() {
    if (!actor.value) {
      throw new Error("移動する艦船または編隊を選択してください。");
    }
    return JSON.parse(actor.value);
  }

  const begin = addButton("移動段階へ", () => {
    store.beginMovement();
    status.textContent = "移動段階を開始しました。時刻は変更していません。";
  });

  const save = addButton("移動計画を保存", () => {
    if (x.value.trim() === "" || y.value.trim() === "") {
      throw new Error("移動先のXとYを入力してください。");
    }

    store.planMovement(ref(), Number(x.value), Number(y.value));
    status.textContent = "移動計画を保存しました。位置と航続距離はまだ変更していません。";
  });

  const cancel = addButton("計画を取消", () => {
    store.cancelMovement(ref());
    status.textContent = "選択した移動計画を取り消しました。";
  });

  const resolve = addButton("全陣営の移動を処理", () => {
    if (!confirm(
      "全陣営の移動計画をまとめて処理しますか？" +
      "計画のない艦船は待機します。"
    )) return;

    store.resolveMovement();

    status.textContent =
      "移動を処理し、次序5へ進みました。" +
      "武器処理は未接続のため、これ以降は自動進行しません。";
  });

  panel.append(
    sideLabel,
    actorLabel,
    xLabel,
    yLabel,
    buttons,
    element(
      "p",
      "移動段階では自陣営の艦船をドラッグできます。" +
      "編隊移動は選択欄から指定してください。" +
      "円は距離上限であり、全地点への通行成功を保証しません。"
    ),
    status
  );

  aside.prepend(panel);

  const layer = svgElement("g", {
    id: "movementFeatureLayer",
    "pointer-events": "none",
    "aria-hidden": "true"
  }, viewport);

  viewport.insertBefore(layer, document.getElementById("unitLayer"));

  function drawRange() {
    layer.replaceChildren();

    if (!actor.value) return;

    try {
      const info = store.getMovementInfo(ref());
      const points = [];

      for (let index = 0; index <= 96; index++) {
        const angle = index * Math.PI * 2 / 96;
        const point = project(
          info.x + Math.cos(angle) * info.limit,
          info.y + Math.sin(angle) * info.limit,
          0
        );
        points.push(`${point.x},${point.y}`);
      }

      svgElement("polygon", {
        points: points.join(" "),
        fill: "#70b7ff",
        "fill-opacity": 0.08,
        stroke: "#70b7ff",
        "stroke-width": 1.5,
        "vector-effect": "non-scaling-stroke"
      }, layer);

      const scene = store.getScene();

      for (const plan of scene.movementPlans) {
        for (const destination of plan.destinations) {
          const from = project(destination.fromX, destination.fromY, 0);
          const to = project(destination.x, destination.y, 0);

          svgElement("line", {
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y,
            stroke: "#f6d65b",
            "stroke-dasharray": "5 4",
            "stroke-width": 1.5,
            "vector-effect": "non-scaling-stroke"
          }, layer);

          svgElement("circle", {
            cx: to.x,
            cy: to.y,
            r: 4,
            fill: "none",
            stroke: "#f6d65b",
            "vector-effect": "non-scaling-stroke"
          }, layer);
        }
      }
    } catch {
      // 非移动阶段或没有行动资格时不绘制范围。
    }
  }

  function sync() {
    const scene = store.getScene();
    const currentSide = scene.controls.observationSide;
    const previous = actor.value;

    side.value = currentSide;
    side.disabled = scene.controls.enemyAutonomy;

    actor.replaceChildren(new Option("選択してください", ""));

    const ships = scene.instances.filter(unit =>
      unit.side === currentSide &&
      unit.branch === "navy" &&
      !["sinking", "sunk"].includes(unit.shipState?.status) &&
      unit.shipState?.rescueTaskId === null
    );

    for (const unit of ships) {
      actor.append(new Option(
        unit.name,
        JSON.stringify({ kind: "unit", id: unit.instanceId })
      ));
    }

    const allowed = new Set(ships.map(unit => unit.instanceId));

    for (const group of scene.groups) {
      const ids = new Set([group.id]);
      let changed = true;

      while (changed) {
        changed = false;
        for (const child of scene.groups) {
          if (ids.has(child.parentId) && !ids.has(child.id)) {
            ids.add(child.id);
            changed = true;
          }
        }
      }

      const members = scene.instances.filter(unit => ids.has(unit.groupId));

      if (
        members.length &&
        members.every(unit => allowed.has(unit.instanceId))
      ) {
        actor.append(new Option(
          `編隊：${group.name}`,
          JSON.stringify({ kind: "group", id: group.id })
        ));
      }
    }

    if ([...actor.options].some(option => option.value === previous)) {
      actor.value = previous;
    }

    const movement = scene.turn.phaseId === "movement";

    begin.disabled = scene.turn.phaseId !== "start";
    save.disabled = cancel.disabled = !movement;
    resolve.disabled = !movement || scene.controls.enemyAutonomy;

    drawRange();
  }

  side.addEventListener("change", () => run(() => {
    store.setObservationSide(side.value);
    status.textContent = "観察陣営を変更しました。表示情報を再判定しました。";
  }));

  actor.addEventListener("change", () => {
    run(() => {
      const info = store.getMovementInfo(ref());
      x.value = info.x;
      y.value = info.y;
      status.textContent = `最大移動距離：${info.limit}`;
    });
    drawRange();
  });

  let drag = null;
  let suppressClickUntil = 0;

  svg.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;

    const icon = event.target.closest(".unit[data-instance-id]");
    if (!icon) return;

    const scene = store.getScene();
    const unit = scene.instances.find(
      item => item.instanceId === icon.dataset.instanceId
    );

    if (
      scene.turn.phaseId !== "movement" ||
      unit?.branch !== "navy" ||
      unit.side !== scene.controls.observationSide
    ) return;

    try {
      const movementRef = { kind: "unit", id: unit.instanceId };
      const info = store.getMovementInfo(movementRef);
      const point = screenPoint(event);

      actor.value = JSON.stringify(movementRef);
      x.value = info.x;
      y.value = info.y;
      drawRange();

      drag = {
        pointerId: event.pointerId,
        ref: movementRef,
        unitX: info.x,
        unitY: info.y,
        startX: point.x,
        startY: point.y,
        moved: false
      };

      event.preventDefault();
      event.stopImmediatePropagation();
      svg.setPointerCapture(event.pointerId);
    } catch (error) {
      status.textContent = error.message;
    }
  }, true);

  svg.addEventListener("pointermove", event => {
    if (!drag || drag.pointerId !== event.pointerId) return;

    const point = screenPoint(event);
    const screenDX = point.x - drag.startX;
    const screenDY = point.y - drag.startY;

    if (Math.hypot(screenDX, screenDY) > 3) drag.moved = true;

    // 用拖动位移的逆投影，避免舰船高度产生点击位置跳变。
    const projectedDX = screenDX / view.scale;
    const projectedDY = screenDY / view.scale;

    const mapDX = (
      projectedDX / 0.95 + projectedDY / 0.43
    ) / 2;

    const mapDY = (
      projectedDY / 0.43 - projectedDX / 0.95
    ) / 2;

    x.value = (drag.unitX + mapDX).toFixed(6);
    y.value = (drag.unitY + mapDY).toFixed(6);

    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  function endDrag(event, cancelled) {
    if (!drag || drag.pointerId !== event.pointerId) return;

    const current = drag;
    drag = null;

    event.stopImmediatePropagation();

    if (svg.hasPointerCapture(event.pointerId)) {
      svg.releasePointerCapture(event.pointerId);
    }

    if (cancelled || !current.moved) return;

    suppressClickUntil = performance.now() + 400;

    run(() => {
      store.planMovement(
        current.ref,
        Number(x.value),
        Number(y.value)
      );
      status.textContent = "ドラッグした移動計画を保存しました。";
    });
  }

  svg.addEventListener("pointerup", event => endDrag(event, false), true);
  svg.addEventListener("pointercancel", event => endDrag(event, true), true);

  svg.addEventListener("lostpointercapture", () => {
    drag = null;
  });

  svg.addEventListener("click", event => {
    if (performance.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  // 正常点击选中舰船时也同步绘制移动范围。
  svg.addEventListener("click", event => {
    const icon = event.target.closest(".unit[data-instance-id]");
    if (!icon) return;

    const value = JSON.stringify({
      kind: "unit",
      id: icon.dataset.instanceId
    });

    if ([...actor.options].some(option => option.value === value)) {
      actor.value = value;
      drawRange();
    }
  });

  store.subscribe(sync);
  sync();
}
