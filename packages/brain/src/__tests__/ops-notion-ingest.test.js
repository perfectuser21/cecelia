import { describe, it, expect } from 'vitest';
import { planEnableAction, buildManualUpdateSql } from '../ops-notion-ingest.js';

// 主理人拍板：Notion 上标停用 → 直接生效，真去停 n8n（判定点已登记，误触风险已知悉）。
// 因为是不可逆动作，实现上必须保证三件事：幂等（不重复调）、留痕（改前状态）、
// 失败可见（enable_error 落库，看板显红，绝不静默吞掉）。
describe('planEnableAction — 决定要不要真去动 n8n', () => {
  it('意图与现状一致 → 不动作（幂等，防每轮重复调 n8n）', () => {
    expect(planEnableAction({ active: true, enable_intent: true }).action).toBe('none');
    expect(planEnableAction({ active: false, enable_intent: false }).action).toBe('none');
  });

  it('标停用而 n8n 还开着 → 真去停', () => {
    const p = planEnableAction({ wf_id: 'abc', active: true, enable_intent: false });
    expect(p.action).toBe('deactivate');
    expect(p.wf_id).toBe('abc');
    expect(p.prev_active).toBe(true);   // 留痕：改前是什么样
  });

  it('标启用而 n8n 停着 → 真去开', () => {
    expect(planEnableAction({ wf_id: 'abc', active: false, enable_intent: true }).action).toBe('activate');
  });

  it('没表达过意图（null）→ 永不动作（默认不碰生产）', () => {
    expect(planEnableAction({ active: true, enable_intent: null }).action).toBe('none');
    expect(planEnableAction({ active: true }).action).toBe('none');
  });

  it('上轮失败过的不无限重试——已记 error 且意图没变则跳过，等人处理', () => {
    const p = planEnableAction({
      wf_id: 'abc', active: true, enable_intent: false,
      enable_error: 'n8n 500', enable_intent_at: new Date('2026-09-08T10:00:00Z'),
      enable_applied_at: new Date('2026-09-08T10:00:01Z'),
    });
    expect(p.action).toBe('none');
    expect(p.reason).toBe('last_attempt_failed');
  });

  it('人改了新意图（intent_at 晚于上次尝试）→ 即使上次失败也重试', () => {
    const p = planEnableAction({
      wf_id: 'abc', active: true, enable_intent: false,
      enable_error: 'n8n 500', enable_intent_at: new Date('2026-09-08T12:00:00Z'),
      enable_applied_at: new Date('2026-09-08T10:00:01Z'),
    });
    expect(p.action).toBe('deactivate');
  });

  it('非 n8n 来源的行不碰（launchd/gha 没有这个 API）', () => {
    expect(planEnableAction({ source: 'launchd', active: true, enable_intent: false }).action).toBe('none');
  });
});

describe('buildManualUpdateSql — 只更新人工列', () => {
  it('生成的 SQL 只含人工列，绝不含机器列', () => {
    const { sql, values } = buildManualUpdateSql('ops_workflows', 'id-1', {
      owner_manual: '张三', priority_manual: 'P1', starred: true,
    });
    expect(sql).toContain('owner_manual');
    expect(sql).toContain('priority_manual');
    expect(sql).toContain('starred');
    expect(sql).not.toMatch(/run_total|success_rate|liveness|active\s*=/);
    expect(values).toEqual(['张三', 'P1', true, 'id-1']);
  });

  it('空改动 → 不生成 SQL（别做无谓写库）', () => {
    expect(buildManualUpdateSql('ops_workflows', 'id-1', {})).toBeNull();
  });

  it('未知字段被丢弃（防 Notion 上加个列就能往任意列写）', () => {
    const r = buildManualUpdateSql('ops_workflows', 'id-1', { owner_manual: 'x', run_total: 99999, active: false });
    expect(r.sql).toContain('owner_manual');
    expect(r.sql).not.toContain('run_total');
    expect(r.sql).not.toContain('active');
    expect(r.values).toEqual(['x', 'id-1']);
  });

  it('null 值能写进去（人清空字段要能落库）', () => {
    const r = buildManualUpdateSql('ops_agents', 'a-1', { owner_manual: null });
    expect(r.values).toEqual([null, 'a-1']);
  });

  it('表名白名单——非 ops_* 表一律拒绝', () => {
    expect(() => buildManualUpdateSql('tasks', 'x', { owner_manual: 'a' })).toThrow();
  });
});
