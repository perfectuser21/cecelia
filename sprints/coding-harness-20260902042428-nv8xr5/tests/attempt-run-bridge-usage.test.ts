import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge-usage.md';
const readDoc = () => readFileSync(DOC, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('包含两个端点用途与鉴权要求', () => {
    const doc = readDoc();
    expect(doc).toContain('POST /api/brain/harness/attempt-run');
    expect(doc).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(doc).toContain('internalAuthOrLoopback');
    expect(doc).toContain('Authorization: Bearer $CECELIA_INTERNAL_TOKEN');
    expect(doc).toMatch(/POST[\s\S]*创建|创建[\s\S]*POST/);
    expect(doc).toMatch(/GET[\s\S]*查询|查询[\s\S]*GET/);
    expect(doc).toMatch(/宿主[\s\S]*远端[\s\S]*Bearer/);
  });

  it('包含且仅声明冻结的九项角色白名单', () => {
    const doc = readDoc();
    const roles = ['planner', 'proposer', 'challenger', 'generator', 'evaluator', 'judge', 'fixer', 'reporter', 'merger'];
    for (const role of roles) expect(doc).toContain(`\`${role}\``);
    expect(doc).toMatch(/九项/);
    expect(doc).toMatch(/白名单外[^。\n]*不被接受/);
  });

  it('包含 payload 必填字段与 base_sha 省略语义', () => {
    const doc = readDoc();
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(doc).toMatch(new RegExp('`' + field + '`[^。\\n]*必填'));
    }
    expect(doc).toMatch(/`base_sha`[^。\n]*可省略/);
    expect(doc).toMatch(/省略[^。\n]*生产 Brain[^。\n]*自解析/);
  });

  it('包含派发失败的三类回滚终态', () => {
    const doc = readDoc();
    expect(doc).toContain('派发失败');
    expect(doc).toContain('run→failed');
    expect(doc).toContain('session→closed');
    expect(doc).toContain('task→cancelled');
  });
});
