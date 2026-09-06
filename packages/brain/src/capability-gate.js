// 三镜头能力级前置门禁（capability-controller 挪到四格路由器之前）。
//
// new_capability 在四格路由器选 pipeline 之前必经三镜头对抗（该不该做 / 边界 / 归位）：
//   - 三镜头判 pass 且产出「一句 postcondition + NFR 三数（成本上限 / 时延上限 / 成功率下限）」
//     → 写入 decisions(category=nfr, level=step, target_type=journey_step)，过闸放行；
//   - 判 reject / 产物不完整 / 落库失败 → 一律 fail-closed，绝不静默放行。
//
// 三镜头 LLM 判决本体（adjudicate）是更外层的第三方推理边界，由调用方（harness-skill-relay
// 的 capability-controller relay session）注入确定性 verdict；本模块只负责门禁编排与落库/拦截。

const NFR_KEYS = Object.freeze(['cost_ceiling', 'latency_ceiling', 'success_floor']);

function failClosed(code, extra = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function nfrComplete(nfr) {
  if (!nfr || typeof nfr !== 'object') return false;
  return NFR_KEYS.every((key) => typeof nfr[key] === 'number' && Number.isFinite(nfr[key]));
}

/**
 * 运行三镜头能力级前置门禁。
 *
 * @param {{ query: Function }} db - 事务/连接句柄；仅在过闸落库时被调用一次。
 * @param {object} params
 * @param {string} params.changeKind - 四格 change_kind；仅 'new_capability' 触发门禁。
 * @param {string} params.stepId - journey_step id，作为 decisions.target_id 落库。
 * @param {object} params.request - normalizeWorkRequest 后的内部请求（透传给 adjudicate）。
 * @param {Function} params.adjudicate - 三镜头判决注入点，返回 { decision, reason, postcondition, nfr }。
 * @returns {Promise<object>} 门禁结果（released / triggered / decision_id / postcondition / nfr）。
 */
export async function runCapabilityGate(db, { changeKind, stepId, request, adjudicate } = {}) {
  // 非 new_capability：短路，不调三镜头、不写 db，路由行为不变。
  if (changeKind !== 'new_capability') {
    return { triggered: false, released: true };
  }

  // 三镜头对抗（该不该做 / 边界 / 归位）。
  const verdict = await adjudicate(request);

  // 判 reject（或任何非 pass 判决）→ fail-closed，拒绝原因可查，不写 nfr。
  if (!verdict || verdict.decision !== 'pass') {
    throw failClosed('capability_gate_rejected', { reason: verdict?.reason ?? null });
  }

  // postcondition + NFR 三数必须齐全，否则能力无验收锚点 = 等于没过闸 → fail-closed，不写 nfr。
  const { postcondition, nfr } = verdict;
  if (typeof postcondition !== 'string' || postcondition.trim().length === 0 || !nfrComplete(nfr)) {
    throw failClosed('capability_gate_contract_incomplete', { reason: verdict.reason ?? null });
  }

  // 过闸落库：一句 postcondition + NFR 三数写 decisions（落库失败抛错传播，绝不静默放行）。
  const context = { nfr, source_id: request?.source_id ?? null };
  const { rows } = await db.query(
    `INSERT INTO decisions (category, topic, decision, reason, level, target_type, target_id, scope, status, context)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING id`,
    [
      'nfr',
      `[capability-gate] ${request?.source_id ?? stepId}`,
      postcondition,
      verdict.reason ?? null,
      'step',
      'journey_step',
      stepId,
      null,
      'active',
      JSON.stringify(context),
    ],
  );

  return {
    triggered: true,
    released: true,
    decision_id: rows[0].id,
    postcondition,
    nfr,
  };
}
