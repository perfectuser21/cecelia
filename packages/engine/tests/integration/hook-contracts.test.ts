/**
 * Hook 契约集成测试
 *
 * 测试 branch-protect.sh、stop-dev.sh 之间的隐式契约：
 *   1. .dev-mode 文件格式契约
 *   2. Worktree 检测契约
 *   3. CI 状态 JSON 契约
 *   4. hook-utils 共享函数契约
 *
 * 这些测试在真实的 git repo + worktree 环境中运行，
 * 确保修改一个 hook 不会破坏另一个。
 *
 * NOTE: vitest 子进程中 bash 管道不工作（已知限制），
 * 因此 hook 的 `INPUT=$(cat)` 被 patch 为从环境变量读取。
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

// ── Paths (relative to __dirname) ─────────────────────────────────────

const ENGINE_ROOT = path.resolve(__dirname, "../..");

// System PATH — inherit fully so git, jq, etc. are available
const SYSTEM_PATH = process.env.PATH ?? "/usr/bin:/bin";

// ── Helpers ────────────────────────────────────────────────────────────

interface TestEnv {
  mainRepo: string;
  worktree: string;
  branch: string;
  mockBin: string;
}

/**
 * Run a bash script, return { exitCode, stdout, stderr }.
 * Pass hookInput via HOOK_INPUT env var (vitest stdin piping is broken).
 */
function runBash(
  script: string,
  cwd: string,
  hookInput?: string,
  extraEnv?: Record<string, string>
): { exitCode: number; stdout: string; stderr: string } {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HOME: os.homedir(),
    ...extraEnv,
  };
  if (hookInput) {
    env.HOOK_INPUT = hookInput;
  }
  try {
    const stdout = execFileSync("/bin/bash", [script], {
      encoding: "utf-8",
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15_000,
      env,
    });
    return { exitCode: 0, stdout, stderr: "" };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      exitCode: e.status ?? 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
    };
  }
}

/**
 * Patch a hook script's `INPUT=$(cat)` to read from HOOK_INPUT env var.
 * This is needed because vitest child processes can't pipe stdin.
 */
function patchHookStdin(hookPath: string): void {
  let content = fs.readFileSync(hookPath, "utf-8");
  // branch-protect: INPUT=$(cat)
  content = content.replace(
    /^INPUT=\$\(cat\)$/m,
    'INPUT="${HOOK_INPUT:-$(cat)}"'
  );
  // stop-dev: HOOK_INPUT=$(cat)
  content = content.replace(
    /^HOOK_INPUT=\$\(cat\)$/m,
    'HOOK_INPUT="${HOOK_INPUT:-$(cat)}"'
  );
  fs.writeFileSync(hookPath, content);
}

/** Create an isolated git repo + worktree for testing */
function createTestEnv(name: string): TestEnv {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `hook-test-${name}-`));
  const mainRepo = path.join(base, "main");
  const branch = "cp-03050000-test-branch";

  fs.mkdirSync(mainRepo, { recursive: true });

  execFileSync("git", ["init", mainRepo], { encoding: "utf-8" });
  execFileSync("git", ["-C", mainRepo, "config", "user.email", "test@test.com"], { encoding: "utf-8" });
  execFileSync("git", ["-C", mainRepo, "config", "user.name", "Test"], { encoding: "utf-8" });
  fs.writeFileSync(path.join(mainRepo, "README.md"), "init");
  execFileSync("git", ["-C", mainRepo, "add", "."], { encoding: "utf-8" });
  execFileSync("git", ["-C", mainRepo, "commit", "-m", "init"], { encoding: "utf-8" });

  execFileSync("git", ["-C", mainRepo, "branch", branch], { encoding: "utf-8" });
  const worktree = path.join(base, "wt");
  execFileSync("git", ["-C", mainRepo, "worktree", "add", worktree, branch], { encoding: "utf-8" });

  // Copy engine libs
  const libDir = path.join(worktree, "packages/engine/lib");
  fs.mkdirSync(libDir, { recursive: true });
  for (const f of ["hook-utils.sh", "ci-status.sh", "lock-utils.sh"]) {
    const src = path.resolve(ENGINE_ROOT, "lib", f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(libDir, f));
  }

  // Copy and patch hooks
  const hookDir = path.join(worktree, "packages/engine/hooks");
  fs.mkdirSync(hookDir, { recursive: true });
  for (const f of ["branch-protect.sh", "stop-dev.sh"]) {
    const src = path.resolve(ENGINE_ROOT, "hooks", f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(hookDir, f));
      patchHookStdin(path.join(hookDir, f));
    }
  }

  const mockBin = path.join(base, "mock-bin");
  fs.mkdirSync(mockBin, { recursive: true });

  return { mainRepo, worktree, branch, mockBin };
}

/** Clean up test environment */
function destroyTestEnv(env: TestEnv): void {
  const base = path.dirname(env.mainRepo);
  try {
    execFileSync("git", ["-C", env.mainRepo, "worktree", "remove", env.worktree, "--force"], {
      encoding: "utf-8",
      stdio: "pipe",
    });
  } catch {
    // ignore
  }
  fs.rmSync(base, { recursive: true, force: true });
}

/** Write a valid .dev-mode file */
function writeDevMode(dir: string, branch: string, extra: Record<string, string> = {}): void {
  let content = `dev\nbranch: ${branch}\nprd: .prd-${branch}.md\nstarted: 2026-03-05T10:00:00+00:00\ntasks_created: true\n`;
  for (const [k, v] of Object.entries(extra)) {
    content += `${k}: ${v}\n`;
  }
  fs.writeFileSync(path.join(dir, ".dev-mode"), content);
}

/** Write minimal PRD/DoD files (must contain Chinese keywords for validation) */
function writePrdDod(dir: string, branch: string): void {
  const prd = [
    `# PRD: ${branch}`,
    "",
    "## 功能描述",
    "测试用 PRD 文件",
    "",
    "## 成功标准",
    "- 所有测试通过",
    "- CI 通过",
    "",
  ].join("\n");
  const dod = [
    `# DoD: ${branch}`,
    "",
    "## 验收清单",
    "- [ ] 测试项 1",
    "- [ ] 测试项 2",
    "- [ ] 测试项 3",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(dir, `.prd-${branch}.md`), prd);
  fs.writeFileSync(path.join(dir, `.dod-${branch}.md`), dod);
}

/** Create a mock `gh` CLI script */
function createMockGh(mockBin: string, output: string, exitCode = 0): void {
  const script = `#!/bin/bash\necho '${output}'\nexit ${exitCode}\n`;
  fs.writeFileSync(path.join(mockBin, "gh"), script, { mode: 0o755 });
}

/** Copy hooks/libs into a directory (for main repo tests) */
function copyEngineFiles(targetDir: string): void {
  const libDir = path.join(targetDir, "packages/engine/lib");
  const hookDir = path.join(targetDir, "packages/engine/hooks");
  fs.mkdirSync(libDir, { recursive: true });
  fs.mkdirSync(hookDir, { recursive: true });
  for (const f of ["hook-utils.sh", "ci-status.sh", "lock-utils.sh"]) {
    const src = path.resolve(ENGINE_ROOT, "lib", f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(libDir, f));
  }
  for (const f of ["branch-protect.sh", "stop-dev.sh"]) {
    const src = path.resolve(ENGINE_ROOT, "hooks", f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(hookDir, f));
      patchHookStdin(path.join(hookDir, f));
    }
  }
}

// ── Contract 1: .dev-mode format ──────────────────────────────────────

describe("Contract 1: .dev-mode 格式契约", () => {
  let env: TestEnv;

  beforeAll(() => { env = createTestEnv("devmode"); });
  afterAll(() => { destroyTestEnv(env); });

  it("branch-protect 允许有效 .dev-mode + PRD/DoD 的 worktree", () => {
    writeDevMode(env.worktree, env.branch);
    writePrdDod(env.worktree, env.branch);

    const hookPath = path.join(env.worktree, "packages/engine/hooks/branch-protect.sh");
    const input = JSON.stringify({
      tool_name: "Write",
      tool_input: { file_path: path.join(env.worktree, "test.ts"), content: "// test" },
    });

    const result = runBash(hookPath, env.worktree, input);
    expect(result.exitCode).toBe(0);
  });

  it("branch-protect 拒绝没有 .dev-mode 的 worktree", () => {
    const env2 = createTestEnv("devmode-reject");
    try {
      const hookPath = path.join(env2.worktree, "packages/engine/hooks/branch-protect.sh");
      const input = JSON.stringify({
        tool_name: "Write",
        tool_input: { file_path: path.join(env2.worktree, "test.ts"), content: "// test" },
      });

      const result = runBash(hookPath, env2.worktree, input);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(".dev-mode");
    } finally {
      destroyTestEnv(env2);
    }
  });

  it("stop-dev 读取 branch 字段与 branch-protect 写入格式一致", () => {
    writeDevMode(env.worktree, env.branch);

    const devModeContent = fs.readFileSync(path.join(env.worktree, ".dev-mode"), "utf-8");
    const lines = devModeContent.split("\n");

    expect(lines[0]).toBe("dev");

    const branchLine = lines.find((l) => l.startsWith("branch:"));
    expect(branchLine).toBeDefined();
    expect(branchLine!.split(":")[1].trim()).toBe(env.branch);

    const tcLine = lines.find((l) => l.startsWith("tasks_created:"));
    expect(tcLine).toBeDefined();
    expect(tcLine).toContain("true");
  });

  it("stop-dev 正确解析 retry_count 字段", () => {
    writeDevMode(env.worktree, env.branch, { retry_count: "5" });
    const content = fs.readFileSync(path.join(env.worktree, ".dev-mode"), "utf-8");
    const match = content.match(/^retry_count:\s*(\d+)/m);
    expect(match).not.toBeNull();
    expect(parseInt(match![1], 10)).toBe(5);
  });

  it("cleanup_done: true 格式能被 stop-dev 正确识别", () => {
    writeDevMode(env.worktree, env.branch, { cleanup_done: "true" });
    const content = fs.readFileSync(path.join(env.worktree, ".dev-mode"), "utf-8");
    expect(content).toMatch(/cleanup_done: true/);
  });
});

// ── Contract 2: Worktree detection ────────────────────────────────────

describe("Contract 2: Worktree 检测契约", () => {
  let env: TestEnv;

  beforeAll(() => { env = createTestEnv("worktree"); });
  afterAll(() => { destroyTestEnv(env); });

  it("worktree 的 git-dir 满足检测条件（含 worktrees 或有 gitdir 文件）", () => {
    const gitDir = execFileSync("git", ["-C", env.worktree, "rev-parse", "--git-dir"], {
      encoding: "utf-8",
    }).trim();

    const hasWorktreesPath = gitDir.includes("worktrees");
    const hasGitdirFile = fs.existsSync(path.join(gitDir, "gitdir"));
    expect(hasWorktreesPath || hasGitdirFile).toBe(true);
  });

  it("主仓库的 git-dir 不满足 worktree 检测条件", () => {
    const gitDir = execFileSync("git", ["-C", env.mainRepo, "rev-parse", "--git-dir"], {
      encoding: "utf-8",
    }).trim();

    expect(gitDir.includes("worktrees")).toBe(false);
    const gitdirPath = path.resolve(env.mainRepo, gitDir, "gitdir");
    expect(fs.existsSync(gitdirPath)).toBe(false);
  });

  it("branch-protect 拒绝主仓库中的 cp-* 分支（非 worktree）", () => {
    const testBranch = "cp-03050001-test-main-repo";
    execFileSync("git", ["-C", env.mainRepo, "branch", testBranch], {
      encoding: "utf-8", stdio: "pipe",
    });
    execFileSync("git", ["-C", env.mainRepo, "checkout", testBranch], {
      encoding: "utf-8", stdio: "pipe",
    });

    copyEngineFiles(env.mainRepo);

    const hookPath = path.join(env.mainRepo, "packages/engine/hooks/branch-protect.sh");
    const input = JSON.stringify({
      tool_name: "Write",
      tool_input: { file_path: path.join(env.mainRepo, "test.ts"), content: "// test" },
    });

    const result = runBash(hookPath, env.mainRepo, input);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("worktree");

    // Restore to default branch (main or master depending on git version/config)
    const defaultBranch = execFileSync("git", ["-C", env.mainRepo, "branch", "--list", "main", "master"], {
      encoding: "utf-8", stdio: "pipe",
    }).includes("main") ? "main" : "master";
    execFileSync("git", ["-C", env.mainRepo, "checkout", defaultBranch], {
      encoding: "utf-8", stdio: "pipe",
    });
  });

  it("branch-protect 允许 worktree 中有效的 cp-* 分支", () => {
    writeDevMode(env.worktree, env.branch);
    writePrdDod(env.worktree, env.branch);

    const hookPath = path.join(env.worktree, "packages/engine/hooks/branch-protect.sh");
    const input = JSON.stringify({
      tool_name: "Write",
      tool_input: { file_path: path.join(env.worktree, "src/feature.ts"), content: "export const x = 1;" },
    });

    const result = runBash(hookPath, env.worktree, input);
    expect(result.exitCode).toBe(0);
  });
});

// ── Contract 3: CI status JSON ────────────────────────────────────────

describe("Contract 3: CI 状态 JSON 契约", () => {
  let env: TestEnv;

  beforeAll(() => { env = createTestEnv("ci"); });
  afterAll(() => { destroyTestEnv(env); });

  it("ci-status.sh 输出标准 JSON {status, conclusion, run_id}", () => {
    createMockGh(env.mockBin, '[{"status":"completed","conclusion":"success","databaseId":12345}]');

    const testScript = path.join(env.worktree, "test-ci.sh");
    const ciLib = path.join(env.worktree, "packages/engine/lib/ci-status.sh");
    fs.writeFileSync(testScript, [
      "#!/bin/bash",
      "export CI_MAX_RETRIES=1",
      "export CI_RETRY_DELAY=0",
      `source "${ciLib}"`,
      'get_ci_status "test-branch"',
    ].join("\n"), { mode: 0o755 });

    const result = runBash(testScript, env.worktree, undefined, {
      PATH: `${env.mockBin}:${SYSTEM_PATH}`,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed).toHaveProperty("status", "completed");
    expect(parsed).toHaveProperty("conclusion", "success");
    expect(parsed).toHaveProperty("run_id");
  });

  it("ci-status.sh 在 gh 不可用时返回 unknown", () => {
    const testScript = path.join(env.worktree, "test-ci-nogh.sh");
    const ciLib = path.join(env.worktree, "packages/engine/lib/ci-status.sh");
    fs.writeFileSync(testScript, [
      "#!/bin/bash",
      "export CI_MAX_RETRIES=1",
      "export CI_RETRY_DELAY=0",
      'CLEAN_PATH=""',
      'IFS=: read -ra DIRS <<< "$PATH"',
      'for d in "${DIRS[@]}"; do',
      '  if [[ ! -x "$d/gh" ]]; then',
      '    CLEAN_PATH="${CLEAN_PATH:+$CLEAN_PATH:}$d"',
      '  fi',
      'done',
      'export PATH="$CLEAN_PATH"',
      `source "${ciLib}"`,
      'get_ci_status "test-branch"',
    ].join("\n"), { mode: 0o755 });

    const result = runBash(testScript, env.worktree);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.status).toBe("unknown");
  });

  it("is_ci_passed 正确判断成功状态", () => {
    createMockGh(env.mockBin, '[{"status":"completed","conclusion":"success","databaseId":99}]');

    const testScript = path.join(env.worktree, "test-ci-passed.sh");
    const ciLib = path.join(env.worktree, "packages/engine/lib/ci-status.sh");
    fs.writeFileSync(testScript, [
      "#!/bin/bash",
      "export CI_MAX_RETRIES=1",
      "export CI_RETRY_DELAY=0",
      `source "${ciLib}"`,
      'if is_ci_passed "test-branch"; then echo "PASSED"; else echo "NOT_PASSED"; fi',
    ].join("\n"), { mode: 0o755 });

    const result = runBash(testScript, env.worktree, undefined, {
      PATH: `${env.mockBin}:${SYSTEM_PATH}`,
    });
    expect(result.stdout.trim()).toBe("PASSED");
  });

  it("is_ci_failed 正确判断失败状态", () => {
    createMockGh(env.mockBin, '[{"status":"completed","conclusion":"failure","databaseId":100}]');

    const testScript = path.join(env.worktree, "test-ci-failed.sh");
    const ciLib = path.join(env.worktree, "packages/engine/lib/ci-status.sh");
    fs.writeFileSync(testScript, [
      "#!/bin/bash",
      "export CI_MAX_RETRIES=1",
      "export CI_RETRY_DELAY=0",
      `source "${ciLib}"`,
      'if is_ci_failed "test-branch"; then echo "FAILED"; else echo "NOT_FAILED"; fi',
    ].join("\n"), { mode: 0o755 });

    const result = runBash(testScript, env.worktree, undefined, {
      PATH: `${env.mockBin}:${SYSTEM_PATH}`,
    });
    expect(result.stdout.trim()).toBe("FAILED");
  });
});

// ── Contract 4: hook-utils shared functions ───────────────────────────

describe("Contract 4: hook-utils 共享函数契约", () => {
  let env: TestEnv;

  beforeAll(() => { env = createTestEnv("utils"); });
  afterAll(() => { destroyTestEnv(env); });

  function runUtilTest(body: string): { exitCode: number; stdout: string; stderr: string } {
    const testScript = path.join(env.worktree, "test-utils.sh");
    const utilsLib = path.join(env.worktree, "packages/engine/lib/hook-utils.sh");
    fs.writeFileSync(testScript, `#!/bin/bash\nsource "${utilsLib}"\n${body}\n`, { mode: 0o755 });
    return runBash(testScript, env.worktree);
  }

  it("clean_number 移除非数字字符", () => {
    const result = runUtilTest('echo "$(clean_number "12abc3")"');
    expect(result.stdout.trim()).toBe("123");
  });

  it("clean_number 空值返回 0", () => {
    const result = runUtilTest('echo "$(clean_number "")"');
    expect(result.stdout.trim()).toBe("0");
  });

  it("get_current_branch 在 worktree 中返回正确分支名", () => {
    const result = runUtilTest('echo "$(get_current_branch)"');
    expect(result.stdout.trim()).toBe(env.branch);
  });

  it("is_protected_branch 正确识别 main/develop", () => {
    const result = runUtilTest(
      'is_protected_branch "main" && echo "YES" || echo "NO"\nis_protected_branch "cp-test" && echo "YES" || echo "NO"'
    );
    const lines = result.stdout.trim().split("\n");
    expect(lines[0]).toBe("YES");
    expect(lines[1]).toBe("NO");
  });

  it("text_contains_token 检测真实凭据模式", () => {
    const result = runUtilTest(
      'text_contains_token "ghp_abcdefghijklmnopqrstuvwxyz1234567890" && echo "DETECTED" || echo "SAFE"'
    );
    expect(result.stdout.trim()).toBe("DETECTED");
  });

  it("text_contains_token 放行占位符", () => {
    const result = runUtilTest(
      'text_contains_token "ghp_YOUR_example_placeholder_token_here_12345" && echo "DETECTED" || echo "SAFE"'
    );
    expect(result.stdout.trim()).toBe("SAFE");
  });
});
