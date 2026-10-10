/**
 * 发布线（决策 de6dff5d 五块模型第 3 步，迁移 541）：版本、生产指针、晋级/退回事件、流程生产配方。
 *
 * 构建 = activity_definition_versions（每个 commit 一行，部署证据，不动）；版本 = activity_versions（按内容去重）。
 * 「受保护」= 该版本曾被判过收敛（everConverged）。冷启动规则（主理人硬要求）：
 *   当前生产版从未收敛 → 新内容直接成为生产版，记 bootstrap（reason=bootstrap_no_converged_baseline），不要求 N 绿、不做对比。
 *   今天裁判表里没有任何收敛，所以合同每次内容变化生产指针都跟着走，和迁移前「最新即在用」一致。
 *
 * 开关（全部可现场关）：
 *   RELEASE_LINE_SYNC_HOOK        默认 on。合同同步挂钩；off = 同步完全不碰发布线。挂钩在 SAVEPOINT 里，出错回滚到 savepoint、
 *                                 记日志 + P2，同步照常提交（fail-open）。漏掉的构建由 reconcileReleaseLine 幂等补账。
 *   RELEASE_LINE_PROTECT          默认 off（影子模式）。生产版受保护时：on = 新内容只留作候选（candidate_held）；
 *                                 off = 照样算「会被拒」记 promote_would_reject，但指针照常前进（第 4 步有候选环境前不打开）。
 *   RELEASE_LINE_AUTO_ROLLBACK    默认 advisory（只记事件 + 告警，不改指针）；on = 真退回；off = 不评估。见 release-line-rollback.js。
 *   RELEASE_LINE_ENFORCE_RELEASE  默认 off。发布时把关（release-index.js），见 releaseLineGapsForRelease。
 * 把关关闭期间「生产版」只是账面指针，不代表执行端实际跑的版本：bootstrap 下指针 = main 最新同步内容，目标机可能落后；
 * GET /activities/:id/release 同时返回各目标机最近 release 对应的版本，分叉一眼可见。
 */
import { raise as defaultRaise } from '../alerting.js';
import pg from 'pg';
import { interfaceDiff, affectedByInterfaceChange, workflowSlotsFor } from './release-line-interface.js';

const intEnv = (raw, def, min, max) => {
  const n = Number(raw);
  return raw !== undefined && raw !== '' && Number.isInteger(n) && n >= min && n <= max ? n : def;
};
export function releaseLineFlags(env = process.env) {
  const mode = String(env.RELEASE_LINE_AUTO_ROLLBACK || 'advisory').toLowerCase();
  return {
    syncHook: env.RELEASE_LINE_SYNC_HOOK !== 'off',
    protect: env.RELEASE_LINE_PROTECT === 'on',
    autoRollback: ['off', 'advisory', 'on'].includes(mode) ? mode : 'advisory',
    enforceRelease: env.RELEASE_LINE_ENFORCE_RELEASE === 'on',
    rollbackFailures: intEnv(env.RELEASE_ROLLBACK_FAILURES, 3, 1, 50),
    requiredGreen: intEnv(env.RELEASE_GATE_REQUIRED_GREEN, 5, 1, 50),
  };
}

export async function releaseLineReady(db) {
  const row = (await db.query(`SELECT to_regclass('activity_release_state') IS NOT NULL
    AND to_regclass('activity_version_builds') IS NOT NULL AND to_regclass('workflow_production_recipes') IS NOT NULL AS ok`)).rows[0];
  return Boolean(row?.ok);
}

/** 所有改指针/分配版本号的操作先拿这把锁（同步、晋级、退回串行；不碰 activities 行锁，避免和同步互等）。 */
export async function lockReleaseLine(db) {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['release-line']);
}

/**
 * 事务外壳：传 Pool 就借一条连接；传 Client / PoolClient 就直接在它上面 BEGIN/COMMIT。
 */
export async function withReleaseTx(db, fn) {
  const isClient = typeof db.release === 'function' || db instanceof pg.Client;
  const client = isClient ? db : await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    if (!isClient) client.release();
  }
}

export const fire = (fn) => { try { Promise.resolve().then(fn).catch(() => {}); } catch { /* 告警失败不影响主流程 */ } };

/** 构建 → 版本（没有就建）。调用方须持 release-line 锁。consumer_evidence 定义不进发布线 → {version:null}。 */
export async function ensureVersionForBuild(db, buildId) {
  const mapped = (await db.query(
    'SELECT v.* FROM activity_version_builds m JOIN activity_versions v ON v.id = m.activity_version_id WHERE m.build_id = $1', [buildId])).rows[0];
  if (mapped) return { version: mapped, created: false };
  const build = (await db.query(
    `SELECT id, activity_id, md5((payload - 'implementation_bindings')::text) AS content_md5,
            COALESCE(payload->>'definition_scope', '') = 'consumer_evidence' AS consumer_evidence
       FROM activity_definition_versions WHERE id = $1`, [buildId])).rows[0];
  if (!build) throw Object.assign(new Error(`build_not_found: ${buildId}`), { status: 404 });
  if (build.consumer_evidence) return { version: null, created: false };
  const find = () => db.query('SELECT * FROM activity_versions WHERE activity_id = $1 AND content_md5 = $2', [build.activity_id, build.content_md5]);
  let version = (await find()).rows[0];
  let created = false;
  if (!version) {
    // 冲突目标写明 (activity_id, content_md5)：version_no 撞号要抛出来，不能静默吞掉
    version = (await db.query(
      `INSERT INTO activity_versions (activity_id, content_md5, version_no, first_build_id)
       SELECT $1, $2, COALESCE(max(version_no), 0) + 1, $3 FROM activity_versions WHERE activity_id = $1
       ON CONFLICT (activity_id, content_md5) DO NOTHING RETURNING *`, [build.activity_id, build.content_md5, build.id])).rows[0];
    created = Boolean(version);
    version ??= (await find()).rows[0];
  }
  await db.query(
    'INSERT INTO activity_version_builds (build_id, activity_id, activity_version_id) VALUES ($1, $2, $3) ON CONFLICT (build_id) DO NOTHING',
    [build.id, build.activity_id, version.id]);
  return { version, created };
}

export async function getPointer(db, activityId, { forUpdate = false } = {}) {
  return (await db.query(
    `SELECT s.activity_id, s.production_version_id, s.updated_at, v.version_no, v.content_md5, v.first_build_id
       FROM activity_release_state s JOIN activity_versions v ON v.id = s.production_version_id
      WHERE s.activity_id = $1 ${forUpdate ? 'FOR UPDATE OF s' : ''}`, [activityId])).rows[0] ?? null;
}

/**
 * 该版本是否曾被判过收敛（受保护）。满足其一：
 * 1) 一条 converged 裁判，窗口纯净：report.window_unversioned_run_count = 0，window_version_ids 非空且全部构建属于该版本；
 *    （没有 window_unversioned_run_count 字段的旧裁判一律不算——宁可少保护，不误保护）
 * 2) 一条 promote / group_promote 事件晋级到该版本且 gate.converged = true（bootstrap / forced 永远不写 converged=true）。
 */
export async function everConverged(db, activityId, versionId) {
  if (!versionId) return false;
  const judged = (await db.query(
    `SELECT j.id FROM activity_judgments j
      WHERE j.activity_id = $1 AND j.converged
        AND j.report->'window_unversioned_run_count' = '0'::jsonb
        AND jsonb_typeof(j.report->'window_version_ids') = 'array'
        AND jsonb_array_length(j.report->'window_version_ids') > 0
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(j.report->'window_version_ids') w(build_id)
            LEFT JOIN activity_version_builds m ON m.build_id::text = w.build_id
           WHERE m.activity_version_id IS DISTINCT FROM $2)
      LIMIT 1`, [activityId, versionId])).rows[0];
  if (judged) return true;
  const promoted = (await db.query(
    `SELECT 1 FROM activity_release_events
      WHERE activity_id = $1 AND to_version_id = $2 AND kind IN ('promote', 'group_promote') AND gate->>'converged' = 'true' LIMIT 1`,
    [activityId, versionId])).rows[0];
  return Boolean(promoted);
}

const NOTICE_KINDS = new Set(['candidate_held', 'promote_would_reject']);
/** 追加一条发布线事件；候选类通知按 (Activity, kind, 候选版本) 去重，重复返回 null。 */
export async function recordEvent(db, e) {
  const conflict = NOTICE_KINDS.has(e.kind)
    ? "ON CONFLICT (activity_id, kind, to_version_id) WHERE kind IN ('candidate_held', 'promote_would_reject') DO NOTHING" : '';
  return (await db.query(
    `INSERT INTO activity_release_events (activity_id, kind, group_id, actor, reason, from_version_id, to_version_id, judgment_ids, compare_result, gate)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::bigint[], $9::jsonb, $10::jsonb) ${conflict} RETURNING *`,
    [e.activity_id, e.kind, e.group_id ?? null, e.actor, e.reason, e.from_version_id ?? null, e.to_version_id ?? null,
      e.judgment_ids ?? [], e.compare_result === undefined ? null : JSON.stringify(e.compare_result), JSON.stringify(e.gate ?? {})])).rows[0] ?? null;
}

/** 比较交换改指针：只有指针仍是 fromId 才改，返回事件；指针已被别人改过返回 null（不写事件）。 */
export async function movePointer(db, activityId, fromId, toId, event) {
  const res = await db.query(
    'UPDATE activity_release_state SET production_version_id = $3, updated_at = now() WHERE activity_id = $1 AND production_version_id = $2',
    [activityId, fromId, toId]);
  if (!res.rowCount) return null;
  return recordEvent(db, { ...event, activity_id: activityId, from_version_id: fromId, to_version_id: toId });
}

export async function setInitialPointer(db, activityId, versionId, reason, actor = 'definition_sync') {
  const res = await db.query(
    'INSERT INTO activity_release_state (activity_id, production_version_id) VALUES ($1, $2) ON CONFLICT (activity_id) DO NOTHING',
    [activityId, versionId]);
  if (!res.rowCount) return null;
  return recordEvent(db, { activity_id: activityId, kind: 'initial', actor, reason, to_version_id: versionId, gate: { converged: false } });
}

/** 接口影响：两版本合同的接口差异、受影响的上下游、其中生产版受保护的那些。 */
export async function interfaceImpact(db, activityId, fromVersion, toVersion) {
  const contracts = (await db.query(
    `SELECT v.id, b.payload->'contract' AS contract FROM activity_versions v JOIN activity_definition_versions b ON b.id = v.first_build_id
      WHERE v.id = ANY($1::uuid[])`, [[fromVersion, toVersion]])).rows;
  const of = id => contracts.find(c => c.id === id)?.contract;
  const diff = interfaceDiff(of(fromVersion), of(toVersion));
  if (!diff.changed) return { diff, affected: [] };
  const affected = affectedByInterfaceChange({ activityId, diff, workflows: await workflowSlotsFor(db, activityId) });
  const guarded = [];
  for (const a of affected) {
    const p = await getPointer(db, a.activity_id);
    if (p && await everConverged(db, a.activity_id, p.production_version_id)) guarded.push(a);
  }
  return { diff, affected, protected_affected: guarded };
}

/**
 * 合同同步挂钩：一个新写入（或复用）的构建登记到版本层，按冷启动规则决定生产指针。调用方在 SAVEPOINT 里调用。
 * @param {{activityId:string, buildId:string, inserted:boolean}} input  inserted = 本次真的新插入了构建行
 * 命中已存在构建（CI 重跑 / 重新同步旧 commit）只补映射，不碰生产指针，防止 bootstrap 指针被拨回旧内容。
 */
export async function registerActivityBuild(db, { activityId, buildId, inserted }, { env = process.env, alert = defaultRaise } = {}) {
  const flags = releaseLineFlags(env);
  await lockReleaseLine(db);
  const { version } = await ensureVersionForBuild(db, buildId);
  if (!version) return { action: 'skipped_consumer_evidence' };
  const pointer = await getPointer(db, activityId, { forUpdate: true });
  if (!pointer) {
    const event = await setInitialPointer(db, activityId, version.id, 'first_build');
    return { action: 'initial', version_id: version.id, event_id: event?.id ?? null };
  }
  if (pointer.production_version_id === version.id) return { action: 'unchanged', version_id: version.id };
  if (!inserted) return { action: 'existing_build_no_move', version_id: version.id };
  const isProtected = await everConverged(db, activityId, pointer.production_version_id);
  if (!isProtected) {
    // 冷启动：生产版从未收敛 → 新内容直接成为生产版
    const event = await movePointer(db, activityId, pointer.production_version_id, version.id, {
      kind: 'bootstrap', actor: 'definition_sync', reason: 'bootstrap_no_converged_baseline', gate: { converged: false, bootstrap: true, build_id: buildId } });
    return { action: 'bootstrap', version_id: version.id, event_id: event?.id ?? null };
  }
  const iface = await interfaceImpact(db, activityId, pointer.production_version_id, version.id);
  const gate = { converged: false, protected_baseline: true, build_id: buildId, interface: iface.diff, protected_affected: iface.protected_affected ?? [] };
  if (flags.protect) {
    const held = await recordEvent(db, { activity_id: activityId, kind: 'candidate_held', actor: 'definition_sync',
      reason: iface.protected_affected?.length ? 'interface_changed_group_promotion_required' : 'production_protected_candidate_pending',
      from_version_id: pointer.production_version_id, to_version_id: version.id, gate });
    if (held) fire(() => alert('P2', `release_line_candidate_held:${activityId}`, `Activity ${activityId} 有候选版 v${version.version_no} 待晋级（生产版 v${pointer.version_no} 受保护）`));
    return { action: 'candidate_held', version_id: version.id, event_id: held?.id ?? null };
  }
  // 影子模式：照样记「会被拒」，指针照常前进（第 4 步有候选环境前，保护不真正生效）
  await recordEvent(db, { activity_id: activityId, kind: 'promote_would_reject', actor: 'definition_sync', reason: 'protection_shadow_mode',
    from_version_id: pointer.production_version_id, to_version_id: version.id, gate });
  const event = await movePointer(db, activityId, pointer.production_version_id, version.id, {
    kind: 'bootstrap', actor: 'definition_sync', reason: 'protection_shadow_mode', gate: { ...gate, shadow: true } });
  return { action: 'shadow_advance', version_id: version.id, event_id: event?.id ?? null };
}

const RECIPE_SQL = `
  WITH r AS (
    SELECT w.id AS workflow_id,
           COALESCE(jsonb_agg(jsonb_build_object(
             'slot_key', e->>'slot_key', 'sequence_no', (e->>'sequence_no')::int, 'activity_id', e->>'activity_id',
             'activity_version_id', COALESCE(s.production_version_id, m.activity_version_id), 'content_md5', av.content_md5)
             ORDER BY (e->>'sequence_no')::int, e->>'slot_key'), '[]'::jsonb) AS recipe
      FROM workflows w JOIN workflow_definition_versions v ON v.id = w.current_definition_version_id
           CROSS JOIN LATERAL jsonb_array_elements(v.payload->'activities') e
           LEFT JOIN activity_version_builds m ON m.build_id::text = e->>'activity_version_id'
           LEFT JOIN activity_release_state s ON s.activity_id::text = e->>'activity_id'
           LEFT JOIN activity_versions av ON av.id = COALESCE(s.production_version_id, m.activity_version_id)
     WHERE w.id = $1 AND COALESCE(v.payload->>'definition_scope', '') <> 'consumer_evidence'
     GROUP BY w.id)
  INSERT INTO workflow_production_recipes (workflow_id, recipe, recipe_md5, cause, cause_event_id)
  SELECT r.workflow_id, r.recipe, md5(r.recipe::text), $2, $3 FROM r
   WHERE md5(r.recipe::text) IS DISTINCT FROM
         (SELECT recipe_md5 FROM workflow_production_recipes WHERE workflow_id = $1 ORDER BY id DESC LIMIT 1)
  RETURNING *`;

/** 流程生产配方：槽位结构跟最新合同走，每格填该 Activity 的生产版；配方变了才追加一行。调用方须持 release-line 锁。 */
export async function refreshWorkflowRecipe(db, workflowId, { cause = 'definition_sync', causeEventId = null } = {}) {
  return (await db.query(RECIPE_SQL, [workflowId, cause, causeEventId])).rows[0] ?? null;
}

/** 指针变化后重算所有引用该 Activity 的流程配方（按 id 排序）。 */
export async function refreshRecipesForActivity(db, activityId, opts = {}) {
  const workflows = (await db.query(
    'SELECT DISTINCT workflow_id FROM workflow_activity_refs WHERE activity_id = $1 AND active ORDER BY workflow_id', [activityId])).rows;
  const out = [];
  for (const { workflow_id: id } of workflows) { const row = await refreshWorkflowRecipe(db, id, opts); if (row) out.push(row); }
  return out;
}

/**
 * 同步挂钩外壳：开关 + SAVEPOINT + fail-open。发布线任何异常回滚到 savepoint，记日志 + P2，同步照常提交。
 * 调用方的事务未开（SAVEPOINT 报错）也只记日志不抛。
 */
export async function runReleaseLineHook(client, label, fn, { env = process.env, log = console, alert = defaultRaise } = {}) {
  if (!releaseLineFlags(env).syncHook) return { skipped: 'disabled' };
  let savepoint = false;
  try {
    await client.query('SAVEPOINT release_line_hook');
    savepoint = true;
    const result = (await releaseLineReady(client)) ? await fn(client) : { skipped: 'not_migrated' };
    await client.query('RELEASE SAVEPOINT release_line_hook');
    return result;
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 300);
    if (savepoint) {
      try { await client.query('ROLLBACK TO SAVEPOINT release_line_hook'); await client.query('RELEASE SAVEPOINT release_line_hook'); }
      catch (e2) { log.warn(`[release-line] 回滚 savepoint 失败: ${String(e2?.message).slice(0, 200)}`); }
    }
    log.warn(`[release-line] 同步挂钩 ${label} 失败（同步照常提交，待补账）: ${msg}`);
    fire(() => alert('P2', 'release_line_sync_hook_failed', `发布线同步挂钩失败（${label}）：${msg}`));
    return { error: msg };
  }
}

/**
 * 幂等补账：给没有映射的构建补版本、给有 current 没指针的 Activity 补初始指针、补缺失的流程配方。
 * 只补不改：已有指针一律不动。返回补了多少。
 */
export async function reconcileReleaseLine(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockReleaseLine(client);
    const builds = (await client.query(
      `SELECT b.id FROM activity_definition_versions b LEFT JOIN activity_version_builds m ON m.build_id = b.id
        WHERE m.build_id IS NULL AND COALESCE(b.payload->>'definition_scope', '') <> 'consumer_evidence'
        ORDER BY b.created_at, b.id::text LIMIT 5000`)).rows;
    for (const b of builds) await ensureVersionForBuild(client, b.id);
    const missing = (await client.query(
      `SELECT a.id, m.activity_version_id FROM activities a JOIN activity_version_builds m ON m.build_id = a.current_definition_version_id
        LEFT JOIN activity_release_state s ON s.activity_id = a.id WHERE s.activity_id IS NULL ORDER BY a.id`)).rows;
    for (const a of missing) await setInitialPointer(client, a.id, a.activity_version_id, 'reconcile_missing_pointer', 'release_line_reconcile');
    const workflows = (await client.query('SELECT id FROM workflows WHERE current_definition_version_id IS NOT NULL ORDER BY id')).rows;
    let recipes = 0;
    for (const w of workflows) if (await refreshWorkflowRecipe(client, w.id, { cause: 'reconcile' })) recipes += 1;
    await client.query('COMMIT');
    return { builds_mapped: builds.length, pointers_created: missing.length, recipes_written: recipes };
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
}

/**
 * 发布时把关（RELEASE_LINE_ENFORCE_RELEASE，默认 off）：production 环境里，release 中某 Activity 构建的内容 ≠ 该 Activity 生产版，
 * 且生产版受保护（曾收敛）→ 缺口 activity_version_not_production。开关关闭时零查询直接返回 []（今天部署链行为与迁移前一致）。
 * 开关打开时也跳过：指针为空的、生产版从未收敛的（bootstrap）、构建还没映射的；任何异常回滚到 savepoint 返回 []（fail-open）。
 */
export async function releaseLineGapsForRelease(db, environment, builds, { env = process.env, log = console } = {}) {
  if (environment !== 'production' || !releaseLineFlags(env).enforceRelease) return [];
  let savepoint = false;
  try {
    await db.query('SAVEPOINT release_line_release_check');
    savepoint = true;
    const gaps = [];
    if (await releaseLineReady(db)) {
      for (const build of builds || []) {
        const pointer = await getPointer(db, build.activity_id);
        if (!pointer || !(await everConverged(db, build.activity_id, pointer.production_version_id))) continue;
        const mapped = (await db.query('SELECT activity_version_id FROM activity_version_builds WHERE build_id = $1', [build.id])).rows[0];
        if (mapped && mapped.activity_version_id !== pointer.production_version_id) gaps.push({ code: 'activity_version_not_production',
          activity_id: build.activity_id, activity_definition_version_id: build.id, activity_version_id: mapped.activity_version_id,
          production_version_id: pointer.production_version_id });
      }
    }
    await db.query('RELEASE SAVEPOINT release_line_release_check');
    return gaps;
  } catch (e) {
    if (savepoint) await db.query('ROLLBACK TO SAVEPOINT release_line_release_check').catch(() => {});
    log.warn(`[release-line] 发布时把关出错，按无缺口放行: ${String(e?.message).slice(0, 200)}`);
    return [];
  }
}
