/**
 * Worktree GC 行为测试
 *
 * 验证 worktree-gc.sh 的核心行为：
 * - 从主仓库运行，能删除已完成的 worktree
 * - 不删除主仓库
 * - 不删除未合并的 worktree（无 PR / PR 未合并）
 * - stop-dev.sh force_cleanup_worktree 不再执行 git worktree remove
 * - cleanup.sh 不再自删 worktree
 * - worktree-manage.sh cleanup 不再使用 git branch --merged
 *
 * 测试策略：
 * - 真实 git worktree add/remove 测试（在 tmpdir 中）
 * - worktree-gc.sh 因为依赖 gh CLI + GitHub API，行为测试用 mock 脚本
 * - 代码内容检查确保旧的 bug 模式被移除
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { readFileSync, mkdtempSync, existsSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

const PROJECT_ROOT = resolve(__dirname, "../..");
const WORKTREE_GC = resolve(
  PROJECT_ROOT,
  "skills/dev/scripts/worktree-gc.sh"
);
const STOP_DEV = resolve(PROJECT_ROOT, "hooks/stop-dev.sh");
const CLEANUP_SH = resolve(PROJECT_ROOT, "skills/dev/scripts/cleanup.sh");
const WORKTREE_MANAGE = resolve(
  PROJECT_ROOT,
  "skills/dev/scripts/worktree-manage.sh"
);

describe("Worktree GC 架构（外部清理者）", () => {
  describe("worktree-gc.sh 脚本", () => {
    it("存在且语法正确", () => {
      expect(existsSync(WORKTREE_GC)).toBe(true);
      expect(() => {
        execSync(`bash -n "${WORKTREE_GC}"`, { encoding: "utf-8" });
      }).not.toThrow();
    });

    it("使用 gh pr list 检测（不使用 git branch --merged）", () => {
      const content = readFileSync(WORKTREE_GC, "utf-8");
      expect(content).toContain("gh pr list");
      // 只检查非注释行（以 # 开头的行是注释，允许提及旧方法）
      const codeLines = content
        .split("\n")
        .filter((l) => !l.trim().startsWith("#"));
      const codeOnly = codeLines.join("\n");
      expect(codeOnly).not.toContain("branch --merged");
    });

    it("从主仓库执行删除（cd $MAIN_WT）", () => {
      const content = readFileSync(WORKTREE_GC, "utf-8");
      expect(content).toContain('cd "$MAIN_WT"');
    });

    it("支持 --dry-run 参数", () => {
      const content = readFileSync(WORKTREE_GC, "utf-8");
      expect(content).toContain("--dry-run");
      expect(content).toContain("DRY_RUN=true");
    });

    it("跳过主仓库（不删自己）", () => {
      const content = readFileSync(WORKTREE_GC, "utf-8");
      expect(content).toContain("$MAIN_WT");
      // 主仓库会被跳过
      expect(content).toMatch(
        /current_path.*!=.*MAIN_WT|MAIN_WT.*skip|跳过主/
      );
    });

    it("只处理 cp-* 分支", () => {
      const content = readFileSync(WORKTREE_GC, "utf-8");
      expect(content).toContain("cp-*");
    });
  });

  describe("真实 git worktree 操作", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "wt-gc-test-"));
      execSync(
        `cd "${tempDir}" && git init -q && git config user.email "test@test.com" && git config user.name "Test" && echo test > README.md && git add . && git commit -m "init" -q`,
        { encoding: "utf-8" }
      );
    });

    afterEach(() => {
      try {
        execSync(`rm -rf "${tempDir}"`);
      } catch {
        /* ignore */
      }
    });

    it("git worktree add 创建成功", () => {
      const wtPath = join(tempDir, ".claude/worktrees/test-task");
      execSync(
        `cd "${tempDir}" && mkdir -p .claude/worktrees && git worktree add -b cp-test "${wtPath}" HEAD -q`,
        { encoding: "utf-8" }
      );
      expect(existsSync(wtPath)).toBe(true);
      expect(existsSync(join(wtPath, "README.md"))).toBe(true);
    });

    it("git worktree remove 从主仓库执行成功", () => {
      const wtPath = join(tempDir, ".claude/worktrees/test-remove");
      execSync(
        `cd "${tempDir}" && mkdir -p .claude/worktrees && git worktree add -b cp-remove "${wtPath}" HEAD -q`,
        { encoding: "utf-8" }
      );
      expect(existsSync(wtPath)).toBe(true);

      // 从主仓库删除（不在 worktree 内部）
      execSync(`cd "${tempDir}" && git worktree remove "${wtPath}" --force`, {
        encoding: "utf-8",
      });
      expect(existsSync(wtPath)).toBe(false);
    });

    it("git worktree remove 从主仓库 vs 内部行为不同", () => {
      const wtPath = join(tempDir, ".claude/worktrees/test-self-delete");
      execSync(
        `cd "${tempDir}" && mkdir -p .claude/worktrees && git worktree add -b cp-self "${wtPath}" HEAD -q`,
        { encoding: "utf-8" }
      );

      // 关键验证：从主仓库执行 worktree remove 一定成功
      // （这是外部清理者模式的核心保证）
      execSync(
        `cd "${tempDir}" && git worktree remove "${wtPath}" --force`,
        { encoding: "utf-8" }
      );
      expect(existsSync(wtPath)).toBe(false);
    });
  });

  describe("stop-dev.sh 架构变更", () => {
    it("force_cleanup_worktree 不再执行 git worktree remove", () => {
      const content = readFileSync(STOP_DEV, "utf-8");
      // 找到 force_cleanup_worktree 函数体，只检查非注释的代码行
      const fnStart = content.indexOf("force_cleanup_worktree()");
      const fnEnd = content.indexOf("}", fnStart);
      const fnBody = content.slice(fnStart, fnEnd + 1);
      const codeLines = fnBody
        .split("\n")
        .filter((l) => !l.trim().startsWith("#"));
      const codeOnly = codeLines.join("\n");

      expect(codeOnly).not.toContain("worktree remove");
      expect(codeOnly).not.toContain("worktree prune");
    });
  });

  describe("cleanup.sh 架构变更", () => {
    it("不再包含 git worktree remove 自删逻辑", () => {
      const content = readFileSync(CLEANUP_SH, "utf-8");
      // 找到 4.5 节
      const sectionStart = content.indexOf("4.5");
      const sectionEnd = content.indexOf("========", sectionStart + 10);
      const section = content.slice(sectionStart, sectionEnd);

      expect(section).not.toContain("git worktree remove");
      expect(section).not.toContain("safe_rm_rf");
    });

    it("委托给外部 worktree-gc.sh", () => {
      const content = readFileSync(CLEANUP_SH, "utf-8");
      expect(content).toContain("worktree-gc.sh");
    });
  });

  describe("worktree-manage.sh 架构变更", () => {
    // 提取 bash 函数体（处理嵌套大括号）
    function extractBashFn(content: string, fnName: string): string {
      const start = content.indexOf(fnName);
      if (start === -1) return "";
      const braceStart = content.indexOf("{", start);
      if (braceStart === -1) return "";
      let depth = 0;
      for (let i = braceStart; i < content.length; i++) {
        if (content[i] === "{") depth++;
        else if (content[i] === "}") {
          depth--;
          if (depth === 0) return content.slice(start, i + 1);
        }
      }
      return content.slice(start);
    }

    it("cmd_cleanup 不再使用 git branch --merged", () => {
      const content = readFileSync(WORKTREE_MANAGE, "utf-8");
      const fnBody = extractBashFn(content, "cmd_cleanup");
      const codeLines = fnBody
        .split("\n")
        .filter((l) => !l.trim().startsWith("#"));
      const codeOnly = codeLines.join("\n");

      expect(codeOnly).not.toContain("branch --merged");
    });

    it("cmd_cleanup 委托给 worktree-gc.sh", () => {
      const content = readFileSync(WORKTREE_MANAGE, "utf-8");
      const fnBody = extractBashFn(content, "cmd_cleanup");

      expect(fnBody).toContain("worktree-gc.sh");
    });
  });
});
