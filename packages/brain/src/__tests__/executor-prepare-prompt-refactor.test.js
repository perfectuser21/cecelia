/** 通过现役triggerCeceliaRun→Codex review→preparePrompt观察实际写出的prompt，预检处阻断spawn。 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
const io = vi.hoisted(() => ({ query: vi.fn(), writeFile: vi.fn(), access: vi.fn(),
  spawn: vi.fn(() => { throw new Error('禁止真实spawn'); }), execSync: vi.fn(),
  card: null, diff: '',
}));
vi.mock('../db.js', () => ({ default: { query: io.query } }));
// 只放行单测中的入口保护；所有外部边界另行拒绝，绝不启动真实执行者。
vi.mock('../runtime-safety.js', async (original) => ({ ...await original(), assertExternalExecutionAllowed: vi.fn() }));
vi.mock('child_process', () => ({ spawn: io.spawn, execSync: io.execSync,
  exec: vi.fn(() => { throw new Error('禁止真实exec'); }),
  execFile: vi.fn(() => { throw new Error('禁止真实execFile'); }),
}));
vi.mock('fs/promises', () => ({ writeFile: io.writeFile, mkdir: vi.fn(), access: io.access }));
vi.mock('fs', async (original) => {
  const actual = await original(); const { resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url'); const root = resolve(process.cwd(), '../..');
  return { ...actual, readdirSync: vi.fn(() => []), unlinkSync: vi.fn(), existsSync: vi.fn(() => false),
    readFileSync: vi.fn((file, ...args) => {
      const target = file instanceof URL ? fileURLToPath(file) : resolve(String(file));
      if (target.includes('/.task-')) {
        if (io.card === null) throw new Error('owned fixture: no task card');
        return io.card;
      }
      if (!target.startsWith(`${root}/`) || target.includes('/.env') || /credential|auth\.json/.test(target)) throw new Error('禁止仓外文件/凭据读取');
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
  io.query.mockResolvedValue({ rows: [] }); io.writeFile.mockResolvedValue(undefined);
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
  expect(io.spawn).not.toHaveBeenCalled(); expect(global.fetch).not.toHaveBeenCalled();
  return prompts[0][1];
}
function task(type, payload = {}) {
  return { id: `owned-prompt-${type}`, task_type: type, title: 'owned title', description: 'owned description', payload };
}
describe('现役review消费者的真实prompt路由', () => {
  it('spec_review读取实际Task Card输入并写出/spec-review内容', async () => {
    io.card = 'owned task card';
    expect(await reviewPrompt(task('spec_review', { branch: 'cp-owned-review' }))).toBe('/spec-review\n\nowned task card');
  });
  it('Task Card不存在时spec_review使用description，不退到默认/dev', async () => {
    expect(await reviewPrompt(task('spec_review', { branch: 'cp-owned-missing' }))).toBe('/spec-review\n\nowned description');
  });
  it('code_review_gate消费真实git差异边界输入', async () => {
    io.diff = '+owned change';
    expect(await reviewPrompt(task('code_review_gate', { branch: 'cp-owned-diff' }))).toBe('/code-review-gate\n\nowned description\n\n## Git Diff\n```diff\n+owned change\n```');
    expect(io.execSync).toHaveBeenCalledWith('git diff origin/main..HEAD', expect.objectContaining({ encoding: 'utf-8', timeout: 15000 }));
  });
  it('code_review_gate没有branch不读取工作树diff', async () => {
    expect(await reviewPrompt(task('code_review_gate'))).toBe('/code-review-gate\n\nowned description');
    expect(io.execSync).not.toHaveBeenCalled();
  });
  it.each([
    ['prd_review', {}, '/prd-review\n\nowned description'],
    ['initiative_review', { phase: 3, initiative_id: 'owned-initiative' }, '/initiative-review --phase 3 --initiative-id owned-initiative\n\nowned description'],
    ['initiative_verify', { initiative_id: 'owned-initiative' }, '/architect verify --initiative-id owned-initiative\n\nowned description'],
    ['architecture_design', {}, '/architect\n\nowned description'],
    ['decomp_review', {}, '/decomp-check\n\nowned description'],
    ['code_review', { repo_path: '/owned/repo', since_hours: 6 }, '/code-review /owned/repo --since=6h'],
  ])('%s由真实任务路由消费对应handler', async (type, payload, expected) => {
    expect(await reviewPrompt(task(type, payload))).toBe(expected);
  });
});
