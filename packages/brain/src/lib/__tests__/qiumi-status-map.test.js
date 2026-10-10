import { describe, it, expect } from 'vitest';
import { TASK_STATUSES } from '../task-status-transitions.js';
import {
  QIUMI_STATUS_MAP, ZH_HUMAN_ONLY_STATUSES, ZH_SYNCABLE_STATUSES,
  zhPriorityToBrain, zhWriteFor, enStatusFor,
} from '../qiumi-status-map.js';

// 两张 Notion 表「状态」列的已知选项（2026-10-10 中文表新增 排队中/受阻/失败；英文库已有 Queued/Blocked/Failed）
const ZH_KNOWN = ['排队中', '受阻', '失败', '进行中', '已完成', '淘汰', '推迟', '委派', '阻塞', '收集', '下一个行动'];
const EN_KNOWN = ['Planned', 'Delegated', 'In Progress', 'Done', 'Cancelled', 'Queued', 'Blocked', 'Failed'];

// Brain 状态 → [中文, 英文]；null = 不写
const EXPECTED = {
  pending: [null, null],
  archived: [null, null],
  queued: ['排队中', 'Queued'],
  in_progress: ['进行中', 'In Progress'],
  blocked: ['受阻', 'Blocked'],
  paused: ['受阻', 'Blocked'],
  quota_exhausted: ['受阻', 'Blocked'],
  pending_postdeploy: ['受阻', 'Blocked'],
  completed: ['已完成', 'Done'],
  completed_no_pr: ['已完成', 'Done'],
  failed: ['失败', 'Failed'],
  quarantined: ['失败', 'Failed'],
  dep_failed: ['失败', 'Failed'],
  cancelled: ['淘汰', 'Cancelled'],
  canceled: ['淘汰', 'Cancelled'],
};

describe('qiumi-status-map 三方映射表（中英文一一对应）', () => {
  it('Brain 15 态每个都有显式表项（未列出即红）', () => {
    for (const s of TASK_STATUSES) expect(QIUMI_STATUS_MAP, `缺 ${s}`).toHaveProperty(s);
    expect(Object.keys(QIUMI_STATUS_MAP).sort()).toEqual([...TASK_STATUSES].sort());
    expect(Object.keys(EXPECTED).sort()).toEqual([...TASK_STATUSES].sort());
  });

  it.each(Object.entries(EXPECTED))('%s → 中文 %s / 英文 %s', (status, [zh, en]) => {
    expect(QIUMI_STATUS_MAP[status]).toMatchObject({ zh, en });
  });

  it('两张表的输出都在已知选项集合里（防止写出不存在的选项被 Notion 400）', () => {
    for (const [s, row] of Object.entries(QIUMI_STATUS_MAP)) {
      if (row.zh !== null) expect(ZH_KNOWN, `${s}.zh=${row.zh}`).toContain(row.zh);
      if (row.en !== null) expect(EN_KNOWN, `${s}.en=${row.en}`).toContain(row.en);
    }
  });

  it('「委派」不是 Brain 状态：不出现在任何映射输出里，只作拉取入口', () => {
    for (const row of Object.values(QIUMI_STATUS_MAP)) expect(row.zh).not.toBe('委派');
    expect(ZH_SYNCABLE_STATUSES).not.toContain('委派');
  });

  it('clearTaskNo 仅失败类（failed/quarantined/dep_failed）为 true；取消/受阻/完成都保留任务号', () => {
    const cleared = Object.entries(QIUMI_STATUS_MAP).filter(([, r]) => r.clearTaskNo).map(([s]) => s).sort();
    expect(cleared).toEqual(['dep_failed', 'failed', 'quarantined']);
  });

  it('等待态（blocked/paused/quota_exhausted/pending_postdeploy）标 zhWaiting', () => {
    for (const s of ['blocked', 'paused', 'quota_exhausted', 'pending_postdeploy']) {
      expect(QIUMI_STATUS_MAP[s].zhWaiting).toBe(true);
    }
    expect(QIUMI_STATUS_MAP.queued.zhWaiting).toBe(false);
  });

  it('映射表绝不产出人工专属状态（收集/下一个行动/阻塞）；可写集合与人工集合不相交', () => {
    for (const row of Object.values(QIUMI_STATUS_MAP)) {
      expect(ZH_HUMAN_ONLY_STATUSES).not.toContain(row.zh);
    }
    expect(ZH_HUMAN_ONLY_STATUSES).toEqual(['收集', '下一个行动', '阻塞']);
    expect([...ZH_SYNCABLE_STATUSES].sort()).toEqual(['排队中', '进行中', '受阻', '失败', '已完成', '淘汰', '推迟'].sort());
    for (const s of ZH_SYNCABLE_STATUSES) expect(ZH_HUMAN_ONLY_STATUSES).not.toContain(s);
    // 旧「推迟」页只识别不再写
    for (const row of Object.values(QIUMI_STATUS_MAP)) expect(row.zh).not.toBe('推迟');
  });

  it('优先级映射 极度/高/中/低 → P0/P1/P2/P2，未知→P2', () => {
    expect(zhPriorityToBrain('极度')).toBe('P0');
    expect(zhPriorityToBrain('高')).toBe('P1');
    expect(zhPriorityToBrain('中')).toBe('P2');
    expect(zhPriorityToBrain('低')).toBe('P2');
    expect(zhPriorityToBrain(undefined)).toBe('P2');
  });
});

describe('blocked 三个原因分支', () => {
  it('普通原因 → 中文受阻 + [受阻: reason]；英文 Blocked', () => {
    const w = zhWriteFor('blocked', { reason: 'quota', resultText: '', today: '2026-09-23' });
    expect(w.properties['状态'].status.name).toBe('受阻');
    expect(w.properties['OpenClaw结果'].rich_text[0].text.content).toBe('[受阻: quota]');
    expect(enStatusFor('blocked', { blockedReason: 'dispatch_fail_autoblock' })).toBe('Blocked');
    expect(enStatusFor('blocked')).toBe('Blocked');
  });

  it('delegated_device_job（转手机领单通道，不是出错）→ 进行中 / In Progress，不套受阻', () => {
    const w = zhWriteFor('blocked', { reason: 'delegated_device_job', blockedReason: 'delegated_device_job', today: '2026-10-10' });
    expect(w.properties['状态'].status.name).toBe('进行中');
    expect(w.properties['OpenClaw结果'].rich_text[0].text.content).not.toMatch(/受阻|等待中/);
    expect(enStatusFor('blocked', { blockedReason: 'delegated_device_job' })).toBe('In Progress');
  });

  it('owner_hold（主理人自己拖到「阻塞」）→ 中文不写（null），英文 Blocked', () => {
    expect(zhWriteFor('blocked', { reason: 'owner_hold', blockedReason: 'owner_hold', today: '2026-10-10' })).toBeNull();
    expect(enStatusFor('blocked', { blockedReason: 'owner_hold' })).toBe('Blocked');
  });

  it('device_unresolved → OpenClaw结果原样写提示（不套前缀），状态受阻', () => {
    const note = '⚠️ 手机未确定：请在正文写明手机昵称（小彩/小白/小黄/小蓝）或抖音账号';
    const w = zhWriteFor('blocked', { reason: note, blockedReason: 'device_unresolved', today: '2026-09-29' });
    expect(w.properties['状态'].status.name).toBe('受阻');
    expect(w.properties['OpenClaw结果'].rich_text[0].text.content).toBe(note);
  });

  it('例外只对 blocked 生效：其它状态带同名 blockedReason 不改变映射', () => {
    expect(enStatusFor('paused', { blockedReason: 'delegated_device_job' })).toBe('Blocked');
    expect(zhWriteFor('paused', { reason: 'x', blockedReason: 'owner_hold', today: '2026-10-10' }).properties['状态'].status.name).toBe('受阻');
  });
});

describe('zhWriteFor 其它状态', () => {
  const name = (w) => w.properties['状态'].status.name;
  const result = (w) => w.properties['OpenClaw结果']?.rich_text[0]?.text.content;

  it('queued → 排队中（不写结果）；in_progress → 进行中', () => {
    expect(name(zhWriteFor('queued', { today: '2026-10-10' }))).toBe('排队中');
    expect(zhWriteFor('queued', { today: '2026-10-10' }).properties['OpenClaw结果']).toBeUndefined();
    expect(name(zhWriteFor('in_progress', { today: '2026-10-10' }))).toBe('进行中');
  });

  it.each(['paused', 'quota_exhausted', 'pending_postdeploy'])('%s → 受阻 + [受阻: …]', (s) => {
    const w = zhWriteFor(s, { reason: 'why', today: '2026-10-10' });
    expect(name(w)).toBe('受阻');
    expect(result(w)).toBe('[受阻: why]');
  });

  it.each(['failed', 'quarantined', 'dep_failed'])('%s → 失败 + [执行失败: …] + 清任务号 + 取消勾选', (s) => {
    const w = zhWriteFor(s, { reason: 'ssh_down', resultText: 'x', today: '2026-09-23' });
    expect(name(w)).toBe('失败');
    expect(result(w)).toBe('[执行失败: ssh_down] x');
    expect(w.properties['OpenClaw任务号'].rich_text).toEqual([]);
    expect(w.properties['已完成'].checkbox).toBe(false);
  });

  it.each(['cancelled', 'canceled'])('%s → 淘汰，保留任务号（不清）', (s) => {
    const w = zhWriteFor(s, { reason: 'user_cancel', today: '2026-10-10' });
    expect(name(w)).toBe('淘汰');
    expect(w.properties['OpenClaw任务号']).toBeUndefined();
  });

  it.each(['completed', 'completed_no_pr'])('%s → 已完成 + 勾选 + 日期', (s) => {
    const w = zhWriteFor(s, { resultText: 'ok', today: '2026-09-23' });
    expect(name(w)).toBe('已完成');
    expect(w.properties['已完成'].checkbox).toBe(true);
    expect(w.properties['完成日期'].date.start).toBe('2026-09-23');
  });

  it('pending / archived 不写', () => {
    expect(zhWriteFor('pending', { today: '2026-09-23' })).toBeNull();
    expect(zhWriteFor('archived', { today: '2026-09-23' })).toBeNull();
  });
});

describe('enStatusFor', () => {
  it('逐态输出英文状态；pending/archived 为 null', () => {
    for (const [s, [, en]] of Object.entries(EXPECTED)) expect(enStatusFor(s), s).toBe(en);
  });
});
