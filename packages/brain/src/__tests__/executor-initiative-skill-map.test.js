/** 通过现役triggerCeceliaRun→Codex review→preparePrompt观察实际写出的prompt，预检处阻断spawn。 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
const io = vi.hoisted(() => ({ query: vi.fn(), writeFile: vi.fn(), access: vi.fn(),
  spawn: vi.fn(() => { throw new Error('禁止真实spawn'); }), execSync: vi.fn(),
  card: null, diff: '', forbidden: vi.fn(() => { throw new Error('禁止非fixture外部动作'); }),
}));
vi.mock('../db.js', () => ({ default: { query: io.query } }));
// 只放行单测中的入口保护；所有外部边界另行拒绝，绝不启动真实执行者。
vi.mock('../runtime-safety.js', async (original) => ({ ...await original(), assertExternalExecutionAllowed: vi.fn() }));
vi.mock('child_process', () => ({ spawn: io.spawn, execSync: io.execSync,
  exec: io.forbidden, execFile: io.forbidden, execFileSync: io.forbidden,
}));
vi.mock('node:child_process', () => ({ spawn: io.spawn, execSync: io.execSync, exec: io.forbidden, execFile: io.forbidden, execFileSync: io.forbidden }));
vi.mock('fs/promises', () => ({ writeFile: io.writeFile, mkdir: vi.fn(), access: io.access }));
vi.mock('fs', async (original) => {
  const actual = await original(); const { resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url'); const root = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/, '');
  return { ...actual, readdirSync: vi.fn(() => []), unlinkSync: vi.fn(), existsSync: vi.fn(() => false),
    readFileSync: vi.fn((file, ...args) => {
      const target = file instanceof URL ? fileURLToPath(file) : resolve(String(file));
      if (target.includes('/.task-')) {
        if (io.card === null) throw new Error('owned fixture: no task card');
        return io.card;
      }
      if (!target.startsWith(`${root}/`) || target.includes('/.env') || /credential|auth\.json/.test(target)) return io.forbidden();
      return actual.readFileSync(file, ...args);
    }),
  };
});
vi.mock('../learning-retriever.js', () => ({ buildLearningContext: vi.fn(async () => '') }));
let executor, resetBindings;
beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('禁止真实网络'); }));
  executor = await import('../executor.js');
  ({ _resetSkillBindingCacheForTest: resetBindings } = await import('../lib/skill-binding-registry.js'));
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.clearAllMocks(); resetBindings(); io.card = null; io.diff = '';
  io.query.mockImplementation(async sql => {
    if (sql.includes('FROM skill_registry') || sql.includes('executor_kind') || sql.includes('task_runs')) return { rows: [], rowCount: 1 };
    return io.forbidden();
  }); io.writeFile.mockResolvedValue(undefined);
  io.execSync.mockImplementation((command) => {
    if (command === 'git diff origin/main..HEAD') return io.diff;
    throw new Error('禁止非fixture shell');
  });
  io.access.mockRejectedValue(Object.assign(new Error('owned binary unavailable'), { code: 'ENOENT' }));
});
async function reviewPrompt(task) {
  const result = await executor.triggerCeceliaRun(task);
  expect(result).toMatchObject({ success: false, configError: true, reason: 'codex_binary_missing', taskId: task.id });
  const prompts = io.writeFile.mock.calls.filter(([file]) => String(file).endsWith('.txt'));
  expect(prompts, '真实review消费者必须且只能写出一次prompt').toHaveLength(1);
  expect(String(prompts[0][0])).toContain(task.id);
  expect(io.access).toHaveBeenCalledOnce();
  expect(io.spawn).not.toHaveBeenCalled(); expect(global.fetch).not.toHaveBeenCalled(); expect(io.forbidden).not.toHaveBeenCalled();
  return prompts[0][1];
}
function task(type, payload = {}) {
  return { id: `owned-prompt-${type}`, task_type: type, title: 'owned title', description: 'owned description', payload };
}
describe('现役initiative核验与拆解审查消费者', () => {
  it('initiative_verify优先消费Project真列，不被旧payload归属覆盖', async () => {
    const row = { ...task('initiative_verify', { initiative_id: 'historical-layer-id' }), project_id: 'current-project-id' };
    expect(await reviewPrompt(row)).toBe('/architect verify --initiative-id current-project-id\n\nowned description');
  });
  it('initiative_verify没有Project真列时兼容已存payload归属', async () => {
    expect(await reviewPrompt(task('initiative_verify', { initiative_id: 'stored-project-id' })))
      .toBe('/architect verify --initiative-id stored-project-id\n\nowned description');
  });
  it('没有旧拆解review_scope的decomp_review仍经真实review路由执行', async () => {
    expect(await reviewPrompt(task('decomp_review', { review_scope: 'plan_adjustment' })))
      .toBe('/decomp-check\n\nowned description');
  });
  it('decomp_review缺description时消费标题', async () => {
    expect(await reviewPrompt({ ...task('decomp_review'), description: '' }))
      .toBe('/decomp-check\n\nowned title');
  });
});
