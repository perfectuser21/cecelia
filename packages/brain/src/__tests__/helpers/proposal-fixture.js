import {vi} from 'vitest';
const mockQuery = vi.hoisted(() => vi.fn().mockResolvedValue({ rows: [] }));
vi.mock('../../db.js', () => ({
  default: { query: mockQuery },
}));
const mockCreateTask = vi.hoisted(() => vi.fn());
vi.mock('../../actions.js', () => ({ createTask: mockCreateTask }));
// 依赖单一写口（链 bf5088a3 棒5）：add/remove_dependency 经 lib/task-dependencies.js 写边 + payload.depends_on
const mockAddDep = vi.hoisted(() => vi.fn().mockResolvedValue({ added: true }));
const mockRemoveDep = vi.hoisted(() => vi.fn().mockResolvedValue({ removed: true }));
vi.mock('../../lib/task-dependencies.js', () => ({ addTaskDependency: mockAddDep, removeTaskDependency: mockRemoveDep }));


export function resetProposalMocks() {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    mockCreateTask.mockReset();
    mockCreateTask.mockResolvedValue({ task: { id: 'new-task-id', title: '新任务' } });
  }
export {mockQuery,mockCreateTask,mockAddDep,mockRemoveDep};
