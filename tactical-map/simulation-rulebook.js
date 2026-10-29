// 本模块不修改地图，不执行伤害，不自动推进回合。

export const SIMULATION_PHASES = Object.freeze([
  { id: "start", label: "ラウンド開始" },
  { id: "movement-select", label: "移動計画" },
  { id: "movement-resolve", label: "移動処理" },
  { id: "order-5-select", label: "次序5・目標選択" },
  { id: "order-5-resolve", label: "次序5・処理" },
  { id: "order-4-select", label: "次序4・目標選択" },
  { id: "order-4-resolve", label: "次序4・処理" },
  { id: "order-3-select", label: "次序3・目標選択" },
  { id: "order-3-resolve", label: "次序3・処理" },
  { id: "order-2-select", label: "次序2・目標選択" },
  { id: "order-2-resolve", label: "次序2・処理" },
  { id: "order-1-select", label: "次序1・目標選択" },
  { id: "order-1-resolve", label: "次序1・処理" },
  { id: "pas", label: "PAS" },
  { id: "special", label: "特殊効果判定" },
  { id: "end", label: "ラウンド終了" }
]);

export function getPhaseLabel(id) {
  return SIMULATION_PHASES.find(phase => phase.id === id)?.label
    ?? "不明な段階";
}

/**
 * 从同一次序开始时的战场快照筛选可发动的行动。
 *
 * isEligible(action, scene) 必须由正式规则引擎提供，
 * 负责检查存活、无法行动、武器条件等。
 *
 * 本函数不计算伤害，也不修改传入的场景。
 */
export function prepareOrderBatch(
  scene,
  order,
  submittedActions,
  isEligible
) {
  if (!Number.isInteger(order) || order < 1 || order > 5) {
    throw new Error("次序は1から5までの整数で指定してください。");
  }

  if (
    !Array.isArray(submittedActions) ||
    typeof isEligible !== "function"
  ) {
    throw new Error("行動一覧または実行資格の判定ルールがありません。");
  }

  const copy = value => JSON.parse(JSON.stringify(value));
  const startScene = copy(scene);

  const accepted = [];
  const cancelled = [];

  for (const source of submittedActions) {
    if (source.order !== order) continue;

    const action = copy(source);

    // 每个行动都依据同一份阶段开始状态判定。
    // 给判定器独立副本，避免意外修改影响后续行动。
    const result = isEligible(
      copy(action),
      copy(startScene)
    );

    if (!result || typeof result.allowed !== "boolean") {
      throw new Error("実行資格の判定結果には、allowedの真偽値が必要です。");
    }

    if (result.allowed) {
      accepted.push(action);
    } else {
      cancelled.push({
        action,
        reason: result.reason ?? "この次序の開始時点で実行資格を満たしていません。"
      });
    }
  }

  return {
    order,
    startScene,
    accepted,
    cancelled
  };
}

// 仅判断拦截的次序门槛。
// 通过本检查不代表具有拦截能力，也不代表拦截成功。
export function passesInterceptionOrder(
  weaponOrder,
  entityOrder
) {
  for (const order of [weaponOrder, entityOrder]) {
    if (!Number.isInteger(order) || order < 1 || order > 5) {
      throw new Error("迎撃側と実体攻撃の次序は、1から5までの整数で指定してください。");
    }
  }

  return weaponOrder >= entityOrder;
}

const CHAPTERS = [
   {
    title: "1. 操作と自律行動",
    paragraphs: [
      "「敵側の自律行動」が無効の場合、味方・敵・中立のすべての行動をプレイヤーが指定します。",
      "有効の場合、味方はプレイヤーが操作し、敵と中立はシステムが行動を決定します。",
      "敵は味方ユニットの全滅を、中立は自身の生存を目標とします。",
      "自律行動にも手動操作と同じルールが適用されます。射程・ダメージ・行動回数などの優遇はありません。"
    ]
  },
  {
    title: "2. 共通のラウンド進行",
    paragraphs: [
      "味方ターンと敵ターンの区別はありません。すべての陣営が同じ時間軸で行動します。",
      "進行順：ラウンド開始 → 移動計画・移動処理 → 次序5 → 次序4 → 次序3 → 次序2 → 次序1 → PAS → 特殊効果判定 → ラウンド終了。",
      "各次序では、先に目標を選択し、その後にまとめて処理します。前の次序が完全に終了してから、次の次序へ進みます。",
      "1ラウンドは30分です。ラウンド終了の処理が正常に完了したときだけ、シナリオ内の時刻が30分進みます。"
    ]
  },
  {
    title: "3. 次序と同時処理",
    paragraphs: [
      "攻撃は次序5・4・3・2・1の順に発生します。高い次序が先に処理されます。",
      "同じ次序の攻撃は、その次序の開始時点の状態に基づいて実行資格を判定します。",
      "実行資格を満たして発動した攻撃は、攻撃側が同じ次序で撃沈されても取り消されません。",
      "例：2隻が次序4の攻撃を発動した場合、一方が次序4で撃沈されても、その艦の次序4攻撃は有効です。",
      "ただし、次序5ですでに撃沈されている、または行動不能になっている場合、次序4の攻撃は発動できません。",
      "ユニット一覧やプログラムの処理順によって、同じ次序の結果が変わってはいけません。"
    ]
  },
  {
    title: "4. 実体攻撃と迎撃",
    paragraphs: [
      "「実体」と指定された攻撃は、発動後にマップ上へ独立したマーカーを生成し、選択できるようになります。",
      "高い次序の武器は、同じ次序または低い次序の実体攻撃を迎撃できます。逆は認められません。",
      "次序条件を満たすことは迎撃条件の一つであり、迎撃成功を保証するものではありません。",
      "発射元が撃沈された後の実体の存続、移動、耐性、迎撃判定の詳細は未定義です。"
    ]
  },
  {
    title: "5. PAS",
    paragraphs: [
      "PASは各ラウンドのPAS段階で自動的に判定・発動します。",
      "敵対する対象が対応するPAS射程内に入っている場合、PAS攻撃を自動実行します。",
      "PAS攻撃を「機動性」によって回避することはできません。",
      "その他の命中・防御・ダメージ処理は、定義されたルールに従います。機動性による回避禁止は、すべての防御を無視するという意味ではありません。",
      "複数の対象がいる場合の目標選択、攻撃回数、PAS内の処理順は未定義です。"
    ]
  },
  {
    title: "6. 現在の実装状況",
    paragraphs: [
      "実装済み：ルールブック、自律行動設定、手動操作の権限確認、同次序の攻撃準備関数、迎撃の次序条件確認関数。",
      "未実装：移動処理、ダメージ処理、PAS処理、実体攻撃の戦闘中の挙動、自律行動の計画。",
      "自律行動の設定は保存できますが、戦闘ルールが整うまでは自律行動を生成・実行しません。現時点では最適行動を保証する機能ではありません。",
      "現在の行動記録は未実行の草案です。ラウンドとシナリオ内の時刻はまだ進みません。"
    ]
  }
];

export function mountSimulationRulebook(store) {
  if (document.getElementById("simulationRulesPanel")) {
    throw new Error("ルールブックはすでに表示されています。");
  }

  const aside = document.querySelector("aside");

  if (!aside) {
    throw new Error("推演画面のサイドバーが見つかりません。");
  }

  function element(tag, text = "") {
    const result = document.createElement(tag);
    result.textContent = text;
    return result;
  }

  const panel = element("section");
  panel.id = "simulationRulesPanel";
  panel.style.cssText = "padding:12px 0;";

  const heading = element("h3", "推演制御とルール書");

  const label = element("label");
  label.style.cssText =
    "display:flex;align-items:center;gap:8px;";

  const checkbox = element("input");
  checkbox.type = "checkbox";
  checkbox.id = "enemyAutonomy";

  label.append(checkbox, element("span", "敵側の自律行動"));

  const status = element("p");
  status.className = "note";
  status.setAttribute("aria-live", "polite");

  const book = element("details");
  const summary = element("summary", "📖 ルール書");
  const content = element("div");

  content.style.cssText =
    "max-height:55vh;overflow:auto;padding:8px 4px;";

  for (const chapter of CHAPTERS) {
    const section = element("section");
    section.append(element("h4", chapter.title));

    for (const paragraph of chapter.paragraphs) {
      const p = element("p", paragraph);
      p.className = "note";
      section.append(p);
    }

    content.append(section);
  }

  book.append(summary, content);
  panel.append(heading, label, status, book);
  aside.prepend(panel);

  function sync() {
    const enabled = store.getControlSettings().enemyAutonomy;

    checkbox.checked = enabled;

    status.textContent = enabled
      ? "味方：手動で手配する。敵、中立：自主的に制御する。" +
        "自主計画は戦闘規則の補完を待っている。現在は自動的に行動を実行しない。"
      : "自主計画は戦闘規則の補完を待っている。現在は自動的に行動を実行しない。";
  }

  checkbox.addEventListener("change", () => {
    try {
      store.setEnemyAutonomy(checkbox.checked);
      sync();
    } catch (error) {
      console.error(error);
      sync();
      status.textContent = error.message;
    }
  });

  const unsubscribe = store.subscribe(sync);
  sync();

  return () => {
    unsubscribe();
    panel.remove();
  };
}
