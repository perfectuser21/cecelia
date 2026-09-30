import { describe, it, expect, vi } from 'vitest';
import {
  normalizeBrief,
  sanitizeBriefDelta,
  applyBriefDelta,
  renderBriefMarkdown,
  formatBriefForPrompt,
  CHANGELOG_MAX,
} from '../project-brief.js';

describe('normalizeBrief', () => {
  it('脏输入 → 合法空形状', () => {
    expect(normalizeBrief(null)).toEqual({ goal: '', status: '', facts: [], open_questions: [], changelog: [] });
    expect(normalizeBrief(undefined)).toEqual({ goal: '', status: '', facts: [], open_questions: [], changelog: [] });
    expect(normalizeBrief([1, 2])).toEqual({ goal: '', status: '', facts: [], open_questions: [], changelog: [] });
  });

  it('保留合法字段，丢弃非法项', () => {
    const b = normalizeBrief({
      goal: '做一个活文档',
      facts: ['fact1', '', 42, 'fact2'],
      open_questions: [{ id: 'q1', text: '问题1' }, { id: 'q2' }, 'bad'],
      changelog: [{ at: '2026-01-01T00:00:00Z', kind: 'goal', summary: 's' }, { kind: 'no-at' }],
    });
    expect(b.goal).toBe('做一个活文档');
    expect(b.facts).toEqual(['fact1', 'fact2']);
    expect(b.open_questions).toEqual([{ id: 'q1', text: '问题1', opened_by_task: null }]);
    expect(b.changelog).toHaveLength(1);
  });
});

describe('sanitizeBriefDelta', () => {
  it('全部字段合法 → 原样保留', () => {
    const warn = vi.fn();
    const out = sanitizeBriefDelta(
      {
        goal: '新目标',
        status: '新现状',
        add_facts: ['f1', 'f2'],
        open_questions: ['q1'],
        close_questions: [{ id: 'q0', resolution: '已解决' }],
        add_steps: [{ title: 't1', description: 'd1' }],
        cancel_steps: ['task-1'],
        reorder: ['task-2', 'task-3'],
      },
      { warn },
    );
    expect(out).toEqual({
      goal: '新目标',
      status: '新现状',
      add_facts: ['f1', 'f2'],
      open_questions: ['q1'],
      close_questions: [{ id: 'q0', resolution: '已解决' }],
      add_steps: [{ title: 't1', description: 'd1' }],
      cancel_steps: ['task-1'],
      reorder: ['task-2', 'task-3'],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('非法项丢弃并 warn，不影响合法项', () => {
    const warn = vi.fn();
    const out = sanitizeBriefDelta(
      { goal: '', status: '新现状', add_facts: 'not-array', cancel_steps: [1, 2] },
      { warn },
    );
    expect(out).toEqual({ status: '新现状' });
    expect(warn).toHaveBeenCalled();
  });

  it('非对象 / 空 delta → null', () => {
    expect(sanitizeBriefDelta(null)).toBeNull();
    expect(sanitizeBriefDelta([])).toBeNull();
    expect(sanitizeBriefDelta({})).toBeNull();
    expect(sanitizeBriefDelta({ goal: 42 }, { warn: () => {} })).toBeNull();
  });
});

describe('applyBriefDelta', () => {
  it('不可变：不修改入参 brief', () => {
    const brief = { goal: 'old', status: '', facts: ['f0'], open_questions: [], changelog: [] };
    const frozen = JSON.parse(JSON.stringify(brief));
    applyBriefDelta(brief, { goal: 'new', add_facts: ['f1'] }, { taskId: 't1', now: '2026-10-01T00:00:00.000Z' });
    expect(brief).toEqual(frozen);
  });

  it('goal / status 直接覆盖并留痕', () => {
    const brief = { goal: 'old goal', status: 'old status', facts: [], open_questions: [], changelog: [] };
    const next = applyBriefDelta(brief, { goal: 'new goal', status: 'new status' }, { taskId: 't1', now: 'T1' });
    expect(next.goal).toBe('new goal');
    expect(next.status).toBe('new status');
    expect(next.changelog).toEqual([
      { at: 'T1', task_id: 't1', kind: 'goal', summary: '目标改为：new goal' },
      { at: 'T1', task_id: 't1', kind: 'status', summary: '现状更新：new status' },
    ]);
  });

  it('add_facts 去重（brief 内已存在的不重复加，同批重复的只加一次）', () => {
    const brief = { goal: '', status: '', facts: ['f1'], open_questions: [], changelog: [] };
    const next = applyBriefDelta(brief, { add_facts: ['f1', 'f2', 'f2'] }, { taskId: 't1', now: 'T1' });
    expect(next.facts).toEqual(['f1', 'f2']);
    expect(next.changelog).toHaveLength(1);
    expect(next.changelog[0].summary).toContain('f2');
  });

  it('open_questions 开新问题，close_questions 结已开问题', () => {
    let brief = { goal: '', status: '', facts: [], open_questions: [], changelog: [] };
    brief = applyBriefDelta(brief, { open_questions: ['要不要拆两条链？'] }, { taskId: 't1', now: 'T1' });
    expect(brief.open_questions).toHaveLength(1);
    const qid = brief.open_questions[0].id;
    expect(brief.open_questions[0].closed_by_task).toBeUndefined();

    const closed = applyBriefDelta(brief, { close_questions: [{ id: qid, resolution: '不拆' }] }, { taskId: 't2', now: 'T2' });
    expect(closed.open_questions[0].closed_by_task).toBe('t2');
    expect(closed.open_questions[0].resolution).toBe('不拆');
    // 原 brief 不受影响（不可变）
    expect(brief.open_questions[0].closed_by_task).toBeUndefined();
  });

  it('close_questions 引用不存在或已关闭的 id → 静默跳过，不留痕', () => {
    const brief = { goal: '', status: '', facts: [], open_questions: [{ id: 'q1', text: 'x', opened_by_task: 't0' }], changelog: [] };
    const next = applyBriefDelta(brief, { close_questions: [{ id: 'no-such-id' }] }, { taskId: 't1', now: 'T1' });
    expect(next.changelog).toEqual([]);
    expect(next.open_questions[0].closed_by_task).toBeUndefined();
  });

  it('add_steps / cancel_steps / reorder 只拼 changelog 摘要，不建实体', () => {
    const brief = { goal: '', status: '', facts: [], open_questions: [], changelog: [] };
    const next = applyBriefDelta(
      brief,
      { add_steps: ['新棒A', '新棒B'], cancel_steps: ['task-x'], reorder: ['task-1', 'task-2'] },
      { taskId: 't1', now: 'T1' },
    );
    const kinds = next.changelog.map((e) => e.kind);
    expect(kinds).toEqual(['add_steps', 'cancel_steps', 'reorder']);
    expect(next.changelog[0].summary).toContain('新棒A');
    expect(next.changelog[1].summary).toContain('task-x');
    expect(next.changelog[2].summary).toContain('task-1');
  });

  it('changelog 超过上限丢最旧，保留最新', () => {
    let brief = { goal: '', status: '', facts: [], open_questions: [], changelog: [] };
    for (let i = 0; i < CHANGELOG_MAX + 10; i += 1) {
      brief = applyBriefDelta(brief, { status: `s${i}` }, { taskId: 't1', now: `T${i}` });
    }
    expect(brief.changelog).toHaveLength(CHANGELOG_MAX);
    expect(brief.changelog[0].summary).toBe('现状更新：s10');
    expect(brief.changelog[brief.changelog.length - 1].summary).toBe(`现状更新：s${CHANGELOG_MAX + 9}`);
  });

  it('空 delta → brief 内容不变（仍是新对象）', () => {
    const brief = { goal: 'g', status: 's', facts: ['f'], open_questions: [], changelog: [] };
    const next = applyBriefDelta(brief, {}, { taskId: 't1', now: 'T1' });
    expect(next).toEqual(brief);
    expect(next).not.toBe(brief);
  });
});

describe('renderBriefMarkdown', () => {
  it('包含目标/现状/事实/未决问题/变更日志五段', () => {
    const brief = {
      goal: '目标X',
      status: '现状Y',
      facts: ['事实1'],
      open_questions: [{ id: 'q1', text: '问题1', opened_by_task: 't0' }],
      changelog: [{ at: '2026-10-01T00:00:00Z', task_id: 't1', kind: 'goal', summary: '目标改为：目标X' }],
    };
    const md = renderBriefMarkdown(brief);
    expect(md).toContain('## 目标');
    expect(md).toContain('目标X');
    expect(md).toContain('## 现状');
    expect(md).toContain('现状Y');
    expect(md).toContain('## 已知事实');
    expect(md).toContain('事实1');
    expect(md).toContain('## 未决问题');
    expect(md).toContain('问题1');
    expect(md).toContain('## 变更日志');
    expect(md).toContain('目标改为：目标X');
  });

  it('空 brief 渲染不报错', () => {
    expect(() => renderBriefMarkdown({})).not.toThrow();
    expect(renderBriefMarkdown(null)).toContain('未写目标');
  });
});

describe('formatBriefForPrompt', () => {
  it('空 brief → 空字符串', () => {
    expect(formatBriefForPrompt({})).toBe('');
    expect(formatBriefForPrompt(null)).toBe('');
  });

  it('含内容 → 目标/现状/事实/未决问题/最近变更', () => {
    const brief = {
      goal: '目标X',
      status: '现状Y',
      facts: ['f1', 'f2'],
      open_questions: [{ id: 'q1', text: '未决1', opened_by_task: 't0' }],
      changelog: [{ at: 'T1', task_id: 't1', kind: 'status', summary: '现状更新：现状Y' }],
    };
    const text = formatBriefForPrompt(brief);
    expect(text).toContain('目标：目标X');
    expect(text).toContain('现状：现状Y');
    expect(text).toContain('f1');
    expect(text).toContain('未决1');
    expect(text).toContain('现状更新：现状Y');
  });

  it('超过 maxLen 截断', () => {
    const brief = { goal: 'g'.repeat(2000), status: '', facts: [], open_questions: [], changelog: [] };
    const text = formatBriefForPrompt(brief, { maxLen: 100 });
    expect(text.length).toBeLessThanOrEqual(101);
    expect(text.endsWith('…')).toBe(true);
  });
});
