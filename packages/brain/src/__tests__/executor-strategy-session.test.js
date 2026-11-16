/** 验证真实executor的战略会议/开发/架构Skill映射。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../llm-caller.js', () => ({ callLLM: () => { throw Error('external LLM forbidden'); } }));

// ─── Mock 依赖 ─────────────────────────────────────────────────────────────────

vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(() => '')
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn(),
  mkdir: vi.fn()
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  const { preserveFleetConfigFs } = await import('./helpers/fleet-config-fs-fixture.js');
  return preserveFleetConfigFs(actual, {
  readFileSync: vi.fn(() => 'SwapTotal: 0\nSwapFree: 0')
});
});

vi.mock('../task-router.js', () => ({
  getInternalTaskHandler: vi.fn(() => null),
  getTaskLocation: vi.fn(() => 'us')
}));

vi.mock('../task-updater.js', () => ({
  updateTaskStatus: vi.fn(),
  updateTaskProgress: vi.fn()
}));

vi.mock('../trace.js', () => ({
  traceStep: vi.fn(),
  LAYER: { L0_ORCHESTRATOR: 'l0' },
  STATUS: { SUCCESS: 'success', FAILED: 'failed' },
  EXECUTOR_HOSTS: { US_VPS: 'us' }
}));

// ─── D1: skillMap 路由 ─────────────────────────────────────────────────────────

describe('executor getSkillForTaskType — strategy_session 映射 (D1)', () => {
  let getSkillForTaskType;

  beforeEach(async () => {
    vi.resetModules();
    vi.mock('../task-router.js', () => ({
      getTaskLocation: vi.fn(() => 'us')
    }));
    vi.mock('../task-updater.js', () => ({
      updateTaskStatus: vi.fn(),
      updateTaskProgress: vi.fn()
    }));
    vi.mock('../trace.js', () => ({
      traceStep: vi.fn(),
      LAYER: { L0_ORCHESTRATOR: 'l0' },
      STATUS: { SUCCESS: 'success', FAILED: 'failed' },
      EXECUTOR_HOSTS: { US_VPS: 'us' }
    }));
    vi.mock('child_process', () => ({
      spawn: vi.fn(),
      execSync: vi.fn(() => '')
    }));
    vi.mock('fs/promises', () => ({
      writeFile: vi.fn(),
      mkdir: vi.fn()
    }));
    vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  const { preserveFleetConfigFs } = await import('./helpers/fleet-config-fs-fixture.js');
  return preserveFleetConfigFs(actual, {
      readFileSync: vi.fn(() => 'SwapTotal: 0\nSwapFree: 0')
    });
});
    vi.mock('../db.js', () => ({
      default: { query: vi.fn() }
    }));
    const executor = await import('../executor.js');
    getSkillForTaskType = executor.getSkillForTaskType;
  });

  it('D1: strategy_session → /strategy-session', () => {
    expect(getSkillForTaskType('strategy_session')).toBe('/strategy-session');
  });

  it('D1-回归: dev 仍然 → /dev', () => {
    expect(getSkillForTaskType('dev')).toBe('/dev');
  });

  it('D1-回归: architecture_design → /architect', () => {
    expect(getSkillForTaskType('architecture_design')).toBe('/architect');
  });
});
