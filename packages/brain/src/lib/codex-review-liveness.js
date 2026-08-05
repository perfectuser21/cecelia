/**
 * codex-review 活性 SSOT（决策 9befa9c3，issue f1d6840f）。
 *
 * REVIEW_TASK_TYPES 任务由 triggerCodexReview spawn detached codex，三条进程
 * 信号（activeProcesses / current_run_id / ps 扫描）全无——曾被进程层探针 60 秒
 * 宽限后恒判死，10~30 分钟的审查结构性跑不完（三轮真机复现）。
 * 活性以 lock 文件为准：spawn 前写入（含 startedAt）、spawn error 与 exit
 * handler 均删除——存在即在跑；缺失=已收尸或容器重启（双确认流程给回队出路）。
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';

export const CODEX_REVIEW_LOCK_DIR = '/tmp/codex-review-locks';

export function probeCodexReviewLock(taskId, { maxAgeMinutes = 90, lockDir = CODEX_REVIEW_LOCK_DIR } = {}) {
  const lockFile = path.join(lockDir, `${taskId}.lock`);
  if (!existsSync(lockFile)) return 'dead';
  try {
    const meta = JSON.parse(readFileSync(lockFile, 'utf-8'));
    const startedAt = new Date(meta.startedAt).getTime();
    if (Number.isFinite(startedAt)) {
      const ageMin = (Date.now() - startedAt) / 60000;
      if (ageMin > maxAgeMinutes) return 'dead';
    }
    return 'alive';
  } catch {
    // lock 在但读不动（写入竞态/损坏）→ 保守视为在跑，下一轮再看
    return 'alive';
  }
}
