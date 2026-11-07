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

describe('退役规划和旧拆解技能覆盖禁止启动', () => {
  it.each(['scope_plan','initiative_plan','project_plan','okr_scope_plan','okr_initiative_plan','okr_project_plan'])('历史 %s 不带旧标记仍拒绝', async task_type => {
    const task={id:'old-plan',task_type,payload:{}};
    expect(await executor.triggerCeceliaRun(task)).toMatchObject({success:false,reason:'retired_decomposition'});
    expect(io.spawn).not.toHaveBeenCalled(); expect(global.fetch).not.toHaveBeenCalled();
  });
  it.each([
    ['architecture_scan','/decomp'],['arch_review','/decomp'],
    ['architecture_scan','/decomp-check'],['arch_review','/decomp-check --review'],
    ['architecture_scan',['/decomp']],
  ])('%s 的旧 skill_override %s 在启动前拒绝', async (task_type,skill_override) => {
    const task={id:'old-override',task_type,payload:{skill_override}};
    expect(await executor.triggerCeceliaRun(task)).toMatchObject({success:false,reason:'retired_decomposition'});
    expect(io.spawn).not.toHaveBeenCalled(); expect(global.fetch).not.toHaveBeenCalled();
  });
  it('正常架构技能覆盖保持可用',async()=>{
    const {isRetiredDecomposition}=await import('../lib/retired-decomposition.js');
    expect(isRetiredDecomposition({task_type:'architecture_scan',payload:{skill_override:'/architect'}})).toBe(false);
    expect(isRetiredDecomposition({task_type:'arch_review',payload:{}})).toBe(false);
    expect(isRetiredDecomposition({task_type:'qiumi_task',payload:{skill_override:'/decomp'}})).toBe(false);
    expect(isRetiredDecomposition({task_type:'research',payload:{invocation:{},skill_override:'/decomp'}})).toBe(false);
    expect(isRetiredDecomposition({task_type:'architecture_scan',payload:{skill_override:'/decomp-other'}})).toBe(false);
  });
});

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
  it.each([
    {task_type:'talk',payload:{next_action:'decompose'}},
    {task_type:'project_plan',payload:{decomposition:'true'}},
    {task_type:'harness_initiative',payload:{requested_task_type:'dev',decomposition:true}},
  ])('非 dev 或归一 dev 的旧路由也拒绝启动 %j',async task=>{
    const result=await executor.triggerCeceliaRun({id:'owned-other',...task});
    expect(result).toMatchObject({success:false,reason:'retired_decomposition'});
    expect(io.spawn).not.toHaveBeenCalled(); expect(global.fetch).not.toHaveBeenCalled();
  });
  it.each([
    {task_type:'qiumi_task',payload:{decomposition:'true'}},
    {task_type:'script_run',payload:{next_action:'decompose'}},
    {task_type:'staging_e2e',payload:{decomposition:'continue'}},
    {task_type:'harness_intervention',payload:{decomposition:'true'}},
    {task_type:'research',payload:{invocation:{id:'owned'},decomposition:'true'}},
    {task_type:'harness_initiative',payload:{decomposition:'true'}},
  ])('不把专用执行面同名字段当旧拆解 %j',async task=>{
    const {isRetiredDecomposition}=await import('../lib/retired-decomposition.js');
    expect(isRetiredDecomposition(task)).toBe(false);
  });
  for (const name of ['triggerCodexBridge','triggerCodexReview','triggerMiniMaxExecutor']) {
    it.each(cases)(`${name} 不可绕过退役标记 %j`, async payload => {
      const result=await executor[name]({id:'owned-decomp',task_type:'dev',payload});
      expect(result).toMatchObject({success:false,reason:'retired_decomposition'});
      expect(io.spawn).not.toHaveBeenCalled(); expect(global.fetch).not.toHaveBeenCalled();
    });
  }
  it('known 保持普通 dev prompt',async () => {
    const prompt=await executor.preparePrompt({id:'owned-dev',task_type:'dev',payload:{decomposition:'known'},prd_content:'test'});
    expect(prompt).toMatch(/^\/dev\n/);
  });
});
