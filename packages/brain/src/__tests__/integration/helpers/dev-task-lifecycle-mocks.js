import { vi } from 'vitest';

const MOCK_PR_URL = 'https://github.com/mock/cecelia/pull/42';

vi.mock('../../../thalamus.js', () => ({
  processEvent: vi.fn().mockResolvedValue({ level: 'normal', actions: [] }),
  EVENT_TYPES: { TASK_COMPLETED: 'task_completed', TASK_FAILED: 'task_failed' },
}));

vi.mock('../../../decision-executor.js', () => ({
  executeDecision: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../embedding-service.js', () => ({
  generateTaskEmbeddingAsync: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../events/taskEvents.js', () => ({
  publishTaskCompleted: vi.fn(),
  publishTaskFailed: vi.fn(),
}));

vi.mock('../../../event-bus.js', () => ({
  ensureEventsTable: vi.fn(),
  emit: vi.fn().mockResolvedValue(null),
  queryEvents: vi.fn().mockResolvedValue([]),
  getEventCounts: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../notifier.js', () => ({
  notifyTaskCompleted: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../alerting.js', () => ({
  raise: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../desire-feedback.js', () => ({
  updateDesireFromTask: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../routes/shared.js', () => ({
  resolveRelatedFailureMemories: vi.fn().mockResolvedValue(null),
  getActiveExecutionPaths: vi.fn(),
  INVENTORY_CONFIG: {},
}));

vi.mock('../../../progress-ledger.js', () => ({
  recordProgressStep: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../code-review-trigger.js', () => ({
  checkAndCreateCodeReviewTrigger: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../domain-detector.js', () => ({
  detectDomain: vi.fn(() => ({ domain: 'agent_ops' })),
}));

vi.mock('../../../task-updater.js', () => ({
  blockTask: vi.fn(),
  broadcastTaskState: vi.fn(),
}));

vi.mock('../../../quarantine.js', () => ({
  handleTaskFailure: vi.fn().mockResolvedValue({ quarantined: false }),
  classifyFailure: vi.fn().mockReturnValue({ class: 'unknown', confidence: 0.5 }),
  FAILURE_CLASS: {
    NETWORK: 'network',
    RATE_LIMIT: 'rate_limit',
    BILLING_CAP: 'billing_cap',
    AUTH: 'auth',
    RESOURCE: 'resource',
  },
}));

vi.mock('../../../circuit-breaker.js', () => ({
  recordSuccess: vi.fn().mockResolvedValue(null),
  recordFailure: vi.fn().mockResolvedValue(null),
  getState: vi.fn(() => ({ state: 'CLOSED', failures: 0 })),
  reset: vi.fn(),
  getAllStates: vi.fn(() => ({})),
}));

vi.mock('../../../executor.js', () => ({
  removeActiveProcess: vi.fn(),
  setBillingPause: vi.fn(),
  triggerCeceliaRun: vi.fn(),
}));

vi.mock('../../../spawn/middleware/docker-run.js', () => ({
  runDocker: vi.fn().mockImplementation(async (_args, ctx) => ({
    exit_code: 0,
    stdout: `{"type":"result","result":"pr_url: ${MOCK_PR_URL}\\nTask completed successfully"}`,
    stderr: '',
    duration_ms: 50,
    container: ctx.name,
    container_id: null,
    command: `docker run ... ${ctx.name}`,
    timed_out: false,
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
  })),
}));

vi.mock('../../../spawn/middleware/account-rotation.js', () => ({
  resolveAccount: vi.fn().mockResolvedValue(undefined),
  resolveAccountForOpts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../spawn/middleware/cascade.js', () => ({
  resolveCascade: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../spawn/middleware/cost-cap.js', () => ({
  checkCostCap: vi.fn().mockResolvedValue(undefined),
  CostCapExceededError: class CostCapExceededError extends Error {},
}));

vi.mock('../../../spawn/middleware/billing.js', () => ({
  recordBilling: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../spawn/middleware/cap-marking.js', () => ({
  checkCap: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../spawn/middleware/logging.js', () => ({
  createSpawnLogger: vi.fn().mockReturnValue({ logStart: vi.fn(), logEnd: vi.fn() }),
}));

vi.mock('../../../spawn/middleware/resource-tier.js', () => ({
  resolveResourceTier: vi.fn().mockReturnValue({
    tier: 'standard',
    memoryMB: 4096,
    cpuCores: 2,
    timeoutMs: 300000,
  }),
  RESOURCE_TIERS: {},
  TASK_TYPE_TIER: {},
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  execSync: vi.fn(),
  spawn: vi.fn(),
}));
