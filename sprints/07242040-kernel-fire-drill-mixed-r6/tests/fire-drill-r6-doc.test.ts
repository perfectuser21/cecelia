import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// 目标交付物：repo 根下 docs/fire-drills/kernel-v1-mixed-20260724-r6.md（tests 目录向上三级即 repo 根）
const DOC = path.resolve(__dirname, '../../../docs/fire-drills/kernel-v1-mixed-20260724-r6.md');

describe('kernel-v1 mixed fire drill R6 交付文档 [BEHAVIOR]', () => {
  it('目标文档含 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R6 标记', async () => {
    const c = await readFile(DOC, 'utf8');
    expect(c).toContain('KERNEL_V1_MIXED_FIRE_DRILL_PASS_R6');
  });

  it('目标文档含生产版本 1.267.67 与 merge commit 19887912bbb581597f12c714a9ed187f051e2850', async () => {
    const c = await readFile(DOC, 'utf8');
    expect(c).toContain('1.267.67');
    expect(c).toContain('19887912bbb581597f12c714a9ed187f051e2850');
  });

  it('目标文档含五角色 provider/account 运行证据摘要', async () => {
    const c = (await readFile(DOC, 'utf8')).toLowerCase();
    for (const token of [
      'planner',
      'proposer',
      'reviewer',
      'generator',
      'evaluator',
      'claude',
      'grok',
      'codex',
      'team3',
      'account1',
    ]) {
      expect(c, `缺少字面 ${token}`).toContain(token);
    }
  });
});
