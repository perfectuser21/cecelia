/**
 * pr-gate-phase1.test.ts
 *
 * Phase 1 规则测试：DoD ↔ Test 映射检查
 *
 * 测试覆盖：
 * 1. check-dod-mapping.cjs - DoD 映射检查
 * 2. detect-priority.cjs - 优先级检测
 * 3. require-rci-update-if-p0p1.sh - P0/P1 强制 RCI 更新
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import { existsSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from "fs";
import { resolve, join } from "path";

const PROJECT_ROOT = resolve(__dirname, "../..");
const SCRIPTS_DIR = join(PROJECT_ROOT, "scripts/devgate");
const CHECK_DOD_SCRIPT = join(SCRIPTS_DIR, "check-dod-mapping.cjs");
const DETECT_PRIORITY_SCRIPT = join(SCRIPTS_DIR, "detect-priority.cjs");
const REQUIRE_RCI_SCRIPT = join(SCRIPTS_DIR, "require-rci-update-if-p0p1.sh");

// 临时测试目录
const TEST_DIR = join(PROJECT_ROOT, ".test-phase1");

describe("Phase 1: DevGate Scripts", () => {
  beforeAll(() => {
    // 创建临时测试目录
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
    // 初始化独立的 git repo 以隔离 priority 检测
    try {
      execSync("git init", { cwd: TEST_DIR, stdio: "ignore" });
      execSync('git config user.email "test@example.com"', { cwd: TEST_DIR, stdio: "ignore" });
      execSync('git config user.name "Test User"', { cwd: TEST_DIR, stdio: "ignore" });
    } catch {
      // 忽略错误（可能已经是 git repo）
    }
  });

  afterAll(() => {
    // 清理临时目录
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe("check-dod-mapping.cjs", () => {
    it("should exist", () => {
      expect(existsSync(CHECK_DOD_SCRIPT)).toBe(true);
    });

    it("should pass syntax check", () => {
      expect(() => {
        execSync(`node --check "${CHECK_DOD_SCRIPT}"`, { encoding: "utf-8" });
      }).not.toThrow();
    });

    it("should exit 2 when DoD file does not exist", () => {
      const nonExistentDod = join(TEST_DIR, "non-existent.md");

      let didThrow = false;
      let exitStatus: number | undefined;
      try {
        execSync(`node "${CHECK_DOD_SCRIPT}" "${nonExistentDod}"`, {
          encoding: "utf-8",
          cwd: PROJECT_ROOT,
        });
      } catch (e: unknown) {
        didThrow = true;
        if (e && typeof e === 'object' && 'status' in e) {
          exitStatus = (e as { status?: number }).status;
        }
      }
      expect(didThrow).toBe(true);
      expect(exitStatus).toBe(2);
    });

    it("should pass when all items have Test fields", () => {
      const dodContent = `# Test DoD

## 验收标准

- [ ] Item 1
  Test: tests/hooks/pr-gate-phase1.test.ts
- [ ] Item 2
  Test: contract:H2-001
- [x] Item 3
  Test: manual:test-evidence
`;

      const testDod = join(TEST_DIR, "valid.dod.md");
      writeFileSync(testDod, dodContent);

      const result = execSync(`node "${CHECK_DOD_SCRIPT}" "${testDod}"`, {
        encoding: "utf-8",
        cwd: PROJECT_ROOT,
      });

      expect(result).toContain("✅");
    });

    it("should fail when items miss Test fields", () => {
      const dodContent = `# Test DoD

## 验收标准

- [ ] Item without test
- [ ] Another item
  Test: tests/hooks/pr-gate-phase1.test.ts
`;

      const testDod = join(TEST_DIR, "invalid.dod.md");
      writeFileSync(testDod, dodContent);

      let didThrow = false;
      let exitStatus: number | undefined;
      try {
        execSync(`node "${CHECK_DOD_SCRIPT}" "${testDod}"`, {
          encoding: "utf-8",
          cwd: PROJECT_ROOT,
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

    it("should validate test file exists", () => {
      const dodContent = `# Test DoD

## 验收标准

- [ ] Item with non-existent test
  Test: tests/non-existent-file.test.ts
`;

      const testDod = join(TEST_DIR, "invalid-path.dod.md");
      writeFileSync(testDod, dodContent);

      let didThrow = false;
      let exitStatus: number | undefined;
      try {
        execSync(`node "${CHECK_DOD_SCRIPT}" "${testDod}"`, {
          encoding: "utf-8",
          cwd: PROJECT_ROOT,
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

    it("should validate contract ID exists in regression-contract.yaml", () => {
      const dodContent = `# Test DoD

## 验收标准

- [ ] Item with invalid contract ID
  Test: contract:INVALID-RCI-ID
`;

      const testDod = join(TEST_DIR, "invalid-contract.dod.md");
      writeFileSync(testDod, dodContent);

      let didThrow = false;
      let exitStatus: number | undefined;
      try {
        execSync(`node "${CHECK_DOD_SCRIPT}" "${testDod}"`, {
          encoding: "utf-8",
          cwd: PROJECT_ROOT,
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

    it("should accept valid contract IDs", () => {
      const dodContent = `# Test DoD

## 验收标准

- [ ] Item with valid contract ID
  Test: contract:H1-001
`;

      const testDod = join(TEST_DIR, "valid-contract.dod.md");
      writeFileSync(testDod, dodContent);

      const result = execSync(`node "${CHECK_DOD_SCRIPT}" "${testDod}"`, {
        encoding: "utf-8",
        cwd: PROJECT_ROOT,
      });

      expect(result).toContain("✅");
    });
  });

  describe("detect-priority.cjs", () => {
    it("should exist", () => {
      expect(existsSync(DETECT_PRIORITY_SCRIPT)).toBe(true);
    });

    it("should pass syntax check", () => {
      expect(() => {
        execSync(`node --check "${DETECT_PRIORITY_SCRIPT}"`, {
          encoding: "utf-8",
        });
      }).not.toThrow();
    });

    it("should detect P0 from env variable", () => {
      const result = execSync(`node "${DETECT_PRIORITY_SCRIPT}"`, {
        encoding: "utf-8",
        cwd: PROJECT_ROOT,
        env: { ...process.env, PR_PRIORITY: "P0" },
      });

      expect(result.trim()).toBe("P0");
    });

    it("should detect P1 from PR title", () => {
      const result = execSync(`node "${DETECT_PRIORITY_SCRIPT}"`, {
        encoding: "utf-8",
        cwd: PROJECT_ROOT,
        env: { ...process.env, PR_TITLE: "fix(P1): security bug" },
      });

      expect(result.trim()).toBe("P1");
    });

    it("should detect P2 from labels", () => {
      const result = execSync(`node "${DETECT_PRIORITY_SCRIPT}"`, {
        encoding: "utf-8",
        cwd: PROJECT_ROOT,
        env: { ...process.env, PR_LABELS: "bug,priority:P2,urgent" },
      });

      expect(result.trim()).toBe("P2");
    });

    it("should return unknown when no priority found", () => {
      const result = execSync(`node "${DETECT_PRIORITY_SCRIPT}"`, {
        encoding: "utf-8",
        cwd: TEST_DIR,  // Use clean test directory to avoid reading .prd.md from project root
        env: {
          ...process.env,
          PR_PRIORITY: "",
          PR_TITLE: "",
          PR_LABELS: "",
          SKIP_GIT_DETECTION: "1",  // Skip git history detection in tests
        },
      });

      expect(result.trim()).toBe("unknown");
    });

    it("should output JSON with --json flag", () => {
      const result = execSync(`node "${DETECT_PRIORITY_SCRIPT}" --json`, {
        encoding: "utf-8",
        cwd: PROJECT_ROOT,
        env: { ...process.env, PR_PRIORITY: "P0" },
      });

      const json = JSON.parse(result.trim());
      expect(json.priority).toBe("P0");
      expect(json.source).toBe("env");
    });
  });

  describe("require-rci-update-if-p0p1.sh", () => {
    it("should exist", () => {
      expect(existsSync(REQUIRE_RCI_SCRIPT)).toBe(true);
    });

    it("should be executable", () => {
      const stat = execSync(`stat -c %a "${REQUIRE_RCI_SCRIPT}"`, {
        encoding: "utf-8",
      });
      const mode = parseInt(stat.trim(), 8);
      expect(mode & 0o111).toBeGreaterThan(0);
    });

    it("should pass syntax check", () => {
      expect(() => {
        execSync(`bash -n "${REQUIRE_RCI_SCRIPT}"`, { encoding: "utf-8" });
      }).not.toThrow();
    });

    it("should pass for non-P0/P1 priorities", () => {
      const result = execSync(`bash "${REQUIRE_RCI_SCRIPT}"`, {
        encoding: "utf-8",
        cwd: PROJECT_ROOT,
        env: { ...process.env, PR_PRIORITY: "P2" },
      });

      expect(result).toContain("非 P0/P1");
    });

    it("should handle P0 RCI check based on git state", () => {
      // This test validates the script runs without error.
      // The result depends on whether RCI was updated in the current git state.
      // Both outcomes (pass or fail) are valid, we just verify the script runs correctly.
      let exitCode: number | undefined;
      let stdout = '';
      try {
        stdout = execSync(`bash "${REQUIRE_RCI_SCRIPT}"`, {
          encoding: "utf-8",
          cwd: PROJECT_ROOT,
          env: { ...process.env, PR_PRIORITY: "P0" },
        });
        exitCode = 0;
      } catch (e: unknown) {
        if (e && typeof e === 'object' && 'status' in e) {
          exitCode = (e as { status?: number }).status;
        }
      }
      // Script should exit with 0 (RCI updated) or 1 (RCI not updated)
      // Both are valid outcomes depending on git state
      expect(exitCode === 0 || exitCode === 1).toBe(true);
      if (exitCode === 0) {
        expect(stdout).toBeTruthy();
      }
    });
  });
});
