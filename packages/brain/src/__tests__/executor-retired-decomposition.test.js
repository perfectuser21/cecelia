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

describe('旧拆解标记禁止启动', () => {
  const cases = [
    {decomposition:true}, {decomposition:'true'}, {decomposition:'continue'},
    {decomposition:'okr'}, {next_action:'decompose'},
    {decomposition:'known', next_action:'decompose'},
  ];
  it.each(cases)('真实执行入口拒绝 %j，不启动任务', async (payload) => {
    const task={id:'owned-decomp',task_type:'dev',payload:{...payload,executor:'codex',machine:'xian-m4'}};
    const result=await executor.triggerCeceliaRun(task);
    expect(result).toMatchObject({success:false,reason:'retired_decomposition'});
    expect(io.spawn).not.toHaveBeenCalled(); expect(global.fetch).not.toHaveBeenCalled();
  });
  it.each(cases)('旧标记不生成 prompt %j', async payload => {
    await expect(executor.preparePrompt({id:'owned-decomp',task_type:'dev',payload})).rejects.toMatchObject({code:'retired_decomposition'});
  });
  it('known 保持普通 dev prompt',async () => {
    const prompt=await executor.preparePrompt({id:'owned-dev',task_type:'dev',payload:{decomposition:'known'},prd_content:'test'});
    expect(prompt).toMatch(/^\/dev\n/);
  });
});
