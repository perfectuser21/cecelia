import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// BRAIN_ROOT relative to this test file: ../../../../packages/brain
const BRAIN_ROOT = resolve(__dirname, '../../../../packages/brain');

// Mock all heavy brain dependencies using relative paths (vi.mock is hoisted — paths must be static literals)
vi.mock('../../../../packages/brain/src/db.js', () => ({ default: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../../../../packages/brain/src/learning-retriever.js', () => ({ buildLearningContext: vi.fn(async () => '') }));
vi.mock('../../../../packages/brain/src/decisions-context.js', () => ({ getDecisionsSummary: vi.fn(async () => '') }));
vi.mock('../../../../packages/brain/src/dopamine.js', () => ({ recordExpectedReward: vi.fn(async () => {}) }));
vi.mock('../../../../packages/brain/src/model-profile.js', () => ({
  getActiveProfile: vi.fn(async () => null),
  FALLBACK_PROFILE: {
    id: 'profile-anthropic',
    name: 'Anthropic fallback',
    config: {
      thalamus: { provider: 'anthropic-api', model: 'claude-haiku-4-5-20251001', fallbacks: [] },
      cortex: { provider: 'anthropic-api', model: 'claude-sonnet-4-6' },
      reflection: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      mouth: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      narrative: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      memory: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
      fact_extractor: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
      rumination: { provider: 'anthropic-api', model: 'claude-haiku-4-5-20251001', fallbacks: [] },
      executor: {
        default_provider: 'anthropic',
        model_map: {
          dev: { anthropic: 'claude-sonnet-4-6', minimax: null },
          generic: { anthropic: 'claude-sonnet-4-6', minimax: null },
        },
        fixed_provider: null,
      },
    },
  },
}));
vi.mock('../../../../packages/brain/src/task-router.js', () => ({ getTaskLocation: vi.fn(async () => 'local') }));
vi.mock('../../../../packages/brain/src/task-type-config-cache.js', () => ({
  loadCache: vi.fn(async () => {}),
  getCachedLocation: vi.fn(() => null),
  getCachedConfig: vi.fn(() => null),
  refreshCache: vi.fn(async () => {}),
}));
vi.mock('../../../../packages/brain/src/task-updater.js', () => ({
  updateTaskStatus: vi.fn(async () => {}),
  updateTaskProgress: vi.fn(async () => {}),
}));
vi.mock('../../../../packages/brain/src/trace.js', () => ({
  traceStep: vi.fn(async () => {}),
  LAYER: {},
  STATUS: {},
  EXECUTOR_HOSTS: {},
}));
vi.mock('../../../../packages/brain/src/account-usage.js', () => ({ getAccountUsage: vi.fn(async () => ({})) }));
vi.mock('../../../../packages/brain/src/docker-executor.js', () => ({
  writeDockerCallback: vi.fn(async () => {}),
  resolveResourceTier: vi.fn(() => ({ tier: 'default' })),
  isDockerAvailable: vi.fn(async () => false),
}));
vi.mock('../../../../packages/brain/src/events/initiativeRunEvents.js', () => ({ writeInitiativeRunEvent: vi.fn(async () => {}) }));
vi.mock('../../../../packages/brain/src/spawn/index.js', () => ({ spawn: vi.fn(async () => {}) }));
vi.mock('../../../../packages/brain/src/platform-utils.js', () => ({
  sampleCpuUsage: vi.fn(async () => 0),
  _resetCpuSampler: vi.fn(),
  getSwapUsedPct: vi.fn(() => 0),
  getDmesgInfo: vi.fn(async () => ({})),
  countClaudeProcesses: vi.fn(async () => 0),
  calculatePhysicalCapacity: vi.fn(() => ({})),
  evaluateMemoryHealth: vi.fn(() => ({ healthy: true })),
  getBrainRssMB: vi.fn(() => 0),
  IS_DARWIN: false,
}));
vi.mock('uuid', () => ({ v4: vi.fn(() => 'test-uuid-1234') }));

const { buildGoalSettings } = await import('../../../../packages/brain/src/executor.js');

describe('goal injection chain', () => {
  it('executor.js exports buildGoalSettings returning correct Stop hook JSON', () => {
    const result = buildGoalSettings('the PR has been merged');
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.hooks.Stop[0].hooks[0].type).toBe('prompt');
    expect(parsed.hooks.Stop[0].hooks[0].model).toBe('claude-haiku-4-5-20251001');
    expect(parsed.hooks.Stop[0].hooks[0].prompt).toContain('the PR has been merged');
  });

  it('buildGoalSettings returns null for null/empty condition', () => {
    expect(buildGoalSettings(null)).toBeNull();
    expect(buildGoalSettings('')).toBeNull();
  });

  it('cecelia-bridge.js special-cases CECELIA_GOAL_SETTINGS (no SKILLENV_ prefix, JSON preserved)', () => {
    const source = readFileSync(resolve(BRAIN_ROOT, 'scripts/cecelia-bridge.js'), 'utf8');
    expect(source).toContain('CECELIA_GOAL_SETTINGS');
    expect(source).not.toMatch(/CECELIA_SKILLENV_CECELIA_GOAL_SETTINGS/);
    expect(source).toMatch(/CECELIA_GOAL_SETTINGS='/);
  });

  it('cecelia-run.sh writes CECELIA_GOAL_SETTINGS to temp file and appends --settings flag', () => {
    const source = readFileSync(resolve(BRAIN_ROOT, 'scripts/cecelia-run.sh'), 'utf8');
    expect(source).toContain('CECELIA_GOAL_SETTINGS');
    expect(source).toContain('SETTINGS_FLAG');
    expect(source).toContain('--settings');
  });
});
