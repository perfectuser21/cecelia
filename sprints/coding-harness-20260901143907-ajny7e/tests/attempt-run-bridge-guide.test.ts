import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const guidePath = 'docs/current/attempt-run-bridge-guide.md';
const expectedRoles = [
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

function readGuide(): string {
  return readFileSync(guidePath, 'utf8');
}

function section(body: string, heading: string): string {
  const match = body.match(new RegExp(`^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s|\\Z)`, 'm'));
  expect(match, `缺少独立章节：${heading}`).not.toBeNull();
  return match?.[1] ?? '';
}

describe('attempt-run 桥接使用说明冻结合同', () => {
  it('标题为 attempt-run 桥接使用说明且正文包含中文', async () => {
    const body = readGuide();
    expect(body).toMatch(/^#\s+attempt-run 桥接使用说明\s*$/m);
    expect(body).toMatch(/[\u4e00-\u9fff]/);
  });

  it('两个端点分别说明发起与查询用途', async () => {
    const body = readGuide();
    expect(body).toMatch(/POST `?\/api\/brain\/harness\/attempt-run`?[\s\S]{0,180}(发起|派发)/);
    expect(body).toMatch(/GET `?\/api\/brain\/harness\/attempt-run\/:id`?[\s\S]{0,180}(查询|轮询)/);
  });

  it('鉴权章节区分 loopback 与宿主远端 Bearer 要求', async () => {
    const auth = section(readGuide(), '鉴权方式');
    expect(auth).toContain('internalAuthOrLoopback');
    expect(auth).toContain('Bearer CECELIA_INTERNAL_TOKEN');
    expect(auth).toMatch(/(宿主|远端)[\s\S]{0,120}必须/);
    expect(auth).toMatch(/loopback|本机回环/i);
  });

  it('角色白名单恰好逐项列出九个服务端角色', async () => {
    const roles = section(readGuide(), '角色白名单');
    const bullets = [...roles.matchAll(/^\s*-\s+`([^`]+)`\s*$/gm)].map((match) => match[1]);
    expect(bullets).toEqual(expectedRoles);
    expect(new Set(bullets).size).toBe(9);
    expect(roles).toMatch(/白名单外[\s\S]{0,80}(不支持|不在支持范围)/);
  });

  it('payload 必填字段章节区分三个必填字段与可省略 base_sha', async () => {
    const payload = section(readGuide(), 'payload 必填字段');
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(payload).toMatch(new RegExp(`\\b${field}\\b[\\s\\S]{0,80}必填`));
    }
    expect(payload).toMatch(/base_sha[\s\S]{0,100}可省略/);
    expect(payload).toMatch(/base_sha[\s\S]{0,140}生产 Brain[\s\S]{0,80}自解析/);
  });

  it('派发失败自动回滚章节完整写出有序状态链', async () => {
    const rollback = section(readGuide(), '派发失败自动回滚');
    expect(rollback).toContain('run→failed/session→closed/task→cancelled');
  });

  it('示例不得泄露真实 internal token', async () => {
    const body = readGuide();
    expect(body).not.toMatch(/CECELIA_INTERNAL_TOKEN\s*=\s*["'][^"'$<{][^"']+["']/);
  });
});
