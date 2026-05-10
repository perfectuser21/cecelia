import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPORT = resolve(process.cwd(), 'sprints/w8-langgraph-v18/harness-report.md');

let reportText = '';

beforeAll(() => {
  // commit 1（仅测试落盘，无 harness-report.md）阶段：
  // readFileSync 抛 ENOENT — 错误信息含 "Cannot find harness-report.md at sprints/w8-langgraph-v18/"，
  // beforeAll 抛错 → vitest 标记本 describe 下全部 5 个 it 为 FAIL，exit code = 1。
  // commit 2（Generator 写完报告）阶段：readFileSync 成功 → 5 个 it 进入断言。
  try {
    reportText = readFileSync(REPORT, 'utf8');
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code ?? 'UNKNOWN';
    throw new Error(
      `Cannot find harness-report.md at sprints/w8-langgraph-v18/ (errno=${code}). ` +
      `Generator must write the real-run evidence report before evaluator runs this test.`
    );
  }
});

function extractSection(text: string, heading: string): string | null {
  const re = new RegExp(`##\\s*${heading}[\\s\\S]*?(?=\\n##\\s|$)`);
  const m = text.match(re);
  return m ? m[0] : null;
}

describe('Workstream 1 — harness-report.md 真跑证据 [BEHAVIOR]', () => {
  it('child_initiative_id frontmatter is a valid UUID v4', () => {
    const m = reportText.match(/^child_initiative_id:\s*([0-9a-f-]+)\s*$/m);
    expect(m, 'child_initiative_id 字段缺失').not.toBeNull();
    expect(m![1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('Final Status section contains completed', () => {
    const section = extractSection(reportText, 'Final Status');
    expect(section, 'Final Status 段落缺失').not.toBeNull();
    expect(section!.toLowerCase()).toContain('completed');
  });

  it('Evaluator Verdict section contains APPROVED', () => {
    const section = extractSection(reportText, 'Evaluator Verdict');
    expect(section, 'Evaluator Verdict 段落缺失').not.toBeNull();
    expect(section!).toMatch(/\bAPPROVED\b/);
  });

  it('Report contains at least one https://github.com/.../pull/N URL', () => {
    const urls = reportText.match(/https:\/\/github\.com\/[^/\s)\]]+\/[^/\s)\]]+\/pull\/\d+/g) ?? [];
    expect(urls.length, 'PR URL 至少需 1 条 (github PR shape)').toBeGreaterThanOrEqual(1);
  });

  it('Subtask Summary lists 4+ distinct harness_* completed types with no failed/stuck', () => {
    const section = extractSection(reportText, 'Subtask Summary');
    expect(section, 'Subtask Summary 段落缺失').not.toBeNull();

    const harnessLines = section!.split('\n').filter(l => /harness_/.test(l));
    const completedLines = harnessLines.filter(l => /completed/i.test(l));
    expect(completedLines.length, 'Subtask Summary 需含 ≥4 行 harness_* completed').toBeGreaterThanOrEqual(4);

    const distinctTypes = new Set(
      harnessLines
        .map(l => l.match(/harness_[a-z_]+/)?.[0])
        .filter((v): v is string => Boolean(v))
    );
    expect(distinctTypes.size, '需覆盖 ≥4 种不同 harness_* task_type').toBeGreaterThanOrEqual(4);

    expect(
      /\bfailed\b/i.test(section!) || /\bstuck\b/i.test(section!),
      'Subtask Summary 出现 failed/stuck 字样即视为真跑失败'
    ).toBe(false);
  });
});
