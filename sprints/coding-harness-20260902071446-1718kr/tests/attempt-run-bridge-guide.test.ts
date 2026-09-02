import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const docPath = 'docs/current/attempt-run-bridge-guide.md';
const baseline = '7a156f791feca8815bfabfbadce2ad874acf02af';
const readDoc = () => readFileSync(docPath, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('中文标题并覆盖两个端点与鉴权边界', () => {
    const text = readDoc();
    expect(text).toMatch(/^# attempt-run 桥接使用说明/m);
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Authorization: Bearer <CECELIA_INTERNAL_TOKEN>');
  });

  it('恰好列出九项角色并说明 payload 必填字段', () => {
    const text = readDoc();
    const section = text.match(/## 角色白名单[\s\S]*?(?=\n## |$)/)?.[0] ?? '';
    const listed = [...section.matchAll(/^- `([^`]+)`$/gm)].map((match) => match[1]);
    expect(listed).toEqual([
      'canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix',
      'evaluator', 'evaluator-evidence-repair', 'judge',
    ]);
    expect(text).toContain('sprint_dir');
    expect(text).toContain('base_repo');
    expect(text).toContain('branch');
  });

  it('base_sha 可省略并由生产 Brain 自解析', () => {
    const text = readDoc();
    expect(text).toContain('base_sha');
    expect(text).toContain('可省略');
    expect(text).toContain('生产 Brain 自解析');
  });

  it('同时说明派发失败的三个终态', () => {
    const text = readDoc();
    expect(text).toContain('run→failed');
    expect(text).toContain('session→closed');
    expect(text).toContain('task→cancelled');
  });

  it('唯一产品交付文件是桥接说明文档', () => {
    const changed = execFileSync('git', [
      'diff', '--name-only', '--diff-filter=ACMRT', `${baseline}...HEAD`, '--', 'docs/current', 'packages', 'apps',
    ], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    expect(changed).toEqual([docPath]);
  });
});

