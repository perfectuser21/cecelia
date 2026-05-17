/**
 * goal-eval-plugin.js — Brain v2 Phase D1.7c-plugin1
 *
 * 抽出 tick-runner.js Goal Outer Loop 评估段（原 §0.5.5 「每 24 小时评估一次活跃 KR」）。
 *
 * 行为（与原 inline 严格等价）：
 *  - 节流：GOAL_EVAL_INTERVAL_MS（默认 24h）一次，使用 tickState.lastGoalEvalTime
 *  - 先 mark 时间戳再 try（即使内部抛错也不立即重试，与原行为一致）
 *  - 调用 evaluateGoalOuterLoop(GOAL_EVAL_INTERVAL_MS)
 *  - 失败非致命：吞错打 console.error
 *  - 仅在 stalledCount > 0 时 push action（保持原行为）
 */

const GOAL_EVAL_INTERVAL_MS = parseInt(
  process.env.CECELIA_GOAL_EVAL_INTERVAL_MS || String(24 * 60 * 60 * 1000),
  10
);

/**
 * Plugin tick: Goal Outer Loop 评估（每 24h）
 *
 * @param {Date} _now
 * @param {object} tickState - 必带 lastGoalEvalTime: number
 * @returns {Promise<{ran:boolean, actions:Array<object>}>}
 */
export async function tick(_now, tickState) {
  if (!tickState) return { ran: false, actions: [] };

  const elapsed = Date.now() - tickState.lastGoalEvalTime;
  if (elapsed < GOAL_EVAL_INTERVAL_MS) {
    return { ran: false, actions: [] };
  }

  // 先 mark 时间戳：保持与原 inline 行为一致
  tickState.lastGoalEvalTime = Date.now();

  const actions = [];
  try {
    const { evaluateGoalOuterLoop } = await import('./goal-evaluator.js');
    const goalResults = await evaluateGoalOuterLoop(GOAL_EVAL_INTERVAL_MS);
    if (goalResults.length > 0) {
      const stalledCount = goalResults.filter(r => r.verdict === 'stalled').length;
      const attentionCount = goalResults.filter(r => r.verdict === 'needs_attention').length;
      console.log(
        `[tick] Goal outer loop: ${goalResults.length} goals evaluated, ` +
        `${stalledCount} stalled, ${attentionCount} needs_attention`
      );
      if (stalledCount > 0) {
        actions.push({
          action: 'goal_outer_loop',
          evaluated: goalResults.length,
          stalled: stalledCount,
          needs_attention: attentionCount,
        });
      }
    }
  } catch (goalEvalErr) {
    console.error('[tick] Goal outer loop evaluation failed (non-fatal):', goalEvalErr.message);
  }

  return { ran: true, actions };
}

// 测试钩子
export const _GOAL_EVAL_INTERVAL_MS = GOAL_EVAL_INTERVAL_MS;
