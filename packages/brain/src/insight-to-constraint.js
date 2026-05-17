/**
 * insight-to-constraint —— 把 cortex_insight 文本同次 session 抽取为 dispatch_constraint DSL
 *
 * 设计动机（learning_id a4941b23）：
 *   rumination learnings 必须在同次 session 中转化为 CI 门禁或 dispatch 约束，
 *   否则认知成本沉没，learning 记录本身变成噪声。
 *
 * 模块职责：
 *   1. extractConstraintHeuristic(text) — 启发式 v1，无 LLM 依赖，识别高置信 actionable pattern
 *   2. persistConstraint(id, c, pool) — 写回 learnings.dispatch_constraint + 标记 metadata.constraint_extraction
 *   3. autoExtractAndPersist(id, text, pool) — 端到端入口，cortex.js 调用
 *
 * 兼容现有 insight-constraints.js 的 DSL（rule: deny_keyword | require_field | require_payload）。
 *
 * 启发式覆盖率有限是预期的：抽不到 → 写 metadata.constraint_extraction.status='no_match'
 * 让 lint 能区分"未尝试"和"已尝试无匹配"。LLM 抽取留给 v2。
 */

import poolDefault from './db.js';
import { isValidConstraint } from './insight-constraints.js';

const SOURCE_DEFAULT = 'heuristic-v1';

// ── 启发式 pattern ────────────────────────────────────────────────

// 1. deny_keyword on title/description
//    匹配："task title 中禁止使用 'X'" / "description 中应避免 \"X\"" / 类似
const DENY_PATTERNS = [
  // task title 中禁止/不应/应避免/不能含 "X"
  {
    field: 'title',
    re: /(?:task\s*)?title\s*(?:中)?(?:禁止使用|不应(?:使用|出现)?|应避免(?:使用)?|不能含|不能使用|不许)\s*[「『""'']([^」』""'']+)[」』""'']/i,
  },
  {
    field: 'description',
    re: /(?:task\s*)?(?:description|描述)\s*(?:中)?(?:禁止使用|不应(?:使用|出现)?|应避免(?:使用)?|不能含|不能使用|不许)\s*[「『""'']([^」』""'']+)[」』""'']/i,
  },
];

// 2. require_payload — "必须含 payload.X" / "应当包含 payload.X"
const REQUIRE_PAYLOAD_RE =
  /(?:必须|应当|必需)(?:含|包含|有|带)\s*payload\.([a-zA-Z_][\w.]*)/;

// 3. require_field min_length — "(title|description) 至少 N 字"
const REQUIRE_LEN_RE =
  /(title|description|描述|标题)\s*(?:至少|不能少于|不少于|>=|大于等于)\s*(\d+)\s*(?:字|字符)?/i;

const FIELD_NORMALIZE = { 描述: 'description', 标题: 'title' };

/**
 * 从 insight 文本启发式抽取一条 dispatch_constraint DSL。
 * 仅识别高置信 pattern；无匹配返回 null。
 *
 * @param {string} text
 * @returns {object|null}
 */
export function extractConstraintHeuristic(text) {
  if (!text || typeof text !== 'string') return null;

  const reason = text.trim().slice(0, 100);

  // pattern 1: deny_keyword
  for (const { field, re } of DENY_PATTERNS) {
    const m = text.match(re);
    if (m) {
      return {
        rule: 'deny_keyword',
        field,
        patterns: [m[1]],
        reason,
        severity: 'block',
      };
    }
  }

  // pattern 2: require_payload
  const payloadMatch = text.match(REQUIRE_PAYLOAD_RE);
  if (payloadMatch) {
    return {
      rule: 'require_payload',
      key: payloadMatch[1],
      reason,
      severity: 'block',
    };
  }

  // pattern 3: require_field min_length
  const lenMatch = text.match(REQUIRE_LEN_RE);
  if (lenMatch) {
    const fieldRaw = lenMatch[1].toLowerCase();
    const field = FIELD_NORMALIZE[fieldRaw] || fieldRaw;
    const minLength = parseInt(lenMatch[2], 10);
    if (Number.isFinite(minLength) && minLength > 0) {
      return {
        rule: 'require_field',
        field,
        min_length: minLength,
        reason,
        severity: 'warn',
      };
    }
  }

  return null;
}

/**
 * 写回 learnings.dispatch_constraint + metadata.constraint_extraction 标记。
 *
 * 行为契约：
 *   - learning 不存在 → { written:false, markedAttempted:false }
 *   - 已存在 dispatch_constraint 非 NULL → 不覆写，markedAttempted=true
 *   - constraint=null 或未通过 isValidConstraint → 不写 dispatch_constraint，但仍标记 attempted（status='no_match'）
 *   - 合法 constraint 且 dispatch_constraint 为空 → 写入并标记 attempted（status='extracted'）
 *
 * @param {string} learningId
 * @param {object|null} constraint
 * @param {object} [dbPool]
 * @param {{source?:string}} [meta]
 * @returns {Promise<{written:boolean, markedAttempted:boolean}>}
 */
export async function persistConstraint(learningId, constraint, dbPool, meta = {}) {
  const db = dbPool || poolDefault;
  const source = meta.source || SOURCE_DEFAULT;
  const attemptedAt = new Date().toISOString();

  const { rows } = await db.query(
    'SELECT dispatch_constraint, metadata FROM learnings WHERE id = $1 LIMIT 1',
    [learningId]
  );
  if (rows.length === 0) {
    return { written: false, markedAttempted: false };
  }
  const existing = rows[0];

  const validForWrite = constraint && isValidConstraint(constraint);
  const alreadyHas =
    existing.dispatch_constraint !== null && existing.dispatch_constraint !== undefined;

  let status;
  let written = false;

  if (alreadyHas) {
    status = 'already_present';
  } else if (validForWrite) {
    status = 'extracted';
  } else {
    status = 'no_match';
  }

  const baseMeta = (existing.metadata && typeof existing.metadata === 'object') ? existing.metadata : {};
  const newMeta = {
    ...baseMeta,
    constraint_extraction: {
      attempted_at: attemptedAt,
      source,
      status,
    },
  };

  if (status === 'extracted') {
    await db.query(
      `UPDATE learnings
          SET dispatch_constraint = $2::jsonb,
              metadata = $3::jsonb
        WHERE id = $1`,
      [learningId, JSON.stringify(constraint), JSON.stringify(newMeta)]
    );
    written = true;
  } else {
    await db.query(
      `UPDATE learnings
          SET metadata = $2::jsonb
        WHERE id = $1`,
      [learningId, JSON.stringify(newMeta)]
    );
  }

  return { written, markedAttempted: true };
}

/**
 * 端到端入口：抽取 + 写回。任何错误内吞，返回结构化结果，不阻塞调用方。
 *
 * @param {string} learningId
 * @param {string} insightContent
 * @param {object} [dbPool]
 * @returns {Promise<{extracted:boolean, written:boolean, constraint?:object}>}
 */
export async function autoExtractAndPersist(learningId, insightContent, dbPool) {
  const constraint = extractConstraintHeuristic(insightContent);
  const extracted = constraint !== null;
  try {
    const out = await persistConstraint(learningId, constraint, dbPool, {
      source: SOURCE_DEFAULT,
    });
    return {
      extracted,
      written: out.written,
      ...(constraint ? { constraint } : {}),
    };
  } catch (err) {
    console.warn('[insight-to-constraint] persist failed:', err.message);
    return { extracted, written: false, ...(constraint ? { constraint } : {}) };
  }
}
