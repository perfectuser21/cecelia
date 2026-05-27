/**
 * WS2 TDD Red Phase — harness-report SKILL.md 新增文档归档步骤
 * 实现前全部 FAIL；Generator 完成实现后变 Green
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '../../../../');
const SKILL_FILE = join(REPO_ROOT, 'packages/workflows/skills/harness-report/SKILL.md');

describe('WS2 — harness-report SKILL.md 文档归档步骤 [ARTIFACT]', () => {
  it('SKILL.md 文件存在', () => {
    expect(existsSync(SKILL_FILE), `文件不存在: ${SKILL_FILE}`).toBe(true);
  });

  it('SKILL.md 含唯一锚点"文档归档（PrepPRD/PRD/Contract）"', () => {
    const content = readFileSync(SKILL_FILE, 'utf-8');
    expect(content).toContain('文档归档（PrepPRD/PRD/Contract）');
  });

  it('SKILL.md 含 prep-prd.md 引用', () => {
    const content = readFileSync(SKILL_FILE, 'utf-8');
    expect(content).toContain('prep-prd.md');
  });

  it('SKILL.md 含 sprint-prd.md 引用', () => {
    const content = readFileSync(SKILL_FILE, 'utf-8');
    expect(content).toContain('sprint-prd.md');
  });

  it('SKILL.md 含 contract-draft.md 引用', () => {
    const content = readFileSync(SKILL_FILE, 'utf-8');
    expect(content).toContain('contract-draft.md');
  });

  it('SKILL.md 含 api/brain/notes 调用', () => {
    const content = readFileSync(SKILL_FILE, 'utf-8');
    expect(content).toContain('api/brain/notes');
  });
});

describe('WS2 — 文档归档步骤结构正确 [BEHAVIOR]', () => {
  it('锚点后的上下文同时含 sprint-prd.md 和 contract-draft.md', () => {
    const content = readFileSync(SKILL_FILE, 'utf-8');
    const anchorIdx = content.indexOf('文档归档（PrepPRD/PRD/Contract）');
    expect(anchorIdx, '锚点不存在').toBeGreaterThanOrEqual(0);
    const afterAnchor = content.slice(anchorIdx);
    expect(afterAnchor).toContain('sprint-prd.md');
    expect(afterAnchor).toContain('contract-draft.md');
  });

  it('文档归档步骤含 PrepPRD 文档类型标注', () => {
    const content = readFileSync(SKILL_FILE, 'utf-8');
    const anchorIdx = content.indexOf('文档归档（PrepPRD/PRD/Contract）');
    expect(anchorIdx, '锚点不存在').toBeGreaterThanOrEqual(0);
    const afterAnchor = content.slice(anchorIdx, anchorIdx + 3000);
    expect(afterAnchor).toMatch(/PrepPRD|prep-prd/);
  });

  it('文档归档步骤含三种文档类型（PrepPRD / PRD / Contract）api/brain/notes 调用', () => {
    const content = readFileSync(SKILL_FILE, 'utf-8');
    const anchorIdx = content.indexOf('文档归档（PrepPRD/PRD/Contract）');
    expect(anchorIdx, '锚点不存在').toBeGreaterThanOrEqual(0);
    const afterAnchor = content.slice(anchorIdx, anchorIdx + 4000);
    // 必须含 api/brain/notes 调用
    expect(afterAnchor).toContain('api/brain/notes');
    // 必须涵盖三种文档
    expect(afterAnchor).toContain('prep-prd.md');
    expect(afterAnchor).toContain('sprint-prd.md');
    expect(afterAnchor).toContain('contract-draft.md');
  });

  it('文件不存在时跳过（step 内含"跳过"或"不存在"或"非阻断"描述）', () => {
    const content = readFileSync(SKILL_FILE, 'utf-8');
    const anchorIdx = content.indexOf('文档归档（PrepPRD/PRD/Contract）');
    expect(anchorIdx, '锚点不存在').toBeGreaterThanOrEqual(0);
    const afterAnchor = content.slice(anchorIdx, anchorIdx + 4000);
    const hasSkipLogic = afterAnchor.includes('跳过') ||
      afterAnchor.includes('不存在') ||
      afterAnchor.includes('非阻断') ||
      afterAnchor.includes('skip') ||
      afterAnchor.includes('exist') ||
      afterAnchor.includes('-f ');
    expect(hasSkipLogic, '缺少文件不存在时跳过的逻辑').toBe(true);
  });
});
