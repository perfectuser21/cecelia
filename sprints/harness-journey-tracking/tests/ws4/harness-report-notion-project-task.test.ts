/**
 * WS4 TDD Red Phase — harness-report SKILL.md Notion Project/Task 创建步骤
 * 实现前全部 FAIL；Generator 完成实现后变 Green
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '../../../../');
const SKILL_FILE = join(REPO_ROOT, 'packages/workflows/skills/harness-report/SKILL.md');

describe('WS4 — harness-report SKILL.md Notion Project/Task 步骤 [ARTIFACT]', () => {
  it('SKILL.md 文件存在', () => {
    expect(existsSync(SKILL_FILE), `文件不存在: ${SKILL_FILE}`).toBe(true);
  });

  it('SKILL.md 含 api/brain/notion/project 端点', () => {
    const content = readFileSync(SKILL_FILE, 'utf-8');
    expect(content).toContain('api/brain/notion/project');
  });

  it('SKILL.md 含 api/brain/notion/task 端点', () => {
    const content = readFileSync(SKILL_FILE, 'utf-8');
    expect(content).toContain('api/brain/notion/task');
  });

  it('SKILL.md 含 "Done" 状态值（大写D，PRD原文）', () => {
    const content = readFileSync(SKILL_FILE, 'utf-8');
    // notion project/task payload 中 status 必须是 "Done"（大写D）
    const notionIdx = content.indexOf('api/brain/notion/project');
    expect(notionIdx, 'api/brain/notion/project 不存在').toBeGreaterThanOrEqual(0);
    const notionSection = content.slice(notionIdx, notionIdx + 2000);
    expect(notionSection).toMatch(/"Done"/);
  });

  it('SKILL.md Notion 步骤含 WARN 降级（Brain API 离线不阻断）', () => {
    const content = readFileSync(SKILL_FILE, 'utf-8');
    const notionProjectIdx = content.indexOf('api/brain/notion/project');
    const notionTaskIdx = content.indexOf('api/brain/notion/task');
    expect(notionProjectIdx, 'api/brain/notion/project 不存在').toBeGreaterThanOrEqual(0);
    expect(notionTaskIdx, 'api/brain/notion/task 不存在').toBeGreaterThanOrEqual(0);
    const sectionStart = Math.min(notionProjectIdx, notionTaskIdx) - 500;
    const sectionEnd = Math.max(notionProjectIdx, notionTaskIdx) + 2000;
    const section = content.slice(Math.max(0, sectionStart), sectionEnd);
    expect(section).toContain('WARN');
    expect(section).toMatch(/非阻断/);
  });

  it('SKILL.md 含 WS{n} 标题格式描述', () => {
    const content = readFileSync(SKILL_FILE, 'utf-8');
    // 文档中应说明标题格式为 WS{n} — {PR_TITLE}
    expect(content).toMatch(/WS\{n\}/);
  });

  it('SKILL.md Notion Project payload 含 journey_id 字段', () => {
    const content = readFileSync(SKILL_FILE, 'utf-8');
    const notionProjectIdx = content.indexOf('api/brain/notion/project');
    expect(notionProjectIdx, 'api/brain/notion/project 不存在').toBeGreaterThanOrEqual(0);
    const afterProject = content.slice(notionProjectIdx, notionProjectIdx + 1500);
    expect(afterProject).toContain('journey_id');
  });
});

describe('WS4 — Notion Project/Task 步骤结构正确 [BEHAVIOR]', () => {
  it('Notion Project 步骤在 Step 2（更新中台 Dashboard）之后', () => {
    const content = readFileSync(SKILL_FILE, 'utf-8');
    const step2Idx = content.indexOf('更新中台 Dashboard');
    expect(step2Idx, 'Step 2 更新中台 Dashboard 不存在').toBeGreaterThanOrEqual(0);
    const notionProjectIdx = content.indexOf('api/brain/notion/project');
    expect(notionProjectIdx, 'api/brain/notion/project 不存在').toBeGreaterThanOrEqual(0);
    expect(notionProjectIdx).toBeGreaterThan(step2Idx);
  });

  it('Notion Task 步骤含 WS 遍历逻辑', () => {
    const content = readFileSync(SKILL_FILE, 'utf-8');
    const notionTaskIdx = content.indexOf('api/brain/notion/task');
    expect(notionTaskIdx, 'api/brain/notion/task 不存在').toBeGreaterThanOrEqual(0);
    const section = content.slice(Math.max(0, notionTaskIdx - 1000), notionTaskIdx + 2000);
    // 必须含循环或遍历关键字
    const hasLoop = section.includes('for ') || section.includes('while ') || section.includes('forEach');
    expect(hasLoop, 'Notion Task 步骤缺少 WS 遍历循环').toBe(true);
  });

  it('Notion Project 步骤在 Notion AI Notes（Step 3）之前', () => {
    const content = readFileSync(SKILL_FILE, 'utf-8');
    const notionProjectIdx = content.indexOf('api/brain/notion/project');
    expect(notionProjectIdx, 'api/brain/notion/project 不存在').toBeGreaterThanOrEqual(0);
    const step3Idx = content.indexOf('写 Notion AI Notes');
    expect(step3Idx, 'Step 3 写 Notion AI Notes 不存在').toBeGreaterThanOrEqual(0);
    expect(notionProjectIdx).toBeLessThan(step3Idx);
  });
});
