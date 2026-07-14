/**
 * seven-ring-audit.js — 刀3-T6 七环对账巡检
 *
 * 七环 = 入册了/在跑/指纹新/账本对/有人消费/告警活/面板新鲜。
 * 每次运行读 working_memory + DB 快照，逐环核对，结果写回
 * working_memory(key=seven_ring_audit_last)，供 /api/brain/kv/seven-ring-audit-last 查询。
 *
 * 硬伤：ring.ok=false 的环数量（棘轮：只许降不许升）。
 * 棘轮基线文件：scripts/seven-ring-audit-ratchet.json。
 */

import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import fs from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RATCHET_FILE = join(__dirname, '..', '..', '..', 'scripts', 'seven-ring-audit-ratchet.json');

const AUDIT_KEY = 'seven_ring_audit_last';

/** 最大允许的 sentinel 年龄（判断"在跑"）：48 小时 */
const MAX_SENTINEL_AGE_MS = 48 * 60 * 60 * 1000;

/** 最大允许的 test-pyramid 数据年龄（判断"有人消费"/"面板新鲜"）：26 小时 */
const MAX_PYRAMID_AGE_MS = 26 * 60 * 60 * 1000;

/** 最大允许的 ledger 数据年龄（账本写对）：26 小时 */
const MAX_LEDGER_AGE_MS = 26 * 60 * 60 * 1000;

async function readWorkingMemory(pool, key) {
  try {
    const { rows } = await pool.query(
      'SELECT value_json, updated_at FROM working_memory WHERE key = $1',
      [key],
    );
    if (!rows[0]) return null;
    return { data: rows[0].value_json, updated_at: rows[0].updated_at };
  } catch {
    return null;
  }
}

/**
 * 环1：测试入册 — permanent pool 大于 0 且 test-pyramid guard 在 26h 内更新。
 */
async function checkRing1Registered(pool) {
  const mem = await readWorkingMemory(pool, 'quality_test_pyramid');
  if (!mem) {
    return { ring: 1, label: '测试入册', ok: false, detail: 'quality_test_pyramid 未写入' };
  }
  const ageMs = Date.now() - new Date(mem.updated_at).getTime();
  const permanent = mem.data?.permanent?.total ?? 0;
  if (permanent === 0) {
    return { ring: 1, label: '测试入册', ok: false, detail: 'permanent pool = 0' };
  }
  if (ageMs > MAX_PYRAMID_AGE_MS) {
    return {
      ring: 1, label: '测试入册', ok: false,
      detail: `pyramid 数据过旧（${Math.round(ageMs / 3600000)}h 前）`,
    };
  }
  return {
    ring: 1, label: '测试入册', ok: true,
    detail: `permanent=${permanent}，数据 ${Math.round(ageMs / 3600000)}h 前`,
  };
}

/**
 * 环2：定时循环在跑 — ci-patrol sentinel 在 48h 内更新。
 */
async function checkRing2CiRunning(pool) {
  const mem = await readWorkingMemory(pool, 'scheduler_job_last_run:ci-patrol');
  if (!mem) {
    return { ring: 2, label: '定时循环在跑', ok: false, detail: 'ci-patrol sentinel 未找到' };
  }
  const ageMs = Date.now() - new Date(mem.updated_at).getTime();
  if (ageMs > MAX_SENTINEL_AGE_MS) {
    return {
      ring: 2, label: '定时循环在跑', ok: false,
      detail: `ci-patrol 最后运行 ${Math.round(ageMs / 3600000)}h 前（超过 48h）`,
    };
  }
  return {
    ring: 2, label: '定时循环在跑', ok: true,
    detail: `ci-patrol ${Math.round(ageMs / 3600000)}h 前运行`,
  };
}

/**
 * 环3：部署指纹是新的 — postdeploy-verifier sentinel 在 48h 内 ok=true。
 */
async function checkRing3Fingerprint(pool) {
  const mem = await readWorkingMemory(pool, 'scheduler_job_last_run:postdeploy-verifier');
  if (!mem) {
    return { ring: 3, label: '部署指纹新', ok: false, detail: 'postdeploy-verifier sentinel 未找到' };
  }
  const ageMs = Date.now() - new Date(mem.updated_at).getTime();
  if (ageMs > MAX_SENTINEL_AGE_MS) {
    return {
      ring: 3, label: '部署指纹新', ok: false,
      detail: `postdeploy-verifier 最后运行 ${Math.round(ageMs / 3600000)}h 前（超过 48h）`,
    };
  }
  const lastOk = mem.data?.ok === true;
  if (!lastOk) {
    return { ring: 3, label: '部署指纹新', ok: false, detail: 'postdeploy-verifier 最后一跑 ok=false' };
  }
  return {
    ring: 3, label: '部署指纹新', ok: true,
    detail: `postdeploy-verifier ${Math.round(ageMs / 3600000)}h 前成功`,
  };
}

/**
 * 环4：账本写对 — ledger-hygiene sentinel 在 26h 内更新。
 */
async function checkRing4Ledger(pool) {
  const mem = await readWorkingMemory(pool, 'scheduler_job_last_run:ledger-hygiene');
  if (!mem) {
    return { ring: 4, label: '账本写对', ok: false, detail: 'ledger-hygiene sentinel 未找到' };
  }
  const ageMs = Date.now() - new Date(mem.updated_at).getTime();
  if (ageMs > MAX_LEDGER_AGE_MS) {
    return {
      ring: 4, label: '账本写对', ok: false,
      detail: `ledger-hygiene 最后运行 ${Math.round(ageMs / 3600000)}h 前（超过 26h）`,
    };
  }
  const lastOk = mem.data?.ok === true;
  if (!lastOk) {
    return { ring: 4, label: '账本写对', ok: false, detail: 'ledger-hygiene 最后一跑 ok=false' };
  }
  return {
    ring: 4, label: '账本写对', ok: true,
    detail: `ledger-hygiene ${Math.round(ageMs / 3600000)}h 前成功`,
  };
}

/**
 * 环5：产出有人消费 — battle-report sentinel 在 26h 内更新（证明日报在消费账本）。
 */
async function checkRing5Consumed(pool) {
  const mem = await readWorkingMemory(pool, 'scheduler_job_last_run:battle-report');
  if (!mem) {
    return { ring: 5, label: '产出有人消费', ok: false, detail: 'battle-report sentinel 未找到' };
  }
  const ageMs = Date.now() - new Date(mem.updated_at).getTime();
  if (ageMs > MAX_PYRAMID_AGE_MS) {
    return {
      ring: 5, label: '产出有人消费', ok: false,
      detail: `battle-report 最后运行 ${Math.round(ageMs / 3600000)}h 前（超过 26h）`,
    };
  }
  return {
    ring: 5, label: '产出有人消费', ok: true,
    detail: `battle-report ${Math.round(ageMs / 3600000)}h 前生成`,
  };
}

/**
 * 环6：告警通道活着 — alertness 表有记录 + level 可读。
 */
async function checkRing6Alerting(pool) {
  try {
    const { rows } = await pool.query(
      `SELECT level, updated_at FROM alertness ORDER BY updated_at DESC LIMIT 1`,
    );
    if (!rows[0]) {
      return { ring: 6, label: '告警通道活', ok: false, detail: 'alertness 表无记录' };
    }
    const ageMs = Date.now() - new Date(rows[0].updated_at).getTime();
    if (ageMs > MAX_SENTINEL_AGE_MS) {
      return {
        ring: 6, label: '告警通道活', ok: false,
        detail: `alertness 最后更新 ${Math.round(ageMs / 3600000)}h 前`,
      };
    }
    return {
      ring: 6, label: '告警通道活', ok: true,
      detail: `alertness level=${rows[0].level}，${Math.round(ageMs / 3600000)}h 前`,
    };
  } catch (err) {
    return { ring: 6, label: '告警通道活', ok: false, detail: `alertness 查询失败: ${err.message}` };
  }
}

/**
 * 环7：面板数据新鲜 — test-pyramid panel.fresh=true 且 quality 数据在 26h 内。
 */
async function checkRing7PanelFresh(pool) {
  const mem = await readWorkingMemory(pool, 'quality_test_pyramid');
  if (!mem) {
    return { ring: 7, label: '面板数据新鲜', ok: false, detail: 'quality_test_pyramid 未写入' };
  }
  const ageMs = Date.now() - new Date(mem.updated_at).getTime();
  if (ageMs > MAX_PYRAMID_AGE_MS) {
    return {
      ring: 7, label: '面板数据新鲜', ok: false,
      detail: `pyramid 数据 ${Math.round(ageMs / 3600000)}h 前（超过 26h）`,
    };
  }
  const panelFresh = mem.data?.panel?.fresh === true;
  if (!panelFresh) {
    return {
      ring: 7, label: '面板数据新鲜', ok: false,
      detail: 'panel.fresh=false（CURRENT_STATE.md 过旧或未生成）',
    };
  }
  return {
    ring: 7, label: '面板数据新鲜', ok: true,
    detail: `panel 生成于 ${mem.data?.panel?.generated ?? '?'}`,
  };
}

/**
 * 读取棘轮基线（硬伤数上限）。首次无文件返回 null（表示本次是首跑，建立基线）。
 */
export function readRatchet() {
  try {
    const raw = fs.readFileSync(RATCHET_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 写棘轮基线（写入当前硬伤数作为基线上限）。
 */
export function writeRatchet(hardDefects) {
  try {
    fs.writeFileSync(RATCHET_FILE, JSON.stringify({ hard_defects: hardDefects, updated_at: new Date().toISOString() }, null, 2));
  } catch (err) {
    console.warn('[seven-ring-audit] ratchet 写入失败:', err.message);
  }
}

/**
 * 执行七环对账，返回完整结果对象。
 * @param {import('pg').Pool} pool
 * @returns {Promise<SevenRingAuditResult>}
 */
export async function runSevenRingAudit(pool) {
  const rings = await Promise.all([
    checkRing1Registered(pool),
    checkRing2CiRunning(pool),
    checkRing3Fingerprint(pool),
    checkRing4Ledger(pool),
    checkRing5Consumed(pool),
    checkRing6Alerting(pool),
    checkRing7PanelFresh(pool),
  ]);

  const hardDefects = rings.filter((r) => !r.ok).length;
  const ratchet = readRatchet();
  let ratchetBreached = false;
  let ratchetBaseline = null;

  if (ratchet === null) {
    // 首跑：建立基线
    writeRatchet(hardDefects);
    ratchetBaseline = hardDefects;
  } else {
    ratchetBaseline = ratchet.hard_defects;
    if (hardDefects > ratchet.hard_defects) {
      ratchetBreached = true;
      console.error(
        `[seven-ring-audit] ❌ 棘轮击穿：hard_defects=${hardDefects} > baseline=${ratchet.hard_defects}`,
      );
    } else if (hardDefects < ratchet.hard_defects) {
      // 改善：更新基线
      writeRatchet(hardDefects);
      ratchetBaseline = hardDefects;
      console.log(`[seven-ring-audit] ✅ 棘轮改善：hard_defects ${ratchet.hard_defects} → ${hardDefects}`);
    }
  }

  const result = {
    audited_at: new Date().toISOString(),
    rings,
    hard_defects: hardDefects,
    ratchet_baseline: ratchetBaseline,
    ratchet_breached: ratchetBreached,
    pass: !ratchetBreached && hardDefects === 0,
  };

  // 落 working_memory
  try {
    await pool.query(
      `INSERT INTO working_memory(key, value_json, updated_at)
       VALUES($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value_json = $2::jsonb, updated_at = NOW()`,
      [AUDIT_KEY, JSON.stringify(result)],
    );
  } catch (err) {
    console.error('[seven-ring-audit] working_memory 写入失败:', err.message);
  }

  const okCount = rings.filter((r) => r.ok).length;
  console.log(
    `[seven-ring-audit] 完成：${okCount}/7 环通过，硬伤=${hardDefects}，棘轮击穿=${ratchetBreached}`,
  );
  return result;
}

/** 内部节流：两次运行最小间隔 20 分钟 */
const MIN_INTERVAL_MS = 20 * 60 * 1000;
let _lastRunAt = 0;

/**
 * 带节流的对外 tick-job 入口（供 scheduler-jobs.js 调用）。
 * @param {import('pg').Pool} pool
 */
export async function maybeRunSevenRingAudit(pool) {
  const now = Date.now();
  if (now - _lastRunAt < MIN_INTERVAL_MS) {
    return { skipped: true, reason: 'throttled' };
  }
  _lastRunAt = now;
  return runSevenRingAudit(pool);
}
