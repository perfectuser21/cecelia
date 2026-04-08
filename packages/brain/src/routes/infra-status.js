/**
 * Infrastructure Fleet Status routes
 *
 * GET /servers  — 所有设备的 CPU/内存/磁盘/在线状态（通过 Tailscale SSH 采集）
 */

import { Router } from 'express';
import os from 'os';
import { readFileSync, existsSync } from 'fs';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import pool from '../db.js';
import { checkAndAlertExpiringCredentials, checkCredentialExpiry } from '../credential-expiry-checker.js';

const execAsync = promisify(exec);
const router = Router();

// 能跑编程任务的机器（供 fleet-resource-cache 使用）
export const COMPUTE_SERVERS = ['us-mac-m4', 'xian-mac-m4', 'xian-mac-m1'];

// 设备清单（Tailscale IP）
export const SERVERS = [
  {
    id: 'us-mac-m4',
    name: '美国 Mac mini M4',
    location: '威斯康星',
    tailscaleIp: '100.71.151.105',
    publicIp: '38.23.47.81',
    role: '主力研发机',
    isLocal: true,
  },
  {
    id: 'us-vps',
    name: '美国 VPS',
    location: '加州',
    tailscaleIp: '100.79.41.61',
    publicIp: '134.199.234.147',
    role: '公网中转 exit node',
    sshUser: 'root',
  },
  {
    id: 'hk-vps',
    name: '香港 VPS',
    location: '香港',
    tailscaleIp: '100.86.118.99',
    publicIp: '124.156.138.116',
    role: 'CI runner + 公网',
    sshUser: 'root',
  },
  {
    id: 'xian-mac-m1',
    name: '西安 Mac mini M1',
    location: '西安',
    tailscaleIp: '100.103.88.66',
    role: 'L4 E2E CI 测试',
    sshUser: 'xu xiao',
  },
  {
    id: 'xian-mac-m4',
    name: '西安 Mac mini M4',
    location: '西安',
    tailscaleIp: '100.86.57.69',
    role: 'Codex 主力机',
    sshUser: 'jinnuoshengyuan',
  },
  {
    id: 'xian-pc',
    name: '西安 PC (Windows)',
    location: '西安',
    tailscaleIp: '100.97.242.124',
    role: 'Playwright 被控端',
    sshUser: 'xuxia',
    isWindows: true,
  },
  {
    id: 'nas',
    name: 'NAS',
    location: '西安',
    tailscaleIp: '100.110.241.76',
    role: '存储',
    sshUser: '徐啸',
  },
];

/**
 * 通过 SSH 执行远程命令，超时 5 秒
 */
export async function sshExec(server, cmd) {
  const sshCmd = `ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o BatchMode=yes "${server.sshUser}@${server.tailscaleIp}" ${JSON.stringify(cmd)}`;
  const { stdout } = await execAsync(sshCmd, { timeout: 8000 });
  return stdout.trim();
}

/**
 * 采集本机状态
 */
export function collectLocalStats() {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const loadAvg = os.loadavg();

  let diskUsage = 0, diskTotal = 'N/A', diskUsed = 'N/A';
  try {
    const diskLine = execSync("df -h / | tail -1", { timeout: 3000, encoding: 'utf-8' }).trim();
    const parts = diskLine.split(/\s+/);
    diskTotal = parts[1] || 'N/A';
    diskUsed = parts[2] || 'N/A';
    diskUsage = parseFloat(parts[4]) || 0;
  } catch { /* ignore */ }

  return {
    status: 'online',
    cpu: {
      cores: cpus.length,
      model: cpus[0]?.model || 'Apple M4',
      loadAvg1: Math.round(loadAvg[0] * 100) / 100,
      loadAvg5: Math.round(loadAvg[1] * 100) / 100,
      loadAvg15: Math.round(loadAvg[2] * 100) / 100,
      usagePercent: Math.round((loadAvg[0] / cpus.length) * 1000) / 10,
    },
    memory: {
      totalGB: Math.round(totalMem / 1024 / 1024 / 1024 * 10) / 10,
      usedGB: Math.round((totalMem - freeMem) / 1024 / 1024 / 1024 * 10) / 10,
      usagePercent: Math.round(((totalMem - freeMem) / totalMem) * 1000) / 10,
    },
    disk: { total: diskTotal, used: diskUsed, usagePercent: diskUsage },
    uptime: os.uptime(),
    platform: `${os.type()} ${os.arch()}`,
    hostname: os.hostname(),
  };
}

/**
 * 通过 SSH 采集远程 Unix/macOS 状态
 */
export async function collectRemoteUnixStats(server) {
  const script = [
    'echo "---HOSTNAME---"; hostname',
    'echo "---UNAME---"; uname -sm',
    'echo "---UPTIME---"; cat /proc/uptime 2>/dev/null || sysctl -n kern.boottime 2>/dev/null || echo "0"',
    'echo "---CPUCOUNT---"; nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo "1"',
    'echo "---LOADAVG---"; cat /proc/loadavg 2>/dev/null || sysctl -n vm.loadavg 2>/dev/null || uptime',
    'echo "---MEMINFO---"; cat /proc/meminfo 2>/dev/null || vm_stat 2>/dev/null || echo "N/A"',
    'echo "---DISK---"; df -h / 2>/dev/null | tail -1',
  ].join('; ');

  const output = await sshExec(server, script);
  const sections = {};
  let currentKey = null;
  for (const line of output.split('\n')) {
    const match = line.match(/^---(\w+)---$/);
    if (match) {
      currentKey = match[1];
      sections[currentKey] = '';
    } else if (currentKey) {
      sections[currentKey] += (sections[currentKey] ? '\n' : '') + line;
    }
  }

  const hostname = (sections.HOSTNAME || '').trim();
  const uname = (sections.UNAME || '').trim();
  const cpuCount = parseInt(sections.CPUCOUNT) || 1;

  // Parse load average
  let loadAvg1 = 0, loadAvg5 = 0, loadAvg15 = 0;
  const loadStr = sections.LOADAVG || '';
  const loadMatch = loadStr.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (loadMatch) {
    loadAvg1 = parseFloat(loadMatch[1]);
    loadAvg5 = parseFloat(loadMatch[2]);
    loadAvg15 = parseFloat(loadMatch[3]);
  }

  // Parse memory
  let totalGB = 0, usedGB = 0, memPercent = 0;
  const memStr = sections.MEMINFO || '';
  if (memStr.includes('MemTotal')) {
    const totalMatch = memStr.match(/MemTotal:\s+(\d+)/);
    const availMatch = memStr.match(/MemAvailable:\s+(\d+)/);
    if (totalMatch) {
      const totalKB = parseInt(totalMatch[1]);
      const availKB = availMatch ? parseInt(availMatch[1]) : totalKB;
      totalGB = Math.round(totalKB / 1024 / 1024 * 10) / 10;
      usedGB = Math.round((totalKB - availKB) / 1024 / 1024 * 10) / 10;
      memPercent = Math.round(((totalKB - availKB) / totalKB) * 1000) / 10;
    }
  } else if (memStr.includes('Pages')) {
    const pageSize = 16384;
    const freePages = parseInt(memStr.match(/Pages free:\s+(\d+)/)?.[1] || '0');
    const activePages = parseInt(memStr.match(/Pages active:\s+(\d+)/)?.[1] || '0');
    const inactivePages = parseInt(memStr.match(/Pages inactive:\s+(\d+)/)?.[1] || '0');
    const wiredPages = parseInt(memStr.match(/Pages wired down:\s+(\d+)/)?.[1] || '0');
    const specPages = parseInt(memStr.match(/Pages speculative:\s+(\d+)/)?.[1] || '0');
    const totalPages = freePages + activePages + inactivePages + wiredPages + specPages;
    const usedPages = activePages + wiredPages;
    totalGB = Math.round(totalPages * pageSize / 1024 / 1024 / 1024 * 10) / 10;
    usedGB = Math.round(usedPages * pageSize / 1024 / 1024 / 1024 * 10) / 10;
    memPercent = totalPages > 0 ? Math.round((usedPages / totalPages) * 1000) / 10 : 0;
  }

  // Parse disk
  let diskTotal = 'N/A', diskUsed = 'N/A', diskPercent = 0;
  const diskLine = (sections.DISK || '').trim();
  if (diskLine) {
    const parts = diskLine.split(/\s+/);
    diskTotal = parts[1] || 'N/A';
    diskUsed = parts[2] || 'N/A';
    diskPercent = parseFloat(parts[4]) || 0;
  }

  // Parse uptime
  let uptime = 0;
  const uptimeStr = (sections.UPTIME || '').trim();
  if (uptimeStr.match(/^\d/)) {
    uptime = parseFloat(uptimeStr);
  } else if (uptimeStr.includes('sec')) {
    const secMatch = uptimeStr.match(/sec\s*=\s*(\d+)/);
    if (secMatch) uptime = Math.floor(Date.now() / 1000) - parseInt(secMatch[1]);
  }

  return {
    status: 'online',
    cpu: { cores: cpuCount, model: uname, loadAvg1, loadAvg5, loadAvg15, usagePercent: Math.round((loadAvg1 / cpuCount) * 1000) / 10 },
    memory: { totalGB, usedGB, usagePercent: memPercent },
    disk: { total: diskTotal, used: diskUsed, usagePercent: diskPercent },
    uptime,
    platform: uname,
    hostname,
  };
}

/**
 * 采集 Windows 设备状态
 */
async function collectRemoteWindowsStats(server) {
  try {
    const output = await sshExec(server, 'hostname && echo ---SEP--- && wmic cpu get NumberOfCores /value && echo ---SEP--- && wmic os get TotalVisibleMemorySize,FreePhysicalMemory /value');
    const parts = output.split('---SEP---');
    const hostname = (parts[0] || '').trim();
    const cpuCores = parseInt((parts[1] || '').match(/NumberOfCores=(\d+)/)?.[1] || '1');

    let totalGB = 0, usedGB = 0, memPercent = 0;
    const totalMemMatch = (parts[2] || '').match(/TotalVisibleMemorySize=(\d+)/);
    const freeMemMatch = (parts[2] || '').match(/FreePhysicalMemory=(\d+)/);
    if (totalMemMatch) {
      const totalKB = parseInt(totalMemMatch[1]);
      const freeKB = freeMemMatch ? parseInt(freeMemMatch[1]) : 0;
      totalGB = Math.round(totalKB / 1024 / 1024 * 10) / 10;
      usedGB = Math.round((totalKB - freeKB) / 1024 / 1024 * 10) / 10;
      memPercent = Math.round(((totalKB - freeKB) / totalKB) * 1000) / 10;
    }

    return {
      status: 'online',
      cpu: { cores: cpuCores, model: 'Windows PC', loadAvg1: 0, loadAvg5: 0, loadAvg15: 0, usagePercent: 0 },
      memory: { totalGB, usedGB, usagePercent: memPercent },
      disk: { total: 'N/A', used: 'N/A', usagePercent: 0 },
      uptime: 0,
      platform: 'Windows',
      hostname,
    };
  } catch {
    throw new Error('SSH connection failed');
  }
}

// GET /servers
router.get('/servers', async (_req, res) => {
  try {
    const results = await Promise.allSettled(
      SERVERS.map(async (server) => {
        const base = {
          id: server.id,
          name: server.name,
          location: server.location,
          tailscaleIp: server.tailscaleIp,
          publicIp: server.publicIp || null,
          role: server.role,
        };

        try {
          let stats;
          if (server.isLocal) {
            stats = collectLocalStats();
          } else if (server.isWindows) {
            stats = await collectRemoteWindowsStats(server);
          } else {
            stats = await collectRemoteUnixStats(server);
          }
          return { ...base, ...stats };
        } catch (err) {
          return {
            ...base,
            status: 'offline',
            error: err.message || 'Connection failed',
            cpu: null,
            memory: null,
            disk: null,
            uptime: null,
            platform: null,
            hostname: null,
          };
        }
      })
    );

    const servers = results.map((r) => (r.status === 'fulfilled' ? r.value : { ...SERVERS[0], status: 'error' }));

    res.json({
      servers,
      summary: {
        total: servers.length,
        online: servers.filter((s) => s.status === 'online').length,
        offline: servers.filter((s) => s.status === 'offline').length,
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /health
 * 凭据健康度检查 — 返回所有 Claude 账号的 auth 熔断状态 + 近期 auth 失败统计 + token 到期时间
 * 完整路径: /api/brain/credentials/health（server.js: app.use('/api/brain/credentials', infraStatusRoutes)）
 */
router.get('/health', async (req, res) => {
  try {
    const [accountsResult, authFailStats] = await Promise.all([
      pool.query(`
        SELECT account_id, is_auth_failed, auth_fail_resets_at, fetched_at
        FROM account_usage_cache
        ORDER BY account_id
      `),
      pool.query(`
        SELECT
          payload->>'dispatched_account' as account,
          COUNT(*) as auth_fail_count,
          MAX(updated_at) as latest_failure
        FROM tasks
        WHERE payload->>'failure_class' = 'auth'
          AND updated_at > NOW() - INTERVAL '24 hours'
        GROUP BY payload->>'dispatched_account'
      `),
    ]);

    const failStatsByAccount = {};
    for (const row of authFailStats.rows) {
      failStatsByAccount[row.account || 'unknown'] = {
        auth_fail_count_24h: parseInt(row.auth_fail_count, 10),
        latest_failure: row.latest_failure,
      };
    }

    const accounts = accountsResult.rows.map(row => {
      // 读取 token 到期信息
      let tokenExpiry = { token_expires_at: null, token_remaining_hours: null, token_status: 'unknown' };
      try {
        const credPath = `${os.homedir()}/.claude-${row.account_id}/.credentials.json`;
        if (existsSync(credPath)) {
          const raw = JSON.parse(readFileSync(credPath, 'utf8'));
          const expiresAtMs = raw?.claudeAiOauth?.expiresAt;
          if (expiresAtMs) {
            const remainingMs = expiresAtMs - Date.now();
            const remainingHours = Math.round(remainingMs / 3600000 * 10) / 10;
            const expiresAt = new Date(expiresAtMs).toISOString();
            let token_status;
            if (remainingMs < 0) token_status = 'expired';
            else if (remainingMs < 8 * 3600000) token_status = 'expiring_soon';
            else token_status = 'ok';
            tokenExpiry = { token_expires_at: expiresAt, token_remaining_hours: remainingHours, token_status };
          }
        }
      } catch { /* non-fatal */ }

      return {
        account_id: row.account_id,
        is_auth_failed: row.is_auth_failed,
        auth_fail_resets_at: row.auth_fail_resets_at,
        last_checked: row.fetched_at,
        ...tokenExpiry,
        ...failStatsByAccount[row.account_id],
      };
    });

    const healthy = accounts.every(a => !a.is_auth_failed);

    res.json({
      healthy,
      accounts,
      auth_fail_total_24h: Object.values(failStatsByAccount).reduce((s, v) => s + v.auth_fail_count_24h, 0),
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /recover
 * 按需触发凭据恢复 — 将因 auth 失败而 quarantined 的业务任务重排队（非 pipeline_rescue）
 * 完整路径: /api/brain/credentials/recover
 *
 * 条件：
 *   - 当前所有账号 is_auth_failed = false（熔断未激活）
 *   - 任务 status=quarantined, failure_class=auth, task_type!=pipeline_rescue
 *   - retry_count < max_retries, updated_at 在 48h 内
 */
router.post('/recover', async (req, res) => {
  try {
    // 检查是否有账号仍处于 auth 熔断状态
    const circuitResult = await pool.query(
      `SELECT account_id FROM account_usage_cache WHERE is_auth_failed = true LIMIT 1`
    );
    if (circuitResult.rows.length > 0) {
      return res.status(409).json({
        recovered: 0,
        skipped: `auth circuit still open for: ${circuitResult.rows.map(r => r.account_id).join(', ')}`,
      });
    }

    // 查询符合条件的 quarantined auth 任务（不依赖 retry_count/max_retries 以兼容旧 schema）
    const candidateResult = await pool.query(
      `SELECT id, title
       FROM tasks
       WHERE status = 'quarantined'
         AND payload->>'failure_class' = 'auth'
         AND task_type != 'pipeline_rescue'
         AND updated_at > NOW() - INTERVAL '48 hours'
       ORDER BY updated_at DESC`
    );

    if (candidateResult.rows.length === 0) {
      return res.json({ recovered: 0, skipped: 'no eligible quarantined auth tasks', taskIds: [] });
    }

    const ids = candidateResult.rows.map(r => r.id);
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');

    // 排除同名任务已在 queued/in_progress 的情况（避免唯一约束冲突）
    await pool.query(
      `UPDATE tasks t
       SET status     = 'queued',
           payload    = (COALESCE(t.payload, '{}'::jsonb) - 'failure_class')
                        || '{"recovery_source":"manual_credentials_recover"}'::jsonb,
           updated_at = NOW()
       WHERE t.id IN (${placeholders})
         AND NOT EXISTS (
           SELECT 1 FROM tasks dup
           WHERE dup.title = t.title
             AND dup.status IN ('queued', 'in_progress')
             AND COALESCE(dup.goal_id, '00000000-0000-0000-0000-000000000000'::uuid)
                 = COALESCE(t.goal_id, '00000000-0000-0000-0000-000000000000'::uuid)
             AND COALESCE(dup.project_id, '00000000-0000-0000-0000-000000000000'::uuid)
                 = COALESCE(t.project_id, '00000000-0000-0000-0000-000000000000'::uuid)
             AND dup.id != t.id
         )`,
      ids
    );

    res.json({
      recovered: ids.length,
      taskIds: ids,
      tasks: candidateResult.rows.map(r => ({ id: r.id, title: r.title })),
      recovered_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /check
 * 手动触发凭据有效期检查 — 立即扫描所有账号 token 状态并创建告警任务
 * 完整路径: /api/brain/credentials/check
 *
 * 用途：
 *   - 无需等待 30 分钟 tick 周期
 *   - 排查凭据告警是否正确创建
 *   - 可由 Brain self-drive / 管理脚本主动触发
 */
router.post('/check', async (_req, res) => {
  try {
    const { accounts, criticalAccounts } = checkCredentialExpiry();
    const result = await checkAndAlertExpiringCredentials(pool);

    res.json({
      checked: result.checked,
      alerted: result.alerted,
      skipped: result.skipped,
      accounts: accounts.map(a => ({
        account: a.account,
        status: a.status,
        remaining_ms: a.remainingMs,
        expires_at: a.expiresAt,
        error: a.error,
      })),
      critical_count: criticalAccounts.length,
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

