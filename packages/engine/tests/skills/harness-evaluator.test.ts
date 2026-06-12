import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';

const SKILL_PATH = join(os.homedir(), '.claude', 'skills', 'harness-evaluator', 'SKILL.md');
const skillExists = existsSync(SKILL_PATH);

describe('harness-evaluator 关键不变量（pre-merge gate 契约）', () => {
  const content = skillExists ? readFileSync(SKILL_PATH, 'utf8') : '';

  it.skipIf(!skillExists)('Step B-1.6 环境预检：含 env_missing FAIL 守卫（禁止降级）', () => {
    // B-1.6：二进制 command -v 缺失即 env_missing FAIL，禁止改写验证命令降级
    expect(content).toContain('env_missing');
    expect(content).toMatch(/env_missing.*FAIL|FAIL.*env_missing/);
  });

  it.skipIf(!skillExists)('Step B-1.6 / B-1.7 / B-1.8 三步骤均存在', () => {
    expect(content).toMatch(/B-1\.6/);
    expect(content).toMatch(/B-1\.7/);
    expect(content).toMatch(/B-1\.8/);
  });

  it.skipIf(!skillExists)('无 ws_id 残留（1.15.0 全文清除，后续 PR 不得重新引入）', () => {
    // 1.15.0 changelog 记录了清除 ws_id，但清除后的 body 不应再有 ws_id
    // 允许 frontmatter changelog 中提及（历史），不允许出现在 step 指令章节
    const fmEnd = content.indexOf('\n---\n', 3);
    const body = fmEnd >= 0 ? content.slice(fmEnd) : content;
    expect(body, '技能体内不应含 ws_id（workstream 拆分时代残留，1.15.0 已清除）').not.toContain('ws_id');
  });

  it.skipIf(!skillExists)('调用时机：明确 pre-merge gate（CI 绿后、PR merge 前）', () => {
    expect(content).toMatch(/pre-merge|merge 前|CI 绿.*merge|merge.*CI 绿/);
  });
});
