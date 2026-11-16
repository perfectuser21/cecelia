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
describe('现役架构审查消费者的领域上下文', () => {
  function architecture(fields = {}) {
    return { ...task('architecture_scan'), title: '领域审查', description: '核对当前架构', ...fields };
  }
  it.each([['coding', 'cto'], ['product', 'cpo']])('%s/%s进入实际写出的审查prompt', async (domain, owner_role) => {
    const prompt = await reviewPrompt(architecture({ domain, owner_role }));
    expect(prompt).toContain(`任务所属领域：${domain}`);
    expect(prompt).toContain(`负责角色：${owner_role}`);
    expect(prompt).toContain('业务领域上下文');
  });
  it.each([{ domain: null, owner_role: null }, {}])('空领域字段%s不生成领域块', async fields => {
    expect(await reviewPrompt(architecture(fields))).not.toContain('业务领域上下文');
  });
  it('只有领域时显式保留负责角色未指定', async () => {
    const prompt = await reviewPrompt(architecture({ domain: 'quality', owner_role: null }));
    expect(prompt).toContain('任务所属领域：quality');
    expect(prompt).toContain('负责角色：(未指定)');
  });
  it('默认PRD保留真实标题和功能描述', async () => {
    const prompt = await reviewPrompt(architecture());
    expect(prompt).toContain('# PRD - 领域审查');
    expect(prompt).toContain('## 功能描述\n核对当前架构');
  });
});
