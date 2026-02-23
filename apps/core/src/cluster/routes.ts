/**
 * Cluster session management routes
 *
 * GET  /api/cluster/scan-sessions      — 扫描宿主机 Claude 进程（绕过 Docker PID 隔离）
 * GET  /api/cluster/session-info/:pid  — 读取进程 cwd（项目目录）
 * POST /api/cluster/kill-session       — 安全 kill claude 前台进程
 */

import { Router } from 'express';
import { execSync } from 'child_process';
import { readlinkSync, readFileSync, existsSync } from 'fs';

const router = Router();

/**
 * 从 /proc/{pid}/cmdline 读取命令行参数
 * 返回 null 如果进程不存在或无法读取
 */
function readCmdline(pid: number): string[] | null {
  try {
    const raw = readFileSync(`/proc/${pid}/cmdline`, 'utf-8');
    return raw.split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * 从 /proc/{pid}/environ 读取环境变量
 * 返回指定 key 的值，或 null
 */
function readProcessEnv(pid: number, keys: string[]): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const k of keys) result[k] = null;
  try {
    const raw = readFileSync(`/proc/${pid}/environ`, 'utf-8');
    const entries = raw.split('\0');
    for (const entry of entries) {
      const eqIdx = entry.indexOf('=');
      if (eqIdx === -1) continue;
      const key = entry.slice(0, eqIdx);
      if (keys.includes(key)) {
        result[key] = entry.slice(eqIdx + 1);
      }
    }
  } catch {
    // 无法读取 environ（权限或进程不存在）
  }
  return result;
}

/**
 * 检查 PID 是否为前台 claude 进程（非 claude -p）
 */
function isForegroundClaude(args: string[]): boolean {
  if (args.length === 0) return false;
  const bin = args[0];
  if (!bin.endsWith('/claude') && bin !== 'claude') return false;
  if (args.includes('-p')) return false;
  return true;
}

/**
 * GET /api/cluster/scan-sessions
 * 扫描宿主机 Claude 进程列表。
 * 因为 Brain 运行在 Docker 容器（无 --pid=host），它的 ps aux 看不到宿主机进程。
 * Core server 运行在宿主机（pm2），可以直接扫描 /proc。
 */
router.get('/scan-sessions', (_req, res) => {
  try {
    const stdout = execSync(
      'ps aux | grep -E " claude( |$)" | grep -v grep | grep -v "/bin/bash"',
      { encoding: 'utf-8', timeout: 5000 }
    );
    const processes: Array<{
      pid: number; cpu: string; memory: string; startTime: string; command: string;
    }> = [];
    for (const line of stdout.trim().split('\n').filter(Boolean)) {
      const parts = line.split(/\s+/);
      if (parts.length >= 11) {
        const pid = parseInt(parts[1], 10);
        if (!Number.isFinite(pid) || pid <= 0) continue;
        processes.push({
          pid,
          cpu: `${parts[2]}%`,
          memory: `${parts[3]}%`,
          startTime: parts[8],
          command: parts.slice(10).join(' ').slice(0, 120),
        });
      }
    }
    const headed = processes.filter(p => !p.command.includes(' -p ')).length;
    const headless = processes.filter(p => p.command.includes(' -p ')).length;
    res.json({ processes, total: processes.length, headed, headless, scanned_at: new Date().toISOString() });
  } catch {
    res.json({ processes: [], total: 0, headed: 0, headless: 0, scanned_at: new Date().toISOString() });
  }
});

/**
 * GET /api/cluster/session-info/:pid
 * 读取进程工作目录和命令行，用于 LiveMonitor 展开显示
 */
router.get('/session-info/:pid', (req, res) => {
  const pid = parseInt(req.params.pid, 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    return res.status(400).json({ error: 'Invalid PID' });
  }

  if (!existsSync(`/proc/${pid}`)) {
    return res.status(404).json({ error: 'Process not found' });
  }

  const args = readCmdline(pid);
  if (!args) {
    return res.status(404).json({ error: 'Cannot read process info' });
  }

  let cwd: string | null = null;
  try {
    cwd = readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    cwd = null;
  }

  // 从路径提取项目名（最后两段）
  let projectName: string | null = null;
  if (cwd) {
    const parts = cwd.split('/').filter(Boolean);
    projectName = parts.length >= 2
      ? parts.slice(-2).join('/')
      : parts[parts.length - 1] || cwd;
  }

  // 读取 provider/model 环境变量
  const env = readProcessEnv(pid, ['CECELIA_PROVIDER', 'CECELIA_MODEL', 'ANTHROPIC_BASE_URL']);
  let provider: string = 'anthropic';
  let model: string | null = env.CECELIA_MODEL;
  if (env.CECELIA_PROVIDER) {
    provider = env.CECELIA_PROVIDER;
  } else if (env.ANTHROPIC_BASE_URL?.includes('minimax')) {
    provider = 'minimax';
  }

  res.json({
    pid,
    cwd,
    projectName,
    cmdline: args.join(' '),
    isForeground: isForegroundClaude(args),
    provider,
    model,
  });
});

/**
 * GET /api/cluster/session-providers?pids=123,456
 * 批量获取进程的 provider/model 信息（用于 LiveMonitor 徽章）
 */
router.get('/session-providers', (req, res) => {
  const pidsRaw = (req.query.pids as string) || '';
  const pids = pidsRaw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n > 0);
  if (pids.length === 0) {
    return res.json({});
  }
  const result: Record<number, { provider: string; model: string | null }> = {};
  for (const pid of pids) {
    if (!existsSync(`/proc/${pid}`)) continue;
    const env = readProcessEnv(pid, ['CECELIA_PROVIDER', 'CECELIA_MODEL', 'ANTHROPIC_BASE_URL']);
    let provider = 'anthropic';
    if (env.CECELIA_PROVIDER) {
      provider = env.CECELIA_PROVIDER;
    } else if (env.ANTHROPIC_BASE_URL?.includes('minimax')) {
      provider = 'minimax';
    }
    result[pid] = { provider, model: env.CECELIA_MODEL };
  }
  res.json(result);
});

/**
 * POST /api/cluster/kill-session
 * Body: { pid: number }
 * 安全 kill claude 前台进程（非 claude -p）
 */
router.post('/kill-session', (req, res) => {
  const pid = parseInt(req.body?.pid, 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    return res.status(400).json({ error: 'Invalid PID' });
  }

  if (!existsSync(`/proc/${pid}`)) {
    return res.status(404).json({ error: 'Process not found' });
  }

  const args = readCmdline(pid);
  if (!args) {
    return res.status(404).json({ error: 'Cannot read process info' });
  }

  // 安全校验：只允许 kill 前台 claude 进程
  if (!isForegroundClaude(args)) {
    return res.status(403).json({
      error: 'Not a foreground claude process',
      cmdline: args.join(' '),
    });
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (err: any) {
    return res.status(500).json({ error: `SIGTERM failed: ${err.message}` });
  }

  // 60 秒后 SIGKILL（如果进程还在）
  setTimeout(() => {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // 进程已退出，忽略
    }
  }, 60000);

  res.json({ ok: true, pid, signal: 'SIGTERM' });
});

export default router;
