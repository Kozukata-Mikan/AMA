import { initializeCatalog } from "./catalog-store.js";

const BRANCH_NAMES = {
  navy: "海軍",
  air: "航空機",
  army: "陸軍",
  special: "特殊"
};

export async function loadUnitData() {
  const files = [
    { branch: "navy", path: "../data/navy.json" },
    { branch: "air", path: "../data/air.json" },
    { branch: "army", path: "../data/army.json" }
  ];

  const groups = await Promise.all(
    files.map(async ({ branch, path }) => {
      const url = new URL(path, import.meta.url);
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(
          `${path} を読み込めません。ステータスコード：${response.status}`
        );
      }

      const list = await response.json();

      if (!Array.isArray(list)) {
        throw new Error(
          `${path} の最上位は配列である必要があります。`
        );
      }

      for (const unit of list) {
        if (
          !unit ||
          typeof unit.id !== "string" ||
          !unit.id.trim() ||
          typeof unit.name !== "string" ||
          !unit.name.trim() ||
          unit.branch !== branch ||
          !Number.isFinite(unit.maxHp) ||
          unit.maxHp <= 0
        ) {
          throw new Error(
            `${path} に書式不正のユニット資料が含まれています。`
          );
        }
      }

      // 内层只返回当前文件的单位列表。
      // 此时外层 units 尚未声明，不能在这里初始化图鉴。
      return list;
    })
  );

  // 所有文件完成加载后，再合并为完整单位列表。
  const units = groups.flat();
  const ids = new Set();

  for (const unit of units) {
    if (ids.has(unit.id)) {
      throw new Error(
        `ユニット ID が重複しています：${unit.id}`
      );
    }

    ids.add(unit.id);
  }

  // 图鉴只在外层初始化。
  // 返回保持同一引用的数组，供沙盘与图鉴编辑器同步使用。
  return initializeCatalog(units).units;
}

export function findUnit(units, unitId) {
  return units.find(unit => unit.id === unitId);
}

export function getUnitsByBranch(units, branch) {
  return units.filter(unit => unit.branch === branch);
}

export function getBranchName(branch) {
  return BRANCH_NAMES[branch] || branch;
}
