/**
 * ops-collector.js — 运行舱采集器（指挥舱 G1 S1 刀1，task 6fcb5356）
 * 拉取模型：scheduler job 复用 host-exec ssh 逃逸，无宿主 daemon/写端点。
 * 契约（PrepPRD D1-D3）：0条=可疑须 source_status 佐证；失败 reason_code+last_error 双写；
 * 宁 stale 不假数据；next_run 绝对 UTC 或 NULL；OpenClaw 只读 docker exec 写死路径；
 * launchd 只认已加载；meta 白名单禁凭据。
 */
import { existsSync } from 'fs';
import { defaultExec, buildHostCmd } from './host-exec.js';

export const OWN_LABEL_RE = /(cecelia|zenithjoy|perfect21|openclaw|claude|n8n|cloudflare)/i;
export const INTERVAL_MS = parseInt(process.env.OPS_COLLECTOR_INTERVAL_MS || String(5 * 60 * 1000), 10);

export function parseLaunchctlList(out, labelRe = OWN_LABEL_RE) {
  const rows = [];
  for (const line of String(out).split('\n').slice(1)) {
    const m = line.trim().match(/^(-|\d+)\s+(-?\d+)\s+(\S+)$/);
    if (!m) continue;
    const [, pid, status, label] = m;
    if (!labelRe.test(label)) continue;
    rows.push({ label, pid: pid === '-' ? null : Number(pid), lastExitCode: Number(status) });
  }
  return rows;
}

export function parsePlistDump(out) {
  const plists = new Map();
  const badFiles = [];
  for (const block of String(out).split(/^== /m).slice(1)) {
    const nl = block.indexOf('\n');
    const path = block.slice(0, nl).trim();
    const body = block.slice(nl + 1).trim();
    if (!body) continue;
    try {
      const j = JSON.parse(body);
      if (j.Label) plists.set(j.Label, {
        path,
        StartInterval: j.StartInterval ?? null,
        StartCalendarInterval: j.StartCalendarInterval ?? null,
      });
    } catch { badFiles.push(path); }
  }
  return { plists, badFiles };
}

const WEEKDAY_NUM = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** StartCalendarInterval → 下次触发绝对 UTC（DST 正确：逐分钟用 Intl 在目标时区比对）。算不出=null。 */
export function computeNextRunUTC(cal, from, timeZone, horizonDays = 8) {
  const entries = (Array.isArray(cal) ? cal : [cal]).filter(Boolean);
  if (!entries.length) return null;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  });
  const start = Math.ceil((from.getTime() + 1) / 60000) * 60000;
  for (let i = 0; i < horizonDays * 24 * 60; i++) {
    const t = new Date(start + i * 60000);
    const parts = Object.fromEntries(fmt.formatToParts(t).map((p) => [p.type, p.value]));
    const local = {
      Minute: Number(parts.minute), Hour: Number(parts.hour),
      Day: Number(parts.day), Month: Number(parts.month),
      Weekday: WEEKDAY_NUM[parts.weekday],
    };
    for (const e of entries) {
      let match = true;
      for (const [k, v] of Object.entries(e)) {
        if (!(k in local)) continue; // 未知键容忍（schema_drift 不失败）
        const want = k === 'Weekday' && Number(v) === 7 ? 0 : Number(v);
        if (local[k] !== want) { match = false; break; }
      }
      if (match) return t.toISOString();
    }
  }
  return null;
}

export function extractOpenclawAgents(config) {
  const entries = config?.agents?.entries;
  const list = Array.isArray(entries) ? entries
    : entries && typeof entries === 'object'
      ? Object.entries(entries).map(([id, v]) => ({ id, ...(v || {}) }))
      : null;
  if (!list) throw new Error('schema_drift: agents.entries 缺失或形状未知');
  return list
    .map((e) => ({
      name: String(e.id || e.name || ''),
      agent_type: 'openclaw_agent',
      meta: { // 白名单——clawdbot.json 含明文凭据，绝不整份入库
        model: typeof e.model === 'string' ? e.model : null,
        workspace: typeof e.workspace === 'string' ? e.workspace : null,
      },
    }))
    .filter((a) => a.name);
}

export function parseGhaCron(out) {
  const rows = [];
  for (const line of String(out).split('\n')) {
    const m = line.match(/\.github\/workflows\/([^:]+):\d+:.*cron:\s*'([^']+)'/);
    if (!m) continue;
    const repo = line.includes('/cecelia/') ? 'cecelia' : 'zenithjoy';
    rows.push({ label: `${repo}/${m[1]}`, schedule_desc: `cron(UTC): ${m[2]}`, kind: 'gha_cron' });
  }
  return rows;
}

export const HK_OPENCLAW_CMD =
  "ssh -o BatchMode=yes -o ConnectTimeout=6 -o StrictHostKeyChecking=no root@100.86.118.99 " +
  "'docker exec openclaw-gateway cat /root/.openclaw/clawdbot.json'"; // 写死真身路径：宿主同名文件5份含旧备份

export const PLIST_DUMP_CMD =
  'for f in /Library/LaunchDaemons/*.plist; do echo "== $f"; /usr/bin/plutil -convert json -o - "$f" 2>/dev/null; echo ""; done';

export const GHA_CRON_CMD =
  "grep -RnoE \"cron: *'[^']+'\" /Users/administrator/perfect21/cecelia/.github/workflows /Users/administrator/perfect21/zenithjoy-workspace/.github/workflows 2>/dev/null || true";

let lastRunAt = 0;
export function __resetOpsCollectorForTest() { lastRunAt = 0; }

async function writeHeartbeat(pool, source, host, status, reasonCode, lastError, collectedAt) {
  await pool.query(
    `INSERT INTO ops_source_heartbeats (source, host_alias, last_report_at, last_collected_at, source_status, reason_code, last_error, updated_at)
     VALUES ($1,$2,NOW(),$3,$4,$5,$6,NOW())
     ON CONFLICT (source, host_alias) DO UPDATE SET
       last_report_at=NOW(), source_status=$4, reason_code=$5, last_error=$6, updated_at=NOW(),
       last_collected_at=COALESCE($3, ops_source_heartbeats.last_collected_at)`,
    [source, host, collectedAt || null, status, reasonCode, lastError ? String(lastError).slice(0, 500) : null]
  );
}

async function writeAgentsSnapshot(pool, source, host, agents, collectedAt) {
  for (const a of agents) {
    await pool.query(
      `INSERT INTO ops_agents (source, host_alias, name, agent_type, status, last_seen_at, meta, updated_at)
       VALUES ($1,$2,$3,$4,'active',$5,$6,NOW())
       ON CONFLICT (source, host_alias, name) DO UPDATE SET
         agent_type=EXCLUDED.agent_type, status='active', last_seen_at=EXCLUDED.last_seen_at,
         meta=EXCLUDED.meta, updated_at=NOW()`,
      [source, host, a.name, a.agent_type || null, collectedAt, JSON.stringify(a.meta || {})]
    );
  }
  // 快照缺席 → offline（不删行，保 notion_id 与历史）
  await pool.query(
    `UPDATE ops_agents SET status='offline', updated_at=NOW()
     WHERE source=$1 AND host_alias=$2 AND status='active' AND last_seen_at < $3`,
    [source, host, collectedAt]
  );
}

async function writeSchedulesSnapshot(pool, source, host, entries, collectedAt) {
  for (const s of entries) {
    await pool.query(
      `INSERT INTO ops_schedule_entries (source, host_alias, label, kind, schedule_desc, next_run_utc, last_state, last_exit_code, active, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,NOW())
       ON CONFLICT (source, host_alias, label) DO UPDATE SET
         kind=EXCLUDED.kind, schedule_desc=EXCLUDED.schedule_desc, next_run_utc=EXCLUDED.next_run_utc,
         last_state=EXCLUDED.last_state, last_exit_code=EXCLUDED.last_exit_code, active=TRUE, updated_at=NOW()`,
      [source, host, s.label, s.kind, s.schedule_desc || '', s.next_run_utc || null, s.last_state || null, s.last_exit_code ?? null]
    );
  }
  if (entries.length) {
    await pool.query(
      `UPDATE ops_schedule_entries SET active=FALSE, updated_at=NOW()
       WHERE source=$1 AND host_alias=$2 AND active=TRUE AND updated_at < $3`,
      [source, host, collectedAt]
    );
  }
}

function classifyError(e) {
  const msg = String(e?.message || '');
  if (/timed? ?out|connect|unreachable|Connection refused|ETIMEDOUT/i.test(msg)) return ['unreachable', 'ssh_or_exec_failed'];
  if (/schema_drift/.test(msg)) return ['schema_drift', 'schema_drift'];
  if (/No such file|not found|config_missing/i.test(msg)) return ['config_missing', 'config_missing'];
  return ['parse_error', 'parse_error'];
}

/** scheduler-jobs handler（needsPool:true）。opts 仅供测试注入。 */
export async function runOpsCollector(pool, opts = {}) {
  const now = opts.now ?? Date.now();
  if (now - lastRunAt < INTERVAL_MS) return { skipped: true };
  lastRunAt = now;
  const exec = opts.exec || defaultExec;
  const inContainer = opts.inContainer ?? existsSync('/.dockerenv');
  const run = (cmd) => exec(buildHostCmd(cmd, inContainer, opts.keyExistsFn));
  const collectedAt = new Date(now).toISOString();
  const results = {};

  // —— 腿1: launchd@local ——（只认已加载；0行=可疑判失败）
  try {
    const list = parseLaunchctlList(run('launchctl list'));
    if (list.length === 0) throw new Error('parse_error: launchctl list 解析出 0 行自家任务（0=可疑，禁当真空）');
    let hostTz = 'America/Los_Angeles';
    try { hostTz = String(run('readlink /etc/localtime')).split('zoneinfo/')[1]?.trim() || hostTz; } catch { /* 展示级信息，失败用默认 */ }
    const { plists } = parsePlistDump(run(PLIST_DUMP_CMD));
    const agents = list.map((l) => ({
      name: l.label, agent_type: 'launchd_job',
      meta: { pid: l.pid, last_exit_code: l.lastExitCode },
    }));
    const schedules = [];
    for (const l of list) {
      const p = plists.get(l.label);
      if (!p) continue;
      const lastState = l.pid ? 'running' : (l.lastExitCode === 0 ? 'ok' : `exit ${l.lastExitCode}`);
      if (p.StartCalendarInterval) {
        schedules.push({
          label: l.label, kind: 'launchd_calendar',
          schedule_desc: `calendar(${hostTz}): ${JSON.stringify(p.StartCalendarInterval)}`,
          next_run_utc: computeNextRunUTC(p.StartCalendarInterval, new Date(now), hostTz),
          last_state: lastState, last_exit_code: l.lastExitCode,
        });
      } else if (p.StartInterval) {
        schedules.push({
          label: l.label, kind: 'launchd_interval',
          schedule_desc: `约每 ${p.StartInterval} 秒`, // 锚点=加载时刻，禁假精确
          next_run_utc: null, last_state: lastState, last_exit_code: l.lastExitCode,
        });
      }
    }
    await writeAgentsSnapshot(pool, 'launchd', 'local', agents, collectedAt);
    await writeSchedulesSnapshot(pool, 'launchd', 'local', schedules, collectedAt);
    await writeHeartbeat(pool, 'launchd', 'local', 'ok', null, null, collectedAt);
    results.launchd = { ok: true, agents: agents.length, schedules: schedules.length };
  } catch (e) {
    const [status, code] = classifyError(e);
    await writeHeartbeat(pool, 'launchd', 'local', status, code, e.message);
    results.launchd = { ok: false };
  }

  // —— 腿2: openclaw@hk-vps ——（解析失败整份丢弃，沿用上轮+stale）
  try {
    const raw = run(HK_OPENCLAW_CMD);
    let cfg;
    try { cfg = JSON.parse(raw); } catch { throw new Error(`parse_error: clawdbot.json 非法 JSON（前100字符: ${String(raw).slice(0, 100)}）`); }
    const agents = extractOpenclawAgents(cfg);
    await writeAgentsSnapshot(pool, 'openclaw', 'hk-vps', agents, collectedAt);
    await writeHeartbeat(pool, 'openclaw', 'hk-vps', 'ok', null, null, collectedAt);
    results.openclaw = { ok: true, agents: agents.length };
  } catch (e) {
    const [status, code] = classifyError(e);
    await writeHeartbeat(pool, 'openclaw', 'hk-vps', status, code, e.message);
    results.openclaw = { ok: false };
  }

  // —— 腿3: gha@github（静态解析宿主 checkout，失败不阻塞）——
  try {
    const entries = parseGhaCron(run(GHA_CRON_CMD));
    await writeSchedulesSnapshot(pool, 'gha', 'github', entries, collectedAt);
    await writeHeartbeat(pool, 'gha', 'github', 'ok', null, null, collectedAt);
    results.gha = { ok: true, schedules: entries.length };
  } catch (e) {
    const [status, code] = classifyError(e);
    await writeHeartbeat(pool, 'gha', 'github', status, code, e.message);
    results.gha = { ok: false };
  }

  return { ok: true, results };
}
