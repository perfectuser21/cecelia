import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const guidePath = 'docs/current/attempt-run-bridge-guide.md';
const allowedRoles = [
  'canary',
  'planner',
  'proposer',
  'reviewer',
  'generator',
  'generator-fix',
  'evaluator',
  'evaluator-evidence-repair',
  'judge',
];

function guide(): string {
  return readFileSync(guidePath, 'utf8');
}

describe('attempt-run 桥接使用说明合同', () => {
  it('说明两个 attempt-run 端点的独立用途与鉴权边界', () => {
    const text = guide();
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Bearer CECELIA_INTERNAL_TOKEN');
    expect(text).toMatch(/loopback/iu);
    expect(text).toMatch(/宿主|远端/u);
  });

  it('角色白名单精确等于九个权威角色且无别名', () => {
    const text = guide();
    const roleSection = text.match(/## 角色白名单([\s\S]*?)(?=\n## |$)/u)?.[1] ?? '';
    const documented = [...roleSection.matchAll(/^\s*-\s+`([^`]+)`\s*$/gmu)].map((m) => m[1]);
    expect(documented).toEqual(allowedRoles);
  });

  it('payload 独立断言三个必填字段与 base_sha 可选自解析语义', () => {
    const text = guide();
    const payloadSection = text.match(/## payload 字段([\s\S]*?)(?=\n## |$)/u)?.[1] ?? '';
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(payloadSection).toMatch(new RegExp('`' + field + '`[^\\n]*(必填|required)', 'iu'));
    }
    expect(payloadSection).toMatch(/`base_sha`[^\n]*(可选|可省略)/u);
    expect(payloadSection).toMatch(/生产 Brain[^\n]*自解析/u);
  });

  it('派发失败回滚精确覆盖 run session task 三个终态', () => {
    const text = guide();
    const rollbackSection = text.match(/## 派发失败自动回滚([\s\S]*?)(?=\n## |$)/u)?.[1] ?? '';
    expect(rollbackSection).toContain('run→failed');
    expect(rollbackSection).toContain('session→closed');
    expect(rollbackSection).toContain('task→cancelled');
  });
});
