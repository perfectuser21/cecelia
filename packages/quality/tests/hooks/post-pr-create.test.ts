/**
 * post-pr-create.sh 回归测试
 *
 * 所有分支都只能把 PR 交给 Kernel exact-SHA merge gate。
 * Hook 不再拥有任何 auto-merge authority。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync, execSync } from "child_process";
import { existsSync, statSync, writeFileSync, mkdirSync, chmodSync, rmSync } from "fs";
import { resolve, join } from "path";

const HOOK_PATH = resolve(__dirname, "../../hooks/post-pr-create.sh");

// 构造 PostToolUse JSON 输入
function makeInput(command: string, prUrl = "https://github.com/owner/repo/pull/42"): string {
  return JSON.stringify({
    tool_name: "Bash",
    tool_input: { command },
    tool_response: { output: prUrl },
  });
}

// 运行 hook，注入假的 gh / git 到 PATH
function runHook(
  input: string,
  fakeBinDir: string,
  extraEnv: Record<string, string> = {}
): { exitCode: number; stderr: string } {
  const result = spawnSync("bash", [HOOK_PATH], {
    input,
    encoding: "utf-8",
    env: {
      ...process.env,
      PATH: `${fakeBinDir}:${process.env.PATH}`,
      ...extraEnv,
    },
  });
  return {
    exitCode: result.status ?? -1,
    stderr: result.stderr || "",
  };
}

// 临时目录存放 fake 可执行文件
const TMP_DIR = join(resolve(__dirname, "../.."), ".test-post-pr-create");

// 创建 fake gh：指定 exit code 和 stdout 输出
function makeFakeGh(exitCode: number, stdout = ""): string {
  const binDir = join(TMP_DIR, `gh-exit${exitCode}-${Date.now()}`);
  mkdirSync(binDir, { recursive: true });
  const script = join(binDir, "gh");
  writeFileSync(script, `#!/usr/bin/env bash\necho "${stdout}"\nexit ${exitCode}\n`);
  chmodSync(script, 0o755);
  return binDir;
}

// 创建同时包含 fake gh 和 fake git 的 binDir
function makeFakeBinDir(ghExitCode: number, ghStdout: string, gitBranch: string | null): string {
  const binDir = join(TMP_DIR, `bin-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(binDir, { recursive: true });

  // fake gh
  writeFileSync(
    join(binDir, "gh"),
    `#!/usr/bin/env bash\necho "${ghStdout}"\nexit ${ghExitCode}\n`
  );
  chmodSync(join(binDir, "gh"), 0o755);

  // fake git
  if (gitBranch === null) {
    // git 失败
    writeFileSync(join(binDir, "git"), `#!/usr/bin/env bash\nexit 1\n`);
  } else {
    writeFileSync(
      join(binDir, "git"),
      `#!/usr/bin/env bash\nif [[ "$*" == *"branch --show-current"* ]]; then\n  echo "${gitBranch}"\n  exit 0\nfi\n# 其他 git 命令透传\n$(which git 2>/dev/null || echo git) "$@"\nexit $?\n`
    );
  }
  chmodSync(join(binDir, "git"), 0o755);

  return binDir;
}

describe("post-pr-create.sh", () => {
  beforeAll(() => {
    mkdirSync(TMP_DIR, { recursive: true });
  });

  afterAll(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it("hook 文件存在且可执行", () => {
    expect(existsSync(HOOK_PATH)).toBe(true);
    const mode = statSync(HOOK_PATH).mode;
    expect(mode & 0o111).toBeGreaterThan(0);
  });

  it("语法检查通过", () => {
    expect(() => {
      execSync(`bash -n "${HOOK_PATH}"`, { encoding: "utf-8" });
    }).not.toThrow();
  });

  it("非 gh pr create 命令直接放行（exit 0）", () => {
    const input = makeInput("npm test");
    const binDir = makeFakeBinDir(0, "some-branch", "some-branch");
    const { exitCode } = runHook(input, binDir);
    expect(exitCode).toBe(0);
  });

  it("用例1: rewrite/* 分支 → 交给 Kernel merge gate", () => {
    const binDir = makeFakeBinDir(0, "rewrite/ux-overhaul", "rewrite/ux-overhaul");
    const input = makeInput("gh pr create --repo owner/repo --title 'test'");
    const { exitCode, stderr } = runHook(input, binDir);
    expect(exitCode).toBe(0);
    expect(stderr).toMatch(/Kernel|merge gate/);
    expect(stderr).not.toMatch(/触发 auto-merge/);
  });

  it("用例2: cp-* 分支也不得触发 auto-merge", () => {
    const binDir = join(TMP_DIR, `bin-case2-${Date.now()}`);
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      join(binDir, "gh"),
      `#!/usr/bin/env bash
if [[ "$*" == *"headRefName"* ]]; then
  echo "cp-07121800-my-feature"
  exit 0
fi
echo "auto-merge enabled"
exit 0
`
    );
    chmodSync(join(binDir, "gh"), 0o755);

    const input = makeInput("gh pr create --repo owner/repo --title 'test'");
    const { exitCode, stderr } = runHook(input, binDir);
    expect(exitCode).toBe(0);
    expect(stderr).toMatch(/Kernel|merge gate/);
    expect(stderr).not.toMatch(/触发 auto-merge/);
  });

  it("用例3: gh 失败也保持 Kernel-only", () => {
    const binDir = makeFakeBinDir(1, "", "rewrite/payments-v2");
    const input = makeInput("gh pr create --repo owner/repo --title 'test'");
    const { exitCode, stderr } = runHook(input, binDir);
    expect(exitCode).toBe(0);
    expect(stderr).toMatch(/Kernel|merge gate/);
    expect(stderr).not.toMatch(/触发 auto-merge/);
  });

  it("用例4: git 可解析 cp-* 也不能授予 merge authority", () => {
    const binDir = join(TMP_DIR, `bin-case4-${Date.now()}`);
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      join(binDir, "gh"),
      `#!/usr/bin/env bash
if [[ "$*" == *"headRefName"* ]]; then
  exit 1
fi
echo "auto-merge enabled"
exit 0
`
    );
    chmodSync(join(binDir, "gh"), 0o755);
    // git: branch --show-current 返回 cp-*
    writeFileSync(
      join(binDir, "git"),
      `#!/usr/bin/env bash
if [[ "$*" == *"branch --show-current"* ]]; then
  echo "cp-07121800-my-feature"
  exit 0
fi
$(which git 2>/dev/null || echo git) "$@"
exit $?
`
    );
    chmodSync(join(binDir, "git"), 0o755);

    const input = makeInput("gh pr create --repo owner/repo --title 'test'");
    const { exitCode, stderr } = runHook(input, binDir);
    expect(exitCode).toBe(0);
    expect(stderr).toMatch(/Kernel|merge gate/);
    expect(stderr).not.toMatch(/触发 auto-merge/);
  });

  it("用例5: gh/git 都失败仍保持 fail-closed", () => {
    const binDir = makeFakeBinDir(1, "", null);
    const input = makeInput("gh pr create --repo owner/repo --title 'test'");
    const { exitCode, stderr } = runHook(input, binDir);
    expect(exitCode).toBe(0);
    expect(stderr).toMatch(/Kernel|merge gate|fail-closed/);
    expect(stderr).not.toMatch(/触发 auto-merge/);
  });
});
