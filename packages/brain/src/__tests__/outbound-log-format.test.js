import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
import { recordProgressStep } from '../progress-ledger.js';
import { handleRealtimeTool } from '../orchestrator-realtime.js';
afterEach(() => vi.restoreAllMocks());
it('progress ledger treats percent sequences in task identity and error as data', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: 7 }] });
  expect(await recordProgressStep('task-%s-%j', 'run-%o', { sequence: 1, name: 'name' }, { query })).toBe(7);
  expect(log.mock.calls[0][0]).toBe('[DEBUG]');
  expect(log.mock.calls[0][1]).toContain('task-%s-%j');
  query.mockRejectedValueOnce(Error('error-%s-%j'));
  await expect(recordProgressStep('task', 'run', { sequence: 2, name: 'name' }, { query })).rejects.toThrow('error-%s-%j');
  expect(err.mock.calls[0][0]).toBe('[ERROR]');
  expect(err.mock.calls[0][1]).toContain('error-%s-%j');
});
it('Realtime tool failure keeps the log format literal and returns original business error', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const error = Error('database-%s-%j');
  const result = await handleRealtimeTool('query_tasks', {}, { query: vi.fn().mockRejectedValueOnce(error) });
  expect(result).toEqual({ success: false, error: error.message });
  expect(log).toHaveBeenCalledWith('[orchestrator-realtime] Tool failed:', 'query_tasks', error.message);
});
it('unknown percent-containing Realtime name never reaches DB or failure logging', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const query = vi.fn();
  const result = await handleRealtimeTool('%s-%j', {}, { query });
  expect(result).toEqual({ success: false, error: 'Unknown tool: %s-%j' });
  expect(query).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled();
});
