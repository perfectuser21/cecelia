/** 现役动态配置进入本机Codex路径；只记录待启动脚本，拒绝真实进程启动。 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({
  query: vi.fn(), write: vi.fn(), command: vi.fn(), slotFull: false,
  forbidden: vi.fn(() => { throw new Error('禁止外部副作用'); }),
  launch: vi.fn(() => { throw new Error('fixture: launch blocked'); }),
}));
vi.mock('../db.js', () => ({ default: { query: io.query } }));
// 仅允许已隔离的调用进入路由；实际进程启动仍由拒绝哨兵终止。
vi.mock('../runtime-safety.js', async original => ({ ...await original(), assertExternalExecutionAllowed: vi.fn() }));
vi.mock('../execution-directory/legacy-relay.js', () => ({ withLegacyRelayExecution: async (_identity, launch) => launch() }));
vi.mock('child_process', () => ({ spawn: io.launch, execSync: io.command, exec: io.forbidden,
  execFile: io.forbidden, execFileSync: io.forbidden }));
vi.mock('node:child_process', () => ({ spawn: io.launch, execSync: io.command, exec: io.forbidden,
  execFile: io.forbidden, execFileSync: io.forbidden }));
vi.mock('fs/promises', () => ({ writeFile: io.write, mkdir: vi.fn(async () => {}), access: io.forbidden }));
vi.mock('fs', async original => {
  const actual = await original();
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  return { ...actual, existsSync: () => false, readdirSync: () => [], unlinkSync: io.forbidden,
    readFileSync: (file, ...args) => {
      const target = file instanceof URL ? fileURLToPath(file) : String(file);
      if (target === '/owned/dynamic-worktree/.task-cp-owned-dynamic.md') return 'owned task card';
      if (!target.startsWith(root) || /credential|auth\.json|\/\.env/.test(target)) return io.forbidden();
      return actual.readFileSync(file, ...args);
    },
  };
});
let executor, loadCache;
beforeAll(async () => {
  vi.stubGlobal('fetch', io.forbidden);
  executor = await import('../executor.js');
  ({ loadCache } = await import('../task-type-config-cache.js'));
});
beforeEach(async () => {
  vi.clearAllMocks(); io.slotFull = false;
  vi.stubEnv('CECELIA_WORK_DIR', '/owned/dynamic-repo');
  vi.stubEnv('CODEX_BIN', '/owned/codex-bin');
  vi.stubEnv('CODEX_REVIEW_HOME', '/owned/credential-reference');
  vi.stubEnv('CODEX_REVIEW_MODEL', 'owned-model');
  io.write.mockResolvedValue(undefined);
  io.query.mockImplementation(async sql => {
    if (sql.startsWith('SELECT task_type, location, executor, skill FROM task_type_configs')) {
      return { rows: [{ task_type: 'knowledge', location: 'us', executor: 'codex', skill: null }] };
    }
    if (sql.includes('task_runs') || sql.includes('executor_kind')) return { rows: [], rowCount: 1 };
    return io.forbidden();
  });
  io.command.mockImplementation(command => {
    if (/^mkdir "\/tmp\/codex-review-locks\/slot-[12]"$/.test(command)) {
      if (io.slotFull) throw new Error('owned slot occupied');
      return '';
    }
    if (command === 'git -C "/owned/dynamic-repo" worktree list --porcelain 2>/dev/null') {
      return 'worktree /owned/dynamic-worktree\nbranch refs/heads/cp-owned-dynamic\n';
    }
    if (command === 'git -C "/owned/dynamic-worktree" diff origin/main..HEAD 2>/dev/null || git -C "/owned/dynamic-worktree" diff HEAD~1..HEAD 2>/dev/null || true') return '+owned change';
    return io.forbidden();
  });
  await loadCache({ query: io.query });
});
afterEach(() => { expect(io.forbidden).not.toHaveBeenCalled(); vi.unstubAllEnvs(); });
afterAll(() => vi.unstubAllGlobals());
const row = () => ({ id: 'owned-dynamic-task', task_type: 'knowledge', title: 'owned knowledge',
  description: 'owned task description', metadata: { branch: 'cp-owned-dynamic' }, payload: {} });

describe('动态配置的现役本机Codex消费者', () => {
  it('真实缓存配置路由到本机脚本生成，启动边界拒绝；不声称执行完成', async () => {
    expect(await executor.triggerCeceliaRun(row())).toMatchObject({ success: false, executor: 'local-codex', error: 'fixture: launch blocked' });
    const prompt = io.write.mock.calls.find(([file]) => file === '/tmp/codex-review-prompt-owned-dynamic-task.txt');
    expect(prompt[1]).toContain('owned task description');
    expect(prompt[1]).toContain('owned task card');
    expect(prompt[1]).toContain('+owned change');
    const script = io.write.mock.calls.find(([file]) => file === '/tmp/codex-review-runner-owned-dynamic-task.sh');
    expect(script[1]).toContain('"/owned/codex-bin" exec --model "owned-model"');
    expect(script[1]).toContain('rm -rf "/tmp/codex-review-locks/slot-1"');
    expect(io.launch).toHaveBeenCalledTimes(1);
    expect(io.launch).toHaveBeenCalledWith('bash', ['/tmp/codex-review-runner-owned-dynamic-task.sh'], { detached: true, stdio: 'ignore' });
  });
  it('两个槽位都占用时返回拒绝，零脚本、零启动尝试', async () => {
    io.slotFull = true;
    expect(await executor.triggerCeceliaRun(row())).toMatchObject({ success: false, executor: 'local-codex', error: 'review_slots_full' });
    expect(io.command.mock.calls.map(([command]) => command)).toEqual([
      'mkdir "/tmp/codex-review-locks/slot-1"', 'mkdir "/tmp/codex-review-locks/slot-2"',
    ]);
    expect(io.write).not.toHaveBeenCalled();
    expect(io.launch).not.toHaveBeenCalled();
  });
});
