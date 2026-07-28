import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(() => ''),
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => 'SwapTotal: 0\nSwapFree: 0'),
}));

vi.mock('../task-router.js', () => ({
  getInternalTaskHandler: vi.fn(() => null),
  getTaskLocation: vi.fn(() => 'us'),
}));

vi.mock('../task-updater.js', () => ({
  updateTaskStatus: vi.fn(),
  updateTaskProgress: vi.fn(),
}));

vi.mock('../trace.js', () => ({
  traceStep: vi.fn(),
  LAYER: { L0_ORCHESTRATOR: 'l0' },
  STATUS: { SUCCESS: 'success', FAILED: 'failed' },
  EXECUTOR_HOSTS: { US_VPS: 'us' },
}));

describe('executor → Skill task format contract', () => {
  let buildSkillDispatchEnvelope;
  let preparePrompt;

  beforeEach(async () => {
    vi.resetModules();
    const executor = await import('../executor.js');
    buildSkillDispatchEnvelope = executor.buildSkillDispatchEnvelope;
    preparePrompt = executor.preparePrompt;
  });

  it('emits the exact mandatory id/title/description fields', () => {
    expect(buildSkillDispatchEnvelope({
      id: 'task-contract-1',
      title: 'Contract title',
      description: 'Contract description',
    })).toEqual({
      id: 'task-contract-1',
      title: 'Contract title',
      description: 'Contract description',
    });
  });

  it('normalizes an empty description to the required title fallback', () => {
    expect(buildSkillDispatchEnvelope({
      id: 'task-contract-2',
      title: 'Fallback title',
      description: '',
    }).description).toBe('Fallback title');
  });

  it.each([
    [{ title: 'Missing id', description: 'x' }, 'task_dispatch_id_required'],
    [{ id: 'task-contract-3', description: 'x' }, 'task_dispatch_title_required'],
  ])('fails closed when a mandatory identity field is absent', (task, error) => {
    expect(() => buildSkillDispatchEnvelope(task)).toThrow(error);
  });

  it('keeps title and description in the executable /dev prompt', async () => {
    const prompt = await preparePrompt({
      id: 'task-contract-4',
      task_type: 'dev',
      title: 'Visible task title',
      description: 'Visible task description',
      payload: {},
    });

    expect(prompt).toMatch(/^\/dev/);
    expect(prompt).toContain('Visible task title');
    expect(prompt).toContain('Visible task description');
  });
});
