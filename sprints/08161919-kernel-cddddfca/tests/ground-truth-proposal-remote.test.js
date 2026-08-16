/**
 * 冻结合同测试 — ground-truth 提案 remote 解析（根因 #1 + 回归夹具）。
 *
 * 只 stub 最外层 git/DB 边界（execCmd/pool），不 mock ground-truth 内部逻辑：
 * 被改的边「payload → proposalRemote 字符串 → git ls-remote」全程真跑（禁 mock 边清单）。
 *
 * 回归锚点：run 7a8e5319 / task ff2b0fa9（生产实证 08-15 13:38 -05）——proposer 两轮真 push，
 * 旧代码退 origin 观测 rn=0（假失败 gan_no_push_streak）；新代码对 GitHub URL 观测 rn=1。
 */
import { describe, it, expect, vi } from 'vitest';
import { collectGroundTruth } from '../../../packages/brain/src/orchestrator/ground-truth.js';

// slice(0,8) 必须等于生产事故的 shortTask/shortRun。
const RUN_ID = '7a8e5319-0000-4000-8000-000000000000';
const TASK_ID = 'ff2b0fa9-0000-4000-8000-000000000000';
const CONTRACT_ID = '99999999-8888-4777-8666-555555555555';
const ROUTING_RECEIPT_ID = '77777777-6666-4555-8444-333333333333';

const CANONICAL_URL = 'https://github.com/perfectuser21/cecelia.git';

// 只对 GitHub URL 返回真实提案分支，对 origin 返回空（复现事故：origin 是本机 remote，看不到 GitHub 分支）。
const PROPOSE_BRANCHES = [
  '7f413df5cafedeadbeef000000000000000000aa\trefs/heads/cp-harness-propose-r1-ff2b0fa9-r7a8e5319-a10',
  '7e78cee1cafedeadbeef000000000000000000bb\trefs/heads/cp-harness-propose-r1-ff2b0fa9-r7a8e5319-a13',
].join('\n');

/** 按 SQL 表名路由的 fake pool（照抄 orchestrator/__tests__/ground-truth.test.js 的 fakePool 契约）。 */
function fakePool(rowsByTable = {}) {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      calls.push([sql, params]);
      if (sql.includes('AS validation_origin_run_id')) return { rows: rowsByTable.validation_origins ?? [] };
      if (sql.includes('FROM initiative_runs')) return { rows: rowsByTable.initiative_runs ?? [] };
      if (sql.includes('FROM initiative_contracts')) return { rows: rowsByTable.initiative_contracts ?? [] };
      if (sql.includes('FROM initiative_contract_artifacts')) return { rows: rowsByTable.initiative_contract_artifacts ?? [] };
      if (sql.includes('FROM tasks')) return { rows: rowsByTable.tasks ?? [] };
      if (sql.includes('FROM work_routing_receipts')) return { rows: rowsByTable.work_routing_receipts ?? [] };
      if (sql.includes('FROM harness_attempts')) {
        if (sql.includes("role = 'evaluator'")) return { rows: rowsByTable.harness_evaluator_attempts ?? [] };
        return { rows: rowsByTable.harness_attempts ?? [] };
      }
      if (sql.includes('FROM orchestrator_decision_log') && sql.includes('JOIN initiative_runs prior_run')) {
        return { rows: rowsByTable.historical_failure_sets ?? [] };
      }
      if (sql.includes('FROM orchestrator_decision_log')) return { rows: rowsByTable.orchestrator_decision_log ?? [] };
      if (sql.includes('FROM account_usage_cache')) return { rows: rowsByTable.account_usage_cache ?? [] };
      if (sql.includes('FROM gan_case_file')) return { rows: rowsByTable.gan_case_file ?? [] };
      throw new Error(`unexpected sql: ${sql}`);
    }),
  };
}

/** 按命令片段路由的 fake execCmd；捕获全部 git/gh/docker 调用。 */
function fakeExecCmd() {
  const calls = [];
  const fn = vi.fn((cmd) => {
    calls.push(cmd);
    if (cmd.includes('gh pr list')) return '[]';
    if (cmd.includes('gh pr checks')) return '[]';
    if (cmd.includes('ls-remote')) {
      // 关键：只有查 GitHub URL 才返回真实分支；查 origin（本机）返回空。
      return cmd.includes(CANONICAL_URL) ? PROPOSE_BRANCHES : '';
    }
    if (cmd.includes('docker ps -a')) return '';
    if (cmd.includes('docker ps')) return '';
    if (cmd.includes('docker inspect')) return '{"ExitCode":0}';
    return '';
  });
  fn.calls = calls;
  return fn;
}

function makeDeps(taskPayload) {
  const pool = fakePool({
    initiative_runs: [{
      id: RUN_ID, contract_id: CONTRACT_ID, phase: 'gan', pr_url: null,
      cost_usd: '0', current_task_id: TASK_ID,
    }],
    initiative_contracts: [{ id: CONTRACT_ID, status: 'draft' }],
    initiative_contract_artifacts: [],
    tasks: [{
      id: TASK_ID, status: 'in_progress',
      payload: { ...taskPayload, routing_receipt_id: ROUTING_RECEIPT_ID },
    }],
    work_routing_receipts: [{
      id: ROUTING_RECEIPT_ID, task_id: TASK_ID, work_kind: 'coding_mutation',
      change_kind: 'capability_change', pipeline: 'harness',
      canonical_task_type: 'harness_initiative', default_execution_profile: 'capability-change-v1',
      execution_profile_override: null, repo: 'cecelia',
      evidence: { branch: 'cp-baseline', base_sha: 'a'.repeat(40) }, superseded: false,
    }],
    harness_attempts: [],
    harness_evaluator_attempts: [],
    orchestrator_decision_log: [],
    historical_failure_sets: [],
    validation_origins: [],
    account_usage_cache: [],
    gan_case_file: [],
  });
  const execCmd = fakeExecCmd();
  return {
    deps: {
      pool,
      execCmd,
      fileExists: vi.fn(() => false),
      readFile: vi.fn(() => { throw new Error('ENOENT'); }),
    },
    execCmd,
  };
}

describe('ground-truth 提案 remote 解析（禁 origin 兜底 + repo 回退）', () => {
  it('base_repo 空 + payload.repo=cecelia → ls-remote 命令串含规范 GitHub URL，观测到真实提案分支 rn=1', async () => {
    const { deps, execCmd } = makeDeps({ repo: 'cecelia' });
    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    const lsRemoteCalls = execCmd.calls.filter((c) => c.includes('ls-remote'));
    expect(lsRemoteCalls.length).toBeGreaterThanOrEqual(1);
    // 提案 remote 必须是规范 GitHub URL，绝不能退 origin。
    expect(lsRemoteCalls.some((c) => c.includes(CANONICAL_URL))).toBe(true);
    expect(lsRemoteCalls.some((c) => /ls-remote --heads origin\b/.test(c))).toBe(false);
    // 真 push 被正确计入（回归夹具：旧代码 rn=0，新代码 rn=1）。
    expect(observed.proposeBranchRn).toBe(1);
    expect(observed.proposalRemoteUnresolved).toBeFalsy();
  });

  it('base_repo 与 repo 皆缺 → 不对 origin 跑 ls-remote，proposalRemoteUnresolved===true', async () => {
    const { deps, execCmd } = makeDeps({});
    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    // 禁 origin 兜底：无法解析提案 remote 时绝不执行 ls-remote origin。
    expect(execCmd.calls.some((c) => c.includes('ls-remote') && /origin/.test(c))).toBe(false);
    expect(observed.proposalRemoteUnresolved).toBe(true);
    expect(observed.proposeBranchRn).toBe(0);
  });
});
