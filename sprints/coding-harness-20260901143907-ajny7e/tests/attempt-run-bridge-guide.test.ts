import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const guidePath = 'docs/current/attempt-run-bridge-guide.md';
const sprintDir = 'sprints/coding-harness-20260901143907-ajny7e/';
const baselineSha = '5d25dcd6addb8ba30c742281b682589a3b95eaab';
const execFileAsync = promisify(execFile);

async function readGuide() {
  return readFile(guidePath, 'utf8');
}

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('中文正文与四节结构完整', async () => {
    const text = await readGuide();
    expect(text).toContain('# attempt-run 桥接使用说明');
    expect(text).toMatch(/[\u4e00-\u9fff]{2,}/);
    expect([...text.matchAll(/^## (.+)$/gm)].map((match) => match[1])).toEqual([
      '端点用途与鉴权',
      '角色白名单',
      'payload 必填字段',
      '派发失败自动回滚',
    ]);
    for (const body of text.split(/^## .+$/m).slice(1)) {
      expect(body).toMatch(/[\u4e00-\u9fff]{2,}/);
    }
  });

  it('两个端点用途与鉴权规则完整', async () => {
    const text = await readGuide();
    const section = text.match(/## 端点用途与鉴权\n([\s\S]*?)(?=\n## )/)?.[1] ?? '';
    expect(section).toMatch(/POST `\/api\/brain\/harness\/attempt-run`[\s\S]*发起/);
    expect(section).toMatch(/GET `\/api\/brain\/harness\/attempt-run\/:id`[\s\S]*查询/);
    expect(section).toContain('internalAuthOrLoopback');
    expect(section).toContain('Bearer CECELIA_INTERNAL_TOKEN');
    expect(section).toMatch(/宿主[^\n]*远端[^\n]*必须/);
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

  it('全仓实现变更集合唯一', async () => {
    const { stdout } = await execFileAsync('git', [
      'diff', '--name-only', `${baselineSha}...HEAD`,
    ]);
    const changed = stdout.trim().split('\n').filter(Boolean).sort();
    const implementationChanges = changed.filter((path) => !path.startsWith(sprintDir));
    expect(implementationChanges).toEqual([guidePath]);
    expect(changed.every((path) => path === guidePath || path.startsWith(sprintDir))).toBe(true);
  });
});
