import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const guidePath = 'docs/current/attempt-run-bridge-guide.md';
const readGuide = () => readFileSync(guidePath, 'utf8');

describe('attempt-run 桥接使用说明合同', () => {
  it('文档存在于 docs/current 且包含中文四节', () => {
    const text = readGuide();
    for (const heading of ['## 端点用途', '## 鉴权方式', '## 角色白名单与 payload', '## 派发失败自动回滚']) {
      expect(text).toContain(heading);
    }
    expect(text).toMatch(/[\u4e00-\u9fff]{20,}/);
  });

  it('两个端点用途与 internalAuthOrLoopback 鉴权说明完整', () => {
    const text = readGuide();
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toMatch(/POST[\s\S]*创建并派发/);
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toMatch(/GET[\s\S]*按.*id.*查询.*状态/);
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Authorization: Bearer CECELIA_INTERNAL_TOKEN');
    expect(text).toMatch(/宿主|远端/);
    expect(text).toMatch(/loopback/);
  });

  it('角色白名单精确列出九项且 payload 必填与 base_sha 省略语义正确', () => {
    const text = readGuide();
    const roles = ['canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge'];
    for (const role of roles) expect(text).toMatch(new RegExp(`(?:^|\\n)\\s*[-*]\\s+\`${role}\`(?:\\s|$)`, 'm'));
    expect(text.match(/^\s*[-*]\s+`(?:canary|planner|proposer|reviewer|generator|generator-fix|evaluator|evaluator-evidence-repair|judge)`\s*$/gm)).toHaveLength(9);
    for (const field of ['sprint_dir', 'base_repo', 'branch']) expect(text).toMatch(new RegExp(`\`${field}\`[：:]?[^\\n]*必填`));
    expect(text).toMatch(/`base_sha`[^\n]*(可省略|选填)[^\n]*生产 Brain[^\n]*解析/);
  });

  it('派发失败回滚同时收敛 run session task 三类状态', () => {
    const text = readGuide();
    expect(text).toContain('run → failed');
    expect(text).toContain('session → closed');
    expect(text).toContain('task → cancelled');
    expect(text).toMatch(/派发失败[\s\S]*(自动回滚|自动收敛)/);
  });
});
