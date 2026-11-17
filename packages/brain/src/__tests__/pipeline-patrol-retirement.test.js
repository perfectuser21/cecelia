import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), createTask: vi.fn(), execSync: vi.fn() }));
vi.mock('../actions.js', () => ({ createTask: mocks.createTask }));
vi.mock('child_process', () => ({ execSync: mocks.execSync, execFileSync: vi.fn(() => 'a' .repeat(40)) }));
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false), readdirSync: vi.fn(() => ['.dev-mode.cp-stuck']),
  readFileSync: vi.fn(() => 'branch: cp-stuck\nstep_0_worktree: done\nstep_1_spec: done\nstep_2_code: pending\nlast_block_reason: CI failed'),
  statSync: vi.fn(() => ({ mtime: new Date(0) })), writeFileSync: vi.fn(),
}));
import { runPipelinePatrol } from '../pipeline-patrol.js';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.execSync.mockImplementation(cmd => cmd.includes('rev-parse') ? '/isolated' : cmd.includes('worktree list') ? 'worktree /isolated\n' : '');
  mocks.query.mockResolvedValue({ rows: [] });
  mocks.createTask.mockResolvedValue({ success: true, task: { id: 'unexpected-rescue' } });
});
describe('巡航自主开发退役', () => {
  it('扫描孤儿/超时 pipeline 保留诊断明细，不创建救援编码单', async () => {
    const result = await runPipelinePatrol({ query: mocks.query });
    expect(result.scanned).toBe(1);
    expect(result.stuck).toBe(1);
    expect(result.details[0]).toMatchObject({ branch: 'cp-stuck', isOrphan: true, blockReason: 'CI failed' });
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
    expect(result.rescued).toBe(0);
  });
});
