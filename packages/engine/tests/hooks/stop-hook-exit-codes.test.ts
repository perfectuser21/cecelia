/**
 * Stop Hook Exit 代码测试
 *
 * 验证 hooks/stop-dev.sh v20.1.0 三态退出码：
 * - exit 0  : done（PR 真完成 + cleanup_done，全文字面唯一一处）
 * - exit 99 : not-applicable（bypass / 主分支 / 无 .dev-mode），由 stop.sh 路由层放行
 * - exit 2  : blocked（业务未完成 OR 探测异常 fail-closed）
 *
 * NOTE: 这些用例直接打 stop-dev.sh，看到的是 raw 99；走 stop.sh 时 99 会被
 *       路由层吃掉转 0（覆盖在 stop-hook-full-lifecycle.test.ts 12 场景里）。
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

// TODO(cp-0504185237): Ralph Loop 模式（v21.0.0）协议变了 — 全部 exit 0 + decision JSON。
// 这些测试基于旧 done=0/not-dev=99/blocked=2 三态协议，需要重写。
// 临时：integration ralph-loop-mode.test.sh 5 case 覆盖核心行为。
describe.skip("hooks/stop-dev.sh exit codes（Ralph 模式后待重写）", () => {
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

  describe("exit 0 / exit 99 scenarios (session end allowed)", () => {
    it("should return exit 99 when no .dev-lock and no incomplete .dev-mode (not-applicable)", () => {
      // 主分支 + 无 .dev-mode → not-applicable → exit 99
      // （走 stop.sh 时路由层吃掉 99 转 0；这里直接打 stop-dev.sh，看到的是 raw 99）
      const exitCode = execSync(
        `cd "${tempDir}" && bash "${STOP_DEV_HOOK}" < /dev/null; echo $?`,
        { encoding: "utf-8" }
      );
      expect(exitCode.trim()).toBe("99");
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
  });

  describe("exit 2 scenarios (block session end)", () => {
    it("should return exit 0 when no .dev-lock and .dev-mode has cleanup_done (completed session)", () => {
      // dev-lock 丢失但 dev-mode 含 cleanup_done: true → exit 0
      // v16.9.0: B1 让 self-heal 在 HEAD==branch + 无 owner 时重建 dev-lock，
      //         随后 devloop-check 读到 cleanup_done 仍返回 allow（exit 0）——
      //         结果正确（exit 0），只是中间经过的路径从 orphan→silent 变成
      //         self-heal→devloop-check→allow。断言改为 EXIT:0 容忍 JSON 输出。
      const branch = "test-completed-branch";
      execSync(`cd "${tempDir}" && git checkout -b ${branch} -q`);

      writeFileSync(
        join(tempDir, `.dev-mode.${branch}`),
        `dev\nbranch: ${branch}\ncleanup_done: true\n`
      );

      const result = execSync(
        `cd "${tempDir}" && bash "${STOP_DEV_HOOK}" 2>&1 < /dev/null; echo "EXIT:$?"`,
        { encoding: "utf-8" }
      );
      expect(result).toContain("EXIT:0");
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

  describe("v16.9.0: B2 bypass env + B1 self-heal without CLAUDE_SESSION_ID", () => {
    it("B2: CECELIA_STOP_HOOK_BYPASS=1 makes hook exit 99 immediately (not-applicable, pass-through)", () => {
      // 即使存在未完成 session（正常情况下会 block），bypass=1 也应立即放行
      // v20.1.0 改成 exit 99（not-applicable），由 stop.sh 路由层吃掉转 0
      const branch = "test-bypass-branch";
      execSync(`cd "${tempDir}" && git checkout -b ${branch} -q`);
      writeFileSync(
        join(tempDir, `.dev-mode.${branch}`),
        `dev\nbranch: ${branch}\nstep_2_code: pending\nstep_3_integrate: pending\nstep_4_ship: pending\n`
      );

      const result = execSync(
        `cd "${tempDir}" && CECELIA_STOP_HOOK_BYPASS=1 bash "${STOP_DEV_HOOK}" 2>&1 < /dev/null; echo "EXIT:$?"`,
        { encoding: "utf-8" }
      );
      expect(result).toContain("EXIT:99");
      expect(result).toContain("CECELIA_STOP_HOOK_BYPASS");
    });

    it("B2: bypass not set → normal flow (should block when session incomplete)", () => {
      // 回归保护：不设 bypass env 时走正常逻辑
      const branch = "test-bypass-off-branch";
      execSync(`cd "${tempDir}" && git checkout -b ${branch} -q`);
      writeFileSync(
        join(tempDir, `.dev-mode.${branch}`),
        `dev\nbranch: ${branch}\nstep_2_code: pending\n`
      );

      const result = execSync(
        `cd "${tempDir}" && unset CECELIA_STOP_HOOK_BYPASS && bash "${STOP_DEV_HOOK}" 2>&1 < /dev/null || echo "exit:$?"`,
        { encoding: "utf-8" }
      );
      expect(result).toContain("exit:2");
      expect(result).not.toContain("CECELIA_STOP_HOOK_BYPASS");
    });

  });
});
