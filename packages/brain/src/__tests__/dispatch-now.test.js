/**
 * dispatch-now 端点测试
 * POST /api/brain/dispatch-now — 不经过 tick loop 直接派发任务
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pool
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

// Mock executor
const mockTriggerCeceliaRun = vi.fn();
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: (...args) => mockTriggerCeceliaRun(...args),
  checkCeceliaRunAvailable: vi.fn().mockResolvedValue(true),
}));

// Mock other imports that execution.js needs
vi.mock('../tick.js', () => ({
  runTickSafe: vi.fn(),
  getTickStatus: vi.fn().mockResolvedValue({ enabled: false }),
}));
vi.mock('../templates.js', () => ({
  generatePrdFromTask: vi.fn(),
  generatePrdFromGoalKR: vi.fn(),
  generateTrdFromGoal: vi.fn(),
  generateTrdFromGoalKR: vi.fn(),
  validatePrd: vi.fn(),
  validateTrd: vi.fn(),
  prdToJson: vi.fn(),
  trdToJson: vi.fn(),
  PRD_TYPE_MAP: {},
}));
vi.mock('../decision.js', () => ({
  compareGoalProgress: vi.fn(),
  generateDecision: vi.fn(),
  executeDecision: vi.fn(),
  rollbackDecision: vi.fn(),
}));
vi.mock('../planner.js', () => ({
  planNextTask: vi.fn(),
  getPlanStatus: vi.fn(),
  handlePlanInput: vi.fn(),
  getGlobalState: vi.fn(),
  selectTopAreas: vi.fn(),
  selectActiveInitiativeForArea: vi.fn(),
  ACTIVE_AREA_COUNT: 3,
}));
vi.mock('../thalamus.js', () => ({
  processEvent: vi.fn(),
  EVENT_TYPES: {},
}));
vi.mock('../decision-executor.js', () => ({
  executeDecision: vi.fn(),
}));
vi.mock('../embedding-service.js', () => ({
  generateTaskEmbeddingAsync: vi.fn(),
}));
vi.mock('../events/taskEvents.js', () => ({
  publishTaskCompleted: vi.fn(),
  publishTaskFailed: vi.fn(),
}));
vi.mock('../event-bus.js', () => ({
  emit: vi.fn(),
}));
vi.mock('../circuit-breaker.js', () => ({
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
  reset: vi.fn(),
}));
vi.mock('../notifier.js', () => ({
  notifyTaskCompleted: vi.fn(),
}));
vi.mock('../platform-utils.js', () => ({
  getAvailableMemoryMB: vi.fn().mockReturnValue(8000),
}));
vi.mock('../alerting.js', () => ({
  raise: vi.fn(),
}));
vi.mock('../quarantine.js', () => ({
  handleTaskFailure: vi.fn(),
  classifyFailure: vi.fn(),
}));
vi.mock('../desire-feedback.js', () => ({
  updateDesireFromTask: vi.fn(),
}));
vi.mock('../code-review-trigger.js', () => ({
  checkAndCreateCodeReviewTrigger: vi.fn(),
}));
vi.mock('./shared.js', () => ({
  getActiveExecutionPaths: vi.fn().mockReturnValue([]),
  INVENTORY_CONFIG: {},
  resolveRelatedFailureMemories: vi.fn().mockResolvedValue([]),
}));

describe('POST /api/brain/dispatch-now', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 if task_id is missing', async () => {
    const { default: router } = await import('../routes/execution.js');

    // 找到 dispatch-now handler
    const layer = router.stack.find(l => l.route && l.route.path === '/dispatch-now');
    expect(layer).toBeDefined();
    expect(layer.route.methods.post).toBe(true);
  });

  it('should return 404 if task not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { default: router } = await import('../routes/execution.js');
    const handler = router.stack.find(l => l.route?.path === '/dispatch-now').route.stack[0].handle;

    const req = { body: { task_id: 'non-existent-id' } };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Task not found' }));
  });

  it('should dispatch task successfully', async () => {
    const mockTask = {
      id: 'test-task-id',
      title: 'Test Task',
      status: 'queued',
      task_type: 'cto_review',
    };

    // SELECT query
    mockQuery.mockResolvedValueOnce({ rows: [mockTask] });
    // UPDATE status to in_progress
    mockQuery.mockResolvedValueOnce({ rows: [] });

    mockTriggerCeceliaRun.mockResolvedValueOnce({
      success: true,
      runId: 'run-123',
      taskId: 'test-task-id',
      executor: 'local',
    });

    const { default: router } = await import('../routes/execution.js');
    const handler = router.stack.find(l => l.route?.path === '/dispatch-now').route.stack[0].handle;

    const req = { body: { task_id: 'test-task-id' } };
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      taskId: 'test-task-id',
    }));
    expect(mockTriggerCeceliaRun).toHaveBeenCalledWith(mockTask);
  });

  it('should reject already completed tasks', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'done-task', status: 'completed' }],
    });

    const { default: router } = await import('../routes/execution.js');
    const handler = router.stack.find(l => l.route?.path === '/dispatch-now').route.stack[0].handle;

    const req = { body: { task_id: 'done-task' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('should rollback status on dispatch failure', async () => {
    const mockTask = { id: 'fail-task', status: 'queued', task_type: 'dev' };

    mockQuery.mockResolvedValueOnce({ rows: [mockTask] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE to in_progress

    mockTriggerCeceliaRun.mockResolvedValueOnce({
      success: false,
      error: 'Executor unavailable',
    });

    mockQuery.mockResolvedValueOnce({ rows: [] }); // Rollback to queued

    const { default: router } = await import('../routes/execution.js');
    const handler = router.stack.find(l => l.route?.path === '/dispatch-now').route.stack[0].handle;

    const req = { body: { task_id: 'fail-task' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    // Verify rollback: third query should set status back to queued
    expect(mockQuery).toHaveBeenCalledWith(
      'UPDATE tasks SET status = $1 WHERE id = $2',
      ['queued', 'fail-task']
    );
  });
});
