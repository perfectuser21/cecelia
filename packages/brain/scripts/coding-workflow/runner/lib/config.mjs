// runner 配置：所有外部可替换点都从环境变量注入（测试用沙箱路径与假件覆盖）。
import os from 'node:os';
import path from 'node:path';

const DEFAULT_KILL_GRACE_MS = 30000;

/** 正整数环境变量；缺失或非法返回 null。 */
function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function loadConfig(env = process.env) {
  const home = env.HOME || os.homedir();
  const host = os.hostname();
  return {
    brainUrl: String(env.BRAIN_URL || 'http://localhost:5221').replace(/\/+$/, ''),
    repo: env.CODING_WF_REPO || path.join(home, 'perfect21/cecelia-cw-runner'),
    worktreeBase: env.CODING_WF_WORKTREE_BASE || path.join(home, 'worktrees/cecelia-cw'),
    logDir: env.CODING_WF_LOG_DIR || path.join(home, '.cecelia/coding-workflow-runner'),
    lockDir: env.CODING_WF_LOCK_DIR || path.join(home, '.cecelia'),
    // null = 用 worktree 自己的 packages/brain/scripts/activity-contract-run.js
    executor: env.CODING_WF_EXECUTOR || null,
    ghBin: env.CODING_WF_GH_BIN || 'gh',
    skipNpmCi: env.CODING_WF_SKIP_NPM_CI === '1',
    automerge: env.CODING_WF_AUTOMERGE !== '0',
    // null = 按契约 budget 计算
    runTimeoutMs: positiveInt(env.CODING_WF_RUN_TIMEOUT_MS),
    killGraceMs: positiveInt(env.CODING_WF_KILL_GRACE_MS) ?? DEFAULT_KILL_GRACE_MS,
    // 列 queued/in_progress 的起始页大小（Brain 只支持 limit，满页则加倍重查）
    listLimit: positiveInt(env.CODING_WF_LIST_LIMIT) ?? 500,
    // 失败任务 worktree 保留天数；每任务回执/日志保留天数
    failedRetentionDays: positiveInt(env.CODING_WF_FAILED_RETENTION_DAYS) ?? 7,
    logRetentionDays: positiveInt(env.CODING_WF_LOG_RETENTION_DAYS) ?? 30,
    host,
    claimer: `coding-workflow-runner@${host}`,
  };
}
