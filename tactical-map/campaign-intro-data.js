const TEXT_FIELDS = [
  ["title", "主タイトル", 100],
  ["subtitle", "副タイトル", 100],
  ["annotation", "注記", 300],
  ["declaration", "宣言", 1000]
];

export function normalizeCampaignIntro(value) {
  // 旧战役没有介绍：默认关闭，不改旧存档文件。
  if (value === undefined || value === null) value = {};

  if (
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error("戦役紹介のデータ形式が不正です。");
  }

  if (value.version !== undefined && value.version !== 1) {
    throw new Error("対応していない戦役紹介の形式です。");
  }

  if (
    value.enabled !== undefined &&
    typeof value.enabled !== "boolean"
  ) {
    throw new Error("戦役紹介の表示設定が不正です。");
  }

  const badge = value.badge ?? "";

  if (
    typeof badge !== "string" ||
    (
      badge !== "" &&
      (
        badge.length > 1500000 ||
        !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/
          .test(badge)
      )
    )
  ) {
    throw new Error("徽章画像の保存形式が不正です。");
  }

  const result = {
    version: 1,
    enabled: value.enabled ?? false,
    badge
  };

  for (const [key, label, limit] of TEXT_FIELDS) {
    const text = value[key] ?? "";

    if (typeof text !== "string" || text.length > limit) {
      throw new Error(`${label}は${limit}文字以内にしてください。`);
    }

    result[key] = text;
  }

  return result;
}
