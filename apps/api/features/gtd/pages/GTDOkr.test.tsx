/**
 * GTDOkr — 基础渲染测试
 * 验证 OKR 全树视图的 TYPE_CONFIG 和核心字段定义
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Target: () => null,
  ChevronRight: () => null,
  ChevronDown: () => null,
  Loader2: () => null,
  Calendar: () => null,
  User: () => null,
  FileText: () => null,
}));

// 直接测试文件内容（TYPE_CONFIG 等配置）
describe('GTDOkr — TYPE_CONFIG 完整性', () => {
  it('应包含 vision 类型', async () => {
    const src = await import('fs').then(fs =>
      fs.readFileSync('apps/api/features/gtd/pages/GTDOkr.tsx', 'utf8')
    );
    expect(src).toContain("vision:");
  });

  it('应包含全部 7 种节点类型', async () => {
    const src = await import('fs').then(fs =>
      fs.readFileSync('apps/api/features/gtd/pages/GTDOkr.tsx', 'utf8')
    );
    for (const type of ['area', 'vision', 'objective', 'kr', 'project', 'scope', 'initiative']) {
      expect(src).toContain(`${type}:`);
    }
  });

  it('TreeNode interface 应包含 start_date 字段', async () => {
    const src = await import('fs').then(fs =>
      fs.readFileSync('apps/api/features/gtd/pages/GTDOkr.tsx', 'utf8')
    );
    expect(src).toContain('start_date');
  });

  it('TreeNode interface 应包含 end_date 字段', async () => {
    const src = await import('fs').then(fs =>
      fs.readFileSync('apps/api/features/gtd/pages/GTDOkr.tsx', 'utf8')
    );
    expect(src).toContain('end_date');
  });

  it('TreeNode interface 应包含 owner_role 字段', async () => {
    const src = await import('fs').then(fs =>
      fs.readFileSync('apps/api/features/gtd/pages/GTDOkr.tsx', 'utf8')
    );
    expect(src).toContain('owner_role');
  });

  it('TreeNode interface 应包含 description 字段', async () => {
    const src = await import('fs').then(fs =>
      fs.readFileSync('apps/api/features/gtd/pages/GTDOkr.tsx', 'utf8')
    );
    expect(src).toContain('description');
  });
});

describe('full-tree.js — 查询字段完整性', () => {
  it('应查询 start_date 字段', async () => {
    const src = await import('fs').then(fs =>
      fs.readFileSync('apps/api/src/task-system/full-tree.js', 'utf8')
    );
    expect(src).toContain('start_date');
  });

  it('应包含 visions 表查询', async () => {
    const src = await import('fs').then(fs =>
      fs.readFileSync('apps/api/src/task-system/full-tree.js', 'utf8')
    );
    expect(src).toContain('FROM visions');
  });

  it('应通过 vision_id 关联 objectives', async () => {
    const src = await import('fs').then(fs =>
      fs.readFileSync('apps/api/src/task-system/full-tree.js', 'utf8')
    );
    expect(src).toContain('vision_id');
  });

  it('PATCH TABLE_MAP 应包含 vision', async () => {
    const src = await import('fs').then(fs =>
      fs.readFileSync('apps/api/src/task-system/full-tree.js', 'utf8')
    );
    expect(src).toContain("vision: 'visions'");
  });
});
