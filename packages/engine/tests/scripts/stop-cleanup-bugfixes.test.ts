/**
 * tests/scripts/stop-cleanup-bugfixes.test.ts
 *
 * CI 测试覆盖 stop-dev.sh + cleanup.sh 5 个 bug 修复（v12.40.1）：
 *
 * P0-1: stop-dev.sh PR 已合并时跳过 CI 检查
 * P0-2: cleanup.sh Section 10 .dev-mode 支持 per-branch 格式
 * P1-3: cleanup.sh Section 7.6 .dev-mode 验证支持 per-branch 格式
 * P1-4: cleanup.sh Section 9 不用 git branch --merged（squash merge 下失效）
 * P2-5: cleanup.sh Section 4.5 GC 不在 cleanup 中 fire-and-forget 启动
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const PROJECT_ROOT = resolve(__dirname, "../..");
const STOP_DEV = resolve(PROJECT_ROOT, "hooks/stop-dev.sh");
const CLEANUP_SH = resolve(PROJECT_ROOT, "skills/dev/scripts/cleanup.sh");

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
