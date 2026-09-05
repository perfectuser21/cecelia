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
