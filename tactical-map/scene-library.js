// ===== 地图库 =====
// 保存完整场景。切换前先备份当前场景，失败时不切换。
// 界面文案使用日文，注释使用中文。

const DATABASE_NAME = "ama-scene-library";
const DATABASE_VERSION = 1;
const STORE_NAME = "scenes";
const BACKUP_ID = "switch-backup";
const SLOT_COUNT = 20;

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("このブラウザーでは地图库を利用できません。"));
      return;
    }

    const request = indexedDB.open(
      DATABASE_NAME,
      DATABASE_VERSION
    );

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);

    request.onerror = () => {
      reject(request.error ?? new Error("地图库を開けませんでした。"));
    };

    request.onblocked = () => {
      reject(new Error(
        "地图库の更新が停止しています。他のタブを閉じて再試行してください。"
      ));
    };
  });
}

async function databaseOperation(mode, operation) {
  const db = await openDatabase();

  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const objectStore = transaction.objectStore(STORE_NAME);

      let request;

      try {
        request = operation(objectStore);
      } catch (error) {
        transaction.abort();
        reject(error);
        return;
      }

      // 写入必须等事务完成，不能仅凭 request 成功就报告保存成功。
      transaction.oncomplete = () => resolve(request.result);

      transaction.onabort = () => {
        reject(
          transaction.error ??
          request.error ??
          new Error("地图库の操作を完了できませんでした。")
        );
      };

      transaction.onerror = () => {
        // 最终错误由 onabort 统一处理。
      };
    });
  } finally {
    db.close();
  }
}

function readEntry(id) {
  return databaseOperation("readonly", store => store.get(id));
}

function readEntries() {
  return databaseOperation("readonly", store => store.getAll());
}

function writeEntry(entry) {
  return databaseOperation("readwrite", store => store.put(entry));
}

function deleteEntry(id) {
  return databaseOperation("readwrite", store => store.delete(id));
}

function element(tag, text = "", className = "") {
  const result = document.createElement(tag);
  result.textContent = text;

  if (className) result.className = className;

  return result;
}

export function mountSceneLibrary({
  container,
  store,
  getView,
  onLoaded
}) {
  let busy = false;
  let destroyed = false;

  const note = element(
    "p",
    "地形・ユニット・編隊・行動記録・表示位置を保存します。" +
    "読み込みと新規作成の前に、現在の作戦を自動バックアップします。",
    "editor-note"
  );

  const label = element("label");
  const selectTitle = element("span", "保存スロット");
  const slots = element("select");

  for (let index = 1; index <= SLOT_COUNT; index++) {
    slots.append(new Option(
      `スロット ${index}：読み込み中…`,
      `slot-${index}`
    ));
  }

  label.append(selectTitle, slots);

  const detail = element("p", "", "editor-note");
  const actions = element("div", "", "editor-actions");

  const status = element(
    "p",
    "",
    "editor-note editor-status"
  );

  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  container.append(note, label, detail, actions, status);

  const buttons = [];
  let entries = new Map();

  function show(text, error = false) {
    if (destroyed) return;

    status.textContent = text;
    status.classList.toggle("error", error);
  }

  function setBusy(value) {
    busy = value;

    if (destroyed) return;

    slots.disabled = value;

    for (const button of buttons) {
      button.disabled = value;
    }
  }

  function displayDetail() {
    const entry = entries.get(slots.value);

    if (!entry) {
      detail.textContent = "空の保存スロットです。";
      return;
    }

    detail.textContent =
      `${entry.name}\n` +
      `地図：${entry.width} × ${entry.height}\n` +
      `ユニット：${entry.unitCount}\n` +
      `保存日時：${new Date(entry.savedAt).toLocaleString("ja-JP")}`;
  }

  async function refreshEntries() {
    const list = await readEntries();

    if (destroyed) return;

    entries = new Map(list.map(entry => [entry.id, entry]));

    for (let index = 1; index <= SLOT_COUNT; index++) {
      const id = `slot-${index}`;
      const entry = entries.get(id);

      slots.options[index - 1].textContent =
        `スロット ${index}：${entry?.name ?? "空き"}`;
    }

    displayDetail();
  }

  // 保存此刻的视角，再导出经过存储层验证的完整场景。
  function captureCurrent(id) {
    if (store.isRecoveryBlocked()) {
      throw new Error(
        "保存データを復元してから地图库を操作してください。"
      );
    }

    store.updateView(getView());

    const scene = store.getScene();

    return {
      id,
      name: scene.name,
      savedAt: new Date().toISOString(),
      width: scene.terrain.width,
      height: scene.terrain.height,
      unitCount: scene.instances.length,
      text: store.exportScene()
    };
  }

  async function backupCurrent() {
    const backup = captureCurrent(BACKUP_ID);
    await writeEntry(backup);
  }

  function addButton(title, action) {
    const button = element("button", title);
    button.type = "button";

    button.addEventListener("click", async () => {
      if (busy || destroyed) return;

      setBusy(true);

      try {
        await action();
      } catch (error) {
        console.error(error);
        show(error.message ?? "操作に失敗しました。", true);
      } finally {
        setBusy(false);
      }
    });

    buttons.push(button);
    actions.append(button);
  }

  addButton("このスロットに保存", async () => {
    const id = slots.value;
    const previous = await readEntry(id);

    if (previous && !confirm(
      `「${previous.name}」を現在の作戦で上書きしますか？`
    )) return;

    await writeEntry(captureCurrent(id));
    await refreshEntries();

    show("保存スロットに作戦を保存しました。");
  });

  addButton("読み込み", async () => {
    // 先读取目标，确保它存在，再备份当前场景。
    const entry = await readEntry(slots.value);

    if (!entry || typeof entry.text !== "string") {
      throw new Error("このスロットには有効な作戦がありません。");
    }

    if (!confirm(
      `「${entry.name}」を読み込みますか？` +
      "現在の作戦は切り替え前バックアップに保存されます。"
    )) return;

    // 备份失败时，不替换当前地图。
    await backupCurrent();

    // importScene 内部先完整校验，失败时不替换场景。
    store.importScene(entry.text);
    onLoaded();

    show(
      "作戦を読み込みました。" +
      (store.getStorageWarning()
        ? ` ${store.getStorageWarning()}`
        : "")
    );
  });

  addButton("空白地図を新規作成", async () => {
    const enteredName = prompt("新しい作戦名", "新しい作戦");

    if (enteredName === null) return;

    const name = enteredName.trim();

    if (!name) {
      throw new Error("作戦名は空欄にできません。");
    }

    await backupCurrent();

    store.newScene(name);
    onLoaded();

    show(
      "空白の海域地図を作成しました。" +
      "保存する場合はスロットを選んで保存してください。"
    );
  });

  addButton("切り替え前バックアップを復元", async () => {
    // 現在の場面の备份前に、復元対象を読み取る。
    const backup = await readEntry(BACKUP_ID);

    if (!backup || typeof backup.text !== "string") {
      throw new Error("切り替え前バックアップはありません。");
    }

    if (!confirm(
      `切り替え前の「${backup.name}」を復元しますか？` +
      "現在の作戦が次のバックアップになります。"
    )) return;

    await backupCurrent();

    store.importScene(backup.text);
    onLoaded();

    show("切り替え前の作戦を復元しました。");
  });

  addButton("このスロットを削除", async () => {
    const entry = await readEntry(slots.value);

    if (!entry) {
      show("このスロットは空です。");
      return;
    }

    if (!confirm(
      `保存スロットの「${entry.name}」を削除しますか？` +
      "現在表示中の地図は変更されません。"
    )) return;

    await deleteEntry(slots.value);
    await refreshEntries();

    show("保存スロットを削除しました。");
  });

  slots.addEventListener("change", displayDetail);

  // 初始化期间禁用按钮，避免与首次读取交错。
  setBusy(true);

  refreshEntries()
    .then(() => {
      show("保存スロットを選んで操作してください。");
    })
    .catch(error => {
      console.error(error);
      show(error.message, true);
    })
    .finally(() => {
      setBusy(false);
    });

  return {
    destroy() {
      destroyed = true;
      container.replaceChildren();
    }
  };
}
