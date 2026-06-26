import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// TDD Red：组件与挂载尚未实现 → 全部 FAIL；generator 落地后转 Green。
// 纯 fs 断言，不依赖根目录解析 DOM 库，保证从仓库根 `npx vitest run` 可跑。
const REPO = resolve(__dirname, '../..');
const COMP = resolve(REPO, 'apps/dashboard/src/components/HarnessPipelineStatus.tsx');
const APP = resolve(REPO, 'apps/dashboard/src/App.tsx');
const FIXED_TEXT = 'Cecelia Harness 工厂线已贯通';

describe('Harness 首页贯通状态标识 [BEHAVIOR]', () => {
  it('状态标识组件文件存在', () => {
    expect(existsSync(COMP)).toBe(true);
  });

  it('组件含逐字固定文字 + 稳定 testid', () => {
    const c = readFileSync(COMP, 'utf8');
    expect(c).toContain(FIXED_TEXT);
    expect(c).toContain('harness-pipeline-status');
  });

  it('App 壳层挂载该组件（首页可见）', () => {
    const app = readFileSync(APP, 'utf8');
    expect(app).toContain('HarnessPipelineStatus');
  });
});
