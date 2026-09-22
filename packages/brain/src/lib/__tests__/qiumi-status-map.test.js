import { describe, it, expect } from 'vitest';
import { TASK_STATUSES, WAITING_STATUSES, TERMINAL_STATUSES } from '../task-status-transitions.js';
import {
  QIUMI_STATUS_MAP, ZH_HUMAN_ONLY_STATUSES, ZH_SYNCABLE_STATUSES,
  zhPriorityToBrain, zhWriteFor,
} from '../qiumi-status-map.js';

describe('qiumi-status-map 三方映射表', () => {
  it('Brain 15 态每个都有显式表项（未列出即红）', () => {
    for (const s of TASK_STATUSES) {
      expect(QIUMI_STATUS_MAP, `缺 ${s}`).toHaveProperty(s);
      const row = QIUMI_STATUS_MAP[s];
      expect(['委派', '进行中', '推迟', '已完成', null]).toContain(row.zh);
      expect(['Delegated', 'In Progress', 'Planned', 'Done', 'Cancelled', null]).toContain(row.en);
    }
    expect(Object.keys(QIUMI_STATUS_MAP).sort()).toEqual([...TASK_STATUSES].sort());
  });

  it('等待态中文侧保持「进行中」且标 zhWaiting，不占人工「阻塞」位', () => {
    for (const s of ['blocked', 'paused', 'quota_exhausted', 'pending_postdeploy']) {
      expect(QIUMI_STATUS_MAP[s]).toMatchObject({ zh: '进行中', zhWaiting: true, en: 'Planned' });
    }
  });

  it('失败/取消类 → 推迟 + 清任务号；终态 → 已完成 + 勾选', () => {
    for (const s of ['cancelled', 'canceled', 'quarantined', 'dep_failed', 'failed']) {
      expect(QIUMI_STATUS_MAP[s]).toMatchObject({ zh: '推迟', clearTaskNo: true, en: 'Cancelled' });
    }
    for (const s of ['completed', 'completed_no_pr']) {
      expect(QIUMI_STATUS_MAP[s]).toMatchObject({ zh: '已完成', complete: true, en: 'Done' });
    }
    expect(QIUMI_STATUS_MAP.queued).toMatchObject({ zh: '委派', en: 'Delegated' });
    expect(QIUMI_STATUS_MAP.in_progress).toMatchObject({ zh: '进行中', en: 'In Progress' });
    expect(QIUMI_STATUS_MAP.pending.zh).toBeNull();
    expect(QIUMI_STATUS_MAP.archived.zh).toBeNull();
  });

  it('映射表绝不产出人工专属状态', () => {
    for (const row of Object.values(QIUMI_STATUS_MAP)) {
      expect(ZH_HUMAN_ONLY_STATUSES).not.toContain(row.zh);
    }
    expect(ZH_SYNCABLE_STATUSES).toEqual(['委派', '进行中', '推迟', '已完成']);
    expect(ZH_HUMAN_ONLY_STATUSES).toEqual(['收集', '下一个行动', '阻塞', '淘汰']);
  });

  it('优先级映射 极度/高/中/低 → P0/P1/P2/P2，未知→P2', () => {
    expect(zhPriorityToBrain('极度')).toBe('P0');
    expect(zhPriorityToBrain('高')).toBe('P1');
    expect(zhPriorityToBrain('中')).toBe('P2');
    expect(zhPriorityToBrain('低')).toBe('P2');
    expect(zhPriorityToBrain(undefined)).toBe('P2');
  });

  it('zhWriteFor：等待态写 [等待中:reason]；失败态清任务号；完成写勾选+日期；pending 不写', () => {
    const w = zhWriteFor('blocked', { reason: 'quota', resultText: '', today: '2026-09-23' });
    expect(w.properties['状态'].status.name).toBe('进行中');
    expect(w.properties['OpenClaw结果'].rich_text[0].text.content).toBe('[等待中: quota]');
    const f = zhWriteFor('failed', { reason: 'ssh_down', resultText: 'x', today: '2026-09-23' });
    expect(f.properties['状态'].status.name).toBe('推迟');
    expect(f.properties['OpenClaw任务号'].rich_text).toEqual([]);
    const c = zhWriteFor('completed_no_pr', { resultText: 'ok', today: '2026-09-23' });
    expect(c.properties['状态'].status.name).toBe('已完成');
    expect(c.properties['已完成'].checkbox).toBe(true);
    expect(c.properties['完成日期'].date.start).toBe('2026-09-23');
    expect(zhWriteFor('pending', { today: '2026-09-23' })).toBeNull();
  });
});
