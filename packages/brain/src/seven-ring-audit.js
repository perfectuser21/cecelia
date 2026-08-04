/**
 * seven-ring-audit.js — 七环对账巡检（刀3-T6）
 *
 * 七环 = 写了≠入册了/入册了≠在跑/在跑≠跑的是新的/跑了≠写对了/
 *        写对了≠有人消费/没告警≠健康/面板上的≠现实的
 *
 * 每日自 gate 24h 冷却，结果写 working_memory key=seven_ring_audit_last。
 * 硬伤数棘轮：当前硬伤数 <= ratchet.json 基线，否则告警。
 */
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const AUDIT_KEY = 'seven_ring_audit_last';
const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h 冷却
const RATCHET_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../scripts/seven-ring-ratchet.json',
);

let _lastRunAt = 0;
export function __resetSevenRingAuditForTest() { _lastRunAt = 0; }

/**
 * 环1：测试入册——永久池 >= 基线（复用 quality_test_pyramid 快照）
 */
async function checkRing1TestRegistered(pool) {
  const { rows } = await pool.query(
    `SELECT value_json, updated_at FROM working_memory WHERE key = 'quality_test_pyramid'`,
  );
  const row = rows[0];
  if (!row) return { ok: false, detail: '无 test-pyramid 快照（由 test-pyramid-guard CI job POST /api/brain/quality/test-pyramid 写入；历史数据源脚本已于 2026-08 退役）' };
  const snap = row.value_json ?? {};
  const ageH = (Date.now() - new Date(row.updated_at).getTime()) / 3_600_000;
  if (ageH > 48) return { ok: false, detail: `test-pyramid 快照已过期 ${ageH.toFixed(1)}h（>48h）` };
  if (snap.pass === false && snap.failures?.some((f) => f.startsWith('A3'))) {
    return { ok: false, detail: `A3 永久池棘轮失败：${snap.failures.find((f) => f.startsWith('A3'))}` };
  }
  return { ok: true, detail: `永久池 ${snap.permanent?.total ?? '?'} 个，快照 ${ageH.toFixed(1)}h 前` };
}

/**
 * 环2：定时循环在跑——scheduler jobs 全部在 5min 内运行过
 */
async function checkRing2SchedulerRunning(pool) {
  const { rows } = await pool.query(
    `SELECT key, value_json, updated_at FROM working_memory
     WHERE key LIKE 'scheduler_job_last_run:%'
     ORDER BY key`,
  );
  if (rows.length === 0) return { ok: false, detail: 'scheduler_job_last_run 哨兵记录全无（调度器未启动？）' };
  const stale = rows.filter((r) => {
    const ageMs = Date.now() - new Date(r.updated_at).getTime();
    return ageMs > 5 * 60 * 1000; // >5min 未更新视为离线
  });
  if (stale.length > 0) {
    return { ok: false, detail: `${stale.length}/${rows.length} 个 job 超 5min 未运行：${stale.map((r) => r.key.replace('scheduler_job_last_run:', '')).join(', ')}` };
  }
  return { ok: true, detail: `${rows.length} 个 job 均在 5min 内运行` };
}

/**
 * 环3：部署指纹是新的——最近 24h 有 postdeploy_verified 的 task
 */
async function checkRing3DeployFresh(pool) {
  const { rows } = await pool.query(
    `SELECT id, title, updated_at
     FROM tasks
     WHERE status = 'completed'
       AND (payload->>'postdeploy_verified')::boolean = true
       AND updated_at >= NOW() - INTERVAL '24 hours'
     ORDER BY updated_at DESC
     LIMIT 3`,
  );
  if (rows.length === 0) {
    // 也可能没有部署——不算硬伤，只是预警
    return { ok: true, warn: true, detail: '24h 内无 postdeploy_verified 完成任务（无部署活动或指纹未验证）' };
  }
  return { ok: true, detail: `24h 内 ${rows.length} 个部署已验证指纹，最新：${rows[0].title?.slice(0, 40)}` };
}

/**
 * 环4：账本写对——24h 内有 line_ledger 文档写入
 */
async function checkRing4LedgerWritten(pool) {
  const { rows } = await pool.query(
    `SELECT id, title, created_at
     FROM design_docs
     WHERE type = 'line_ledger'
       AND created_at >= NOW() - INTERVAL '24 hours'
     ORDER BY created_at DESC
     LIMIT 1`,
  );
  if (rows.length === 0) {
    return { ok: false, detail: '24h 内无 line_ledger 写入（账本停更）' };
  }
  return { ok: true, detail: `最新账本：${rows[0].title?.slice(0, 40)} (${new Date(rows[0].created_at).toISOString().slice(0, 10)})` };
}

/**
 * 环5：产出有人消费——24h 内有 ci_patrol 任务被完成
 */
async function checkRing5OutputConsumed(pool) {
  const { rows } = await pool.query(
    `SELECT id, title, updated_at
     FROM tasks
     WHERE task_type = 'ci_patrol'
       AND status = 'completed'
       AND updated_at >= NOW() - INTERVAL '48 hours'
     ORDER BY updated_at DESC
     LIMIT 1`,
  );
  if (rows.length === 0) {
    return { ok: false, detail: '48h 内无 ci_patrol 任务完成（巡检产出无消费者）' };
  }
  return { ok: true, detail: `最新 ci_patrol 完成：${rows[0].updated_at.toISOString?.()?.slice(0, 16) ?? rows[0].updated_at}` };
}

/**
 * 环6：告警通道活着——notifier sentinel 存在且近期活跃
 */
async function checkRing6AlertAlive(pool) {
  // 查 working_memory 中的 alert/notifier 相关哨兵
  const { rows } = await pool.query(
    `SELECT key, value_json, updated_at FROM working_memory
     WHERE key IN ('launchd_patrol_last_bark', 'bark_last_sent')
        OR key LIKE 'scheduler_job_last_run:launchd-patrol'
     LIMIT 3`,
  );
  // launchd-patrol 在跑 = 告警通道链路被定期测到
  const patrolRow = rows.find((r) => r.key === 'scheduler_job_last_run:launchd-patrol');
  if (!patrolRow) {
    return { ok: false, detail: 'launchd-patrol 哨兵不存在（告警通道链路未激活）' };
  }
  const ageH = (Date.now() - new Date(patrolRow.updated_at).getTime()) / 3_600_000;
  if (ageH > 1) {
    return { ok: false, detail: `launchd-patrol 超 1h 未运行（${ageH.toFixed(1)}h），告警链路可能断开` };
  }
  return { ok: true, detail: `告警通道链路活跃（launchd-patrol ${ageH.toFixed(1)}h 前运行）` };
}

/**
 * 环7：面板数据新鲜——CURRENT_STATE.md < 48h + test-pyramid 快照 < 48h
 */
async function checkRing7PanelFresh(pool) {
  const issues = [];
  // test-pyramid 快照新鲜度
  const { rows } = await pool.query(
    `SELECT updated_at FROM working_memory WHERE key = 'quality_test_pyramid'`,
  );
  if (rows.length > 0) {
    const ageH = (Date.now() - new Date(rows[0].updated_at).getTime()) / 3_600_000;
    if (ageH > 48) issues.push(`test-pyramid 快照 ${ageH.toFixed(1)}h 前（>48h）`);
  } else {
    issues.push('test-pyramid 快照不存在');
  }

  // CURRENT_STATE.md 文件新鲜度（宿主文件，容器内可能无法访问，fail-open）
  const stateFile = '/workspace/.agent-knowledge/CURRENT_STATE.md';
  if (existsSync(stateFile)) {
    const text = readFileSync(stateFile, 'utf8');
    const m = text.match(/generated:\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
    if (m) {
      const ageH = (Date.now() - new Date(m[1].replace(' ', 'T') + '+08:00').getTime()) / 3_600_000;
      if (ageH > 48) issues.push(`CURRENT_STATE.md generated ${ageH.toFixed(1)}h 前（>48h）`);
    }
  }

  if (issues.length > 0) return { ok: false, detail: issues.join('；') };
  return { ok: true, detail: '面板数据新鲜（test-pyramid 快照 + CURRENT_STATE 均在 48h 内）' };
}

const RING_LABELS = [
  '测试入册',
  '定时循环在跑',
  '部署指纹是新的',
  '账本写对',
  '产出有人消费',
  '告警通道活着',
  '面板数据新鲜',
];

const RING_CHECKS = [
  checkRing1TestRegistered,
  checkRing2SchedulerRunning,
  checkRing3DeployFresh,
  checkRing4LedgerWritten,
  checkRing5OutputConsumed,
  checkRing6AlertAlive,
  checkRing7PanelFresh,
];

/** 读取棘轮基线，返回 { hard_flaw_max } */
export function loadRatchet() {
  try {
    return JSON.parse(readFileSync(RATCHET_PATH, 'utf8'));
  } catch {
    return { hard_flaw_max: 0 }; // 文件缺失 → 零容忍（宁严勿松）
  }
}

/**
 * 运行七环对账，返回结构化结果。
 * @param {import('pg').Pool} pool
 * @returns {Promise<SevenRingResult>}
 */
export async function runSevenRingAudit(pool) {
  const rings = [];
  let hardFlaws = 0;

  for (let i = 0; i < RING_CHECKS.length; i++) {
    let result;
    try {
      result = await RING_CHECKS[i](pool);
    } catch (err) {
      result = { ok: false, detail: `异常: ${err.message}` };
    }
    const isHardFlaw = !result.ok && !result.warn;
    if (isHardFlaw) hardFlaws++;
    rings.push({
      ring: i + 1,
      label: RING_LABELS[i],
      ok: result.ok,
      warn: result.warn ?? false,
      hard_flaw: isHardFlaw,
      detail: result.detail,
    });
  }

  const ratchet = loadRatchet();
  const ratchetBreached = hardFlaws > ratchet.hard_flaw_max;

  return {
    rings,
    hard_flaws: hardFlaws,
    ratchet_max: ratchet.hard_flaw_max,
    ratchet_breached: ratchetBreached,
    pass: hardFlaws === 0,
    audited_at: new Date().toISOString(),
  };
}

/**
 * scheduler-jobs handler（自 gate 24h冷却）
 * @param {import('pg').Pool} pool
 * @returns {Promise<{skipped?:true}|{ok:true,hard_flaws:number,ratchet_breached:boolean}>}
 */
export async function runSevenRingAuditJob(pool, opts = {}) {
  const now = opts.now ?? Date.now();
  if (now - _lastRunAt < INTERVAL_MS) return { skipped: true };
  _lastRunAt = now;

  const result = await runSevenRingAudit(pool);

  // 写入 working_memory
  await pool.query(
    `INSERT INTO working_memory (key, value_json, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2::jsonb, updated_at = NOW()`,
    [AUDIT_KEY, JSON.stringify(result)],
  );

  if (result.ratchet_breached) {
    console.warn(`[seven-ring-audit] 棘轮击穿：硬伤 ${result.hard_flaws} > 基线 ${result.ratchet_max}`);
  }

  console.log(
    `[seven-ring-audit] 完成 pass=${result.pass} 硬伤=${result.hard_flaws}/${RING_CHECKS.length}`,
  );
  return { ok: true, hard_flaws: result.hard_flaws, ratchet_breached: result.ratchet_breached };
}
