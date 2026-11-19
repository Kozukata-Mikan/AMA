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
      "自律行動が無効の場合、観察陣営を味方・敵・中立から選び、その陣営のユニットを手動操作します。有効の場合は味方を操作し、敵と中立の艦船は自律行動します。観察陣営は味方に固定されます。",
      "設定はラウンド開始または移動段階で切り替えられます。敵・中立の手動計画が残っている場合は、取り消してから自律行動を有効にしてください。",
      "観察陣営による制限は地図・詳細・目標選択・観察JSONに適用されます。敵・中立の行動方針は第17章を参照してください。"
    ]
  },
  {
    title: "2. 共通のラウンド進行",
    paragraphs: [
      "すべての陣営が同じ時間軸で行動します。ラウンド開始 → 移動 → 次序5・4・3・2・1 → PAS → 特殊効果判定 → ラウンド終了の順に進みます。",
      "「移動段階へ」で移動計画を受け付けます。計画を保存した後、「全陣営の移動を処理」で次序5に進みます。攻撃段階では「現在の攻撃段階を一括結算」で一段階ずつ進めます。今の段階で実行する計画が0件でも結算できます。",
      "「特殊段階を処理」で火災・浸水・設備損管・救助などを判定します。「ラウンド終了を処理（30分進行）」の保存が成功したときに、次ラウンドへ進み、時刻が30分進みます。"
    ]
  },
  {
    title: "3. 次序と同時処理",
    paragraphs: [
      "攻撃は次序5・4・3・2・1の順に発生します。高い次序が先に処理されます。",
      "同じ次序の攻撃は、その次序の開始時点の状態に基づいて実行資格を判定します。この時点で実行資格を満たして発動した攻撃は、攻撃側が同じ次序中に撃沈されても取り消されません。",
      "例：2隻が次序4の攻撃を発動した場合、一方が次序4で撃沈されても、その艦の次序4攻撃は有効です。次序5ですでに撃沈された艦は次序4に参加できません。",
      "現在が次序5、武器の最高次序が3なら、計画は次序3まで待機します。現在が次序2なら、その武器を次序2で使用できます。"
    ]
  },
  {
    title: "4. 実体攻撃と迎撃（構想）",
    paragraphs: [
      "実体攻撃は、発射後にマップ上で選択・撃破できる実体として扱う構想です。迎撃側の武器の次序は、実体攻撃と同じかそれ以上であることが次序条件です。",
      "この構想では、次序1の後に残った実体をPASで処理します。現在の推演では独立した実体の生成・移動・迎撃・迎撃後の被害処理は未接続です。"
    ]
  },
  {
    title: "5. PAS",
    paragraphs: [
      "最高次序がPASの装備は、次序1～5で計画を事前登録できます。実際の発射・命中・被害は、次序1の後のPAS段階で一括結算します。通常武器はPASで使用できません。",
      "自律行動が有効なら、敵・中立の使用可能なPAS装備も同じ条件で計画されます。手動操作の陣営では、武器と目標を指定して計画を保存してください。",
      "PAS装備による攻撃結算は利用できます。残存実体への自動迎撃は第4章の構想に属します。"
    ]
  },
  {
    title: "6. 現在の対応範囲",
    paragraphs: [
      "推演では、艦船の移動・撞撃・通常攻撃・PAS装備の攻撃・特殊段階・救助・自然沈没・時刻更新を処理できます。敵・中立には対応済みの艦船ルールを使う自律行動があります。",
      "戦闘用の計画は、移動欄・攻撃欄・救助欄の専用操作から登録します。補助欄の行動草案はメモ用の記録です。",
      "正式な規則や必要な図鑑データが不足している処理では、結算を止めて理由を表示します。画面に説明がある機能でも、構想・未接続と記した処理は現在の推演で実行できません。"
    ]
  },
  {
    title: "7. 艦船の耐性と損傷状態",
    paragraphs: [
      "耐性は艦船固有の生命値です。初めて被害を受けた際、耐性が減少しなければ「軽微な損傷」、減少すれば「小破」となります。中破・大破の条件を満たした場合は、そちらを優先します。",
      "残り耐性が最大耐性の半分以下、かつ0より大きい場合は「中破」です。耐性が0になると「大破」ですが、ほかの行動条件を満たせば移動・攻撃できます。",
      "大破した後、さらに耐性を減少させる効果のある攻撃を受けると「沈没寸前」となり、行動できません。沈没寸前でさらに被害を与える攻撃を受けるか、自然沈没の計時が120分に達すると「沈没」します。",
      "大破時の耐性はすでに0です。次の攻撃が耐性を減少させる効果を持つかどうかは、表示上の耐性の差ではなく、攻撃の判定結果で確認します。"
    ]
  },
  {
    title: "8. 救助と自然沈没",
    paragraphs: [
      "移動段階で、救助艦と沈没寸前の対象艦を指定して救助計画を保存します。移動処理後のXY距離が2マス以下なら開始できます。救助中は両艦が移動・攻撃などの他の行動を行えません。",
      "開始ラウンドを第1ラウンドと数え、第2ラウンドの特殊効果判定でコインを1枚投げます。表なら対象艦は大破に戻り、裏なら沈没します。救助艦がARの場合は判定に必ず成功します。大破に戻っても耐性値は回復しません。",
      "ラウンド終了時、救助中の対象艦は自然沈没の計時を停止します。救助艦の行動不能や距離超過などで中断した場合は、停止していた分を加算します。救助中でない沈没寸前の艦は、ラウンド終了ごとに30分を加算し、120分に達すると自然沈没します。"
    ]
  },
  {
    title: "9. 強度",
    paragraphs: [
      "水中の数字威力攻撃では、強度による防御が残っている間は、威力を1に抑えて防御回数を1回消費します。初期回数は艦船の強度値と同じです。ラウンド開始、再読み込み、編隊変更によって自動回復しません。",
      "慣性攻撃では、艦船本来の装甲の代わりに強度に対応する装甲等級を使用します。対応は0＝F、1＝E、2＝D、3＝C、4＝B、5＝A、6＝S、7＝Uです。",
      "数字威力（水下）では水下威力の処理を先に適用します。誘爆判定に失敗した命中は、被害や浸水を発生させず、防御回数も消費しません。"
    ]
  },
  {
    title: "10. 探測強度と偵察",
    paragraphs: [
      "対海偵察の通常距離は400マスを基準とし、時刻と天候の減少を合算します。黒夜は100、黎明・夕焼は50を差し引きます。天候では青色が50、黄色が100（高温・結氷を除く）、橙色・赤色が200です。",
      "通常距離内で対海偵察等級が対象の探測強度以上なら、対象を影として発見します。等級順はF・E・D・C・B・A・S・Uです。探測強度Cの艦を通常距離で発見するにはC以上が必要です。",
      "XY距離100マス以下では等級・時刻・天候の条件を問わず識別できます。通常の発見と近距離識別のどちらにも地形遮蔽が適用されます。遮蔽は実際の地形の三角形で判定します。",
      "対海偵察が損傷した艦は新たな対海発見を行えません。損傷前の発見は、その艦の情報として損傷ラウンド中だけ残ります。ほかの艦による発見も陣営の観察結果に反映されます。通常距離の等級判定は現在、海軍同士に対応しています。"
    ]
  },
  {
    title: "11. 艦船の速力と航続距離",
    paragraphs: [
      "1ラウンドの最大移動距離は、速力（ノット）×1.852÷0.4を計算し、小数部分を切り捨てた値です。例：27ノットなら基準は125マスです。浸水や残り航続距離によって、実際に移動できる距離は短くなります。",
      "移動後は、実際に通った航跡の最後の進行方向へ艦艏が向きます。編隊全体の移動では各艦が同じ航向へ向き、相互の配置は維持します。陸地や接触で全く動けなかった艦の方位は変わりません。",
      "行動側は、まず編隊を選び、次に所属する単艦を選びます。「編隊なし」には未所属艦のみ表示します。移動では単艦欄の「編隊全体を操作」から全艦へ指示できます。編隊円内でも指示線付きの👑総旗艦・分旗艦マークを表示します。分艦隊徽章は♛后・♞馬・♜車・♝主教から選べます。",
      "総移動可能距離も、航続距離×1.852÷0.4を切り捨てて求めます。実際に移動した距離を残り航続距離から差し引きます。ラウンド開始や再読み込みによる補充はありません。",
      "編隊をまとめて動かす場合、参加する全艦が移動距離の条件を満たす必要があります。分旗艦を選び追随を指定すると、編隊円内の所属艦が相対位置を維持して同時に動きます。既存の別計画と重なる場合は先に取消してください。",
      "「編隊陣形」で艦船を直径50マスの円内に配置できます。自定義では配置を更新し、推演では移動段階のみ、現在の編隊円内にいる所属艦の配置を計画します。円外の艦や他編隊艦は変更しません。「編隊名・円で表示」を選ぶと、地図では編隊名と円を表示し、個艦名を省略します。艦船マークは単艦・編隊とも従来の55%で統一しています。新しい陣形は分旗艦（未指定時は先頭艦）の艦艏を前方として編集し、地図方位へ変換して適用します。旧形式の配置も読み込めます。",
      "編隊を移動主体として選ぶと陣形を保って進みます。速力は参加艦に合わせ、陸地や撞撃で一艦が止まる場合は編隊も停止します。陣形変更の途中で止まった場合は、次の移動で陣形を組み直せます。",
    ]
  },
  {
    title: "12. 装備組と弾薬",
    paragraphs: [
      "残弾・使用ラウンド・損傷は装備組ごとに保存します。同じ武器を複数組搭載していても、発射資格と弾薬は組ごとに確認します。使用済みの組を同じラウンドで再使用することはできません。",
      "正式発射には、一度の完全投射に必要な残弾が必要です。計画を保存した時点では弾を消費せず、結算に成功したときに消費します。再読み込みで弾薬が補充されたり、装備が修復されたりすることはありません。"
    ]
  },
  {
    title: "13. 攻撃計画・射距・射界",
    paragraphs: [
      "自艦と装備組を選び、識別済みの対象を割り当てて「攻撃計画を保存」を押します。武器の範囲定義に従って、単体目標、または編隊と対象メンバーを指定します。",
      "射距は三次元距離で判定します。たとえば三次元距離が228.378で射距125の武器は、対象が識別済みでも発射できません。相対射高、装備位置と艦首の向きによる射界、両舷の使用枠、誘導方式と地形の条件も確認します。",
      "射距や射界などの条件を満たさない組は、理由を表示します。今回の選択が全件不適格なら、その登録は保存されません。目標や装備組を選び直すか、追加登録をせずに段階を一括結算できます。",
      "一括結算は現在の段階に属する全陣営の計画を対象とします。発射前に再検証し、弾薬・命中・被害・履歴をまとめて保存します。将来の次序の計画は保存したまま待機します。",
      "「編隊一括攻撃」では、攻撃する編隊と、単艦または編隊の目標を指定できます。編隊目標では識別済みのメンバーから無作為に候補を選び、射距・射界などを満たす対象に攻撃を割り当てます。未識別の影や未発見艦は選びません。範囲専用武器は従来の範囲攻撃欄で指定します。",
    ]
  },
  {
    title: "14. 命中・装甲・被害",
    paragraphs: [
      "投射率から命中コインを判定し、武器・訓練・目標・環境などに応じた修正を適用します。命中数を確定した後に、武器ごとの威力規則で被害を処理します。",
      "艦砲は穿深と装甲を比較し、命中後のコインと命中部位で結果が変化します。大貫通は耐性3、貫通は1、通常命中は3枚分で耐性1、破砕は0です。通常命中の端数は対象艦に記録します。",
      "通常の数字威力は、穿深が有効装甲を上回れば登録威力、上回らなければ命中1枚につき威力1です。水下威力と設備威力には個別の処理を適用します。"
    ]
  },
  {
    title: "15. 火災・浸水・設備損管",
    paragraphs: [
      "特殊段階では火災と浸水を別々に判定します。表なら対応する状態を解除します。裏なら火災は耐性を1減らし、浸水は基準移動力に対する減少を25ポイント増やします。それぞれ悪化し、失控に達すると沈没寸前になります。",
      "設備は前部・中部①・中部②・両舷・後部・尾部・対海偵察・対空偵察の八項目で扱います。内部損管では、修復可能な損傷項目から一つを抽選して判定します。成功なら復旧し、失敗ならその項目は完全破損します。",
      "艦船救助は第8章の手順で実行できます。別の艦に設備を直させる「外部設備修復」は、新規計画の登録を受け付けていません。"
    ]
  },
  {
    title: "16. 航跡・地形・撞撃",
    paragraphs: [
      "移動結算では、指定した終点までの航跡を使います。水面艦の航跡が陸地に入る場合は、その手前で停止します。",
      "同じ層の艦船のうち、少なくとも一方が移動中に両艦が1マスまで接近すると、その時刻の位置で止めて撞撃を処理します。航跡が交差しても、通過時刻がずれて接触しなければ撞撃は発生しません。",
      "撞撃では各艦が自艦の最大耐性の半分（端数切り上げ）の被害を受けます。沈没艦に接触した場合は航跡を停止します。撞撃は武器命中とは別の処理です。"
    ]
  },
  {
    title: "17. 敵・中立の自律行動と交戦距離",
    paragraphs: [
      "敵艦は観察で発見した味方艦へ接近します。中破前は、現在使用可能な武器1組が完全投射し、すべて命中した場合の単艦に対する最大耐性被害を比較します。最大耐性被害が同じなら射距が長い武器を選びます。",
      "選んだ主戦武器の射距の半分を接近の目安にします。射距125なら62.5マスです。すでにその距離以内にいる場合や、比較に使える武器がない場合は、その場に留まります。中破・大破でも行動可能な艦は、従来どおり対象へ近づきます。",
      "半射距は移動の方針です。自律攻撃では識別済みの対象に対し、実際の射距・射界・残弾などを確認して合法な攻撃計画を立てます。",
      "中立艦は観察できる他陣営から距離を取ろうとします。攻撃では、自陣営を攻撃した記録があり、現在識別できる相手が反撃の対象です。救助を選ぶ場合も、通常の開始・継続条件が適用されます。"
    ]
  },
  {
    title: "18. 地図表示・時刻・戦闘記録",
    paragraphs: [
      "距離を読むときは「距離グリッドを表示」を使います。XYは5マスが1km、Zは1マスが100mです。垂直誇張倍率は地形の見た目を調整し、高度の数値・射線・移動の判定には実高度を使います。",
      "シナリオ時刻によって白昼・黒夜・黎明・夕焼の表示が変わります。黎明の赤みは東、夕焼の赤みは西です。偵察距離に使う補正は第10章を参照してください。",
      "自律行動を無効にしてラウンドを終えると、「ラウンド戦闘記録」で観察陣営の記録を確認できます。攻撃・被弾・撞撃は自陣営が関わったものを表示します。相手艦が結算時に未確認だった場合、後から識別しても記録の艦名は変わりません。",
      "「観察JSONを書き出し」は、現在の観察陣営に見えている情報を書き出します。「推演を終了」した後は地図と戦闘記録を確認できます。終了後の推演では行動や段階を進められないため、終局を確定する際に使います。"
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
    "推演モードの操作と判定を説明します。目次を選ぶか、「射距」「損管」「撞撃」などの用語で検索できます。",
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
      ? "観察は味方に固定。敵・中立の艦船は自律行動します。"
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

