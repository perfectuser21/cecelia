/**
 * ground-truth-proposal-remote.test.ts —— 合同冻结测试（TDD Red）
 *
 * 覆盖父路: 独立小路（无父路）—— packages/brain 后端 kernel 提案 remote 解析修复。
 *
 * 对应 PRD 修法 A（ground-truth.js）：
 *   A1. 提案 remote 解析：parseBaseRepo(payload.base_repo) ?? parseBaseRepo(payload.repo)；
 *       repo='cecelia' 短名经 repoMap 别名映射为 https://github.com/perfectuser21/cecelia.git。
 *   A2. base_repo 与 repo 皆解析不到 → 禁止退 origin：置 observed.proposalRemoteUnresolved=true，
 *       不执行 `git ls-remote --heads origin`。
 *   A3. 回归夹具：假 ls-remote 对 GitHub URL 返回两条 propose 分支、对 origin 返回空
 *       → 旧代码 rn=0（退 origin），新代码 rn=1（打 URL）。
 *
 * 被测边：ground-truth 内部「选哪个 remote / 是否 ls-remote」逻辑。
 * git 子进程（execCmd）是外部边界，注入 fake 合法（见合同「禁 mock 边清单」）。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  collectGroundTruth,
  resolveProposalRemote,
} from '../../../packages/brain/src/orchestrator/ground-truth.js';

const RUN_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const TASK_ID = '7a0188cc-7710-4333-8444-555555555555';
const SHORT_TASK = TASK_ID.slice(0, 8); // 7a0188cc
const SHORT_RUN = RUN_ID.slice(0, 8); // aaaaaaaa
const CECELIA_URL = 'https://github.com/perfectuser21/cecelia.git';

describe('resolveProposalRemote 纯函数 [BEHAVIOR]', () => {
  it('A1: base_repo 空 + repo=cecelia → 规范 GitHub URL，不 unresolved', () => {
    const out = resolveProposalRemote({ repo: 'cecelia' });
    expect(out.unresolved).toBe(false);
    expect(out.remote).toContain(CECELIA_URL);
  });

  it('A1: base_repo 为完整 URL → 直接采用该 URL', () => {
    const out = resolveProposalRemote({ base_repo: CECELIA_URL, repo: 'cecelia' });
    expect(out.unresolved).toBe(false);
    expect(out.remote).toContain(CECELIA_URL);
  });

  it('A2: base_repo 与 repo 皆空 → unresolved=true 且不回退 origin', () => {
    const out = resolveProposalRemote({});
    expect(out.unresolved).toBe(true);
    // 绝不把 origin 当作可用 remote 返回
    expect(out.remote == null || !String(out.remote).includes('origin')).toBe(true);
  });

  it('A2: 未知短名（不在 repoMap）→ 不猜测，unresolved=true', () => {
    const out = resolveProposalRemote({ repo: 'totally-unknown-repo' });
    expect(out.unresolved).toBe(true);
  });
});

/** 按 SQL 子串路由的 fake pool；未匹配一律返回空 rows（collectGroundTruth 仅在缺 run/task 时抛错）。 */
function fakePool(payload: Record<string, unknown>) {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('FROM initiative_runs')) {
        return { rows: [{ id: RUN_ID, contract_id: null, phase: 'gan', pr_url: null, cost_usd: '0', current_task_id: TASK_ID }] };
      }
      if (sql.includes('FROM tasks')) {
        return { rows: [{ id: TASK_ID, status: 'in_progress', payload }] };
      }
      return { rows: [] };
    }),
  };
}

/** 按命令片段路由的 fake execCmd；lsRemote 回调可依据完整命令串区分 URL / origin。 */
function fakeExec(lsRemote: (cmd: string) => string) {
  return vi.fn((cmd: string) => {
    if (cmd.includes('ls-remote')) return lsRemote(cmd);
    // 其余外部命令（docker ps 等）返回空，execTolerant 容忍
    return '';
  });
}

function makeDeps(payload: Record<string, unknown>, lsRemote: (cmd: string) => string) {
  return {
    pool: fakePool(payload),
    execCmd: fakeExec(lsRemote),
    fileExists: vi.fn(() => false),
    readFile: vi.fn(() => { throw new Error('ENOENT'); }),
  };
}

describe('collectGroundTruth 提案 remote 观测 [BEHAVIOR]', () => {
  // 回归夹具：URL 上存在两条 propose 分支（r1 两个 attempt），origin 上为空。
  const proposeBranch = `cp-harness-propose-r1-${SHORT_TASK}-r${SHORT_RUN}-a13`;
  const proposeBranch2 = `cp-harness-propose-r1-${SHORT_TASK}-r${SHORT_RUN}-a10`;
  const urlLsRemoteOutput = [
    `7f413df5${'0'.repeat(32)}\trefs/heads/${proposeBranch2}`,
    `7e78cee1${'0'.repeat(32)}\trefs/heads/${proposeBranch}`,
  ].join('\n');

  function lsRemoteByRemote(cmd: string) {
    // 新代码打 GitHub URL → 返回分支；旧代码退 origin → 返回空。
    return cmd.includes('github.com/perfectuser21/cecelia.git') ? urlLsRemoteOutput : '';
  }

  it('A1/A3: base_repo 空 + repo=cecelia → ls-remote 命令串含 GitHub URL 且 proposeBranchRn=1', async () => {
    const deps = makeDeps({ repo: 'cecelia' }, lsRemoteByRemote);
    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    const lsRemoteCmds = deps.execCmd.mock.calls
      .map((c) => String(c[0]))
      .filter((c) => c.includes('ls-remote'));
    expect(lsRemoteCmds.length).toBeGreaterThanOrEqual(1);
    expect(lsRemoteCmds.some((c) => c.includes(CECELIA_URL))).toBe(true);
    // 观测到 GitHub 上真实 push 的提案分支 → rn>=1（旧代码退 origin 得 rn=0）
    expect(observed.proposeBranchRn).toBe(1);
    expect(observed.proposalRemoteUnresolved).toBeFalsy();
  });

  it('A2: base_repo 与 repo 皆空 → 不执行 ls-remote origin，proposalRemoteUnresolved=true', async () => {
    const deps = makeDeps({}, lsRemoteByRemote);
    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    const lsRemoteCmds = deps.execCmd.mock.calls
      .map((c) => String(c[0]))
      .filter((c) => c.includes('ls-remote'));
    // 绝不对本地 origin 发 ls-remote（那会把真 push 算成 no-push）
    expect(lsRemoteCmds.some((c) => /ls-remote --heads origin\b/.test(c))).toBe(false);
    expect(observed.proposalRemoteUnresolved).toBe(true);
    expect(observed.proposeBranchRn).toBe(0);
  });
});
