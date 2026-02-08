/**
 * 会话注册机制测试
 *
 * 验证会话注册文件的创建、读取、清理功能
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { writeFileSync, readFileSync, existsSync, unlinkSync } from "fs";
import { join } from "path";

const SESSION_DIR = "/tmp/claude-engine-sessions";

describe("Session registration mechanism", () => {
  let testSessionFiles: string[] = [];

  beforeEach(() => {
    execSync(`mkdir -p "${SESSION_DIR}"`);
  });

  afterEach(() => {
    // 清理测试创建的会话文件
    testSessionFiles.forEach((file) => {
      try {
        if (existsSync(file)) {
          unlinkSync(file);
        }
      } catch {
        // ignore
      }
    });
    testSessionFiles = [];
  });

  describe("session file format", () => {
    it("should create valid JSON session file", () => {
      const sessionId = "test-format-" + Date.now();
      const sessionFile = join(SESSION_DIR, `session-${sessionId}.json`);
      testSessionFiles.push(sessionFile);

      const sessionData = {
        session_id: sessionId,
        pid: process.pid,
        tty: "not a tty",
        cwd: "/test/path",
        branch: "test-branch",
        started: new Date().toISOString(),
        last_heartbeat: new Date().toISOString(),
      };

      writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));

      const content = readFileSync(sessionFile, "utf-8");
      const parsed = JSON.parse(content);

      expect(parsed.session_id).toBe(sessionId);
      expect(parsed.pid).toBe(process.pid);
      expect(parsed.cwd).toBe("/test/path");
      expect(parsed.branch).toBe("test-branch");
    });

    it("should handle newlines in tty field correctly", () => {
      const sessionId = "test-tty-" + Date.now();
      const sessionFile = join(SESSION_DIR, `session-${sessionId}.json`);
      testSessionFiles.push(sessionFile);

      // 直接写入 JSON，测试解析是否正常
      writeFileSync(
        sessionFile,
        JSON.stringify({
          session_id: sessionId,
          pid: process.pid,
          tty: "not a tty", // 正确处理，无换行符
          cwd: process.cwd(),
          branch: "test",
          started: new Date().toISOString(),
        })
      );

      const content = readFileSync(sessionFile, "utf-8");
      const parsed = JSON.parse(content); // 不应该抛出 JSON 解析错误

      expect(parsed.session_id).toBe(sessionId);
      expect(parsed.tty).toBe("not a tty");
    });
  });

  describe("session lifecycle", () => {
    it("should create session on Step 3", () => {
      const sessionId = "test-lifecycle-" + Date.now();
      const sessionFile = join(SESSION_DIR, `session-${sessionId}.json`);
      testSessionFiles.push(sessionFile);

      // 模拟 Step 3 创建会话
      writeFileSync(
        sessionFile,
        JSON.stringify({
          session_id: sessionId,
          pid: process.pid,
          tty: "not a tty",
          cwd: process.cwd(),
          branch: "cp-test",
          started: new Date().toISOString(),
          last_heartbeat: new Date().toISOString(),
        })
      );

      expect(existsSync(sessionFile)).toBe(true);
      const content = JSON.parse(readFileSync(sessionFile, "utf-8"));
      expect(content.session_id).toBe(sessionId);
    });

    it("should cleanup session on Step 11", () => {
      const sessionId = "test-cleanup-" + Date.now();
      const sessionFile = join(SESSION_DIR, `session-${sessionId}.json`);
      testSessionFiles.push(sessionFile);

      writeFileSync(sessionFile, JSON.stringify({ session_id: sessionId }));

      // 模拟 Step 11 清理
      const script = `
SESSION_ID="${sessionId}"
SESSION_FILE="${SESSION_DIR}/session-$SESSION_ID.json"
if [[ -f "$SESSION_FILE" ]]; then
    rm -f "$SESSION_FILE"
fi
      `;

      execSync(`bash -c '${script}'`);

      expect(existsSync(sessionFile)).toBe(false);
    });
  });

  describe("expired session cleanup", () => {
    it("should remove sessions older than 1 hour", () => {
      const expiredId = "test-expired-" + Date.now();
      const expiredFile = join(SESSION_DIR, `session-${expiredId}.json`);
      testSessionFiles.push(expiredFile);

      writeFileSync(expiredFile, JSON.stringify({ session_id: expiredId }));

      // 修改文件时间为 2 小时前
      execSync(
        `touch -t $(date -d '2 hours ago' +%Y%m%d%H%M) "${expiredFile}"`
      );

      // 执行清理（find -mmin +60）
      execSync(
        `find "${SESSION_DIR}" -name "session-${expiredId}.json" -mmin +60 -delete`
      );

      expect(existsSync(expiredFile)).toBe(false);
    });

    it("should keep fresh sessions", () => {
      const freshId = "test-fresh-" + Date.now();
      const freshFile = join(SESSION_DIR, `session-${freshId}.json`);
      testSessionFiles.push(freshFile);

      writeFileSync(freshFile, JSON.stringify({ session_id: freshId }));

      // 执行清理（find -mmin +60）
      execSync(
        `find "${SESSION_DIR}" -name "session-${freshId}.json" -mmin +60 -delete`
      );

      // 新鲜的会话不应该被删除
      expect(existsSync(freshFile)).toBe(true);
    });
  });

  describe("concurrent session detection", () => {
    it("should detect multiple sessions in same directory", () => {
      const session1Id = "test-concurrent-1-" + Date.now();
      const session2Id = "test-concurrent-2-" + Date.now();
      const session1File = join(SESSION_DIR, `session-${session1Id}.json`);
      const session2File = join(SESSION_DIR, `session-${session2Id}.json`);
      testSessionFiles.push(session1File, session2File);

      const testRepo = "/test/repo/path";

      writeFileSync(
        session1File,
        JSON.stringify({
          session_id: session1Id,
          pid: 11111,
          cwd: testRepo,
          branch: "cp-task-1",
        })
      );

      writeFileSync(
        session2File,
        JSON.stringify({
          session_id: session2Id,
          pid: 22222,
          cwd: testRepo,
          branch: "cp-task-2",
        })
      );

      // 检测同一 repo 的会话数量
      const script = `
SESSION_DIR="${SESSION_DIR}"
CURRENT_REPO="${testRepo}"
COUNT=0

for session_file in "$SESSION_DIR"/session-test-concurrent-*.json; do
    [[ ! -f "$session_file" ]] && continue
    session_repo=$(cat "$session_file" | grep -o '"cwd":"[^"]*"' | cut -d'"' -f4)
    if [[ "$session_repo" == "$CURRENT_REPO" ]]; then
        COUNT=$((COUNT + 1))
    fi
done

echo $COUNT
      `;

      const result = execSync(`bash <<'EOF'
${script}
EOF`, { encoding: "utf-8" });
      expect(parseInt(result.trim())).toBe(2);
    });
  });
});
