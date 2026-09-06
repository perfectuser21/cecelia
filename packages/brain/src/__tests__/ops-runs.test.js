import { describe, it, expect } from 'vitest';
import { parseN8nRuns, isBusinessWorkflow, summarizeRuns } from '../ops-collector.js';

// 真实字段形状（实证 hk-vps zenithjoy-db-postgres 库 n8n 表 execution_entity）
const RAW = [
  { id: '101', workflowId: 'AwrSocialLeadgenV4', status: 'success', mode: 'webhook',
    startedAt: '2026-09-06T01:00:00.000Z', stoppedAt: '2026-09-06T01:38:00.000Z' },
  { id: '102', workflowId: 'AwrSocialLeadgenV4', status: 'error', mode: 'webhook',
    startedAt: '2026-09-06T02:00:00.000Z', stoppedAt: '2026-09-06T02:09:00.000Z' },
  { id: '103', workflowId: 'AwrSocialLeadgenV4', status: 'crashed', mode: 'webhook',
    startedAt: '2026-09-06T03:00:00.000Z', stoppedAt: null },   // 崩了没停止时间
  { id: '104', workflowId: 'OpcCmdStageCallV4', status: 'success', mode: 'integrated',
    startedAt: '2026-09-06T04:00:00.000Z', stoppedAt: '2026-09-06T04:09:00.000Z' },
];

describe('parseN8nRuns', () => {
  it('提取 run 基本字段 + 算耗时（秒）', () => {
    const rows = parseN8nRuns(RAW, 'hk-vps');
    const r = rows.find((x) => x.run_id === '101');
    expect(r.wf_id).toBe('AwrSocialLeadgenV4');
    expect(r.status).toBe('success');
    expect(r.machine).toBe('hk-vps');
    expect(r.duration_sec).toBe(38 * 60);
    expect(r.started_at).toBe('2026-09-06T01:00:00.000Z');
  });

  it('crashed 无 stoppedAt → duration 为 null（禁编造耗时）', () => {
    const r = parseN8nRuns(RAW, 'hk-vps').find((x) => x.run_id === '103');
    expect(r.status).toBe('crashed');
    expect(r.duration_sec).toBeNull();
  });

  it('非数组/空 → 空数组不抛', () => {
    expect(parseN8nRuns(null, 'hk-vps')).toEqual([]);
    expect(parseN8nRuns([], 'hk-vps')).toEqual([]);
  });
});

describe('isBusinessWorkflow — 业务流程 vs 通道/触发器', () => {
  // 主理人实证：业务流程日均 10-21 轮、每轮 38-70 分钟；
  // 通道类日均 154-234 次、每次 4 秒-9 分钟 → 后者 Notion 只推汇总，避免淹没视线
  it('有业务阶段 = 业务流程', () => {
    expect(isBusinessWorkflow({ stage_count: 8 })).toBe(true);
    expect(isBusinessWorkflow({ stage_count: 9 })).toBe(true);
  });
  it('无阶段 = 通道/触发器/演示', () => {
    expect(isBusinessWorkflow({ stage_count: 0 })).toBe(false);
    expect(isBusinessWorkflow({})).toBe(false);
  });
});

describe('summarizeRuns — 流程健康汇总', () => {
  it('算次数/成功率/平均耗时/最近一次', () => {
    const s = summarizeRuns(parseN8nRuns(RAW, 'hk-vps').filter((r) => r.wf_id === 'AwrSocialLeadgenV4'));
    expect(s.total).toBe(3);
    expect(s.success).toBe(1);
    expect(s.failed).toBe(2);                    // error + crashed 都算失败
    expect(s.success_rate).toBe(33);             // 1/3 四舍五入
    expect(s.avg_duration_sec).toBe((38 * 60 + 9 * 60) / 2);  // 只算有耗时的
    expect(s.last_run_at).toBe('2026-09-06T03:00:00.000Z');
    expect(s.last_status).toBe('crashed');
  });

  it('空输入 → 全零不抛（0条=可疑由调用方判定）', () => {
    const s = summarizeRuns([]);
    expect(s.total).toBe(0);
    expect(s.success_rate).toBeNull();           // 没样本不编造成功率
    expect(s.last_run_at).toBeNull();
  });

  it('全部 crashed 无耗时 → avg 为 null 不为 0', () => {
    const s = summarizeRuns([{ status: 'crashed', duration_sec: null, started_at: '2026-09-06T03:00:00.000Z' }]);
    expect(s.avg_duration_sec).toBeNull();
    expect(s.success_rate).toBe(0);
  });
});
