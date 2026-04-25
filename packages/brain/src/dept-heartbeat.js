/**
 * dept-heartbeat.js
 *
 * 部门主管 Heartbeat 管理
 *
 * Cecelia 主 Tick（每 5 分钟）调用 triggerDeptHeartbeats()，
 * 为每个活跃部门创建一个 dept_heartbeat task。
 * 部门主管（repo-lead skill）在对应 repo 目录下被唤醒，
 * 自主完成本部门的调度、日报和提案。
 *
 * 防重复设计：如果该部门已有 queued/in_progress 的 heartbeat task，跳过。
 */

/**
 * 查询所有 enabled=true 的部门配置
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array<{dept_name: string, max_llm_slots: number, repo_path: string}>>}
 */
export async function getEnabledDepts(pool) {
  const { rows } = await pool.query(
    `SELECT dept_name, max_llm_slots, repo_path
     FROM dept_configs
     WHERE enabled = true
     ORDER BY dept_name`
  );
  return rows;
}

/**
 * 查询部门对应的主要 goal_id（用于 heartbeat 任务绑定到正确的 goal，使其可被 dispatchNextTask 派发）
 * @param {import('pg').Pool} pool
 * @param {string} dept_name
 * @returns {Promise<string|null>} goal_id 或 null（无匹配时降级）
 */
export async function lookupDeptPrimaryGoal(pool, dept_name) {
  try {
    // 新 OKR 表：key_results 和 objectives 都有 metadata 字段（UUID 与旧 goals 相同）
    const { rows } = await pool.query(
      `SELECT id, created_at FROM key_results
       WHERE metadata->>'dept' = $1
         AND status NOT IN ('completed', 'cancelled', 'canceled')
       UNION ALL
       SELECT id, created_at FROM objectives
       WHERE metadata->>'dept' = $1
         AND status NOT IN ('completed', 'cancelled', 'canceled')
       ORDER BY created_at ASC
       LIMIT 1`,
      [dept_name]
    );
    return rows.length > 0 ? rows[0].id : null;
  } catch {
    return null;
  }
}

/**
 * 为指定部门创建 heartbeat task（幂等：已有活跃 heartbeat 则跳过）
 * @param {import('pg').Pool} pool
 * @param {{ dept_name: string, repo_path: string, max_llm_slots: number }} dept
 * @returns {Promise<{ created: boolean, task_id?: string, reason?: string }>}
 */
export async function createDeptHeartbeatTask(pool, dept) {
  const { dept_name, repo_path, max_llm_slots } = dept;

  // 检查是否已有活跃 heartbeat（防重复）
  const { rows: existing } = await pool.query(
    `SELECT id FROM tasks
     WHERE task_type = 'dept_heartbeat'
       AND dept = $1
       AND status IN ('queued', 'in_progress', 'quarantined')
     LIMIT 1`,
    [dept_name]
  );

  if (existing.length > 0) {
    return { created: false, reason: 'already_active', task_id: existing[0].id };
  }

  // 查询部门主要 goal_id，确保 heartbeat 任务可被 dispatchNextTask 派发
  const goalId = await lookupDeptPrimaryGoal(pool, dept_name);
  const description = `[dept-heartbeat] ${dept_name}: analyze OKR progress and report to Cecelia`;

  // 插入新 heartbeat task
  const { rows } = await pool.query(
    `INSERT INTO tasks (
       title, description, task_type, status, priority,
       dept, created_by, goal_id,
       payload, trigger_source, location
     )
     VALUES (
       $1, $2, 'dept_heartbeat', 'queued', 'P1',
       $3, 'cecelia-brain', $4,
       $5, 'brain_auto', 'us'
     )
     RETURNING id`,
    [
      `[heartbeat] ${dept_name}`,
      description,
      dept_name,
      goalId,
      JSON.stringify({ dept_name, repo_path, max_llm_slots }),
    ]
  );

  const task_id = rows[0].id;
  console.log(`[dept-heartbeat] Created heartbeat task ${task_id} for dept=${dept_name} goal_id=${goalId}`);
  return { created: true, task_id };
}

/**
 * 为所有活跃部门触发 heartbeat（Tick 末尾调用）
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ triggered: number, skipped: number, results: Array }>}
 */
export async function triggerDeptHeartbeats(pool) {
  let triggered = 0;
  let skipped = 0;
  const results = [];

  try {
    const depts = await getEnabledDepts(pool);

    for (const dept of depts) {
      const result = await createDeptHeartbeatTask(pool, dept);
      results.push({ dept: dept.dept_name, ...result });

      if (result.created) {
        triggered++;
      } else {
        skipped++;
      }
    }
  } catch (err) {
    console.error('[dept-heartbeat] triggerDeptHeartbeats error:', err.message);
  }

  if (triggered > 0) {
    console.log(`[dept-heartbeat] Triggered ${triggered} heartbeats, skipped ${skipped}`);
  }

  return { triggered, skipped, results };
}

// ─────────────────────────────────────────────────────────────────────────
// Phase D1.7c-plugin1: tick(now, tickState) plugin 接口
//
// 替代 tick-runner.js Step 9 内联 dept-heartbeat 触发。
// 行为保持一致：CONSCIOUSNESS_ENABLED=false 时跳过；
// 否则调用 triggerDeptHeartbeats(pool)。错误吞掉，不抛。
// 返回值兼容老 caller 的 deptHeartbeatResult shape。
// ─────────────────────────────────────────────────────────────────────────

const SKIPPED_RESULT = Object.freeze({ triggered: 0, skipped: 0, results: [] });

/**
 * Plugin tick: 触发部门 heartbeat（每 Tick 末尾调用）
 *
 * @param {Date} _now - 当前时间（plugin 接口标准签名，本插件未使用）
 * @param {object} _tickState - tick-state 单例（本插件无节流计时器）
 * @param {object} [opts]
 * @param {import('pg').Pool} [opts.pool] - 注入 pool，未传则从 db.js 动态导入
 * @returns {Promise<{triggered:number, skipped:number, results:Array}>}
 */
export async function tick(_now, _tickState, opts = {}) {
  // 守卫：意识关闭时不触发任何部门 heartbeat（避免噪音干扰手动验证）
  let isConsciousnessEnabled;
  try {
    ({ isConsciousnessEnabled } = await import('./consciousness-guard.js'));
  } catch {
    // 守护模块加载失败时保守跳过
    return { ...SKIPPED_RESULT };
  }
  if (!isConsciousnessEnabled()) {
    return { ...SKIPPED_RESULT };
  }

  let pool = opts.pool;
  if (!pool) {
    const mod = await import('./db.js');
    pool = mod.default;
  }

  try {
    return await triggerDeptHeartbeats(pool);
  } catch (deptErr) {
    console.error('[tick] dept heartbeat error:', deptErr.message);
    return { ...SKIPPED_RESULT };
  }
}
