/**
 * capture-triage.js — 收件箱四路分诊 tick job（九要素T10）
 *
 * 读 capture_atoms（status='pending_review'，仅三类新来源 handoff/learning/issue），
 * 便宜规则优先、LLM 兜底，四路：urgent / line_backlog / invariant / okr。
 * invariant 路必须过 invariant-gate 四查才允许写 decisions。
 * scheduler-jobs 注册，handler 内置间隔 gate（复用"模块自 gate"模型）。
 * Spec: docs/superpowers/specs/2026-07-10-capture-inbox-t10-design.md
 */
import { callLLM } from './llm-caller.js';
import { checkInvariantCandidate } from './invariant-gate.js';

export const TRIAGE_SOURCE_TYPES = ['handoff', 'learning', 'issue'];
export const ROUTES = ['urgent', 'line_backlog', 'invariant', 'okr'];
export const LLM_CONFIDENCE_FLOOR = 0.7;

/** 便宜规则层（addendum 规则表 1:1）。命中 → {route, confidence}，不命中 → null。 */
export function applyCheapRules(atom) {
  const t = atom.target_type;
  const s = atom.target_subtype;
  if (t === 'issue' && (s === 'P0' || s === 'P1')) return { route: 'urgent', confidence: 1.0 };
  if (t === 'learning' && (atom.content || '').includes('根本原因')) return { route: 'invariant', confidence: 0.8 };
  if (t === 'handoff' && s === 'FAIL') return { route: 'line_backlog', confidence: 0.9 };
  if (t === 'handoff' && s === 'PASS+NEXT') return { route: 'line_backlog', confidence: 0.7 };
  return null;
}

const INTERVAL_MS = parseInt(process.env.CECELIA_CAPTURE_TRIAGE_INTERVAL_MS || String(10 * 60 * 1000), 10);
const BATCH = parseInt(process.env.CECELIA_CAPTURE_TRIAGE_BATCH || '20', 10);
const LLM_ENABLED = process.env.CECELIA_CAPTURE_TRIAGE_LLM !== 'off';

let lastRunAt = 0;
export function __resetCaptureTriageForTest() { lastRunAt = 0; }

const TRIAGE_LLM_PROMPT = (atom) => `你是 Cecelia 的收件箱分诊员。一条系统产出需要归入四路之一，只输出 JSON。

## 四路定义
- urgent: 需要立即插队处理的紧急问题
- line_backlog: 挂到业务线 backlog 的后续工作
- invariant: 候选铁律（普适的"永远要/永远不要"准则）
- okr: 战略/目标层面的输入

## 条目（来源=${atom.target_type}，标记=${atom.target_subtype ?? '无'}）
${atom.content}

只输出 JSON：{"route":"urgent|line_backlog|invariant|okr","confidence":0.0-1.0,"reason":"一句话"}`;

function extractJsonObject(text) {
  try { const p = JSON.parse(text); if (p && typeof p === 'object' && !Array.isArray(p)) return p; } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

async function updateAtom(pool, id, { status = null, routedToTable = null, routedToId = null, confidence = null, aiReason }) {
  const sets = [`ai_reason = $2`, `updated_at = now()`];
  const params = [id, aiReason];
  if (status) { sets.push(`status = '${status === 'confirmed' ? 'confirmed' : 'pending_review'}'`); }
  if (routedToTable) { params.push(routedToTable); sets.push(`routed_to_table = $${params.length}`); }
  if (routedToId) { params.push(routedToId); sets.push(`routed_to_id = $${params.length}`); }
  if (confidence != null) { params.push(confidence); sets.push(`confidence = $${params.length}`); }
  await pool.query(`UPDATE capture_atoms SET ${sets.join(', ')} WHERE id = $1`, params);
}

/** 四路落地。返回该条是否成功处理。 */
async function routeAtom(pool, atom, verdict, opts) {
  const { route, confidence, reason = '' } = verdict;
  if (route === 'urgent') {
    return updateAtom(pool, atom.id, { status: 'confirmed', confidence, aiReason: `[triage:urgent] ${reason}` });
  }
  if (route === 'line_backlog') {
    let journeyId = null;
    if (atom.routed_to_table === 'tasks' && atom.routed_to_id) {
      const { rows } = await pool.query(`SELECT payload->>'journey_id' AS journey_id FROM tasks WHERE id = $1::uuid`, [atom.routed_to_id]);
      journeyId = rows[0]?.journey_id ?? null;
    }
    if (!journeyId) {
      return updateAtom(pool, atom.id, { confidence, aiReason: `[triage:no_journey] 源无 journey_id，留人工复核。${reason}` });
    }
    return updateAtom(pool, atom.id, { status: 'confirmed', routedToTable: 'journeys', routedToId: journeyId, confidence, aiReason: `[triage:line_backlog] ${reason}` });
  }
  if (route === 'invariant') {
    const gate = await checkInvariantCandidate(pool, atom, opts);
    if (!gate.pass) {
      return updateAtom(pool, atom.id, { confidence, aiReason: `[triage:gate_fail] ${gate.reason} checks=${JSON.stringify(gate.checks)}` });
    }
    const { rows } = await pool.query(
      `INSERT INTO decisions (category, topic, decision, reason, level, target_type, target_id, scope)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      ['invariant', `[capture-triage] ${atom.content.slice(0, 80)}`, atom.content, `invariant-gate PASS: ${gate.reason}`, 'area', null, null, null]
    );
    return updateAtom(pool, atom.id, { status: 'confirmed', routedToTable: 'decisions', routedToId: rows[0].id, confidence, aiReason: `[triage:invariant] gate PASS. ${reason}` });
  }
  if (route === 'okr') {
    return updateAtom(pool, atom.id, { status: 'confirmed', confidence, aiReason: `[triage:okr] ${reason}` });
  }
  return updateAtom(pool, atom.id, { aiReason: `[triage:unknown_route] ${route}` });
}

/**
 * 主入口（scheduler-jobs handler）。内置间隔 gate；LLM 可注入（测试）/可关（env）。
 * @returns {{skipped?: true, processed: number, failed: number}}
 */
export async function runCaptureTriage(pool, { llm = callLLM } = {}) {
  const now = Date.now();
  if (now - lastRunAt < INTERVAL_MS) return { skipped: true, processed: 0, failed: 0 };
  lastRunAt = now;

  const { rows: atoms } = await pool.query(
    `SELECT id, content, target_type, target_subtype, routed_to_table, routed_to_id, ai_reason
     FROM capture_atoms
     WHERE status = 'pending_review'
       AND target_type = ANY($1)
       AND (ai_reason IS NULL OR ai_reason NOT LIKE '[triage:llm_failed]%')
     ORDER BY created_at ASC
     LIMIT $2`,
    [TRIAGE_SOURCE_TYPES, BATCH]
  );

  let failed = 0;
  for (const atom of atoms) {
    try {
      let verdict = applyCheapRules(atom);
      if (!verdict) {
        if (!LLM_ENABLED) continue; // 规则不中且 LLM 关闭 → 留箱
        let parsed = null;
        try {
          const { text } = await llm('thalamus', TRIAGE_LLM_PROMPT(atom), { maxTokens: 256 });
          parsed = extractJsonObject(text);
        } catch (llmErr) {
          await updateAtom(pool, atom.id, { aiReason: `[triage:llm_failed] ${llmErr.message}` });
          failed++;
          continue;
        }
        if (!parsed || !ROUTES.includes(parsed.route) || typeof parsed.confidence !== 'number') {
          await updateAtom(pool, atom.id, { aiReason: `[triage:llm_failed] unparseable` });
          failed++;
          continue;
        }
        if (parsed.confidence < LLM_CONFIDENCE_FLOOR) {
          await updateAtom(pool, atom.id, { confidence: parsed.confidence, aiReason: `[triage:low_confidence] ${parsed.reason || ''}` });
          continue;
        }
        verdict = { route: parsed.route, confidence: parsed.confidence, reason: parsed.reason || '' };
      }
      await routeAtom(pool, atom, verdict, { llm });
    } catch (err) {
      failed++;
      console.warn(`[capture-triage] atom ${atom.id} 分诊失败: ${err.message}`);
    }
  }
  return { processed: atoms.length, failed };
}
