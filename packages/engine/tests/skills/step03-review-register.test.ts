/**
 * code_review_gate 审查方式测试（v4.0 — Agent subagent 架构）
 *
 * 验证 02-code.md 在代码写完后使用 Agent subagent 同步审查（非 Codex async 派发）
 * （v13.14.0 起 code_review_gate 改为 Agent subagent 同步调用，删除 Codex dispatch）
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const STEP02_PATH = join(
  __dirname,
  "../../skills/dev/steps/02-code.md"
);

describe("Stage 2 code_review_gate Agent subagent 审查", () => {
  const content = readFileSync(STEP02_PATH, "utf8");

  it("包含 code_review_gate 逻辑（改为 subagent 同步调用）", () => {
    expect(content).toContain("code_review_gate");
    expect(content).toContain("subagent");
  });

  it("不再包含 dispatch-now（Codex async 路径已删除）", () => {
    expect(content).not.toContain("dispatch-now");
  });

  it("不再包含 code_review_gate_task_id（无需 Brain 注册）", () => {
    expect(content).not.toContain("code_review_gate_task_id");
  });

  it("包含 git diff（diff 传入 subagent 审查）", () => {
    expect(content).toContain("git diff");
  });

  it("包含重试逻辑（subagent 最多 3 次，超过降级 pass）", () => {
    expect(content).toContain("3");
    // 降级处理
    expect(content).toContain("code_review_gate_degraded");
  });

  it("PASS 时写入 code_review_gate_status: pass", () => {
    expect(content).toContain("code_review_gate_status: pass");
  });
});
