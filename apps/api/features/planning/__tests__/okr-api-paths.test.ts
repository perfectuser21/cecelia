/**
 * okr-api-paths.test.ts
 * 保留共享 RoadmapPage 的历史类型标准化逻辑
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../../../../..');

describe('RoadmapPage: 包含 area_kr 类型标准化', () => {
  it('包含 normalizeGoalType 或 area_kr 映射', () => {
    const content = readFileSync(
      resolve(ROOT, 'apps/dashboard/src/pages/roadmap/RoadmapPage.tsx'),
      'utf8'
    );
    expect(content).toContain('area_kr');
  });
});
