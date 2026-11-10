const STEPS = [
  { id: "start", label: "ラウンド開始", group: "start" },
  { id: "movement", label: "移動計画・移動処理", group: "movement" },
  { id: "order-5", label: "次序5", group: "attack" },
  { id: "order-4", label: "次序4", group: "attack" },
  { id: "order-3", label: "次序3", group: "attack" },
  { id: "order-2", label: "次序2", group: "attack" },
  { id: "order-1", label: "次序1", group: "attack" },
  { id: "pas", label: "PAS", group: "attack" },
  { id: "special", label: "特殊効果チェック", group: "special" },
  { id: "end", label: "ラウンド終了", group: "end" }
];

function element(tag, text = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function section(title, description) {
  const root = element("details");
  root.className = "workflow-section";

  const note = element("p", description);
  note.className = "note";

  const body = element("div");
  root.append(element("summary", title), note, body);

  return { root, body };
}

function slot(id, parent) {
  const node = element("div");
  node.id = id;
  parent.append(node);
  return node;
}

export function mountSimulationWorkflow(store) {
  const aside = document.querySelector("aside");

  if (!aside) {
    throw new Error("推演画面のサイドバーが見つかりません。");
  }

  if (aside.querySelector(".workflow-overview")) {
    throw new Error("ラウンドフローは既に表示されています。");
  }

  const originalNodes = [...aside.childNodes];
  const originalDetails = [...aside.children].filter(
    node => node.tagName === "DETAILS"
  );

  function findPanel(...titles) {
    return originalDetails.find(node => {
      const summary = node.querySelector(":scope > summary");
      return titles.includes(summary?.textContent.trim());
    });
  }

  // 必须在移动任何旧DOM之前，取得全部引用。
  const environment = findPanel("時間・天候・回合");
  const units = findPanel("参戦ユニット");
  const groups = findPanel("集群・編隊");
  const drafts = findPanel("行動・記録");
  const movement = findPanel("観察陣営・艦船移動");
  const rescue = findPanel("艦船救助");
  const attack = findPanel(
    "単体攻撃・段階結算",
    "攻撃装備・一括確認"
  );

  const execute = attack?.querySelector("#attackExecuteBatch");
  const finish = attack?.querySelector("#attackFinishPhase");
  const feedback = attack?.querySelector("#phaseCommandFeedback");

  const dependencies = [
    ["時間・天候", environment],
    ["参戦ユニット", units],
    ["移動操作", movement],
    ["救助操作", rescue],
    ["攻撃操作", attack],
    ["攻撃段階結算ボタン", execute],
    ["段階終了ボタン", finish],
    ["段階操作の結果表示", feedback]
  ];

  const missing = dependencies
    .filter(([, node]) => !node)
    .map(([label]) => label);

  if (missing.length) {
    // 检查失败时，原页面仍保持原位。
    throw new Error(
      `ラウンドフローの表示要素が不足しています：${missing.join("、")}`
    );
  }

  // 以下先创建空布局，不移动旧页面元素。
  const overview = element("section");
  overview.className = "workflow-overview";

  const current = element("p");
  current.className = "note";
  current.setAttribute("aria-live", "polite");

  const rail = element("ol");
  rail.className = "workflow-rail";

  const stepNodes = STEPS.map(step => {
    const node = element("li", step.label);
    rail.append(node);
    return node;
  });

  const nextAction = element("p");
  nextAction.className = "workflow-next";

  overview.append(
    element("h2", "ラウンドの進行"),
    current,
    rail,
    nextAction
  );

  const startSection = section(
    "1｜ラウンド開始",
    "時刻・天候と観察陣営を確認します。開始操作は次の移動欄にあります。"
  );

  const movementSection = section(
    "2｜移動計画・移動処理",
    "「移動段階へ」で開始し、各艦の計画を保存してから、全陣営の移動を処理します。"
  );

  const attackSection = section(
    "3｜次序攻撃・PAS",
    "次序5→4→3→2→1→PASの順です。各段階の計画を保存し、その段階を一括結算します。"
  );

  const specialSection = section(
    "4｜特殊効果チェック",
    "火災・浸水・設備損管と、対応済みの判定時期に達した任務を処理します。"
  );

  const endSection = section(
    "5｜ラウンド終了",
    "終了処理の保存に成功した場合だけ、30分進めて次のラウンドへ移ります。"
  );

  const auxiliary = section(
    "補助｜編隊管理・草案記録",
    "編隊管理と行動メモです。草案の保存は正式な行動実行ではありません。"
  );

  const repairNote = element(
    "p",
    "参戦ユニットで自艦を選択すると、設備修復パネルを表示します。" +
    "外部設備修復の新規登録は正式規則の確認待ちです。"
  );
  repairNote.className = "note";

  movementSection.body.append(repairNote);
  const repairSlot = slot(
    "equipmentRepairPanelSlot",
    movementSection.body
  );

  const rangeNote = element(
    "p",
    "範囲攻撃：参戦ユニットで発射する自艦を選択してください。" +
    "専用パネルで主目標の編隊を選び、武器の方式に応じて対象を指定します。"
  );
  rangeNote.className = "note";

  attackSection.body.append(rangeNote);
  const rangeSlot = slot(
    "rangeAttackPanelSlot",
    attackSection.body
  );

  const attackActions = slot(
    "workflowAttackActions",
    attackSection.body
  );
  const specialActions = slot(
    "workflowSpecialActions",
    specialSection.body
  );
  const endActions = slot(
    "workflowEndActions",
    endSection.body
  );

  const feedbackBox = element("section");
  feedbackBox.className = "workflow-feedback";
  feedbackBox.append(element("h3", "段階操作の結果"));

  const phaseSections = {
    start: startSection.root,
    movement: movementSection.root,
    attack: attackSection.root,
    special: specialSection.root,
    end: endSection.root
  };

  let previousPhase = null;
  let disposed = false;

  function sync() {
    if (disposed) return;

    const scene = store.getScene();
    const phaseId = scene.turn.phaseId;
    const index = STEPS.findIndex(step => step.id === phaseId);
    const step = STEPS[index];

    current.textContent =
      `ラウンド${scene.turn.number} / ` +
      `現在：${step?.label ?? "未対応の段階"}`;

    stepNodes.forEach((node, stepIndex) => {
      const active = stepIndex === index;
      node.classList.toggle("current", active);

      if (active) {
        node.setAttribute("aria-current", "step");
      } else {
        node.removeAttribute("aria-current");
      }
    });

    const instructions = {
      start: "次の操作：移動欄の「移動段階へ」を押してください。",
      movement:
        "次の操作：移動計画を保存し、「全陣営の移動を処理」を押してください。",
      attack:
        "次の操作：現在の段階の攻撃計画を保存し、「現在の攻撃段階を一括結算」を押してください。",
      special: "次の操作：「特殊段階を処理」を押してください。",
      end: "次の操作：「ラウンド終了を処理（30分進行）」を押してください。"
    };

    nextAction.textContent = instructions[step?.group] ??
      "この段階の正式操作は対応していません。";

    for (const [group, panel] of Object.entries(phaseSections)) {
      panel.classList.toggle(
        "current-phase",
        group === step?.group
      );
    }

    if (phaseId !== previousPhase) {
      if (step) phaseSections[step.group].open = true;

      if (phaseId === "start" || phaseId === "movement") {
        movementSection.root.open = true;
        movement.open = true;
      }

      if (step?.group === "attack") {
        attack.open = true;
      }

      previousPhase = phaseId;
    }

    // 不创建新的结算入口，只移动原按钮。
    const destination = phaseId === "end"
      ? endActions
      : specialActions;

    if (finish.parentElement !== destination) {
      destination.append(finish);
    }
  }

  // 先读取初始状态；若失败，旧面板仍未被移动。
  sync();

  // 全部检查通过后，才开始移动原面板。
  startSection.body.append(environment);
  movementSection.body.insertBefore(movement, repairNote);
  movementSection.body.insertBefore(rescue, repairNote);
  attackSection.body.insertBefore(attack, rangeNote);

  attackActions.append(execute);
  feedbackBox.append(feedback);

  if (groups) auxiliary.body.append(groups);
  if (drafts) auxiliary.body.append(drafts);

  const knownPanels = new Set([
    environment, units, groups, drafts,
    movement, rescue, attack
  ]);

  // 保留其他模块创建的侧栏节点，不因布局重排而删除。
  const additionalNodes = originalNodes.filter(
    node => !knownPanels.has(node)
  );
  auxiliary.body.append(...additionalNodes);

  aside.replaceChildren(
    overview,
    units,
    startSection.root,
    movementSection.root,
    attackSection.root,
    specialSection.root,
    endSection.root,
    feedbackBox,
    auxiliary.root
  );

  const unsubscribe = store.subscribe(sync);

  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
  };
}
