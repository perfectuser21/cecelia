import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const docPath = 'docs/current/attempt-run-bridge-guide.md';
const readGuide = () => readFileSync(docPath, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('说明两个端点及 internalAuthOrLoopback 鉴权', () => {
    const text = readGuide();
    for (const value of ['POST /api/brain/harness/attempt-run', 'GET /api/brain/harness/attempt-run/:id', 'internalAuthOrLoopback', 'Authorization: Bearer $CECELIA_INTERNAL_TOKEN', '宿主', '远端']) {
      expect(text).toContain(value);
    }
  });

  it('列出九项角色白名单', () => {
    const text = readGuide();
    const roles = ['canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge'];
    expect(text).toContain('九项');
    for (const role of roles) expect(text).toContain(role);
  });

  it('说明 payload 必填字段和 base_sha 省略语义', () => {
    const text = readGuide();
    for (const value of ['sprint_dir', 'base_repo', 'branch', 'base_sha', '可省略', '生产 Brain']) expect(text).toContain(value);
  });

  it('说明派发失败的三资源回滚终态', () => {
    const text = readGuide();
    for (const value of ['派发失败', '自动回滚', 'run → failed', 'session → closed', 'task → cancelled']) expect(text).toContain(value);
  });

  it('目标文档为中文且本 sprint 不要求代码改动', () => {
    expect(readGuide()).toMatch(/[\u3400-\u9fff]/u);
  });
});

