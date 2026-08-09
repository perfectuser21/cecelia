import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('收编页面只调用 Brain canonical API', () => {
  it('GTD Inbox 使用 /api/brain/captures', () => {
    const source = readFileSync(join(process.cwd(), 'features/gtd/pages/GTDInbox.tsx'), 'utf8');
    const quickCapture = readFileSync(join(process.cwd(), 'features/gtd/components/QuickCapture.tsx'), 'utf8');
    expect(source).toContain('/api/brain/captures');
    expect(source).not.toMatch(/fetch\(`?\/api\/captures/);
    expect(quickCapture).toContain('/api/brain/captures');
    expect(quickCapture).not.toContain("fetch('/api/captures'");
  });

  it('GTD Tasks 使用 /api/brain/tasks/tasks 和 projects', () => {
    const source = readFileSync(join(process.cwd(), 'features/gtd/pages/GTDTasks.tsx'), 'utf8');
    expect(source).toContain('/api/brain/tasks/tasks');
    expect(source).toContain('/api/brain/tasks/projects');
    expect(source).not.toContain('/api/tasks/');
  });
});
