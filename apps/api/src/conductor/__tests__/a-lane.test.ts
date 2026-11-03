// A 道CLI命令边界：隔离、失败传播与PR身份；不证明worker产物或TDD红绿。
// vitest include 只认 .ts,故本测试用 .ts import 同目录的 .mjs。
// 外部命令(git / gh / worktree-manage.sh)全部通过可注入的 exec runner mock,绝不真跑。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// @ts-expect-error —— .mjs 无类型声明,运行期可解析
import { runALane } from '../a-lane.mjs';

beforeEach(()=>vi.stubEnv('ALANE_LIVE',''));
afterEach(()=>vi.unstubAllEnvs());

const task = { id: 'cache-daily-report', title: '给 daily-report 加缓存' };
const contract = {
  approach: '服务端 Redis 缓存 daily-report, TTL 5min',
  files: ['apps/api/src/system/daily-report.ts', 'apps/api/src/shared/cache.ts'],
  tests: ['服务端集成: 缓存命中跳过重算 / TTL 过期重算'],
  risk: 'Redis 连不上需降级直算',
};

// 造一个记录所有调用的假 runner;返回值按命令定制(尤其 gh pr create 出 URL)。
function makeFakeExec(overrides: Record<string, string> = {}) {
  const calls: Array<{ cmd: string; args: string[]; cwd?: string }> = [];
  const exec = (cmd: string, args: string[], opts: { cwd?: string } = {}) => {
    calls.push({ cmd, args, cwd: opts.cwd });
    const key = `${cmd} ${args.join(' ')}`;
    for (const [pat, out] of Object.entries(overrides)) {
      if (key.includes(pat)) return out;
    }
    // worktree-manage.sh init-or-check 末行 echo 出 worktree 路径
    if (key.includes('worktree-manage.sh')) {
      return '✅ worktree\n/Users/administrator/worktrees/cecelia/cache-daily-report';
    }
    if (key.includes('rev-parse --abbrev-ref HEAD')) {
      return 'cp-06211807-cache-daily-report';
    }
    return '';
  };
  return { exec, calls };
}

describe('runALane — DRY_RUN 守护(默认)', () => {
  it('默认 dry-run: 不调用任何 exec,返回 status=dry-run', () => {
    const { exec, calls } = makeFakeExec();
    const r = runALane(task, contract, { exec });
    expect(r.status).toBe('dry-run');
    expect(calls.length).toBe(0); // 默认不真跑,一条外部命令都不发
  });

  it('dry-run 返回 4 步计划(worktree / TDD红 / TDD绿 / 开PR),且不含真实 PR URL', () => {
    const { exec } = makeFakeExec();
    const r = runALane(task, contract, { exec });
    expect(Array.isArray(r.steps)).toBe(true);
    expect(r.steps.length).toBeGreaterThanOrEqual(4);
    const plan = r.steps.join('\n');
    expect(plan).toMatch(/worktree/i);
    expect(plan).toMatch(/失败测试|red|commit ?1/i);
    expect(plan).toMatch(/实现|green|commit ?2/i);
    expect(plan).toMatch(/pr|开 ?pr/i);
    expect(r.pr).not.toMatch(/^https:\/\/github\.com\/.+\/pull\/\d+$/);
  });

  it('demo 路径天然 dry-run: conductor --demo 不真开 PR(opts 不给 live 即安全)', () => {
    const { exec, calls } = makeFakeExec();
    const r = runALane(task, contract, { exec }); // 无 dryRun:false
    expect(r.status).toBe('dry-run');
    expect(calls.length).toBe(0);
  });
});

describe('runALane — live 真态执行序', () => {
  it('显式repoRoot下先调用新worktree owner，后续git仍只在返回的工作树执行', () => {
    const { exec, calls } = makeFakeExec({ 'pr create': 'https://github.com/perfectuser21/cecelia/pull/4242' });
    runALane(task, contract, { exec, dryRun: false, repoRoot: '/private-fixture/repo' });
    expect(calls[0]).toEqual({
      cmd: 'bash', args: ['/private-fixture/repo/scripts/dev/worktree/worktree-manage.sh', 'init-or-check', 'cache-daily-report'],
      cwd: '/private-fixture/repo',
    });
    expect(calls.filter(call => call.cmd === 'git').every(call => call.cwd === '/Users/administrator/worktrees/cecelia/cache-daily-report')).toBe(true);
  });

  it('命令编排顺序为worktree、两个提交、push与PR；不将提交文案当作TDD执行证明', () => {
    const { exec, calls } = makeFakeExec({
      'pr create': 'https://github.com/perfectuser21/cecelia/pull/4242',
    });
    runALane(task, contract, { exec, dryRun: false });

    const keys = calls.map((c) => `${c.cmd} ${c.args.join(' ')}`);
    const idxWorktree = keys.findIndex((k) => k.includes('worktree-manage.sh'));
    const idxCommit1 = keys.findIndex((k) => k.includes('commit') && /red|失败|test|测试/i.test(k));
    const idxCommit2 = keys.findIndex((k, i) => i > idxCommit1 && k.includes('commit'));
    const idxPush = keys.findIndex((k) => k.includes('push'));
    const idxPr = keys.findIndex((k) => k.includes('pr create'));

    expect(idxWorktree).toBeGreaterThanOrEqual(0);
    expect(idxCommit1).toBeGreaterThanOrEqual(0);
    expect(idxCommit2).toBeGreaterThan(idxCommit1); // 棘轮: 失败测试(commit1)必须先于实现(commit2)
    expect(idxPush).toBeGreaterThan(idxCommit2);
    expect(idxPr).toBeGreaterThan(idxPush);
    // worktree 必须最先(隔离在前,绝不在主仓库操作)
    expect(idxWorktree).toBeLessThan(idxCommit1);
  });

  it('解析 gh pr create 输出的真实 PR URL 并返回 { pr, status:opened }', () => {
    const url = 'https://github.com/perfectuser21/cecelia/pull/4242';
    const { exec } = makeFakeExec({ 'pr create': url });
    const r = runALane(task, contract, { exec, dryRun: false });
    expect(r.pr).toBe(url);
    expect(r.status).toBe('opened');
  });

  it('返回的 branch 是 worktree 给的 cp-* 分支,绝不在 main 上操作', () => {
    const { exec, calls } = makeFakeExec({
      'pr create': 'https://github.com/perfectuser21/cecelia/pull/4242',
    });
    const r = runALane(task, contract, { exec, dryRun: false });
    expect(r.branch).toMatch(/^cp-/);
    // 所有 git commit/push 都必须带 worktree cwd,绝不在主仓库(无 cwd)直接提交
    const gitMutations = calls.filter(
      (c) => c.cmd === 'git' && /commit|push|checkout/.test(c.args.join(' ')),
    );
    expect(gitMutations.length).toBeGreaterThan(0);
    for (const m of gitMutations) {
      expect(m.cwd).toBeTruthy(); // cwd 指向 worktree,不是主仓库 main
      expect(m.args.join(' ')).not.toMatch(/\bmain\b/); // 绝不 checkout/push 到 main
    }
  });

  it('worktree 路径从 worktree-manage.sh 输出末行解析,后续命令 cwd 切到该路径', () => {
    const wt = '/Users/administrator/worktrees/cecelia/cache-daily-report';
    const { exec, calls } = makeFakeExec({
      'pr create': 'https://github.com/perfectuser21/cecelia/pull/4242',
    });
    const r = runALane(task, contract, { exec, dryRun: false });
    expect(r.worktree).toBe(wt);
    // worktree 创建后的命令(commit/push/pr)cwd 必须是该 worktree
    const afterWt = calls.filter((c) => c.cwd === wt);
    expect(afterWt.length).toBeGreaterThan(0);
  });
});


describe('A道失败边界',()=>{
  it('非cp分支在任何git写入前拒绝',()=>{
    const {exec,calls}=makeFakeExec({'rev-parse --abbrev-ref HEAD':'main'});
    expect(()=>runALane(task,contract,{exec,dryRun:false})).toThrow('非 cp-*');
    expect(calls.filter(c=>c.cmd==='git').map(c=>c.args)).toEqual([['rev-parse','--abbrev-ref','HEAD']]);
  });
  it.each(['worktree','commit','push'])('%s命令失败必须停止，不能开PR',stage=>{
    const base=makeFakeExec();
    const exec=(cmd:string,args:string[],options:{cwd?:string})=>{
      if((stage==='worktree' && cmd==='bash') || (cmd==='git' && args[0]===stage)) throw Error(`fixture-${stage}`);
      return base.exec(cmd,args,options);
    };
    expect(()=>runALane(task,contract,{exec,dryRun:false})).toThrow(`fixture-${stage}`);
    expect(base.calls.some(c=>c.cmd==='gh')).toBe(false);
  });
  it.each(['','created without URL'])('PR输出缺少真实句柄%s时不能声称opened',output=>{
    const {exec}=makeFakeExec({'pr create':output});
    expect(()=>runALane(task,contract,{exec,dryRun:false})).toThrow('PR URL');
  });
});


describe('完整GitHub PR URL身份',()=>{
  it.each([
    'https://github.com/owner/repo/pull/12oops',
    'https://github.com/owner/./pull/12',
    'https://github.com/owner/../pull/12',
    'https://github.com/owner/pull/12',
    'https://github.com/owner/repo/pull/0',
    'https://github.com/owner/repo/pull/12/more',
    'https://github.com.evil/owner/repo/pull/12',
  ])('拒绝畸形完整token：%s',output=>{
    const {exec}=makeFakeExec({'pr create':output});
    expect(()=>runALane(task,contract,{exec,dryRun:false})).toThrow('PR URL');
  });
  it.each([
    'Created pull request:\nhttps://github.com/some-owner/repo_name.js/pull/42\nReady',
    'Created pull request (https://github.com/some-owner/repo_name.js/pull/42)',
  ])('提示文字或换行内仍可提取合法完整URL',output=>{
    const {exec}=makeFakeExec({'pr create':output});
    expect(runALane(task,contract,{exec,dryRun:false})).toMatchObject({status:'opened',pr:'https://github.com/some-owner/repo_name.js/pull/42'});
  });
});
