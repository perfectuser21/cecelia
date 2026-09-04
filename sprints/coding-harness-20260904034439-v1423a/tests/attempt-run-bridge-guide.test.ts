import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
const BASE_SHA = 'bdaca81b5cbf78929fa3d8eeac2a24cae6113b98';
const SPRINT = 'sprints/coding-harness-20260904034439-v1423a';

function text(): string {
  return fs.readFileSync(DOC, 'utf8');
}

function closedList(source: string, marker: string): string[] {
  const match = source.match(new RegExp(`<!-- ${marker}:BEGIN -->([\\s\\S]*?)<!-- ${marker}:END -->`));
  expect(match, `${marker} 标记区必须存在`).not.toBeNull();
  return [...match![1].matchAll(/^\s*- `([^`]+)`\s*$/gm)].map((item) => item[1]);
}

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('两个端点用途与中文正文完整且拒绝漏项', () => {
    const source = text();
    expect(source).toMatch(/[\u4e00-\u9fff]/);
    for (const required of ['POST /api/brain/harness/attempt-run', 'GET /api/brain/harness/attempt-run/:id', '创建', '查询']) {
      expect(source).toContain(required);
    }
  });

  it('鉴权说明完整且拒绝免鉴权误导', () => {
    const source = text();
    for (const required of ['internalAuthOrLoopback', 'Authorization', 'Bearer CECELIA_INTERNAL_TOKEN', '宿主', '远端', '必须']) {
      expect(source).toContain(required);
    }
    for (const forbidden of ['所有请求均可免鉴权', '宿主可免鉴权', '远端可免鉴权']) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('角色白名单恰好九项且拒绝增删重复', () => {
    expect(closedList(text(), 'ROLE_ALLOWLIST')).toEqual([
      'planner', 'proposer', 'proposer-critic', 'generator', 'generator-critic',
      'evaluator', 'evaluator-critic', 'reporter', 'reporter-critic',
    ]);
  });

  it('payload 必填恰好三项且 base_sha 可省略并保持基线', () => {
    const source = text();
    expect(closedList(source, 'REQUIRED_PAYLOAD')).toEqual(['sprint_dir', 'base_repo', 'branch']);
    for (const required of ['base_sha', '可省略', '生产 Brain', '各角色', 'GAN 轮次', '保持不变', '不得替代实现基线']) {
      expect(source).toContain(required);
    }
    for (const forbidden of ['base_sha`（必填', 'base_sha 为必填', '角色切换时重置实现基线']) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('失败回滚恰好三个终态且不是部分成功', () => {
    const source = text();
    expect(closedList(source, 'ROLLBACK_STATES')).toEqual(['run→failed', 'session→closed', 'task→cancelled']);
    expect(source).toContain('不是部分成功');
  });

  it('canonical 全仓 diff 仅含合同产物与唯一说明文档', () => {
    const actual = execFileSync('git', ['diff', '--name-only', `${BASE_SHA}...HEAD`, '--', '.'], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean).sort();
    expect(actual).toEqual([
      DOC,
      `${SPRINT}/contract-dod.md`,
      `${SPRINT}/contract-draft.md`,
      `${SPRINT}/task-plan.json`,
      `${SPRINT}/tests/attempt-run-bridge-guide.test.ts`,
    ].sort());
  });
});

