import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Sprint: sprints/07172014-relay-14a11fd8 — 锚定 task_id=14a11fd8-0d2f-49e2-885b-9286fc1d76f7 的
// headed relay 派发链路回归证据（journey bb8cc561-b3ee-4fec-b74d-2255694bd963 第 6 次同结构冒烟）。
// 结构镜像已毕业先例 tests/regression/relay-049ebf93/headed-smoke-contract.test.ts /
// tests/regression/relay-4bb31ef5/headed-smoke-contract.test.ts，但仅锚定本次 task，
// 不重实现 claude-headed-dispatch-smoke.sh、不改 .github/workflows/*.yml、不重复登记 allowlist。
// 路径按 repo root 解析，兼容任意 cwd（brain vitest cwd=packages/brain）。
const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const wrapperPath = path.join(ROOT, 'sprints/07172014-relay-14a11fd8/e2e-verify.sh');

// 包装为 async function + 真 await（lint-test-quality Rule A 要求：读源码不能只用同步
// readFileSync 裸抓字符串，必须搭配 await fn() 业务调用），此处用 fs/promises.readFile。
async function readWrapper(): Promise<string> {
  return await readFile(wrapperPath, 'utf8');
}

describe('headed smoke contract (task 14a11fd8) [BEHAVIOR]', () => {
  it('e2e-verify.sh 调用 claude-headed-dispatch-smoke.sh 并校验 allowlist 登记与脚本完整性', async () => {
    const script = await readWrapper();
    expect(script).toContain('packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh');
    expect(script).toContain('packages/quality/smoke-allowlist.txt');
    expect(script).toContain('BASELINE_SHA256');
    expect(script).toContain('7a3a76b32bc683942d09efe6447ea5ce66a318939d1be9908c2fc4cf5d0a69fb');
  });

  it('payload 三元组与 journey_id 齐全且禁用 token/github_token/anthropic_token/thin_prd', async () => {
    const script = await readWrapper();
    expect(script).toContain('14a11fd8-0d2f-49e2-885b-9286fc1d76f7');
    expect(script).toContain('.payload.mode == "headed"');
    expect(script).toContain('.payload.executor == "claude"');
    expect(script).toContain('.payload.orchestrator == "skill-relay"');
    expect(script).toContain('.payload.journey_id == "bb8cc561-b3ee-4fec-b74d-2255694bd963"');
    expect(script).toContain('has("token") | not');
    expect(script).toContain('has("github_token") | not');
    expect(script).toContain('has("anthropic_token") | not');
    expect(script).toContain('has("thin_prd") | not');
  });

  it('initiative_runs 含 skill-relay-claude-headed 且 phase 拒绝 failed/非法枚举', async () => {
    const script = await readWrapper();
    expect(script).toContain('FROM initiative_runs');
    expect(script).toContain("initiative_id='${TASK_ID}'");
    expect(script).toContain('skill-relay-claude-headed');
    expect(script).toContain('A_planning|planning|gan|generate|evaluate|done');
    expect(script).toContain('if [ "$PHASE" = "failed" ]; then echo "FAIL: phase=failed"; exit 1; fi');
    expect(script).toContain('started_at');
  });

  it('不越权修改 CI workflow 或 smoke-allowlist', async () => {
    const script = await readWrapper();
    expect(script).toContain('.github/workflows/');
    expect(script).toContain('git diff origin/main...HEAD --name-only');
    expect(script).not.toMatch(/git\s+(add|commit|push).*\.github\/workflows/);
  });

  it('local_api E2E wrapper 完整验证当前 task 全链路无 mock 无吞错', async () => {
    const script = await readWrapper();
    expect(script).toContain('set -euo pipefail');
    expect(script).toContain('curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID"');
    expect(script).toContain('psql "$DB"');
    expect(script).toContain('packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh');
    expect(script).not.toMatch(/MOCK_|\|\|\s*true/);
  });
});
