import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';

// 相对仓库根执行（evaluator/generator 在 repo root 跑 npx vitest run sprints/.../tests/）
const DOC_PATH = 'docs/fire-drills/kernel-v1-mixed-20260724.md';
const ROLES = ['planner', 'proposer', 'reviewer', 'generator', 'evaluator', 'judge'];
const ASSIGNMENTS = [
  'planner=claude/account1',
  'proposer=claude/account1',
  'reviewer=grok/grok',
  'generator=codex/team3',
  'evaluator=claude/account2',
];

async function doc(): Promise<string> {
  return await readFile(DOC_PATH, 'utf8');
}

describe('kernel-v1 mixed fire drill 演练文档 [BEHAVIOR]', () => {
  it('演练文档存在且含标记 KERNEL_V1_MIXED_FIRE_DRILL_PASS', async () => {
    const c = await doc();
    expect(c).toContain('KERNEL_V1_MIXED_FIRE_DRILL_PASS');
  });

  it('演练文档含版本 1.267.65 与 merge commit 4ff4112ae 字面', async () => {
    const c = await doc();
    expect(c).toContain('1.267.65');
    expect(c).toContain('4ff4112ae55bbab9467dcecff6be0ba222a67cd8');
  });

  it('六角色证据段齐全且每段含 provider/account/evidence 行', async () => {
    const c = await doc();
    const parts = c.split(/^## role: /m).slice(1);
    const seen = new Map(parts.map((p) => [p.split(/\r?\n/)[0].trim(), p]));
    for (const r of ROLES) {
      expect(seen.has(r), `缺角色段 ${r}`).toBe(true);
      for (const f of ['- provider: ', '- account: ', '- evidence: ']) {
        expect(seen.get(r)!.includes(f), `${r} 段缺 ${f.trim()} 行`).toBe(true);
      }
    }
    for (const a of ASSIGNMENTS) {
      expect(c, `缺 role_assignments 对照字面 ${a}`).toContain(a);
    }
  });

  it('演练文档不含明文凭据模式', async () => {
    const c = await doc();
    expect(c).not.toMatch(
      /(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xoxb-|AKIA[0-9A-Z]{16}|-----BEGIN[ A-Z]*PRIVATE KEY)/
    );
  });
});
