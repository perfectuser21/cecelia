/**
 * Stop Hook 状态完整性测试
 *
 * 验证 stop-dev.sh 在各种状态文件损坏/缺失场景下的行为。
 * 核心原则：有 .dev-lock 存在时，安全默认是 exit 2（阻止退出），不能 exit 0 放行。
 *
 * PR #550 修复：
 * - .dev-mode 首行不是 "dev" 时从 exit 0 改为 exit 2
 * - 03-branch.md Task Checkpoint 写错文件名（.dev-mode → .dev-mode.${BRANCH_NAME}）
 *
 * 测试策略：
 * - per-branch lock 匹配需要 TTY 或 CLAUDE_SESSION_ID
 * - 测试通过设置 CLAUDE_SESSION_ID=test-session 来匹配 lock 文件中的 session_id
 * - 旧格式 (.dev-lock/.dev-mode) 用于 session_id 匹配不到时的 fallback 测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { writeFileSync, mkdtempSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const STOP_DEV_HOOK = join(__dirname, "../../hooks/stop-dev.sh");
const STOP_ROUTER = join(__dirname, "../../hooks/stop.sh");

const TEST_SESSION_ID = "test-session-abc123";

/**
 * 在临时 git repo 中执行 stop hook 并返回 exit code
 * 通过 CLAUDE_SESSION_ID 环境变量让 per-branch lock 匹配成功
 */
function runStopHook(dir: string, hookPath: string = STOP_DEV_HOOK): number {
  try {
    execSync(
      `cd "${dir}" && CLAUDE_SESSION_ID="${TEST_SESSION_ID}" bash "${hookPath}" < /dev/null 2>/dev/null`,
      { encoding: "utf-8", timeout: 10000 }
    );
    return 0;
  } catch (e: any) {
    return e.status ?? 1;
  }
}

/**
 * 初始化临时 git repo 并创建分支
 */
function initGitRepo(dir: string, branchName: string = "cp-test-branch"): void {
  execSync(
    `cd "${dir}" && git init -q && git config user.email "test@test.com" && git config user.name "Test" && echo test > README.md && git add . && git commit -m "init" -q && git checkout -b "${branchName}" -q`,
    { encoding: "utf-8" }
  );
}

/**
 * 创建 per-branch 格式的 lock + mode 状态文件
 */
function createDevState(
  dir: string,
  branch: string,
  modeContent: string,
  extraLockFields: string = ""
): void {
  writeFileSync(
    join(dir, `.dev-lock.${branch}`),
    `dev_lock\nbranch: ${branch}\nsession_id: ${TEST_SESSION_ID}\ntty: not a tty\n${extraLockFields}`
  );
  writeFileSync(join(dir, `.dev-mode.${branch}`), modeContent);
}

describe("Stop Hook 状态完整性 (PR #550)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "stop-hook-integrity-"));
  });

  afterEach(() => {
    try {
      execSync(`rm -rf "${tempDir}"`);
    } catch { /* ignore */ }
  });

  describe("路由器 (stop.sh)", () => {
    it("无任何状态文件 → exit 0（普通会话，允许结束）", () => {
      initGitRepo(tempDir);
      const code = runStopHook(tempDir, STOP_ROUTER);
      expect(code).toBe(0);
    });

    it("有 .dev-lock.<branch> + 匹配 session_id → 调用 stop-dev.sh（exit 2）", () => {
      initGitRepo(tempDir, "cp-test");
      createDevState(
        tempDir,
        "cp-test",
        `dev\nbranch: cp-test\nsession_id: ${TEST_SESSION_ID}\ntty: not a tty\nretry_count: 0\n`
      );
      const code = runStopHook(tempDir, STOP_ROUTER);
      expect(code).toBe(2);
    });
  });

  describe("stop-dev.sh 核心安全", () => {
    it("正确格式 .dev-mode（首行 dev） + 无 PR → exit 2（阻止）", () => {
      initGitRepo(tempDir, "cp-test");
      createDevState(
        tempDir,
        "cp-test",
        `dev\nbranch: cp-test\nsession_id: ${TEST_SESSION_ID}\ntty: not a tty\nretry_count: 0\n`
      );
      const code = runStopHook(tempDir);
      expect(code).toBe(2);
    });

    it("损坏的 .dev-mode（首行不是 dev）→ exit 2（安全默认阻止，PR #549 根因）", () => {
      initGitRepo(tempDir, "cp-test");
      createDevState(
        tempDir,
        "cp-test",
        "tasks_created: true\n"  // 首行不是 "dev" — PR #549 的实际 bug
      );
      const code = runStopHook(tempDir);
      expect(code).toBe(2);
    });

    it("空 .dev-mode 文件 → exit 2（安全默认阻止）", () => {
      initGitRepo(tempDir, "cp-test");
      createDevState(tempDir, "cp-test", "");
      const code = runStopHook(tempDir);
      expect(code).toBe(2);
    });

    it("cleanup_done: true → exit 0（正常完成，状态文件被清理）", () => {
      initGitRepo(tempDir, "cp-test");
      createDevState(
        tempDir,
        "cp-test",
        `dev\nbranch: cp-test\nsession_id: ${TEST_SESSION_ID}\ntty: not a tty\ncleanup_done: true\n`
      );
      const code = runStopHook(tempDir);
      expect(code).toBe(0);
      expect(existsSync(join(tempDir, ".dev-mode.cp-test"))).toBe(false);
      expect(existsSync(join(tempDir, ".dev-lock.cp-test"))).toBe(false);
    });

    it("retry_count 超过 30 → exit 0（安全阀，防无限循环，v15.1.0: MAX_RETRIES=30）", () => {
      initGitRepo(tempDir, "cp-test");
      createDevState(
        tempDir,
        "cp-test",
        `dev\nbranch: cp-test\nsession_id: ${TEST_SESSION_ID}\ntty: not a tty\nretry_count: 30\n`
      );
      const code = runStopHook(tempDir);
      expect(code).toBe(0);
    });

    it(".dev-lock 存在但 .dev-mode 缺失 → exit 2（状态丢失保护）", () => {
      initGitRepo(tempDir, "cp-test");
      // 只创建 lock，不创建 mode
      writeFileSync(
        join(tempDir, ".dev-lock.cp-test"),
        `dev_lock\nbranch: cp-test\nsession_id: ${TEST_SESSION_ID}\ntty: not a tty\n`
      );
      const code = runStopHook(tempDir);
      expect(code).toBe(2);
    });
  });

  describe("旧格式兼容 (fallback)", () => {
    it("旧格式 .dev-lock + .dev-mode（无 branch 后缀）→ exit 0（v14.0.0 已删除旧格式支持）", () => {
      initGitRepo(tempDir, "cp-old-format");
      // v14.0.0: "删除所有旧格式兼容代码，只保留 per-branch 格式"
      // 旧格式 .dev-lock（无后缀）不会被 session 预检查匹配 → exit 0（允许结束）
      // 此行为是预期的：旧格式工作流应迁移到 per-branch 格式（有 session_id 的 .dev-lock.<branch>）
      writeFileSync(join(tempDir, ".dev-lock"), "dev_workflow_active\n");
      writeFileSync(
        join(tempDir, ".dev-mode"),
        "dev\nbranch: cp-old-format\nretry_count: 0\n"
      );
      // 旧格式无 per-branch lock（.dev-lock.*），session 预检查找不到匹配 → exit 0
      const code = runStopHook(tempDir);
      expect(code).toBe(0);
    });
  });

  describe("03-branch.md 修复验证", () => {
    it("Task Checkpoint 不能追加到裸 .dev-mode（必须是 .dev-mode.${BRANCH_NAME}）", () => {
      const branchMd = readFileSync(
        join(__dirname, "../../skills/dev/steps/03-branch.md"),
        "utf-8"
      );
      // 正则：匹配 >> .dev-mode 后面不跟 .${BRANCH_NAME} 的行（代码块内）
      // >> .dev-mode\n 是错的，>> ".dev-mode.${BRANCH_NAME}" 是对的
      const lines = branchMd.split("\n");
      const bareAppends = lines.filter(
        (l) => l.includes(">> .dev-mode") && !l.includes("BRANCH_NAME") && !l.startsWith("#")
      );
      expect(bareAppends).toHaveLength(0);
    });

    it(".dev-mode 文件模板首行必须是 dev", () => {
      const branchMd = readFileSync(
        join(__dirname, "../../skills/dev/steps/03-branch.md"),
        "utf-8"
      );
      expect(branchMd).toContain('echo "dev"');
    });
  });
});
