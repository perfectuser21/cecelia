/**
 * cleanup.sh + write-current-state.sh 集成契约测试
 *
 * 验证 cleanup.sh section 2.6 包含对 write-current-state.sh 的调用，
 * 确保 PR 合并后 CURRENT_STATE.md 能自动更新。
 */

import * as fs from "fs";
import * as path from "path";
import { describe, it, expect } from "vitest";

const ENGINE_ROOT = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(ENGINE_ROOT, "../..");

describe("cleanup.sh write-current-state.sh 集成契约", () => {
  const cleanupPath = path.join(
    ENGINE_ROOT,
    "skills/dev/scripts/cleanup.sh"
  );

  it("cleanup.sh 存在", () => {
    expect(fs.existsSync(cleanupPath)).toBe(true);
  });

  it("cleanup.sh 包含 write-current-state.sh 调用", () => {
    const content = fs.readFileSync(cleanupPath, "utf-8");
    expect(content).toContain("write-current-state.sh");
  });

  it("cleanup.sh 包含 [2.6] 节标题", () => {
    const content = fs.readFileSync(cleanupPath, "utf-8");
    expect(content).toContain("[2.6]");
  });

  it("write-current-state.sh 存在于 scripts/", () => {
    const scriptPath = path.join(REPO_ROOT, "scripts/write-current-state.sh");
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  it("cleanup.sh [2.6] 节在 [2.5] 之后、[3] 之前", () => {
    const content = fs.readFileSync(cleanupPath, "utf-8");
    const idx25 = content.indexOf("[2.5]");
    const idx26 = content.indexOf("[2.6]");
    const idx3 = content.indexOf("[3]  检查本地");
    expect(idx25).toBeGreaterThan(-1);
    expect(idx26).toBeGreaterThan(idx25);
    expect(idx3).toBeGreaterThan(idx26);
  });
});
