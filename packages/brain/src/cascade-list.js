/** 现役联动API的纯报告格式化；数据库格子由API直接查询，图半径由独立graph API提供。 */
export function isRunnable(assertionRef) {
  if (!assertionRef) return false;
  return assertionRef.startsWith('tests/') || assertionRef.startsWith('manual:');
}


/**
 * 从格子列表生成 S3 联动清单摘要（thin档，不强制全跑）。
 *
 * @param {Array<{assertion_ref: string|null, na_reason: string|null}>} cells
 * @returns {{ total, runnable_count, nightly_pending_count, unregistered_count, runnable_cells, nightly_pending_cells, report_text }}
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
