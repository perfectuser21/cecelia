import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge-usage.md';
const ROLES = ['canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge'];

function section(text: string, heading: string): string {
  const marker = `## ${heading}`;
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`缺少章节: ${heading}`);
  const bodyStart = start + marker.length;
  const next = text.indexOf('\n## ', bodyStart);
  return text.slice(bodyStart, next < 0 ? text.length : next);
}

function listedCodeItems(text: string): string[] {
  return [...text.matchAll(/^- `([^`]+)`\s*$/gm)].map((match) => match[1]);
}

function assertContract(text: string) {
  expect(text).toMatch(/[\u4e00-\u9fff]/u);

  const endpoint = section(text, '端点用途与鉴权');
  for (const literal of [
    'POST /api/brain/harness/attempt-run',
    'GET /api/brain/harness/attempt-run/:id',
    'internalAuthOrLoopback',
    'Authorization: Bearer $CECELIA_INTERNAL_TOKEN',
  ]) expect(endpoint).toContain(literal);
  expect(endpoint).toMatch(/宿主.*远端.*必须.*Bearer/s);
  expect(endpoint).toMatch(/回环.*非回环/s);

  const roles = listedCodeItems(section(text, '角色白名单'));
  expect(roles).toHaveLength(9);
  expect(new Set(roles)).toEqual(new Set(ROLES));

  const payload = section(text, 'payload 必填字段');
  for (const field of ['sprint_dir', 'base_repo', 'branch']) {
    expect(payload).toMatch(new RegExp('`' + field + '`[^\\n]*必填'));
  }
  expect(payload).toMatch(/`base_sha`[^\n]*可省略/);
  expect(payload).toMatch(/base_sha[\s\S]*生产 Brain[\s\S]*解析/);

  const rollback = section(text, '派发失败自动回滚');
  for (const mapping of ['run → failed', 'session → closed', 'task → cancelled']) {
    expect(rollback).toContain(mapping);
  }
}

describe('attempt-run 桥接使用说明合同', () => {
  it('文档四节、中文、端点鉴权、九角色、payload 与回滚映射完整', () => {
    expect(fs.existsSync(DOC)).toBe(true);
    assertContract(fs.readFileSync(DOC, 'utf8'));
  });

  it('角色白名单恰好九项且任何缺项、多项或别名都失败', () => {
    const valid = `## 角色白名单\n\n${ROLES.map((role) => `- \`${role}\``).join('\n')}\n`;
    expect(() => listedCodeItems(section(valid, '角色白名单'))).not.toThrow();
    expect(listedCodeItems(section(valid, '角色白名单'))).toHaveLength(9);
    for (const invalid of [valid.replace('- `judge`\n', ''), `${valid}- \`reporter\`\n`, valid.replace('`judge`', '`arbiter`')]) {
      const actual = listedCodeItems(section(invalid, '角色白名单'));
      expect(actual.length === 9 && ROLES.every((role) => actual.includes(role))).toBe(false);
    }
  });

  it('每个正向内容 oracle 的对应负向变体都被拒绝', () => {
    const text = fs.readFileSync(DOC, 'utf8');
    const mutations = [
      ['POST /api/brain/harness/attempt-run', 'POST /wrong'],
      ['GET /api/brain/harness/attempt-run/:id', 'GET /wrong/:id'],
      ['internalAuthOrLoopback', 'publicAuth'],
      ['Authorization: Bearer $CECELIA_INTERNAL_TOKEN', '无需 token'],
      ['- `judge`', '- `arbiter`'],
      ['`sprint_dir`', '`sprint`'],
      ['`base_repo`', '`repo`'],
      ['`branch`', '`ref`'],
      ['`base_sha`', '`sha`'],
      ['run → failed', 'run → completed'],
      ['session → closed', 'session → open'],
      ['task → cancelled', 'task → queued'],
    ];
    expect(mutations).toHaveLength(12);
    for (const [from, to] of mutations) expect(() => assertContract(text.replace(from, to))).toThrow();
  });
});
