import { describe, it, expect, vi } from 'vitest';
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../work-routing-store.js', () => ({ createRoutedTask: vi.fn() }));
vi.mock('../task-updater.js', () => ({ broadcastTaskState: vi.fn() }));
describe('n8n 执行能力完全移除', () => {
  it('actions 不再导出 webhook 执行器', async () => {
    const actions = await import('../actions.js');
    expect(actions).not.toHaveProperty('triggerN8n');
  });
});
