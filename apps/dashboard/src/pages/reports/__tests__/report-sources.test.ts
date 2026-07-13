/**
 * mergeReportSources — /reports 双源合并纯函数单测
 * sys = /api/brain/reports 形状 { reports: [...] }
 * docs = /api/brain/design-docs 列表形状 { success, data: [...] }（无 summary/content）
 */

import { describe, it, expect } from 'vitest';
import { mergeReportSources } from '../report-sources';
import type { MergedReport } from '../report-sources';

const sysReport = (id: string, createdAt: string) => ({
  id,
  type: '48h_system_report',
  title: `系统简报 ${id}`,
  summary: '系统运行正常',
  metadata: { triggered_by: 'auto' },
  created_at: createdAt,
});

const docItem = (id: string, createdAt: string) => ({
  id,
  type: 'battle_report',
  title: `作战日报 ${id}`,
  status: 'active',
  area: 'cecelia',
  author: 'cecelia',
  created_at: createdAt,
});

describe('mergeReportSources', () => {
  it('两源合并后按 created_at 倒序排列', () => {
    const sys = {
      reports: [
        sysReport('sys-old', '2026-07-05T10:00:00Z'),
        sysReport('sys-new', '2026-07-07T10:00:00Z'),
      ],
    };
    const docs = {
      success: true,
      data: [docItem('doc-mid', '2026-07-06T10:00:00Z')],
    };
    const merged = mergeReportSources(sys, docs);
    expect(merged.map((r: MergedReport) => r.id)).toEqual(['sys-new', 'doc-mid', 'sys-old']);
  });

  it('battle_report 项映射：type/summary 固定 + source=design_docs；sys 项 source=system', () => {
    const sys = { reports: [sysReport('sys-1', '2026-07-07T08:00:00Z')] };
    const docs = { success: true, data: [docItem('doc-1', '2026-07-07T09:00:00Z')] };
    const merged = mergeReportSources(sys, docs);

    const doc = merged.find((r: MergedReport) => r.id === 'doc-1');
    expect(doc).toMatchObject({
      id: 'doc-1',
      type: 'battle_report',
      title: '作战日报 doc-1',
      summary: '每日作战日报',
      created_at: '2026-07-07T09:00:00Z',
      source: 'design_docs',
    });

    const sysItem = merged.find((r: MergedReport) => r.id === 'sys-1');
    expect(sysItem).toMatchObject({
      id: 'sys-1',
      type: '48h_system_report',
      title: '系统简报 sys-1',
      summary: '系统运行正常',
      created_at: '2026-07-07T08:00:00Z',
      source: 'system',
    });
  });

  it('任一入参 null 或形状不对时该源当空数组，不崩', () => {
    const sys = { reports: [sysReport('sys-1', '2026-07-07T08:00:00Z')] };
    const docs = { success: true, data: [docItem('doc-1', '2026-07-07T09:00:00Z')] };

    // sys 为 null → 只剩 docs
    expect(mergeReportSources(null, docs).map((r) => r.id)).toEqual(['doc-1']);
    // docs 为 null → 只剩 sys
    expect(mergeReportSources(sys, null).map((r) => r.id)).toEqual(['sys-1']);
    // 形状不对（reports/data 不是数组）→ 该源当空
    expect(mergeReportSources({ reports: 'oops' }, docs).map((r) => r.id)).toEqual(['doc-1']);
    expect(mergeReportSources(sys, { success: true, data: 42 }).map((r) => r.id)).toEqual(['sys-1']);
    // 完全不是对象也不崩
    expect(mergeReportSources('garbage', undefined)).toEqual([]);
  });

  it('两源全空 → 返回空数组', () => {
    expect(mergeReportSources({ reports: [] }, { success: true, data: [] })).toEqual([]);
    expect(mergeReportSources(null, null)).toEqual([]);
  });
});
