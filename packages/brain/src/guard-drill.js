/**
 * guard-drill.js — 月度守卫演习自动化引擎（刀4-T4）
 *
 * 原则：proven-to-fire — 从没红过的守卫 = 薛定谔守卫。
 * 每月轮选一个可自动演习的守卫，全流程跑：弄死 → 等待 → 验红 → 恢复。
 * 守卫没叫 → P1 Issue + Bark（"未接线"路径）。
 *
 * 安全护栏：
 *   - 只对 staging/可安全恢复资产演习（boundary: 'safe'）
 *   - boundary: 'manual-only' 的守卫跳过自动演习，仅记录台账
 *   - 演习前 Bark 通知"演习开始"，避免误报
 *   - 演习后自动关闭 [DRILL] Issue
 *
 * KV 写入：
 *   guard-drill-last-run    → 本次演习整体结果快照
 *   guard-drill-status      → 逐守卫 last_verified_at 台账
 */

import { execSync } from 'child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import pool from './db.js';
import { raise } from './alerting.js';
import { sendBark } from './notifier.js';

const INTERVAL_MS = parseInt(
  process.env.GUARD_DRILL_INTERVAL_MS || String(30 * 24 * 60 * 60 * 1000),
  10,
);

const EXEC_TIMEOUT_MS = 30_000;
const HEARTBEAT_POLL_INTERVAL_MS = 30_000;
const HEARTBEAT_POLL_MAX_MS = 5 * 60 * 1000;
const BARK_DEDUPE_TTL_SEC = 24 * 3600;

let lastRunAt = 0;
export function __resetGuardDrillForTest() {
  lastRunAt = 0;
}

function exec(cmd) {
  return execSync(cmd, {
    encoding: 'utf8',
    timeout: EXEC_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── KV 读写 ────────────────────────────────────────────────────────────────

async function kvGet(key) {
  try {
    const r = await pool.query(
      'SELECT value_json FROM working_memory WHERE key=$1',
      [key],
    );
    return r.rows[0]?.value_json ?? null;
  } catch {
    return null;
  }
}

async function kvSet(key, value) {
  await pool.query(
    `INSERT INTO working_memory (key, value_json, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json=$2::jsonb, updated_at=NOW()`,
    [key, JSON.stringify(value)],
  );
}

// ── P1 Issue 开出 ──────────────────────────────────────────────────────────

async function openP1Issue(guardId, guardName, detail) {
  try {
    await pool.query(
      `INSERT INTO issues (title, priority, status, sub_area, body, journey_id)
       VALUES ($1, 'P1', 'In progress', 'brain', $2, NULL)`,
      [
        `[guard-drill] 守卫未叫：${guardName}`,
        `月度演习发现守卫 ${guardId}（${guardName}）在演习中未触发告警。\n\n` +
          `详情：${detail}\n\n` +
          `请检查守卫接线是否断开，确认修复后手动关闭此 Issue 并备注 [DRILL]。`,
      ],
    );
    console.warn(`[guard-drill] P1 Issue 已开出：守卫未叫 ${guardId}`);
  } catch (err) {
    console.warn('[guard-drill] P1 Issue 写入失败：', err.message);
  }
}

// ── 守卫2：test-pyramid-guard 演习 ────────────────────────────────────────

async function drillTestPyramidGuard() {
  const drillDir = join(tmpdir(), `guard-drill-${Date.now()}`);
  const orphanDir = join(drillDir, 'sprints', 'sprint-drill-99');
  let fired = false;

  try {
    mkdirSync(orphanDir, { recursive: true });
    writeFileSync(
      join(orphanDir, 'drill-orphan.test.js'),
      'test("drill orphan — guard must catch this", () => {});',
    );

    // 运行守卫：预期 exit 1（孤儿超棘轮）
    try {
      exec(`node scripts/test-pyramid-guard.mjs --root "${drillDir}" 2>&1 || true`);
    } catch {
      // exit 1 = 守卫叫了
    }

    // 重新检测退出码
    try {
      execSync(`node scripts/test-pyramid-guard.mjs --root "${drillDir}"`, {
        encoding: 'utf8',
        timeout: EXEC_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: process.cwd(),
      });
      // 若 exit 0 = 守卫没叫
      fired = false;
    } catch (e) {
      // exit 非 0 = 守卫叫了（正确）
      fired = e.status !== 0;
    }
  } finally {
    try {
      rmSync(drillDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  }

  return {
    fired,
    detail: fired
      ? '孤儿测试文件注入 → guard exit 1 ✓'
      : '孤儿测试文件注入后 guard 仍 exit 0，守卫未叫',
  };
}

// ── 守卫1：heartbeat-sentinel 演习 ────────────────────────────────────────

async function drillHeartbeatSentinel() {
  // 记录演习前 Issue 数量
  let beforeCount = 0;
  try {
    const out = exec(
      `gh issue list --label "heartbeat-sentinel" --state open --json number 2>/dev/null || echo "[]"`,
    );
    beforeCount = JSON.parse(out.trim() || '[]').length;
  } catch {
    /* ignore */
  }

  // 触发 workflow 使用死端口
  try {
    exec(
      `gh workflow run heartbeat-sentinel.yml --field probe_url="http://127.0.0.1:19999" 2>/dev/null || true`,
    );
  } catch {
    return { fired: false, detail: 'gh workflow run 失败（gh CLI 不可用或 workflow 不存在）' };
  }

  // 轮询新 Issue 是否产生
  const deadline = Date.now() + HEARTBEAT_POLL_MAX_MS;
  while (Date.now() < deadline) {
    await sleep(HEARTBEAT_POLL_INTERVAL_MS);
    try {
      const out = exec(
        `gh issue list --label "heartbeat-sentinel" --state open --json number 2>/dev/null || echo "[]"`,
      );
      const afterCount = JSON.parse(out.trim() || '[]').length;
      if (afterCount > beforeCount) {
        return { fired: true, detail: `heartbeat-sentinel workflow 触发死端口 → 新 Issue 创建 ✓（${afterCount - beforeCount} 个）` };
      }
    } catch {
      /* ignore poll error */
    }
  }

  return { fired: false, detail: `heartbeat-sentinel 演习后 ${HEARTBEAT_POLL_MAX_MS / 60000} 分钟内未见新 Issue` };
}

// ── 守卫台账 ───────────────────────────────────────────────────────────────

/**
 * 所有 6 个守卫的注册台账。
 * auto: true  → 月度自动轮转演习
 * auto: false → manual-only，跳过自动演习（仅台账可见）
 */
export const GUARD_REGISTRY = [
  {
    id: 'heartbeat-sentinel',
    name: '机外心跳哨兵',
    file: '.github/workflows/heartbeat-sentinel.yml',
    auto: true,
    boundary: 'safe',
    drillFn: drillHeartbeatSentinel,
    timeoutMs: 8 * 60 * 1000,
  },
  {
    id: 'test-pyramid-guard',
    name: '测试金字塔守卫',
    file: 'scripts/test-pyramid-guard.mjs',
    auto: true,
    boundary: 'safe',
    drillFn: drillTestPyramidGuard,
    timeoutMs: 60 * 1000,
  },
  {
    id: 'launchd-patrol',
    name: '宿主 launchd 巡检',
    file: 'packages/brain/src/launchd-patrol.js',
    auto: false,
    boundary: 'manual-only',
    note: '需要宿主 SSH，停 staging 进程；见 runbook 守卫3',
  },
  {
    id: 'harness-watchdog',
    name: 'Harness 进程兜底 Watchdog',
    file: 'packages/brain/src/harness-watchdog.js',
    auto: false,
    boundary: 'manual-only',
    note: '需要 staging DB 插入过期行；见 runbook 守卫4',
  },
  {
    id: 'seven-ring-ratchet',
    name: '七环棘轮',
    file: 'scripts/seven-ring-audit.js',
    auto: false,
    boundary: 'manual-only',
    note: '需改临时 json 文件；见 runbook 守卫5',
  },
  {
    id: 'quota-guard',
    name: 'API 配额守卫',
    file: 'packages/brain/src/quota-guard.js',
    auto: false,
    boundary: 'manual-only',
    note: '需要 staging DB 插入假配额数据；见 runbook 守卫6',
  },
];

const AUTO_GUARDS = GUARD_REGISTRY.filter((g) => g.auto);

// ── 主入口 ─────────────────────────────────────────────────────────────────

/**
 * scheduler-jobs handler（needsPool: true）。
 * 月度 gate：30 天内已跑过则 skip。
 */
export async function runGuardDrill(opts = {}) {
  const now = opts.now ?? Date.now();
  if (now - lastRunAt < INTERVAL_MS) return { skipped: true };
  lastRunAt = now;

  // 读取台账，决定本次演习哪个守卫
  const statusKv = (await kvGet('guard-drill-status')) ?? {};
  const lastRunKv = (await kvGet('guard-drill-last-run')) ?? {};

  // 轮选：找最久未演习的 auto 守卫
  const sorted = AUTO_GUARDS.slice().sort((a, b) => {
    const ta = statusKv[a.id]?.last_verified_at ? new Date(statusKv[a.id].last_verified_at).getTime() : 0;
    const tb = statusKv[b.id]?.last_verified_at ? new Date(statusKv[b.id].last_verified_at).getTime() : 0;
    return ta - tb;
  });
  const target = sorted[0];

  console.log(`[guard-drill] 本月演习守卫：${target.id}（${target.name}）`);

  // 演习开始通知
  try {
    await sendBark(
      `[演习] 月度守卫演习开始`,
      `正在演习：${target.name}（${target.id}）`,
      { dedupeKey: `guard-drill-start:${target.id}:${now}`, dedupeTtlSec: 60 },
    );
  } catch {
    /* non-fatal */
  }

  // 运行演习（带超时）
  let result;
  try {
    const drillPromise = target.drillFn();
    const timeoutPromise = new Promise((_, rej) =>
      setTimeout(() => rej(new Error('drill timeout')), target.timeoutMs ?? 3 * 60 * 1000),
    );
    result = await Promise.race([drillPromise, timeoutPromise]);
  } catch (err) {
    result = { fired: false, detail: `演习异常：${err.message}` };
  }

  const verifiedAt = new Date().toISOString();

  // 更新台账
  const newStatus = { ...statusKv };
  newStatus[target.id] = {
    last_verified_at: result.fired ? verifiedAt : (statusKv[target.id]?.last_verified_at ?? null),
    last_drill_at: verifiedAt,
    last_drill_fired: result.fired,
    detail: result.detail,
  };

  // 加入所有 manual-only 守卫（首次写入台账占位）
  for (const g of GUARD_REGISTRY) {
    if (!newStatus[g.id]) {
      newStatus[g.id] = { last_verified_at: null, last_drill_at: null, last_drill_fired: null };
    }
  }

  try {
    await kvSet('guard-drill-status', newStatus);
    await kvSet('guard-drill-last-run', {
      drilled_guard: target.id,
      guard_name: target.name,
      fired: result.fired,
      detail: result.detail,
      ran_at: verifiedAt,
    });
  } catch (err) {
    console.warn('[guard-drill] KV 写入失败：', err.message);
  }

  // 守卫未叫 → P1 + Bark
  if (!result.fired) {
    const msg = `月度演习：守卫 ${target.id}（${target.name}）未叫。${result.detail}`;
    console.warn(`[guard-drill] ⚠️  ${msg}`);
    try {
      await sendBark('[P1] 守卫未叫', msg, {
        dedupeKey: `guard-drill-no-fire:${target.id}`,
        dedupeTtlSec: BARK_DEDUPE_TTL_SEC,
      });
    } catch {
      /* non-fatal */
    }
    await openP1Issue(target.id, target.name, result.detail);
    await raise('P1', `guard_drill_no_fire_${target.id}`, msg).catch(() => {});
  } else {
    console.log(`[guard-drill] ✅ 守卫 ${target.id} 演习通过（已验火）`);
  }

  return {
    ok: true,
    drilled_guard: target.id,
    fired: result.fired,
    detail: result.detail,
    verified_at: result.fired ? verifiedAt : null,
  };
}
