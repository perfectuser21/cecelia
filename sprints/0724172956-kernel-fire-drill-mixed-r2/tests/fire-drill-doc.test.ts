import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';

const DOC_URL = new URL(
  '../../../docs/fire-drills/kernel-v1-mixed-20260724-r2.md',
  import.meta.url
);

async function readDoc(): Promise<string> {
  return readFile(DOC_URL, 'utf8');
}

describe('kernel v1 mixed fire drill r2 证据文档 [BEHAVIOR]', () => {
  it('含 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R2 标记', async () => {
    const c = await readDoc();
    expect(c).toContain('KERNEL_V1_MIXED_FIRE_DRILL_PASS_R2');
  });

  it('含生产版本 1.267.67 与 merge commit 字面值', async () => {
    const c = await readDoc();
    expect(c).toContain('1.267.67');
    expect(c).toContain('19887912bbb581597f12c714a9ed187f051e2850');
  });

  it('六角色每个都有 provider/account 证据行', async () => {
    const c = await readDoc();
    const roles = ['planner', 'proposer', 'reviewer', 'generator', 'evaluator', 'judge'];
    for (const role of roles) {
      const re = new RegExp(`${role}.*(provider|account)|(provider|account).*${role}`, 'i');
      expect(re.test(c), `角色 ${role} 缺 provider/account 证据行`).toBe(true);
    }
  });
});
