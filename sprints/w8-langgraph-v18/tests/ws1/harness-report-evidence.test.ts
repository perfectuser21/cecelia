import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPORT = resolve(process.cwd(), 'sprints/w8-langgraph-v18/harness-report.md');

function loadReport(): string {
  if (!existsSync(REPORT)) {
    throw new Error(`harness-report.md 未生成: ${REPORT}`);
  }
  return readFileSync(REPORT, 'utf8');
}

function extractSection(text: string, heading: string): string | null {
  const re = new RegExp(`##\\s*${heading}[\\s\\S]*?(?=\\n##\\s|$)`);
  const m = text.match(re);
  return m ? m[0] : null;
}

describe('Workstream 1 — harness-report.md 真跑证据 [BEHAVIOR]', () => {
  it('frontmatter 含合法 UUID v4 格式的 child_initiative_id', () => {
    const text = loadReport();
    const m = text.match(/^child_initiative_id:\s*([0-9a-f-]+)\s*$/m);
    expect(m, 'child_initiative_id 字段缺失').not.toBeNull();
    expect(m![1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('Final Status 段落明确写 completed', () => {
    const text = loadReport();
    const section = extractSection(text, 'Final Status');
    expect(section, 'Final Status 段落缺失').not.toBeNull();
    expect(section!.toLowerCase()).toContain('completed');
  });

  it('Evaluator Verdict 段落明确写 APPROVED', () => {
    const text = loadReport();
    const section = extractSection(text, 'Evaluator Verdict');
    expect(section, 'Evaluator Verdict 段落缺失').not.toBeNull();
    expect(section!).toMatch(/\bAPPROVED\b/);
  });

  it('报告含至少 1 条 https://github.com/.../pull/N 形式的 PR URL', () => {
    const text = loadReport();
    const urls = text.match(/https:\/\/github\.com\/[^/\s)\]]+\/[^/\s)\]]+\/pull\/\d+/g) ?? [];
    expect(urls.length, 'PR URL 至少需 1 条 (PR shape)').toBeGreaterThanOrEqual(1);
  });

  it('Subtask Summary 列出 ≥4 个 harness_* task_type 且全部 completed，无 failed/stuck', () => {
    const text = loadReport();
    const section = extractSection(text, 'Subtask Summary');
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

    expect(/\bfailed\b/i.test(section!) || /\bstuck\b/i.test(section!)).toBe(false);
  });
});
