/**
 * CURRENT_STATE 全链路集成测试
 *
 * 模拟 /dev Stage4 触发 write-current-state.sh 生成 CURRENT_STATE.md，
 * 验证内容格式正确（含所有必需章节）。
 *
 * 设计原则：CI 兼容（Brain/DB/gh 不可用时脚本优雅降级，测试仍可通过）
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import { readFileSync, existsSync, unlinkSync } from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";

const ENGINE_ROOT = path.resolve(__dirname, "../..");
// WORKTREE_ROOT：当前分支代码所在的根目录（worktree 或主仓库均适用）
// 用于找到本次 PR 修改后的 scripts/write-current-state.sh
const WORKTREE_ROOT = path.resolve(ENGINE_ROOT, "../..");
const SCRIPT = path.join(WORKTREE_ROOT, "scripts/write-current-state.sh");
// 使用 UUID 临时文件隔离测试输出，避免与其他进程竞争主仓库的 CURRENT_STATE.md
const TMP_OUTPUT = path.join(os.tmpdir(), `current-state-test-${randomUUID()}.md`);

const state: { content: string } = { content: "" };

describe("CURRENT_STATE 全链路集成验证", () => {
  beforeAll(() => {
    // 模拟 Stage4 cleanup.sh 触发 write-current-state.sh
    // 使用 spawnSync 替代 execSync，只传入系统标准 PATH（不包含 node_modules/.bin）。
    // 原因：node_modules/.bin/cat 是 Node.js 脚本，无法处理 bash heredoc 的 stdin 管道，
    //       导致 cat > file <<HEREDOC 写入空文件。必须使用 /bin/cat 等真实系统命令。
    // BRAIN_API_URL 指向无效端口，确保 CI 中不依赖真实 Brain（脚本优雅降级）
    // CURRENT_STATE_OUTPUT_FILE 指向临时文件，避免与其他进程竞争主仓库文件
    const result = spawnSync("bash", [SCRIPT], {
      env: {
        HOME: process.env.HOME ?? "/root",
        PATH: "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin",
        LANG: "en_US.UTF-8",
        BRAIN_API_URL: "http://127.0.0.1:1",
        CURRENT_STATE_OUTPUT_FILE: TMP_OUTPUT,
      },
      cwd: ENGINE_ROOT,
      timeout: 60000,
      encoding: "utf-8",
    });

    if (result.status !== 0 || result.error) {
      throw new Error(
        `write-current-state.sh 执行失败 (status=${result.status})\n` +
          `STDOUT: ${result.stdout}\n` +
          `STDERR: ${result.stderr}\n` +
          `ERROR: ${result.error ?? "none"}`
      );
    }

    state.content = existsSync(TMP_OUTPUT) ? readFileSync(TMP_OUTPUT, "utf-8") : "";
  });

  afterAll(() => {
    try {
      unlinkSync(TMP_OUTPUT);
    } catch {
      // 临时文件不存在时忽略
    }
  });

  it("write-current-state.sh 脚本存在", () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });

  it("CURRENT_STATE.md 已生成（临时文件存在）", () => {
    expect(existsSync(TMP_OUTPUT)).toBe(true);
  });

  it("包含 YAML frontmatter（generated + source 字段）", () => {
    expect(state.content).toMatch(/^---/);
    expect(state.content).toContain("generated:");
    expect(state.content).toContain("source: write-current-state.sh");
  });

  it("包含页面主标题", () => {
    expect(state.content).toContain("# Cecelia 系统当前状态");
  });

  it("包含系统健康章节（含 Brain API 和警觉等级字段）", () => {
    expect(state.content).toContain("## 系统健康");
    expect(state.content).toContain("Brain API");
    expect(state.content).toContain("警觉等级");
  });

  it("包含 Capability Probe 章节", () => {
    expect(state.content).toContain("## Capability Probe");
  });

  it("包含进行中任务章节", () => {
    expect(state.content).toContain("## 进行中任务");
  });

  it("包含最近 PR 章节", () => {
    expect(state.content).toContain("## 最近 PR");
  });

  it("包含 P0 Issues 章节", () => {
    expect(state.content).toContain("## P0 Issues");
  });

  it("包含最近 CI 状态章节", () => {
    expect(state.content).toContain("## 最近 CI 状态");
  });
});
