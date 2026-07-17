/**
 * startup-reset.js — Agent Core 启动前置幂等复位
 *
 * 五步流水线（任一步失败只 warn，不阻断后续）：
 *   S1. 进程归零 (process_zero)    — 清理 exited docker 容器 + stale tmux session
 *   S2. 微信归一 (wechat_unify)    — SSH 探测 ROG，确保 wechat_rpa 进程唯一（fail-open）
 *   S3. 环境自检 (env_check)       — Docker / git 可用性验证
 *   S4. 残骸清理 (residue_cleanup) — 清理 /tmp/cecelia-* 过期文件
 *   S5. checklist 上报             — 写入 working_memory + console.log
 *
 * 设计原则：
 *   - 幂等：安全重复调用
 *   - fail-open：每步 try/catch，失败只警告，不阻断启动
 *   - S1-S4 无 DB 依赖（纯 process/FS）
 *   - S5 可选 DB：传 pool 才写；不传则仅 console.log
 */

import { execSync } from 'child_process';
import { readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';

const TMP_DIR = '/tmp';
const RESIDUE_PREFIX = 'cecelia-';
const RESIDUE_TTL_MS = 6 * 3600 * 1000; // 6h

// ── S1: 进程归零 ──────────────────────────────────────────────────────────────

/**
 * 清理 exited Docker 容器（名含 cecelia-）+ stale tmux session
 *
 * @param {{ execFn?: Function }} [opts]
 * @returns {{ step: 'process_zero', ok: boolean, containers_removed: number, sessions_killed: number, error?: string }}
 */
export async function runProcessZero({ execFn = execSync } = {}) {
  let containers_removed = 0;
  let sessions_killed = 0;

  try {
    // 1a. 清理 exited Docker 容器（名含 cecelia-）
    // docker ps 失败时直接抛出，让外层 catch 处理（返回 ok:false）
    const containerList = String(
      execFn(
        'docker ps -a --filter "status=exited" --filter "name=cecelia-" --format "{{.Names}}"',
        { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' },
      ) || '',
    ).trim();

    if (containerList) {
      const names = containerList.split('\n').map(s => s.trim()).filter(Boolean);
      if (names.length > 0) {
        try {
          execFn(`docker rm ${names.join(' ')}`, { encoding: 'utf-8', timeout: 15000, stdio: 'pipe' });
          containers_removed = names.length;
        } catch (e) {
          console.warn('[startup-reset:process_zero] docker rm failed (non-fatal):', e.message?.slice(0, 200));
        }
      }
    }

    // 1b. 清理 dead tmux session（仅当 tmux 可用时）
    try {
      const sessOut = String(
        execFn('tmux ls 2>/dev/null || true', { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }) || '',
      );
      const deadSessions = sessOut
        .split('\n')
        .filter(line => line.includes('cecelia') && line.toLowerCase().includes('dead'))
        .map(line => line.split(':')[0].trim())
        .filter(Boolean);
      for (const sess of deadSessions) {
        try {
          execFn(`tmux kill-session -t ${sess}`, { encoding: 'utf-8', timeout: 3000, stdio: 'pipe' });
          sessions_killed++;
        } catch { /* individual session kill failure is ok */ }
      }
    } catch { /* tmux not available — skip */ }

    console.log(`[startup-reset:process_zero] done containers_removed=${containers_removed} sessions_killed=${sessions_killed}`);
    return { step: 'process_zero', ok: true, containers_removed, sessions_killed };
  } catch (e) {
    console.warn('[startup-reset:process_zero] failed (non-fatal):', e.message?.slice(0, 200));
    return { step: 'process_zero', ok: false, containers_removed, sessions_killed, error: e.message };
  }
}

// ── S2: 微信归一 ──────────────────────────────────────────────────────────────

/**
 * SSH 到 ROG 检查 wechat_rpa.py 进程数，>1 则 kill 多余实例。
 * CECELIA_ROG_HOST 未配置时静默跳过（fail-open）。
 *
 * @param {{ execFn?: Function }} [opts]
 * @returns {{ step: 'wechat_unify', skipped?: true, ok?: boolean, pid_count?: number, killed_count?: number, error?: string }}
 */
export async function runWechatUnify({ execFn = execSync } = {}) {
  const rogHost = process.env.CECELIA_ROG_HOST;
  if (!rogHost) {
    return { step: 'wechat_unify', skipped: true };
  }

  const sshBase = `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o ConnectTimeout=5 ${rogHost}`;

  try {
    // 查询 wechat_rpa 进程
    const pgrepOut = String(
      execFn(`${sshBase} "pgrep -f wechat_rpa || true"`, {
        encoding: 'utf-8', timeout: 10000, stdio: 'pipe',
      }) || '',
    ).trim();

    const pids = pgrepOut.split('\n').map(s => s.trim()).filter(Boolean);
    const pid_count = pids.length;

    if (pid_count <= 1) {
      console.log(`[startup-reset:wechat_unify] ok pid_count=${pid_count}`);
      return { step: 'wechat_unify', ok: true, pid_count, killed_count: 0 };
    }

    // 保留最旧的 PID（pids[0]），kill 其余
    const toKill = pids.slice(1);
    execFn(`${sshBase} "kill ${toKill.join(' ')}"`, {
      encoding: 'utf-8', timeout: 10000, stdio: 'pipe',
    });
    const killed_count = toKill.length;
    console.log(`[startup-reset:wechat_unify] killed ${killed_count} extra wechat_rpa processes`);
    return { step: 'wechat_unify', ok: true, pid_count, killed_count };
  } catch (e) {
    console.warn('[startup-reset:wechat_unify] failed (non-fatal, ROG may be unreachable):', e.message?.slice(0, 200));
    return { step: 'wechat_unify', ok: false, error: e.message };
  }
}

// ── S3: 环境自检 ──────────────────────────────────────────────────────────────

/**
 * 验证 Docker / git 可用性。
 *
 * @param {{ execFn?: Function }} [opts]
 * @returns {{ step: 'env_check', ok: boolean, docker: boolean, git: boolean }}
 */
export async function runEnvCheck({ execFn = execSync } = {}) {
  let docker = false;
  let git = false;

  try {
    execFn('docker --version', { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
    docker = true;
  } catch { /* docker not available */ }

  try {
    execFn('git --version', { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
    git = true;
  } catch { /* git not available */ }

  const ok = docker && git;
  console.log(`[startup-reset:env_check] docker=${docker} git=${git} ok=${ok}`);
  return { step: 'env_check', ok, docker, git };
}

// ── S4: 残骸清理 ──────────────────────────────────────────────────────────────

/**
 * 清理 /tmp/cecelia-* 过期文件（默认 TTL 6h）。
 *
 * @param {{ tmpDir?: string, ttlMs?: number, nowMs?: number }} [opts]
 * @returns {{ step: 'residue_cleanup', ok: boolean, removed: number, errors: string[] }}
 */
export async function runResidueCleanup({ tmpDir = TMP_DIR, ttlMs = RESIDUE_TTL_MS, nowMs } = {}) {
  const now = nowMs ?? Date.now();
  let removed = 0;
  const errors = [];

  let entries;
  try {
    entries = readdirSync(tmpDir);
  } catch (e) {
    console.warn('[startup-reset:residue_cleanup] readdirSync failed (non-fatal):', e.message?.slice(0, 200));
    return { step: 'residue_cleanup', ok: false, removed: 0, errors: [e.message] };
  }

  for (const name of entries) {
    if (!name.startsWith(RESIDUE_PREFIX)) continue;

    const filePath = join(tmpDir, name);
    try {
      const { mtimeMs } = statSync(filePath);
      if (now - mtimeMs < ttlMs) continue;
      unlinkSync(filePath);
      removed++;
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }

  console.log(`[startup-reset:residue_cleanup] removed=${removed} errors=${errors.length}`);
  return { step: 'residue_cleanup', ok: true, removed, errors };
}

// ── S5: checklist 上报 ────────────────────────────────────────────────────────

const SENTINEL_KEY = 'scheduler_job_last_run:startup-reset';

/**
 * 上报启动 checklist：console.log（结构化）+ 可选 DB 写入。
 *
 * @param {Array<object>} steps - 各步骤结果
 * @param {object|null} pool - pg Pool（可选）
 */
export async function reportStartupChecklist(steps, pool) {
  const summary = {
    at: new Date().toISOString(),
    steps_count: steps.length,
    steps_ok: steps.filter(s => s.ok === true).length,
    steps_skipped: steps.filter(s => s.skipped === true).length,
    steps_failed: steps.filter(s => s.ok === false && !s.skipped).length,
    steps,
  };

  console.log('[startup-reset] checklist', JSON.stringify(summary));

  if (pool && typeof pool.query === 'function') {
    try {
      await pool.query(
        `INSERT INTO working_memory (key, value_json, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
        [SENTINEL_KEY, JSON.stringify(summary)],
      );
    } catch (e) {
      console.warn('[startup-reset] working_memory write failed (non-fatal):', e.message?.slice(0, 200));
    }
  }

  return summary;
}

// ── Master: runStartupReset ───────────────────────────────────────────────────

/**
 * 启动前置幂等复位（五步流水线）。任一步失败不阻断后续。
 *
 * @param {{ pool?: object, execFn?: Function }} [opts]
 * @returns {{ steps: Array<object>, at: string }}
 */
export async function runStartupReset({ pool = null, execFn = execSync } = {}) {
  const steps = [];

  // S1 进程归零
  try {
    steps.push(await runProcessZero({ execFn }));
  } catch (e) {
    console.warn('[startup-reset] S1 process_zero threw unexpectedly:', e.message);
    steps.push({ step: 'process_zero', ok: false, error: e.message });
  }

  // S2 微信归一
  try {
    steps.push(await runWechatUnify({ execFn }));
  } catch (e) {
    console.warn('[startup-reset] S2 wechat_unify threw unexpectedly:', e.message);
    steps.push({ step: 'wechat_unify', ok: false, error: e.message });
  }

  // S3 环境自检
  try {
    steps.push(await runEnvCheck({ execFn }));
  } catch (e) {
    console.warn('[startup-reset] S3 env_check threw unexpectedly:', e.message);
    steps.push({ step: 'env_check', ok: false, error: e.message });
  }

  // S4 残骸清理
  try {
    steps.push(await runResidueCleanup());
  } catch (e) {
    console.warn('[startup-reset] S4 residue_cleanup threw unexpectedly:', e.message);
    steps.push({ step: 'residue_cleanup', ok: false, error: e.message });
  }

  // S5 checklist 上报
  await reportStartupChecklist(steps, pool);

  return { steps, at: new Date().toISOString() };
}
