/**
 * Step 03 审查任务注册测试
 *
 * 验证 03-prci.md 在 push 后、PR 创建前包含向 Brain API 注册
 * cto_review、code_quality_review、prd_coverage_audit、dod_verify 四个审查任务的逻辑
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const STEP03_PATH = join(
  __dirname,
  "../../skills/dev/steps/03-prci.md"
);

describe("Step 03 审查任务注册", () => {
  const content = readFileSync(STEP03_PATH, "utf8");

  it("在 push（8.5）和 PR 创建（8.6）之间包含审查注册逻辑", () => {
    const pushIdx = content.indexOf("8.5 推送");
    const prIdx = content.indexOf("8.6 创建 PR");
    const regIdx = content.indexOf("8.5.1 向 Brain 注册审查任务");

    expect(pushIdx).toBeGreaterThan(-1);
    expect(prIdx).toBeGreaterThan(-1);
    expect(regIdx).toBeGreaterThan(-1);
    // 注册逻辑在 push 之后
    expect(regIdx).toBeGreaterThan(pushIdx);
    // 注册逻辑在 PR 创建之前
    expect(regIdx).toBeLessThan(prIdx);
  });

  it("注册 cto_review 任务并写入 .dev-mode 文件", () => {
    expect(content).toContain("cto_review");
    expect(content).toContain("cto_review_task_id");
    expect(content).toContain("cto_review_status: pending");
  });

  it("注册 dod_verify 任务并写入 .dev-mode 文件", () => {
    expect(content).toContain("dod_verify");
    expect(content).toContain("dod_verify_task_id");
    expect(content).toContain("dod_verify_status: pending");
  });

  it("注册 prd_coverage_audit 任务并写入 .dev-mode 文件", () => {
    expect(content).toContain("prd_coverage_audit");
    expect(content).toContain("prd_audit_task_id");
    expect(content).toContain("prd_audit_status: pending");
  });

  it("Brain 不可用时跳过注册（curl --max-time 5）", () => {
    expect(content).toContain("max-time 5");
    expect(content).toContain("Brain 不可用");
  });

  it("所有任务使用 P0 优先级", () => {
    // 匹配 priority 字段在 JSON 中（bash 中用 \" 转义）
    const p0Matches = content.match(/\\"priority\\":\\"P0\\"/g);
    expect(p0Matches).not.toBeNull();
    expect(p0Matches!.length).toBe(4);
  });

  it("注册时传入分支名作为 metadata", () => {
    // 每个 curl 请求中包含 metadata.branch（bash 中用 \" 转义）
    const metadataMatches = content.match(/\\"metadata\\":\{.*?\\"branch\\"/g);
    expect(metadataMatches).not.toBeNull();
    expect(metadataMatches!.length).toBe(4);
  });
});
