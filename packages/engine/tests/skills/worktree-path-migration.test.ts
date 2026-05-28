/**
 * Worktree 路径迁移测试
 *
 * 验证 worktree 路径从 ${main_wt}-wt-${name} 迁移到 .claude/worktrees/${name}
 * 以及 Stop Hook 强制清理 worktree 的兜底机制
 */

import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve, join } from "path";
import os from "os";

const PROJECT_ROOT = resolve(__dirname, "../..");
// scripts moved to ~/.claude/skills (zenithjoy-skills repo)
const WORKTREE_MANAGE = join(os.homedir(), '.claude', 'skills', 'dev', 'scripts', 'worktree-manage.sh');
const CLEANUP = join(os.homedir(), '.claude', 'skills', 'dev', 'scripts', 'cleanup.sh');
const scriptExists = existsSync(WORKTREE_MANAGE);
const cleanupExists = existsSync(CLEANUP);
const GITIGNORE = resolve(PROJECT_ROOT, ".gitignore");
const VITEST_CONFIG = resolve(PROJECT_ROOT, "vitest.config.ts");

describe("Worktree path migration", () => {
  describe("worktree-manage.sh", () => {
    it.skipIf(!scriptExists)("should pass syntax check", () => {
      expect(() => {
        execSync(`bash -n "${WORKTREE_MANAGE}"`, { encoding: "utf-8" });
      }).not.toThrow();
    });

    it.skipIf(!scriptExists)("should generate persistent worktree path using WORKTREE_BASE", () => {
      const content = readFileSync(WORKTREE_MANAGE, "utf-8");
      expect(content).toContain('generate_worktree_path()');
      // v1.3.0: 新路径格式使用 WORKTREE_BASE，默认 ~/worktrees/{project}
      expect(content).toContain('WORKTREE_BASE');
      expect(content).toContain('HOME/worktrees');
    });

    it.skipIf(!scriptExists)("should auto-add .claude/worktrees/ to .gitignore on create", () => {
      const content = readFileSync(WORKTREE_MANAGE, "utf-8");
      expect(content).toContain('.claude/worktrees/');
      expect(content).toContain('.gitignore');
    });

    it.skipIf(!scriptExists)("should support both new and old paths in safe_rm_rf", () => {
      const content = readFileSync(WORKTREE_MANAGE, "utf-8");
      // 新路径检测
      expect(content).toContain('"$worktree_path" == *"/.claude/worktrees/"*');
      // 旧路径 fallback
      expect(content).toContain('dirname "$(get_main_worktree)"');
    });

    it.skipIf(!scriptExists)("should mkdir -p parent directory before creating worktree", () => {
      const content = readFileSync(WORKTREE_MANAGE, "utf-8");
      expect(content).toContain('mkdir -p "$(dirname "$worktree_path")"');
    });
  });

  describe("cleanup.sh", () => {
    it.skipIf(!cleanupExists)("should pass syntax check", () => {
      expect(() => {
        execSync(`bash -n "${CLEANUP}"`, { encoding: "utf-8" });
      }).not.toThrow();
    });

    it.skipIf(!cleanupExists)("should delegate worktree cleanup to external worktree-gc.sh", () => {
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
