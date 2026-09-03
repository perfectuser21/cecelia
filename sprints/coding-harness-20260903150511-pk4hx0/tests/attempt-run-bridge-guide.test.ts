import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
const readDoc = () => fs.readFileSync(DOC, 'utf8');
const section = (text: string, heading: string) => {
  const match = text.match(new RegExp(`^## ${heading}\\s*$([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'));
  expect(match, `缺少“${heading}”二级章节`).not.toBeNull();
  return match![1];
};
const backtickItems = (text: string) => [...text.matchAll(/^- `([^`]+)`\s*$/gm)].map((m) => m[1]);

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('两个端点用途与鉴权形成正负闭环', () => {
    const body = section(readDoc(), '端点用途与鉴权');
    expect(body).toContain('POST /api/brain/harness/attempt-run');
    expect(body).toMatch(/POST[^\n]*(创建|派发)/);
    expect(body).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(body).toMatch(/GET[^\n]*(按 id 查询|查询)/);
    expect(body).toContain('internalAuthOrLoopback');
    expect(body).toContain('Bearer CECELIA_INTERNAL_TOKEN');
    expect(body).toMatch(/宿主\/远端[^\n]*必须/);
    expect(body).not.toMatch(/(宿主|远端)[^\n]*(免鉴权|无需[^\n]*Bearer)/);
  });

  it('九项角色白名单是封闭集合', () => {
    const roles = backtickItems(section(readDoc(), '角色白名单'));
    expect(roles).toEqual([
      'canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix',
      'evaluator', 'evaluator-evidence-repair', 'judge',
    ]);
    expect(roles).not.toContain('commander');
    expect(roles).not.toContain('publisher');
  });

  it('payload 必填集合与 base_sha 省略语义形成正负闭环', () => {
    const body = section(readDoc(), 'payload 字段');
    const required = [...body.matchAll(/^- `([^`]+)`：必填/gm)].map((m) => m[1]);
    expect(required).toEqual(['sprint_dir', 'base_repo', 'branch']);
    expect(required).not.toContain('base_sha');
    expect(body).toMatch(/`base_sha`[^\n]*可省略[^\n]*生产 Brain[^\n]*自解析/);
  });

  it('派发失败回滚集合形成正负闭环', () => {
    const body = section(readDoc(), '派发失败自动回滚');
    const transitions = [...body.matchAll(/^- `([^`]+)`\s*$/gm)].map((m) => m[1]);
    expect(transitions).toEqual(['run→failed', 'session→closed', 'task→cancelled']);
    expect(body).toContain('自动回滚');
  });
});
