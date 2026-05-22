/**
 * buildGoalSettings unit tests (TDD)
 * Tests the pure serializer function that generates Claude Code --settings JSON
 * for goal-based stop hooks.
 */

import { describe, it, expect, vi } from 'vitest';

// Mock all heavy executor.js dependencies before importing
vi.mock('../db.js', () => ({ default: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../learning-retriever.js', () => ({ buildLearningContext: vi.fn(async () => '') }));
vi.mock('../decisions-context.js', () => ({ getDecisionsSummary: vi.fn(async () => '') }));
vi.mock('../dopamine.js', () => ({ recordExpectedReward: vi.fn(async () => {}) }));
vi.mock('../model-profile.js', () => ({
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
vi.mock('../task-router.js', () => ({ getTaskLocation: vi.fn(async () => 'local') }));
vi.mock('../task-type-config-cache.js', () => ({
  loadCache: vi.fn(async () => {}),
  getCachedLocation: vi.fn(() => null),
  getCachedConfig: vi.fn(() => null),
  refreshCache: vi.fn(async () => {}),
}));
vi.mock('../task-updater.js', () => ({
  updateTaskStatus: vi.fn(async () => {}),
  updateTaskProgress: vi.fn(async () => {}),
}));
vi.mock('../trace.js', () => ({
  traceStep: vi.fn(async () => {}),
  LAYER: {},
  STATUS: {},
  EXECUTOR_HOSTS: {},
}));
vi.mock('../account-usage.js', () => ({ getAccountUsage: vi.fn(async () => ({})) }));
vi.mock('../docker-executor.js', () => ({
  writeDockerCallback: vi.fn(async () => {}),
  resolveResourceTier: vi.fn(() => ({ tier: 'default' })),
  isDockerAvailable: vi.fn(async () => false),
}));
vi.mock('../events/initiativeRunEvents.js', () => ({ writeInitiativeRunEvent: vi.fn(async () => {}) }));
vi.mock('../spawn/index.js', () => ({ spawn: vi.fn(async () => {}) }));
vi.mock('../platform-utils.js', () => ({
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

const { buildGoalSettings } = await import('../executor.js');

describe('buildGoalSettings', () => {
  it('returns null for null condition', () => {
    expect(buildGoalSettings(null)).toBeNull();
  });

  it('returns null for empty string condition', () => {
    expect(buildGoalSettings('')).toBeNull();
  });

  it('returns JSON string with correct Stop hook structure', () => {
    const result = buildGoalSettings('PR has been merged');
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result);
    expect(parsed).toMatchObject({
      hooks: {
        Stop: [{
          hooks: [{
            type: 'prompt',
            prompt: expect.stringContaining('PR has been merged'),
            model: 'claude-haiku-4-5-20251001'
          }]
        }]
      }
    });
  });

  it('embeds goal condition verbatim in prompt field', () => {
    const condition = 'All tests pass and PR is merged to main';
    const result = buildGoalSettings(condition);
    const parsed = JSON.parse(result);
    expect(parsed.hooks.Stop[0].hooks[0].prompt).toContain(condition);
  });
});
