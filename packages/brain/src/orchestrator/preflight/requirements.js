import { parseCapabilityRequirements } from './capability-gate.js';

const GITHUB_ROLES = new Set([
  'planner',
  'proposer',
  'generator',
  'evaluator',
]);

// PostgreSQL 使用的机械指纹：批准合同的可执行验收文本里出现 `psql` 或 `pg_<x>`
// （pg_dump / pg_isready / pg_restore …）命令即视为需要真环境 PG。机械识别，不做
// 领域猜测——纯读结构字段会退回「人工在 payload 手填 postgres」的老路（本 sprint 要
// 消除的假绿面正是「无人手填 → Evaluator 无 PG 却自报 PASS」）。
const POSTGRES_COMMAND_RE = /(?:^|[^A-Za-z0-9_])(?:psql|pg_[a-z][a-z0-9_]*)(?![A-Za-z0-9_])/;

/**
 * 合同 → PostgreSQL capability 机械派生。合同可执行验收文本含 psql / pg_* 命令 → true。
 * 入参可以是合同全文字符串，或携带 content / contract_content 的对象（兼容不同调用侧）。
 */
export function contractRequiresPostgres(contract) {
  const text = typeof contract === 'string'
    ? contract
    : (contract && typeof contract === 'object'
      ? String(contract.content ?? contract.contract_content ?? contract.text ?? '')
      : '');
  if (!text) return false;
  return POSTGRES_COMMAND_RE.test(text);
}

/**
 * Build the server-owned minimum for a role, then allow the approved
 * structured contract to add requirements. Payload values can never weaken
 * the role baseline.
 *
 * 新增可选 `contract` 入参（批准合同文本/产物）：其可执行验收含 PG 使用时 postgres:true，
 * 即使 `requirements` 未手填 postgres。旧签名（无 contract）行为不变。
 */
export function deriveCapabilityRequirements({ role, requirements, contract } = {}) {
  const parsed = parseCapabilityRequirements({ requirements });
  const modelCapabilities = new Set([
    'structured_output',
    ...parsed.model_capabilities,
  ]);
  return {
    provider_auth: true,
    github: GITHUB_ROLES.has(role) || parsed.github,
    postgres: parsed.postgres || contractRequiresPostgres(contract),
    model_capabilities: [...modelCapabilities],
  };
}
