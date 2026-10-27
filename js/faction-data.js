// ===== 颜色阵营 =====
// faction 是资料归属；side 是当前作战关系，两者互不替代。

export const FACTIONS = [
  ["orange", "橙色", "#f59e0b"],
  ["blue", "青色（ブルー）", "#3b82f6"],
  ["red", "赤色", "#ef4444"],
  ["crimson", "緋紅色", "#dc143c"],
  ["scarlet", "猩紅色", "#ff2400"],
  ["dark-red", "暗紅色", "#8b0000"],
  ["black", "黒色", "#000000"],
  ["silver", "銀色", "#c0c0c0"],
  ["gold", "金色", "#ffd700"],
  ["purple", "紫色", "#a855f7"],
  ["yellow", "黄色", "#facc15"],
  ["white", "白色", "#ffffff"],
  ["cyan", "青緑色（シアン）", "#22d3ee"]
];

export const FACTION_OPTIONS = [
  ["", "未設定"],
  ...FACTIONS.map(([id, label]) => [id, label])
];

export function normalizeFaction(value = "") {
  if (
    typeof value !== "string" ||
    (
      value !== "" &&
      !FACTIONS.some(([id]) => id === value)
    )
  ) {
    throw new Error("色陣営の値が不正です。");
  }

  return value;
}

export function getFactionName(value = "") {
  return FACTIONS.find(([id]) => id === value)?.[1] ?? "未設定";
}
