/**
 * pr-gate-phase2.test.ts
 *
 * Phase 2 测试：PRD/DoD 快照功能
 *
 * 测试覆盖：
 * 1. snapshot-prd-dod.sh - 快照脚本
 * 2. list-snapshots.sh - 列出快照
 * 3. view-snapshot.sh - 查看快照
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import {
  existsSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readdirSync,
} from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";

const PROJECT_ROOT = resolve(__dirname, "../..");
const SCRIPTS_DIR = join(PROJECT_ROOT, "scripts/devgate");
const SNAPSHOT_SCRIPT = join(SCRIPTS_DIR, "snapshot-prd-dod.sh");
const LIST_SCRIPT = join(SCRIPTS_DIR, "list-snapshots.sh");
const VIEW_SCRIPT = join(SCRIPTS_DIR, "view-snapshot.sh");

// 临时测试目录 - use os.tmpdir() to avoid polluting the project
// 使用时间戳避免并发测试冲突
const TEST_DIR = join(tmpdir(), `zenithjoy-test-phase2-${Date.now()}`);
const TEST_HISTORY_DIR = join(TEST_DIR, ".history");

describe("Phase 2: PRD/DoD Snapshot", () => {
  beforeAll(() => {
    // 创建临时测试目录
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_HISTORY_DIR, { recursive: true });

    // 创建测试用的 PRD/DoD
    writeFileSync(join(TEST_DIR, ".prd.md"), "# Test PRD\n\nTest content");
    writeFileSync(join(TEST_DIR, ".dod.md"), "# Test DoD\n\n- [ ] Test item");

    // 初始化 git（脚本需要）
    try {
      execSync("git init", { cwd: TEST_DIR, stdio: "pipe" });
    } catch (e: unknown) {
      // git init may fail if directory already exists as a repo - this is expected
      // Log for debugging but don't fail the test setup
      if (process.env.DEBUG) {
        console.log("git init skipped (may already exist):", e);
      }
    }
  });

  // 每个测试前清理 .history 目录，避免测试之间污染
  beforeEach(() => {
    if (existsSync(TEST_HISTORY_DIR)) {
      const files = readdirSync(TEST_HISTORY_DIR);
      files.forEach((f) => rmSync(join(TEST_HISTORY_DIR, f), { force: true }));
    }
  });

  afterAll(() => {
    // 清理临时目录
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }

    // 清理可能残留在 PROJECT_ROOT 的测试文件
    const projectHistoryDir = join(PROJECT_ROOT, ".history");
    if (existsSync(projectHistoryDir)) {
      const files = readdirSync(projectHistoryDir);
      files
        .filter((f) => f.startsWith("PR-998-") || f.startsWith("PR-999-"))
        .forEach((f) => {
          try {
            rmSync(join(projectHistoryDir, f), { force: true });
          } catch (e) {
            // Ignore cleanup errors
          }
        });
    }
  });

  describe("snapshot-prd-dod.sh", () => {
    it("should exist and be executable", () => {
      expect(existsSync(SNAPSHOT_SCRIPT)).toBe(true);
      const stat = execSync(`stat -c %a "${SNAPSHOT_SCRIPT}"`, {
        encoding: "utf-8",
      });
      const mode = parseInt(stat.trim(), 8);
      expect(mode & 0o111).toBeGreaterThan(0);
    });

    it("should pass syntax check", () => {
      expect(() => {
        execSync(`bash -n "${SNAPSHOT_SCRIPT}"`, { encoding: "utf-8" });
      }).not.toThrow();
    });

    it("should require PR number argument", () => {
      let didThrow = false;
      let exitStatus: number | undefined;
      try {
        execSync(`bash "${SNAPSHOT_SCRIPT}"`, {
          encoding: "utf-8",
          cwd: TEST_DIR,
        });
      } catch (e: unknown) {
        didThrow = true;
        if (e && typeof e === 'object' && 'status' in e) {
          exitStatus = (e as { status?: number }).status;
        }
      }
      expect(didThrow).toBe(true);
      expect(exitStatus).toBe(1);
    });

    it("should create snapshot with correct filename", () => {
      const prNumber = "999";

      execSync(`bash "${SNAPSHOT_SCRIPT}" ${prNumber}`, {
        encoding: "utf-8",
        cwd: TEST_DIR,
      });

      // Check files were created in test .history dir
      const historyDir = TEST_HISTORY_DIR;
      const files = readdirSync(historyDir);

      const prdSnapshot = files.find(
        (f) => f.startsWith(`PR-${prNumber}-`) && f.endsWith(".prd.md")
      );
      const dodSnapshot = files.find(
        (f) => f.startsWith(`PR-${prNumber}-`) && f.endsWith(".dod.md")
      );

      expect(prdSnapshot).toBeDefined();
      expect(dodSnapshot).toBeDefined();

      // Clean up happens in afterAll
    });

    it("should validate PR number is numeric", () => {
      let didThrow = false;
      let exitStatus: number | undefined;
      try {
        execSync(`bash "${SNAPSHOT_SCRIPT}" "abc"`, {
          encoding: "utf-8",
          cwd: TEST_DIR,
        });
      } catch (e: unknown) {
        didThrow = true;
        if (e && typeof e === 'object' && 'status' in e) {
          exitStatus = (e as { status?: number }).status;
        }
      }
      expect(didThrow).toBe(true);
      expect(exitStatus).toBe(1);
    });
  });

  describe("list-snapshots.sh", () => {
    it("should exist and be executable", () => {
      expect(existsSync(LIST_SCRIPT)).toBe(true);
      const stat = execSync(`stat -c %a "${LIST_SCRIPT}"`, {
        encoding: "utf-8",
      });
      const mode = parseInt(stat.trim(), 8);
      expect(mode & 0o111).toBeGreaterThan(0);
    });

    it("should pass syntax check", () => {
      expect(() => {
        execSync(`bash -n "${LIST_SCRIPT}"`, { encoding: "utf-8" });
      }).not.toThrow();
    });

    it("should output JSON with --json flag", () => {
      const result = execSync(`bash "${LIST_SCRIPT}" --json`, {
        encoding: "utf-8",
        cwd: TEST_DIR,
      });

      // 应该是有效的 JSON
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it("should handle empty history gracefully", () => {
      // 在空目录测试
      const result = execSync(`bash "${LIST_SCRIPT}"`, {
        encoding: "utf-8",
        cwd: TEST_DIR,
      });

      expect(result).toContain("No snapshots found");
    });
  });

  describe("view-snapshot.sh", () => {
    it("should exist and be executable", () => {
      expect(existsSync(VIEW_SCRIPT)).toBe(true);
      const stat = execSync(`stat -c %a "${VIEW_SCRIPT}"`, {
        encoding: "utf-8",
      });
      const mode = parseInt(stat.trim(), 8);
      expect(mode & 0o111).toBeGreaterThan(0);
    });

    it("should pass syntax check", () => {
      expect(() => {
        execSync(`bash -n "${VIEW_SCRIPT}"`, { encoding: "utf-8" });
      }).not.toThrow();
    });

    it("should require PR number argument", () => {
      let didThrow = false;
      let exitStatus: number | undefined;
      try {
        execSync(`bash "${VIEW_SCRIPT}"`, {
          encoding: "utf-8",
          cwd: TEST_DIR,
        });
      } catch (e: unknown) {
        didThrow = true;
        if (e && typeof e === 'object' && 'status' in e) {
          exitStatus = (e as { status?: number }).status;
        }
      }
      expect(didThrow).toBe(true);
      expect(exitStatus).toBe(1);
    });

    it("should handle non-existent PR gracefully", () => {
      let didThrow = false;
      let exitStatus: number | undefined;
      try {
        execSync(`bash "${VIEW_SCRIPT}" 99999`, {
          encoding: "utf-8",
          cwd: TEST_DIR,
        });
      } catch (e: unknown) {
        didThrow = true;
        if (e && typeof e === 'object' && 'status' in e) {
          exitStatus = (e as { status?: number }).status;
        }
      }
      expect(didThrow).toBe(true);
      expect(exitStatus).toBe(1);
    });

    it("should support PR number with # prefix", () => {
      // 先创建一个测试快照
      execSync(`bash "${SNAPSHOT_SCRIPT}" 998`, {
        encoding: "utf-8",
        cwd: TEST_DIR,
      });

      // 测试带 # 的 PR 号
      const result = execSync(`bash "${VIEW_SCRIPT}" "#998"`, {
        encoding: "utf-8",
        cwd: TEST_DIR,
      });

      expect(result).toContain("PR #998");

      // Clean up happens in afterAll
    });
  });
});
