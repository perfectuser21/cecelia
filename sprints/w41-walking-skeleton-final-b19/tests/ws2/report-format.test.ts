import { describe, it, expect } from 'vitest';

describe('Workstream 2 — verification-report 生成器 [BEHAVIOR]', () => {
  it('report 模块导出 buildReport(evidence) 函数', async () => {
    const mod: any = await import('../../../../packages/brain/scripts/build-w41-report.js');
    expect(typeof mod.buildReport).toBe('function');
  });

  it('buildReport 产物含 5 个指定 H2 章节标题', async () => {
    const mod: any = await import('../../../../packages/brain/scripts/build-w41-report.js');
    const md = mod.buildReport({
      seed: { demo_task_id: '00000000-0000-4000-8000-000000000000', injected_at: '2026-05-13T08:00:00Z' },
      trace: [{ round: 1, pr_url: 'https://github.com/org/repo/pull/1', pr_branch: 'cp-demo' }],
      proof: { PR_BRANCH: 'cp-demo', evaluator_HEAD: 'abc123', main_HEAD: 'def456' },
      verdict: 'PASS',
      fix_rounds: 2,
      evaluate_dispatches: 2,
    });
    expect(md).toMatch(/## B19 fix evidence/);
    expect(md).toMatch(/## PR_BRANCH 传递/);
    expect(md).toMatch(/## evaluator 在 PR 分支/);
    expect(md).toMatch(/## fix 循环触发证据/);
    expect(md).toMatch(/## task completed 收敛/);
  });

  it('buildReport 产物末尾含 ## 结论 段且引用 B19', async () => {
    const mod: any = await import('../../../../packages/brain/scripts/build-w41-report.js');
    const md = mod.buildReport({
      seed: { demo_task_id: '00000000-0000-4000-8000-000000000000', injected_at: '2026-05-13T08:00:00Z' },
      trace: [{ round: 1, pr_url: 'https://github.com/org/repo/pull/1', pr_branch: 'cp-demo' }],
      proof: { PR_BRANCH: 'cp-demo', evaluator_HEAD: 'abc123', main_HEAD: 'def456' },
      verdict: 'PASS',
      fix_rounds: 2,
      evaluate_dispatches: 2,
    });
    expect(md).toMatch(/## 结论/);
    const conclusion = md.split('## 结论')[1] || '';
    expect(conclusion).toMatch(/B19/);
    expect(conclusion).toMatch(/(真生效|已生效|未生效|失效)/);
  });

  it('buildReport 把 trace 里的 pr_url 字面值嵌入 report（防贴占位 URL）', async () => {
    const mod: any = await import('../../../../packages/brain/scripts/build-w41-report.js');
    const url = 'https://github.com/cecelia/repo/pull/2942';
    const md = mod.buildReport({
      seed: { demo_task_id: '00000000-0000-4000-8000-000000000000', injected_at: '2026-05-13T08:00:00Z' },
      trace: [{ round: 1, pr_url: url, pr_branch: 'cp-x' }, { round: 2, pr_url: url, pr_branch: 'cp-x' }],
      proof: { PR_BRANCH: 'cp-x', evaluator_HEAD: 'aaa', main_HEAD: 'bbb' },
      verdict: 'PASS',
      fix_rounds: 2,
      evaluate_dispatches: 2,
    });
    expect(md).toContain(url);
  });
});
