import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const docPath = 'docs/current/attempt-run-bridge-guide.md';

function readGuide(): string {
  return fs.readFileSync(docPath, 'utf8');
}

function section(text: string, title: string): string {
  const match = text.match(new RegExp(`^## ${title}\\s*$([\\s\\S]*?)(?=^## |\\Z)`, 'm'));
  expect(match, `缺少章节：${title}`).not.toBeNull();
  return match?.[1] ?? '';
}

describe('attempt-run 桥接使用说明', () => {
  it('说明两个端点与鉴权方式', () => {
    const content = section(readGuide(), '端点与鉴权');
    expect(content).toContain('POST /api/brain/harness/attempt-run');
    expect(content).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(content).toContain('internalAuthOrLoopback');
    expect(content).toContain('Bearer CECELIA_INTERNAL_TOKEN');
  });

  it('列出完整九项角色白名单', () => {
    const content = section(readGuide(), '角色白名单');
    const roles = content.match(/`([^`]+)`/g)?.map((role) => role.slice(1, -1)) ?? [];
    expect(roles).toEqual([
      'canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix',
      'evaluator', 'evaluator-evidence-repair', 'judge',
    ]);
    expect(content).not.toMatch(/`(?:commander|publisher)`/);
  });

  it('说明 payload 必填字段与 base_sha 省略规则', () => {
    const content = section(readGuide(), 'payload 字段');
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(content).toMatch(new RegExp(`\\b${field}\\b[^\\n]*必填`));
    }
    expect(content).toMatch(/\bbase_sha\b[^\n]*(?:可省略|无需提供)/);
    expect(content).toMatch(/生产 Brain[^\n]*自解析/);
  });

  it('说明派发失败的三资源回滚状态', () => {
    const content = section(readGuide(), '派发失败自动回滚');
    expect(content).toContain('run → failed');
    expect(content).toContain('session → closed');
    expect(content).toContain('task → cancelled');
  });
});
