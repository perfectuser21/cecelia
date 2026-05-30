/**
 * B44 fix — harness-thread-lookup.js 的 harness-initiative case 应用 compileHarnessFullGraph
 */
import { describe, it, expect, vi } from 'vitest';

// mock
const mockCompileFullGraph = vi.fn().mockResolvedValue({ invoke: vi.fn(), getState: vi.fn() });
const mockCompileInitiativeGraph = vi.fn().mockResolvedValue({ invoke: vi.fn() });
const mockPgCheckpointer = vi.fn().mockResolvedValue({});

vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: () => mockPgCheckpointer(),
}));
vi.mock('../../workflows/harness-initiative.graph.js', () => ({
  compileHarnessFullGraph: () => mockCompileFullGraph(),
  compileHarnessInitiativeGraph: () => mockCompileInitiativeGraph(),
}));
vi.mock('../../workflows/harness-task.graph.js', () => ({
  compileHarnessTaskGraph: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../workflows/walking-skeleton-1node.graph.js', () => ({
  getCompiledWalkingSkeleton: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../workflows/harness-gan.graph.js', () => ({
  compileHarnessGanGraph: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../db.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({
      rows: [{ thread_id: 'test-thread-1', graph_name: 'harness-initiative' }],
    }),
  },
}));

import { _resetHarnessTaskCacheForTests, lookupHarnessThread } from '../harness-thread-lookup.js';

describe('B44 — harness-initiative case uses compileHarnessFullGraph [BEHAVIOR]', () => {
  it('graph_name=harness-initiative → calls compileHarnessFullGraph (NOT compileHarnessInitiativeGraph)', async () => {
    _resetHarnessTaskCacheForTests();
    mockCompileFullGraph.mockClear();
    mockCompileInitiativeGraph.mockClear();

    const result = await lookupHarnessThread('container-abc');

    expect(result).not.toBeNull();
    expect(mockCompileFullGraph).toHaveBeenCalledTimes(1);
    expect(mockCompileInitiativeGraph).not.toHaveBeenCalled();
  });
});
