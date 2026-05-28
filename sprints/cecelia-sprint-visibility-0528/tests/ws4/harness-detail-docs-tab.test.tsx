import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const PAGE_PATH = resolve(
  process.cwd(),
  'apps/dashboard/src/pages/harness/HarnessDetailPage.tsx'
);

describe('Workstream 4 — HarnessDetailPage 文档 tab [BEHAVIOR]', () => {
  it('HarnessDetailPage.tsx 含 docs-tab data-testid（tab 触发器）', () => {
    const content = readFileSync(PAGE_PATH, 'utf8');
    // WS4 未实现时文件无此字符串 → FAIL（真红）
    expect(content).toContain('docs-tab');
  });

  it('HarnessDetailPage.tsx 含 docs-tab-content data-testid（渲染容器）', () => {
    const content = readFileSync(PAGE_PATH, 'utf8');
    expect(content).toContain('docs-tab-content');
  });

  it('HarnessDetailPage.tsx 含 sprint-docs API 调用路径', () => {
    const content = readFileSync(PAGE_PATH, 'utf8');
    expect(content).toContain('sprint-docs');
  });

  it('HarnessDetailPage.tsx 含 markdown 渲染库（react-markdown 或 dangerouslySetInnerHTML）', () => {
    const content = readFileSync(PAGE_PATH, 'utf8');
    const hasMarkdown =
      content.includes('react-markdown') || content.includes('dangerouslySetInnerHTML');
    expect(hasMarkdown).toBe(true);
  });

  it('HarnessDetailPage.tsx 含 tab 切换 state 管理', () => {
    const content = readFileSync(PAGE_PATH, 'utf8');
    const hasTabState =
      /useState.*tab|activeTab|selectedTab|tabState|currentTab/i.test(content);
    expect(hasTabState).toBe(true);
  });
});
