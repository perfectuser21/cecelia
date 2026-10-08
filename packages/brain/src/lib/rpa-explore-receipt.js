/** 探路业务回执不能用执行进程退出码替代；其他工厂阶段保留原协议。 */
export function rpaExploreFailure(task, receipt) {
  if (task.payload?.qiumi_department !== 'skill-factory') return null;
  const text = (receipt.text ?? '').trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1').trim();
  let report;
  try { report = JSON.parse(text); } catch { /* 显式探路任务缺少 JSON 也不能完成。 */ }
  const explicitExplore = /skill-explore/.test(task.payload?.qiumi_source?.body ?? '');
  if (report?.stage !== 'explore') return explicitExplore ? 'rpa_explore_result_missing' : null;
  if (report.run_id !== task.run_id) return 'rpa_explore_run_mismatch';
  if (report.claimed_result !== 'success') {
    const detail = typeof report.fail_reason === 'string' ? report.fail_reason : report.fail_reason?.message;
    return `rpa_explore_${['failed', 'blocked'].includes(report.claimed_result) ? report.claimed_result : 'invalid_result'}${detail ? `: ${detail}` : ''}`;
  }
  if (report.lock_released !== true) return 'rpa_explore_lock_not_released';
  return null;
}
