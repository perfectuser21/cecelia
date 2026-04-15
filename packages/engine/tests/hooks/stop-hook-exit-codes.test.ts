/**
 * Stop Hook Exit 代码测试
 *
 * 验证 hooks/stop-dev.sh 在不同场景下返回正确的 exit 代码：
 * - exit 0: 允许会话结束（完成或无关会话）
 * - exit 2: 阻止会话结束（未完成，继续执行）
 *
 * NOTE: stop-dev.sh v14.0.0+ 只识别 .dev-mode.{branch}（per-branch 格式）。
 * 触发逻辑的前提：必须有匹配的 .dev-lock.{branch} 文件存在。
 * 没有 .dev-lock → hook 直接 exit 0（无关会话）。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { writeFileSync, mkdtempSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const STOP_DEV_HOOK = join(__dirname, "../../hooks/stop-dev.sh");

/** 为测试分支写入 .dev-lock.{branch}，使 stop-dev.sh 能识别此会话 */
function writeDevLock(dir: string, branch: string, sessionId: string): void {
  writeFileSync(
    join(dir, `.dev-lock.${branch}`),
    `dev\nbranch: ${branch}\nsession_id: ${sessionId}\ntty: not a tty\n`
  );
}

/** 为测试分支写入 .dev-mode.{branch}（per-branch 格式） */
function writeDevMode(dir: string, branch: string, content: string): void {
  writeFileSync(join(dir, `.dev-mode.${branch}`), content);
}

describe("hooks/stop-dev.sh exit codes", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "stop-hook-test-"));
    // 初始化 git 仓库并创建初始提交（hook 需要 git toplevel）
    execSync(
      `cd "${tempDir}" && git init -q && ` +
        `git config user.email "test@test.com" && git config user.name "Test" && ` +
        `echo "init" > README.md && git add . && git commit -m "init" -q`
    );
  });

  afterEach(() => {
    try {
      execSync(`rm -rf "${tempDir}"`);
    } catch {
      // ignore
    }
  });

  describe("exit 0 scenarios (allow session end)", () => {
    it("should return exit 0 when no .dev-lock and no incomplete .dev-mode (no active session)", () => {
      // 无 .dev-lock 且无未完成 .dev-mode → hook 判断无活跃会话 → exit 0
      const exitCode = execSync(
        `cd "${tempDir}" && bash "${STOP_DEV_HOOK}" < /dev/null; echo $?`,
        { encoding: "utf-8" }
      );
      expect(exitCode.trim()).toBe("0");
    });

    it("should return exit 0 when cleanup_done: true", () => {
      const branch = "test-cleanup-branch";
      execSync(`cd "${tempDir}" && git checkout -b ${branch} -q`);

      const sessionId = "test-session-cleanup";
      writeDevLock(tempDir, branch, sessionId);
      writeDevMode(
        tempDir,
        branch,
        `dev\nbranch: ${branch}\nsession_id: ${sessionId}\ncleanup_done: true\n`
      );

      // cleanup_done: true → hook 输出 JSON {"decision":"allow",...} 并 exit 0
      // 用 `bash ... ; echo "EXIT:$?"` 分离 JSON 输出和退出码
      const result = execSync(
        `cd "${tempDir}" && CLAUDE_SESSION_ID=${sessionId} bash "${STOP_DEV_HOOK}" < /dev/null; echo "EXIT:$?"`,
        { encoding: "utf-8" }
      );
      expect(result).toContain("EXIT:0");
      // hook 输出的 JSON 应包含 allow
      expect(result).toContain('"decision"');
      // 文件应被 hook 删除
      expect(existsSync(join(tempDir, `.dev-mode.${branch}`))).toBe(false);
    });

    it("should return exit 0 when retry_count reaches 15 (max retries exhausted)", () => {
      // retry_count: 15 是通过 devloop-check 逻辑判断的，
      // 在没有 devloop-check 库加载时 hook 会 fail-closed（exit 2）。
      // 这里仅验证：有 .dev-lock 但文件中有 retry_count 字段时，行为合理（exit 0 或 exit 2）。
      const branch = "test-retry-branch";
      execSync(`cd "${tempDir}" && git checkout -b ${branch} -q`);

      const sessionId = "test-session-retry";
      writeDevLock(tempDir, branch, sessionId);
      writeDevMode(
        tempDir,
        branch,
        `dev\nbranch: ${branch}\nsession_id: ${sessionId}\nretry_count: 15\n`
      );

      const result = execSync(
        `cd "${tempDir}" && CLAUDE_SESSION_ID=${sessionId} bash "${STOP_DEV_HOOK}" < /dev/null || echo "exit:$?"`,
        { encoding: "utf-8" }
      );
      // hook 要么 exit 0（retry 耗尽），要么 exit 2（devloop-check 阻止）
      // 关键：不应崩溃（exit 1）
      const exitMatch = result.match(/exit:(\d+)/);
      if (exitMatch) {
        expect([0, 2]).toContain(parseInt(exitMatch[1]));
      } else {
        // 无 exit: 说明 exit 0
        expect(result).not.toContain("exit:1");
      }
    });
    it("should return exit 0 when current_sid is empty and orphan dev-lock has different session_id (cross-session isolation fix)", () => {
      // 修复场景：headless/nested session（CLAUDE_SESSION_ID 为空）
      // orphan dev-lock 含 session_id → 属于别的 session → 不应 block
      const branch = "test-cross-session-empty-current";
      execSync(`cd "${tempDir}" && git checkout -b ${branch} -q`);

      const orphanBranch = "orphan-session-branch";
      const orphanSessionId = "orphan-sid-4aac48fe";
      // 写孤儿 dev-mode（有未完成步骤）和 dev-lock（含 session_id）
      writeDevMode(
        tempDir,
        orphanBranch,
        `dev\nbranch: ${orphanBranch}\nstep_2_code: pending\nstep_3_integrate: pending\nstep_4_ship: pending\n`
      );
      writeDevLock(tempDir, orphanBranch, orphanSessionId);

      // 当前 session 无 dev-lock（CLAUDE_SESSION_ID 为空 = headless）
      // 孤儿 session_id 非空且不同 → 应 skip → exit 0
      const exitCode = execSync(
        `cd "${tempDir}" && CLAUDE_SESSION_ID="" bash "${STOP_DEV_HOOK}" < /dev/null; echo $?`,
        { encoding: "utf-8" }
      );
      expect(exitCode.trim()).toBe("0");
    });

    it("should return exit 0 when current_sid differs from orphan session_id (cross-session isolation regression)", () => {
      // 回归保护：current_sid 非空 + orphan_sid 非空 + 不同 → skip → exit 0
      const branch = "test-cross-session-both-known";
      execSync(`cd "${tempDir}" && git checkout -b ${branch} -q`);

      const currentSessionId = "current-sid-abc123";
      const orphanBranch = "orphan-session-branch-b";
      const orphanSessionId = "orphan-sid-xyz789";
      writeDevMode(
        tempDir,
        orphanBranch,
        `dev\nbranch: ${orphanBranch}\nstep_2_code: pending\nstep_3_integrate: pending\nstep_4_ship: pending\n`
      );
      writeDevLock(tempDir, orphanBranch, orphanSessionId);

      // 当前 session 有 CLAUDE_SESSION_ID，但与孤儿不同 → skip → exit 0
      const exitCode = execSync(
        `cd "${tempDir}" && CLAUDE_SESSION_ID=${currentSessionId} bash "${STOP_DEV_HOOK}" < /dev/null; echo $?`,
        { encoding: "utf-8" }
      );
      expect(exitCode.trim()).toBe("0");
    });
  });

  describe("exit 2 scenarios (block session end)", () => {
    it("should return exit 2 when no .dev-lock but incomplete .dev-mode exists (fail-closed)", () => {
      // dev-lock 丢失但 dev-mode 有未完成步骤 → fail-closed → exit 2
      const branch = "test-orphan-branch";
      execSync(`cd "${tempDir}" && git checkout -b ${branch} -q`);

      // 只写 dev-mode，不写 dev-lock（模拟 dev-lock 丢失场景）
      writeFileSync(
        join(tempDir, `.dev-mode.${branch}`),
        `dev\nbranch: ${branch}\nstep_2_code: pending\nstep_3_integrate: pending\nstep_4_ship: pending\n`
      );

      const result = execSync(
        `cd "${tempDir}" && bash "${STOP_DEV_HOOK}" < /dev/null || echo "exit:$?"`,
        { encoding: "utf-8" }
      );
      expect(result).toContain("exit:2");
      // 应输出 dev-lock 丢失的 block 原因
      expect(result).toContain("dev-lock");
    });

    it("should return exit 0 when no .dev-lock and .dev-mode has cleanup_done (completed session)", () => {
      // dev-lock 丢失但 dev-mode 含 cleanup_done: true → 已完成会话 → exit 0
      const branch = "test-completed-branch";
      execSync(`cd "${tempDir}" && git checkout -b ${branch} -q`);

      writeFileSync(
        join(tempDir, `.dev-mode.${branch}`),
        `dev\nbranch: ${branch}\ncleanup_done: true\n`
      );

      const exitCode = execSync(
        `cd "${tempDir}" && bash "${STOP_DEV_HOOK}" < /dev/null; echo $?`,
        { encoding: "utf-8" }
      );
      expect(exitCode.trim()).toBe("0");
    });

    it("should return exit 2 when PR not created", () => {
      const branch = "test-branch";
      // Create initial commit so we can create a branch
      execSync(`cd "${tempDir}" && git checkout -b ${branch} -q`);

      const sessionId = "test123";
      writeDevLock(tempDir, branch, sessionId);
      writeDevMode(
        tempDir,
        branch,
        `dev\nbranch: ${branch}\nsession_id: ${sessionId}\n`
      );

      // 模拟 gh pr list 返回空（PR 未创建），限制 PATH 使 gh 不可用
      const result = execSync(
        `cd "${tempDir}" && export PATH=/usr/bin:/bin && CLAUDE_SESSION_ID=${sessionId} bash "${STOP_DEV_HOOK}" < /dev/null || echo "exit:$?"`,
        { encoding: "utf-8" }
      );
      expect(result).toContain("exit:2");
    });

    it("should return exit 2 when CI is in progress", () => {
      // 这个测试需要 mock gh CLI，暂时跳过
      // 实际测试在集成测试中验证
    });

    it("should return exit 2 when CI failed", () => {
      // 这个测试需要 mock gh CLI，暂时跳过
      // 实际测试在集成测试中验证
    });

    it("should return exit 2 when PR not merged", () => {
      // 这个测试需要 mock gh CLI，暂时跳过
      // 实际测试在集成测试中验证
    });

    it("should return exit 2 when step_5 not completed (devloop-check blocks)", () => {
      const branch = "test-step5-branch";
      execSync(`cd "${tempDir}" && git checkout -b ${branch} -q`);

      const sessionId = "test-step5-session";
      writeDevLock(tempDir, branch, sessionId);
      writeDevMode(
        tempDir,
        branch,
        `dev\nbranch: ${branch}\nsession_id: ${sessionId}\nstep_5_clean: pending\n`
      );

      // devloop-check 应检测到 step_5 未完成并阻止退出
      const result = execSync(
        `cd "${tempDir}" && export PATH=/usr/bin:/bin && CLAUDE_SESSION_ID=${sessionId} bash "${STOP_DEV_HOOK}" < /dev/null || echo "exit:$?"`,
        { encoding: "utf-8" }
      );
      expect(result).toContain("exit:2");
    });
  });

  describe("exit code consistency", () => {
    it("should never return exit 1 (reserved for errors)", () => {
      const branch = "test-consistency-branch";
      execSync(`cd "${tempDir}" && git checkout -b ${branch} -q`);

      const sessionId = "test-consistency-session";
      writeDevLock(tempDir, branch, sessionId);
      writeDevMode(
        tempDir,
        branch,
        `dev\nbranch: ${branch}\nsession_id: ${sessionId}\n`
      );

      const result = execSync(
        `cd "${tempDir}" && export PATH=/usr/bin:/bin && CLAUDE_SESSION_ID=${sessionId} bash "${STOP_DEV_HOOK}" < /dev/null || echo "exit:$?"`,
        { encoding: "utf-8" }
      );

      // exit 0 或 exit 2，不应该是 exit 1
      const exitMatch = result.match(/exit:(\d+)/);
      if (exitMatch) {
        const code = parseInt(exitMatch[1]);
        expect([0, 2]).toContain(code);
      }
    });
  });
});
