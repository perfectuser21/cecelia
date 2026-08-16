/**
 * TDD Red — 回归夹具复现 run 7a8e5319（task ff2b0fa9）假失败。
 * 现象：proposer 两轮真实 push 提案分支到 GitHub，kernel 连续观测 proposeBranchRn=0 → gan_no_push_streak 假失败。
 * 夹具：空 base_repo + payload.repo='cecelia' + 假 ls-remote（对 GitHub URL 返两条 propose 分支、对 origin 返空）。
 *   - 旧代码：remote 退 'origin' → ls-remote 返空 → proposeBranchRn=0（假失败）
 *   - 新代码：remote 解析为 https://github.com/perfectuser21/cecelia.git → proposeBranchRn=1（真相）
 *
 * 被测边（禁 mock）：collectGroundTruth 真调（DB/exec 注入 fake 属外层依赖，被改的解析边不 mock）。
 */
import { describe, it, expect, vi } from 'vitest';
import { collectGroundTruth } from '../../../packages/brain/src/orchestrator/ground-truth.js';

const RUN_ID = '7a8e5319-1111-4aaa-8bbb-cccccccccccc';
const TASK_ID = 'ff2b0fa9-2222-4ddd-8eee-ffffffffffff';
const CONTRACT_ID = '99999999-8888-4777-8666-555555555555';
const RECEIPT_ID = '77777777-6666-4555-8444-333333333333';
const SHORT_TASK = TASK_ID.slice(0, 8); // ff2b0fa9
const SHORT_RUN = RUN_ID.slice(0, 8); // 7a8e5319

// 真实提案分支（GitHub 上确有）：r1 两个 attempt。ls-remote 行格式 `<sha>\trefs/heads/<branch>`。
const URL_LS_REMOTE = [
  `7f413df5aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/heads/cp-harness-propose-r1-${SHORT_TASK}-r${SHORT_RUN}-a10`,
  `7e78cee1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/heads/cp-harness-propose-r1-${SHORT_TASK}-r${SHORT_RUN}-a13`,
].join('\n');

function makeDeps() {
  const runRow = {
    id: RUN_ID, contract_id: CONTRACT_ID, phase: 'gan', pr_url: null,
    cost_usd: '1.50', current_task_id: TASK_ID,
  };
  const taskRow = {
    id: TASK_ID,
    status: 'in_progress',
    // 复现根因：base_repo 空、repo 短名存在
    payload: { base_repo: null, repo: 'cecelia', routing_receipt_id: RECEIPT_ID },
  };
  const receiptRow = {
    id: RECEIPT_ID, task_id: TASK_ID, work_kind: 'coding_mutation',
    change_kind: 'bugfix', pipeline: 'harness', canonical_task_type: 'harness_initiative',
    default_execution_profile: 'capability-change-v1', execution_profile_override: null,
    repo: 'cecelia', evidence: { branch: 'cp-baseline', base_sha: 'a'.repeat(40) }, superseded: false,
  };
  const pool = {
    query: vi.fn(async (sql) => {
      const t = String(sql);
      if (t.includes('FROM initiative_runs')) return { rows: [runRow] };
      if (t.includes('FROM initiative_contracts')) return { rows: [{ id: CONTRACT_ID, status: 'draft' }] };
      if (t.includes('FROM initiative_contract_artifacts')) return { rows: [] };
      if (t.includes('FROM tasks')) return { rows: [taskRow] };
      if (t.includes('FROM work_routing_receipts')) return { rows: [receiptRow] };
      // 其余表（harness_attempts / decision_log / case_file / usage_cache / validation_origins…）夹具无关，空集
      return { rows: [] };
    }),
  };
  const execCmd = vi.fn((cmd) => {
    const c = String(cmd);
    if (c.includes('ls-remote')) {
      // 关键：只有对 GitHub URL 才返回真实分支；对本地 'origin' 返空（复现本机 remote 看不到 GitHub）
      if (c.includes('https://github.com/perfectuser21/cecelia.git')) return URL_LS_REMOTE;
      return '';
    }
    if (c.includes('docker ps')) return '';
    if (c.includes('docker inspect')) return '{"ExitCode":0}';
    return '';
  });
  return {
    pool,
    execCmd,
    fileExists: vi.fn(() => false),
    readFile: vi.fn(() => { throw new Error('ENOENT'); }),
  };
}

describe('回归夹具 run 7a8e5319：提案分支观测退 origin 假失败 [BEHAVIOR]', () => {
  it('空 base_repo + repo=cecelia → 新代码从 GitHub URL 观测到提案分支，proposeBranchRn===1', async () => {
    const deps = makeDeps();
    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    // 新代码：remote 解析为 GitHub URL，ls-remote 命中真实分支
    expect(observed.proposeBranchRn).toBe(1);
    // 至少一次 ls-remote 命令串带 GitHub URL（而非 origin）
    const lsRemoteCalls = deps.execCmd.mock.calls
      .map((args) => String(args[0]))
      .filter((c) => c.includes('ls-remote'));
    expect(lsRemoteCalls.length).toBeGreaterThanOrEqual(1);
    expect(lsRemoteCalls.some((c) => c.includes('https://github.com/perfectuser21/cecelia.git'))).toBe(true);
    // 未解析故不置 unresolved
    expect(observed.proposalRemoteUnresolved).toBe(false);
  });
});
