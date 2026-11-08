import { beforeEach, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ exec: vi.fn(), exists: vi.fn(), readDir: vi.fn(), remove: vi.fn(), forbidden: vi.fn(() => { throw Error('unexpected owned boundary'); }) }));
vi.mock('child_process', () => ({ execSync: io.exec }));
vi.mock('node:child_process', () => ({ execSync: io.exec }));
vi.mock('fs', () => ({ existsSync: io.exists, readdirSync: io.readDir, rmSync: io.remove, readFileSync: io.forbidden, unlinkSync: io.forbidden, statSync: io.forbidden }));
vi.mock('node:fs', () => ({ existsSync: io.exists, readdirSync: io.readDir, rmSync: io.remove, readFileSync: io.forbidden, unlinkSync: io.forbidden, statSync: io.forbidden }));
vi.mock('../utils/cleanup-lock.js', () => ({ withLock: async (_opts, fn) => fn() }));
import { cleanupStaleWorktrees, getActiveContainerMountPaths } from '../startup-recovery.js';

const repoRoot = '/owned/virtual/startup/repo';
const worktreeBase = '/owned/virtual/startup/worktrees';
const worktree = worktreeBase + '/held';
const psCommand = "docker ps --format '{{.ID}}'";
const inspectCommand = id => `docker inspect --format '{{json .Mounts}}' ${id}`;
beforeEach(() => {
  vi.resetAllMocks();
  io.forbidden.mockImplementation(() => { throw Error('unexpected owned boundary'); });
  io.exists.mockImplementation(path => path === worktreeBase);
  io.readDir.mockImplementation(path => {
    if (path === worktreeBase) return [{ name: 'held', isDirectory: () => true }];
    if (path === worktree) return [];
    throw Error('unexpected directory read');
  });
});
function configure(inspectResult, ids = 'c1\n', fail = false) {
  io.exec.mockImplementation((command, opts) => {
    if (command === 'git worktree prune') { expect(opts.cwd).toBe(repoRoot); return ''; }
    if (command === 'git worktree list --porcelain') { expect(opts.cwd).toBe(repoRoot); return `worktree ${repoRoot}\n`; }
    if (command === psCommand) return ids;
    if (command === inspectCommand('c1')) {
      if (fail) throw Error('owned inspect unavailable');
      return inspectResult;
    }
    if (command === inspectCommand('c2')) throw Error('owned second inspect unavailable');
    throw Error('unexpected process command');
  });
}
async function cleanup() {
  const stats = await cleanupStaleWorktrees({ repoRoot, worktreeBase });
  expect(io.forbidden).not.toHaveBeenCalled();
  return stats;
}

it.each([
  ['inspect非零', 'unused', true],
  ['坏JSON', '{broken', false],
  ['空输出', '', false],
  ['非数组对象', '{}', false],
  ['JSON null', 'null', false],
])('%s不可当成空mount；真实cleanup保守保留目录', async (_label, value, fail) => {
  configure(value, 'c1\n', fail);
  expect(() => getActiveContainerMountPaths()).toThrow();
  const stats = await cleanup();
  expect(stats).toMatchObject({ removed: 0, skipped_docker_probe: 1 });
  expect(io.remove).not.toHaveBeenCalled();
});
it('多个容器只有一个inspect失败也不得以部分mount结果删除目录', async () => {
  configure('[{"Source":"/owned/other"}]', 'c1\nc2\n');
  const stats = await cleanup();
  expect(stats).toMatchObject({ removed: 0, skipped_docker_probe: 1 });
  expect(io.remove).not.toHaveBeenCalled();
  expect(io.exec).toHaveBeenCalledWith(inspectCommand('c2'), expect.any(Object));
});
it.each([
  ['ps成功零容器', '', ''],
  ['inspect成功零mount', 'c1\n', '[]'],
  ['inspect成功无关mount', 'c1\n', '[{"Source":"/owned/other"}]'],
])('%s仍按既有orphan合同委托删除', async (_label, ids, mounts) => {
  configure(mounts, ids);
  const stats = await cleanup();
  expect(stats).toMatchObject({ removed: 1, skipped_docker_probe: 0 });
  expect(io.remove).toHaveBeenCalledOnce();
  expect(io.remove).toHaveBeenCalledWith(worktree, { recursive: true, force: true });
  if (!ids) expect(io.exec.mock.calls.some(([cmd]) => cmd.startsWith('docker inspect'))).toBe(false);
});
it('成功识别当前mount仍跳过目录', async () => {
  configure(JSON.stringify([{ Source: worktree + '/subpath' }]));
  const stats = await cleanup();
  expect(stats).toMatchObject({ removed: 0, skipped_active_container: 1, skipped_docker_probe: 0 });
  expect(io.remove).not.toHaveBeenCalled();
});
