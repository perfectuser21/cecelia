/**
 * skill_registry 任务→技能绑定（链 bf5088a3 棒7，任务 9917a588，决策 105a5868）。
 *
 * 病根：executor.getSkillForTaskType 只读硬编码 EXECUTOR_SKILL_MAP，skill_registry 只用于展示对账——
 * 账本改了执行不变（账实分叉）。本模块让 skill_registry.task_types / dispatch_command 成为运行时真身，
 * 硬编码降为兜底并在漂移时告警。设计见 docs/superpowers/specs/2026-09-25-skill-registry-binding-design.md。
 *
 * 热路径约束（派发每个任务都会走到）：
 *  - getSkillForTaskType 保持同步：读进程内快照，不逐任务查库；
 *  - 快照 TTL 60s，并发共享同一个在途查询，单次查询 800ms 超时；
 *  - 失败开放：查询抛错/超时/返回非法结构 → 保留旧快照（没有则空）、30s 退避，回落硬编码，绝不抛。
 */

export const SKILL_BINDING_TTL_MS = 60_000;
export const SKILL_BINDING_BACKOFF_MS = 30_000;
export const SKILL_BINDING_QUERY_TIMEOUT_MS = 800;

const BINDING_SQL = `SELECT name, status, task_types, dispatch_command
                       FROM skill_registry
                      WHERE cardinality(task_types) > 0 AND status <> 'planned'
                      ORDER BY name`;

/** @type {{map: Map<string,string>, conflicts: Array<{task_type:string, skills:string[]}>, loadedAt: number}|null} */
let snapshot = null;
let failedAt = 0;
let inflight = null;
const warned = new Set();
let emptyWarned = false;

export function _resetSkillBindingCacheForTest() {
  snapshot = null;
  failedAt = 0;
  inflight = null;
  warned.clear();
  emptyWarned = false;
}

function warnOnce(key, msg) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(msg);
}

/**
 * 把账本行折成 task_type→命令 映射；同一 task_type 多行认领时取 name 升序第一行并记冲突。
 * @param {Array<{name:string,status?:string,task_types?:string[],dispatch_command?:string|null}>} rows
 */
export function buildBindings(rows) {
  const map = new Map();
  const owners = new Map();
  const sorted = [...rows].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  for (const r of sorted) {
    if (!r || !r.name || r.status === 'planned' || !Array.isArray(r.task_types)) continue;
    const cmd = r.dispatch_command || `/${r.name}`;
    for (const tt of r.task_types) {
      if (!tt) continue;
      if (!map.has(tt)) map.set(tt, cmd);
      if (!owners.has(tt)) owners.set(tt, []);
      owners.get(tt).push(r.name);
    }
  }
  const conflicts = [...owners.entries()]
    .filter(([, skills]) => skills.length > 1)
    .map(([task_type, skills]) => ({ task_type, skills }));
  return { map, conflicts };
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`skill_registry query timeout ${ms}ms`)), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * 保证快照新鲜（TTL 内零查库）。永不抛错、永不长时间阻塞：失败即保留旧快照并退避。
 * @param {{query: Function}} pool
 * @param {{now?: () => number, timeoutMs?: number}} [opts]
 * @returns {Promise<void>}
 */
export async function ensureSkillBindingsFresh(pool, opts = {}) {
  const now = (opts.now || Date.now)();
  if (snapshot && now - snapshot.loadedAt < SKILL_BINDING_TTL_MS) return;
  if (failedAt && now - failedAt < SKILL_BINDING_BACKOFF_MS) return;
  if (inflight) {
    await inflight;
    return;
  }
  const timeoutMs = opts.timeoutMs ?? SKILL_BINDING_QUERY_TIMEOUT_MS;
  inflight = (async () => {
    try {
      const res = await withTimeout(Promise.resolve(pool.query(BINDING_SQL)), timeoutMs);
      if (!res || !Array.isArray(res.rows)) throw new Error('skill_registry query returned invalid result');
      const { map, conflicts } = buildBindings(res.rows);
      snapshot = { map, conflicts, loadedAt: now };
      failedAt = 0;
    } catch (err) {
      failedAt = now;
      console.warn(`[skill-binding] skill_registry 读取失败，回落硬编码 skillMap（${timeoutMs}ms 超时/退避 ${SKILL_BINDING_BACKOFF_MS}ms）: ${err.message}`);
    } finally {
      inflight = null;
    }
  })();
  await inflight;
}

/**
 * 同步解析 task_type→skill 命令：registry 优先，硬编码兜底。
 * 返回 undefined 表示两边都没有（调用方沿用 /dev 默认）。
 * @param {string} taskType
 * @param {Record<string,string>} hardcoded EXECUTOR_SKILL_MAP
 * @returns {string|undefined}
 */
export function resolveTaskTypeSkill(taskType, hardcoded) {
  const hard = hardcoded?.[taskType];
  if (!snapshot) return hard || undefined; // registry 从未读成功：静默硬编码（读取失败已在别处告警）
  const reg = snapshot.map.get(taskType);
  if (reg !== undefined) {
    if (hard && hard !== reg) {
      warnOnce(`drift:${taskType}:${reg}`,
        `[skill-binding] drift: task_type=${taskType} skill_registry=${reg} ≠ 硬编码=${hard}，以 skill_registry 为准`);
    }
    return reg;
  }
  if (hard) {
    if (snapshot.map.size === 0) {
      if (!emptyWarned) {
        emptyWarned = true;
        console.warn('[skill-binding] skill_registry 无任何 task_type 绑定（迁移 470 回填未落？），全部回落硬编码 skillMap');
      }
    } else {
      warnOnce(`missing:${taskType}`,
        `[skill-binding] skill_registry 缺 task_type=${taskType} 的绑定，回落硬编码 ${hard}`);
    }
    return hard;
  }
  return undefined;
}

/**
 * 派发入口用：skill_override 最优先（不碰库）；否则刷新快照后调用同步解析器。
 * @param {{query: Function}} pool
 * @param {{task_type?: string, payload?: object|null}} task
 * @param {(taskType: string, payload?: object) => string} syncResolver 即 executor.getSkillForTaskType
 */
export async function resolveSkillWithLedger(pool, task, syncResolver) {
  const override = task?.payload?.skill_override;
  if (override !== undefined && override !== null) return override;
  await ensureSkillBindingsFresh(pool);
  return syncResolver(task?.task_type || 'dev', task?.payload);
}

/**
 * 直接查库（不走快照）算漂移，供日报/晨报 AMBER。检测不可用返回 null。
 * missing：硬编码有非空命令而账本没有；mismatched：两边都有但不同；conflicts：多行认领同一 task_type。
 * @param {{query: Function}} pool
 * @param {Record<string,string>} hardcoded
 */
export async function detectSkillBindingDrift(pool, hardcoded) {
  try {
    const res = await pool.query(BINDING_SQL);
    if (!res || !Array.isArray(res.rows)) return null;
    const { map, conflicts } = buildBindings(res.rows);
    const missing = [];
    const mismatched = [];
    for (const [taskType, hard] of Object.entries(hardcoded || {})) {
      if (!hard) continue;
      const reg = map.get(taskType);
      if (reg === undefined) missing.push({ task_type: taskType, hardcoded: hard });
      else if (reg !== hard) mismatched.push({ task_type: taskType, registry: reg, hardcoded: hard });
    }
    return { missing, mismatched, conflicts };
  } catch (err) {
    console.warn(`[skill-binding] 漂移检测失败（非阻断）: ${err.message}`);
    return null;
  }
}

/** 漂移是否需要 AMBER。 */
export function hasSkillBindingDrift(drift) {
  return Boolean(drift && (drift.missing.length || drift.mismatched.length || drift.conflicts.length));
}

/**
 * 日报板块（复用棒 1 裸跑板块的 🟡 AMBER 形状）。drift=null（检测不可用）返回空串，不出板块。
 */
export function renderSkillBindingSection(drift) {
  if (!drift) return '';
  const lines = ['== skill 绑定漂移 =='];
  if (!hasSkillBindingDrift(drift)) {
    lines.push('skill_registry 与硬编码 skillMap 一致（无缺失/无分歧/无冲突）。');
    return lines.join('\n');
  }
  lines.push(`🟡 AMBER skill 绑定漂移：缺失 ${drift.missing.length} / 分歧 ${drift.mismatched.length} / 冲突 ${drift.conflicts.length}`);
  for (const m of drift.missing.slice(0, 20)) {
    lines.push(`  - 🟡 AMBER 缺映射 task_type=${m.task_type}（账本无绑定，走硬编码 ${m.hardcoded}）`);
  }
  for (const m of drift.mismatched.slice(0, 20)) {
    lines.push(`  - 🟡 AMBER 分歧 task_type=${m.task_type} 账本=${m.registry} ≠ 硬编码=${m.hardcoded}（以账本为准）`);
  }
  for (const c of drift.conflicts.slice(0, 20)) {
    lines.push(`  - 🟡 AMBER 冲突 task_type=${c.task_type} 被多个 skill 认领：${c.skills.join('、')}`);
  }
  return lines.join('\n');
}

/** 晨报一行（无漂移返回 null）。 */
export function renderSkillBindingLine(drift) {
  if (!hasSkillBindingDrift(drift)) return null;
  const parts = [];
  if (drift.missing.length) parts.push(`缺映射 ${drift.missing.slice(0, 3).map((m) => m.task_type).join('、')}${drift.missing.length > 3 ? ' …' : ''}`);
  if (drift.mismatched.length) parts.push(`分歧 ${drift.mismatched.length} 个`);
  if (drift.conflicts.length) parts.push(`冲突 ${drift.conflicts.length} 个`);
  return `🟡 AMBER skill 绑定漂移：${parts.join('；')}`;
}
