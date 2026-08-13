import { describe, it, expect, vi } from 'vitest';
import { buildHarnessReportInsert, spawnHarnessReport, REPORT_KIND } from '../staging-promote.js';

// ──────────────────────────────────────────────────────────────────────────
// Slice 3：report 后移到 production promote 完成后（三态 · 决策 B）
// promoted/auto_promoted → 成功交付证书；FAIL/SKIP/promote_failed → 失败报告；
// pending_promote → 不出（靠 Slice2 通知+状态可见，不饿死）。
// 派 harness_report 幂等：按 initiative_id NOT EXISTS 去重。
// ──────────────────────────────────────────────────────────────────────────

describe('buildHarnessReportInsert — 构造统一路由请求（幂等 + 内容补全）', () => {
  const args = {
    initiativeId: 'init-1',
    title: 'feat X',
    prUrl: 'https://pr/1',
    reportKind: REPORT_KIND.SUCCESS,
    stagingE2eVerdict: 'PASS',
    promoteStatus: 'auto_promoted',
    promotedAt: '2026-06-25T10:00:00Z',
    promotedBy: 'auto',
    productionVersion: '1.231.0',
    rollbackAnchor: 'prod-cecelia-v42',
  };

  it('生成 child 路由请求，task_type=harness_report、status=queued', () => {
    const task = buildHarnessReportInsert(args);
    expect(task).toMatchObject({
      task_type: 'harness_report',
      status: 'queued',
      source: 'child',
      source_id: 'harness-report:init-1',
    });
  });

  it('幂等：用稳定 source_id 交给 receipt 唯一键去重', () => {
    const task = buildHarnessReportInsert(args);
    expect(task.source_id).toBe('harness-report:init-1');
    expect(task.payload.initiative_id).toBe('init-1');
  });

  it('payload 补全 Slice3 字段：staging_e2e_verdict/promote_status/promoted_at/promoted_by/production_version/rollback_anchor + report_kind', () => {
    const { payload } = buildHarnessReportInsert(args);
    expect(payload.report_kind).toBe('success');
    expect(payload.staging_e2e_verdict).toBe('PASS');
    expect(payload.promote_status).toBe('auto_promoted');
    expect(payload.promoted_at).toBe('2026-06-25T10:00:00Z');
    expect(payload.promoted_by).toBe('auto');
    expect(payload.production_version).toBe('1.231.0');
    expect(payload.rollback_anchor).toBe('prod-cecelia-v42');
    expect(payload.initiative_id).toBe('init-1');
    expect(payload.script_path).toBe('packages/brain/scripts/harness-report.mjs');
  });

  it('失败报告 report_kind=failure（不含 production 段空值无所谓）', () => {
    const { payload } = buildHarnessReportInsert({ ...args, reportKind: REPORT_KIND.FAILURE, stagingE2eVerdict: 'FAIL', promoteStatus: 'n_a' });
    expect(payload.report_kind).toBe('failure');
  });

  it('无 initiativeId → 返回 null（不派）', () => {
    expect(buildHarnessReportInsert({ ...args, initiativeId: null })).toBeNull();
  });
});

describe('spawnHarnessReport — best-effort 落库（永不 throw）', () => {
  it('调统一 taskCreator；返回 spawned=true', async () => {
    const taskCreator = vi.fn(async () => ({ task: { id: 'report-task' } }));
    const r = await spawnHarnessReport({ db: {}, taskCreator }, {
      initiativeId: 'i1', prUrl: 'https://pr/x', reportKind: REPORT_KIND.SUCCESS,
    });
    expect(taskCreator).toHaveBeenCalledWith(expect.objectContaining({
      task_type: 'harness_report',
      source_id: 'harness-report:i1',
    }));
    expect(r.spawned).toBe(true);
  });

  it('taskCreator 抛错 → 不 throw，返回 spawned=false', async () => {
    const taskCreator = vi.fn(async () => { throw new Error('db down'); });
    const r = await spawnHarnessReport({ db: {}, taskCreator }, { initiativeId: 'i1' });
    expect(r.spawned).toBe(false);
  });

  it('无 initiativeId → 不派，spawned=false', async () => {
    const taskCreator = vi.fn();
    const r = await spawnHarnessReport({ db: {}, taskCreator }, { initiativeId: null });
    expect(taskCreator).not.toHaveBeenCalled();
    expect(r.spawned).toBe(false);
  });
});
