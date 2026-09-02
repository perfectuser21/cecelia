import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const GUIDE = resolve(process.cwd(), 'docs/current/attempt-run-bridge-guide.md');
const readGuide = () => readFileSync(GUIDE, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('POST 创建与 GET 状态查询给出可执行语义 oracle', () => {
    const text = readGuide();
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('HTTP 202');
    expect(text).toMatch(/\.status\s*==\s*"LAUNCHED"/);
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toMatch(/\.id\s*==\s*\$id/);
    expect(text).toMatch(/completed_with_concerns/);
  });

  it('鉴权区分 loopback 与宿主远端且不泄露令牌', () => {
    const text = readGuide();
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Authorization: Bearer <CECELIA_INTERNAL_TOKEN>');
    expect(text).toMatch(/loopback[\s\S]*无需/);
    expect(text).toMatch(/宿主|远端/);
    expect(text).not.toMatch(/CECELIA_INTERNAL_TOKEN\s*=\s*[^<\s`$][^\s`]*/);
  });

  it('角色白名单逐项列出九项角色', () => {
    const text = readGuide();
    const section = text.match(/## 角色白名单([\s\S]*?)(?=\n## )/)?.[1] ?? '';
    const roles = ['canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge'];
    for (const role of roles) expect(section).toContain(`\`${role}\``);
    expect(section.match(/^- `[^`]+`$/gm)).toHaveLength(9);
    expect(section).not.toMatch(/等角色|等等|etc/i);
  });

  it('payload 必填三字段且 base_sha 可省略由生产 Brain 自解析', () => {
    const text = readGuide();
    const section = text.match(/## payload 字段([\s\S]*?)(?=\n## )/)?.[1] ?? '';
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(section).toMatch(new RegExp('`' + field + '`[^\\n]*必填'));
    }
    expect(section).toMatch(/`base_sha`[^\n]*可省略[^\n]*生产 Brain[^\n]*自解析/);
  });

  it('派发失败回滚同时说明 run session task 三个终态', () => {
    const text = readGuide();
    const section = text.match(/## 派发失败自动回滚([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
    expect(section).toContain('run→failed');
    expect(section).toContain('session→closed');
    expect(section).toContain('task→cancelled');
  });
});
