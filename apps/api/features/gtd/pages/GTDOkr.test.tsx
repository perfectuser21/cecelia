/**
 * GTDOkr — OKR 视图结构验证测试
 */

import { describe, it, expect } from 'vitest';

const readFile = (path: string) =>
  import('fs').then(fs => fs.readFileSync(path, 'utf8'));

describe('full-tree.js — view=okr 支持', () => {
  it('应包含 view=okr 路由处理', async () => {
    const src = await readFile('apps/api/src/task-system/full-tree.js');
    expect(src).toContain("view === 'okr'");
  });

  it('handleOkrView 应查询 visions 表', async () => {
    const src = await readFile('apps/api/src/task-system/full-tree.js');
    expect(src).toContain('FROM visions');
  });

  it('PATCH 端点应支持 description 字段', async () => {
    const src = await readFile('apps/api/src/task-system/full-tree.js');
    expect(src).toContain('description');
  });
});

describe('GTDOkr.tsx — 视图设计验证', () => {
  it('数据源应使用 view=okr 参数', async () => {
    const src = await readFile('apps/api/features/gtd/pages/GTDOkr.tsx');
    expect(src).toContain('view=okr');
  });

  it('应有 Vision 类型配置', async () => {
    const src = await readFile('apps/api/features/gtd/pages/GTDOkr.tsx');
    expect(src).toContain('VISION');
  });

  it('应有 description 内联编辑（textarea）', async () => {
    const src = await readFile('apps/api/features/gtd/pages/GTDOkr.tsx');
    expect(src).toContain('textarea');
  });

  it('应有 KR 进度显示', async () => {
    const src = await readFile('apps/api/features/gtd/pages/GTDOkr.tsx');
    expect(src).toContain('current_value');
    expect(src).toContain('target_value');
  });
});
