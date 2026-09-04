import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const guidePath = 'docs/current/attempt-run-bridge-guide.md';
const readGuide = () => readFileSync(guidePath, 'utf8');

describe('attempt-run 桥接使用说明冻结合同', () => {
  it('中文文档包含四节且不存在第五个一级主题节', () => {
    const text = readGuide();
    const sections = [...text.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(sections).toEqual(['端点用途', '鉴权方式', '角色白名单', 'payload 与失败回滚']);
    expect(text).toMatch(/[\u4e00-\u9fff]/u);
  });

  it('两个端点逐项存在且机械拒绝任意第三端点', () => {
    const text = readGuide();
    const endpoints = [...text.matchAll(/`(POST|GET) (\/api\/brain\/harness\/attempt-run(?:\/:id)?)`/g)]
      .map((match) => `${match[1]} ${match[2]}`);
    expect(endpoints).toEqual([
      'POST /api/brain/harness/attempt-run',
      'GET /api/brain/harness/attempt-run/:id',
    ]);
  });

  it('鉴权正向要求与远端无令牌负向禁令成对存在', () => {
    const text = readGuide();
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('宿主或远端请求必须携带 `Authorization: Bearer CECELIA_INTERNAL_TOKEN`');
    expect(text).toContain('禁止宿主或远端在未携带该 Bearer 令牌时调用');
  });

  it('九个角色逐项存在且机械拒绝任意第十角色', () => {
    const text = readGuide();
    const roles = [...text.matchAll(/^- `([^`]+)`$/gm)].map((match) => match[1]);
    expect(roles).toEqual([
      'canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix',
      'evaluator', 'evaluator-evidence-repair', 'judge',
    ]);
    expect(text).toContain('除上述封闭集合外，任意第十种角色都必须被机械拒绝');
  });

  it('三个必填字段与三个回滚终态分别构成封闭集合', () => {
    const text = readGuide();
    const required = [...text.matchAll(/^\d+\. `([^`]+)`：必填/gm)].map((match) => match[1]);
    expect(required).toEqual(['sprint_dir', 'base_repo', 'branch']);
    expect(text).toContain('`base_sha` 可省略，由生产 Brain 自解析');
    expect(text).toContain('任意第四个必填字段都必须被机械拒绝为合同外要求');
    const rollback = [...text.matchAll(/^- `(run→failed|session→closed|task→cancelled)`$/gm)]
      .map((match) => match[1]);
    expect(rollback).toEqual(['run→failed', 'session→closed', 'task→cancelled']);
    expect(text).toContain('禁止增加任意第四种回滚状态');
  });
});
