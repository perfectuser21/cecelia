import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const guidePath = 'docs/current/attempt-run-bridge-guide.md';
const readGuide = () => readFileSync(guidePath, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('文档为中文且分别说明 POST 发起与 GET 查询用途', () => {
    const guide = readGuide();
    expect(guide).toContain('# attempt-run 桥接使用说明');
    expect(guide).toMatch(/POST `?\/api\/brain\/harness\/attempt-run`?/);
    expect(guide).toMatch(/GET `?\/api\/brain\/harness\/attempt-run\/:id`?/);
    expect(guide).toMatch(/发起|派发/);
    expect(guide).toMatch(/查询|轮询/);
  });

  it('鉴权节区分 loopback 与宿主远端 Bearer 要求且不泄露令牌', () => {
    const guide = readGuide();
    expect(guide).toContain('internalAuthOrLoopback');
    expect(guide).toContain('Bearer CECELIA_INTERNAL_TOKEN');
    expect(guide).toMatch(/loopback/);
    expect(guide).toMatch(/宿主|远端/);
    expect(guide).not.toMatch(/Bearer\s+(?!CECELIA_INTERNAL_TOKEN\b)[A-Za-z0-9._~+/=-]{16,}/);
  });

  it('角色白名单完整列出九项且明确白名单外不支持', () => {
    const guide = readGuide();
    const roles = [
      'canary', 'planner', 'proposer', 'reviewer', 'generator',
      'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge',
    ];
    for (const role of roles) expect(guide).toMatch(new RegExp(`(^|\\n)\\s*[-*]\\s+\\x60${role}\\x60`, 'm'));
    const listed = [...guide.matchAll(/^\s*[-*]\s+`([^`]+)`\s*$/gm)].map((match) => match[1]);
    expect(listed.filter((value) => roles.includes(value))).toHaveLength(9);
    expect(guide).toMatch(/白名单外.*不支持|不支持.*白名单外/);
  });

  it('payload 节声明三个必填字段及 base_sha 生产自解析', () => {
    const guide = readGuide();
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(guide).toMatch(new RegExp(`\\x60${field}\\x60[^\\n]*必填`));
    }
    expect(guide).toMatch(/`base_sha`[^\n]*(可省略|非必填)[^\n]*生产 Brain[^\n]*自解析/);
  });

  it('派发失败节完整说明 run session task 的回滚终态和顺序', () => {
    const guide = readGuide();
    expect(guide).toContain('run→failed/session→closed/task→cancelled');
    expect(guide).toMatch(/派发失败/);
  });
});
