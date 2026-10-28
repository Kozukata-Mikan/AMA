// ===== 推演规则入口 =====
// 当前只有框架，没有回合、移动、命中或伤害公式。
// 不得把草案保存当作规则结算成功。
export const TURN_DURATION_MINUTES = 30;

export const TURN_PHASES = Object.freeze([
  Object.freeze({ id: "start", label: "回合開始" }),
  Object.freeze({ id: "movement", label: "移動段階" }),
  Object.freeze({ id: "order-5", label: "次序5" }),
  Object.freeze({ id: "order-4", label: "次序4" }),
  Object.freeze({ id: "order-3", label: "次序3" }),
  Object.freeze({ id: "order-2", label: "次序2" }),
  Object.freeze({ id: "order-1", label: "次序1" }),
  Object.freeze({ id: "pas", label: "PAS" }),
  Object.freeze({ id: "special", label: "特殊詞条判定" }),
  Object.freeze({ id: "end", label: "回合終了" })
]);


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
