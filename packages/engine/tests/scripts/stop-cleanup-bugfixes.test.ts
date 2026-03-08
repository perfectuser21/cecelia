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

describe("P1-4: cleanup.sh Section 9 委托给 branch-gc.sh", () => {
  const content = readFileSync(CLEANUP_SH, "utf-8");
  const section9 = extractSection(content, "9");

  it("Section 9 存在", () => {
    expect(section9.length).toBeGreaterThan(0);
  });

  it("不使用 git branch --merged（squash merge 下失效）", () => {
    const code = codeOnly(section9);
    expect(code).not.toContain("branch --merged");
  });

  it("委托给 branch-gc.sh 执行清理", () => {
    const code = codeOnly(section9);
    expect(code).toContain("branch-gc.sh");
  });

  it("branch-gc.sh 存在且包含三类清理逻辑", () => {
    const branchGcPath = resolve(PROJECT_ROOT, "skills/dev/scripts/branch-gc.sh");
    const branchGc = readFileSync(branchGcPath, "utf-8");
    expect(branchGc).toMatch(/--state\s+merged/);
    expect(branchGc).toMatch(/--state\s+closed/);
    expect(branchGc).toContain("STALE_HOURS");
    expect(branchGc).toContain("--dry-run");
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

  it("acquire_dev_mode_lock 使用 _LU_LOCK_FILE 或 _LU_FD", () => {
    const funcStart = content.indexOf("acquire_dev_mode_lock()");
    // 找到函数的最后一个 } (跳过内部 if 块的 })
    const releaseStart = content.indexOf("release_dev_mode_lock()", funcStart);
    const funcBody = content.slice(funcStart, releaseStart);
    // 使用 _LU_LOCK_FILE 或通过 _LU_FD 间接引用
    expect(funcBody).toMatch(/_LU_LOCK_FILE|_LU_FD/);
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

// ============================================================================
// v12.42.0 Round 2 深度修复测试
// ============================================================================

describe("R2-lock: lock-utils.sh worktree .git 文件检测", () => {
  const content = readFileSync(LOCK_UTILS, "utf-8");

  it("使用 git rev-parse --git-dir 获取真正的 git 目录", () => {
    expect(content).toContain("git rev-parse --git-dir");
  });

  it("不再仅用 -d .git 检测（worktree 中 .git 是文件）", () => {
    const funcBody = content.slice(
      content.indexOf("_get_lock_paths()"),
      content.indexOf("}", content.indexOf("_LU_LOCK_FILE=") + 10) + 1
    );
    expect(funcBody).not.toMatch(/\[\[.*!.*-d.*"\$project_root\/\.git"/);
  });

  it("FD 可通过 LOCK_UTILS_FD 环境变量配置", () => {
    expect(content).toContain("LOCK_UTILS_FD");
    expect(content).toContain("_LU_FD");
  });

  it("flock 缺失时静默跳过（macOS 兼容）", () => {
    const acquireBody = content.slice(
      content.indexOf("acquire_dev_mode_lock()"),
      content.indexOf("}", content.indexOf("acquire_dev_mode_lock()") + 200) + 1
    );
    expect(acquireBody).toMatch(/command.*-v\s+flock/);
  });

  it("sha256sum 有跨平台 fallback", () => {
    expect(content).toMatch(/shasum|md5sum/);
  });

  it("atomic_append_dev_mode 文件不存在时也使用 temp+mv", () => {
    const funcBody = content.slice(
      content.indexOf("atomic_append_dev_mode()"),
      content.indexOf("}", content.indexOf("atomic_append_dev_mode()") + 300) + 1
    );
    expect(funcBody).toContain("mktemp");
    expect(funcBody).not.toMatch(
      /if.*!.*-f.*\n\s+echo.*>.*_LU_DEV_MODE_FILE.*\n\s+return/
    );
  });
});

describe("R2-cleanup-P0: cleanup.sh worktree 感知", () => {
  const content = readFileSync(CLEANUP_SH, "utf-8");

  it("检测是否在 worktree 中运行", () => {
    expect(content).toContain("IS_WORKTREE=false");
    expect(content).toMatch(/git rev-parse --git-dir/);
    expect(content).toMatch(/worktrees.*IS_WORKTREE=true/s);
  });

  it("worktree 中跳过 checkout 但不设 FAILED", () => {
    const section1 = extractSection(content, "1");
    expect(section1).toContain("IS_WORKTREE");
    expect(section1).toMatch(/worktree.*跳过分支切换/s);
    // worktree 分支中不应有独立的 FAILED=1（CHECKOUT_FAILED=1 是可以的）
    const wtBlock = section1.slice(
      section1.indexOf("IS_WORKTREE"),
      section1.indexOf("elif")
    );
    // 检查没有单独设置 FAILED=1（CHECKOUT_FAILED=1 可以有）
    const failedLines = wtBlock.split("\n").filter(
      (l) => l.match(/^\s+FAILED=1/) && !l.includes("CHECKOUT_FAILED")
    );
    expect(failedLines.length).toBe(0);
  });
});

describe("R2-cleanup-P1: cleanup.sh 搜索路径修复", () => {
  const content = readFileSync(CLEANUP_SH, "utf-8");

  it("lock-utils.sh 搜索路径包含 packages/engine/lib/", () => {
    expect(content).toContain("packages/engine/lib/lock-utils.sh");
  });
});

describe("R2-cleanup-P1: cleanup.sh step 验证 grep 精确匹配", () => {
  const content = readFileSync(CLEANUP_SH, "utf-8");

  it("使用 STEP_PATTERNS 数组精确匹配步骤名", () => {
    expect(content).toContain("STEP_PATTERNS");
    expect(content).toContain("step_1_prd");
    expect(content).toContain("step_10_learning");
    expect(content).toContain("step_11_cleanup");
  });

  it("不使用 step_${step}_ 模糊 grep", () => {
    const section76 = extractSection(content, "7.6");
    const code = codeOnly(section76);
    expect(code).not.toMatch(/grep.*\^step_\$\{step\}_/);
  });
});

describe("R2-cleanup-P1: cleanup.sh 验证失败阻止 cleanup_done 写入", () => {
  const content = readFileSync(CLEANUP_SH, "utf-8");

  it("设置 VALIDATION_PASSED 标志", () => {
    expect(content).toContain("VALIDATION_PASSED=true");
    expect(content).toContain("VALIDATION_PASSED=false");
  });

  it("cleanup_done 写入前检查 VALIDATION_PASSED", () => {
    expect(content).toMatch(/VALIDATION_PASSED.*true.*_mark_cleanup_done/s);
  });
});

describe("R2-cleanup-P1: cleanup.sh safe_rm_rf 精确前缀匹配", () => {
  const content = readFileSync(CLEANUP_SH, "utf-8");

  it("前缀匹配包含 / 分隔符", () => {
    expect(content).toContain('"$real_parent/"');
  });
});

describe("R2-cleanup-P1: cleanup.sh xargs 错误保护", () => {
  const content = readFileSync(CLEANUP_SH, "utf-8");
  const section95 = extractSection(content, "9.5");

  it("不使用 xargs git branch -D（set -e 下不安全）", () => {
    const code = codeOnly(section95);
    expect(code).not.toContain("xargs");
  });

  it("使用 while 循环逐个删除分支", () => {
    expect(section95).toMatch(/while.*read.*gone_branch/s);
    expect(section95).toMatch(/git branch -D.*2>\/dev\/null.*\|\| /);
  });
});

describe("R2-stop: stop-dev.sh FD 冲突修复", () => {
  const content = readFileSync(STOP_DEV, "utf-8");

  it("retry_count 块不使用 FD 200", () => {
    const retryBlock = content.slice(
      content.indexOf("更新重试次数"),
      content.indexOf("读取 .dev-mode 内容")
    );
    expect(retryBlock).not.toMatch(/\b200\b.*>"?\$DEV_MODE_FILE/);
  });

  it("fallback 锁不使用 FD 200", () => {
    const fallbackBlock = content.slice(
      content.indexOf("Fallback: 内联锁"),
      content.indexOf("读取 Hook 输入")
    );
    expect(fallbackBlock).not.toMatch(/exec\s+200>/);
  });
});

describe("R2-stop: stop-dev.sh orphan retry 分离 + 清理", () => {
  const content = readFileSync(STOP_DEV, "utf-8");

  it("sentinel 和 lock 孤儿使用不同计数器文件", () => {
    expect(content).toContain(".dev-orphan-retry-sentinel");
    expect(content).toContain(".dev-orphan-retry-lock");
  });

  it("正常退出时清理 orphan retry 文件", () => {
    const cleanupDoneBlock = content.slice(
      content.indexOf("cleanup_done: true"),
      content.indexOf("cleanup_done: true") + 500
    );
    expect(cleanupDoneBlock).toContain(".dev-orphan-retry-sentinel");
    expect(cleanupDoneBlock).toContain(".dev-orphan-retry-lock");
  });

  it("工作流完成时清理 orphan retry 文件", () => {
    const doneBlock = content.slice(
      content.indexOf("工作流完成"),
      content.indexOf("工作流完成") + 500
    );
    expect(doneBlock).toContain(".dev-orphan-retry-sentinel");
  });
});

describe("R2-stop: stop-dev.sh macOS flock 兼容", () => {
  const content = readFileSync(STOP_DEV, "utf-8");

  it("fallback 锁检测 flock 可用性", () => {
    const fallbackBlock = content.slice(
      content.indexOf("Fallback: 内联锁"),
      content.indexOf("读取 Hook 输入")
    );
    expect(fallbackBlock).toMatch(/command.*-v\s+flock/);
  });
});

describe("R2-stop: stop-dev.sh save_block_reason 换行过滤", () => {
  const content = readFileSync(STOP_DEV, "utf-8");

  it("reason 参数过滤换行符", () => {
    const funcBody = content.slice(
      content.indexOf("save_block_reason()"),
      content.indexOf("}", content.indexOf("save_block_reason()") + 300) + 1
    );
    expect(funcBody).toMatch(/\\n/);
  });
});

describe("R2-stop: stop-dev.sh 无重复 CURRENT_BRANCH 声明", () => {
  const content = readFileSync(STOP_DEV, "utf-8");

  it("P0-3 修复处不再重复声明 CURRENT_BRANCH", () => {
    const p03Section = content.slice(
      content.indexOf("P0-3 修复：会话隔离"),
      content.indexOf("P0-3 修复：会话隔离") + 200
    );
    expect(p03Section).not.toContain(
      'CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD'
    );
  });
});

describe("R2-stop: stop-dev.sh lock-utils 搜索路径修复", () => {
  const content = readFileSync(STOP_DEV, "utf-8");

  it("搜索路径包含 packages/engine/lib/", () => {
    expect(content).toContain("packages/engine/lib/lock-utils.sh");
    expect(content).toContain("packages/engine/lib/ci-status.sh");
  });
});

describe("R2-gc: worktree-gc.sh 路径安全精确匹配", () => {
  const content = readFileSync(WORKTREE_GC, "utf-8");

  it("使用 .claude/worktrees 或同父目录校验，不用 dirname 过宽匹配", () => {
    expect(content).toContain("worktree_dir");
    expect(content).toContain(".claude/worktrees");
    expect(content).toContain("wt_parent");
    expect(content).toContain("main_parent");
  });

  it("路径长度最小限制（防止短路径误删）", () => {
    expect(content).toMatch(/\$\{#real_wt\}.*-gt\s+10/);
  });
});

describe("R2-gc: worktree-gc.sh macOS stat 兼容", () => {
  const content = readFileSync(WORKTREE_GC, "utf-8");

  it("同时支持 Linux stat -c 和 macOS stat -f", () => {
    expect(content).toContain("stat -c %Y");
    expect(content).toContain("stat -f %m");
  });
});

describe("R2-gc: worktree-gc.sh API 限流检测", () => {
  const content = readFileSync(WORKTREE_GC, "utf-8");

  it("API 调用失败时输出警告并跳过", () => {
    expect(content).toContain("API_FAILED");
    expect(content).toMatch(/WARN.*API.*失败.*限流/);
  });
});

describe("R2-gc: worktree-gc.sh 并发锁保护", () => {
  const content = readFileSync(WORKTREE_GC, "utf-8");

  it("使用 flock 防止并发运行", () => {
    expect(content).toContain("worktree-gc.lock");
    expect(content).toMatch(/flock.*-n/);
  });

  it("另一实例运行时退出", () => {
    expect(content).toMatch(/另一个.*worktree-gc.*运行/);
  });
});

describe("R2-gc: worktree-gc.sh Check 3 不重复 API 调用", () => {
  const content = readFileSync(WORKTREE_GC, "utf-8");

  it("Check 3 复用 Check 1/2 的结果", () => {
    // 检查 3 内不应有额外的 gh pr list 调用
    const check3Start = content.indexOf("检查 3:");
    const check4Start = content.indexOf("检查 4:");
    const check3Block = content.slice(check3Start, check4Start);
    const code = check3Block
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");
    expect(code).not.toContain("gh pr list");
    expect(code).toContain("MERGED_PR");
  });
});

describe("R2-cross: cleanup.sh 移除 cleanup-complete 死代码", () => {
  const content = readFileSync(CLEANUP_SH, "utf-8");

  it("不再调用 create_cleanup_signal", () => {
    const code = content
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");
    expect(code).not.toContain("create_cleanup_signal");
  });
});

describe("R2-cross: stop-dev.sh 清理 .dev-failure.log", () => {
  const content = readFileSync(STOP_DEV, "utf-8");

  it("工作流完成时清理 .dev-failure.log", () => {
    const doneBlock = content.slice(
      content.indexOf("工作流完成"),
      content.indexOf("工作流完成") + 500
    );
    expect(doneBlock).toContain(".dev-failure.log");
  });
});
