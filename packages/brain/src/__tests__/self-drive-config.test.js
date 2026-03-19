import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));
vi.mock('../actions.js', () => ({ createTask: vi.fn() }));
vi.mock('../llm-caller.js', () => ({ callLLM: vi.fn().mockResolvedValue({ text: '{"reasoning":"test","actions":[]}' }) }));

describe('self-drive config', () => {
  it('getSelfDriveStatus returns interval and max_tasks', async () => {
    const { getSelfDriveStatus } = await import('../self-drive.js');
    const status = getSelfDriveStatus();
    expect(status).toHaveProperty('interval_ms');
    expect(status).toHaveProperty('max_tasks_per_cycle');
    expect(status.interval_ms).toBe(30 * 60 * 1000); // default 30min
  });
});
