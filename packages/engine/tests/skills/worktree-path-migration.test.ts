/**
 * Worktree 路径迁移测试
 *
 * 验证 worktree 路径从 ${main_wt}-wt-${name} 迁移到 .claude/worktrees/${name}
 * 以及 Stop Hook 强制清理 worktree 的兜底机制
 */

import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const PROJECT_ROOT = resolve(__dirname, "../..");
const WORKTREE_MANAGE = resolve(
  PROJECT_ROOT,
  "skills/dev/scripts/worktree-manage.sh"
);
const STOP_DEV = resolve(PROJECT_ROOT, "hooks/stop-dev.sh");
const CLEANUP = resolve(PROJECT_ROOT, "skills/dev/scripts/cleanup.sh");
const GITIGNORE = resolve(PROJECT_ROOT, ".gitignore");
const VITEST_CONFIG = resolve(PROJECT_ROOT, "vitest.config.ts");

describe("Worktree path migration", () => {
  describe("worktree-manage.sh", () => {
    it("should pass syntax check", () => {
      expect(() => {
        execSync(`bash -n "${WORKTREE_MANAGE}"`, { encoding: "utf-8" });
      }).not.toThrow();
    });

    it("should generate .claude/worktrees/ path", () => {
      const content = readFileSync(WORKTREE_MANAGE, "utf-8");
      expect(content).toContain('.claude/worktrees/');
      expect(content).toContain('generate_worktree_path()');
      // 新路径格式
      expect(content).toContain('${main_wt}/.claude/worktrees/${task_name}');
    });

    it("should auto-add .claude/worktrees/ to .gitignore on create", () => {
      const content = readFileSync(WORKTREE_MANAGE, "utf-8");
      expect(content).toContain('.claude/worktrees/');
      expect(content).toContain('.gitignore');
    });

    it("should support both new and old paths in safe_rm_rf", () => {
      const content = readFileSync(WORKTREE_MANAGE, "utf-8");
      // 新路径检测
      expect(content).toContain('"$worktree_path" == *"/.claude/worktrees/"*');
      // 旧路径 fallback
      expect(content).toContain('dirname "$(get_main_worktree)"');
    });

    it("should mkdir -p parent directory before creating worktree", () => {
      const content = readFileSync(WORKTREE_MANAGE, "utf-8");
      expect(content).toContain('mkdir -p "$(dirname "$worktree_path")"');
    });
  });

  describe("stop-dev.sh", () => {
    it("should pass syntax check", () => {
      expect(() => {
        execSync(`bash -n "${STOP_DEV}"`, { encoding: "utf-8" });
      }).not.toThrow();
    });

    it("should have force_cleanup_worktree function", () => {
      const content = readFileSync(STOP_DEV, "utf-8");
      expect(content).toContain("force_cleanup_worktree()");
    });

    it("should call force_cleanup_worktree in cleanup_done exit path", () => {
      const content = readFileSync(STOP_DEV, "utf-8");
      // cleanup_done path should call force_cleanup_worktree before rm -f
      const cleanupDoneSection = content.indexOf('cleanup_done: true');
      const nextRmF = content.indexOf('rm -f "$DEV_MODE_FILE"', cleanupDoneSection);
      const forceCleanup = content.indexOf('force_cleanup_worktree', cleanupDoneSection);
      expect(forceCleanup).toBeGreaterThan(cleanupDoneSection);
      expect(forceCleanup).toBeLessThan(nextRmF);
    });

    it("should use pipeline_rescue instead of hard retry limit (v15.4.0)", () => {
      const content = readFileSync(STOP_DEV, "utf-8");
      // v15.4.0: 不再有硬限制退出路径，改为 pipeline_rescue 机制
      expect(content).toContain('pipeline_rescue');
      expect(content).toContain('RESCUE_CHECK_INTERVAL');
      expect(content).not.toContain('MAX_RETRIES=30');
    });

    it("should call force_cleanup_worktree in PR merged exit path", () => {
      const content = readFileSync(STOP_DEV, "utf-8");
      // PR merged path should call force_cleanup_worktree before rm -f
      const mergedSection = content.indexOf('工作流完成！正在清理');
      const rmSection = content.indexOf('rm -f "$DEV_MODE_FILE"', mergedSection);
      const forceCleanup = content.indexOf('force_cleanup_worktree', mergedSection);
      expect(forceCleanup).toBeGreaterThan(mergedSection);
      expect(forceCleanup).toBeLessThan(rmSection);
    });
  });

  describe("cleanup.sh", () => {
    it("should pass syntax check", () => {
      expect(() => {
        execSync(`bash -n "${CLEANUP}"`, { encoding: "utf-8" });
      }).not.toThrow();
    });

    it("should delegate worktree cleanup to external worktree-gc.sh", () => {
      const content = readFileSync(CLEANUP, "utf-8");
      expect(content).toContain('worktree-gc.sh');
    });
  });

  describe(".gitignore", () => {
    it("should include .claude/worktrees/", () => {
      const content = readFileSync(GITIGNORE, "utf-8");
      expect(content).toContain(".claude/worktrees/");
    });
  });

  describe("vitest.config.ts", () => {
    it("should exclude .claude/worktrees/ from test scanning", () => {
      const content = readFileSync(VITEST_CONFIG, "utf-8");
      expect(content).toContain("**/.claude/worktrees/**");
    });
  });
});
