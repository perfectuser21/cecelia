import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const GUIDE_PATH = 'docs/current/attempt-run-bridge-guide.md';
const EXPECTED_ROLES = [
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

function section(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = markdown.match(new RegExp(`^## ${escaped}\\s*$([\\s\\S]*?)(?=^## |\\Z)`, 'm'));
  expect(match, `缺少独立章节：${heading}`).not.toBeNull();
  return match![1];
}

function validateEndpointAndAuth(markdown: string): void {
  const endpoint = section(markdown, '端点用途');
  expect(endpoint).toMatch(/POST `?\/api\/brain\/harness\/attempt-run`?.*(创建|派发)/s);
  expect(endpoint).toMatch(/GET `?\/api\/brain\/harness\/attempt-run\/:id`?.*(查询|轮询)/s);
  expect(endpoint).not.toMatch(/POST[^\n]*(查询|轮询)|GET[^\n]*(创建|派发)/);

  const auth = section(markdown, '鉴权方式');
  expect(auth).toContain('internalAuthOrLoopback');
  expect(auth).toMatch(/loopback[^\n]*(允许|放行)|本机回环[^\n]*(允许|放行)/i);
  expect(auth).toMatch(/(宿主|远端)[\s\S]*(Authorization:\s*)?Bearer CECELIA_INTERNAL_TOKEN/);
  expect(auth).not.toMatch(/(宿主|远端)[^\n]*(免鉴权|无需[^\n]*(token|Bearer)|可不带[^\n]*(token|Bearer))/i);
}

function validatePayload(markdown: string): void {
  const payload = section(markdown, 'payload 字段');
  for (const field of ['sprint_dir', 'base_repo', 'branch']) {
    expect(payload).toMatch(new RegExp(`\\b${field}\\b[^\\n]*(必填|required)`, 'i'));
    expect(payload).not.toMatch(new RegExp(`\\b${field}\\b[^\\n]*(可省略|可选|optional)`, 'i'));
  }
  expect(payload).toMatch(/\bbase_sha\b[^\n]*(可省略|可选|optional)/i);
  expect(payload).toMatch(/\bbase_sha\b[^\n]*生产 Brain[^\n]*(解析|解析得到|自解析)/i);
  expect(payload).not.toMatch(/\bbase_sha\b[^\n]*(必填|required|固定使用角色 checkout)/i);
}

describe('attempt-run 桥接使用说明冻结合同', () => {
  it('端点用途与鉴权边界结构化且矛盾表述会失败', () => {
    const guide = fs.readFileSync(GUIDE_PATH, 'utf8');
    validateEndpointAndAuth(guide);
    expect(() => validateEndpointAndAuth(guide.replace('宿主或远端必须', '宿主或远端无需 Bearer，且'))).toThrow();
  });

  it('角色白名单恰好逐项列出九个服务端角色', () => {
    const roles = section(fs.readFileSync(GUIDE_PATH, 'utf8'), '角色白名单')
      .split('\n')
      .map((line) => line.match(/^\s*-\s+`([^`]+)`\s*$/)?.[1])
      .filter((value): value is string => Boolean(value));
    expect(roles).toEqual(EXPECTED_ROLES);
  });

  it('payload 三个必填字段与 base_sha 可省略语义独立且矛盾表述会失败', () => {
    const guide = fs.readFileSync(GUIDE_PATH, 'utf8');
    validatePayload(guide);
    expect(() => validatePayload(guide.replace('`branch`：必填', '`branch`：可省略'))).toThrow();
    expect(() => validatePayload(guide.replace('`base_sha`：可省略', '`base_sha`：必填'))).toThrow();
  });

  it('派发失败回滚同时锁定 run session task 三个终态', () => {
    const rollback = section(fs.readFileSync(GUIDE_PATH, 'utf8'), '派发失败自动回滚');
    expect(rollback).toContain('run→failed');
    expect(rollback).toContain('session→closed');
    expect(rollback).toContain('task→cancelled');
  });
});
