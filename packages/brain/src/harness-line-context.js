/**
 * harness-line-context.js — A-1 Context Manifest（诊断方案 A-1，2026-07-02）
 *
 * 把本 line 的 invariant 铁律 + 累积 FR（已验收行为）从"skill 里 curl 靠自觉"
 * 升级为 graph 节点代码注入（技术保证），供 proposer/generator/evaluator 三角色使用：
 *   - fetchLineContext：四层 invariant（step/journey_feature/global/area，按 decision id 去重）
 *     + 累积 FR（journey 下 ability_status IN ('done','working') 的 golden_path，按 owner_task_id 分组；
 *       读 key=golden_path.feature_id 直连，07-10 T2 对齐；不再绕 tasks.ability_id）
 *     + 最新 line_ledger 蒸馏摘要（design_docs，T3 接线）。
 *     SQL 与 routes/abilities.js 对应端点同源（直接 pool 查询不走 HTTP）；
 *     任何一路失败 → 该路降级（空数组/null）+ warn，绝不 throw（角色注入是增强不是门禁）。
 *   - formatLineContextForPrompt：行格式与 harness-planner v8.12.0 Step 0.4 逐字同构（E1 解析契约，不可变）。
 * Spec: docs/superpowers/specs/2026-07-02-a1-context-manifest-design.md
 */

const MAX_INVARIANT_LEN = 200;   // 单条铁律文字截断
const MAX_FR_LINE_LEN = 120;     // 累积 FR 单行截断
const MAX_FR_ABILITIES = 50;     // 累积 FR 最多列 50 个 ability，超出加注（T3 扩容）
const PROMPT_MAX_LEN = 12000;    // 总长兜底截断（T3 扩容 4000→12000）
const MAX_LEDGER_LEN = 4000;     // line_ledger 摘要段内容截断

// E1 解析契约段头（与 spec 逐字一致，不可变）
export const INVARIANT_SECTION_HEADER = '## Invariant 约束（铁律，本角色产出不得违反）';
export const CUMULATIVE_FR_SECTION_HEADER = '## 累积 FR（本 line 已验收行为，不得回退/重复实现）';
export const LINE_LEDGER_SECTION_HEADER = '## Line 账本（昨日蒸馏摘要）';

function clamp(s, max) {
  const str = String(s ?? '');
  return str.length > max ? `${str.slice(0, max)}…` : str;
}

/**
 * 拉取本 line 上下文。四层 invariant + 累积 FR，全部 best-effort：
 * 参数缺省跳过对应路；单路失败仅 warn 降级为空数组，绝不 throw。
 * @returns {Promise<{ invariants: object[], cumulativeFR: object[], ledger: { content: string, created_at: string|Date }|null }>}
 */
export async function fetchLineContext({ pool }, { taskId = null, abilityId = null, journeyId = null } = {}) {
  const safeQuery = async (label, sql, params) => {
    try {
      const { rows } = await pool.query(sql, params);
      return rows;
    } catch (err) {
      console.warn(`[line-context] ${label} fetch failed (non-fatal): ${err.message}`);
      return [];
    }
  };

  // 1. step 级：同源 GET /tasks/:id/golden-path-decisions?category=invariant（routes/abilities.js:250）
  const stepRows = taskId
    ? await safeQuery('step invariants', `
      SELECT d.*, gp.order_no
      FROM decisions d
      JOIN golden_path gp ON gp.id = d.target_id
      WHERE d.target_type='golden_path' AND gp.owner_task_id=$1 AND d.category=$2 AND d.status='active'
      ORDER BY gp.order_no ASC, d.created_at DESC`, [taskId, 'invariant'])
    : [];

  // 2. journey_feature 级：同源 GET /invariants?target_type=journey_feature&target_id=（routes/abilities.js:325）
  const featureRows = abilityId
    ? await safeQuery('journey_feature invariants',
      `SELECT * FROM decisions WHERE category='invariant' AND status='active' AND target_type=$1 AND target_id=$2 ORDER BY created_at DESC`,
      ['journey_feature', abilityId])
    : [];

  // 3. global + area 级：global 是全局铁律，area 保留既有业务区规则。
  // 一次查询保证同一快照；global 在 area 前，便于后续去重时保留更高层全局规则。
  const globalAndAreaRows = await safeQuery('global/area invariants',
    `SELECT * FROM decisions WHERE category='invariant' AND status='active' AND level IN ('global','area')
     ORDER BY CASE level WHEN 'global' THEN 0 ELSE 1 END, created_at DESC`,
    []);
  const globalRows = globalAndAreaRows.filter((row) => row.level === 'global');
  const areaRows = globalAndAreaRows.filter((row) => row.level !== 'global');

  // 四层按 decision id 去重合并，附 source_level（越具体越优先；global 先于 area）
  const invariants = [];
  const seen = new Set();
  for (const [source_level, rows] of [
    ['step', stepRows],
    ['journey_feature', featureRows],
    ['global', globalRows],
    ['area', areaRows],
  ]) {
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      invariants.push({ ...row, source_level });
    }
  }

  // 累积 FR：同源 GET /journeys/:id/golden-paths（routes/abilities.js:277），
  // 过滤 ability_status IN ('done','working')，按 owner_task_id 分组（ability:run=1:N）
  let cumulativeFR = [];
  if (journeyId) {
    const frRows = await safeQuery('cumulative FR', `
      SELECT jf.id AS ability_id, jf.name AS ability_name, jf.status AS ability_status,
             gp.owner_task_id, gp.id, gp.order_no, gp.feature_id, gp.note
      FROM golden_path gp
      JOIN journey_features jf ON gp.feature_id = jf.id
      WHERE jf.journey_id = $1 AND jf.status IN ('done','working')
      ORDER BY gp.owner_task_id, gp.order_no ASC`, [journeyId]);
    const groups = new Map();
    for (const r of frRows) {
      if (!groups.has(r.owner_task_id)) {
        groups.set(r.owner_task_id, {
          ability_id: r.ability_id,
          ability_name: r.ability_name,
          ability_status: r.ability_status,
          owner_task_id: r.owner_task_id,
          steps: [],
        });
      }
      groups.get(r.owner_task_id).steps.push({
        id: r.id, order_no: r.order_no, feature_id: r.feature_id, note: r.note,
      });
    }
    cumulativeFR = [...groups.values()];
  }

  // line_ledger 蒸馏摘要（T3 接线）：dreaming L1 每晚落 design_docs(type='line_ledger')，取最新一条
  let ledger = null;
  if (journeyId) {
    const ledgerRows = await safeQuery('line ledger', `
      SELECT content, created_at FROM design_docs
      WHERE type='line_ledger' AND journey_id=$1
      ORDER BY created_at DESC LIMIT 1`, [journeyId]);
    if (ledgerRows[0]?.content) {
      ledger = { content: ledgerRows[0].content, created_at: ledgerRows[0].created_at };
    }
  }

  return { invariants, cumulativeFR, ledger };
}

/**
 * 三角色注入共用 helper（proposer/generator/evaluator）：task → ids → fetch → format 一步到位。
 * task 自带 ability_id / payload.journey_id 时直接用；两者全缺（GAN 图只有 taskId）时
 * 查 tasks 行补齐。内部全吞错返回 ''（注入是增强不是门禁，绝不影响 spawn/评估）。
 *
 * @param {{ pool: object }} deps
 * @param {{ id: string, ability_id?: string|null, payload?: object|string|null }} task
 * @returns {Promise<string>} formatLineContextForPrompt 结果，或 ''
 */
export async function fetchAndFormatLineContext({ pool } = {}, task) {
  try {
    if (!pool || !task?.id) return '';
    const payload = typeof task.payload === 'string' ? JSON.parse(task.payload) : (task.payload || {});
    let abilityId = task.ability_id ?? payload.ability_id ?? null;
    let journeyId = payload.journey_id ?? null;
    if (abilityId == null && journeyId == null) {
      // 调用方只有 taskId（GAN 图场景）→ 查 tasks 行补齐
      const { rows } = await pool.query('SELECT ability_id, payload FROM tasks WHERE id=$1', [task.id]);
      const row = rows?.[0];
      if (row) {
        const rowPayload = typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload || {});
        abilityId = row.ability_id ?? rowPayload.ability_id ?? null;
        journeyId = rowPayload.journey_id ?? null;
      }
    }
    const ctx = await fetchLineContext({ pool }, { taskId: task.id, abilityId, journeyId });
    return formatLineContextForPrompt(ctx);
  } catch (err) {
    console.warn(`[line-context] fetchAndFormatLineContext failed (non-fatal): ${err.message}`);
    return '';
  }
}

/**
 * 标签：topic 里 `]` 后短语（如 `[Line04]不进群` → `不进群`）；
 * `]` 后为空（如 `[Line04]`）或无 `]` → 回落到去掉方括号字符后的 topic 前 6 字，
 * 保证不产出空标签 `- []`。
 */
function invariantLabel(topic) {
  const t = String(topic ?? '').trim();
  const idx = t.lastIndexOf(']');
  if (idx >= 0) {
    const after = t.slice(idx + 1).trim();
    if (after) return after;
  }
  return t.replace(/[[\]]/g, '').trim().slice(0, 6);
}

/**
 * 压缩为 prompt 注入段。空段省略、双空返回 ''。
 * Invariant 行格式 `- [标签] 铁律文字（来源: <层级>）` 与 planner Step 0.4 逐字同构（E1 契约，不可变）。
 */
export function formatLineContextForPrompt(ctx) {
  const inv = Array.isArray(ctx?.invariants) ? ctx.invariants : [];
  const fr = Array.isArray(ctx?.cumulativeFR) ? ctx.cumulativeFR : [];
  const sections = [];

  if (inv.length) {
    const lines = inv.map((d) =>
      `- [${invariantLabel(d.topic)}] ${clamp(d.decision, MAX_INVARIANT_LEN)}（来源: ${d.source_level}）`);
    sections.push([INVARIANT_SECTION_HEADER, ...lines].join('\n'));
  }

  if (fr.length) {
    const shown = fr.slice(0, MAX_FR_ABILITIES);
    const lines = shown.map((a) => {
      const steps = (a.steps || [])
        .map((s) => `Step${s.order_no}${s.note ? ` ${s.note}` : ''}`)
        .join(' → ');
      return clamp(`- ${a.ability_name}: ${steps}`, MAX_FR_LINE_LEN);
    });
    if (fr.length > MAX_FR_ABILITIES) lines.push(`（另有 ${fr.length - MAX_FR_ABILITIES} 个 ability 略）`);
    sections.push([CUMULATIVE_FR_SECTION_HEADER, ...lines].join('\n'));
  }

  // ledger 排最后：总长 clamp（PROMPT_MAX_LEN）时优先牺牲本段，保 E1 契约两段
  if (ctx?.ledger?.content) {
    sections.push([LINE_LEDGER_SECTION_HEADER, clamp(ctx.ledger.content, MAX_LEDGER_LEN)].join('\n'));
  }

  if (!sections.length) return '';
  return clamp(sections.join('\n\n'), PROMPT_MAX_LEN);
}
