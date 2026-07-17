/**
 * S3 联动清单（MJ5 刀3）
 *
 * 给定改动文件列表，从 journey_step_links 拉出被影响的断言清单，
 * 分类为"可立即跑"（tests/ 或 manual:）和"待 nightly 覆盖"（其他）。
 *
 * 消费方：harness-evaluator（Step B-0.5）、POST /api/brain/cascade-list
 */

/**
 * 判断 assertion_ref 是否可立即运行（thin档判定规则）。
 *
 * - tests/ 路径：vitest / jest 测试文件，可直接跑
 * - manual: 前缀：白名单命令，可直接执行
 * - 其他（L3:真机/null）：待 nightly 覆盖
 *
 * @param {string|null} assertionRef
 * @returns {boolean}
 */
export function isRunnable(assertionRef) {
  if (!assertionRef) return false;
  return assertionRef.startsWith('tests/') || assertionRef.startsWith('manual:');
}

/**
 * 从格子列表生成 S3 联动清单摘要（thin档，不强制全跑）。
 *
 * @param {Array<{assertion_ref: string|null, na_reason: string|null}>} cells
 *   journey_step_links 行，每行含 assertion_ref 和 na_reason
 * @returns {{
 *   total: number,
 *   runnable_count: number,
 *   nightly_pending_count: number,
 *   unregistered_count: number,
 *   runnable_cells: Array,
 *   nightly_pending_cells: Array,
 *   report_text: string,
 * }}
 */
export function buildCascadeReport(cells) {
  const runnable = cells.filter(c => isRunnable(c.assertion_ref));
  const nightly_pending = cells.filter(c => c.assertion_ref && !isRunnable(c.assertion_ref));
  const unregistered = cells.filter(c => !c.assertion_ref && !c.na_reason);

  const report_text =
    `本次改动波及 ${cells.length} 个步骤断言，` +
    `可立即跑 ${runnable.length} 个，` +
    `待 nightly 覆盖 ${nightly_pending.length} 个，` +
    `未登记断言 ${unregistered.length} 个`;

  return {
    total: cells.length,
    runnable_count: runnable.length,
    nightly_pending_count: nightly_pending.length,
    unregistered_count: unregistered.length,
    runnable_cells: runnable,
    nightly_pending_cells: nightly_pending,
    report_text,
  };
}
