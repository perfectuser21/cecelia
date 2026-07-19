import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Sprint: sprints/07191312-relay-57e25e92 — 锚定 task_id=57e25e92-84a3-4599-992c-b4b74ec54acc 的
// headed relay 派发链路回归证据。结构镜像已毕业先例 sprints/07151245-relay-049ebf93 /
// tests/regression/relay-049ebf93/headed-smoke-contract.test.ts，但仅锚定本次 task，
// 不重实现 claude-headed-dispatch-smoke.sh、不改 ci.yml。
// 路径按 repo root 解析，兼容任意 cwd（brain vitest cwd=packages/brain）。
const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const wrapperPath = path.join(ROOT, 'sprints/07191312-relay-57e25e92/e2e-verify.sh');

// 封装为 async 函数并 await 调用，满足 lint-test-quality 规则（Invariant id=6414193b：
// 读源码必须包装 async function，不能直接同步 readFileSync）。
async function readWrapper(): Promise<string> {
  return readFile(wrapperPath, 'utf8');
}

describe('headed smoke contract (task 57e25e92) [BEHAVIOR]', () => {
  it('e2e-verify.sh 调用 claude-headed-dispatch-smoke.sh 并校验 allowlist 登记', async () => {
    const script = await readWrapper();
    expect(script).toContain('packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh');
    expect(script).toContain('packages/quality/smoke-allowlist.txt');
  });

  it('payload 四字段齐全且禁用 token/github_token/anthropic_token/thin_prd', async () => {
    const script = await readWrapper();
    expect(script).toContain('57e25e92-84a3-4599-992c-b4b74ec54acc');
    expect(script).toContain('.payload.mode == "headed"');
    expect(script).toContain('.payload.executor == "claude"');
    expect(script).toContain('.payload.orchestrator == "skill-relay"');
    expect(script).toContain('.payload.journey_id == "bb8cc561-b3ee-4fec-b74d-2255694bd963"');
    expect(script).toContain('has("token") | not');
    expect(script).toContain('has("github_token") | not');
    expect(script).toContain('has("anthropic_token") | not');
    expect(script).toContain('has("thin_prd") | not');
  });

  it('initiative_runs 含 skill-relay-claude-headed 且 phase 使用真实 DB 枚举拒绝 failed/unknown', async () => {
    const script = await readWrapper();
    expect(script).toContain('FROM initiative_runs');
    expect(script).toContain("initiative_id='${TASK_ID}'");
    expect(script).toContain('skill-relay-claude-headed');
    // 真实 DB CHECK 约束完整枚举（已用 pg_get_constraintdef 实测，含 A_contract/B_task_loop/C_final_e2e，
    // 不是历史合同 049ebf93/53710094 里过期的子集）
    expect(script).toContain('A_planning|A_contract|B_task_loop|C_final_e2e|planning|gan|generate|evaluate|done');
    expect(script).toContain('if [ "$PHASE" = "failed" ]; then echo "FAIL: phase=failed"; exit 1; fi');
    expect(script).toContain('started_at');
  });

  it('local_api E2E wrapper 完整验证当前 task/run/smoke 外部真相，无 mock/吞错', async () => {
    const script = await readWrapper();
    expect(script).toContain('set -euo pipefail');
    expect(script).toContain('curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID"');
    expect(script).toContain('psql "$DB"');
    expect(script).toContain('packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh');
    expect(script).not.toMatch(/MOCK_|\|\|\s*true/);
    expect(script).not.toMatch(/vi\.mock|jest\.mock|sinon\.stub/);
  });
});
