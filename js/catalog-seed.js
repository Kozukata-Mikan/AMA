// ===== 图鉴初始资料与字段定义 =====
// 界面文案使用日文，注释使用中文。
// 未确定的规则只保存参数，不执行计算。
// 保存稳定的词条ID；具体战斗效果由推演规则接入。
export const TRAINING_TRAIT_OPTIONS = [
  {
    id: "high-training",
    label: "高練度",
    definition: "命中判定に有利判定1回。"
  },
  {
    id: "low-training",
    label: "低練度",
    definition: "命中判定に不利判定1回。"
  },
  {
    id: "one-against-thousand",
    label: "一騎当千",
    definition:
      "中破後、各ラウンドに50％の確率で発動。有利判定2回。"
  },
  {
    id: "night-training",
    label: "夜間特訓",
    definition: "時間帯が夜間の場合、有利判定1回。"
  },
  {
    id: "underwater-training",
    label: "水雷特訓",
    definition: "水中武器による攻撃の場合、有利判定1回。"
  },
  {
    id: "excellent-sea-fire-control",
    label: "優秀な対海射撃管制",
    definition:
      "対海偵察がA以上の場合、海軍・陸軍目標への攻撃に有利判定1回。"
  },
  {
    id: "excellent-air-fire-control",
    label: "優秀な対空射撃管制",
    definition:
      "対空偵察がA以上の場合、航空機・特殊目標への攻撃に有利判定1回。"
  },
  {
    id: "poor-sea-armament",
    label: "劣悪な対海兵装",
    definition: "海軍・陸軍目標への攻撃に不利判定1回。"
  },
  {
    id: "poor-air-armament",
    label: "劣悪な対空兵装",
    definition: "航空機・特殊目標への攻撃に不利判定1回。"
  }
];

export function getTrainingTraitLabel(id) {
  return TRAINING_TRAIT_OPTIONS.find(item => item.id === id)?.label ?? id;
}

export const UNIT_FIELDS = [
   {
    key: "name",
    label: "名称",
    type: "text",
    definition: "図鑑の表示名。個体名は参戦追加時に選択できます。"
  },
  {
    key: "branch",
    label: "軍種",
    type: "branch",
    definition: "海軍・航空機・陸軍・特殊の分類。配置条件と表示形状に使用します。"
  },
  {
    key: "naval.type",
    label: "属性",
    type: "text",
    definition: "BB などの属性コード。詳細な適用ルールは後で接続します。"
  },
  {
    key: "sizeLevel",
    label: "体型",
    type: "size",
    definition: "1～5 のサイズ。地図上のユニット表示サイズと配置条件に直接使用します。"
  },
  {
    key: "maxHp",
    label: "耐性 / 最大生命",
    type: "number",
    definition: "基礎最大生命値。参戦個体の現在生命をこの値で初期化します。"
  },
  {
    key: "naval.strength",
    label: "強度",
    type: "optional-number",
    definition: "独立した強度パラメーター。計算式は未設定です。"
  },
  {
    key: "faction",
    label: "初期色陣営",
    type: "faction",
    definition: "参戦追加時に引き継ぐ資料上の色陣営。味方・敵・中立とは独立しています。"
  },
  {
    key: "protected",
    label: "編集保護",
    type: "checkbox",
    definition:
      "有効にすると変更・削除・保護解除に編集パスワードが必要です。" +
      "閲覧と地図への追加は制限しません。"
  },
  {
    key: "naval.detection",
    label: "探測強度",
    type: "text",
    definition: "探測能力の等級。等級表と偵察能力との組合せ式は未設定です。"
  },
  {
    key: "naval.seaRecon",
    label: "対海偵察",
    type: "text",
    definition: "海上目標に対する偵察能力の等級。判定式は未設定です。"
  },
  {
    key: "naval.airRecon",
    label: "対空偵察",
    type: "text",
    definition: "航空目標に対する偵察能力の等級。判定式は未設定です。"
  },
  {
    key: "naval.armor",
    label: "装甲",
    type: "text",
    definition: "防護等級。将来、装備の穿深との比較に使用します。比較表は未設定です。"
  },
  {
    key: "naval.speedKnots",
    label: "航速（ノット）",
    type: "optional-number",
    definition: "ノット単位の航行速度。地図距離と行動時間への換算は未設定です。"
  },
  {
    key: "naval.endurance",
    label: "続航力",
    type: "text",
    definition: "続航距離の原表記。7.2k などを保持します。単位と消費計算は未設定です。"
  },
   {
    key: "trainingTraits",
    label: "練度・特訓・特殊能力",
    type: "training-traits",
    definition:
      "該当する項目を複数選択できます。未選択の場合、補正はありません。" +
      "図鑑では能力を登録し、発動判定と補正計算は推演で行います。"
  }
];

export const EQUIPMENT_FIELDS = [
  {
    key: "name",
    label: "装備名",
    type: "text",
    definition: "装備の名称。連装数や艦船上の装備組数を名称に含める必要はありません。"
  },
  {
    key: "faction",
    label: "所属色陣営",
    type: "faction",
    definition: "装備資料の色陣営。搭載艦の色陣営や作戦関係とは独立しています。"
  },
  {
    key: "kind",
    label: "装備種別",
    type: "equipment-kind",
    definition: "weapon は武器、support は支援装備。種別だけでは戦闘能力を決定しません。"
  },
  {
    key: "barrelCount",
    label: "砲身数 / 連装数",
    type: "optional-number",
    definition: "装備 1 組あたりの砲身数。投射率 X × YR の Y に対応します。非砲身装備は空欄です。"
  },
  {
    key: "projectionCoefficient",
    label: "投射率の X",
    type: "optional-number",
    definition: "投射率 X × YR の X。式の計算上の意味は後で定義します。"
  },
  {
    key: "projectionSuffix",
    label: "投射率の接尾記号",
    type: "text",
    definition: "R などの原表記。現段階では時間や弾数への換算を行いません。"
  },
  {
    key: "note",
    label: "備考",
    type: "text",
    definition: "補足説明。文章を自動的にルール効果として解釈しません。"
  },
  {
    key: "slot",
    label: "スロット",
    type: "text",
    definition: "取付制限・占有仕様の原表記。空欄や - をゼロ占有として扱いません。"
  },
  {
    key: "powerRule",
    label: "威力 / 参照ルール",
    type: "text",
    definition: "傷害計算に使用する規則名または原表記。艦砲規則の式はまだ接続していません。"
  },
  {
    key: "penetration",
    label: "穿深",
    type: "text",
    definition: "装甲貫通能力の等級。「-」は穿深0を表します。" +
      "図鑑の編集・保存だけでは傷害計算を実行しません。"
  },
  {
    key: "ceilingU",
    label: "射高（u）",
    type: "optional-number",
    definition: "射撃高度制限の値。高度の基準面と判定方法は未設定です。"
  },
  {
    key: "range",
    label: "射距",
    type: "optional-number",
    definition: "攻撃距離制限の値。距離単位と地図上の換算は未設定です。"
  },
  {
    key: "maxOrder",
    label: "最高次序",
    type: "text",
    definition: "参加可能な攻撃次序の原表記。数字や PAS を保持し、未定義のまま数値計算しません。"
  },
  {
    key: "guidance",
    label: "引導方式",
    type: "text",
    definition: "抛射・平射などの攻撃方式。対応する軌道・判定規則は未設定です。"
  },

  {
    key: "targetScope",
    label: "攻撃範囲",
    type: "text",
    definition: "集群・単体などの目標選択粒度。集群全員への自動傷害を意味するものではありません。"
  },
  {
    key: "ammo",
    label: "予備弾数",
    type: "optional-number",
    definition:
      "装備1組の初期予備弾数。0以上の整数で指定します。" +
      "0は残弾なし、空欄は未登録であり、無限弾薬を意味しません。" +
      "攻撃時の消費量は投射表記に基づきます。"
  }
];

export const EXTRA_DEFINITIONS = [
  ["艦名", "同じ艦級テンプレートから作成する個体の名称候補。名称自体は能力補正を与えません。"],
  ["装備位置", "装備の取付区域。射界や局部損傷の規則は未設定です。"],
  ["装備組数", "その区域に取り付ける装備の組数。装備 1 組の砲身数とは別の値です。"],
  ["総砲身数", "装備組数 × 1 組あたりの砲身数で算出する構造上の集計です。攻撃回数ではありません。"],
  ["搭載機", "搭載航空機の名称と機数。航空機性能が未登録のため、今回は参戦航空機として自動生成しません。"]
];

function gun(
  id,
  name,
  barrelCount,
  projectionCoefficient,
  penetration,
  ceilingU,
  range,
  maxOrder,
  guidance,
  targetScope
) {
  return {
    id,
    name,
    kind: "weapon",
    barrelCount,
    projectionCoefficient,
    projectionSuffix: "R",
    ammo: null,
    note: "",
    slot: "-",
    powerRule: "舰炮规则",
    penetration,
    ceilingU,
    range,
    maxOrder: String(maxOrder),
    guidance,
    targetScope
  };
}

export function createCatalogSeed() {
  const equipment = [
    gun(
      "eq-type94-460-triple",
      "九四式460mm舰炮",
      3, 1, "S+", 150, 200, 2, "抛射", "集群"
    ),
    gun(
      "eq-type3-155-triple",
      "三年式155mm舰炮",
      3, 2, "D++", 120, 75, 1, "抛射", "集群"
    ),
    gun(
      "eq-type89-127-twin",
      "八九式127mm两用炮",
      2, 3, "D--", 120, 75, 1, "抛射", "集群"
    ),
    gun(
      "eq-type96-25-triple",
      "九六式25mm高射炮",
      3, 1, "F-", 70, 25, 1, "平射", "单体"
    ),
    gun(
      "eq-13-2-twin",
      "13.2mm高射机枪",
      2, 1, "-", 50, 25, "PAS", "平射", "单体"
    ),
    {
      id: "eq-seaplane-catapult",
      name: "水上飞机弹射器",
      kind: "support",
      barrelCount: null,
      projectionCoefficient: null,
      projectionSuffix: "",
      ammo: null,
      note: "性能と装備組数は未登録。",
      slot: "",
      powerRule: "",
      penetration: "",
      ceilingU: null,
      range: null,
      maxOrder: "",
      guidance: "",
      targetScope: ""
    }
  ];

  const units = [
    {
      id: "navy-yamato-class-1941",
      name: "大和级（1941）",
      branch: "navy",
      maxHp: 18,
      sizeLevel: 5,
      description: "",
      hullNames: ["大和号", "武藏号"],

      naval: {
        type: "BB",
        strength: 3,
        detection: "E",
        seaRecon: "C",
        airRecon: "C",
        armor: "B-",
        speedKnots: 27,
        endurance: "7.2k"
      },

      mounts: [
        {
          position: "前部",
          equipmentId: "eq-type94-460-triple",
          count: 2
        },
        {
          position: "中部①",
          equipmentId: "eq-type3-155-triple",
          count: 2
        },
        {
          position: "中部②",
          equipmentId: "eq-type3-155-triple",
          count: 2
        },
        {
          position: "两舷",
          equipmentId: "eq-type89-127-twin",
          count: 6
        },
        {
          position: "两舷",
          equipmentId: "eq-type96-25-triple",
          count: 8
        },
        {
          position: "两舷",
          equipmentId: "eq-13-2-twin",
          count: 2
        },
        {
          position: "后部",
          equipmentId: "eq-type94-460-triple",
          count: 1
        },
        {
          position: "尾部",
          equipmentId: "eq-seaplane-catapult",
          count: null
        }
      ],

      embarked: [
        {
          name: "F1M2_零式水观",
          count: 7
        }
      ]
    }
  ];

  return { units, equipment };
}

export function getBarrelLabel(count) {
  if (count === null || count === undefined) return "";

  const labels = {
    1: "単装",
    2: "双聯装",
    3: "三聯装",
    4: "四聯装"
  };

  return labels[count] ?? `${count} 聯装`;
}

export function getEquipmentLabel(item) {
  return [
    getBarrelLabel(item.barrelCount),
    item.name
  ].filter(Boolean).join(" ");
}

export function getProjectionLabel(item) {
  if (
    item.projectionCoefficient === null ||
    item.barrelCount === null
  ) {
    return "未設定";
  }

  return (
    `${item.projectionCoefficient} × ` +
    `${item.barrelCount}${item.projectionSuffix}`
  );
}
