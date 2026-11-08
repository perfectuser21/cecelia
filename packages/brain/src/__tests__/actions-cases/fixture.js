import { vi } from 'vitest';
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

const mockCreateRoutedTask = vi.hoisted(() => vi.fn());
vi.mock('../../work-routing-store.js', () => ({ createRoutedTask: mockCreateRoutedTask }));

// Mock broadcastTaskState
const mockBroadcast = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../task-updater.js', () => ({ broadcastTaskState: mockBroadcast }));

// Mock fetch (用于 triggerN8n)
const mockFetch = vi.fn();
const originalFetch = global.fetch;
export function restoreFetch() { global.fetch = originalFetch; }

// isolate:false 修复：不在顶层 await import，改为 beforeAll + vi.resetModules()
export let createTask, createInitiative, createProject, updateTask, createGoal, updateGoal, triggerN8n, setMemory, batchUpdateTasks;

export async function loadActions() {
  global.fetch = mockFetch;
  vi.resetModules();
  const mod = await import('../../actions.js');
  createTask = mod.createTask;
  createInitiative = mod.createInitiative;
  createProject = mod.createProject;
  updateTask = mod.updateTask;
  createGoal = mod.createGoal;
  updateGoal = mod.updateGoal;
  triggerN8n = mod.triggerN8n;
  setMemory = mod.setMemory;
  batchUpdateTasks = mod.batchUpdateTasks;
}

export function resetActions() {
  vi.clearAllMocks();
  mockQuery.mockReset();
  mockCreateRoutedTask.mockReset();
}
export function mockTaskMutation(rows, rowCount = rows.length) {
    mockQuery.mockImplementation(async sql => {
      if (/SELECT id, payload, result FROM tasks/.test(sql)) return { rows: [] };
      if (/UPDATE tasks/.test(sql)) return { rows, rowCount };
      throw new Error(`Unexpected task mutation query: ${sql}`);
    });
  }
export function taskMutationSql() {
    return mockQuery.mock.calls.find(([sql]) => /UPDATE tasks/.test(sql))[0];
  }

export { mockQuery, mockCreateRoutedTask, mockBroadcast, mockFetch };
