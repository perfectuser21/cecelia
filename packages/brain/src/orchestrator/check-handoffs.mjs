/**
 * check-handoffs — Commander 交接契约机械校验器（CHECKS→CONTRACTS 九格+八格）
 *
 * 为什么存在（r40/r42/r53 案卷 + 决策 28ca1f69）：
 * Commander 各格收口时，机械可判的项（产出物合规、记录落库、状态迁移…）此前混在
 * LLM 语义审查里靠「眼睛看」，不确定且可被工人编造格式合法的假值绕过。本模块把
 * CHECKS 扩为 CONTRACTS：coding 线九格 + leadgen 线八格，每格 precondition /
 * postcondition / side_effects 三段、六类可参数化断言，输出确定性
 * PASS / FAIL / UNDECIDABLE + 退出码。机械项判定不再进 LLM 语义审查。
 *
 * INV-1（机械判定不信 handoff 抄写值）：
 *   - CODING_CELLS 派生自真实 home-sequencer.STAGE_ORDER（不 hardcode 一份九格）。
 *   - artifact_compliance / negative_boundary 一律真调 handoff-schemas.validateHandoffObject
 *     （不另写一套宽松形状校验）。
 *   - record_persisted / externally_visible 只走 ctx.resolvers.*（服务端权威源）；
 *     resolver 缺席 → UNDECIDABLE（fail-closed，绝不静默 PASS），忽略 handoff 自报值。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { STAGE_ORDER } from './home-sequencer.js';
import { validateHandoffObject } from './handoff-schemas.js';

/** coding 九格：真实 STAGE_ORDER 去掉 __run_init / __run_finalize（派生，禁 hardcode） */
export const CODING_CELLS = Object.freeze(STAGE_ORDER.filter((s) => !s.startsWith('__')));

/**
 * leadgen 八格 SSOT（本 sprint 新建 [NEW_PATTERN]，funnel 惯例）。
 * leadgen 线现驻 OpenClaw，repo 无权威格序；机械只锁「恰 8 格 + 与 coding 无交集 +
 * 三段结构」，真实业务语义待主理人确认（judgment-pending-user）。
 */
export const LEADGEN_CELLS = Object.freeze([
  'source', 'enrich', 'score', 'qualify', 'route', 'outreach', 'nurture', 'handoff',
]);

/** 六类断言（封闭、冻结不可变） */
export const ASSERTION_CATEGORIES = Object.freeze([
  'artifact_compliance',
  'record_persisted',
  'externally_visible',
  'state_transition',
  'numeric_threshold',
  'negative_boundary',
]);

/** 状态三值封闭枚举 */
const PASS = 'PASS';
const FAIL = 'FAIL';
const UNDECIDABLE = 'UNDECIDABLE';

/**
 * coding 九格契约。每格三段，断言 id 在格内唯一、category ∈ 六类，union 非空。
 * 代表性断言对齐 contract-draft「CONTRACTS 格→类目映射」，六类每类至少一格覆盖。
 */
const CODING_CONTRACTS = {
  plan: {
    precondition: [],
    postcondition: [
      { id: 'plan.post.prd', category: 'artifact_compliance', handoff_kind: 'planner_prd_artifact', field: 'planner_prd' },
    ],
    side_effects: [],
  },
  contract: {
    precondition: [],
    postcondition: [
      { id: 'contract.post.seal_coords', category: 'artifact_compliance', handoff_kind: 'seal_coordinates', field: 'seal_coordinates' },
    ],
    side_effects: [],
  },
  seal: {
    precondition: [],
    postcondition: [
      { id: 'seal.post.sealed', category: 'artifact_compliance', handoff_kind: 'sealed_contract', field: 'sealed_contract' },
    ],
    side_effects: [],
  },
  generate: {
    precondition: [],
    postcondition: [
      // 复用真实 validateHandoffObject('candidate_coordinates', handoff.candidate)：
      // 缺 source_attempt_id 等 → FAIL 点名字段。
      { id: 'generate.post.candidate', category: 'artifact_compliance', handoff_kind: 'candidate_coordinates', field: 'candidate' },
      // 候选 attempt 是否真落库：走 ctx.resolvers.dbCount 带时间窗；无 resolver → UNDECIDABLE。
      { id: 'generate.post.persisted', category: 'record_persisted', table: 'attempts', where: 'run_id', min_count: 1, within_seconds: 300 },
    ],
    side_effects: [
      // 内置 tampered=非法 candidate，shape 层必须拒（漏网即 FAIL）。
      { id: 'generate.side.tamper', category: 'negative_boundary', handoff_kind: 'candidate_coordinates', tampered: { repo: 'x' } },
    ],
  },
  evaluate: {
    precondition: [],
    postcondition: [
      { id: 'evaluate.post.transition', category: 'state_transition', from_field: 'prev_status', to_field: 'next_status', allowed: [['in_progress', 'completed']] },
      { id: 'evaluate.post.score', category: 'numeric_threshold', field: 'score', min: 7 },
    ],
    side_effects: [],
  },
  judge: {
    precondition: [],
    postcondition: [
      { id: 'judge.post.score', category: 'numeric_threshold', field: 'judge_score', min: 7 },
    ],
    side_effects: [],
  },
  publish: {
    precondition: [],
    postcondition: [
      { id: 'publish.post.pr', category: 'artifact_compliance', handoff_kind: 'published_pr', field: 'published_pr' },
      // published_pr 的 PR URL 外部真可见：走 ctx.resolvers.probe；无 resolver → UNDECIDABLE。
      { id: 'publish.post.visible', category: 'externally_visible', probe_kind: 'url', target: 'pr_url' },
    ],
    side_effects: [],
  },
  merge: {
    precondition: [],
    postcondition: [
      { id: 'merge.post.transition', category: 'state_transition', from_field: 'pr_state', to_field: 'merge_state', allowed: [['open', 'merged']] },
    ],
    side_effects: [],
  },
  cleanup: {
    precondition: [],
    postcondition: [
      { id: 'cleanup.post.transition', category: 'state_transition', from_field: 'run_state', to_field: 'final_state', allowed: [['finalizing', 'done']] },
    ],
    side_effects: [],
  },
};

/**
 * leadgen 八格契约：机械只锁结构（三段 + union 非空 + category 合法 + id 唯一），
 * 具体业务语义待主理人确认后按 SSOT 更新，引擎与结构不变。
 */
const LEADGEN_CONTRACTS = Object.fromEntries(
  LEADGEN_CELLS.map((cell) => [
    cell,
    {
      precondition: [],
      postcondition: [
        { id: `${cell}.post.transition`, category: 'state_transition', from_field: 'prev_stage', to_field: 'next_stage', allowed: [['pending', 'done']] },
      ],
      side_effects: [],
    },
  ]),
);

/** 17 格全覆盖（coding 九格 + leadgen 八格），按格独立键，无共享引用导致串格。 */
export const CONTRACTS = Object.freeze({ ...CODING_CONTRACTS, ...LEADGEN_CONTRACTS });

/**
 * 六类断言的确定性判定引擎。
 * @param {object} assertion 断言描述（含 category 与该类参数）
 * @param {object} handoff   交接对象（工人递交，不可信）
 * @param {object} ctx       权威上下文（ctx.resolvers.dbCount / probe 为服务端权威源）
 * @returns {Promise<{status: 'PASS'|'FAIL'|'UNDECIDABLE', reason: string}>}
 */
export async function evaluateAssertion(assertion, handoff, ctx) {
  const a = assertion ?? {};
  const h = handoff ?? {};
  const resolvers = ctx?.resolvers ?? {};

  switch (a.category) {
    case 'artifact_compliance': {
      // 复用真实 shape 层，禁另写形状校验。
      const value = a.field ? h[a.field] : h;
      const r = validateHandoffObject(a.handoff_kind, value ?? {});
      return r.ok
        ? { status: PASS, reason: '' }
        : { status: FAIL, reason: `artifact_compliance_fail:${r.issues.join('; ')}` };
    }

    case 'negative_boundary': {
      // 对本应非法的 tampered 输入跑真实 shape 校验：被拒 → PASS（越界真被拦）；
      // 漏网（校验通过）→ FAIL（视为漏洞）。
      const r = validateHandoffObject(a.handoff_kind, a.tampered ?? {});
      return r.ok
        ? { status: FAIL, reason: 'negative_boundary_slipped:tampered_input_passed_shape' }
        : { status: PASS, reason: '' };
    }

    case 'state_transition': {
      const from = h[a.from_field];
      const to = h[a.to_field];
      const allowed = Array.isArray(a.allowed) ? a.allowed : [];
      const hit = allowed.some((pair) => Array.isArray(pair) && pair[0] === from && pair[1] === to);
      return hit
        ? { status: PASS, reason: '' }
        : { status: FAIL, reason: `state_transition_forbidden:${String(from)}->${String(to)}` };
    }

    case 'numeric_threshold': {
      const v = h[a.field];
      if (typeof v !== 'number' || Number.isNaN(v)) {
        return { status: FAIL, reason: `numeric_threshold_not_a_number:${a.field}` };
      }
      const min = typeof a.min === 'number' ? a.min : -Infinity;
      const max = typeof a.max === 'number' ? a.max : Infinity;
      return v >= min && v <= max
        ? { status: PASS, reason: '' }
        : { status: FAIL, reason: `numeric_threshold_out_of_range:${v}∉[${min},${max}]` };
    }

    case 'record_persisted': {
      // INV-1：只信服务端权威计数，无 resolver → UNDECIDABLE（不放行），忽略 handoff 自报值。
      const dbCount = resolvers.dbCount;
      if (typeof dbCount !== 'function') {
        return { status: UNDECIDABLE, reason: 'record_persisted_no_db_resolver' };
      }
      try {
        const count = Number(await dbCount({ table: a.table, where: a.where, within_seconds: a.within_seconds }));
        const min = typeof a.min_count === 'number' ? a.min_count : 1;
        return count >= min
          ? { status: PASS, reason: '' }
          : { status: FAIL, reason: `record_persisted_count_below_min:${count}<${min}` };
      } catch (e) {
        return { status: UNDECIDABLE, reason: `record_persisted_resolver_error:${e.message}` };
      }
    }

    case 'externally_visible': {
      const probe = resolvers.probe;
      if (typeof probe !== 'function') {
        return { status: UNDECIDABLE, reason: 'externally_visible_no_probe_resolver' };
      }
      try {
        const visible = await probe({ probe_kind: a.probe_kind, target: a.target });
        return visible
          ? { status: PASS, reason: '' }
          : { status: FAIL, reason: `externally_visible_not_visible:${a.target}` };
      } catch (e) {
        return { status: UNDECIDABLE, reason: `externally_visible_probe_error:${e.message}` };
      }
    }

    default:
      // 未知 category 绝不静默 PASS。
      return { status: FAIL, reason: `unknown_category:${String(a.category)}` };
  }
}

/**
 * 跑某格全部三段断言，输出结构化判定。
 * @param {string} cell  格标识
 * @param {object} handoff 交接对象
 * @param {object} ctx     权威上下文
 * @returns {Promise<{cell: string, ok: boolean, results: Array<object>}>}
 * @throws {Error} 未知格标识 → `unknown_cell:<id>`（绝不静默 PASS）
 */
export async function runCellContracts(cell, handoff, ctx) {
  const contract = CONTRACTS[cell];
  if (!contract) throw new Error(`unknown_cell:${cell}`);

  const results = [];
  for (const phase of ['precondition', 'postcondition', 'side_effects']) {
    for (const assertion of contract[phase] ?? []) {
      const r = await evaluateAssertion(assertion, handoff, ctx);
      results.push({
        id: assertion.id,
        phase,
        category: assertion.category,
        status: r.status,
        reason: r.reason ?? '',
      });
    }
  }
  // ok 当且仅当每条 PASS；任一 FAIL / UNDECIDABLE → false。
  const ok = results.every((r) => r.status === PASS);
  return { cell, ok, results };
}

// ─────────────────────────── CLI ───────────────────────────
// node check-handoffs.mjs <cellId> <handoffJsonPath> [contextJsonPath]
// node check-handoffs.mjs --cells

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * 从 contextJsonPath 构造 resolvers：只从权威 context 读值（db_default_count /
 * external_default），绝不从 handoff 自报字段取值。key 缺席则不装 resolver → UNDECIDABLE。
 */
function buildCtxFromContext(context) {
  const resolvers = {};
  if (context && Object.prototype.hasOwnProperty.call(context, 'db_default_count')) {
    resolvers.dbCount = async () => Number(context.db_default_count);
  }
  if (context && Object.prototype.hasOwnProperty.call(context, 'external_default')) {
    resolvers.probe = async () => Boolean(context.external_default);
  }
  return { resolvers };
}

async function main(argv) {
  const [arg1, handoffPath, contextPath] = argv;

  if (arg1 === '--cells') {
    process.stdout.write(`CELLS coding=${CODING_CELLS.length} leadgen=${LEADGEN_CELLS.length} total=${CODING_CELLS.length + LEADGEN_CELLS.length}\n`);
    return 0;
  }

  if (!arg1 || !handoffPath) {
    process.stdout.write(`${JSON.stringify({ error: 'usage: check-handoffs.mjs <cellId> <handoffJsonPath> [contextJsonPath] | --cells' })}\n`);
    return 2;
  }

  const handoff = readJson(handoffPath);
  const context = contextPath ? readJson(contextPath) : null;
  const ctx = buildCtxFromContext(context);

  try {
    const res = await runCellContracts(arg1, handoff, ctx);
    // 单一 JSON 对象输出（含 summary 字段，内嵌 `SUMMARY cell=<格> ok=<bool>` 供 grep），
    // 整段可被 JSON.parse——满足 E2E「JSON.parse(整个 stdout)」与 DoD grep 双约束。
    const summary = `SUMMARY cell=${res.cell} ok=${res.ok}`;
    process.stdout.write(`${JSON.stringify({ ...res, summary })}\n`);
    return res.ok ? 0 : 1;
  } catch (e) {
    if (/^unknown_cell:/.test(e.message)) {
      process.stdout.write(`${JSON.stringify({ error: e.message })}\n`);
      return 2;
    }
    process.stdout.write(`${JSON.stringify({ error: e.message })}\n`);
    return 3;
  }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => {
      process.stdout.write(`${JSON.stringify({ error: e.message })}\n`);
      process.exit(3);
    });
}
