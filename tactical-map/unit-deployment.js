// ===== 单位拖放部署 =====
// 拖动期间仅预览，松开后校验并一次性提交。
// 界面文案使用日文，注释使用中文。

export function mountUnitDeployment({
  svg,
  editorContainer,
  store,
  spatialState,
  pickPlacement,
  previewUnit,
  clearPreview,
  selectUnit
}) {
  let drag = null;
  let blockClickUntil = 0;

  const status = document.createElement("p");
  status.className = "deployment-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  svg.parentElement.append(status);

  function show(text, error = false) {
    status.textContent = text;
    status.hidden = !text;
    status.classList.toggle("error", error);
  }

  function findUnit(instanceId) {
    return store.getAll().find(
      unit => unit.instanceId === instanceId
    );
  }

  function insideMap(event) {
    const rect = svg.getBoundingClientRect();

    return (
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    );
  }

  function normalizeHeading(value) {
    return ((value % 360) + 360) % 360;
  }

  function release(pointerId) {
    if (svg.hasPointerCapture(pointerId)) {
      svg.releasePointerCapture(pointerId);
    }
  }

  function paintPreview(event) {
    if (!drag) return;

    drag.lastEvent = {
      clientX: event.clientX,
      clientY: event.clientY
    };

    if (!insideMap(event)) {
      drag.candidate = null;
      clearPreview();
      show("地図上にドラッグして配置してください。");
      return;
    }

    const point = pickPlacement(event, drag.unit);

    if (!point) {
      drag.candidate = null;
      clearPreview();
      show("この位置には配置できません。", true);
      return;
    }

    const candidate = {
      ...drag.unit,
      x: point.x,
      y: point.y,
      heading: drag.heading
    };

    const spatial = spatialState(candidate);

    drag.candidate = candidate;
    drag.spatial = spatial;

    previewUnit(candidate, spatial);

    show(
      spatial.valid
        ? `配置可能 · 方位 ${drag.heading.toFixed(0)}° · ホイールで方位を変更`
        : spatial.reason,
      !spatial.valid
    );
  }

  function cancelDrag(text = "") {
    if (!drag) return;

    const current = drag;
    drag = null;

    clearPreview();
    svg.classList.remove("unit-deploying");
    release(current.pointerId);

    if (current.moved) {
      blockClickUntil = performance.now() + 400;
    }

    show(text);
  }

  function down(event) {
    if (event.button !== 0 || drag) return;
    if (!(event.target instanceof Element)) return;

    // 地形模式优先，不能同时部署单位。
    if (svg.classList.contains("terrain-editing")) return;

    const handle = event.target.closest(
      "[data-deploy-instance-id]"
    );

    const mapUnit = event.target.closest(
      ".unit[data-instance-id]"
    );

    let instanceId = "";
    let fromList = false;

    if (handle && editorContainer.contains(handle)) {
      instanceId = handle.dataset.deployInstanceId;
      fromList = true;
    } else if (mapUnit && svg.contains(mapUnit)) {
      instanceId = mapUnit.dataset.instanceId;
    } else {
      return;
    }

    if (store.isRecoveryBlocked()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      show("保存データを復元してから配置してください。", true);
      return;
    }

    const unit = findUnit(instanceId);
    if (!unit) return;

    // 列表手柄不启动原生文本选择或按钮点击。
    // 地图单位则保留轻点选择行为。
    if (fromList) event.preventDefault();
    event.stopImmediatePropagation();

    drag = {
      pointerId: event.pointerId,
      unit,
      heading: unit.heading,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      candidate: null,
      spatial: null,
      lastEvent: null
    };

    try {
      svg.setPointerCapture(event.pointerId);
    } catch (error) {
      drag = null;
      show("ドラッグを開始できませんでした。", true);
      console.error(error);
    }
  }

  function move(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;

    const distance = Math.hypot(
      event.clientX - drag.startX,
      event.clientY - drag.startY
    );

    // 轻微抖动仍按点击处理。
    if (!drag.moved && distance < 4) return;

    drag.moved = true;

    event.preventDefault();
    event.stopImmediatePropagation();

    svg.classList.add("unit-deploying");
    paintPreview(event);
  }

  function up(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;

    const current = drag;

    if (!current.moved) {
      drag = null;
      release(current.pointerId);

      // 轻点仍然选中单位，不提交位置。
      selectUnit(current.unit.instanceId);
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    // 按最终松开的位置重新校验。
    paintPreview(event);

    const candidate = current.candidate;
    const spatial = current.spatial;

    // 在存储提交前结束拖动，避免订阅通知取消自身操作。
    drag = null;
    clearPreview();
    svg.classList.remove("unit-deploying");
    blockClickUntil = performance.now() + 400;
    release(current.pointerId);

    if (!candidate || !spatial?.valid) {
      show(
        candidate
          ? spatial.reason
          : "配置を取り消しました。地図上で離してください。",
        true
      );
      return;
    }

    try {
      store.updateUnit(candidate.instanceId, {
        x: candidate.x,
        y: candidate.y,
        heading: candidate.heading
      });

      selectUnit(candidate.instanceId);

      show(
        "配置を保存しました。" +
        (store.getStorageWarning()
          ? ` ${store.getStorageWarning()}`
          : "")
      );
    } catch (error) {
      show(error.message, true);
      console.error(error);
    }
  }

  function pointerCancel(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    cancelDrag("配置を取り消しました。");
  }

  function lostCapture(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    cancelDrag("配置を取り消しました。");
  }

  function wheel(event) {
    if (svg.classList.contains("terrain-editing")) return;
    if (event.deltaY === 0) return;

    const step = event.shiftKey ? 1 : 5;
    const change = event.deltaY < 0 ? step : -step;

    if (drag) {
      event.preventDefault();
      event.stopImmediatePropagation();

      drag.heading = normalizeHeading(drag.heading + change);

      if (drag.moved && drag.lastEvent) {
        paintPreview(drag.lastEvent);
      }

      return;
    }

    if (!(event.target instanceof Element)) return;

    const element = event.target.closest(
      ".unit.selected[data-instance-id]"
    );

    if (!element || !svg.contains(element)) return;

    const unit = findUnit(element.dataset.instanceId);
    if (!unit) return;

    // 已选中单位上的滚轮只调整方向，不缩放地图。
    event.preventDefault();
    event.stopImmediatePropagation();

    try {
      const heading = normalizeHeading(unit.heading + change);

      store.updateUnit(unit.instanceId, { heading });

      show(
        `方位を ${heading.toFixed(0)}° に変更しました。` +
        (store.getStorageWarning()
          ? ` ${store.getStorageWarning()}`
          : "")
      );
    } catch (error) {
      show(error.message, true);
      console.error(error);
    }
  }

  function click(event) {
    if (performance.now() >= blockClickUntil) return;

    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function keydown(event) {
    if (event.key !== "Escape" || !drag) return;

    event.preventDefault();
    cancelDrag("配置を取り消しました。");
  }

  // 捕获阶段先处理单位拖动，避免启动地图平移。
  svg.addEventListener("pointerdown", down, true);
  editorContainer.addEventListener("pointerdown", down, true);

  // 列表中开始的拖动也捕获到 SVG 上。
  svg.addEventListener("pointermove", move, true);
  svg.addEventListener("pointerup", up, true);
  svg.addEventListener("pointercancel", pointerCancel, true);
  svg.addEventListener("lostpointercapture", lostCapture, true);

  svg.addEventListener("click", click, true);

  // 拖动期间无论鼠标位于地图还是面板，滚轮都调整方向。
  document.addEventListener("wheel", wheel, {
    capture: true,
    passive: false
  });

  document.addEventListener("keydown", keydown);

  // 外部场景更新时取消旧预览，避免提交过期单位数据。
  const unsubscribe = store.subscribe(() => {
    if (drag) {
      cancelDrag("作戦状態が更新されたため、配置を取り消しました。");
    }
  });

  return {
    destroy() {
      cancelDrag();
      unsubscribe();

      svg.removeEventListener("pointerdown", down, true);
      editorContainer.removeEventListener("pointerdown", down, true);
      svg.removeEventListener("pointermove", move, true);
      svg.removeEventListener("pointerup", up, true);
      svg.removeEventListener("pointercancel", pointerCancel, true);
      svg.removeEventListener("lostpointercapture", lostCapture, true);
      svg.removeEventListener("click", click, true);

      document.removeEventListener("wheel", wheel, true);
      document.removeEventListener("keydown", keydown);

      status.remove();
      clearPreview();
    }
  };
}
