const STEPS = [
  {
    id: "start",
    label: "ラウンド開始",
    group: "start"
  },
  {
    id: "movement",
    label: "移動計画・移動処理",
    group: "movement"
  },
  {
    id: "order-5",
    label: "次序5",
    group: "attack"
  },
  {
    id: "order-4",
    label: "次序4",
    group: "attack"
  },
  {
    id: "order-3",
    label: "次序3",
    group: "attack"
  },
  {
    id: "order-2",
    label: "次序2",
    group: "attack"
  },
  {
    id: "order-1",
    label: "次序1",
    group: "attack"
  },
  {
    id: "pas",
    label: "PAS",
    group: "attack"
  },
  {
    id: "special",
    label: "特効チェック",
    group: "special"
  },
  {
    id: "end",
    label: "ラウンド終了",
    group: "end"
  }
];

function element(tag, text = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function section(title, description) {
  const root = element("details");
  root.className = "workflow-section";

  root.append(element("summary", title));

  const note = element("p", description);
  note.className = "note";
  root.append(note);

  const body = element("div");
  root.append(body);

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

  // 在创建新结构前记录原页面的面板。
  const originalDetails = [...aside.children].filter(
    node => node.tagName === "DETAILS"
  );

  function findPanel(...titles) {
    return originalDetails.find(node => {
      const summary = node.querySelector(":scope > summary");
      return titles.includes(summary?.textContent.trim());
    });
  }

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

  const required = [
    environment, units, movement, rescue, attack
  ];

  if (required.some(panel => !panel)) {
    throw new Error(
      "回合フローの表示に必要な操作面板が見つかりません。"
    );
  }

  const overview = element("section");
  overview.className = "workflow-overview";
  overview.append(element("h2", "ラウンドの進行"));

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

  overview.append(current, rail, nextAction);

  const startSection = section(
    "1｜ラウンド開始",
    "観察陣営と艦船を確認し、「移動段階へ」で開始します。"
  );

  const movementSection = section(
    "2｜移動計画・移動処理",
    "各艦の計画を保存してから、全陣営の移動をまとめて処理します。"
  );

  const attackSection = section(
    "3｜次序攻撃・PAS",
    "現在の次序で攻撃計画を保存し、その段階の全計画を一括結算します。"
  );

  const specialSection = section(
    "4｜特効チェック",
    "火災・浸水・設備損管と、対応済みの到期任務をまとめて処理します。"
  );

  const endSection = section(
    "5｜ラウンド終了",
    "終了処理の保存に成功した場合だけ、30分進めて次のラウンドへ移ります。"
  );

  const auxiliary = section(
    "補助｜編隊管理・草案記録",
    "編隊の管理と草案記録です。草案の保存は正式な行動実行ではありません。"
  );

  startSection.body.append(environment);
  movementSection.body.append(movement, rescue);

  const repairNote = element(
    "p",
    "参戦ユニットで自艦を選択すると、設備修復面板を表示します。" +
    "外部設備修復の新規登録は正式規則の確認待ちです。"
  );
  repairNote.className = "note";

  movementSection.body.append(repairNote);
  slot("equipmentRepairPanelSlot", movementSection.body);

  attackSection.body.append(attack);

  const rangeNote = element(
    "p",
    "範囲攻撃：参戦ユニットで発射する自艦を選択してください。" +
    "下の専用面板で、主目標の編隊と対象メンバーを指定します。"
  );
  rangeNote.className = "note";

  attackSection.body.append(rangeNote);
  slot("rangeAttackPanelSlot", attackSection.body);

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

  const execute = document.getElementById(
    "attackExecuteBatch"
  );
  const finish = document.getElementById(
    "attackFinishPhase"
  );
  const feedback = document.getElementById(
    "phaseCommandFeedback"
  );

  if (!execute || !finish || !feedback) {
    throw new Error("段階操作の表示要素が見つかりません。");
  }

  attackActions.append(execute);
  specialActions.append(finish);

  // 阶段反馈独立于装备详情，始终可见。
  const feedbackBox = element("section");
  feedbackBox.className = "workflow-feedback";
  feedbackBox.append(
    element("h3", "段階操作の結果"),
    feedback
  );

  if (groups) auxiliary.body.append(groups);
  if (drafts) auxiliary.body.append(drafts);

  // 单位选择紧邻流程概览；操作区按规则顺序排列。
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

  const phaseSections = {
    start: startSection.root,
    movement: movementSection.root,
    attack: attackSection.root,
    special: specialSection.root,
    end: endSection.root
  };

  let previousPhase = null;

  function sync() {
    const scene = store.getScene();
    const phaseId = scene.turn.phaseId;
    const index = STEPS.findIndex(
      step => step.id === phaseId
    );
    const step = STEPS[index];

    current.textContent =
      `ラウンド${scene.turn.number} / ` +
      `現在：${step?.label ?? "未対応の段階"}`;

    stepNodes.forEach((node, stepIndex) => {
      node.classList.toggle(
        "current",
        stepIndex === index
      );

      if (stepIndex === index) {
        node.setAttribute("aria-current", "step");
      } else {
        node.removeAttribute("aria-current");
      }
    });

    const instructions = {
      start:
        "次の操作：「移動段階へ」を押してください。",
      movement:
        "次の操作：移動計画を保存し、「全陣営の移動を処理」を押してください。",
      attack:
        "次の操作：現在の段階の攻撃計画を保存し、「現在の攻撃段階を一括結算」を押してください。",
      special:
        "次の操作：「特殊段階を処理」を押してください。",
      end:
        "次の操作：「ラウンド終了を処理（30分進行）」を押してください。"
    };

    nextAction.textContent = instructions[step?.group] ??
      "この段階の正式操作は対応していません。";

    for (const [group, panel] of Object.entries(phaseSections)) {
      panel.classList.toggle(
        "current-phase",
        group === step?.group
      );
    }

    // 开始按钮仍在移动面板中，因此回合开始时一并展开。
    if (phaseId !== previousPhase) {
      if (step) phaseSections[step.group].open = true;

      if (phaseId === "start") {
        movementSection.root.open = true;
        movement.open = true;
      }

      if (step?.group === "movement") {
        movement.open = true;
      }

      if (step?.group === "attack") {
        attack.open = true;
      }

      previousPhase = phaseId;
    }

    // 使用原按钮，不新增第二套结束处理。
    const destination = phaseId === "end"
      ? endActions
      : specialActions;

    if (finish.parentElement !== destination) {
      destination.append(finish);
    }
  }

  const unsubscribe = store.subscribe(sync);
  sync();

  return () => {
    unsubscribe();
  };
}
