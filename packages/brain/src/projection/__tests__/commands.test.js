import { describe, expect, it, vi } from 'vitest';
import { applyProjectionCommands } from '../commands.js';

describe('projection commands', () => {
  it('keeps a start request queued for the dispatcher instead of forging in_progress', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'cmd-1', command_type: 'start_requested', entity_id: 'task-1', payload: {} }] })
      .mockResolvedValueOnce({ rows: [{ id: 'task-1', status: 'queued' }] })
      .mockResolvedValue({ rows: [] });

    expect(await applyProjectionCommands({ query })).toMatchObject({ applied: 1 });
    const sql = query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain('start_requested_at');
    expect(sql).not.toMatch(/status\s*=\s*'in_progress'/);
  });
});
