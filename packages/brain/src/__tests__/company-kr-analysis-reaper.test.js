import { describe, it, expect, vi } from 'vitest';
vi.mock('../machine-registry.js', () => ({ resolvePrimaryWorkerId: () => 'primary', sshTargetFor: () => 'worker' }));
vi.mock('../lib/task-event-log.js', () => ({ recordTaskEventSafe: vi.fn() }));
vi.mock('../lib/task-run.js', () => ({ startRun: vi.fn(), finishRun: vi.fn() }));
import { reapOpenclawAgentRuns, triggerOpenclawAgent } from '../openclaw-agent-executor.js';
import { runCompanyKrWorkflow } from '../projection/company-kr-workflow.js';

const row = { id: 'task1', run_id: 'run1', payload: { company_kr_analysis: { version: 1, items: [] } } };
async function reap(consumeCompanyAnalysis) {
  const pool = { query: vi.fn().mockResolvedValueOnce({ rows: [row] }).mockResolvedValue({ rows: [] }) };
  const answer = JSON.stringify({ snapshot_id: 'x', items: [] });
  const execFileFn = vi.fn((_cmd, _args, _opts, cb) => cb(null, `EXIT=0\n${JSON.stringify({ result: { payloads: [{ text: answer }] } }, null, 2)}\n`, ''));
  const markCompanyAnalysis = vi.fn();
  const summary = await reapOpenclawAgentRuns(pool, { execFileFn, consumeCompanyAnalysis, markCompanyAnalysis });
  return { pool, summary, answer, markCompanyAnalysis };
}
describe('OpenClaw公司KR可信收割', () => {
  it('排队后停用或正式版本变更，派发前重新校验且零SSH', async () => {
    const spawnFn = vi.fn();
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ value_json: { enabled: false } }] }) };
    const task = { ...row, payload: { ...row.payload, run_id: 'run1', qiumi_department: 'company-kr-analyst' } };
    const result = await triggerOpenclawAgent(task, { pool, spawnFn });
    expect(result.success).toBe(false);
    expect(result.reason).toBe('company_kr_analysis_superseded');
    expect(spawnFn).not.toHaveBeenCalled();
  });
  it('解析真实多行CLI包装，落建议成功才完成；保留已有任务结果', async () => {
    const consume = vi.fn().mockResolvedValue({ saved: ['kr1'], stale: [] });
    const { summary, pool, answer } = await reap(consume);
    expect(consume).toHaveBeenCalledWith(pool, row, expect.objectContaining({ text: answer }));
    expect(summary.completed).toBe(1);
    const finish = pool.query.mock.calls.find(([sql]) => sql.includes("SET status = 'completed_no_pr'"));
    expect(finish[0]).toContain("COALESCE(result, '{}'::jsonb)");
    expect(JSON.parse(finish[1][1]).company_kr_analysis.saved).toEqual(['kr1']);
  });
  it('AI产出不合格或写入失败必须失败，不能用exit0冒充成功', async () => {
    const { summary, pool, markCompanyAnalysis } = await reap(vi.fn().mockRejectedValue(new Error('分析快照不完整')));
    expect(summary).toMatchObject({ completed: 0, failed: 1 });
    expect(pool.query.mock.calls.some(([sql]) => sql.includes("SET status = 'completed_no_pr'"))).toBe(false);
    expect(markCompanyAnalysis).toHaveBeenCalledWith(pool, row, 'failed', expect.stringContaining('分析快照不完整'));
  });
});
describe('公司工作流只有回灌成功后启动', () => {
  it('成功同步先于分析，跳周期或错误不分析', async () => {
    const order = [], analyze = vi.fn(async () => { order.push('analyze'); return { task_id: 't' }; });
    await runCompanyKrWorkflow({}, { project: async () => { order.push('project'); return { matched: 8 }; }, analyze });
    expect(order).toEqual(['project', 'analyze']);
    analyze.mockClear();
    await runCompanyKrWorkflow({}, { project: async () => ({ skipped: true }), analyze });
    await expect(runCompanyKrWorkflow({}, { project: async () => { throw Error('Notion失败'); }, analyze })).rejects.toThrow('Notion失败');
    expect(analyze).not.toHaveBeenCalled();
  });
});
