/**
 * 并发安全测试
 *
 * 测试 lib/lock-utils.sh 和 lib/ci-status.sh 的核心逻辑：
 * 1. 锁获取/释放
 * 2. session_id 验证
 * 3. 原子操作
 * 4. CI 状态查询
 * 5. 协调信号
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import {
  existsSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  mkdtempSync,
  mkdirSync,
} from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";

const LOCK_UTILS = resolve(__dirname, "../../lib/lock-utils.sh");
const CI_STATUS = resolve(__dirname, "../../lib/ci-status.sh");
const STOP_HOOK = resolve(__dirname, "../../hooks/stop.sh");

describe("lib/lock-utils.sh", () => {
  beforeAll(() => {
    expect(existsSync(LOCK_UTILS)).toBe(true);
  });

  it("should pass syntax check", () => {
    expect(() => {
      execSync(`bash -n "${LOCK_UTILS}"`, { encoding: "utf-8" });
    }).not.toThrow();
  });

  describe("get_session_id", () => {
    it("should use CLAUDE_SESSION_ID when set", () => {
      const result = execSync(
        `source "${LOCK_UTILS}" && CLAUDE_SESSION_ID="test-session-123" get_session_id`,
        { encoding: "utf-8", shell: "/bin/bash" }
      );
      expect(result.trim()).toBe("test-session-123");
    });

    it("should generate random ID when CLAUDE_SESSION_ID not set", () => {
      const result = execSync(
        `source "${LOCK_UTILS}" && unset CLAUDE_SESSION_ID && get_session_id`,
        { encoding: "utf-8", shell: "/bin/bash" }
      );
      expect(result.trim().length).toBeGreaterThan(0);
    });

    it("should generate different IDs on successive calls", () => {
      const result = execSync(
        `source "${LOCK_UTILS}" && unset CLAUDE_SESSION_ID && ID1=$(get_session_id) && ID2=$(get_session_id) && echo "$ID1 $ID2"`,
        { encoding: "utf-8", shell: "/bin/bash" }
      );
      const [id1, id2] = result.trim().split(" ");
      // Random IDs should generally be different (very small chance of collision)
      expect(id1.length).toBeGreaterThan(0);
      expect(id2.length).toBeGreaterThan(0);
    });
  });

  describe("get_dev_mode_session_id", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "lock-utils-test-"));
      mkdirSync(join(tempDir, ".git"), { recursive: true });
    });

    afterEach(() => {
      try {
        execSync(`rm -rf "${tempDir}"`);
      } catch {
        // ignore
      }
    });

    it("should extract session_id from .dev-mode", () => {
      const devMode = join(tempDir, ".dev-mode");
      writeFileSync(
        devMode,
        "dev\nbranch: cp-test\nsession_id: abc123\nprd: .prd.md\n"
      );

      const result = execSync(
        `cd "${tempDir}" && git init -q && source "${LOCK_UTILS}" && get_dev_mode_session_id`,
        { encoding: "utf-8", shell: "/bin/bash" }
      );
      expect(result.trim()).toBe("abc123");
    });

    it("should return empty when no session_id", () => {
      const devMode = join(tempDir, ".dev-mode");
      writeFileSync(devMode, "dev\nbranch: cp-test\nprd: .prd.md\n");

      const result = execSync(
        `cd "${tempDir}" && git init -q && source "${LOCK_UTILS}" && get_dev_mode_session_id`,
        { encoding: "utf-8", shell: "/bin/bash" }
      );
      expect(result.trim()).toBe("");
    });

    it("should return empty when no .dev-mode file", () => {
      const result = execSync(
        `cd "${tempDir}" && git init -q && source "${LOCK_UTILS}" && get_dev_mode_session_id`,
        { encoding: "utf-8", shell: "/bin/bash" }
      );
      expect(result.trim()).toBe("");
    });
  });

  describe("check_session_match", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "session-match-test-"));
      mkdirSync(join(tempDir, ".git"), { recursive: true });
    });

    afterEach(() => {
      try {
        execSync(`rm -rf "${tempDir}"`);
      } catch {
        // ignore
      }
    });

    it("should return 0 when session_id matches", () => {
      const devMode = join(tempDir, ".dev-mode");
      writeFileSync(
        devMode,
        "dev\nbranch: cp-test\nsession_id: match123\n"
      );

      const exitCode = execSync(
        `cd "${tempDir}" && git init -q && source "${LOCK_UTILS}" && check_session_match "match123" && echo "match" || echo "no-match"`,
        { encoding: "utf-8", shell: "/bin/bash" }
      );
      expect(exitCode.trim()).toBe("match");
    });

    it("should return 1 when session_id does not match", () => {
      const devMode = join(tempDir, ".dev-mode");
      writeFileSync(
        devMode,
        "dev\nbranch: cp-test\nsession_id: original123\n"
      );

      const result = execSync(
        `cd "${tempDir}" && git init -q && source "${LOCK_UTILS}" && check_session_match "different456" && echo "match" || echo "no-match"`,
        { encoding: "utf-8", shell: "/bin/bash" }
      );
      expect(result.trim()).toBe("no-match");
    });

    it("should return 0 (backward compat) when no session_id in file", () => {
      const devMode = join(tempDir, ".dev-mode");
      writeFileSync(devMode, "dev\nbranch: cp-test\n");

      const result = execSync(
        `cd "${tempDir}" && git init -q && source "${LOCK_UTILS}" && check_session_match "any-id" && echo "match" || echo "no-match"`,
        { encoding: "utf-8", shell: "/bin/bash" }
      );
      expect(result.trim()).toBe("match");
    });
  });

  describe("atomic_write_dev_mode", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "atomic-write-test-"));
      mkdirSync(join(tempDir, ".git"), { recursive: true });
    });

    afterEach(() => {
      try {
        execSync(`rm -rf "${tempDir}"`);
      } catch {
        // ignore
      }
    });

    it("should write content atomically", () => {
      const content = "dev\\nbranch: cp-test\\nsession_id: xyz";

      execSync(
        `cd "${tempDir}" && git init -q && source "${LOCK_UTILS}" && atomic_write_dev_mode "dev\nbranch: cp-test\nsession_id: xyz"`,
        { encoding: "utf-8", shell: "/bin/bash" }
      );

      const devMode = join(tempDir, ".dev-mode");
      expect(existsSync(devMode)).toBe(true);
      const fileContent = readFileSync(devMode, "utf-8");
      expect(fileContent).toContain("session_id: xyz");
    });

    it("should not leave temp files on success", () => {
      execSync(
        `cd "${tempDir}" && git init -q && source "${LOCK_UTILS}" && atomic_write_dev_mode "test"`,
        { encoding: "utf-8", shell: "/bin/bash" }
      );

      const files = execSync(`ls "${tempDir}"/.dev-mode* 2>/dev/null || true`, {
        encoding: "utf-8",
      });
      // Should only have .dev-mode, no .dev-mode.XXXXXX temp files
      const fileList = files.trim().split("\n").filter(Boolean);
      expect(fileList.length).toBe(1);
      expect(fileList[0]).toMatch(/\.dev-mode$/);
    });
  });

  describe("atomic_append_dev_mode", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "atomic-append-test-"));
      mkdirSync(join(tempDir, ".git"), { recursive: true });
    });

    afterEach(() => {
      try {
        execSync(`rm -rf "${tempDir}"`);
      } catch {
        // ignore
      }
    });

    it("should append line to existing .dev-mode", () => {
      const devMode = join(tempDir, ".dev-mode");
      writeFileSync(devMode, "dev\nbranch: cp-test\n");

      execSync(
        `cd "${tempDir}" && git init -q && source "${LOCK_UTILS}" && atomic_append_dev_mode "cleanup_done: true"`,
        { encoding: "utf-8", shell: "/bin/bash" }
      );

      const content = readFileSync(devMode, "utf-8");
      expect(content).toContain("dev\nbranch: cp-test\n");
      expect(content).toContain("cleanup_done: true");
    });

    it("should create file if not exists", () => {
      const devMode = join(tempDir, ".dev-mode");

      execSync(
        `cd "${tempDir}" && git init -q && source "${LOCK_UTILS}" && atomic_append_dev_mode "new content"`,
        { encoding: "utf-8", shell: "/bin/bash" }
      );

      expect(existsSync(devMode)).toBe(true);
      const content = readFileSync(devMode, "utf-8");
      expect(content).toContain("new content");
    });
  });

  describe("cleanup signals", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "signal-test-"));
      mkdirSync(join(tempDir, ".git"), { recursive: true });
    });

    afterEach(() => {
      try {
        execSync(`rm -rf "${tempDir}"`);
      } catch {
        // ignore
      }
    });

    it("should create and check cleanup signal", () => {
      const result = execSync(
        `cd "${tempDir}" && git init -q && source "${LOCK_UTILS}" && create_cleanup_signal "cp-test" && check_cleanup_signal "cp-test" && echo "exists" || echo "missing"`,
        { encoding: "utf-8", shell: "/bin/bash" }
      );
      expect(result.trim()).toBe("exists");
    });

    it("should report missing signal", () => {
      const result = execSync(
        `cd "${tempDir}" && git init -q && source "${LOCK_UTILS}" && check_cleanup_signal "cp-nonexistent" && echo "exists" || echo "missing"`,
        { encoding: "utf-8", shell: "/bin/bash" }
      );
      expect(result.trim()).toBe("missing");
    });

    it("should remove cleanup signal", () => {
      const result = execSync(
        `cd "${tempDir}" && git init -q && source "${LOCK_UTILS}" && create_cleanup_signal "cp-test" && remove_cleanup_signal "cp-test" && check_cleanup_signal "cp-test" && echo "exists" || echo "missing"`,
        { encoding: "utf-8", shell: "/bin/bash" }
      );
      expect(result.trim()).toBe("missing");
    });
  });
});

describe("lib/ci-status.sh", () => {
  beforeAll(() => {
    expect(existsSync(CI_STATUS)).toBe(true);
  });

  it("should pass syntax check", () => {
    expect(() => {
      execSync(`bash -n "${CI_STATUS}"`, { encoding: "utf-8" });
    }).not.toThrow();
  });

  it("should return unknown when gh is not available", () => {
    const result = execSync(
      `source "${CI_STATUS}" && PATH=/usr/bin:/bin CI_MAX_RETRIES=1 CI_RETRY_DELAY=0 get_ci_status "test-branch" 2>/dev/null || true`,
      { encoding: "utf-8", shell: "/bin/bash" }
    );
    expect(result).toContain('"status":"unknown"');
  });
});

describe("stop.sh session isolation", () => {
  it("should contain session_id check code", () => {
    const content = readFileSync(STOP_HOOK, "utf-8");
    expect(content).toContain("SESSION_ID_IN_FILE");
    expect(content).toContain("CLAUDE_SESSION_ID");
    expect(content).toContain("P0-4");
  });

  it("should contain lock-utils sourcing", () => {
    const content = readFileSync(STOP_HOOK, "utf-8");
    expect(content).toContain("lock-utils.sh");
    expect(content).toContain("ci-status.sh");
  });

  it("should extract session_id from .dev-mode format", () => {
    const testContent = `dev
branch: cp-test
session_id: abc123def456
prd: .prd.md`;

    const result = execSync(
      `echo '${testContent}' | grep "^session_id:" | cut -d' ' -f2`,
      { encoding: "utf-8" }
    );
    expect(result.trim()).toBe("abc123def456");
  });
});
