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
  { vendor: 'codex', name: 'codex-slot', home: process.env.CODEX_SLOT_HOME || '' },
  // account1 是 controller 主线账号，不下场当 worker
  { vendor: 'claude', name: 'account2', home: join(homedir(), '.claude-account2') },
  { vendor: 'grok', name: 'grok', home: join(homedir(), '.grok') },
];

const QUOTA_WALL_PATTERNS = [/out of credits/i, /rate limit/i, /usage limit/i, /\b429\b/, /quota\s+(exceeded|reached|limit)/i];

export function detectQuotaWall(text) {
  if (!text) return false;
  return QUOTA_WALL_PATTERNS.some((re) => re.test(text));
}

export function buildCommand(vendor, account, brief, dir) {
  if (vendor === 'codex') {
    return {
      cmd: 'codex',
      args: ['exec', '--cd', dir, '--sandbox', 'workspace-write', '--skip-git-repo-check', brief],
      env: {
        CODEX_HOME: account.home,
        CODEX_SLOT_AGENT_ID: process.env.CODEX_SLOT_AGENT_ID,
        CODEX_SLOT_LEASE_ID: process.env.CODEX_SLOT_LEASE_ID,
        CODEX_SLOT_RECEIPT: process.env.CODEX_SLOT_RECEIPT,
        CODEX_SLOT_SESSION_ID: process.env.CODEX_SLOT_SESSION_ID,
        OPENAI_API_KEY: undefined,
      },
      cwd: dir,
    };
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
  return { ok: false, reason: 'pool_exhausted', attempts, exit_code: 1, vendor: null, account: null };
}

// ---------- 余量查询 ----------
export async function queryUsage(account) {
  const fail = { account, usable: false, usedPercent: 100 };
  try {
    if (account.vendor === 'grok') {
      // grok 无额度 API：登录了就恒可用，垫底候选
      return { account, usable: existsSync(join(account.home, 'auth.json')), usedPercent: Infinity };
    }
    if (account.vendor === 'codex') {
      if (!account.home || !process.env.CODEX_SLOT_RECEIPT) return fail;
      const brainUrl = process.env.BRAIN_URL || 'http://localhost:5221';
      const r = await fetch(`${brainUrl}/api/brain/codex-usage`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return fail;
      const rows = Object.values((await r.json()).usage || {});
      const pct = rows.length > 0
        ? Math.min(...rows.map(row => Number(row.five_hour_pct ?? 100)))
        : 100;
      return { account, usable: pct < USABLE_THRESHOLD, usedPercent: pct };
    }
    if (account.vendor === 'claude') {
      const c = JSON.parse(readFileSync(join(account.home, '.credentials.json'), 'utf8'));
      const r = await fetch('https://api.anthropic.com/api/oauth/usage', {
        headers: { Authorization: `Bearer ${c.claudeAiOauth?.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return fail;
      const pct = (await r.json()).five_hour?.utilization ?? 100;
      return { account, usable: pct < USABLE_THRESHOLD, usedPercent: pct };
    }
    return fail;
  } catch {
    return fail; // 查询失败视为不可用，降级到下家
  }
}

// ---------- CLI ----------
export function parseArgs(argv) {
  const get = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  let brief = get('--brief');
  const dir = get('--dir');
  if (!brief) throw new Error('缺少 --brief <任务书文件或字符串>');
  if (!dir || !existsSync(dir)) throw new Error('缺少 --dir 或目录不存在（--dir <workdir>）');
  if (existsSync(brief)) brief = readFileSync(brief, 'utf8');
  return { brief, dir, vendor: get('--vendor') ?? 'auto', maxRetries: Number(get('--max-retries') ?? 2) };
}

function makeRealRunWorker(logFile) {
  return (account, brief, dir) => new Promise((resolve) => {
    if (account.vendor === 'codex') {
      const required = ['CODEX_SLOT_AGENT_ID', 'CODEX_SLOT_LEASE_ID', 'CODEX_SLOT_RECEIPT', 'CODEX_SLOT_SESSION_ID'];
      const missing = required.find(key => !process.env[key]);
      if (missing || !account.home) {
        resolve({ output: `codex-slot ${missing || 'CODEX_SLOT_HOME'} missing`, exitCode: 78 });
        return;
      }
    }
    const { cmd, args, env, cwd } = buildCommand(account.vendor, account, brief, dir);
    const ws = createWriteStream(logFile, { flags: 'a' });
    ws.write(`\n===== worker ${account.vendor}:${account.name} @ ${new Date().toISOString()} =====\n`);
    // stdin 必须 ignore：codex exec 见 stdin 是 pipe 会停下等输入（冒烟实证挂死）
    const childEnv = { ...process.env, ...env };
    if (account.vendor === 'codex') {
      delete childEnv.OPENAI_API_KEY;
      delete childEnv.CODEX_RELAY_HOME;
    }
    const child = spawn(cmd, args, { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    for (const s of [child.stdout, child.stderr]) s.on('data', (c) => { output += c; ws.write(c); });
    child.on('close', (code) => { ws.end(); resolve({ output, exitCode: code ?? 1 }); });
    child.on('error', (err) => { ws.end(); resolve({ output: output + String(err), exitCode: 127 }); });
  });
}

async function main() {
  let parsed;
  try { parsed = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error(String(e.message)); process.exit(2); }
  const { brief, dir, vendor, maxRetries } = parsed;
  const usages = await Promise.all(ACCOUNT_POOL.map(queryUsage));
  const candidates = pickAccounts(usages, { vendor });
  if (candidates.length === 0) { console.log(JSON.stringify({ ok: false, reason: 'no_usable_account', vendor: null, account: null, attempts: [], output_file: null, exit_code: 1 })); process.exit(1); }
  const logFile = join(dir, `.dispatch-worker-${Date.now()}.log`);
  const result = await dispatchWithRotation({ candidates, brief, dir, maxRetries, runWorker: makeRealRunWorker(logFile) });
  console.log(JSON.stringify({ ...result, output_file: logFile }));
  process.exit(result.ok ? 0 : (result.exit_code || 1));
}

// 仅直接执行时进 main（被 import 测试时不跑）
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
