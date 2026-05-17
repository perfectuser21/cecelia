/**
 * Engine 动态行为测试 — 3 个关键场景
 *
 * 每个测试对应一个真实发生过的 bug，用动态执行（而非静态字符串检查）验证行为。
 * 这些测试构造真实的 git 环境，执行真实的 hook/脚本，检查真实的行为结果。
 *
 * 测试 1: devloop-check 条件 6 返回 done 而非 ready_to_merge（PR #2210 根因）
 * 测试 4: devloop-check 条件 6 合并后调用 cleanup.sh（PR #2221 根因）
 * 测试 5: CI 失败时 stop hook 返回 blocked（Claude 提前退出根因）
 *
 * 注：测试 2（跨 worktree 文件发现）和测试 3（并行会话隔离）已删除。
 * cwd-as-key 重写后，stop-dev.sh 不再扫描其他 worktree，session_id 匹配逻辑废止。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  execSync,
  spawnSync,
} from "child_process";
import {
  writeFileSync,
  mkdtempSync,
  existsSync,
  mkdirSync,
} from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

const ENGINE_ROOT = resolve(__dirname, "../..");
const DEVLOOP_CHECK = resolve(ENGINE_ROOT, "lib/devloop-check.sh");

// ============================================================================
// 辅助函数
// ============================================================================

/** 创建临时 git 仓库，含初始提交 */
function createTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "engine-dynamic-"));
  execSync(
    `cd "${dir}" && git init -q && ` +
      `git config user.email "test@test.com" && git config user.name "Test" && ` +
      `echo "init" > README.md && git add . && git commit -m "init" -q`
  );
  return dir;
}

/** 写 .dev-lock 文件 */
function writeDevLock(
  dir: string,
  branch: string,
  sessionId: string,
  tty: string = "not a tty"
): void {
  writeFileSync(
    join(dir, `.dev-lock.${branch}`),
    `dev\nbranch: ${branch}\nsession_id: ${sessionId}\ntty: ${tty}\nworktree_path: ${dir}\ncreated: 2026-04-11T00:00:00+08:00\n`
  );
}

/** 写 .dev-mode 文件 */
function writeDevMode(dir: string, branch: string, content: string): void {
  writeFileSync(join(dir, `.dev-mode.${branch}`), content);
}

/**
 * 创建 mock gh CLI 脚本
 *
 * devloop-check.sh 调用 gh 时用 -q 参数做 jq 查询，
 * 所以 mock 需要返回 jq 查询后的结果（纯值），不是原始 JSON。
 *
 * 常见调用模式：
 *   gh pr list --head BRANCH --state open --json number -q '.[0].number'  → 返回 "99"
 *   gh pr view 99 --json mergeable,state -q '{m:.mergeable,s:.state}'     → 返回 JSON
 *   gh pr merge 99 --squash --delete-branch                               → 返回 0
 *   gh run list --branch BRANCH --limit 1 --json status,conclusion,...    → 返回 JSON array
 *   gh repo view --json nameWithOwner -q '.nameWithOwner'                 → 返回 "owner/repo"
 */
function createMockGh(
  dir: string,
  opts: {
    prNumber?: number;
    prState?: string;       // "OPEN" | "MERGED"
    mergeable?: string;     // "MERGEABLE" | "CONFLICTING"
    ciStatus?: string;      // "completed" | "in_progress" | "queued"
    ciConclusion?: string;  // "success" | "failure" | ""
    mergeResult?: "success" | "fail";
    baseRef?: string;
  }
): string {
  const mockDir = join(dir, "_mock_bin");
  mkdirSync(mockDir, { recursive: true });

  const pr = opts.prNumber ?? 99;
  const prState = opts.prState ?? "OPEN";
  const mergeable = opts.mergeable ?? "MERGEABLE";
  const ciStatus = opts.ciStatus ?? "completed";
  const ciConclusion = opts.ciConclusion ?? "success";
  const mergeExit = opts.mergeResult === "fail" ? 1 : 0;
  const baseRef = opts.baseRef ?? "main";

  const script = `#!/bin/bash
ARGS="$*"

# gh pr list ... -q '.[0].number' → 返回纯数字
if [[ "$ARGS" == *"pr list"* ]]; then
  echo "${pr}"
  exit 0
fi

# gh pr view N --json mergeable,state -q '...' → 返回 JSON
if [[ "$ARGS" == *"pr view"* && "$ARGS" == *"mergeable"* ]]; then
  echo '{"m":"${mergeable}","s":"${prState}"}'
  exit 0
fi

# gh pr view N --json baseRefName -q '...' → 返回纯字符串
if [[ "$ARGS" == *"pr view"* && "$ARGS" == *"baseRefName"* ]]; then
  echo "${baseRef}"
  exit 0
fi

# gh pr merge → exit 0 或 1
if [[ "$ARGS" == *"pr merge"* ]]; then
  exit ${mergeExit}
fi

# gh run list → 返回 JSON array
if [[ "$ARGS" == *"run list"* ]]; then
  echo '[{"status":"${ciStatus}","conclusion":"${ciConclusion}","databaseId":789}]'
  exit 0
fi

# gh repo view → 返回纯字符串
if [[ "$ARGS" == *"repo view"* ]]; then
  echo "test/repo"
  exit 0
fi

exit 1
`;

  const ghPath = join(mockDir, "gh");
  writeFileSync(ghPath, script);
  execSync(`chmod +x "${ghPath}"`);
  return mockDir;
}

/** 执行 devloop_check 函数，返回 status + stdout */
function runDevloopCheck(
  branch: string,
  devModeFile: string,
  cwd: string,
  extraPath?: string
): { status: number; stdout: string; stderr: string } {
  const pathPrefix = extraPath ? `export PATH="${extraPath}:$PATH"; ` : "";
  const script = `${pathPrefix}source "${DEVLOOP_CHECK}"; devloop_check "${branch}" "${devModeFile}"`;
  const result = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    cwd,
    timeout: 15000,
    env: { ...process.env, PATH: extraPath ? `${extraPath}:${process.env.PATH}` : process.env.PATH || "" },
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

// ============================================================================
// 测试 1: devloop-check 条件 6 — CI 通过 + step_4 done → 自动合并 → done
// 对应 bug: ready_to_merge 中间状态导致 Claude 输出"请手动合并"然后退出
// ============================================================================

describe("测试 1: 条件 6 自动合并返回 done（PR #2210 根因）", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempGitRepo();
  });
  afterEach(() => {
    try { execSync(`rm -rf "${tempDir}"`); } catch { /* ignore */ }
  });

  it("step_4_ship=done + CI passed + PR open → status:done（非 ready_to_merge）", () => {
    const branch = "test-cond6-branch";
    execSync(`cd "${tempDir}" && git checkout -b ${branch} -q`);

    // 写 dev-mode: 所有 step 完成
    writeDevMode(
      tempDir,
      branch,
      `dev\nbranch: ${branch}\nstep_1_spec: done\nstep_2_code: done\nstep_3_integrate: done\nstep_4_ship: done\n`
    );

    // mock gh: PR 存在 + open + CI passed + merge 成功
    const mockDir = createMockGh(tempDir, {
      prNumber: 99,
      prState: "OPEN",
      ciStatus: "completed",
      ciConclusion: "success",
      mergeResult: "success",
    });

    const result = runDevloopCheck(
      branch,
      join(tempDir, `.dev-mode.${branch}`),
      tempDir,
      mockDir
    );

    // 核心断言：返回 done，不是 ready_to_merge
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"done"');
    expect(result.stdout).not.toContain("ready_to_merge");
  });
});

// ============================================================================
// 测试 4: 条件 6 合并后调用 cleanup.sh
// 对应 bug: 条件 6 merge 成功但不调用 cleanup.sh（部署/归档/GC 丢失）
// ============================================================================

describe("测试 4: 条件 6 自动合并后调用 cleanup.sh（PR #2221 根因）", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempGitRepo();
  });
  afterEach(() => {
    try { execSync(`rm -rf "${tempDir}"`); } catch { /* ignore */ }
  });

  it("merge 成功后 cleanup.sh 被调用（通过标记文件验证）", () => {
    const branch = "test-cleanup-call";
    execSync(`cd "${tempDir}" && git checkout -b ${branch} -q`);

    writeDevMode(
      tempDir,
      branch,
      `dev\nbranch: ${branch}\nstep_1_spec: done\nstep_2_code: done\nstep_3_integrate: done\nstep_4_ship: done\n`
    );

    // 创建假 cleanup.sh — 被调用时写一个标记文件
    const cleanupMarker = join(tempDir, ".cleanup-was-called");
    const scriptsDir = join(tempDir, "packages/engine/skills/dev/scripts");
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(
      join(scriptsDir, "cleanup.sh"),
      `#!/bin/bash\ntouch "${cleanupMarker}"\n`
    );
    execSync(`chmod +x "${join(scriptsDir, "cleanup.sh")}"`);

    // mock gh: PR open + CI passed + merge 成功
    const mockDir = createMockGh(tempDir, {
      prNumber: 42,
      prState: "OPEN",
      ciStatus: "completed",
      ciConclusion: "success",
      mergeResult: "success",
    });

    const result = runDevloopCheck(
      branch,
      join(tempDir, `.dev-mode.${branch}`),
      tempDir,
      mockDir
    );

    // 验证：devloop-check 返回 done
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"done"');

    // 核心验证：cleanup.sh 被调用了
    expect(existsSync(cleanupMarker)).toBe(true);
  });
});

// ============================================================================
// 测试 5: CI 失败时 devloop-check 返回 blocked
// 对应 bug: Claude 在 CI 还没通过时就退出（或 CI 失败不修复）
// ============================================================================

describe("测试 5: CI 失败/进行中时阻塞退出", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempGitRepo();
  });
  afterEach(() => {
    try { execSync(`rm -rf "${tempDir}"`); } catch { /* ignore */ }
  });

  it("CI failure → status:blocked + reason 包含失败信息", () => {
    const branch = "test-ci-fail";
    execSync(`cd "${tempDir}" && git checkout -b ${branch} -q`);

    writeDevMode(
      tempDir,
      branch,
      `dev\nbranch: ${branch}\nstep_1_spec: done\nstep_2_code: done\nstep_3_integrate: done\nstep_4_ship: done\n`
    );

    // mock gh: PR exists + CI 失败
    const mockDir = createMockGh(tempDir, {
      prNumber: 55,
      prState: "OPEN",
      ciStatus: "completed",
      ciConclusion: "failure",
    });

    const result = runDevloopCheck(
      branch,
      join(tempDir, `.dev-mode.${branch}`),
      tempDir,
      mockDir
    );

    // CI 失败 → blocked
    expect(result.status).toBe(2);
    expect(result.stdout).toContain('"blocked"');
    // reason 应该包含 CI 失败信息（中文："CI 失败"）
    expect(result.stdout).toContain("CI");
  });

  it("CI in_progress → status:blocked（不包含 action 字段）", () => {
    const branch = "test-ci-pending";
    execSync(`cd "${tempDir}" && git checkout -b ${branch} -q`);

    writeDevMode(
      tempDir,
      branch,
      `dev\nbranch: ${branch}\nstep_1_spec: done\nstep_2_code: done\nstep_3_integrate: done\nstep_4_ship: done\n`
    );

    // mock gh: PR exists + CI 进行中
    const mockDir = createMockGh(tempDir, {
      prNumber: 66,
      prState: "OPEN",
      ciStatus: "in_progress",
      ciConclusion: "",
    });

    const result = runDevloopCheck(
      branch,
      join(tempDir, `.dev-mode.${branch}`),
      tempDir,
      mockDir
    );

    // CI 进行中 → blocked
    expect(result.status).toBe(2);
    expect(result.stdout).toContain('"blocked"');
    // v4.3.0: CI in_progress 不输出 action 字段（防止 Claude 尝试"执行"等待操作）
    expect(result.stdout).not.toContain('"action"');
  });
});
