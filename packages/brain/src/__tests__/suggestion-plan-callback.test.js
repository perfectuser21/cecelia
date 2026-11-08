import { describe, it, expect, vi } from 'vitest';
import { suggestionPlanFailure, recordSuggestionPlanFailure } from '../lib/suggestion-plan-callback.js';

const task = { task_type: 'suggestion_plan', payload: { suggestion_id: 'sg-1' } };
const failure = { suggestion_id: 'sg-1', identified_layer: 'unknown', status: 'failed' };

describe('suggestion plan callback interpretation', () => {
  it('accepts matching whole JSON, a single JSON fence, and queued raw JSON', () => {
    const raw = JSON.stringify(failure);
    for (const result of [failure, raw, `\`\`\`json\n${raw}\n\`\`\``, { _raw: raw }]) {
      expect(suggestionPlanFailure(task, result)).toEqual({ suggestionId: 'sg-1' });
    }
  });
  it('does not infer failure from other tasks, identities, success or ambiguous text', () => {
    expect(suggestionPlanFailure({ ...task, task_type: 'research' }, failure)).toBeNull();
    expect(suggestionPlanFailure(task, { ...failure, suggestion_id: 'sg-2' })).toBeNull();
    expect(suggestionPlanFailure(task, { ...failure, status: 'success' })).toBeNull();
    expect(suggestionPlanFailure(task, 'old unstructured result')).toBeNull();
    expect(suggestionPlanFailure(task, `quoted ${JSON.stringify(failure)}`)).toBeNull();
    expect(suggestionPlanFailure(task, `${JSON.stringify(failure)}\n${JSON.stringify(failure)}`)).toBeNull();
    expect(suggestionPlanFailure(task, JSON.stringify(failure).slice(0, -1))).toBeNull();
  });
});

describe('suggestion failure state protection', () => {
  it('does not overwrite a human change and records the conflict on the task', async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rowCount: 0, rows: [] }).mockResolvedValueOnce({ rowCount: 1 }) };
    expect(await recordSuggestionPlanFailure(client, 'task-1', 'sg-1')).toBe(false);
    expect(client.query.mock.calls[0][0]).toContain("status = 'in_progress'");
    expect(JSON.parse(client.query.mock.calls[1][1][1])).toEqual({suggestion_plan_resolution:{suggestion_id:'sg-1',status:'conflict_or_missing',run_id:null}});
  });
  it('lets database failures propagate to the containing transaction', async () => {
    const client = { query: vi.fn().mockRejectedValue(new Error('db unavailable')) };
    await expect(recordSuggestionPlanFailure(client, 'task-1', 'sg-1')).rejects.toThrow('db unavailable');
  });
});
