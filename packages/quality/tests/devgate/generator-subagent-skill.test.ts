/**
 * generator-subagent-skill.test.ts
 *
 * 验证 /dev Stage 2 Generator subagent 拆出的内容合规性
 * 确保 02-code.md 包含 Generator subagent 派发章节及隔离约束
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const SKILL_FILE = resolve(
  __dirname,
  "../../../../packages/workflows/skills/dev/steps/02-code.md"
);

describe("02-code.md Generator subagent 拆出验证", () => {
  let content: string;

  beforeAll(() => {
    content = readFileSync(SKILL_FILE, "utf8");
  });

  it("文件版本号 >= 6", () => {
    const match = content.match(/version:\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(parseInt(match![1])).toBeGreaterThanOrEqual(6);
  });

  it("包含 Generator subagent 派发章节", () => {
    expect(content).toContain("Generator subagent");
    expect(content).toContain("2.2 Generator subagent");
  });

  it("Generator 隔离约束包含禁止调用 Brain API 声明（localhost:5221）", () => {
    // 文件整体包含 localhost:5221 禁止说明
    expect(content).toContain("localhost:5221");
    expect(content).toContain("禁止");
  });

  it("文件明确列出 goal_id 为 Generator prompt 禁止注入的字段", () => {
    // Generator 隔离规则：goal_id / OKR 被明确列为禁止注入的上下文字段
    // 文件中包含 goal_id 是预期行为（禁止列表中的说明）
    expect(content).toContain("goal_id");
    // 同时包含禁止说明
    expect(content).toContain("禁止");
  });

  it("文件包含禁止修改 .dev-mode 的约束声明", () => {
    // Generator 隔离规则：禁止写入 .dev-mode 文件
    expect(content).toContain(".dev-mode");
    // 同时包含"禁止"关键词
    expect(content).toContain("禁止");
  });
});
