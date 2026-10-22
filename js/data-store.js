const BRANCH_NAMES = {
  navy: "海軍",
  air: "航空機",
  army: "陸軍"
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
        throw new Error(`申し訳ありません！ ${path}，ステータスコード：${response.status}`);
      }

      const list = await response.json();

      if (!Array.isArray(list)) {
        throw new Error(`${path} の最上位は配列である必要があります。`);
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
          throw new Error(`${path} に書式不正の部隊資料が含まれています。`);
        }
      }

      return list;
    })
  );

  const units = groups.flat();
  const ids = new Set();

  for (const unit of units) {
    if (ids.has(unit.id)) {
      throw new Error(`ユニットIDが重複しています：${unit.id}`);
    }

    ids.add(unit.id);
  }

  return units;
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
