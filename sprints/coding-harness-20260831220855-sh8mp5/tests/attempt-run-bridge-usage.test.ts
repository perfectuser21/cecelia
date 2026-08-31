import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge-usage.md';

function readDoc() {
  return readFileSync(DOC, 'utf8');
}

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('分别说明创建与查询端点用途', () => {
    const doc = readDoc();
    expect(doc).toMatch(/POST \/api\/brain\/harness\/attempt-run[^\n]*(创建|派发)/);
    expect(doc).toMatch(/GET \/api\/brain\/harness\/attempt-run\/:id[^\n]*查询/);
  });

  it('分别证明宿主和远端必须携带 Bearer', () => {
    const doc = readDoc();
    expect(doc).toContain('internalAuthOrLoopback');
    expect(doc).toMatch(/宿主[^。\n]*必须[^。\n]*Bearer[^。\n]*CECELIA_INTERNAL_TOKEN/);
    expect(doc).toMatch(/远端[^。\n]*必须[^。\n]*Bearer[^。\n]*CECELIA_INTERNAL_TOKEN/);
    expect(doc).toMatch(/loopback[^。\n]*(开发|本机)/i);
  });

  it('精确列出九项角色白名单', () => {
    const doc = readDoc();
    const section = doc.match(/## 角色白名单\n([\s\S]*?)(?=\n## )/);
    expect(section).not.toBeNull();
    const roles = [...section![1].matchAll(/^- `([^`]+)`$/gm)].map((match) => match[1]);
    expect(roles).toEqual([
      'canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix',
      'evaluator', 'evaluator-evidence-repair', 'judge',
    ]);
  });

  it('分别声明三个必填字段和可省略 base_sha', () => {
    const doc = readDoc();
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(doc).toMatch(new RegExp(`\\\`${field}\\\`[^。\\n]*必填`));
    }
    expect(doc).toMatch(/`base_sha`[^。\n]*可省略[^。\n]*生产 Brain[^。\n]*自解析/);
  });

  it('写明派发失败的三个自动回滚终态', () => {
    const doc = readDoc();
    expect(doc).toContain('run→failed');
    expect(doc).toContain('session→closed');
    expect(doc).toContain('task→cancelled');
    expect(doc).toMatch(/不承诺[^。\n]*(重试|补偿)/);
  });
});

