// 本模块不修改地图，不执行伤害，不自动推进回合。

import { TURN_PHASES } from "./rules-engine.js";

// 规则书使用实际存档阶段ID，不另造select／resolve阶段。
export const SIMULATION_PHASES = TURN_PHASES;


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

// ===== 舰船规则书补充 =====
// 这里只添加日语说明，不执行战斗或推进时间。

CHAPTERS.push(
  {
    title: "7. 艦船の耐性と損傷状態",
    paragraphs: [
      "耐性は艦船固有の生命値です。攻撃によって耐性が減少し、損傷状態が変化します。",
      "初めて被害を受けた際、耐性が減少しなければ「軽微な損傷」、減少すれば「小破」となります。ただし、中破・大破の条件を満たした場合は、そちらを優先します。",
      "残り耐性が最大耐性の半分以下、かつ0より大きい場合は「中破」です。",
      "耐性が0になると「大破」です。耐性0だけで沈没したとは扱いません。また、大破だけを理由に行動不能とは判定しません。",
      "大破した後、さらに耐性を減少させる効果のある攻撃を1回受けると「沈没寸前」になります。沈没寸前の艦船は一切の行動ができません。",
      "沈没寸前の状態で救助されずに2時間（4ラウンド）が経過するか、さらに何らかの被害を与える攻撃を受けると「沈没」となり、撃破されたものとして扱います。",
      "大破時の耐性はすでに0です。そのため、次の攻撃が耐性を減少させる効果を持つかどうかは、表示上の耐性の差ではなく、攻撃の判定結果で確認します。",
      "同じ次序の開始時点で実行資格を満たして発動した攻撃は、その次序中に沈没寸前または沈没になっても取り消されません。"
    ]
  },
  {
    title: "8. 救助",
    paragraphs: [
      "他の艦船は、沈没寸前の艦船に対して「救助」を実行できます。相対距離が2以下であることが必要です。",
      "救助には2ラウンドを要します。救助中は、救助する艦船と救助される艦船の両方が他の行動を実行できません。",
      "救助の2ラウンド目の特殊効果判定で、コインを1枚投げます。",
      "表の場合、救助された艦船の状態を「大破」に変更します。裏の場合、その艦船は沈没します。",
      "救助する艦船の艦種がARの場合、救助判定は必ず成功します。",
      "救助成功による耐性の回復は、現時点では定義されていません。大破への状態変更を、耐性回復と同一視しません。",
      "救助中の沈没猶予時間、開始ラウンドの数え方、救助の中断条件、相対距離の計算方法は、追加定義が必要です。"
    ]
  },
  {
    title: "9. 強度",
    paragraphs: [
      "強度は、水中攻撃と、誘導方式が「慣性」の攻撃に適用されます。",
      "水中攻撃を受けた場合、強度効果が残っていれば、元の威力にかかわらず威力を1に固定します。",
      "この水中攻撃への効果は、艦船の強度値と同じ回数だけ適用できます。使用回数を使い切ると、通常の威力処理に戻ります。",
      "使用回数はラウンド開始、再読み込み、編隊変更によって自動回復しません。",
      "慣性攻撃では、艦船本来の装甲値の代わりに、強度に対応する装甲等級を使用します。",
      "強度と装甲等級の対応：0＝F、1＝E、2＝D、3＝C、4＝B、5＝A、6＝S、7＝U。",
      "装甲等級を使用した具体的なダメージ計算は、装甲ルールの定義待ちです。水中攻撃と慣性攻撃を兼ねる場合の処理順も、追加定義が必要です。"
    ]
  },
  {
    title: "10. 探測強度と偵察",
    paragraphs: [
      "探測強度はユニット自身の隠密性を表します。通常の発見距離は400以下です。",
      "偵察等級が対象の探測強度以上の場合、通常の発見条件を満たします。等級順はF・E・D・C・B・A・S・Uです。",
      "例：探測強度Cの対象は、偵察等級C・B・A・S・Uで発見できます。D・E・Fでは発見できません。",
      "海軍と陸軍の対象には対海偵察を、航空機と特殊ユニットの対象には対空偵察を使用します。",
      "時刻による距離減少：夜間は100、黎明と夕焼けは50。",
      "天候による距離減少：青色は50、黄色は100。ただし高温と結氷はこの減少の対象外です。橙色と赤色は200です。",
      "通常の発見ではユニットの影のみを表示します。名称と詳細情報は表示しません。",
      "距離100以下では、等級・時刻・天候にかかわらず発見でき、名称と詳細情報を表示できます。",
      "ただし、どちらの発見方法でも地形を越えて偵察できません。対象との直線上に高さ30以上の地形障害がある場合、発見できません。",
      "時刻と天候の距離減少を合算するかどうか、距離と地形遮蔽の具体的な計算方法は、接続前に確認が必要です。"
    ]
  },
  {
    title: "11. 艦船の速力と航続距離",
    paragraphs: [
      "1ラウンドの最大移動距離は、速力（ノット）×1.852÷0.4を計算し、小数部分を切り捨てた値です。",
      "例：速力27ノットの艦船は、1ラウンドに最大125マス移動できます。",
      "艦船編隊の最大移動距離は、編隊内で最も速力の低い艦船によって決まります。",
      "総移動可能距離は、航続距離×1.852÷0.4を計算し、小数部分を切り捨てた値です。",
      "実際に移動した距離を各艦船の残り航続距離から差し引きます。待機によって航続距離は消費しません。",
      "残り航続距離は、ラウンド開始や再読み込みによって自動回復しません。",
      "編隊の移動では、すべての参加艦船が速力と残り航続距離の条件を満たす必要があります。",
      "地形による移動制限、移動経路、距離の測定方法は、追加の移動ルールに従います。"
    ]
  },
  {
    title: "12. 艦船ルールの接続状況",
    paragraphs: [
      "上記のルールはルールブックに登録されていますが、記載されていることだけで戦闘処理が実装済みになるわけではありません。",
      "艦船基礎ルールの関数と、実際のユニット資料・保存状態・マップとの接続は分けて管理します。",
      "装甲とダメージ計算が未定義のため、草案を実行済みの攻撃として扱いません。",
      "移動処理と特殊効果判定が未接続の間は、ラウンドと時刻を進めません。"
    ]
  }
);
// 这里只同步说明，不表示对应战斗功能已经接入。
CHAPTERS[0].paragraphs = [
  "自律行動が無効の場合、観察陣営を味方・敵・中立から選択し、その陣営のユニットを手動操作します。",
  "自律行動が有効の場合、観察陣営は味方に固定されます。",
  "敵・中立のAI計画は未実装です。有効にしても自動攻撃や自動移動は発生しません。",
  "観察制限は地図、詳細、選択欄、行動草案、書き出しにも適用されます。"
];

CHAPTERS[3].paragraphs = [
  "実体攻撃は発動後、攻撃側と目標の間の最短経路上に、選択・撃破可能な実体を生成します。",
  "発動済みの攻撃は、同じ次序で発射元が行動不能になっても取り消されません。",
  "迎撃の次序条件を満たすだけでは、迎撃能力や成功は保証されません。",
  "実体の生成、迎撃、被害処理は現在の推演には未接続です。"
];

CHAPTERS[4].paragraphs = [
  "PASは次序0として、次序1～5から残った実体攻撃を処理します。",
  "PAS段階では、残存実体は目標に限りなく近づいたものとして扱います。",
  "自動判定で実体を撃破できれば、その攻撃は無効になります。撃破できなければ対応する被害を処理します。",
  "PAS装備の使用段階はPASに限られます。正式なPAS結算は未接続です。"
];

CHAPTERS[5].paragraphs = [
  "接続済み：陣営別の観察、艦船の移動計画・移動処理、移動後の救助開始、装備組ごとの保存状態。",
  "命中コインの関数は用意されていますが、正式な攻撃結算にはまだ接続していません。",
  "未接続：正式攻撃、実体・PAS、特殊段階の統合処理、ラウンド終了と時刻更新、敵・中立のAI。",
  "移動処理後は次序5で停止します。草案保存は攻撃実行ではなく、時刻も進めません。"
];

CHAPTERS[7].paragraphs = [
  "移動処理後、距離2以下の沈没寸前の艦船に救助を開始できます。",
  "開始したラウンドを第1ラウンドと数え、第2ラウンドの特殊効果判定で救助を判定します。",
  "救助中は、救助艦と対象艦の両方が他の行動を実行できません。",
  "ARによる救助は必ず成功します。それ以外はコインで判定します。",
  "成功すると対象艦は大破に戻ります。耐性は回復しません。",
  "救助中は自然沈没の計時を停止します。中断時は停止期間を補算し、最初に沈没寸前になった時点から4ラウンド経過したか確認します。",
  "現在は救助計画と開始まで接続済みです。特殊段階への統合、中断時の補算、自然沈没の計時は修正・接続待ちです。"
];

CHAPTERS[9].paragraphs[
  CHAPTERS[9].paragraphs.length - 1
] =
  "時刻と天候の距離減少は合算します。地形遮蔽は実際の三角形網格を使用します。現在、通常距離での等級判定は海軍同士に接続済みで、他軍種の資料適合は未接続です。";

CHAPTERS[11].paragraphs = [
  "規則の記載、関数の作成、状態・画面への接続、ブラウザーでの検証は、それぞれ別の進捗です。",
  "装甲・被害・特殊効果の正式な攻撃処理は未接続です。未実装の行動は結算できません。",
  "装備の残弾、使用ラウンド、損傷は装備1組ごとに保存します。再読み込みで補充・修復しません。",
  "全段階の処理が揃うまで、段階の飛ばし処理や時刻の先送りは行いません。"
];


export function mountSimulationRulebook(store) {
  if (document.getElementById("simulationRulesPanel")) {
    throw new Error("ルールブックはすでに表示されています。");
  }

  const aside = document.querySelector("aside");

  if (!aside) {
    throw new Error("推演画面のサイドバーが見つかりません。");
  }

  function element(tag, text = "", className = "") {
    const result = document.createElement(tag);
    result.textContent = text;
    if (className) result.className = className;
    return result;
  }

  function makeButton(text, action) {
    const result = element("button", text);
    result.type = "button";
    result.addEventListener("click", action);
    return result;
  }

  let ownsStyles = false;
  let styles = document.getElementById("simulation-rulebook-styles");

  if (!styles) {
    styles = element("link");
    styles.id = "simulation-rulebook-styles";
    styles.rel = "stylesheet";
    styles.href = new URL(
      "./simulation-rulebook.css",
      import.meta.url
    ).href;
    document.head.append(styles);
    ownsStyles = true;
  }

  // 左栏只放控制与入口，不再塞入规则正文。
  const panel = element("section");
  panel.id = "simulationRulesPanel";
  panel.append(element("h3", "推演制御"));

  const checkbox = element("input");
  checkbox.type = "checkbox";
  checkbox.id = "enemyAutonomy";
  checkbox.style.width = "auto";

  const label = element("label");
  label.append(checkbox, element("span", "敵・中立の自律行動"));

  const status = element("p", "", "note");
  status.setAttribute("aria-live", "polite");

  const dialog = element("dialog", "", "sim-rulebook");
  dialog.id = "simulationRulebookDialog";
  dialog.setAttribute("aria-labelledby", "simulationRulebookTitle");

  const shell = element("div", "", "sim-rulebook-shell");
  const header = element("header", "", "sim-rulebook-header");

  const title = element("h2", "推演ルールブック");
  title.id = "simulationRulebookTitle";

  const close = makeButton("閉じる", () => dialog.close());
  header.append(title, close);

  const toolbar = element("div", "", "sim-rulebook-toolbar");
  const search = element("input");
  search.type = "search";
  search.placeholder = "規則を検索";
  search.setAttribute("aria-label", "章のタイトルと本文を検索");

  const count = element("span");
  count.setAttribute("role", "status");
  count.setAttribute("aria-live", "polite");

  toolbar.append(
    search,
    makeButton("検索をクリア", () => {
      search.value = "";
      renderChapters();
      search.focus();
    }),
    count
  );

  const body = element("div", "", "sim-rulebook-body");
  const navigation = element("nav", "", "sim-rulebook-nav");
  navigation.setAttribute("aria-label", "ルールブックの目次");

  const content = element("main", "", "sim-rulebook-content");
  const notice = element(
    "p",
    "規則の説明と実装状況は別です。未接続の処理は実行できません。",
    "sim-rulebook-notice"
  );

  const chaptersHost = element("div");
  content.append(notice, chaptersHost);
  body.append(navigation, content);
  shell.append(header, toolbar, body);
  dialog.append(shell);
  document.body.append(dialog);

  function renderChapters() {
    navigation.replaceChildren();
    chaptersHost.replaceChildren();

    const term = search.value.trim().toLocaleLowerCase();
    let matched = 0;

    CHAPTERS.forEach((chapter, index) => {
      const searchable = [
        chapter.title,
        ...chapter.paragraphs
      ].join("\n").toLocaleLowerCase();

      if (term && !searchable.includes(term)) return;
      matched += 1;

      const section = element("section", "", "sim-rulebook-chapter");
      const heading = element("h3", chapter.title);
      heading.id = `simulation-rulebook-chapter-${index}`;
      heading.tabIndex = -1;
      section.append(heading);

      const list = element("ul");

      for (const paragraph of chapter.paragraphs) {
        list.append(element("li", paragraph));
      }

      section.append(list);
      chaptersHost.append(section);

      navigation.append(makeButton(chapter.title, () => {
        heading.scrollIntoView({
          behavior: "auto",
          block: "start"
        });
        heading.focus({ preventScroll: true });
      }));
    });

    count.textContent = `${matched} / ${CHAPTERS.length}章`;

    if (!matched) {
      chaptersHost.append(element(
        "p",
        "一致する規則がありません。"
      ));
    }

    content.scrollTop = 0;
  }

  search.addEventListener("input", renderChapters);

  const open = makeButton("ルールブックを開く", () => {
    if (!dialog.open) dialog.showModal();
    search.focus();
  });
  open.setAttribute("aria-haspopup", "dialog");
  open.setAttribute("aria-controls", dialog.id);

  panel.append(label, status, open);
  aside.prepend(panel);

  function sync() {
    const enabled = store.getControlSettings().enemyAutonomy;
    checkbox.checked = enabled;

    status.textContent = enabled
      ? "観察は味方に固定。敵・中立のAIは未実装です。"
      : "観察陣営を切り替えて各陣営を手動操作できます。";
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
  renderChapters();
  sync();

  // 原调用接口保持不变。
  return () => {
    unsubscribe();
    dialog.remove();
    panel.remove();
    if (ownsStyles) styles.remove();
  };
}

