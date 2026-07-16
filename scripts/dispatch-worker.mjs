#!/usr/bin/env node
// 跨账号 headless worker 派工胶水：查余量→选账号→吊 worker→额度撞墙换账号重试
// 链路 2026-07-16 实测（memory: worker-pool-cross-account-verified）
// 撞墙识别只信输出文本不信 exit code（实测 codex 撞墙 exit=0）
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, createWriteStream } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// 阈值语义与 packages/brain/scripts/codex-bridge/codex-account-usage.cjs 对齐
export const USABLE_THRESHOLD = 90;

export const ACCOUNT_POOL = [
  { vendor: 'codex', name: 'team1', home: join(homedir(), '.codex-team1') },
  { vendor: 'codex', name: 'team2', home: join(homedir(), '.codex-team2') },
  // account1 是 controller 主线账号，不下场当 worker
  { vendor: 'claude', name: 'account2', home: join(homedir(), '.claude-account2') },
  { vendor: 'grok', name: 'grok', home: join(homedir(), '.grok') },
];

const QUOTA_WALL_PATTERNS = [/out of credits/i, /rate limit/i, /usage limit/i, /\b429\b/, /quota/i];

export function detectQuotaWall(text) {
  if (!text) return false;
  return QUOTA_WALL_PATTERNS.some((re) => re.test(text));
}

export function buildCommand(vendor, account, brief, dir) {
  if (vendor === 'codex') {
    return { cmd: 'codex', args: ['exec', '--cd', dir, '--sandbox', 'workspace-write', brief], env: { CODEX_HOME: account.home }, cwd: dir };
  }
  if (vendor === 'claude') {
    // 必须用真身：裸 claude 被 claude-launch.sh alias 劫持，headless 报 _claude_launch not found
    return { cmd: '/opt/homebrew/bin/claude', args: ['-p', '--dangerously-skip-permissions', brief], env: { CLAUDE_CONFIG_DIR: account.home }, cwd: dir };
  }
  if (vendor === 'grok') {
    return { cmd: join(homedir(), '.grok/bin/grok'), args: ['-p', brief, '--cwd', dir, '--always-approve'], env: {}, cwd: dir };
  }
  throw new Error(`unknown vendor: ${vendor}`);
}

export function pickAccounts(usages, { vendor = 'auto' } = {}) {
  return usages
    .filter((u) => (vendor === 'auto' ? true : u.account.vendor === vendor))
    .filter((u) => u.usable)
    .sort((a, b) => a.usedPercent - b.usedPercent);
}

export async function dispatchWithRotation({ candidates, brief, dir, maxRetries = 2, runWorker }) {
  const attempts = [];
  for (const cand of candidates.slice(0, maxRetries + 1)) {
    const { output, exitCode } = await runWorker(cand.account, brief, dir);
    const wall = detectQuotaWall(output);
    attempts.push({ vendor: cand.account.vendor, account: cand.account.name, quota_wall: wall, exit_code: exitCode });
    if (wall) continue; // 额度墙 → 换下家
    // 非撞墙的失败是任务问题不是额度问题，不换账号
    return { ok: exitCode === 0, vendor: cand.account.vendor, account: cand.account.name, attempts, exit_code: exitCode };
  }
  return { ok: false, reason: 'pool_exhausted', attempts, exit_code: 1 };
}
