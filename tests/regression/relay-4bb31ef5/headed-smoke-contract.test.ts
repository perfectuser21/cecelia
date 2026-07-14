import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 毕业自 sprints/07130939-relay-4bb31ef5/tests/（刀1 测试入册），
// wrapper 已同步毕业到 scripts/smoke/e2e/relay-4bb31ef5.sh。
// 路径按 repo root 解析，兼容任意 cwd（brain vitest cwd=packages/brain）。
const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const wrapperPath = path.join(ROOT, 'scripts/smoke/e2e/relay-4bb31ef5.sh');
const ciYmlPath = path.join(ROOT, '.github/workflows/ci.yml');

function readWrapper(): string {
  return readFileSync(wrapperPath, 'utf8');
}

function readCiYml(): string {
  return readFileSync(ciYmlPath, 'utf8');
}

describe('headed smoke contract [BEHAVIOR]', () => {
  it('e2e wrapper 调用 claude-headed-dispatch-smoke.sh', () => {
    const script = readWrapper();
    expect(script).toContain('packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh');
    expect(script).toContain('packages/quality/smoke-allowlist.txt');
  });

  it('payload 包含 mode=headed、executor=claude、orchestrator=skill-relay 且禁用 token/github_token/anthropic_token/thin_prd', () => {
    const script = readWrapper();
    expect(script).toContain('4bb31ef5-e140-41f4-9daf-9ca4a9e51216');
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
    expect(script).toContain('A_planning');
    expect(script).toContain('A_planning|planning|gan|generate|evaluate|done');
    expect(script).toContain('if [ "$PHASE" = "failed" ]; then echo "FAIL: phase=failed"; exit 1; fi');
    expect(script).not.toContain('planning|gan|generate|evaluate|done|' + 'failed');
    expect(script).not.toContain('A_planning|planning|gan|generate|evaluate|done|' + 'failed');
    expect(script).toContain('started_at');
    expect(script).not.toContain('sprint' + '_dir');
  });

  it('ci.yml claude-headed 分支 seed executor=claude 且不回归 codex-headed 既有分支', () => {
    const script = readWrapper();
    expect(script).toContain('.github/workflows/ci.yml');
    expect(script).toContain('skill-relay-claude-headed');
    expect(script).toContain('skill-relay-codex-headed');
    expect(script).toContain('"executor":"claude"');
    expect(script).toContain('"executor":"codex"');

    const ciYml = readCiYml();
    expect(ciYml).toContain('skill-relay-claude-headed');
    expect(ciYml).toContain('skill-relay-codex-headed');
    expect(ciYml).toContain('"executor":"claude"');
    expect(ciYml).toContain('"executor":"codex"');
  });

  it('ci.yml claude-headed 精确分支优先于 codex 通用/兜底分支（顺序性静态断言，Plan A — 防弱 oracle）', () => {
    // wrapper 脚本必须内嵌行号顺序性断言，而不是只做 4 条字符串存在性 grep
    const script = readWrapper();
    expect(script).toContain('CLAUDE_LINE=$(grep -n "skill-relay-claude-headed"');
    expect(script).toContain('CODEX_SEED_LINE=$(grep -n');
    expect(script).toMatch(/"\$CLAUDE_LINE"\s+-lt\s+"\$CODEX_SEED_LINE"/);

    // 真实 ci.yml 上验证：claude-headed 精确判定行号必须早于 codex 通用/兜底 executor seed 行号，
    // 否则 generator 只需在文件任意处（含注释/死分支）堆出 4 个目标字符串就能让存在性检查全绿，
    // 而"claude-headed 被误 seed 成 codex"的真实回归可能原封不动。
    const ciYml = readCiYml();
    const lines = ciYml.split('\n');
    const claudeLineIdx = lines.findIndex((l) => l.includes('skill-relay-claude-headed'));
    const codexSeedLineIdx = lines.findIndex((l) => l.includes('"executor":"codex"'));
    expect(claudeLineIdx).toBeGreaterThan(-1);
    expect(codexSeedLineIdx).toBeGreaterThan(-1);
    expect(claudeLineIdx).toBeLessThan(codexSeedLineIdx);
  });

  it('DoD.md 已记录本 sprint 的 claude-headed relay DoD', () => {
    const script = readWrapper();
    expect(script).toContain('DoD.md');
    expect(script).toMatch(/skill-relay-claude-headed\|07130939-relay-4bb31ef5/);

    const dod = readFileSync(path.join(ROOT, 'DoD.md'), 'utf8');
    expect(dod).toMatch(/skill-relay-claude-headed|07130939-relay-4bb31ef5/);
  });

  it('tui.log 存在则验真，缺失则验留痕机制且不伪造', () => {
    const script = readWrapper();
    expect(script).toContain('tui.log');
    expect(script).toContain('WARN:');
    expect(script).toContain('packages/brain/src/harness-skill-relay.js');
    expect(script).toContain('appendFileSync');
    expect(script).toContain('headed spawn');
    expect(script).toMatch(/headed|skill-relay|claude|A_planning|planning|gan|generate|evaluate|done|harness/);
    expect(script).toMatch(/token|github_token|anthropic_token|thin_prd|ghp_/);
    expect(script).not.toMatch(/FAIL: tui\.log 缺失|FAIL: tui\.log 缺失或为空/);
    expect(script).not.toMatch(/touch\s+"\$LOG_PATH|>>\s*"\$LOG_PATH|appendFileSync\([^)]*LOG_PATH/);
  });

  it('local_api E2E wrapper 完整验证当前 task/run/log/ci-seed 外部真相', () => {
    const script = readWrapper();
    expect(script).toContain('set -euo pipefail');
    expect(script).toContain('curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID"');
    expect(script).toContain('FROM initiative_runs');
    expect(script).toContain('LOG_PATH="$SPRINT_DIR/tui.log"');
    expect(script).toContain('packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh');
    expect(script).toContain('.github/workflows/ci.yml');
  });
});
