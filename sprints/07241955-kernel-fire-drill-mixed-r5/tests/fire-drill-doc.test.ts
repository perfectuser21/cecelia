import { describe, it, expect } from 'vitest';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

// TDD Red：目标文档由 generator 在合规分支创建；本文件在其存在前 4/4 失败（ENOENT）
const DOC = path.resolve(__dirname, '../../../docs/fire-drills/kernel-v1-mixed-20260724-r5.md');

async function readDoc(): Promise<string> {
  return await fsp.readFile(DOC, 'utf8');
}

describe('kernel-v1 mixed provider fire drill R5 证据文档 [BEHAVIOR]', () => {
  it('目标文档存在且含标记 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R5', async () => {
    const content = await readDoc();
    expect(content).toContain('KERNEL_V1_MIXED_FIRE_DRILL_PASS_R5');
  });

  it('目标文档含生产版本 1.267.67', async () => {
    const content = await readDoc();
    expect(content).toContain('1.267.67');
  });

  it('目标文档含 merge commit 19887912bbb581597f12c714a9ed187f051e2850', async () => {
    const content = await readDoc();
    expect(content).toContain('19887912bbb581597f12c714a9ed187f051e2850');
  });

  it('目标文档含五角色 provider/account 证据摘要', async () => {
    const content = await readDoc();
    // 与 Brain task payload.role_assignments 一致（PRD 拍板分配，B8 另做 API 实时交叉核对）
    expect(content).toMatch(/planner.*claude.*account1/);
    expect(content).toMatch(/proposer.*claude.*account1/);
    expect(content).toMatch(/reviewer.*grok.*grok/);
    expect(content).toMatch(/generator.*codex.*team3/);
    expect(content).toMatch(/evaluator.*grok.*grok/);
  });
});
