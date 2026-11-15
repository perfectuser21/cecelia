import { vi } from 'vitest';

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


vi.mock('../../../tick.js', () => ({ runTickSafe: vi.fn().mockResolvedValue({ actions_taken: [] }), getTickStatus: vi.fn() }));

vi.mock('../../../auto-learning.js', () => ({ processExecutionAutoLearning: vi.fn().mockResolvedValue(null) }));
