import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';

const DOC = 'docs/fire-drills/kernel-v1-mixed-20260724-r4.md';

async function readDoc(): Promise<string> {
  return readFile(DOC, 'utf8');
}

describe('kernel v1 mixed fire drill r4 证据文档 [BEHAVIOR]', () => {
  it('目标文档存在且含标记 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R4', async () => {
    const c = await readDoc();
    expect(c).toContain('KERNEL_V1_MIXED_FIRE_DRILL_PASS_R4');
  });

  it('文档含生产版本 1.267.67 与 merge commit 19887912bbb581597f12c714a9ed187f051e2850', async () => {
    const c = await readDoc();
    expect(c).toContain('1.267.67');
    expect(c).toContain('19887912bbb581597f12c714a9ed187f051e2850');
  });

  it('文档含各角色 provider/account 证据摘要 claude account1 grok codex team3', async () => {
    const c = (await readDoc()).toLowerCase();
    for (const kw of ['planner', 'proposer', 'reviewer', 'generator', 'evaluator', 'judge', 'claude', 'account1', 'grok', 'codex', 'team3']) {
      expect(c).toContain(kw);
    }
  });

  it('文档不含旧轮次标记残渣（R1/R2/R3）', async () => {
    const c = await readDoc();
    expect(c).not.toMatch(/KERNEL_V1_MIXED_FIRE_DRILL_PASS_R[123](?:[^0-9]|$)/);
    expect(c).toContain('KERNEL_V1_MIXED_FIRE_DRILL_PASS_R4');
  });
});
