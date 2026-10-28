// ===== 推演规则入口 =====
// 当前只有框架，没有回合、移动、命中或伤害公式。
// 不得把草案保存当作规则结算成功。

export const RULESET = Object.freeze({
  id: "framework-only",
  version: 1,
  ready: false
});

export function evaluateAction() {
  return {
    allowed: false,
    code: "RULES_NOT_CONFIGURED",
    reason: "推演ルールが未登録です。行動の実行と裁定はできません。"
  };
}
