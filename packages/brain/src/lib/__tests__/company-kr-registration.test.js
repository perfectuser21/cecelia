import { describe, it, expect, vi } from 'vitest';
import { companyKrSpec, registerCompanyKrWorkflow } from '../company-kr-registration.js';
import { attachRunsToWorkflow } from '../task-run.js';

describe('公司KR正式登记', () => {
  it('已有实现完整登记为五个活动、八个有判定与代码来源的步骤', () => {
    expect(companyKrSpec.activities).toHaveLength(5);
    expect(companyKrSpec.steps).toHaveLength(8);
    expect(new Set(companyKrSpec.steps.map(s => s.key)).size).toBe(8);
    for (const s of companyKrSpec.steps) {
      expect(companyKrSpec.activities.some(a => a.key === s.activity)).toBe(true);
      expect(s.readback.asserts).toBeTruthy();
      expect(s.readback.implementation).toBeTruthy();
    }
  });
  it('缺少已批准G5时整批回滚，不另造能力', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() };
    await expect(registerCompanyKrWorkflow({ connect: async () => client })).rejects.toThrow('G5');
    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO workflows'))).toBe(false);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
  it('真实Run只补workflow，冲突归属拒绝，禁止改终态或时间', async () => {
    const db = { query: vi.fn().mockResolvedValueOnce({ rows: [{ id: 'r', workflow_id: 'other' }] }) };
    await expect(attachRunsToWorkflow({ workflowId: 'w', taskIds: ['t'] }, { pool: db })).rejects.toThrow('归属');
    expect(db.query).toHaveBeenCalledTimes(1);
    db.query.mockReset().mockResolvedValue({ rows: [] });
    await attachRunsToWorkflow({ workflowId: 'w', taskIds: ['t'] }, { pool: db });
    const update = db.query.mock.calls.find(([sql]) => sql.includes('UPDATE task_runs'))[0];
    expect(update).not.toMatch(/SET[^]*?(status|started_at|ended_at|result)\s*=/);
    expect(update).toContain('workflow_id IS NULL');
  });
});
