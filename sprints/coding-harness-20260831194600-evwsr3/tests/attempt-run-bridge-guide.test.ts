import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const guidePath = 'docs/current/attempt-run-bridge-guide.md';
const readGuide = () => readFileSync(guidePath, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('中文文档说明提交与查询两个端点用途', () => {
    const text = readGuide();
    expect(text).toContain('# attempt-run 桥接使用说明');
    expect(text).toMatch(/POST `?\/api\/brain\/harness\/attempt-run`?.*提交/s);
    expect(text).toMatch(/GET `?\/api\/brain\/harness\/attempt-run\/:id`?.*查询/s);
  });

  it('鉴权节区分 loopback 与宿主远端 Bearer 要求且不泄露凭据', () => {
    const text = readGuide();
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Bearer CECELIA_INTERNAL_TOKEN');
    expect(text).toMatch(/loopback.*免于显式携带|loopback.*无需显式携带/s);
    expect(text).toMatch(/宿主.*远端.*必须.*Bearer/s);
  });

  it('角色白名单完整列出权威九项且无增漏', () => {
    const text = readGuide();
    const roles = [...text.matchAll(/^\s*[-*]\s+`(canary|planner|proposer|reviewer|generator|generator-fix|evaluator|evaluator-evidence-repair|judge)`\s*$/gm)].map((m) => m[1]);
    expect(roles).toEqual(['canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge']);
  });

  it('payload 节区分三个必填字段与可省略 base_sha', () => {
    const text = readGuide();
    expect(text).toMatch(/payload.*sprint_dir.*base_repo.*branch/s);
    expect(text).toMatch(/`base_sha`.*可省略.*生产 Brain.*自解析/s);
    expect(text).not.toMatch(/`base_sha`[^\n]{0,30}必填/);
  });

  it('派发失败节完整说明三类资源自动回滚终态', () => {
    const text = readGuide();
    expect(text).toContain('run→failed');
    expect(text).toContain('session→closed');
    expect(text).toContain('task→cancelled');
    expect(text).toMatch(/派发失败.*自动回滚/s);
  });
});
