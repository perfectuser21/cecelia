/**
 * handoff-schemas — V4 九格交接对象的字段契约与阶段级校验器（第 79 批）
 *
 * 为什么存在（Anthropic building-effective-agents + 多 agent 失效模式研究的一致结论）：
 * 多 agent 流水线的 bug 通常活在**交接处**，不在任何单个 agent 里；解药是每个交接点
 * 强制 schema 校验的结构化输出。本仓三发实证：
 *   r40 工人编造格式合法的假 sha（锚 task uuid 续写成 40hex）
 *   r42 工人把 contract 共享 run 当 generate 共享 run 递下去
 *   r53 candidate_coordinates 少第五字段 source_attempt_id → judge 全 PASS 后 publish 409
 *
 * 两层互补，本模块只管**形状**：
 *   ① 形状层（本模块）：字段齐不齐、格式对不对 —— 缺 source_attempt_id / 假 sha 形状 当场拒；
 *   ② 取值层（第 73/74/78 批已落地）：candidate 与 base_sha 由服务端从 git_candidate
 *      产物权威注入，工人抄写的值一律不信。
 *
 * 复用 commander-contract.js 的防泄密判据（密钥材料禁止出现在交接对象里）。
 */

import { z } from 'zod';

const SHA40 = /^[a-f0-9]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CP_BRANCH = /^cp-[A-Za-z0-9._/-]+$/;
const SPRINT_DIR = /^sprints\/[A-Za-z0-9._-]+$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GH_PR_URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*$/;
// 与 commander-contract.js 同源：交接对象里禁止夹带密钥材料
const SECRET_KEY = /token|secret|password|api[_-]?key|auth(?:entication|orization)?|credential_payload/i;

const sha40 = z.string().regex(SHA40, 'must_be_40hex');
const uuid = z.string().regex(UUID, 'must_be_uuid');
const branch = z.string().regex(CP_BRANCH, 'must_be_cp_branch');
const sprintDir = z.string().regex(SPRINT_DIR, 'must_be_sprint_dir');

/**
 * 五类交接对象：每格完工时必须交给下一格的固定件。
 * 字段清单全部来自真实案卷（Commander 台账规格 + 各批修复），不是凭空设计。
 */
export const HANDOFF_SCHEMAS = Object.freeze({
  // plan → contract
  planner_prd_artifact: z.object({
    kind: z.literal('planner_prd'),
    path: z.string().min(1),
    branch,
    head_sha: sha40,
    verification_status: z.enum(['verified', 'unverified']),
  }),
  // contract → seal（金丝雀 #14/#18 案卷：缺则 seal 必 blocked）
  seal_coordinates: z.object({
    bridge_run_id: uuid,
    sprint_dir: sprintDir,
    branch,
    approved_sha: sha40,
    base_sha: sha40,
  }),
  // seal → generate/evaluate/judge
  sealed_contract: z.object({
    contract_id: uuid,
    contract_version: z.number().int().positive(),
    approved_sha: sha40,
    branch,
    sprint_dir: sprintDir,
    base_sha: sha40,
  }),
  // generate → evaluate/judge/publish/cleanup（r53：第五字段 source_attempt_id 必需）
  candidate_coordinates: z.object({
    repo: z.string().regex(REPO, 'must_be_owner_repo'),
    branch,
    head_sha: sha40,
    bridge_run_id: uuid,
    source_attempt_id: uuid,
  }),
  // publish → merge
  published_pr: z.object({
    pr_number: z.number().int().positive(),
    pr_url: z.string().regex(GH_PR_URL, 'must_be_github_pr_url'),
    head_sha: sha40,
  }),
});

/**
 * 各阶段完工时**必须**交出的交接件。
 * 无要求的阶段（plan 自身产 artifact 但不强制、cleanup 只交单）不设硬项，零误伤。
 */
export const STAGE_REQUIRED_HANDOFFS = Object.freeze({
  contract: ['seal_coordinates'],
  seal: ['sealed_contract'],
  generate: ['candidate_coordinates'],
  'generator-fix': ['candidate_coordinates'],
  publish: ['published_pr'],
});

function scanSecrets(obj, issues) {
  for (const key of Object.keys(obj ?? {})) {
    if (SECRET_KEY.test(key)) issues.push(`secret_material_forbidden:${key}`);
  }
}

/**
 * 校验单个交接对象。
 * @returns {{ok: boolean, issues: string[]}} issues 点名到字段，供 retry feedback 直接引用
 */
export function validateHandoffObject(kind, value) {
  const schema = HANDOFF_SCHEMAS[kind];
  if (!schema) return { ok: false, issues: [`unknown_handoff_kind:${kind}`] };
  const issues = [];
  scanSecrets(value, issues);
  // type 是 evidence 条目的路由字段，不属于交接对象本身
  const { type: _type, ...payload } = value ?? {};
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.') || '(root)';
      const code = issue.code === 'invalid_type' && issue.received === 'undefined'
        ? 'missing' : (issue.message || issue.code);
      issues.push(`${path}:${code}`);
    }
  }
  return { ok: issues.length === 0, issues };
}

/**
 * 阶段级校验：该阶段要求的交接件必须出现在 evidence 里且每个都合法。
 * evidence 里的非交接条目（note/check 等）不受管。
 * @param {string} stageId
 * @param {Array<object>} evidence
 */
export function validateStageEvidence(stageId, evidence) {
  const required = STAGE_REQUIRED_HANDOFFS[stageId] ?? [];
  const items = Array.isArray(evidence) ? evidence : [];
  const issues = [];
  for (const kind of required) {
    const found = items.filter((e) => e && typeof e === 'object' && e.type === kind);
    if (found.length === 0) {
      issues.push(`missing_handoff:${kind}`);
      continue;
    }
    for (const item of found) {
      const r = validateHandoffObject(kind, item);
      if (!r.ok) issues.push(...r.issues.map((i) => `${kind}.${i}`));
    }
  }
  return { ok: issues.length === 0, issues };
}
