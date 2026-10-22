import {
  findUnit,
  getBranchName
} from "./data-store.js";

export function previewAction({
  units,
  instances,
  attackerId,
  targetId,
  actionType
}) {
  if (!attackerId || !targetId) {
    throw new Error("先に行動ユニットと目標ユニットを選択してください。");
  }

  if (attackerId === targetId) {
    throw new Error("行動ユニットと目標ユニットに同一の参戦個体は指定できません。");
  }

  const attacker = instances.find(
    item => item.instanceId === attackerId
  );

  const target = instances.find(
    item => item.instanceId === targetId
  );

  if (!attacker || !target) {
    throw new Error("選択した参戦ユニットが存在しません。再選択してください。");
  }

  const attackerBase = findUnit(units, attacker.unitId);
  const targetBase = findUnit(units, target.unitId);

  if (!attackerBase || !targetBase) {
    throw new Error("選択したユニットの図鑑資料がありません。");
  }

  return [
    "「作戦指揮データ」への接続に成功しました。",
    "",
    `行動種別：${actionType}`,
    `行動ユニット：${attackerBase.name}`,
    `行動側の面目：${getBranchName(attackerBase.branch)}`,
    `行動側の現在耐性：${attacker.currentHp}`,
    "",
    `目標ユニット：${targetBase.name}`,
    `目標の面目：${getBranchName(targetBase.branch)}`,
    `目標の現在耐性：${target.currentHp}`,
    "",
    "現在は接続プレビューのみで、戦闘計算式は未設定です。",
    "今回の操作では参戦状態を変更していません。",
    "攻撃可否、射程および防空規則は今後実装します。"
  ].join("\n");
}
