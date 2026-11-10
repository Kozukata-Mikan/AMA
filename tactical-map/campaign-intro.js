const MAX_IMAGE_BYTES = 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

const TEXT_FIELDS = [
  ["title", "主タイトル", 100],
  ["subtitle", "副タイトル", 100],
  ["annotation", "注記", 300],
  ["declaration", "宣言", 1000]
];

function normalize(value = {}) {
  const result = {
    version: 1,
    enabled: value.enabled === true,
    badge: typeof value.badge === "string" ? value.badge : ""
  };

  if (
    result.badge &&
    (
      result.badge.length > 1500000 ||
      !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/
        .test(result.badge)
    )
  ) {
    throw new Error("徽章画像の保存形式が不正です。");
  }

  for (const [key, label, limit] of TEXT_FIELDS) {
    const text = value[key] ?? "";

    if (typeof text !== "string" || text.length > limit) {
      throw new Error(`${label}は${limit}文字以内にしてください。`);
    }

    result[key] = text;
  }

  return result;
}

function installStyle() {
  if (document.getElementById("campaign-intro-style")) return;

  const style = document.createElement("style");
  style.id = "campaign-intro-style";

  style.textContent = `
    .campaign-intro {
      position:fixed; inset:0; z-index:10000;
      box-sizing:border-box;
      display:grid; place-items:center;
      padding:clamp(24px,5vw,72px);
      overflow:auto;
      background:#11151c;
      color:#f4f4f1;
      font-family:system-ui,sans-serif;
      outline:none;
    }
    .campaign-intro__body {
      width:min(1100px,100%);
    }
    .campaign-intro__identity {
      display:flex; align-items:center;
      gap:clamp(20px,4vw,48px);
    }
    .campaign-intro__badge {
      width:clamp(100px,16vw,190px);
      max-height:240px; object-fit:contain;
      flex-shrink:0;
    }
    .campaign-intro__titles { min-width:0; }
    .campaign-intro__headline {
      display:flex; align-items:baseline;
      flex-wrap:wrap; gap:8px 22px;
    }
    .campaign-intro__title {
      font-size:clamp(36px,6vw,84px);
      font-weight:400; letter-spacing:.06em;
      line-height:1.1;
    }
    .campaign-intro__subtitle {
      font-size:clamp(20px,3vw,40px);
      color:#c6cbd4; letter-spacing:.04em;
    }
    .campaign-intro__annotation {
      margin-top:12px;
      font-size:clamp(12px,1.5vw,18px);
      color:#adb5c2;
    }
    .campaign-intro__declaration {
      margin:clamp(40px,8vh,100px) auto 0;
      max-width:800px;
      font-size:clamp(16px,2vw,24px);
      line-height:1.7;
    }
    .campaign-intro__text {
      white-space:pre-wrap; overflow-wrap:anywhere;
    }
    .campaign-intro__hint {
      margin-top:48px; text-align:center;
      font-size:13px; color:#8993a3;
    }
    .campaign-intro-editor {
      display:grid; gap:14px;
    }
    .campaign-intro-editor label {
      display:grid; gap:6px;
    }
    .campaign-intro-editor input[type="text"],
    .campaign-intro-editor textarea {
      box-sizing:border-box; width:100%;
      padding:8px;
    }
    .campaign-intro-editor__badge {
      max-width:120px; max-height:150px;
      object-fit:contain;
    }
    @media(max-width:600px) {
      .campaign-intro__identity {
        flex-direction:column; align-items:flex-start;
      }
    }
  `;

  document.head.append(style);
}

/**
 * 展示期间锁住指针、键盘事件，避免关闭开场页的操作
 * 继续触发地图按钮或快捷键。
 *
 * 返回Promise，关闭后才完成。
 */
export function showCampaignIntro(value, { force = false } = {}) {
  const data = normalize(value);

  if (!force && !data.enabled) return Promise.resolve();

  installStyle();

  return new Promise(resolve => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;

    const overlay = document.createElement("section");
    overlay.className = "campaign-intro";
    overlay.tabIndex = -1;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "戦役紹介");

    const body = document.createElement("div");
    body.className = "campaign-intro__body";
    overlay.append(body);

    const identity = document.createElement("div");
    identity.className = "campaign-intro__identity";
    body.append(identity);

    if (data.badge) {
      const image = document.createElement("img");
      image.className = "campaign-intro__badge";
      image.src = data.badge;
      image.alt = "部隊徽章";
      identity.append(image);
    }

    const titles = document.createElement("div");
    titles.className = "campaign-intro__titles";
    identity.append(titles);

    const headline = document.createElement("div");
    headline.className = "campaign-intro__headline";
    titles.append(headline);

    function addText(parent, className, text) {
      if (!text) return;
      const element = document.createElement("div");
      element.className = className + " campaign-intro__text";

      // 作者输入只作为文字，不执行HTML。
      element.textContent = text;
      parent.append(element);
    }

    addText(headline, "campaign-intro__title", data.title);
    addText(headline, "campaign-intro__subtitle", data.subtitle);
    addText(titles, "campaign-intro__annotation", data.annotation);
    addText(body, "campaign-intro__declaration", data.declaration);
    addText(
      body,
      "campaign-intro__hint",
      "クリック、またはキーを押して開始"
    );

    let closing = false;

    function swallow(event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    function cleanup() {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
      overlay.removeEventListener("click", onClick, true);

      overlay.remove();
      document.body.style.overflow = previousOverflow;

      if (previousFocus?.isConnected) previousFocus.focus();
      resolve();
    }

    function onClick(event) {
      swallow(event);
      if (closing) return;
      closing = true;
      cleanup();
    }

    function onKey(event) {
      swallow(event);

      // 等键释放再关闭，避免同一次按键泄漏到地图。
      if (!event.repeat) closing = true;
    }

    function onKeyUp(event) {
      swallow(event);
      if (closing) cleanup();
    }

    document.body.style.overflow = "hidden";
    document.body.append(overlay);
    overlay.focus();

    overlay.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
  });
}

/**
 * 自定义模式编辑器。
 * read()返回可保存数据；上传或预览不会自动改动存档。
 */
export function createCampaignIntroEditor(initialValue) {
  installStyle();

  let data = normalize(initialValue);
  let uploading = false;
  let uploadToken = 0;

  const element = document.createElement("section");
  element.className = "campaign-intro-editor";

  const enabledLabel = document.createElement("label");
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.checked = data.enabled;
  enabledLabel.append(enabled, " 推演開始時に紹介画面を表示");
  element.append(enabledLabel);

  const inputs = new Map();

  for (const [key, label, limit] of TEXT_FIELDS) {
    const wrapper = document.createElement("label");
    wrapper.append(document.createTextNode(label));

    const input = document.createElement(
      key === "annotation" || key === "declaration"
        ? "textarea"
        : "input"
    );

    if (input.tagName === "INPUT") input.type = "text";
    else input.rows = key === "declaration" ? 4 : 2;

    input.maxLength = limit;
    input.value = data[key];
    inputs.set(key, input);

    wrapper.append(input);
    element.append(wrapper);
  }

  const badge = document.createElement("img");
  badge.className = "campaign-intro-editor__badge";
  badge.alt = "徽章プレビュー";

  function refreshBadge() {
    badge.hidden = !data.badge;
    if (data.badge) badge.src = data.badge;
    else badge.removeAttribute("src");
  }

  refreshBadge();
  element.append(badge);

  const upload = document.createElement("input");
  upload.type = "file";
  upload.accept = IMAGE_TYPES.join(",");

  const status = document.createElement("div");
  status.setAttribute("role", "status");

  upload.addEventListener("change", async () => {
    const file = upload.files?.[0];
    if (!file) return;

    const token = ++uploadToken;
    uploading = true;
    status.textContent = "画像を読み込んでいます。";

    try {
      if (
        !IMAGE_TYPES.includes(file.type) ||
        file.size > MAX_IMAGE_BYTES
      ) {
        throw new Error(
          "PNG・JPEG・WebP形式の1MB以内の画像を選択してください。"
        );
      }

      const url = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () =>
          reject(new Error("画像を読み込めません。"));
        reader.readAsDataURL(file);
      });

      const image = new Image();
      image.src = url;
      await image.decode();

      const checked = normalize({ ...data, badge: url });

      if (token !== uploadToken) return;

      data = checked;
      refreshBadge();
      status.textContent = "画像を読み込みました。保存はまだ行っていません。";
    } catch (error) {
      if (token === uploadToken) {
        status.textContent =
          error instanceof Error
            ? error.message
            : "画像を読み込めません。";
      }
    } finally {
      if (token === uploadToken) uploading = false;
      upload.value = "";
    }
  });

  element.append(upload, status);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "徽章を削除";

  remove.addEventListener("click", () => {
    uploadToken += 1;
    uploading = false;
    data.badge = "";
    refreshBadge();
    status.textContent = "";
  });

  function read() {
    if (uploading) {
      throw new Error("画像の読み込み完了を待ってください。");
    }

    const value = {
      ...data,
      enabled: enabled.checked
    };

    for (const [key, input] of inputs) value[key] = input.value;
    return normalize(value);
  }

  const preview = document.createElement("button");
  preview.type = "button";
  preview.textContent = "紹介画面をプレビュー";

  preview.addEventListener("click", () => {
    try {
      showCampaignIntro(read(), { force: true }).catch(error => {
        status.textContent = error.message;
      });
    } catch (error) {
      status.textContent = error.message;
    }
  });

  element.append(remove, preview);

  return { element, read };
}
