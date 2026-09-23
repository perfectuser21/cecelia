/**
 * qiumi-router.js — 秋米任务路由决策合成 + task_events 留痕 + 三分支持久化（PR3 Task 3）。
 *
 * 三条不可谈判的约束：
 *  1. 便宜闸永远在 Jev 前（铁律 6eb0dff5）。便宜闸能定序列号就直接定案，一次网络都不发。
 *  2. is_device 不确定不派（fail-closed）——**仅 QIUMI_DEVICE_DELEGATION_ENABLED=true 时**。开关关（默认，
 *     主理人 0923 拍板）时三道 device 闸不生效，含糊/命中都走 agent 分支并留痕 qiumi_route.device_hint，由
 *     agent 按提示自查；开时 noul 落在 (low, high) 开区间或无法解析 → verdict='ambiguous' → 任务落 failed，
 *     绝不掉进 agent 通道。
 *  3. 账号只认注册表池内序列号。jev-client 已按 questions.criteria 把池外值归 null；pickSerial 再守一道，
 *     两层独立（幻觉/越权账号走到哪一层都过不去）。
 *
 * Jev 两种答案形状不同（2026-09-23 实测，见 jev-client.js 头注释与计划「补充二」）：
 *  - is_device 是 noul 型，jev-client 归一化成 { p, verdict:true|false|'ambiguous' }，没有 confidence 可读。
 *  - 其余是 choice 型 { choice, confidence, probabilities }，confidence 是边际（top1-top2）不是概率。
 *    采纳规则：probabilities[choice] >= 0.6 或 confidence >= 0.2，否则视为未判定 → 取默认值并在
 *    payload.qiumi_route.defaulted 留痕（默认：engine=terra / kind=agent / department=main / 其余 null）。
 */
import { recordTaskEventSafe } from '../lib/task-event-log.js';
import { qiumiEnv } from './env.js';
import { loadRegistryPool, cheapGates } from './cheap-gates.js';
import { buildJevQuestions, decideWithFallback } from './jev-client.js';

// is_device 阈值的唯一真身在 jev-client（verdict 也在那里算好），本模块只再导出给下游，不另立标准。
export { NOUL_THRESHOLDS } from './jev-client.js';

// choice 型采纳线（计划「补充二」）：被选项概率够高，或与次选的边际够大，二者任一成立即采纳。
export const ADOPT_PROB_MIN = 0.6;
export const ADOPT_MARGIN_MIN = 0.2;

const ENGINE_NAMES = ['claude', 'codex', 'terra'];
const KIND_NAMES = ['agent', 'workflow'];
const NOT_APPLICABLE = 'not_applicable';

/** 把 qiumi_source 拼成给判定模型看的 state（打码由 jev-client 负责）。 */
function stateOf(task) {
  const s = task?.payload?.qiumi_source ?? {};
  return [
    `标题：${s.title ?? ''}`,
    `备注：${s.remark ?? ''}`,
    `执行通道：${s.channel ?? ''}`,
    `正文：\n${s.body ?? ''}`,
  ].join('\n');
}

/** choice 型答案是否达到采纳线；未达线返回 null（= 未判定，由调用方取默认）。 */
function adopt(answer) {
  if (!answer || answer.choice == null) return null;
  const p = Number(answer.probabilities?.[answer.choice]);
  if (Number.isFinite(p) && p >= ADOPT_PROB_MIN) return String(answer.choice);
  if (Number(answer.confidence ?? 0) >= ADOPT_MARGIN_MIN) return String(answer.choice);
  return null;
}

/** 采纳 + 合法性校验；任一不过 → 记进 defaulted 并回落默认值。 */
function resolveChoice(answer, name, isValid, fallback, defaulted) {
  const c = adopt(answer);
  if (c != null && isValid(c)) return c;
  defaulted.push(name);
  return fallback;
}

/**
 * 从 agentRef 反查序列号：非部门 agent 的名字常把序列号裹在里面（`phone-ANGYVB4227006983`），
 * 而 ops_agents 没有 serial 列可查（补充三），只能拿池内序列号做子串命中。
 * 反查以「池内序列号是否出现在 agent 名里」为准，不是拿 agent 名去猜序列号——池外的一律不放行。
 */
function serialFromAgentRef(agentRef, registry) {
  if (!agentRef) return null;
  const name = String(agentRef);
  return (registry?.phones ?? []).find((p) => p.serial && name.includes(p.serial))?.serial ?? null;
}

/** 采纳 Jev/terra 的 workflow_ref：必须过采纳线且落在注册表工作流池内，否则回落 null 并记 defaulted。 */
function jevWorkflowRef(answers, registry, defaulted) {
  const c = resolveChoice(
    answers?.workflow_ref,
    'workflow_ref',
    (x) => x === NOT_APPLICABLE || registry.workflows.some((w) => w.name === x),
    null,
    defaulted,
  );
  return c && c !== NOT_APPLICABLE ? c : null;
}

/**
 * 选一台手机：便宜闸命中的序列号优先，其次 agentRef 子串反查，最后才是 Jev/terra 的 account 答案，
 * 且 account 必须落在注册表 phones 池内。
 * 池内校验是第二道闸（jev-client 已按 criteria 过滤过一次），删掉它等于让幻觉账号直通真机。
 * 传 `answers = null` 就只走前两档——路由入口在问 Jev 之前就是这么用的，反查逻辑因此只有这一份。
 */
export function pickSerial(cheap, answers, registry) {
  if (cheap?.serial) return cheap.serial;
  const fromRef = serialFromAgentRef(cheap?.agentRef, registry);
  if (fromRef) return fromRef;
  const c = adopt(answers?.account);
  if (c == null || c === NOT_APPLICABLE) return null;
  return (registry?.phones ?? []).find((p) => p.serial === c)?.serial ?? null;
}

/**
 * 合成一条路由决策。不写库——落库是 persistDecision 的事（便于 Task 4 在 claim 语义里选时机）。
 *
 * @returns {Promise<
 *   {outcome:'device', serial:string, workflowRef:string|null, department:string|null, payloadPatch:object} |
 *   {outcome:'agent', engine:string, model:string, department:string, kind:string, workflowRef:string|null, runId:string, payloadPatch:object} |
 *   {outcome:'fail', reason:string, detail:string}
 * >}
 */
export async function routeQiumiTask(task, deps) {
  const { pool, env = qiumiEnv(), fetchFn, callLLMFn, now = Date.now } = deps;
  const registry = await loadRegistryPool((sql, params) => pool.query(sql, params));
  const cheap = cheapGates(task, registry, env);

  // 便宜闸的延伸：relation 指到的非部门 agent 名里裹着池内序列号 → 当作命中，连 Jev 都不用问。
  // 这里传 answers=null，走的正是 pickSerial 的 agentRef 反查那一档，反查实现不另开一份。
  if (!cheap.serial) {
    const fromRef = pickSerial(cheap, null, registry);
    if (fromRef) {
      cheap.serial = fromRef;
      cheap.isDevice = true;
      cheap.matchedBy = [...cheap.matchedBy, 'agentRef:serial'];
    }
  }

  const base = {
    cheap: {
      matchedBy: cheap.matchedBy,
      isDevice: cheap.isDevice,
      serial: cheap.serial,
      agentRef: cheap.agentRef ?? null,
      workflowRef: cheap.workflowRef ?? null,
      department: cheap.department ?? null,
      hardEngine: cheap.hardEngine ?? null,
      hardModel: cheap.hardModel ?? null,
    },
    decided_at: new Date(now()).toISOString(),
  };

  const fail = async (reason, detail, extra = {}) => {
    await recordTaskEventSafe(pool, task.id, 'qiumi_route_failed', { reason, detail, ...base, ...extra });
    return { outcome: 'fail', reason, detail };
  };

  const device = async (serial, source, answers) => {
    // 工作流：便宜闸命中的优先；没命中就采纳 Jev 的池内答案（便宜闸直接定案那条路没问过 Jev，answers 为 null）
    const defaulted = [];
    const workflowRef = cheap.workflowRef ?? (answers ? jevWorkflowRef(answers, registry, defaulted) : null);
    // 补充五之后 device 分支不再就地改父任务，这份 payloadPatch 是**子任务** payload 的原料
    // （persistDecision → delegateDeviceJob 取用）；父任务只收下其中的 qiumi_route。
    const payloadPatch = {
      qiumi_route: { source, answers: answers ?? null, defaulted, ...base },
      serial,
      source: 'oneoff',
      headed_manual: true,
      qiumi_workflow_ref: workflowRef,
    };
    await recordTaskEventSafe(pool, task.id, 'qiumi_route_decided', { outcome: 'device', source, serial, workflowRef, ...base });
    return { outcome: 'device', serial, workflowRef, department: cheap.department ?? null, payloadPatch };
  };

  // 开关关（默认）：手机活不改道给西安领单器，和其它活一样派 openclaw agent（主理人 0923 拍板）。
  // 三道 device 闸只在开关开时生效；关时 is_device/serial 仍算，但只留痕 device_hint 给 agent prompt 用。
  const delegate = env.deviceDelegationEnabled === true;

  // 闸 1：便宜闸已经能定到具体手机 → 直接定案，不问 Jev。
  if (delegate && cheap.isDevice && cheap.serial) return device(cheap.serial, 'cheap', null);

  const questions = buildJevQuestions({
    departments: env.departments,
    accountPool: registry.phones.map((p) => p.serial).filter(Boolean),
    workflowPool: registry.workflows.map((w) => w.name),
  });
  const r = await decideWithFallback({ state: stateOf(task), questions, env, fetchFn, callLLMFn, now });
  if (r.source === 'fail') return fail(r.reason, 'jev 与 terra 均不可用');
  const a = r.answers;
  const verdict = a.is_device?.verdict;

  if (delegate) {
    // 闸 2：设备判定 fail-closed。便宜闸说是设备 → 直接进设备分支；否则只认 verdict===true。
    if (cheap.isDevice || verdict === true) {
      const serial = pickSerial(cheap, a, registry);
      if (!serial) return fail('device_serial_unresolved', `account=${a.account?.choice ?? 'none'}`, { source: r.source });
      return device(serial, r.source, a);
    }
    // 便宜闸未命中 + verdict 含糊（ambiguous）→ 不派，绝不回落 agent。
    // 这是 ambiguous 唯一的一道闸：删掉它 agent 分支就会照单全收，变异测试钉在这一行。
    if (verdict !== false) return fail('device_uncertain', `p=${a.is_device?.p ?? null}`, { source: r.source });
  }

  // 闸 3：agent 分支——硬约束（便宜闸）压过模型答案，模型答案未达采纳线则取默认并留痕。
  const defaulted = [];
  const engine = cheap.hardEngine ?? resolveChoice(a.engine, 'engine', (c) => ENGINE_NAMES.includes(c), 'terra', defaulted);
  const department = cheap.department ?? resolveChoice(a.department, 'department', (c) => env.departments.includes(c), 'main', defaulted);
  const kind = resolveChoice(a.kind, 'kind', (c) => KIND_NAMES.includes(c), 'agent', defaulted);
  const workflowRef = cheap.workflowRef ?? jevWorkflowRef(a, registry, defaulted);
  // 正文「用 <型号>」（允许清单内）压过 engine → model 查表，engine 本身仍按 Jev/便宜闸。
  const model = cheap.hardModel ?? env.modelMap[engine];
  const runId = `qiumi-${String(task.id).slice(0, 8)}-${now()}`;
  // 留痕给 agent：它要自己去 OpenClaw 节点上跑控制器，得知道哪台手机在哪台宿主。
  const hintSerial = pickSerial(cheap, a, registry);
  const device_hint = {
    is_device: cheap.isDevice || verdict === true,
    verdict: verdict ?? null,
    p: a.is_device?.p ?? null,
    serial: hintSerial,
    host: registry.phones.find((p) => p.serial === hintSerial)?.host ?? null,
    matchedBy: cheap.matchedBy,
  };
  const payloadPatch = {
    qiumi_route: { source: r.source, answers: a, defaulted, device_hint, ...base },
    model,
    provider: 'openclaw',
    run_id: runId,
    qiumi_department: department,
    qiumi_kind: kind,
    qiumi_workflow_ref: workflowRef,
  };
  await recordTaskEventSafe(pool, task.id, 'qiumi_route_decided', {
    outcome: 'agent', source: r.source, engine, model, department, kind, workflowRef, runId, defaulted, device_hint, ...base,
  });
  return { outcome: 'agent', engine, model, department, kind, workflowRef, runId, payloadPatch };
}

/**
 * device 分支：派生一条 device_job 子任务，父任务挂起（补充五）。
 *
 * 为什么不就地把父任务改成 device_job：`tasks` 上的
 * `work_routing_task_projection_immutable`（迁移 421）在任务有路由回执时禁止
 * `task_type` 偏离 `receipt.canonical_task_type`。生产秋米任务全部经 createRoutedTask
 * 入账、回执写死 `qiumi_task`，就地改必抛。回执是真身、任务行是投影——改投影不改真身
 * 就是账实分叉，触发器挡的正是这个，不绕。
 *
 * 子任务走 createRoutedTask（仓内唯一建单路径）拿自己的回执，
 * `canonical_task_type='device_job'` 与它的 `task_type` 一致，触发器天然放行。
 *
 * @returns {Promise<string>} 子任务 id
 */
/**
 * 父任务挂起：status=blocked + 释放 claim + payload 并上 device_task_id。
 *
 * payload 只并三个键——回执七键碰一个就是不可变触发器换个理由抛；
 * serial/source/headed_manual 属于设备语义，只写子任务，糊到父任务上会让父行看起来也是手机的活。
 * 不用 task-updater.blockTask()：它吃模块级 pool（注不进来）、不做 queued 的 CAS、也不合并 payload。
 * blocked_until 留 NULL 是故意的：自动解闸器只捞到期行，留 NULL 才不会在子任务跑完前
 * 把父任务放回队列派第二遍（放行权唯一归 device-delegation.js 的对账 job）。
 */
function holdParent(pool, task, decision, childId) {
  return pool.query(
    `UPDATE tasks
        SET status = 'blocked', blocked_at = NOW(), blocked_reason = 'delegated_device_job',
            claimed_by = NULL, claimed_at = NULL,
            payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb, updated_at = NOW()
      WHERE id = $1 AND status = 'queued'`,
    [task.id, JSON.stringify({
      device_task_id: childId,
      qiumi_route: decision.payloadPatch?.qiumi_route ?? null,
      qiumi_workflow_ref: decision.workflowRef ?? null,
    })],
  );
}

async function delegateDeviceJob(pool, task, decision, createRoutedTaskFn) {
  // 幂等：已经派生过就别再建第二条。createRoutedTask 的去重分支会走
  // assertRouteSnapshotLaunchAuthority，子任务还 queued 且 map_scope_validation_version 为
  // NULL（非编码任务本来就不写这列）时它会抛 legacy_route_snapshot_unvalidated。
  // 那是共用路由账房的既有锐边，绕开即可，不在本刀修。
  const already = task.payload?.device_task_id;
  if (already) {
    // 早退也必须重新挂起父任务：走到这里说明它眼下又是 queued（多半是有人手工 unblock
    // 把它放回了队列）。只 return 不挂 = 子任务还在跑，父任务却留在队列里被一轮轮重派，
    // 每轮都原地早退空转，claim 也没人放。
    // 这条不看 rowCount：父任务此刻常常已经是 blocked，CAS 0 行是常态，不是异常。
    await holdParent(pool, task, decision, already);
    return already;
  }

  const p = task.payload ?? {};
  const routed = await createRoutedTaskFn(pool, {
    // source_id 以父任务 id 为键：同一父任务重复路由只会拿回同一条子任务。
    source: 'child',
    source_id: `qiumi-device:${task.id}`,
    // 标题继承父任务并缀上设备标记。**不能逐字照抄**：建子任务这一刻父任务还是 queued
    // （挂 blocked 在下面），`idx_tasks_dedup_active`（迁移 461）对活跃任务按
    // (title, goal_id, project_id) 唯一，父子同名会当场撞索引（2026-09-23 smoke 实证）。
    // 后缀顺带让排程看板上父子两行分得出谁是哪个。tasks.title 是 varchar(255)，先截再缀。
    title: `${String(task.title ?? '').slice(0, 200)}（设备 ${decision.serial}）`,
    description: task.description || task.title,
    // 非编码分支的 canonical_task_type 直接取 requested_task_type（work-router.js:155）
    requested_task_type: 'device_job',
    mutation_intent: 'none',
    declared_domain: 'operations',
    metadata: {
      // 领单器的消费契约四件套
      serial: decision.serial,
      source: 'oneoff',
      headed_manual: true,
      qiumi_workflow_ref: decision.workflowRef ?? null,
      // 溯源
      parent_task_id: task.id,
      qiumi_route: decision.payloadPatch?.qiumi_route ?? null,
      qiumi_source: p.qiumi_source ?? null,
      tenant_id: p.tenant_id ?? null,
      // notion_page_id 必须继承：idx_tasks_dedup_active（迁移 461）对
      // payload->>'notion_page_id' IS NULL 的活跃任务按 (title,goal_id,project_id) 去重，
      // 子任务标题继承父任务、状态 queued，中文表同名行是常态 —— 不继承就会撞唯一索引。
      notion_page_id: p.notion_page_id ?? null,
      // notion_zh_page_id 绝不继承：PUSH_QIUMI_QUERY 拿它当「这行代表中文表某一行」的凭据，
      // 子任务带上它就会用自己的状态去改父任务那一行——子 queued 把行推回「委派」
      // （下轮同步当新行二次入账）、子完成抢在父任务前写「已完成」、子失败写「推迟」并清空
      // OpenClaw任务号（急停与重排的唯一锚）。中文表的回写只认父任务。
    },
    task: {
      priority: task.priority ?? 'P2',
      status: 'queued',
      trigger_source: 'manual',
      executor_kind: 'headed-session',
      project_id: task.project_id ?? null,
    },
  });
  const childId = routed?.task?.id ?? routed?.task_id;
  if (!childId) throw new Error('device_child_task_id_missing');

  // assigned_to 写 'phone-<serial>'：与 zenithjoy 领单器两形态认领兼容。
  // createRoutedTask 的 INSERT 列表里没有 assigned_to，只能另起一条 UPDATE；
  // 它不碰 task_type/payload，所以不会叫醒触发器（BEFORE UPDATE OF task_type, payload）。
  await pool.query(
    'UPDATE tasks SET assigned_to = $2, updated_at = NOW() WHERE id = $1',
    [childId, `phone-${decision.serial}`],
  );

  let held;
  let holdError = null;
  try {
    held = await holdParent(pool, task, decision, childId);
  } catch (err) {
    holdError = err.message;
  }

  // 子任务已经建出去了，父任务却没挂住（CAS 0 行 = 状态被别人改过，或写库直接抛）。
  // 这一步静默吞掉最要命：父任务还停在 queued，下一轮 tick 会把同一件活再派一次，
  // 手机上就会跑两遍。所以留痕 + 把父任务置 failed，让它在中文表里以「推迟」出声。
  if (holdError != null || held?.rowCount === 0) {
    const reason = holdError ?? 'cas_no_rows';
    console.error(`[qiumi-device] 父任务 ${task.id} 挂起失败（${reason}），子任务 ${childId} 已建出去`);
    await recordTaskEventSafe(pool, task.id, 'qiumi_device_delegation_orphan', { child_id: childId, reason });
    // 排除表不止四个终态：CAS 落空最现实的成因就是主理人在 claim 与挂起之间从中文表急停了
    // 这一行——「淘汰」落 cancelled/canceled、「阻塞」落 blocked + owner_hold（applyOwnerStops）。
    // 把那种行改写成 failed = 机器覆盖人刚做的决定，正好把「冲突人赢」反过来。
    await pool.query(
      `UPDATE tasks
          SET status = 'failed', error_message = $2, claimed_by = NULL, claimed_at = NULL, updated_at = NOW()
        WHERE id = $1
          AND status NOT IN ('completed', 'completed_no_pr', 'failed', 'archived', 'cancelled', 'canceled')
          AND NOT (status = 'blocked' AND blocked_reason = 'owner_hold')`,
      [task.id, `device_parent_hold_failed: 子任务 ${childId} 已建，父任务挂起失败（${reason}）`],
    );
    return childId;
  }

  await recordTaskEventSafe(pool, task.id, 'qiumi_device_delegated', {
    child_id: childId,
    serial: decision.serial,
    workflowRef: decision.workflowRef ?? null,
  });
  return childId;
}

/**
 * 三分支落库。device/fail 用 `WHERE status='queued'` 做 CAS（761f242b），
 * 领单器抢先改了状态就自然不覆盖，无需显式事务。
 *
 * @param {object} [deps] `createRoutedTaskFn` 可注入（单测与 smoke 用）。
 * @returns {Promise<string|undefined>} device 分支返回子任务 id，其余 undefined。
 */
export async function persistDecision(pool, task, decision, deps = {}) {
  if (decision.outcome === 'device') {
    const createRoutedTaskFn = deps.createRoutedTaskFn
      ?? (async (...args) => (await import('../work-routing-store.js')).createRoutedTask(...args));
    return delegateDeviceJob(pool, task, decision, createRoutedTaskFn);
  }
  if (decision.outcome === 'agent') {
    await pool.query(
      `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb, updated_at = NOW() WHERE id = $1`,
      [task.id, JSON.stringify(decision.payloadPatch)],
    );
    return;
  }
  await pool.query(
    `UPDATE tasks
        SET status = 'failed', error_message = $2, claimed_by = NULL, claimed_at = NULL, updated_at = NOW()
      WHERE id = $1 AND status = 'queued'`,
    [task.id, decision.detail ? `${decision.reason}: ${decision.detail}` : decision.reason],
  );
}
