/**
 * okr-api-paths.test.ts
 * 验证 OKRPage/OKRDashboard/RoadmapPage 使用正确的 Brain API 路径
 * + area_kr 类型标准化逻辑
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../../../../..');

describe('OKRPage: 使用 /api/brain/goals 而非旧路径', () => {
  it('fetch 路径为 /api/brain/goals', () => {
    const content = readFileSync(
      resolve(ROOT, 'apps/api/features/planning/pages/OKRPage.tsx'),
      'utf8'
    );
    expect(content).toContain('/api/brain/goals');
    expect(content).not.toContain("fetch('/api/goals");
  });

  it('fetch 路径为 /api/brain/projects 而非 /api/tasks/projects', () => {
    const content = readFileSync(
      resolve(ROOT, 'apps/api/features/planning/pages/OKRPage.tsx'),
      'utf8'
    );
    expect(content).toContain('/api/brain/projects');
    expect(content).not.toContain("fetch('/api/tasks/projects");
  });

  it('包含 area_kr → kr 类型标准化', () => {
    const content = readFileSync(
      resolve(ROOT, 'apps/api/features/planning/pages/OKRPage.tsx'),
      'utf8'
    );
    expect(content).toContain("area_kr' ? 'kr'");
  });
});

describe('OKRDashboard: 使用 /api/brain/goals + 类型标准化', () => {
  it('fetch 路径为 /api/brain/goals', () => {
    const content = readFileSync(
      resolve(ROOT, 'apps/api/features/planning/pages/OKRDashboard.tsx'),
      'utf8'
    );
    expect(content).toContain('/api/brain/goals');
    expect(content).not.toContain("fetch('/api/tasks/goals");
  });

  it('包含 area_kr → kr 类型标准化', () => {
    const content = readFileSync(
      resolve(ROOT, 'apps/api/features/planning/pages/OKRDashboard.tsx'),
      'utf8'
    );
    expect(content).toContain("area_kr' ? 'kr'");
  });
});

describe('RoadmapPage: 包含 area_kr 类型标准化', () => {
  it('包含 normalizeGoalType 或 area_kr 映射', () => {
    const content = readFileSync(
      resolve(ROOT, 'apps/dashboard/src/pages/roadmap/RoadmapPage.tsx'),
      'utf8'
    );
    expect(content).toContain('area_kr');
  });
});
