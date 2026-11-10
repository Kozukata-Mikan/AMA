// attack-order-runtime.js

/**
 * 攻击阶段按5→4→3→2→1推进。
 * 提前登记低次序武器时，自动安排到其最高次序。
 * 已经到达更低次序时，在当前次序执行，不回退。
 *
 * PAS由调用方保留原有规则，不经过此函数。
 */
export function resolveAttackExecutionPhase(
  currentPhaseId,
  highestOrder
) {
  const match = /^order-([1-5])$/.exec(currentPhaseId);

  if (!match) {
    throw new Error(
      "攻撃次序の自動分類は次序1～5でのみ使用できます。"
    );
  }

  if (
    !Number.isSafeInteger(highestOrder) ||
    highestOrder < 1 ||
    highestOrder > 5
  ) {
    throw new Error(
      "武器の最高次序が未登録または不正です。"
    );
  }

  const currentOrder = Number(match[1]);
  const executionOrder = Math.min(
    currentOrder,
    highestOrder
  );

  return {
    executionOrder,
    executionPhaseId: `order-${executionOrder}`,
    deferred: executionOrder < currentOrder
  };
}
