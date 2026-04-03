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

    it("should generate persistent worktree path using WORKTREE_BASE", () => {
      const content = readFileSync(WORKTREE_MANAGE, "utf-8");
      expect(content).toContain('generate_worktree_path()');
      // v1.3.0: 新路径格式使用 WORKTREE_BASE，默认 ~/worktrees/{project}
      expect(content).toContain('WORKTREE_BASE');
      expect(content).toContain('HOME/worktrees');
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
