import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Sprint: sprints/07151400-relay-63db6f8a — 锚定 task_id=63db6f8a-ea55-40fa-abd2-7dd63a2701e2 的
// headed relay 派发链路回归证据。结构镜像已毕业先例
// sprints/07151245-relay-049ebf93 / tests/regression/relay-049ebf93/headed-smoke-contract.test.ts，
// 但仅锚定本次 task，不重实现 claude-headed-dispatch-smoke.sh、不改 ci.yml（4bb31ef5 已落地范围）。
// 路径按 repo root 解析，兼容任意 cwd（brain vitest cwd=packages/brain）。
const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const wrapperPath = path.join(ROOT, 'sprints/07151400-relay-63db6f8a/e2e-verify.sh');

function readWrapper(): string {
  return readFileSync(wrapperPath, 'utf8');
}

describe('headed smoke contract (task 63db6f8a) [BEHAVIOR]', () => {
  it('e2e-verify.sh 调用 claude-headed-dispatch-smoke.sh 并校验 allowlist 登记', () => {
    const script = readWrapper();
    expect(script).toContain('packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh');
    expect(script).toContain('packages/quality/smoke-allowlist.txt');
  });

  it('payload 三元组齐全且禁用 token/github_token/anthropic_token/thin_prd', () => {
    const script = readWrapper();
    expect(script).toContain('63db6f8a-ea55-40fa-abd2-7dd63a2701e2');
    expect(script).toContain('.payload.mode == "headed"');
    expect(script).toContain('.payload.executor == "claude"');
    expect(script).toContain('.payload.orchestrator == "skill-relay"');
    expect(script).toContain('has("token") | not');
    expect(script).toContain('has("github_token") | not');
    expect(script).toContain('has("anthropic_token") | not');
    expect(script).toContain('has("thin_prd") | not');
  });

  it('initiative_runs 含 skill-relay-claude-headed 且 phase 拒绝 failed/unknown', () => {
    const script = readWrapper();
    expect(script).toContain('FROM initiative_runs');
    expect(script).toContain("initiative_id='${TASK_ID}'");
    expect(script).toContain('skill-relay-claude-headed');
    expect(script).toContain('A_planning|planning|gan|generate|evaluate|done');
    expect(script).toContain('if [ "$PHASE" = "failed" ]; then echo "FAIL: phase=failed"; exit 1; fi');
    expect(script).toContain('started_at');
  });

  it('local_api E2E wrapper 完整验证当前 task/run/smoke 外部真相，无 mock/吞错', () => {
    const script = readWrapper();
    expect(script).toContain('set -euo pipefail');
    expect(script).toContain('curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID"');
    expect(script).toContain('psql "$DB"');
    expect(script).toContain('packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh');
    expect(script).not.toMatch(/MOCK_|\|\|\s*true/);
  });
});
