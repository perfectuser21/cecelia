/**
 * B7 — entrypoint CECELIA_EXECUTOR=codex 分支 + 退出码真实性 + token 洗敏
 * Red 阶段：entrypoint.sh 尚无 CECELIA_EXECUTOR=codex 分支逻辑，测试预期失败。
 * 注：entrypoint.sh 是 bash 脚本，这里通过 shell exec 或内容断言验证。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const ENTRYPOINT = path.resolve('/workspace/docker/cecelia-runner/entrypoint.sh');

describe('B7: entrypoint.sh CECELIA_EXECUTOR=codex 分支', () => {
  it('entrypoint.sh 包含 CECELIA_EXECUTOR=codex 条件分支', () => {
    const content = readFileSync(ENTRYPOINT, 'utf8');
    // Must have a branch checking CECELIA_EXECUTOR
    expect(content).toMatch(/CECELIA_EXECUTOR.*codex/);
  });

  it('entrypoint.sh 包含 codex exec 命令（含 approval_policy + sandbox_mode）', () => {
    const content = readFileSync(ENTRYPOINT, 'utf8');
    expect(content).toMatch(/codex\s+exec/);
    expect(content).toMatch(/approval_policy.*never/);
    expect(content).toMatch(/sandbox_mode.*danger-full-access/);
  });

  it('entrypoint.sh codex 分支使用 PIPESTATUS[0] 取真退出码', () => {
    const content = readFileSync(ENTRYPOINT, 'utf8');
    // The codex branch should use PIPESTATUS to capture the real exit code
    // (not just $? which captures tee's exit code)
    // Look for PIPESTATUS after the codex exec call
    expect(content).toMatch(/PIPESTATUS\[0\]/);
  });

  it('entrypoint.sh 包含错误关键词改判逻辑（exit=0 + stdout 含 401 → 非零）', () => {
    const content = readFileSync(ENTRYPOINT, 'utf8');
    // Should have logic to detect error keywords in stdout and override exit code
    expect(content).toMatch(/401|unauthorized|usage\s+limit|stream\s+error/i);
  });

  it('entrypoint.sh 包含 token 洗敏（ghp_/gho_/ghs_/github_pat_）', () => {
    const content = readFileSync(ENTRYPOINT, 'utf8');
    // Should have sed or similar to scrub tokens before callback
    expect(content).toMatch(/ghp_|gho_|ghs_|github_pat_/);
    // Should have a substitution/replacement
    expect(content).toMatch(/sed|replace|\*\*\*/);
  });

  it('entrypoint.sh 包含 "goal-hook N/A for codex" 日志', () => {
    const content = readFileSync(ENTRYPOINT, 'utf8');
    expect(content).toMatch(/goal-hook N\/A for codex/);
  });

  it('entrypoint.sh 包含 CODEX_RELAY_HOME 挂载环境变量引用', () => {
    const content = readFileSync(ENTRYPOINT, 'utf8');
    // The codex runner should reference CODEX_RELAY_HOME or ~/.codex-team2
    expect(content).toMatch(/CODEX_RELAY_HOME|\.codex-team2/);
  });
});
