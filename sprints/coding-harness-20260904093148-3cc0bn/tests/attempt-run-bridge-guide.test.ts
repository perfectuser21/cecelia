import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const path = 'docs/current/attempt-run-bridge-guide.md';
const readGuide = () => readFileSync(path, 'utf8');

describe('attempt-run 桥接使用说明合同', () => {
  it('两个端点用途与鉴权说明完整', () => {
    const text = readGuide();
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Bearer CECELIA_INTERNAL_TOKEN');
  });

  it('九项角色白名单恰好逐项列出', () => {
    const text = readGuide();
    const roles = ['canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge'];
    for (const role of roles) expect(text).toMatch(new RegExp('^[-*] `' + role + '`$', 'm'));
    expect((text.match(/^[-*] `[^`]+`$/gm) ?? []).filter((line) => roles.some((role) => line === `- \`${role}\`` || line === `* \`${role}\``))).toHaveLength(9);
  });

  it('payload 三项必填且 base_sha 明确可省略并由生产 Brain 自解析', () => {
    const text = readGuide();
    for (const field of ['sprint_dir', 'base_repo', 'branch']) expect(text).toMatch(new RegExp('`' + field + '`.*必填'));
    expect(text).toMatch(/`base_sha`.*可省略.*生产 Brain.*自解析/);
  });

  it('派发失败回滚三类资源终态完整', () => {
    const text = readGuide();
    expect(text).toContain('run→failed');
    expect(text).toContain('session→closed');
    expect(text).toContain('task→cancelled');
  });
});
