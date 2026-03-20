/**
 * Stage 3 审查任务注册测试
 *
 * 验证 03-integrate.md 在 CI 通过后注册 1 个 code_review Codex 任务
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const STEP03_PATH = join(
  __dirname,
  "../../skills/dev/steps/03-integrate.md"
);

describe("Stage 3 code_review 审查任务注册", () => {
  const content = readFileSync(STEP03_PATH, "utf8");

  it("CI 通过后包含 code_review 注册逻辑", () => {
    expect(content).toContain("code_review");
    expect(content).toContain("code_review_task_id");
    expect(content).toContain("code_review_status: pending");
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
