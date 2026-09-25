/**
 * 任务依赖单一写口。链 bf5088a3 棒5 · 任务 3fad28e0
 *
 * 依赖曾散在三处写：harness-dag 直 INSERT task_dependencies、proposal.js 直写 payload.depends_on、
 * 建单入口把 depends_on 当普通 payload。现在只允许本模块写：
 *   · task_dependencies(from_task_id=被阻塞方, to_task_id=前置方, edge_type hard|soft) 是边真列；
 *   · payload.depends_on 是派发（dispatch-helpers）/ 级联（dep-cascade）/ 诊断的读侧兼容，
 *     hard 边在这里同步写，soft 边不写（软依赖不阻塞派发）。
 * 守卫：__tests__/task-dependencies-single-writer.test.js 扫 src 内任何绕过本模块的直写。
 * 例外：impact-contract/gap-dependencies.js 写的是 Gap 账本边（带 gap_id/status），语义独立。
 * 旧串行 payload.depends_on_prev（按 tasks.project_id + sequence_order，callback-postprocess 解锁）
 * 是第三套，语义独立、已在生产用，本棒不动。
 */

export const EDGE_TYPES = Object.freeze(['hard', 'soft']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class TaskDependencyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TaskDependencyError';
    this.code = code;
    this.details = details;
  }
}

const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

function assertEdgeType(edgeType) {
  if (!EDGE_TYPES.includes(edgeType)) {
    throw new TaskDependencyError('invalid_edge_type', `edge_type 必须是 ${EDGE_TYPES.join('|')}，收到 ${String(edgeType)}`);
  }
}

/**
 * 建单入口用：把请求里的 depends_on 归一成 uuid 数组（缺省 undefined→null 表示没声明）。
 * @returns {string[]|null}
 * @throws {TaskDependencyError} invalid_depends_on
 */
export function normalizeDependsOn(raw) {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || raw.some((v) => !isUuid(v))) {
    throw new TaskDependencyError('invalid_depends_on', 'depends_on 必须是任务 uuid 数组', { value: raw });
  }
  return [...new Set(raw)];
}

/** 建单入口用：depends_on 里的任务必须都存在，否则 400（missing 列出缺的）。 */
export async function assertDependsOnExist(db, ids) {
  if (!ids || ids.length === 0) return;
  const missing = await findMissingTasks(db, ids);
  if (missing.length > 0) {
    throw new TaskDependencyError('depends_on_not_found', `depends_on 里的任务不存在：${missing.join(', ')}`, { missing });
  }
}

/** 全仓唯一的边 INSERT。harness-dag（虚拟 uuid 审计边）也走这里。 */
export async function insertEdgeRow(db, fromTaskId, toTaskId, edgeType = 'hard') {
  const r = await db.query(
    `INSERT INTO task_dependencies (from_task_id, to_task_id, edge_type)
     VALUES ($1::uuid, $2::uuid, $3)
     ON CONFLICT DO NOTHING`,
    [fromTaskId, toTaskId, edgeType],
  );
  return { inserted: (r.rowCount ?? 0) > 0 };
}

async function findMissingTasks(db, ids) {
  const { rows } = await db.query('SELECT id FROM tasks WHERE id = ANY($1::uuid[])', [ids]);
  const have = new Set(rows.map((r) => r.id));
  return ids.filter((id) => !have.has(id));
}

/** 从 toTaskId 沿 hard 边能否走到 fromTaskId（能 = 新增 from→to 会成环）。 */
async function wouldCreateCycle(db, fromTaskId, toTaskId) {
  const { rows } = await db.query(
    `WITH RECURSIVE reach(id) AS (
       SELECT $2::uuid
       UNION
       SELECT d.to_task_id FROM task_dependencies d
         JOIN reach r ON d.from_task_id = r.id
        WHERE d.edge_type = 'hard'
     )
     SELECT 1 AS hit FROM reach WHERE id = $1::uuid LIMIT 1`,
    [fromTaskId, toTaskId],
  );
  return rows.length > 0;
}

async function syncPayloadAdd(db, fromTaskId, toTaskId) {
  await db.query(
    `UPDATE tasks
        SET payload = jsonb_set(
              COALESCE(payload, '{}'::jsonb), '{depends_on}',
              COALESCE(payload->'depends_on', '[]'::jsonb) || to_jsonb($2::text)),
            updated_at = NOW()
      WHERE id = $1::uuid
        AND NOT (COALESCE(payload->'depends_on', '[]'::jsonb) ? $2::text)`,
    [fromTaskId, toTaskId],
  );
}

/**
 * 加一条依赖边：from（被阻塞方）依赖 to（前置方）。
 * @param {{query: Function}} db pool 或事务 client
 * @param {{fromTaskId: string, toTaskId: string, edgeType?: 'hard'|'soft', verify?: boolean, checkCycle?: boolean, syncPayload?: boolean}} o
 *   verify=false / checkCycle=false / syncPayload=false 仅供 harness-dag 虚拟 uuid 审计边与批量内部调用。
 * @returns {Promise<{added: boolean}>}
 * @throws {TaskDependencyError}
 */
export async function addTaskDependency(db, {
  fromTaskId, toTaskId, edgeType = 'hard', verify = true, checkCycle = verify, syncPayload = true,
}) {
  if (!isUuid(fromTaskId) || !isUuid(toTaskId)) {
    throw new TaskDependencyError('invalid_task_id', '依赖两端必须是 uuid', { from: fromTaskId, to: toTaskId });
  }
  if (fromTaskId === toTaskId) {
    throw new TaskDependencyError('dependency_self_loop', '任务不能依赖自己', { task_id: fromTaskId });
  }
  assertEdgeType(edgeType);

  if (verify) {
    const missing = await findMissingTasks(db, [fromTaskId, toTaskId]);
    if (missing.length > 0) {
      throw new TaskDependencyError('dependency_task_not_found', `任务不存在：${missing.join(', ')}`, { missing });
    }
  }
  if (checkCycle && edgeType === 'hard' && await wouldCreateCycle(db, fromTaskId, toTaskId)) {
    throw new TaskDependencyError('dependency_cycle', `${fromTaskId} → ${toTaskId} 会形成依赖环`, { from: fromTaskId, to: toTaskId });
  }

  const { inserted } = await insertEdgeRow(db, fromTaskId, toTaskId, edgeType);
  if (syncPayload && edgeType === 'hard') await syncPayloadAdd(db, fromTaskId, toTaskId);
  return { added: inserted };
}

/**
 * 批量：from 依赖 toIds 里的每一个。
 * strict=true（API 入口，默认）：非法/不存在/自环/成环一律抛；
 * strict=false（createRoutedTask 内部建单）：脏 id 跳过并记入 skipped，绝不因历史调用方传脏值让建单失败。
 * @returns {Promise<{added: number, skipped: string[]}>}
 */
export async function addTaskDependencies(db, fromTaskId, toIds, { edgeType = 'hard', strict = true } = {}) {
  const wanted = [...new Set((Array.isArray(toIds) ? toIds : []).map(String))];
  const skipped = [];
  const valid = [];
  for (const id of wanted) {
    if (!isUuid(id)) {
      if (strict) throw new TaskDependencyError('invalid_task_id', `依赖 id 不是 uuid：${id}`, { id });
      skipped.push(id);
    } else if (id === fromTaskId) {
      if (strict) throw new TaskDependencyError('dependency_self_loop', '任务不能依赖自己', { task_id: id });
      skipped.push(id);
    } else {
      valid.push(id);
    }
  }
  if (valid.length === 0) return { added: 0, skipped };

  const missing = await findMissingTasks(db, [fromTaskId, ...valid]);
  if (missing.length > 0) {
    if (strict) throw new TaskDependencyError('dependency_task_not_found', `任务不存在：${missing.join(', ')}`, { missing });
    skipped.push(...missing);
  }
  let added = 0;
  for (const id of valid.filter((v) => !missing.includes(v))) {
    const r = await addTaskDependency(db, { fromTaskId, toTaskId: id, edgeType, verify: false, checkCycle: strict });
    if (r.added) added += 1;
  }
  return { added, skipped };
}

/** 删边并把 to 从 from 的 payload.depends_on 摘掉。 */
export async function removeTaskDependency(db, { fromTaskId, toTaskId }) {
  if (!isUuid(fromTaskId) || !isUuid(toTaskId)) {
    throw new TaskDependencyError('invalid_task_id', '依赖两端必须是 uuid', { from: fromTaskId, to: toTaskId });
  }
  const del = await db.query(
    'DELETE FROM task_dependencies WHERE from_task_id = $1::uuid AND to_task_id = $2::uuid',
    [fromTaskId, toTaskId],
  );
  await db.query(
    `UPDATE tasks
        SET payload = jsonb_set(
              COALESCE(payload, '{}'::jsonb), '{depends_on}',
              COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(COALESCE(payload->'depends_on', '[]'::jsonb)) e
                         WHERE e <> to_jsonb($2::text)), '[]'::jsonb)),
            updated_at = NOW()
      WHERE id = $1::uuid AND payload ? 'depends_on'`,
    [fromTaskId, toTaskId],
  );
  return { removed: (del.rowCount ?? 0) > 0 };
}

/** 一个任务的依赖视图：blocked_by（我等谁）与 blocks（谁等我）。 */
export async function listTaskDependencies(db, taskId) {
  const blockedBy = await db.query(
    `SELECT d.to_task_id AS id, t.title, t.status, d.edge_type, d.gap_id
       FROM task_dependencies d JOIN tasks t ON t.id = d.to_task_id
      WHERE d.from_task_id = $1::uuid ORDER BY d.created_at`,
    [taskId],
  );
  const blocks = await db.query(
    `SELECT d.from_task_id AS id, t.title, t.status, d.edge_type, d.gap_id
       FROM task_dependencies d JOIN tasks t ON t.id = d.from_task_id
      WHERE d.to_task_id = $1::uuid ORDER BY d.created_at`,
    [taskId],
  );
  return { blocked_by: blockedBy.rows, blocks: blocks.rows };
}
