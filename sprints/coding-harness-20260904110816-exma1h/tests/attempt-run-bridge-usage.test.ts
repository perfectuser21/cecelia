import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { ALLOWED_ROLES } from '../../../packages/brain/src/routes/harness-attempt-run.js';

const DOC = 'docs/current/attempt-run-bridge-usage.md';

function readDoc(): string {
  return readFileSync(DOC, 'utf8');
}

function section(body: string, title: string): string {
  const match = body.match(new RegExp(`^## ${title}\\s*$([\\s\\S]*?)(?=^## |\\Z)`, 'm'));
  expect(match, `缺少章节：${title}`).not.toBeNull();
  return match![1];
}

describe('attempt-run 桥接使用说明合同', () => {
  it('端点用途与鉴权正向内容完整，且负向边界明确', () => {
    const body = section(readDoc(), '端点用途与鉴权');
    for (const literal of [
      'POST /api/brain/harness/attempt-run',
      'GET /api/brain/harness/attempt-run/:id',
      'internalAuthOrLoopback',
      'Bearer',
      'CECELIA_INTERNAL_TOKEN',
    ]) expect(body).toContain(literal);
    expect(body).toMatch(/POST[\s\S]*(创建|派发)/);
    expect(body).toMatch(/GET[\s\S]*(查询|状态)/);
    expect(body).toMatch(/(宿主|远端)[\s\S]*(必须|需要)[\s\S]*Bearer/);
    expect(body).toMatch(/(缺少|缺失|错误)[\s\S]*(拒绝|不可访问|不能访问)/);
    expect(body).not.toMatch(/(宿主|远端)[^。\n]*(无需|免)[^。\n]*(token|鉴权)/i);
    expect(body).not.toMatch(/Bearer\s+[A-Za-z0-9_-]{16,}/);
  });

  it('角色白名单先完整列名再计数，且与生产集合不多不少', () => {
    const body = section(readDoc(), '角色白名单');
    const roles = [...body.matchAll(/^\s*-\s+`([^`]+)`\s*$/gm)].map((match) => match[1]);
    expect(roles).toHaveLength(9);
    expect(new Set(roles).size).toBe(9);
    expect([...roles].sort()).toEqual([...ALLOWED_ROLES].sort());
    expect(body).toMatch(/(共|合计|总计)\s*9\s*项/);
    expect(roles).not.toContain('commander');
    expect(roles).not.toContain('publisher');
  });

  it('payload 正确区分三个必填字段与 base_sha 可省略', () => {
    const body = section(readDoc(), 'payload 必填字段');
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(body).toMatch(new RegExp('`' + field + '`[^。\\n]*(必填|必须提供)'));
    }
    expect(body).toMatch(/`base_sha`[^。\n]*可省略/);
    expect(body).toMatch(/省略[^。\n]*生产 Brain[^。\n]*自解析/);
    expect(body).not.toMatch(/`(sprint_dir|base_repo|branch)`[^。\n]*(可省略|自动补全|代填)/);
    expect(body).not.toMatch(/`base_sha`[^。\n]*必填/);
  });

  it('派发失败列全三组回滚终态且禁止部分成功解释', () => {
    const body = section(readDoc(), '派发失败自动回滚');
    expect(body).toContain('run → failed');
    expect(body).toContain('session → closed');
    expect(body).toContain('task → cancelled');
    expect(body).toMatch(/(三项|三个|全部)[^。\n]*(回滚|终态)|完整回滚[^。\n]*(三项|三个|全部)/);
    expect(body).not.toMatch(/只要\s*run[^。\n]*(即可|就算|成功)/);
  });

  it('冻结基线范围只允许新增一页 docs/current 中文 Markdown', () => {
    const baseSha = process.env.BASE_SHA;
    expect(baseSha).toBe('e0a56e2efaa96a5e9b1759f6b1086282121454dd');
    const sprintDir = 'sprints/coding-harness-20260904110816-exma1h';
    const lines = execFileSync(
      'git',
      ['diff', '--name-status', `${baseSha}...HEAD`, '--', '.', `:(exclude)${sprintDir}/**`],
      { encoding: 'utf8' },
    )
      .trim().split('\n').filter(Boolean);
    expect(lines).toEqual([`A\t${DOC}`]);
    expect(readDoc()).toMatch(/[\u4e00-\u9fff]/);
  });
});
