/**
 * worker-pool-dispatch.js — 并行血管P1：worker 池自动派发（scheduler job，任务 873acc6d）
 *
 * 原实现：扫 queued 的 parallel_worker / exploratory 任务 → 经 ssh 往宿主 tmux slot7-9
 * 发射交互 claude（经 claude 启动器）跑 `/dev --task-id`，由 Brain 自动驱动订阅 OAuth 账号。
 *
 * Claude Code 无头通道已退役（任务 76a160b3，决策 067867c8，单一来源 lib/claude-channel.js）：
 * 本 job 不再认领任务、不执行任何命令，每轮只返回 skipped=claude_channel_retired。
 */
import { CLAUDE_CHANNEL_RETIRED_CODE } from './lib/claude-channel.js';

export async function runWorkerPoolDispatch() {
  return { skipped: CLAUDE_CHANNEL_RETIRED_CODE, dispatched: 0 };
}
