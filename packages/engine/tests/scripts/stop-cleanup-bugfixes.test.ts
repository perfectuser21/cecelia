/**
 * tests/scripts/stop-cleanup-bugfixes.test.ts
 *
 * CI 测试覆盖 stop-dev.sh + cleanup.sh + worktree-gc.sh + lock-utils.sh bug 修复：
 *
 * === v12.40.1 ===
 * P0-1: stop-dev.sh PR 已合并时跳过 CI 检查
 * P0-2: cleanup.sh Section 10 .dev-mode 支持 per-branch 格式
 * P1-3: cleanup.sh Section 7.6 .dev-mode 验证支持 per-branch 格式
 * P1-4: cleanup.sh Section 9 不用 git branch --merged（squash merge 下失效）
 * P2-5: cleanup.sh Section 4.5 GC 不在 cleanup 中 fire-and-forget 启动
 *
 * === v12.41.0 ===
 * P0-1b: cleanup.sh sed step_11_cleanup 静默失败 → 验证后追加
 * P0-2b: stop-dev.sh 无头模式锁匹配 → 分支名 fallback
 * P0-3b: worktree-gc.sh rm -rf 无脏状态检查
 * P1-1b: stop-dev.sh sentinel 孤儿重试上限
 * P1-2b: stop-dev.sh .dev-lock 无 .dev-mode 重试上限
 * P1-3b: stop-dev.sh jq shim
 * P1-4b: lock-utils.sh _get_lock_paths 不覆写 DEV_MODE_FILE
 * P1-5b: worktree-gc.sh --state all → 分别查 merged + closed
 * P1-6b: worktree-gc.sh rm -rf 路径安全验证
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const PROJECT_ROOT = resolve(__dirname, "../..");
const STOP_DEV = resolve(PROJECT_ROOT, "hooks/stop-dev.sh");
const CLEANUP_SH = resolve(PROJECT_ROOT, "skills/dev/scripts/cleanup.sh");
const WORKTREE_GC = resolve(PROJECT_ROOT, "skills/dev/scripts/worktree-gc.sh");
const LOCK_UTILS = resolve(PROJECT_ROOT, "lib/lock-utils.sh");

/** 提取 bash 脚本中指定 section 编号的完整内容（两个 ======== 分隔线之间） */
function extractSection(content: string, sectionId: string): string {
  const escaped = sectionId.replace(".", "\\.");
  // 在 ======== 块内找到 "# N." 或 "# N " 格式
  const headerRegex = new RegExp(`#\\s*${escaped}[.\\s]`);
  const headerMatch = content.search(headerRegex);
  if (headerMatch === -1) return "";

  // 回溯到该 section 开头的 ======== 行
  const prevSeparator = content.lastIndexOf("# ========", headerMatch);
  const sectionStart = prevSeparator !== -1 ? prevSeparator : headerMatch;

  // 找到该 section 之后的下一个 ======== 分隔块
  // 跳过紧跟的结束 ======== 行（当前 section 的 header 块结束符）
  const afterHeader = content.indexOf("\n", headerMatch);
  const nextSeparator = content.indexOf("# ========", afterHeader);
  if (nextSeparator === -1) return content.slice(sectionStart);

  // 再找下一个 ======== 之后的内容结束点
  const nextNextSeparator = content.indexOf("# ========", nextSeparator + 10);
  return nextNextSeparator === -1
    ? content.slice(sectionStart)
    : content.slice(sectionStart, nextNextSeparator);
}

/** 过滤掉注释行，只保留代码行 */
function codeOnly(text: string): string {
  return text
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");
}

describe("P0-1: stop-dev.sh PR 已合并时跳过 CI 检查", () => {
  const content = readFileSync(STOP_DEV, "utf-8");

  it("包含 PR_STATE == merged 条件判断", () => {
    expect(content).toContain('PR_STATE" == "merged"');
  });

  it("merged 时输出 CI 已通过消息（不查询 CI）", () => {
    // 找到 merged CI 跳过的代码块
    const mergedIdx = content.indexOf('PR_STATE" == "merged"');
    expect(mergedIdx).toBeGreaterThan(-1);
    // merged 分支后应该有 CI 已通过的消息
    const afterMerged = content.slice(mergedIdx, mergedIdx + 200);
    expect(afterMerged).toMatch(/CI.*通过|CI.*passed/);
  });

  it("CI 查询逻辑在 else 分支中（非 merged 时才执行）", () => {
    // CI 查询（gh run list 或 get_ci_status）必须在 else 分支内
    // 验证：从 'PR_STATE == merged' 到 'else' 之间不包含 gh run list
    const mergedIdx = content.indexOf('PR_STATE" == "merged"');
    const elseIdx = content.indexOf("else", mergedIdx);
    const betweenBlock = content.slice(mergedIdx, elseIdx);
    expect(betweenBlock).not.toContain("gh run list");
    expect(betweenBlock).not.toContain("get_ci_status");

    // else 之后应包含 CI 查询逻辑
    const afterElse = content.slice(elseIdx, elseIdx + 500);
    expect(afterElse).toMatch(/gh run list|get_ci_status/);
  });
});

describe("P0-2: cleanup.sh Section 10 .dev-mode 支持 per-branch 格式", () => {
  const content = readFileSync(CLEANUP_SH, "utf-8");
  const section10 = extractSection(content, "10");

  it("Section 10 存在", () => {
    expect(section10.length).toBeGreaterThan(0);
  });

  it("优先使用 per-branch 格式 (.dev-mode.${CP_BRANCH})", () => {
    const code = codeOnly(section10);
    expect(code).toMatch(/\.dev-mode\.\$\{?CP_BRANCH\}?/);
  });

  it("有 fallback 到旧格式 (.dev-mode)", () => {
    // 检查 fallback 逻辑：如果 per-branch 不存在，用旧格式
    expect(section10).toMatch(/if.*!.*-f.*DEV_MODE_FILE|fallback/i);
  });

  it("不再硬编码 .dev-mode（无 per-branch 后缀）作为唯一路径", () => {
    const code = codeOnly(section10);
    // 确保 DEV_MODE_FILE 赋值包含 CP_BRANCH
    const assignments = code
      .split("\n")
      .filter((l) => l.includes("DEV_MODE_FILE=") && !l.includes("if"));
    expect(assignments.length).toBeGreaterThan(0);
    // 第一个赋值应该包含 per-branch 格式
    expect(assignments[0]).toContain("CP_BRANCH");
  });
});

describe("P1-3: cleanup.sh Section 7.6 .dev-mode 验证支持 per-branch 格式", () => {
  const content = readFileSync(CLEANUP_SH, "utf-8");
  const section76 = extractSection(content, "7.6");

  it("Section 7.6 存在", () => {
    expect(section76.length).toBeGreaterThan(0);
  });

  it("验证路径使用 per-branch 格式", () => {
    const code = codeOnly(section76);
    expect(code).toMatch(/\.dev-mode\.\$\{?CP_BRANCH\}?/);
  });

  it("有 fallback 到旧格式", () => {
    expect(section76).toMatch(/if.*!.*-f|fallback/i);
  });
});

describe("P1-4: cleanup.sh Section 9 不用 git branch --merged", () => {
  const content = readFileSync(CLEANUP_SH, "utf-8");
  const section9 = extractSection(content, "9");

  it("Section 9 存在", () => {
    expect(section9.length).toBeGreaterThan(0);
  });

  it("不使用 git branch --merged（squash merge 下失效）", () => {
    const code = codeOnly(section9);
    expect(code).not.toContain("branch --merged");
  });

  it("使用 gh pr list --state merged 检测已合并分支", () => {
    const code = codeOnly(section9);
    expect(code).toContain("gh pr list");
    expect(code).toMatch(/--state\s+merged/);
  });

  it("使用 --head 参数指定分支名", () => {
    const code = codeOnly(section9);
    expect(code).toContain("--head");
  });
});

describe("P2-5: cleanup.sh Section 4.5 GC 不在 cleanup 中 fire-and-forget 启动", () => {
  const content = readFileSync(CLEANUP_SH, "utf-8");
  const section45 = extractSection(content, "4.5");

  it("Section 4.5 存在", () => {
    expect(section45.length).toBeGreaterThan(0);
  });

  it("不包含 fire-and-forget 后台启动 GC", () => {
    const code = codeOnly(section45);
    // 不应该有 & 后台启动
    expect(code).not.toMatch(/bash.*worktree-gc.*&\)/);
    expect(code).not.toMatch(/\(bash.*&\)/);
  });

  it("不直接执行 worktree-gc.sh", () => {
    const code = codeOnly(section45);
    // 不应该有 bash "$GC_SCRIPT" 执行（注释中可以提及）
    expect(code).not.toMatch(/bash\s+"\$GC_SCRIPT"/);
  });

  it("提示 GC 将在 cleanup 完成后由 stop hook 触发", () => {
    expect(section45).toMatch(/stop.*hook|cleanup.*完成后/);
  });
});

// ============================================================================
// v12.41.0 深度修复测试
// ============================================================================

describe("P0-1b: cleanup.sh sed step_11_cleanup 静默失败修复", () => {
  const content = readFileSync(CLEANUP_SH, "utf-8");

  it("定义了 _mark_cleanup_done 函数", () => {
    expect(content).toContain("_mark_cleanup_done()");
  });

  it("sed 后用 grep 验证结果", () => {
    expect(content).toMatch(
      /grep.*-q.*step_11_cleanup: done.*\$target_file/
    );
  });

  it("验证失败时追加行", () => {
    expect(content).toContain('echo "step_11_cleanup: done" >> "$target_file"');
  });

  it("追加前先删除可能存在的其他格式", () => {
    expect(content).toMatch(/sed.*-i.*step_11_cleanup:.*\/d/);
  });
});

describe("P0-2b: stop-dev.sh 无头模式锁匹配修复", () => {
  const content = readFileSync(STOP_DEV, "utf-8");

  it("包含 TTY 和 session_id 都为空时的分支名 fallback", () => {
    expect(content).toMatch(
      /CURRENT_TTY.*not a tty.*_CURRENT_SESSION_ID/s
    );
  });

  it("使用当前分支名匹配 lock 中的 branch", () => {
    expect(content).toContain("_branch_in_lock\" == \"$CURRENT_BRANCH\"");
  });
});

describe("P0-3b: worktree-gc.sh 脏状态检查", () => {
  const content = readFileSync(WORKTREE_GC, "utf-8");

  it("删除前检查 git status --porcelain", () => {
    expect(content).toMatch(/git\s+-C\s+"\$WT_PATH"\s+status\s+--porcelain/);
  });

  it("有未提交改动时跳过并输出警告", () => {
    expect(content).toMatch(/WARN.*未提交改动.*跳过/);
  });

  it("脏检查后 continue 跳过当前 worktree", () => {
    const dirtyIdx = content.indexOf("未提交改动");
    const continueIdx = content.indexOf("continue", dirtyIdx);
    expect(continueIdx).toBeGreaterThan(dirtyIdx);
    expect(continueIdx - dirtyIdx).toBeLessThan(500);
  });
});

describe("P1-1b: stop-dev.sh sentinel 孤儿重试上限", () => {
  const content = readFileSync(STOP_DEV, "utf-8");

  it("sentinel 路径使用 .dev-orphan-retry 追踪重试", () => {
    const sentinelSection = content.slice(
      content.indexOf("检查 sentinel（三重保险）"),
      content.indexOf("没有任何 dev 状态文件")
    );
    expect(sentinelSection).toContain(".dev-orphan-retry");
  });

  it("超过 5 次后清理 sentinel 并 exit 0", () => {
    expect(content).toMatch(/_ORPHAN_COUNT.*-gt\s+5/);
    const limitIdx = content.indexOf("_ORPHAN_COUNT -gt 5");
    const exitIdx = content.indexOf("exit 0", limitIdx);
    expect(exitIdx).toBeGreaterThan(limitIdx);
    expect(exitIdx - limitIdx).toBeLessThan(300);
  });
});

describe("P1-2b: stop-dev.sh .dev-lock 无 .dev-mode 重试上限", () => {
  const content = readFileSync(STOP_DEV, "utf-8");

  it(".dev-lock 无 .dev-mode 路径使用 .dev-orphan-retry 追踪", () => {
    const lockSection = content.slice(
      content.indexOf(".dev-lock 存在，检查 .dev-mode"),
      content.indexOf("检查 cleanup 是否已完成")
    );
    expect(lockSection).toContain(".dev-orphan-retry");
  });

  it("超过 5 次后清理 lock 并 exit 0", () => {
    const lockSection = content.slice(
      content.indexOf(".dev-lock 存在，检查 .dev-mode"),
      content.indexOf("检查 cleanup 是否已完成")
    );
    expect(lockSection).toMatch(/_ORPHAN_COUNT.*-gt\s+5/);
    expect(lockSection).toContain("exit 0");
  });
});

describe("P1-3b: stop-dev.sh jq shim", () => {
  const content = readFileSync(STOP_DEV, "utf-8");

  it("检测 jq 不存在时提供 shim 函数", () => {
    expect(content).toMatch(/if.*!.*command.*-v\s+jq/);
    expect(content).toMatch(/jq\(\)\s*\{/);
  });

  it("shim 消费 stdin 并返回有效 JSON", () => {
    expect(content).toContain("cat >/dev/null");
    expect(content).toContain("echo '{}'");
  });
});

describe("P1-4b: lock-utils.sh 不覆写调用者 DEV_MODE_FILE", () => {
  const content = readFileSync(LOCK_UTILS, "utf-8");

  it("内部变量使用 _LU_ 前缀", () => {
    expect(content).toContain("_LU_DEV_MODE_FILE=");
    expect(content).toContain("_LU_LOCK_DIR=");
    expect(content).toContain("_LU_LOCK_FILE=");
  });

  it("_get_lock_paths 不设置 DEV_MODE_FILE 全局变量", () => {
    const funcBody = content.slice(
      content.indexOf("_get_lock_paths()"),
      content.indexOf("}", content.indexOf("_get_lock_paths()") + 50) + 1
    );
    expect(funcBody).not.toMatch(/^\s+DEV_MODE_FILE=/m);
    expect(funcBody).not.toMatch(/^\s+LOCK_DIR=/m);
  });

  it("acquire_dev_mode_lock 使用 _LU_LOCK_FILE", () => {
    const funcBody = content.slice(
      content.indexOf("acquire_dev_mode_lock()"),
      content.indexOf("}", content.indexOf("acquire_dev_mode_lock()") + 80) + 1
    );
    expect(funcBody).toContain("$_LU_LOCK_FILE");
    expect(funcBody).not.toContain('"$LOCK_FILE"');
  });

  it("cleanup.sh 保存/恢复 DEV_MODE_FILE", () => {
    const cleanupContent = readFileSync(CLEANUP_SH, "utf-8");
    expect(cleanupContent).toContain("_SAVED_DEV_MODE_FILE");
  });
});

describe("P1-5b: worktree-gc.sh 不使用 --state all", () => {
  const content = readFileSync(WORKTREE_GC, "utf-8");

  it("不包含 --state all", () => {
    const code = content
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");
    expect(code).not.toContain("--state all");
  });

  it("分别查询 --state merged 和 --state closed", () => {
    expect(content).toMatch(/--state\s+merged/);
    expect(content).toMatch(/--state\s+closed/);
  });
});

describe("P1-6b: worktree-gc.sh rm -rf 路径安全验证", () => {
  const content = readFileSync(WORKTREE_GC, "utf-8");

  it("rm -rf fallback 前有 realpath 验证", () => {
    expect(content).toMatch(/realpath.*WT_PATH/);
    expect(content).toMatch(/realpath.*MAIN_WT/);
  });

  it("禁止删除根目录或 HOME 目录", () => {
    expect(content).toMatch(/real_wt.*!=.*\/"/);
    expect(content).toContain('!= "$HOME"');
  });

  it("路径安全检查失败时输出警告并跳过", () => {
    expect(content).toMatch(/路径安全检查失败.*跳过/);
  });
});
