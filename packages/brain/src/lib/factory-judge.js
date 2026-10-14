/**
 * 技能工厂自动裁判（任务 2231ecc0；决策 cc008b7e / 2bb08a99）。
 *
 * 盯 payload.factory_dispatch=true 的执行单进入终态（completed/failed 且带 result.delivery；核验单本身除外）：
 *   1) 代码裁判：从 delivery 机械判读回 → code_verdict（claimed_result / lock_released / 对外动作次数 / 读回 / 自带验收项）
 *   2) code_verdict=pass 且该 workflow 要看图 → 自动建一张 run-verify 核验单（同样经派发器派出），
 *      拿到 verification.verdict 后合并：两者都 pass 才算 pass
 *   3) 结果记进台账滑窗（recordRun，同 run_id 去重）；发布前安全停止、未产生对外动作的算 fail 并标 safe_stop
 * 裁判结论写回执行单 result.factory_judge（state=awaiting_verify|final），既是留痕也是幂等标记。
 */
import { STAGE_NAMES } from './factory-ledger.js';
import { evidenceScopeOf, evidenceScopeKey, independentVerification, frozenScopeMatches, reconcileSteps } from './step-reconcile.js';

export const JUDGE_KEY = 'factory_judge';
const TERMINAL = new Set(['completed', 'completed_no_pr', 'failed', 'cancelled', 'archived']);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** 对外动作次数：优先读回 readback.publish_attempts，否则数 side_effects 里不可逆的条目。 */
export function outwardCount(delivery = {}) {
  const attempts = delivery?.readback?.publish_attempts;
  if (Number.isInteger(attempts) && attempts >= 0) return attempts;
  const se = Array.isArray(delivery?.side_effects) ? delivery.side_effects : [];
  return se.filter((x) => !(isObj(x) && x.reversible === true)).length;
}

/** 合同 readback glob → 整串匹配正则（只认 * 与 ?，其余字符按字面）。 */
export function globToRegExp(glob) {
  const body = String(glob).split('').map((ch) => (ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('');
  return new RegExp(`^${body}$`);
}

const EXPECT_OPS = { '>=': (n, v) => n >= v, '>': (n, v) => n > v, '==': (n, v) => n === v, '=': (n, v) => n === v, '<=': (n, v) => n <= v };

/**
 * 合同活动读回（任务 c0fe7e30，决策 2186700a：验证归活动自带读回 + Brain 裁判，Commander 不判）。
 * delivery.activities 由外壳 runner 按合同 steps.dod.readback 汇总（系统产出）；每个 evidence 型活动一条 check。
 */
function activityReadbackChecks(activities, add) {
  for (const a of activities) {
    const rb = isObj(a?.readback) ? a.readback : null;
    if (!rb || rb.type !== 'evidence' || typeof rb.glob !== 'string') continue;
    const files = Array.isArray(a.evidence_files) ? a.evidence_files.filter((f) => typeof f === 'string') : [];
    const re = globToRegExp(rb.glob);
    const n = files.filter((f) => re.test(f.split('/').pop())).length;
    const op = rb.expect?.op ?? '>=';
    const want = Number(rb.expect?.value ?? 1);
    const cmp = EXPECT_OPS[op];
    add(`readback:${a.key}`, Boolean(cmp) && cmp(n, want), `${rb.glob} 命中 ${n} 个（期望 ${op} ${want}）`);
  }
}

function acceptanceItemsPass(items) {
  return items.every((it) => it === true || (isObj(it) && (it.pass === true || it.result === 'pass')));
}

/**
 * 代码裁判（纯函数）。
 * @param {{taskStatus:string, delivery:object, expectedOutward?:number, requireEvidence?:boolean, requireActivities?:boolean}} p
 * @returns {{verdict:'pass'|'fail', checks:Array<{name,pass,detail}>, outward_count:number, safe_stop:boolean}}
 */
export function computeCodeVerdict({ taskStatus, delivery, expectedOutward, requireEvidence = false, requireActivities = false }) {
  const d = isObj(delivery) ? delivery : {};
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });
  add('task_status', taskStatus === 'completed', `任务状态 ${taskStatus}`);
  add('run_id', typeof d.run_id === 'string' && d.run_id.trim() !== '', `run_id=${d.run_id ?? '缺'}`);
  add('claimed_result', d.claimed_result === 'success', `claimed_result=${d.claimed_result ?? '缺'}`);
  add('fail_reason', d.fail_reason === undefined || d.fail_reason === null || d.fail_reason === '', d.fail_reason ? String(d.fail_reason).slice(0, 200) : '无');
  add('lock_released', d.lock_released === true, `lock_released=${d.lock_released ?? '缺'}`);
  const outward = outwardCount(d);
  if (Number.isInteger(expectedOutward)) add('outward_count', outward === expectedOutward, `对外动作 ${outward} 次（期望 ${expectedOutward}）`);
  if (isObj(d.readback) && d.readback.lock_status !== undefined) add('readback_lock_free', d.readback.lock_status === 'free', `读回锁状态 ${d.readback.lock_status}`);
  for (const key of ['acceptance_checks', 'readback_checks']) {
    if (Array.isArray(d[key]) && d[key].length) add(key, acceptanceItemsPass(d[key]), `${key} ${d[key].length} 项`);
  }
  if (Array.isArray(d.activities) && d.activities.length) activityReadbackChecks(d.activities, add);
  else if (requireActivities) add('contract_readback', false, '交付缺 activities（合同活动读回）');
  if (requireEvidence) add('final_evidence', Array.isArray(d.final_evidence) && d.final_evidence.length > 0, `final_evidence ${Array.isArray(d.final_evidence) ? d.final_evidence.length : 0} 项`);
  const verdict = checks.every((c) => c.pass) ? 'pass' : 'fail';
  return { verdict, checks, outward_count: outward, safe_stop: verdict === 'fail' && outward === 0 };
}

/** 读核验单的独立判定：result.verification 优先，其次 result.delivery；run_id 对不上算 fail。 */
export function readVisualVerdict(verifyTask, runId) {
  if (!verifyTask) return { verdict: null, terminal: true, reason: '核验单不存在' };
  if (!TERMINAL.has(verifyTask.status)) return { verdict: null, terminal: false, reason: `核验单 ${verifyTask.status}` };
  const r = isObj(verifyTask.result) ? verifyTask.result : {};
  const v = [r.verification, r.delivery].find((x) => isObj(x) && typeof x.verdict === 'string');
  if (!v) return { verdict: null, terminal: true, reason: `核验单已 ${verifyTask.status} 但没有 verification.verdict` };
  if (v.run_id && runId && v.run_id !== runId) return { verdict: 'fail', terminal: true, reason: `核验 run_id ${v.run_id} 与执行 run_id ${runId} 不符` };
  const verdict = String(v.verdict).toLowerCase() === 'pass' ? 'pass' : 'fail';
  return { verdict, terminal: true, reason: `run-verify verdict=${v.verdict}`, assertions: Array.isArray(v.assertions) ? v.assertions.length : 0 };
}

/** 合并：代码裁判与看图核验都 pass 才算 pass。visual 为 undefined 表示该 workflow 不需要看图。 */
export function mergeVerdicts(codeVerdict, visualVerdict) {
  if (codeVerdict !== 'pass') return 'fail';
  if (visualVerdict === undefined) return 'pass';
  return visualVerdict === 'pass' ? 'pass' : 'fail';
}

/** 核验单建单参数（createTask 入参）。 */
export function buildVerifySpec({ execTask, delivery, ledgerId, cfg }) {
  const f = execTask.payload?.factory || {};
  const runId = delivery.run_id;
  const acceptance = (typeof delivery.acceptance === 'string' && delivery.acceptance) || cfg?.acceptance || '自拟：以候选版 skill 的「成功判定」节为准';
  const lines = [
    '【执行参数】',
    '阶段：核验',
    '使用 skill：run-verify',
    `被核验执行单：${execTask.id}（${execTask.title || ''}，run_id ${runId}）`,
    `技能工厂：workflow ${f.workflow_key || cfg?.workflow_key || '?'}｜台账 ${ledgerId || '无'}｜被核验阶段 ${f.stage}（${STAGE_NAMES[Number(f.stage)] || f.stage}）｜技能 ${f.skill}`,
    `验收：${acceptance}`,
    ...(Array.isArray(cfg?.verify_material) ? cfg.verify_material : ['材料：只读被核验执行单的 result.delivery（run_id / final_evidence / claimed_result），证据原图用 file_fetch 亲自取回看；禁止读执行会话']),
    '红线：只判不修，禁止任何对外动作；锁由派发器代领（owner=本核验 run_id），开工 lock-status 核对，结束 lock-release 并回读 free',
    '交付：run-verify 交付 JSON（stage=verify、run_id=被核验 run_id、verdict、assertions、overreach、missing、claimed_result、agrees_with_claim），同时写入 result.verification 与 result.delivery',
  ];
  return {
    title: `核验 ${STAGE_NAMES[Number(f.stage)] || f.stage} ${f.workflow_key || ''} run ${runId}（自动裁判）`,
    description: lines.join('\n'),
    // 独立类型（派发总闸 F，任务 0a70684f）：核验单与执行单同走 factory-dispatcher，tick 按类型排除
    task_type: 'skill_factory_run',
    priority: 'P1',
    trigger_source: 'manual',
    allow_unscoped: true,
    source: 'scheduler',
    source_id: `factory-judge:verify:${execTask.id}`,
    created_by: 'factory-judge',
    payload: {
      factory_dispatch: true,
      factory_ledger_id: ledgerId || null,
      factory_verify_of: execTask.id,
      factory_verify_run_id: runId,
      agent: 'skill-factory',
      skill: 'run-verify',
      stage: 'verify_run',
      source_task_id: execTask.id,
      ...(cfg?.anchor ? { anchor: cfg.anchor } : {}),
      factory: {
        stage: 'verify',
        workflow_key: f.workflow_key || cfg?.workflow_key,
        device: f.device,
        agent: 'skill-factory',
        skill: 'run-verify',
        round: 1,
        run_prefix: 'sfv',
        message: `核验执行单 ${execTask.id} 的 run ${runId}；只判不修，禁止对外动作。`,
      },
    },
  };
}

// ── 存储层（真库） ─────────────────────────────────────────────────────
export function makeJudgeStore(db) {
  return {
    async listCandidates(limit = 20) {
      const { rows } = await db.query(
        `SELECT id, task_type, title, status, payload, result, completed_at, updated_at FROM tasks
          WHERE payload->>'factory_dispatch' = 'true'
            AND COALESCE(payload->'factory'->>'stage', '') <> 'verify'
            AND status IN ('completed', 'failed')
            AND (result ? 'delivery' OR (payload->>'commander_protocol'='commander-v2' AND result->'workflow_control'->>'phase'='final'))
            AND (result->'${JUDGE_KEY}' IS NULL OR result->'${JUDGE_KEY}'->>'state' = 'awaiting_verify' OR result->'${JUDGE_KEY}'->>'verdict' = 'inconclusive')
          ORDER BY updated_at ASC LIMIT $1`, [limit]);
      return rows;
    },
    async findLedger(ledgerId, workflowKey) {
      const { rows } = await db.query(
        `SELECT l.id, l.stage, w.key AS workflow_key FROM factory_ledger l JOIN workflows w ON w.id = l.workflow_id
          WHERE ($1::uuid IS NOT NULL AND l.id = $1::uuid) OR ($1::uuid IS NULL AND w.key = $2) LIMIT 1`,
        [ledgerId || null, workflowKey || null]);
      return rows[0] || null;
    },
    async getTask(id) {
      const { rows } = await db.query('SELECT id, task_type, title, status, payload, result FROM tasks WHERE id = $1', [id]);
      return rows[0] || null;
    },
    async readActivityEvidence(runId) {
      return (await db.query(`SELECT s.id, s.reference_id, s.ended_at, s.run_id, s.step_id, s.activity_id, s.activity_definition_version_id, s.outcome, s.evidence,
        s.started_at, s.identity_protocol, s.run_binding_id, v.payload AS frozen_payload, true AS binding_verified FROM spans s
        JOIN run_definition_bindings b ON b.id=s.run_binding_id AND b.run_id=s.run_id
        JOIN activity_definition_versions v ON v.id=s.activity_definition_version_id AND v.activity_id=s.activity_id
        WHERE s.run_id=$1 AND s.identity_protocol=2 AND EXISTS (SELECT 1 FROM jsonb_array_elements(b.expected_path) p
          WHERE p->>'activity_id'=s.activity_id::text AND p->>'activity_definition_version_id'=s.activity_definition_version_id::text
            AND COALESCE(p->>'step_id','')=COALESCE(s.step_id::text,'')) ORDER BY s.started_at`,[runId])).rows;
    },
    async writeJudge(taskId, judge) {
      await db.query(
        `UPDATE tasks SET result = COALESCE(result, '{}'::jsonb) || jsonb_build_object('${JUDGE_KEY}', $2::jsonb) WHERE id = $1`,
        [taskId, JSON.stringify(judge)]);
    },
  };
}

const isUuidLike = (v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

/** 原unknown只追加后续资格；正式resolution、真实后续同身份PASS与独立断言缺一不可。 */
function independentlyResolved(span, spans, control, verification) {
  if (!verification || span.outcome !== 'unknown' || span.evidence?.execution_role !== 'primary'
    || typeof span.id !== 'string' || !span.id || control.readback_resolution?.kind !== 'independent_readback_success') return false;
  const marker=(control.readback_resolution.readbacks || []).find(r=>r.unknown_span_id===span.id);
  const name=`readback:${span.reference_id}:${span.step_id ?? 'activity'}`;
  if (!marker || marker.verification_assertion !== name || !marker.readback_span_id || span.run_id !== control.envelope.run_id) return false;
  const later=spans.find(s=>s.id===marker.readback_span_id);
  if (!later || later.outcome !== 'pass' || later.id===span.id || later.run_id !== span.run_id
    || !span.run_binding_id || later.run_binding_id!==span.run_binding_id || later.identity_protocol!==2 || span.identity_protocol!==2
    || span.binding_verified!==true || later.binding_verified!==true
    || later.reference_id!==span.reference_id || later.activity_id!==span.activity_id || (later.step_id ?? null)!==(span.step_id ?? null)
    || later.evidence?.execution_role!=='primary' || evidenceScopeKey(evidenceScopeOf(later))!==evidenceScopeKey(evidenceScopeOf(span))
    || !Number.isFinite(Date.parse(span.ended_at)) || !Number.isFinite(Date.parse(later.started_at))
    || !Number.isFinite(Date.parse(later.ended_at)) || Date.parse(later.ended_at)<Date.parse(later.started_at)
    || Date.parse(later.started_at)<Date.parse(span.ended_at)) return false;
  return verification.assertions.some(a=>a.name===name && a.pass===true && Array.isArray(a.evidence) && a.evidence.length
    && evidenceScopeKey(evidenceScopeOf({activity_definition_version_id:span.activity_definition_version_id,
      evidence:{implementation:a.implementation,environment:a.environment}}))===evidenceScopeKey(evidenceScopeOf(span)));
}

/** 裁判一张执行单。deps: {store, createTask, recordRun, resolveConfig, now, log} */
export async function judgeTask(task, deps) {
  const { store, now = () => new Date(), log = () => {} } = deps;
  if (task.payload?.commander_protocol === 'commander-v2') {
    const control = task.result?.workflow_control;
    if (control?.phase !== 'final') return { task_id: task.id, state: 'awaiting_verify' };
    if (task.payload?.factory_dispatch !== true) return { task_id: task.id, state: 'not_factory' };
    const f = task.payload.factory || {};
    const ledger = await store.findLedger(task.payload.factory_ledger_id || null, f.workflow_key || task.payload.workflow_key);
    const e=control.envelope, runId = e?.run_id;
    const vt = control.verify_task_id ? await store.getTask(control.verify_task_id) : null;
    const verification = independentVerification(vt,task.id,e);
    const verdict = control.verdict === 'PASS' ? (verification ? 'pass':'inconclusive') : control.verdict === 'FAIL' ? 'fail':'inconclusive';
    const spans = store.readActivityEvidence ? await store.readActivityEvidence(runId) : [];
    const grouped = new Map();
    for (const span of spans) {
      const scope=evidenceScopeOf(span), role=span.evidence?.execution_role;
      if (!scope || !['primary','fallback','rescue'].includes(role)) continue;
      const key=JSON.stringify([span.activity_id,evidenceScopeKey(scope),role]);
      const fact=grouped.get(key) || {activity_id:span.activity_id,evidence_scope:scope,execution_role:role,
        pass:true,independent_verified:Boolean(verification),readback_verified:false,outcomes:[]};
      fact.outcomes.push({step_id:span.step_id ?? null,outcome:span.outcome});
      fact.pass=fact.pass && (span.outcome==='pass' || independentlyResolved(span,spans,control,verification));
      grouped.set(key,fact);
    }
    const activityEvidence=[...grouped.values()];
    for (const fact of activityEvidence) {
      const relevant=spans.filter(s => s.activity_id===fact.activity_id && evidenceScopeKey(evidenceScopeOf(s))===evidenceScopeKey(fact.evidence_scope));
      const frozen=relevant[0]?.frozen_payload;
      const steps=(frozen?.steps || []).map(s=>({id:s.step_id,key:s.locator?.step_key,readback:s.contract?.readback ?? s.registration?.readback})).filter(s=>s.id);
      const scoped=relevant.filter(s=>s.step_id).map(s=>({...s,independent_verified:Boolean(verification),scope_verified:s.binding_verified===true && frozenScopeMatches(fact.evidence_scope,frozen,e.contract?.environment)}));
      fact.readback_verified=steps.length>0 && reconcileSteps({steps,spans:scoped,requiredGreen:1,evidenceScope:fact.evidence_scope}).promotion_eligible;
      fact.resolved_unknown_span_ids=relevant.filter(s=>independentlyResolved(s,spans,control,verification)).map(s=>s.id);
      fact.code_independent_pass=fact.pass && fact.independent_verified && fact.readback_verified
        && fact.execution_role==='primary' && fact.evidence_scope.implementation.kind==='code';
    }
    const degraded=activityEvidence.some(f=>f.execution_role!=='primary');
    const recorded = ledger && verdict !== 'inconclusive' ? await deps.recordRun(ledger.id, {
      run_id:runId,pass:verdict==='pass',source_task_id:task.id,degraded,activity_evidence:activityEvidence }) : null;
    const final = { state:'final',verdict,business_verdict:control.verdict ?? 'INCONCLUSIVE',run_id:runId,ledger_id:ledger?.id ?? null,
      recorded:Boolean(recorded),duplicate:Boolean(recorded?.duplicate),verify_task_id:control.verify_task_id,
      activity_evidence:activityEvidence,degraded,judged_at:now().toISOString() };
    await store.writeJudge(task.id,final);
    return {task_id:task.id,...final};
  }
  const delivery = isObj(task.result?.delivery) ? task.result.delivery : {};
  const f = task.payload?.factory || {};
  const prev = isObj(task.result?.[JUDGE_KEY]) ? task.result[JUDGE_KEY] : null;
  const ledgerIdHint = isUuidLike(task.payload?.factory_ledger_id) ? task.payload.factory_ledger_id : (isUuidLike(f.ledger_id) ? f.ledger_id : null);
  const ledger = await store.findLedger(ledgerIdHint, f.workflow_key);
  const cfg = deps.resolveConfig(ledger?.workflow_key || f.workflow_key);
  const runId = delivery.run_id || task.result?.factory_dispatcher?.run_id || null;
  const code = prev?.code ?? computeCodeVerdict({
    taskStatus: task.status, delivery,
    expectedOutward: Number.isInteger(cfg?.expected_outward) ? cfg.expected_outward : undefined,
    requireEvidence: cfg ? cfg.visual_verify !== false : false,
    // 经 Commander+外壳跑的执行单（workflow_dispatch）必须带合同活动读回
    requireActivities: task.task_type === 'workflow_dispatch' && cfg?.dispatch_via === 'commander',
  });
  const base = { run_id: runId, ledger_id: ledger?.id ?? null, stage: f.stage ?? null, code };

  let visual;
  if (code.verdict === 'pass' && cfg && cfg.visual_verify !== false) {
    let verifyTaskId = prev?.verify_task_id;
    if (!verifyTaskId) {
      const created = await deps.createTask(buildVerifySpec({ execTask: task, delivery, ledgerId: ledger?.id, cfg }));
      verifyTaskId = created?.task?.id;
      if (!verifyTaskId) throw new Error(`核验单建单失败：${JSON.stringify(created).slice(0, 200)}`);
      await store.writeJudge(task.id, { ...base, state: 'awaiting_verify', verify_task_id: verifyTaskId, judged_at: now().toISOString() });
      log(`执行单 ${task.id} 代码裁判 pass，已建核验单 ${verifyTaskId}`);
      return { task_id: task.id, state: 'awaiting_verify', verify_task_id: verifyTaskId };
    }
    const vt = await store.getTask(verifyTaskId);
    const read = readVisualVerdict(vt, runId);
    if (!read.terminal) return { task_id: task.id, state: 'awaiting_verify', verify_task_id: verifyTaskId };
    if (read.verdict === null) {
      await store.writeJudge(task.id, { ...base, state: 'final', verdict: 'inconclusive', verify_task_id: verifyTaskId, visual: read, recorded: false, judged_at: now().toISOString() });
      log(`执行单 ${task.id} 核验无结论（${read.reason}），不计入台账`);
      return { task_id: task.id, state: 'final', verdict: 'inconclusive' };
    }
    visual = read.verdict;
    base.verify_task_id = verifyTaskId;
    base.visual = read;
  }

  const verdict = mergeVerdicts(code.verdict, visual);
  const safeStop = verdict === 'fail' && code.safe_stop;
  let recorded = false;
  let duplicate = false;
  if (ledger && runId) {
    const out = await deps.recordRun(ledger.id, {
      run_id: runId, pass: verdict === 'pass',
      degraded: delivery.degraded === true || (Number.isInteger(delivery.degrade_count) && delivery.degrade_count > 0),
      safe_stop: safeStop, source_task_id: task.id,
    });
    recorded = true;
    duplicate = Boolean(out?.duplicate);
  }
  await store.writeJudge(task.id, { ...base, state: 'final', verdict, safe_stop: safeStop, recorded, duplicate, judged_at: now().toISOString() });
  log(`执行单 ${task.id} 裁判 ${verdict}${safeStop ? '（safe_stop）' : ''}，台账 ${ledger?.id ?? '无'}${duplicate ? '（run_id 已计过）' : ''}`);
  return { task_id: task.id, state: 'final', verdict, safe_stop: safeStop, recorded, duplicate };
}

/** 一轮裁判：逐张处理候选执行单，单张出错不影响其余。 */
export async function runFactoryJudge(deps) {
  const results = [];
  for (const task of await deps.store.listCandidates()) {
    try { results.push(await judgeTask(task, deps)); } catch (e) {
      (deps.log || console.warn)(`裁判执行单 ${task.id} 失败：${e.message}`);
      results.push({ task_id: task.id, error: e.message });
    }
  }
  return results;
}
