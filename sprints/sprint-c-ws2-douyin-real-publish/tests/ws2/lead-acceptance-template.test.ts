import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../..');
const EVIDENCE = resolve(ROOT, '.agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md');
const SCREENSHOTS_DIR = resolve(ROOT, '.agent-knowledge/content-pipeline-douyin/screenshots');
const E2E_SMOKE = resolve(ROOT, 'tests/content-pipeline-douyin-e2e.test.js');

describe('Workstream 2 — Lead 自验机制工程化 + E2E smoke 脚手架 [BEHAVIOR]', () => {
  it('lead-acceptance-sprint-2.1a.md 文件存在', () => {
    expect(existsSync(EVIDENCE)).toBe(true);
  });

  it('lead-acceptance 模板含 PRD 7 步 checklist（Step 1-7 至少 7 个标题）', () => {
    const content = readFileSync(EVIDENCE, 'utf8');
    const stepHeadings = content.match(/^#+\s*(步骤|Step)\s*[1-7]/gm) || [];
    expect(stepHeadings.length).toBeGreaterThanOrEqual(7);
  });

  it('lead-acceptance 模板含 ≥ 3 个截图引用占位（指向 ./screenshots/）', () => {
    const content = readFileSync(EVIDENCE, 'utf8');
    const imgRefs = content.match(/!\[.*?\]\(\.\/screenshots\/[^)]+\)/g) || [];
    expect(imgRefs.length).toBeGreaterThanOrEqual(3);
  });

  it('lead-acceptance 模板含 cmd stdout 占位区块（19222 探活 + batch-publish 触发）', () => {
    const content = readFileSync(EVIDENCE, 'utf8');
    expect(content).toContain('19222');
    expect(content).toContain('batch-publish-douyin');
  });

  it('lead-acceptance 模板含 Lead 签名占位行模板', () => {
    const content = readFileSync(EVIDENCE, 'utf8');
    expect(content).toMatch(/Cecelia.*(YYYY|2026-)/);
  });

  it('lead-acceptance 模板含 item_id 占位字段', () => {
    const content = readFileSync(EVIDENCE, 'utf8');
    expect(content).toMatch(/item_id|ItemId|Item ID/i);
  });

  it('screenshots/ 目录存在', () => {
    expect(existsSync(SCREENSHOTS_DIR)).toBe(true);
  });

  it('tests/content-pipeline-douyin-e2e.test.js E2E smoke 文件存在', () => {
    expect(existsSync(E2E_SMOKE)).toBe(true);
  });

  it('E2E smoke 含 ≥ 5 个 Step 显式标记', () => {
    const content = readFileSync(E2E_SMOKE, 'utf8');
    const stepMarks = content.match(/[Ss]tep[ _-]?[1-7]/g) || [];
    expect(stepMarks.length).toBeGreaterThanOrEqual(5);
  });

  it('E2E smoke 不含 mock SCP/CDP/playwright connect 关键字（PRD 真链路要求）', () => {
    const content = readFileSync(E2E_SMOKE, 'utf8');
    expect(content).not.toMatch(/jest\.mock.*child_process/);
    expect(content).not.toMatch(/jest\.mock.*ssh/);
    expect(content).not.toMatch(/jest\.mock.*playwright/);
    expect(content).not.toMatch(/mockImplementation.*scp/i);
    expect(content).not.toMatch(/playwright.*\.mock\(/);
  });
});
