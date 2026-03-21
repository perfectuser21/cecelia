/**
 * code_review_gate 审查任务注册测试
 *
 * 验证 02-code.md 在代码写完后注册 1 个 code_review_gate Codex 任务
 * （v13.9.0 起 code_review_gate 从 Stage 3 前移到 Stage 2）
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const STEP02_PATH = join(
  __dirname,
  "../../skills/dev/steps/02-code.md"
);

describe("Stage 2 code_review_gate 审查任务注册", () => {
  const content = readFileSync(STEP02_PATH, "utf8");

  it("CI 通过后包含 code_review_gate 注册逻辑", () => {
    expect(content).toContain("code_review_gate");
    expect(content).toContain("code_review_gate_task_id");
    expect(content).toContain("code_review_gate_status: pending");
  });

  it("Brain 不可用时跳过注册（curl --max-time 5）", () => {
    expect(content).toContain("max-time 5");
    expect(content).toContain("Brain 不可用");
  });

  it("注册时使用 P0 优先级", () => {
    const p0Matches = content.match(/\\"priority\\":\\"P0\\"/g);
    expect(p0Matches).not.toBeNull();
    expect(p0Matches!.length).toBe(1);
  });

  it("注册时传入分支名作为 metadata", () => {
    const metadataMatches = content.match(/\\"metadata\\":\{.*?\\"branch\\"/g);
    expect(metadataMatches).not.toBeNull();
    expect(metadataMatches!.length).toBe(1);
  });

  it("包含 dispatch-now 立即派发逻辑", () => {
    expect(content).toContain("dispatch-now");
  });
});
