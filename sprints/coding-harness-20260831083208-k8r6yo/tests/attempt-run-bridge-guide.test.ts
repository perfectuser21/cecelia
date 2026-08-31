import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const guidePath = 'docs/current/ATTEMPT_RUN_BRIDGE_GUIDE.md';
const readGuide = () => readFileSync(guidePath, 'utf8');

describe('attempt-run 桥接使用说明', () => {
  it('说明 POST 与 GET 两个端点用途', () => {
    const text = readGuide();
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('异步派发');
    expect(text).toContain('轮询');
  });

  it('说明 internalAuthOrLoopback 与远端 Bearer 鉴权', () => {
    const text = readGuide();
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('宿主');
    expect(text).toContain('远端');
    expect(text).toContain('Authorization: Bearer');
    expect(text).toContain('CECELIA_INTERNAL_TOKEN');
  });

  it('完整列出九项角色白名单', () => {
    const text = readGuide();
    const roles = [
      'canary', 'planner', 'proposer', 'reviewer', 'generator',
      'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge',
    ];
    for (const role of roles) expect(text).toContain(`\`${role}\``);
  });

  it('说明 payload 必填字段与 base_sha 省略语义', () => {
    const text = readGuide();
    for (const field of ['payload.sprint_dir', 'payload.base_repo', 'payload.branch']) {
      expect(text).toContain(field);
    }
    expect(text).toContain('必填');
    expect(text).toContain('payload.base_sha');
    expect(text).toContain('可省略');
    expect(text).toContain('生产 Brain');
    expect(text).toContain('自解析');
  });

  it('说明派发失败自动回滚三类终态', () => {
    const text = readGuide();
    expect(text).toContain('派发失败自动回滚');
    expect(text).toMatch(/run[^\n]*failed/);
    expect(text).toMatch(/session[^\n]*closed/);
    expect(text).toMatch(/task[^\n]*cancelled/);
  });
});

