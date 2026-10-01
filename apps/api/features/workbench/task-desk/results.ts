import { record, type TaskRecord } from './service';
const strings = (values: unknown[]) => [...new Set(values.filter((v): v is string => typeof v === 'string' && !!v.trim()).map(v => v.trim()))];
export function taskTitle(task: TaskRecord): string {
  const title = record(record(task.payload).intake).title;
  return typeof title === 'string' && title.trim() ? title : task.title || '未提供标题';
}
export function statusLabel(status?: string): string {
  return ({ queued: '排队中', pending: '待处理', in_progress: '执行中', blocked: '已阻塞', failed: '失败', completed: '已完成', completed_no_pr: '已完成', canceled: '已取消', cancelled: '已取消' } as Record<string, string>)[status ?? ''] ?? (status ? `状态：${status}` : '状态尚未读取');
}
export function safeHttpUrl(value: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}
const nonempty = (value: unknown): boolean => typeof value === 'string' ? !!value.trim()
  : Array.isArray(value) ? value.length > 0 : Object.keys(record(value)).length > 0;
export function parseResult(task: TaskRecord) {
  const result = record(task.result);
  const payload = record(task.payload);
  const lastRun = record(payload.last_run_result);
  const handoff = record(result.handoff);
  const artifacts = record(handoff.artifacts);
  const summaries = strings([task.summary, result.summary, record(result.receipt).text, payload.findings, lastRun.result_summary]);
  const reasonSources = [task, result, lastRun];
  const reasons = strings(reasonSources.flatMap(source => {
    const blocked = record(source.blocked_detail);
    return [source.error_message, source.blocked_reason, blocked.message, blocked.reason, blocked.stderr_tail, source.reason, source.stderr_tail];
  }));
  const exitCodes = strings(reasonSources.flatMap(source => [source.exit_code, record(source.blocked_detail).exit_code])
    .filter(code => typeof code === 'number' || typeof code === 'string').map(code => `退出码：${code}`));
  reasons.push(...exitCodes);
  const artifactValues = strings([task.pr_url, result.pr_url, lastRun.pr_url,
    ...(Array.isArray(artifacts.pr_urls) ? artifacts.pr_urls : [artifacts.pr_urls]),
    ...(Array.isArray(artifacts.paths) ? artifacts.paths : [artifacts.paths]), artifacts.path]);
  const sections = (['done', 'not_done', 'next_steps'] as const).filter(key => nonempty(handoff[key]))
    .map(key => ({ key, value: handoff[key] }));
  const hasEvidence = summaries.length > 0 || artifactValues.length > 0 || sections.some(s => s.key === 'done');
  return { summaries, reasons, artifactValues, sections, hasEvidence };
}
