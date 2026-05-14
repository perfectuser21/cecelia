/**
 * kr3-progress-calculator.js
 *
 * 基于 decisions 表里程碑事件计算 KR3 真实进度。
 * 替代原先"手工写入 key_results.progress"的方案，确保进度数字驱动自外部可验证事件。
 *
 * 里程碑权重表（累计）：
 *   代码就绪（PR#2329-#2359 已合）  60%  — 永远 true
 *   云函数生产部署                  +10% → 70%
 *   内测启动                        +5%  → 75%
 *   真机 bug 清单清零               +3%  → 78%
 *   体验版提交                      +5%  → 83%
 *   审核通过                        +12% → 95%
 *   WX Pay 商户号 + 支付二期         +5%  → 100%
 *
 * 设计约束：
 *   - 函数签名兼容无参调用（内部 import db.js）
 *   - 返回 { progress_pct, stage, breakdown } 不抛出（DB 失败 → 返回 base 60%）
 */

/** decisions 表 topic 常量 */
export const KR3_MILESTONE_KEYS = {
  CLOUD_FUNCTIONS_DEPLOYED: 'kr3_cloud_functions_deployed',
  INTERNAL_TEST_STARTED:    'kr3_internal_test_started',
  REAL_DEVICE_BUGS_CLEARED: 'kr3_real_device_bugs_cleared',
  TRIAL_VERSION_SUBMITTED:  'kr3_trial_version_submitted',
  AUDIT_PASSED:             'kr3_audit_passed',
  WX_PAY_CONFIGURED:        'kr3_wx_pay_configured',
};

/**
 * 里程碑定义：按顺序叠加权重。
 * BASE_PCT 是代码已就绪的基础分，后续每个里程碑叠加。
 */
const BASE_PCT = 60;

const MILESTONES = [
  { key: KR3_MILESTONE_KEYS.CLOUD_FUNCTIONS_DEPLOYED, label: '云函数生产部署', weight: 10 },
  { key: KR3_MILESTONE_KEYS.INTERNAL_TEST_STARTED,    label: '内测启动',        weight: 5  },
  { key: KR3_MILESTONE_KEYS.REAL_DEVICE_BUGS_CLEARED, label: '真机 bug 清零',   weight: 3  },
  { key: KR3_MILESTONE_KEYS.TRIAL_VERSION_SUBMITTED,  label: '体验版提交',      weight: 5  },
  { key: KR3_MILESTONE_KEYS.AUDIT_PASSED,             label: '审核通过',        weight: 12 },
  { key: KR3_MILESTONE_KEYS.WX_PAY_CONFIGURED,        label: 'WX Pay 商户号',   weight: 5  },
];

/**
 * 查询 KR3 里程碑完成情况。
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<Record<string, boolean>>}
 */
async function fetchMilestoneFlags(pool) {
  const keys = Object.values(KR3_MILESTONE_KEYS);
  const { rows } = await pool.query(
    `SELECT topic FROM decisions WHERE topic = ANY($1) AND status = 'active'`,
    [keys]
  );
  const completed = new Set(rows.map(r => r.topic));
  return Object.fromEntries(keys.map(k => [k, completed.has(k)]));
}

/**
 * 计算 KR3 当前进度。
 *
 * @param {import('pg').Pool} [dbPool] - 省略时内部 import db.js
 * @returns {Promise<{
 *   progress_pct: number,
 *   stage: string,
 *   breakdown: Record<string, { done: boolean, weight: number }>,
 * }>}
 */
export async function calculate(dbPool) {
  if (!dbPool) {
    dbPool = (await import('./db.js')).default;
  }

  let flags;
  try {
    flags = await fetchMilestoneFlags(dbPool);
  } catch {
    return { progress_pct: BASE_PCT, stage: 'code_ready', breakdown: {} };
  }

  let pct = BASE_PCT;
  let stage = 'code_ready';
  const breakdown = { code_ready: { done: true, weight: BASE_PCT } };

  for (const ms of MILESTONES) {
    const done = !!flags[ms.key];
    breakdown[ms.key] = { done, weight: ms.weight, label: ms.label };
    if (done) {
      pct += ms.weight;
      stage = ms.key;
    }
  }

  return { progress_pct: pct, stage, breakdown };
}

/**
 * 写回 key_results.progress（+ progress_pct）给 KR3 行。
 *
 * @param {import('pg').Pool} pool
 * @param {number} pct
 * @returns {Promise<boolean>} 是否写入成功
 */
export async function writeProgressToKR(pool, pct) {
  const { rowCount } = await pool.query(
    `UPDATE key_results
     SET progress = $1, progress_pct = $1, updated_at = NOW()
     WHERE (title ILIKE '%小程序%' OR title ILIKE '%KR3%')
       AND status IN ('active','in_progress','ready','decomposing')`,
    [pct]
  );
  return rowCount > 0;
}

/**
 * 便捷：计算并立即写回 DB。
 *
 * @param {import('pg').Pool} [dbPool]
 * @returns {Promise<{ progress_pct: number, stage: string, written: boolean }>}
 */
export async function calculateAndWrite(dbPool) {
  if (!dbPool) {
    dbPool = (await import('./db.js')).default;
  }
  const result = await calculate(dbPool);
  const written = await writeProgressToKR(dbPool, result.progress_pct);
  return { ...result, written };
}
