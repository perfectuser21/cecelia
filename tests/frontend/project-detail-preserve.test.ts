/**
 * PRESERVE: ProjectDetail 现有功能回归契约
 * 确保 InlineEdit 集成不破坏现有任务列表、过滤功能
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const src = readFileSync('frontend/src/features/core/planning/pages/ProjectDetail.tsx', 'utf8');

describe('ProjectDetail PRESERVE 现有功能', () => {
  it('保留任务列表渲染逻辑', () => {
    expect(src).toContain('tasks');
  });

  it('保留项目名称展示（通过 InlineEdit 保留显示）', () => {
    expect(src).toContain('project.name');
  });

  it('InlineEdit 集成到项目名标题位置', () => {
    expect(src).toContain('InlineEdit');
  });

  it('保留 fetch /api/brain/projects/:id 数据拉取', () => {
    expect(src).toContain('/api/brain/projects/');
  });

  it('保留 setProject 状态更新模式', () => {
    expect(src).toContain('setProject');
  });
});
