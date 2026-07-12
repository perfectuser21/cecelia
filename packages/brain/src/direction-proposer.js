/**
 * direction-proposer.js — 每周方向菜单 job（GP loop T4，DoD F11）
 *
 * 每周一北京 05:30（UTC 周日 21:30，晨报前）聚合三源：
 *   1. 跨线 KR 缺口（复刻 GET /okr/kr/:id/ability-progress 对账逻辑，进程内直接查库）
 *   2. advancement_items todo 耗尽信号（active line 无 todo/doing 推进项）
 *   3. 直投池（golden_paths source='alex_direct'/'capture_triage' 的既有 candidate，一等公民）
 * 经一次 LLM 汇总生成候选写 golden_paths(status='candidate', source='strategist')，
 * 并把「OKR 缺口全景」写 working_memory key='gp_gap_panorama'
 * （value_json={generated_at, gaps:[{kr_id,kr_title,reason}]}，并行约定钉死，GP6 晨报从此 key 读）。
 *
 * 方式决策（decisions af10d497）：scheduler job 内联而非新 task_type——菜单生成 =
 * 确定性聚合 + 一次 LLM 汇总，无需完整 dev 会话；LLM 失败降级只写全景（确定性部分不丢）。
 * 不动 line-strategist 本体（其单线原子决策职权已冻结）。
 */
import { callLLM } from './llm-caller.js';
import { extractJsonObject } from './json-utils.js';

/** 每周触发窗口：UTC 周日 21:30-21:35 = 北京周一 05:30-05:35 */
const WINDOW_UTC_DAY = 0;
const WINDOW_UTC_HOUR = 21;
const WINDOW_UTC_MINUTE_START = 30;
const WINDOW_UTC_MINUTE_END = 35;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 与 GP6 晨报渲染的并行约定：全景只从这个 key 读 */
export const GAP_PANORAMA_KEY = 'gp_gap_panorama';
/** 单次最多产出候选数（菜单是给人圈选的，多了没法读） */
const MAX_CANDIDATES = 5;
/** 候选查重视为"活跃"的状态（这些状态里同名 GP 存在则不再投） */
const ACTIVE_GP_STATUSES = ['candidate', 'proposed', 'converged', 'approved', 'in_dev'];

/** 是否在每周触发窗口内。 */
export function isInDirectionProposerWindow(now = new Date()) {
  return now.getUTCDay() === WINDOW_UTC_DAY
    && now.getUTCHours() === WINDOW_UTC_HOUR
    && now.getUTCMinutes() >= WINDOW_UTC_MINUTE_START
    && now.getUTCMinutes() < WINDOW_UTC_MINUTE_END;
}

/** 20h 去重（照 line-dreaming 先例）：哨兵即产物本身——无候选周也写全景，故可靠。 */
export async function alreadyProposedThisWeek(pool) {
  const { rows } = await pool.query(
    `SELECT 1 FROM working_memory
     WHERE key = '${GAP_PANORAMA_KEY}'
       AND updated_at >= NOW() - INTERVAL '20 hours'
     LIMIT 1`
  );
  return rows.length > 0;
}

/** 单段查询容错：失败返回空数组不阻断（照 line-dreaming safeRows）。 */
async function safeRows(queryPromise, label) {
  try {
    const { rows } = await queryPromise;
    return rows;
  } catch (err) {
    console.warn(`[direction-proposer] ${label} 查询失败（该段留空）:`, err.message);
    return [];
  }
}

/**
 * 跨线 KR 缺口扫描。复刻 ability-progress 端点对账语义，缺口 reason 四类
 * （优先级 missing_refs > thin_ability > advancement_incomplete；未登记单列）。
 * @returns {Promise<Array<{kr_id: string, kr_title: string, reason: string}>>}
 */
export async function collectKrGaps(pool) {
  const krs = await safeRows(
    pool.query(
      `SELECT id, title, metadata FROM key_results
       WHERE status IN ('active', 'in_progress', 'decomposing')
       ORDER BY created_at`
    ),
    'key_results'
  );

  const gaps = [];
  for (const kr of krs) {
    const targetIds = Array.isArray(kr.metadata?.target_abilities) ? kr.metadata.target_abilities : [];
    if (targetIds.length === 0) {
      gaps.push({ kr_id: kr.id, kr_title: kr.title, reason: 'no_target_abilities' });
      continue;
    }
    const validIds = targetIds.filter((tid) => UUID_RE.test(tid));
    const invalidCount = targetIds.length - validIds.length;

    let rows = [];
    if (validIds.length > 0) {
      rows = await safeRows(
        pool.query(
          `SELECT jf.id, jf.thickness,
                  COUNT(ai.id) FILTER (WHERE ai.status IN ('todo', 'doing')) AS open
           FROM journey_features jf
           LEFT JOIN advancement_items ai ON ai.ability_id = jf.id
           WHERE jf.id = ANY($1) AND jf.kind = 'ability'
           GROUP BY jf.id, jf.thickness`,
          [validIds]
        ),
        `kr ${kr.id} abilities`
      );
    }

    const foundIds = new Set(rows.map((r) => r.id));
    const missingCount = invalidCount + validIds.filter((tid) => !foundIds.has(tid)).length;
    let reason = null;
    if (missingCount > 0) reason = 'missing_refs';
    else if (rows.some((r) => r.thickness === 'thin')) reason = 'thin_ability';
    else if (rows.some((r) => Number(r.open) > 0)) reason = 'advancement_incomplete';

    if (reason) gaps.push({ kr_id: kr.id, kr_title: kr.title, reason });
  }
  return gaps;
}

/**
 * 推进项耗尽信号：active line 下所有 ability 无 todo/doing 推进项（含零条）。
 * 只进 LLM 上下文，不进 panorama gaps（gaps 格式钉死为 KR 维度）。
 */
export async function collectExhaustedLines(pool) {
  const rows = await safeRows(
    pool.query(
      `SELECT j.id, j.name FROM journeys j
       WHERE j.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM journey_features jf
           JOIN advancement_items ai ON ai.ability_id = jf.id
           WHERE jf.journey_id = j.id AND jf.kind = 'ability'
             AND ai.status IN ('todo', 'doing')
         )
       ORDER BY j.name`
    ),
    'exhausted_lines'
  );
  return rows.map((r) => ({ journey_id: r.id, journey_name: r.name }));
}

/** 直投池：Alex 直投 / capture 分诊来的既有 candidate（一等公民，已在菜单）。 */
export async function getDirectCandidates(pool) {
  return safeRows(
    pool.query(
      `SELECT id, title, one_liner, kr_id, journey_id FROM golden_paths
       WHERE status = 'candidate' AND source IN ('alex_direct', 'capture_triage')
       ORDER BY created_at DESC`
    ),
    'direct_candidates'
  );
}

function buildPrompt({ gaps, exhausted, direct }) {
  const gapLines = gaps.map((g) => `- KR「${g.kr_title}」(kr_id=${g.kr_id}) 缺口类型: ${g.reason}`);
  const exhaustedLines = exhausted.map((e) => `- ${e.journey_name} (journey_id=${e.journey_id})`);
  const directLines = direct.map((d) => `- ${d.title}: ${d.one_liner}`);
  return `你是 Cecelia 的每周方向策士。基于以下 OKR 缺口与推进项耗尽信号，提出最多 ${MAX_CANDIDATES} 条新 Golden Path 候选（方向菜单，供主理人圈选）。只输出 JSON。

## OKR 缺口（reason 含义：no_target_abilities=KR未挂能力 / missing_refs=挂的能力失联 / thin_ability=能力还是骨架 / advancement_incomplete=推进项未完）
${gapLines.length ? gapLines.join('\n') : '（无）'}

## 推进项耗尽的线（没有待推进项，需要新方向）
${exhaustedLines.length ? exhaustedLines.join('\n') : '（无）'}

## 已在菜单的直投候选（不要重复提相似方向）
${directLines.length ? directLines.join('\n') : '（无）'}

要求：
- 每条候选对准一个缺口或耗尽线；kr_id/journey_id 用上面给出的原值，没有对应就写 null
- one_liner 一句人话说清"做什么、为什么值得做"
- est_scale 用人话估规模（如"约2周产能/3个PR"）
- 输出格式：{"candidates":[{"title":"...","one_liner":"...","kr_id":"...或null","journey_id":"...或null","est_scale":"..."}]}`;
}

/**
 * 一次 LLM 汇总。失败/不可解析 → 降级空候选（llmFailed:true），确定性全景不受影响。
 * 无缺口且无耗尽线 → 不调 LLM。
 * @param {Function} llm callLLM 签名（可注入 mock）
 */
export async function proposeCandidates(llm, { gaps, exhausted, direct }) {
  if (gaps.length === 0 && exhausted.length === 0) {
    return { candidates: [], llmFailed: false };
  }
  try {
    const { text } = await llm('thalamus', buildPrompt({ gaps, exhausted, direct }), { maxTokens: 2048 });
    const parsed = extractJsonObject(text);
    if (!parsed || !Array.isArray(parsed.candidates)) {
      return { candidates: [], llmFailed: true };
    }
    const candidates = parsed.candidates
      .filter((c) => c && typeof c.title === 'string' && typeof c.one_liner === 'string')
      .slice(0, MAX_CANDIDATES)
      .map((c) => ({
        title: c.title,
        one_liner: c.one_liner,
        kr_id: c.kr_id ?? null,
        journey_id: c.journey_id ?? null,
        est_scale: c.est_scale ?? null,
      }));
    return { candidates, llmFailed: false };
  } catch (err) {
    console.warn('[direction-proposer] LLM 汇总失败（降级只写全景）:', err.message);
    return { candidates: [], llmFailed: true };
  }
}

/**
 * 候选写库：同 title 已存在活跃态 → skip 防重复；非法 UUID 引用置 null；单条失败不阻断。
 * @returns {Promise<{inserted: Array<{id: string, kr_id: string|null}>, skippedDuplicates: number, failed: number}>}
 */
export async function insertCandidates(pool, candidates) {
  const inserted = [];
  let skippedDuplicates = 0;
  let failed = 0;
  for (const c of candidates) {
    try {
      const { rows: dup } = await pool.query(
        `SELECT 1 FROM golden_paths WHERE title = $1 AND status = ANY($2) LIMIT 1`,
        [c.title, ACTIVE_GP_STATUSES]
      );
      if (dup.length > 0) {
        skippedDuplicates++;
        continue;
      }
      const krId = c.kr_id && UUID_RE.test(c.kr_id) ? c.kr_id : null;
      const journeyId = c.journey_id && UUID_RE.test(c.journey_id) ? c.journey_id : null;
      const { rows } = await pool.query(
        `INSERT INTO golden_paths (title, one_liner, journey_id, kr_id, est_scale, source)
         VALUES ($1, $2, $3, $4, $5, 'strategist')
         RETURNING id`,
        [c.title, c.one_liner, journeyId, krId, c.est_scale]
      );
      inserted.push({ id: rows[0].id, kr_id: krId });
    } catch (err) {
      console.warn(`[direction-proposer] 候选「${c.title}」写入失败（跳过）:`, err.message);
      failed++;
    }
  }
  return { inserted, skippedDuplicates, failed };
}

/**
 * OKR 缺口全景写 working_memory（并行约定钉死：GP6 晨报从 GAP_PANORAMA_KEY 读）。
 * gaps 只留无候选覆盖的（覆盖 = coveredKrIds 命中）。
 */
export async function writeGapPanorama(pool, gaps, coveredKrIds) {
  const uncovered = gaps.filter((g) => !coveredKrIds.has(g.kr_id));
  const value = { generated_at: new Date().toISOString(), gaps: uncovered };
  await pool.query(
    `INSERT INTO working_memory (key, value_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
    [GAP_PANORAMA_KEY, JSON.stringify(value)]
  );
  return uncovered.length;
}

/**
 * 主入口（scheduler-jobs handler）：窗口 gate → 20h 去重 → 三源聚合 → 一次 LLM → 写候选 → 写全景。
 * @param {import('pg').Pool} pool
 * @param {{now?: Date, llm?: Function}} [opts] 测试注入
 */
export async function maybeRunDirectionProposer(pool, { now = new Date(), llm = callLLM } = {}) {
  if (!isInDirectionProposerWindow(now)) {
    return { triggered: false };
  }
  if (await alreadyProposedThisWeek(pool)) {
    return { triggered: true, skipped: true };
  }

  const [gaps, exhausted, direct] = await Promise.all([
    collectKrGaps(pool),
    collectExhaustedLines(pool),
    getDirectCandidates(pool),
  ]);

  const { candidates, llmFailed } = await proposeCandidates(llm, { gaps, exhausted, direct });
  const { inserted, skippedDuplicates, failed } = await insertCandidates(pool, candidates);

  // 覆盖 = 本次新候选 + 直投池既有 candidate 的 kr_id 命中
  const coveredKrIds = new Set(
    [...inserted.map((i) => i.kr_id), ...direct.map((d) => d.kr_id)].filter(Boolean)
  );
  const gapsUncovered = await writeGapPanorama(pool, gaps, coveredKrIds);

  return {
    triggered: true,
    proposed: inserted.length,
    skippedDuplicates,
    failed,
    gapsTotal: gaps.length,
    gapsUncovered,
    exhaustedLines: exhausted.length,
    llmFailed,
  };
}
