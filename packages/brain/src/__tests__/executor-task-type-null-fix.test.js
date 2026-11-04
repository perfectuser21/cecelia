/** 空类型当前合同：真实prompt默认解析；旧Claude派发拒绝，不复活已删task_type修正。 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
const io = vi.hoisted(() => ({ query: vi.fn(), spawn: vi.fn(() => { throw new Error('禁止真实spawn'); }) }));
vi.mock('../db.js', () => ({ default: { query: io.query } }));
vi.mock('../runtime-safety.js', async (original) => ({ ...await original(), assertExternalExecutionAllowed: vi.fn() }));
vi.mock('child_process', () => ({ spawn: io.spawn,
  exec: vi.fn(() => { throw new Error('禁止真实exec'); }),
  execSync: vi.fn(() => { throw new Error('禁止真实shell'); }),
  execFile: vi.fn(() => { throw new Error('禁止真实execFile'); }),
}));
vi.mock('fs', async (original) => {
  const actual = await original(); const { resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url'); const root = resolve(process.cwd(), '../..');
  return { ...actual, existsSync: vi.fn(() => false),
    readFileSync: vi.fn((file, ...args) => {
      const target = file instanceof URL ? fileURLToPath(file) : resolve(String(file));
      if (!target.startsWith(`${root}/`) || target.includes('/.env') || /credential|auth\.json/.test(target)) throw new Error('禁止仓外文件/凭据读取');
      return actual.readFileSync(file, ...args);
    }),
  };
});
vi.mock('fs/promises', () => ({ writeFile: vi.fn(), mkdir: vi.fn(), access: vi.fn() }));
vi.mock('../learning-retriever.js', () => ({ buildLearningContext: vi.fn(async () => '') }));
let executor, resetBindings;
beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('禁止真实网络'); }));
  executor = await import('../executor.js');
  ({ _resetSkillBindingCacheForTest: resetBindings } = await import('../lib/skill-binding-registry.js'));
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { vi.clearAllMocks(); io.query.mockResolvedValue({ rows: [] }); resetBindings(); });

describe('空task_type真实消费者合同', () => {
  it.each([null, undefined, ''])('preparePrompt接收空类型%s，真实默认/dev且不改任务', async (type) => {
    const task = { id: 'owned-null-task', title: 'owned prompt', task_type: type, payload: { skill: '/dev' }, prd_content: 'owned PRD body' };
    const before = structuredClone(task);
    const prompt = await executor.preparePrompt(task);
    expect(prompt).toMatch(/^\/dev\n/); expect(prompt).toContain('owned PRD body');
    expect(task).toEqual(before);
    expect(io.query.mock.calls.some(([sql]) => sql.includes('FROM skill_registry'))).toBe(true);
  });
  it('真实getSkillForTaskType接收null，而不是先在测试里改成dev', () => {
    expect(executor.getSkillForTaskType(null, {})).toBe('/dev');
    expect(executor.getSkillForTaskType('code_review', {})).toBe('/code-review');
  });
  it('payload缺失仍由真实preparePrompt默认/dev', async () => {
    expect(await executor.preparePrompt({ id: 'owned-missing-payload', title: 'owned', task_type: null, payload: null, prd_content: 'body' })).toMatch(/^\/dev\n/);
  });
  it('旧payload.skill不是类型修正或覆盖；显式skill_override保留独立语义', async () => {
    const task = { id: 'owned-legacy-skill', title: 'owned', task_type: null, payload: { skill: '/qa' }, prd_content: 'body' };
    expect(await executor.preparePrompt(task)).toMatch(/^\/dev\n/);
    expect(task.task_type).toBeNull();
    io.query.mockClear();
    expect(await executor.preparePrompt({ ...task, payload: { skill_override: '/owned-override' } })).toMatch(/^\/owned-override\n/);
    expect(io.query).not.toHaveBeenCalled();
  });
  it('已有非dev类型经真实handler，不被payload.skill改派', async () => {
    const task = { id: 'owned-review', task_type: 'code_review', payload: { skill: '/dev', repo_path: '/owned/repo', since_hours: 4 } };
    expect(await executor.preparePrompt(task)).toBe('/code-review /owned/repo --since=4h');
    expect(task.task_type).toBe('code_review');
  });
  it('空类型旧派发当前明确拒绝退役Claude通道，不恢复旧null修正', async () => {
    const task = { id: 'owned-null-dispatch', task_type: null, payload: { skill: '/dev' } };
    expect(await executor.triggerCeceliaRun(task)).toMatchObject({ success: false, taskId: task.id, reason: 'claude_channel_retired' });
    expect(task.task_type).toBeNull(); expect(io.spawn).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
