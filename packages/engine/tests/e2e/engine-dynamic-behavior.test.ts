/**
 * Engine 动态行为测试 — 5 个关键场景
 *
 * 每个测试对应一个真实发生过的 bug，用动态执行（而非静态字符串检查）验证行为。
 * 这些测试构造真实的 git 环境，执行真实的 hook/脚本，检查真实的行为结果。
 *
 * 测试 1: devloop-check 条件 6 返回 done 而非 ready_to_merge（PR #2210 根因）
 * 测试 2: dev-lock 在 worktree 中，stop hook 能跨 worktree 找到（PR #2223 根因）
 * 测试 3: 并行会话隔离 — session_id 不同时不互相匹配
 * 测试 4: devloop-check 条件 6 合并后调用 cleanup.sh（PR #2221 根因）
 * 测试 5: CI 失败时 stop hook 返回 blocked（Claude 提前退出根因）
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  execSync,
  spawnSync,
  type SpawnSyncReturns,
} from "child_process";
import {
  writeFileSync,
  mkdtempSync,
  existsSync,
  readFileSync,
  mkdirSync,
} from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

const ENGINE_ROOT = resolve(__dirname, "../..");
const DEVLOOP_CHECK = resolve(ENGINE_ROOT, "lib/devloop-check.sh");
const STOP_DEV_HOOK = resolve(ENGINE_ROOT, "hooks/stop-dev.sh");

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

/** 在临时仓库中创建真实的 worktree */
function createWorktree(
  mainDir: string,
  branch: string
): string {
  const wtDir = mkdtempSync(join(tmpdir(), "engine-wt-"));
  execSync(
    `cd "${mainDir}" && git worktree add -b "${branch}" "${wtDir}" HEAD -q 2>&1`
  );
  return wtDir;
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

/** 执行 stop-dev.sh，返回 exit code + 输出 */
function runStopHook(
  cwd: string,
  sessionId?: string
): { status: number; stdout: string; stderr: string } {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    HOME: process.env.HOME || "/tmp",
  };
  if (sessionId) env.CLAUDE_SESSION_ID = sessionId;

  const result = spawnSync(
    "bash",
    [STOP_DEV_HOOK],
    {
      encoding: "utf8",
      cwd,
      timeout: 15000,
      env,
      stdin: "pipe",
    }
  );
  return {
    status: result.status ?? -1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

/** 清理 worktree（忽略错误） */
function cleanupWorktree(mainDir: string, wtDir: string): void {
  try {
    execSync(`cd "${mainDir}" && git worktree remove "${wtDir}" --force 2>/dev/null`);
  } catch { /* ignore */ }
  try {
    execSync(`rm -rf "${wtDir}" 2>/dev/null`);
  } catch { /* ignore */ }
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
// 测试 2: 文件隔离 — dev-lock 在 worktree，stop hook 从主仓库能找到
// 对应 bug: dev-lock 写在主仓库导致并行污染
// ============================================================================

describe("测试 2: 跨 worktree 文件发现（PR #2223 根因）", () => {
  let mainDir: string;
  let wtDir: string;
  const branch = "cp-test-isolation";

  beforeEach(() => {
    mainDir = createTempGitRepo();
    wtDir = createWorktree(mainDir, branch);
  });
  afterEach(() => {
    cleanupWorktree(mainDir, wtDir);
    try { execSync(`rm -rf "${mainDir}"`); } catch { /* ignore */ }
  });

  it("dev-lock 在 worktree 中，stop-dev.sh 从主仓库能扫到", () => {
    const sessionId = "test-isolation-session";

    // dev-lock 和 dev-mode 都在 worktree 里（不在主仓库）
    writeDevLock(wtDir, branch, sessionId);
    writeDevMode(
      wtDir,
      branch,
      `dev\nbranch: ${branch}\nsession_id: ${sessionId}\nstep_2_code: pending\n`
    );

    // 主仓库不应该有这些文件
    expect(existsSync(join(mainDir, `.dev-lock.${branch}`))).toBe(false);
    expect(existsSync(join(mainDir, `.dev-mode.${branch}`))).toBe(false);

    // 从主仓库运行 stop hook，带 session_id
    const result = runStopHook(mainDir, sessionId);

    // 应该找到 worktree 中的文件，返回 blocked（step_2 pending）
    expect(result.status).toBe(2);
    // 输出应包含阻塞原因（找到了会话，不是"无关会话 exit 0"）
    const combined = result.stdout + result.stderr;
    expect(combined.length).toBeGreaterThan(0);
  });

  it("主仓库没有 dev-lock 也没有未完成 dev-mode → exit 0", () => {
    // worktree 有 dev-lock，但是 session_id 不匹配
    writeDevLock(wtDir, branch, "other-session-id");
    writeDevMode(
      wtDir,
      branch,
      `dev\nbranch: ${branch}\nsession_id: other-session-id\ncleanup_done: true\n`
    );

    // 用不匹配的 session_id 从主仓库运行
    const result = runStopHook(mainDir, "completely-different-session");

    // 不匹配任何 dev-lock → fail-closed 扫描 → dev-mode 有 cleanup_done → 跳过 → exit 0
    expect(result.status).toBe(0);
  });
});

// ============================================================================
// 测试 3: 并行会话隔离 — 两个 worktree 不互相匹配
// 对应 bug: session_id 为空时 branch fallback 导致匹配错误
// ============================================================================

describe("测试 3: 并行会话隔离", () => {
  let mainDir: string;
  let wt1: string;
  let wt2: string;
  const branch1 = "cp-test-session-a";
  const branch2 = "cp-test-session-b";

  beforeEach(() => {
    mainDir = createTempGitRepo();
    wt1 = createWorktree(mainDir, branch1);
    wt2 = createWorktree(mainDir, branch2);
  });
  afterEach(() => {
    cleanupWorktree(mainDir, wt1);
    cleanupWorktree(mainDir, wt2);
    try { execSync(`rm -rf "${mainDir}"`); } catch { /* ignore */ }
  });

  it("session A 的 stop hook 只匹配 session A 的 dev-lock", () => {
    const sessionA = "session-aaa-111";
    const sessionB = "session-bbb-222";

    // worktree 1: session A 的文件
    writeDevLock(wt1, branch1, sessionA);
    writeDevMode(
      wt1,
      branch1,
      `dev\nbranch: ${branch1}\nsession_id: ${sessionA}\nstep_2_code: pending\n`
    );

    // worktree 2: session B 的文件
    writeDevLock(wt2, branch2, sessionB);
    writeDevMode(
      wt2,
      branch2,
      `dev\nbranch: ${branch2}\nsession_id: ${sessionB}\ncleanup_done: true\n`
    );

    // Session A 的 stop hook 应匹配 wt1，返回 blocked（step_2 pending）
    const resultA = runStopHook(mainDir, sessionA);
    expect(resultA.status).toBe(2);

    // Session B 的 stop hook 应匹配 wt2，但 cleanup_done → exit 0
    const resultB = runStopHook(mainDir, sessionB);
    expect(resultB.status).toBe(0);
  });

  it("不同 session_id 不会互相干扰", () => {
    const sessionA = "session-aaa-333";
    const sessionB = "session-bbb-444";

    // 两个 worktree 都有未完成的任务
    writeDevLock(wt1, branch1, sessionA);
    writeDevMode(
      wt1,
      branch1,
      `dev\nbranch: ${branch1}\nsession_id: ${sessionA}\nstep_2_code: pending\n`
    );
    writeDevLock(wt2, branch2, sessionB);
    writeDevMode(
      wt2,
      branch2,
      `dev\nbranch: ${branch2}\nsession_id: ${sessionB}\nstep_2_code: pending\n`
    );

    // Session A 只匹配 wt1
    const resultA = runStopHook(mainDir, sessionA);
    expect(resultA.status).toBe(2);

    // Session B 只匹配 wt2
    const resultB = runStopHook(mainDir, sessionB);
    expect(resultB.status).toBe(2);

    // wt1 的文件仍然存在（没有被 Session B 删除）
    expect(existsSync(join(wt1, `.dev-lock.${branch1}`))).toBe(true);
    expect(existsSync(join(wt2, `.dev-lock.${branch2}`))).toBe(true);
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
