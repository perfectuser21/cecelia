/**
 * acceptance-ai.js — 一体两面的 AI 列（D1 Task 7）
 *
 * 从 routes/acceptance.js 分出来的原因不只是行数：人列（POST /results）与 AI 列
 * （POST /ai-results）是背靠背的两条独立写入路径，v7-final 要求两者不共用同一段计算。
 * 放在同一个文件里迟早会出现"顺手复用一下那个 helper"，背靠背当场失效。
 *
 * 本模块只碰 ai_verdict / ai_evidence / ai_run_at 三列 + run.detail 的哑火字段，
 * 一个字都不写 result / submitted_by / decided_at / status。
 */
import { computeAiStatus, AI_FAILURE_REASONS } from '../acceptance-state.js';
import {
  loadSpec, buildCells, deriveSets, resolveServerSpecPath, findDuplicateCheckKeys,
} from '../acceptance-spec.js';

/**
 * AI 列的取值域。与 ACCEPTANCE_RESULTS 眼下逐字相同，但刻意不共用一个常量：
 * migration 392 给两列各挂了一条独立的 CHECK 约束，两列本就是可以分别演进的东西
 * （人列加「部分通过」不该顺带让 AI 也能报它）。合并成一个常量，等于把「两列同域」
 * 从巧合升格成约束，将来改一列时另一列会被无声地带着改。
 */
export const AI_VERDICTS = ['通过', '不通过', '无法验证'];

/** 规程静态属性缓存：进程内只解析一次；改规程要重启 Brain（与 skill 缓存同一约定） */
let _specSets = null;
export function getSpecSets() {
  if (!_specSets) {
    // 路径解析放在缓存里侧：配置错的时候每次调用都重新抛出可操作错误，
    // 而不是把第一次的失败缓存成一个空壳然后走上静默路径。
    const { doc, spec_sha, version } = loadSpec(resolveServerSpecPath());
    const cells = buildCells(doc);
    _specSets = { ...deriveSets(cells), spec_sha, version, cells };
  }
  return _specSets;
}
export function _resetSpecSetsForTest() { _specSets = null; }

/**
 * 规程读取的统一错误映射：读不出规程是服务端配置/文件问题，一律 500，
 * 且只回 error code + 一句可操作的 hint。裸抛会被 express 默认处理器渲染成
 * 一整段堆栈直接吐给调用方（生产上等于把服务器路径泄出去）。
 * 返回 sets = 拿到了；返回 null = 响应已经发出去了，调用方直接 return。
 */
export function getSpecSetsOrRespond(res) {
  try {
    return getSpecSets();
  } catch (err) {
    console.error('[acceptance] 读规程失败:', err.message);
    res.status(500).json({
      error: 'spec_unavailable',
      reason: err.reason || 'spec_load_failed',
      hint: err.message,
    });
    return null;
  }
}

/**
 * A4③⑥⑦ 服务端 reason 校验。返回 null = 放行，否则返回 {status, body}。
 * @param {{check_key:string, reason:string?}} item
 * @param {ReturnType<typeof deriveSets>} sets
 */
export function validateAiReason({ check_key, reason }, sets) {
  const cell = sets.byKey.get(check_key);
  if (!cell) {
    return { status: 400, body: { error: 'unknown_check_key', check_key } };
  }
  // A4⑥⑦：拍板 ② 后 opportunistic = ∅，该 reason 的合法域为空集。无条件 reject——
  // 不查上下文、不看单头是否勾了场景码，合法域为空与上下文无关。
  if (reason === 'scenario_not_triggered') {
    return { status: 400, body: { error: 'reason_domain_empty', check_key,
      hint: '本版无 opportunistic 格，scenario_not_triggered 合法域为空集' } };
  }
  // A4③：reason 绑格的静态属性，不是 AI 说了算
  if (reason === 'human_only' && cell.verifiable_by !== 'human_only') {
    return { status: 400, body: { error: 'reason_not_allowed_for_cell', check_key,
      verifiable_by: cell.verifiable_by } };
  }
  if (reason && reason !== 'human_only' && !AI_FAILURE_REASONS.includes(reason)) {
    return { status: 400, body: { error: 'unknown_reason', check_key, reason } };
  }
  return null;
}

/**
 * AI 列回写。这个端点只写 ai_* 三列：请求体里的 result / submitted_by / note 一律忽略，
 * 不是「顺手也写上」——人列是员工亲手填的那一列，AI 能改它就等于两列可以互相冒充，
 * 一体两面的背靠背当场失效。人列走 POST /results。
 */
export function registerAiResultsRoute(router, { pool, safeRollback }) {
  router.post('/ai-results', async (req, res) => {
    const { run_key, results } = req.body || {};
    if (!run_key) return res.status(400).json({ error: 'run_key is required' });
    if (!Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: 'results must be a non-empty array' });
    }
    const sets = getSpecSetsOrRespond(res);
    if (!sets) return undefined;

    const dupes = findDuplicateCheckKeys(results.map((r) => r?.check_key));
    if (dupes.length > 0) {
      return res.status(400).json({ error: 'duplicate_check_key', duplicates: dupes });
    }
    for (const item of results) {
      if (!AI_VERDICTS.includes(item?.ai_verdict)) {
        return res.status(400).json({ error: `ai_verdict must be one of: ${AI_VERDICTS.join(',')}`, check_key: item?.check_key });
      }
      const err = validateAiReason(item, sets);
      if (err) return res.status(err.status).json(err.body);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: runRows } = await client.query(
        'SELECT id, detail FROM acceptance_runs WHERE run_key = $1 FOR UPDATE', [run_key]
      );
      if (runRows.length === 0) {
        await safeRollback(client);
        return res.status(404).json({ error: 'run not found', run_key });
      }
      const runId = runRows[0].id;

      // 规程里有这个格号 ≠ 这张单建了这一行（单只覆盖被验的那部分步骤，历史单还可能是
      // 旧流水号格号）。不先验一遍，下面的 UPDATE 匹配不到就是 0 行、PG 不报错，
      // 端点照样回 {updated: N}——采证器收到「写成功」安心退出，那一格却永远停在 NULL。
      const keys = results.map((r) => r.check_key);
      const { rows: found } = await client.query(
        'SELECT check_key FROM acceptance_checks WHERE run_id = $1 AND check_key = ANY($2)',
        [runId, keys]
      );
      const foundKeys = new Set(found.map((r) => r.check_key));
      const missing = keys.filter((k) => !foundKeys.has(k));
      if (missing.length > 0) {
        await safeRollback(client);
        return res.status(400).json({ error: 'unknown check_key', missing });
      }

      for (const item of results) {
        await client.query(
          `UPDATE acceptance_checks
              SET ai_verdict = $1, ai_evidence = $2::jsonb, ai_run_at = NOW(), updated_at = NOW()
            WHERE run_id = $3 AND check_key = $4`,
          [item.ai_verdict, JSON.stringify({ ...(item.evidence || {}), reason: item.reason || null }),
           runId, item.check_key]
        );
      }

      // 哑火判据：分母与阈值从 yaml 派生，不硬编码
      const { rows: allCells } = await client.query(
        'SELECT check_key, ai_verdict, ai_evidence FROM acceptance_checks WHERE run_id = $1', [runId]
      );
      const enriched = allCells.map((c) => ({
        check_key: c.check_key,
        ai_verdict: c.ai_verdict,
        ai_reason: c.ai_evidence?.reason || null,
        verifiable_by: sets.byKey.get(c.check_key)?.verifiable_by || 'human_only',
      }));
      const ai = computeAiStatus(enriched, { machineDbTotal: sets.machineDbList.length });
      await client.query(
        `UPDATE acceptance_runs
            SET detail = COALESCE(detail, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
          WHERE id = $2`,
        [JSON.stringify({ ai_status: ai.ai_status, ai_incomplete: ai.ai_incomplete,
                          ai_dumb_reasons: ai.reasons, ai_missing_cells: ai.missing_cells }), runId]
      );
      await client.query('COMMIT');
      return res.json({ updated: results.length, ai_status: ai.ai_status, ai_incomplete: ai.ai_incomplete });
    } catch (err) {
      await safeRollback(client);
      console.error('[acceptance] POST /ai-results error:', err.message);
      return res.status(500).json({ error: 'internal_error' });
    } finally {
      client.release();
    }
  });
  return router;
}
