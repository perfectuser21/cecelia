import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const wrapperPath = 'sprints/07130752-relay-a85e0582/e2e-verify.sh';

function readWrapper(): string {
  return readFileSync(wrapperPath, 'utf8');
}

describe('headed smoke contract [BEHAVIOR]', () => {
  it('e2e wrapper 调用 codex-headed-dispatch-smoke.sh', () => {
    const script = readWrapper();
    expect(script).toContain('packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh');
    expect(script).toContain('packages/quality/smoke-allowlist.txt');
  });

  it('payload 包含 mode=headed、executor=codex、orchestrator=skill-relay 且禁用 token/github_token/codex_token/thin_prd', () => {
    const script = readWrapper();
    expect(script).toContain('a85e0582-5d88-4f0b-bce6-302d898b01e7');
    expect(script).toContain('.payload.mode == "headed"');
    expect(script).toContain('.payload.executor == "codex"');
    expect(script).toContain('.payload.orchestrator == "skill-relay"');
    expect(script).toContain('has("token") | not');
    expect(script).toContain('has("github_token") | not');
    expect(script).toContain('has("codex_token") | not');
    expect(script).toContain('has("thin_prd") | not');
  });

  it('initiative_runs 含 skill-relay-codex-headed 且 phase 拒绝 failed/unknown', () => {
    const script = readWrapper();
    expect(script).toContain('FROM initiative_runs');
    expect(script).toContain("initiative_id='${TASK_ID}'");
    expect(script).toContain('skill-relay-codex-headed');
    expect(script).toContain('A_planning');
    expect(script).toContain('A_planning|planning|gan|generate|evaluate|done');
    expect(script).toContain('if [ "$PHASE" = "failed" ]; then echo "FAIL: phase=failed"; exit 1; fi');
    expect(script).not.toContain('planning|gan|generate|evaluate|done|' + 'failed');
    expect(script).not.toContain('A_planning|planning|gan|generate|evaluate|done|' + 'failed');
    expect(script).toContain('started_at');
    expect(script).not.toContain('sprint' + '_dir');
  });

  it('tui.log 存在则验真，缺失则验留痕机制且不伪造', () => {
    const script = readWrapper();
    expect(script).toContain('tui.log');
    expect(script).toContain('WARN:');
    expect(script).toContain('packages/brain/src/harness-skill-relay.js');
    expect(script).toContain('appendFileSync');
    expect(script).toContain('headed spawn');
    expect(script).toMatch(/headed|skill-relay|codex|A_planning|planning|gan|generate|evaluate|done|harness/);
    expect(script).toMatch(/token|github_token|codex_token|thin_prd|ghp_/);
    expect(script).not.toMatch(/FAIL: tui\.log 缺失|FAIL: tui\.log 缺失或为空/);
    expect(script).not.toMatch(/touch\s+"\$LOG_PATH|>>\s*"\$LOG_PATH|appendFileSync\([^)]*LOG_PATH/);
  });

  it('local_api E2E wrapper 完整验证当前 task/run/log 外部真相', () => {
    const script = readWrapper();
    expect(script).toContain('set -euo pipefail');
    expect(script).toContain('curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID"');
    expect(script).toContain('FROM initiative_runs');
    expect(script).toContain('LOG_PATH="$SPRINT_DIR/tui.log"');
    expect(script).toContain('packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh');
  });
});
