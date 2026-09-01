import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const guidePath = 'docs/current/attempt-run-bridge-guide.md';
const readGuide = () => readFileSync(guidePath, 'utf8');
const section = (body: string, heading: string) => {
  const match = body.match(new RegExp(`^## ${heading}\\s*$([\\s\\S]*?)(?=^## |$)`, 'm'));
  expect(match, `缺少独立章节：${heading}`).not.toBeNull();
  return match![1];
};

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('文档为中文且分别说明 POST 发起与 GET 查询用途', () => {
    const body = readGuide();
    expect(body).toMatch(/^# 《attempt-run 桥接使用说明》$/m);
    expect(body).toMatch(/[\u4e00-\u9fff]/);
    const endpoints = section(body, '端点用途');
    expect(endpoints).toMatch(/POST `?\/api\/brain\/harness\/attempt-run`?[\s\S]*(发起|派发)/);
    expect(endpoints).toMatch(/GET `?\/api\/brain\/harness\/attempt-run\/:id`?[\s\S]*(查询|轮询)/);
  });

  it('鉴权节区分 loopback 与宿主远端 Bearer 要求且不泄露令牌', () => {
    const auth = section(readGuide(), '鉴权方式');
    expect(auth).toContain('internalAuthOrLoopback');
    expect(auth).toMatch(/本机.*loopback/);
    expect(auth).toMatch(/宿主\/远端.*必须/);
    expect(auth).toContain('Bearer CECELIA_INTERNAL_TOKEN');
    expect(auth).not.toMatch(/Bearer\s+(?!CECELIA_INTERNAL_TOKEN\b)[A-Za-z0-9_-]{20,}/);
  });

  it('角色白名单完整列出九项且明确白名单外不支持', () => {
    const roles = section(readGuide(), '角色白名单');
    const listed = [...roles.matchAll(/^- `([^`]+)`\s*$/gm)].map((m) => m[1]);
    expect(listed).toEqual([
      'canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix',
      'evaluator', 'evaluator-evidence-repair', 'judge',
    ]);
    expect(roles).toMatch(/白名单外.*不.*支持/);
  });

  it('payload 节声明三个必填字段及 base_sha 生产自解析', () => {
    const payload = section(readGuide(), 'payload 必填字段');
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(payload).toMatch(new RegExp(`\\b${field}\\b[^\\n]*必填`));
    }
    expect(payload).toMatch(/\bbase_sha\b[^\n]*(可省略|非必填)/);
    expect(payload).toMatch(/base_sha[\s\S]*生产 Brain[\s\S]*自解析/);
  });

  it('派发失败节完整说明 run session task 的回滚终态和顺序', () => {
    const rollback = section(readGuide(), '派发失败自动回滚');
    expect(rollback).toContain('run→failed/session→closed/task→cancelled');
    expect(rollback.indexOf('run→failed')).toBeLessThan(rollback.indexOf('session→closed'));
    expect(rollback.indexOf('session→closed')).toBeLessThan(rollback.indexOf('task→cancelled'));
  });
});
