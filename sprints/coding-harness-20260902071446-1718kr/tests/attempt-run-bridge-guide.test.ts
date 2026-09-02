import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const GUIDE = resolve(process.cwd(), 'docs/current/attempt-run-bridge-guide.md');
const readGuide = () => readFileSync(GUIDE, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('POST 返回 202 LAUNCHED 与非空 IDs，GET 覆盖六项终态和 404 失败语义', () => {
    const text = readGuide();
    const post = text.match(/## POST \/api\/brain\/harness\/attempt-run([\s\S]*?)(?=\n## )/)?.[1] ?? '';
    expect(post).toContain('HTTP 202');
    expect(post).toMatch(/\.status\s*==\s*"LAUNCHED"/);
    expect(post).toMatch(/\.run_id\s*\|\s*(length\s*>\s*0|strings)/);
    expect(post).toMatch(/\.attempt_id\s*\|\s*(length\s*>\s*0|strings)/);

    const get = text.match(/## GET \/api\/brain\/harness\/attempt-run\/:id([\s\S]*?)(?=\n## )/)?.[1] ?? '';
    expect(get).toMatch(/\.id\s*==\s*\$id/);
    for (const status of ['completed', 'completed_with_concerns', 'failed', 'cancelled', 'blocked', 'needs_context']) {
      expect(get).toContain(status);
    }
    expect(get).toContain('HTTP 404');
    expect(get).toContain('attempt_not_found');
    expect(get).toMatch(/404[^\n]*(失败|FAIL)|失败[^\n]*404/i);
  });

  it('鉴权区分 loopback 与宿主远端且不泄露令牌', () => {
    const text = readGuide();
    const section = text.match(/## 鉴权方式([\s\S]*?)(?=\n## )/)?.[1] ?? '';
    for (const endpoint of ['POST /api/brain/harness/attempt-run', 'GET /api/brain/harness/attempt-run/:id']) {
      expect(section).toMatch(new RegExp(endpoint.replace(/[/:]/g, '\\$&') + '[^\\n]*internalAuthOrLoopback'));
    }
    expect(section).toContain('Authorization: Bearer <CECELIA_INTERNAL_TOKEN>');
    expect(section).toMatch(/loopback[\s\S]*无需/);
    expect(section).toMatch(/宿主|远端/);
    expect(section).not.toMatch(/CECELIA_INTERNAL_TOKEN\s*=\s*[^<\s`$][^\s`]*/);
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
