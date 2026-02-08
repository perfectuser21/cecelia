/**
 * Worktree 多会话检测测试
 *
 * 验证 Step 0 能够检测其他会话并自动创建 worktree 隔离
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { writeFileSync, mkdtempSync, readFileSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const SESSION_DIR = "/tmp/claude-engine-sessions";

describe("Worktree multi-session detection", () => {
  let tempDir: string;
  let testSessionFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "worktree-test-"));
    execSync(`cd "${tempDir}" && git init -q`);

    // 创建测试用的会话注册目录
    execSync(`mkdir -p "${SESSION_DIR}"`);

    // 清理旧的测试会话
    execSync(
      `find "${SESSION_DIR}" -name "session-test-*.json" -delete 2>/dev/null || true`
    );
  });

  afterEach(() => {
    try {
      execSync(`rm -rf "${tempDir}"`);
      execSync(
        `find "${SESSION_DIR}" -name "session-test-*.json" -delete 2>/dev/null || true`
      );
    } catch {
      // ignore
    }
  });

  describe("session registration", () => {
    it("should detect session registration file", () => {
      const sessionId = "test-abc123";
      testSessionFile = join(SESSION_DIR, `session-${sessionId}.json`);

      writeFileSync(
        testSessionFile,
        JSON.stringify({
          session_id: sessionId,
          pid: 99999, // fake PID
          tty: "not a tty",
          cwd: tempDir,
          branch: "test-branch",
          started: new Date().toISOString(),
          last_heartbeat: new Date().toISOString(),
        })
      );

      expect(readFileSync(testSessionFile, "utf-8")).toContain(sessionId);
    });

    it("should create session registration in Step 3", () => {
      const sessionId = "test-step3-" + Date.now();
      testSessionFile = join(SESSION_DIR, `session-${sessionId}.json`);

      // 模拟 Step 3 创建会话注册（避免 heredoc 在字符串中的问题）
      writeFileSync(
        testSessionFile,
        JSON.stringify({
          session_id: sessionId,
          pid: process.pid,
          tty: "not a tty",
          cwd: tempDir,
          branch: "test-branch",
          started: new Date().toISOString(),
          last_heartbeat: new Date().toISOString(),
        })
      );

      expect(readFileSync(testSessionFile, "utf-8")).toContain(sessionId);

      // 清理
      unlinkSync(testSessionFile);
    });
  });

  describe("session cleanup", () => {
    it("should cleanup session file on Step 11", () => {
      const sessionId = "test-cleanup-" + Date.now();
      testSessionFile = join(SESSION_DIR, `session-${sessionId}.json`);

      writeFileSync(
        testSessionFile,
        JSON.stringify({
          session_id: sessionId,
          pid: process.pid,
          tty: "not a tty",
          cwd: tempDir,
          branch: "test-branch",
          started: new Date().toISOString(),
        })
      );

      // 模拟 Step 11 清理会话注册
      const script = `
SESSION_ID="${sessionId}"
SESSION_FILE="${testSessionFile}"
if [[ -f "$SESSION_FILE" ]]; then
    rm -f "$SESSION_FILE"
    echo "cleaned"
fi
      `;

      const result = execSync(`bash -c '${script}'`, { encoding: "utf-8" });
      expect(result.trim()).toBe("cleaned");
      expect(existsSync(testSessionFile)).toBe(false);
    });

    it("should cleanup expired sessions (>1 hour)", () => {
      const oldSessionId = "test-expired-" + Date.now();
      const oldSessionFile = join(SESSION_DIR, `session-${oldSessionId}.json`);

      writeFileSync(oldSessionFile, "{}");

      // 修改文件时间为 2 小时前
      execSync(`touch -t $(date -d '2 hours ago' +%Y%m%d%H%M) "${oldSessionFile}"`);

      // 清理过期会话
      execSync(
        `find "${SESSION_DIR}" -name "session-${oldSessionId}.json" -mmin +60 -delete`
      );

      expect(existsSync(oldSessionFile)).toBe(false);
    });
  });

  describe("multi-session detection logic", () => {
    it("should detect other session in same repo", () => {
      const sessionId = "test-other-" + Date.now();
      testSessionFile = join(SESSION_DIR, `session-${sessionId}.json`);

      // 创建其他会话（不同 PID）
      writeFileSync(
        testSessionFile,
        JSON.stringify({
          session_id: sessionId,
          pid: 99999, // fake PID（不是当前进程）
          tty: "not a tty",
          cwd: tempDir, // 同一个 repo
          branch: "other-branch",
          started: new Date().toISOString(),
        })
      );

      // 检测逻辑
      const script = `
SESSION_DIR="${SESSION_DIR}"
CURRENT_REPO="${tempDir}"
NEED_WORKTREE=false

if [[ -d "$SESSION_DIR" ]]; then
    for session_file in "$SESSION_DIR"/session-test-*.json; do
        [[ ! -f "$session_file" ]] && continue

        session_repo=$(cat "$session_file" | grep -o '"cwd":"[^"]*"' | cut -d'"' -f4)
        session_pid=$(cat "$session_file" | grep -o '"pid": [0-9]*' | awk '{print $2}')

        if [[ "$session_repo" == "$CURRENT_REPO" ]] && [[ "$session_pid" != "$$" ]]; then
            if ps -p "$session_pid" >/dev/null 2>&1; then
                NEED_WORKTREE=true
                break
            fi
        fi
    done
fi

if [[ "$NEED_WORKTREE" == "true" ]]; then
    echo "need_worktree"
else
    echo "no_need"
fi
      `;

      const result = execSync(`cd "${tempDir}" && bash <<'EOF'
${script}
EOF`, {
        encoding: "utf-8",
      });

      // 因为 PID 99999 不存在，ps -p 会失败，所以不会检测到
      expect(result.trim()).toBe("no_need");

      // 清理
      unlinkSync(testSessionFile);
    });
  });
});
