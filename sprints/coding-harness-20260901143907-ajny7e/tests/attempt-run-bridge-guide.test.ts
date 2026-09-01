import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const guidePath = 'docs/current/attempt-run-bridge-guide.md';

async function readGuide() {
  return readFile(guidePath, 'utf8');
}

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('中文标题与两个端点用途完整', async () => {
    const text = await readGuide();
    expect(text).toContain('# attempt-run 桥接使用说明');
    expect(text).toMatch(/POST `\/api\/brain\/harness\/attempt-run`[\s\S]*发起/);
    expect(text).toMatch(/GET `\/api\/brain\/harness\/attempt-run\/:id`[\s\S]*查询/);
  });

  it('鉴权规则区分 loopback 与宿主远端', async () => {
    const text = await readGuide();
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Bearer CECELIA_INTERNAL_TOKEN');
    expect(text).toMatch(/宿主[^\n]*远端[^\n]*必须/);
  });

  it('角色白名单恰好列出九项固定角色', async () => {
    const text = await readGuide();
    const section = text.match(/## 角色白名单\n([\s\S]*?)(?=\n## )/)?.[1] ?? '';
    const roles = [...section.matchAll(/^- `([^`]+)`$/gm)].map((match) => match[1]);
    expect(roles).toEqual([
      'canary', 'planner', 'proposer', 'reviewer', 'generator',
      'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge',
    ]);
  });

  it('payload 字段与失败回滚链完整', async () => {
    const text = await readGuide();
    const payload = text.match(/## payload 必填字段\n([\s\S]*?)(?=\n## )/)?.[1] ?? '';
    expect(payload).toContain('`sprint_dir`');
    expect(payload).toContain('`base_repo`');
    expect(payload).toContain('`branch`');
    expect(payload).toMatch(/`base_sha`[^\n]*可省略[^\n]*生产 Brain[^\n]*解析/);
    expect(text).toMatch(/## 派发失败自动回滚[\s\S]*`run→failed\/session→closed\/task→cancelled`/);
  });
});
