/**
 * bash-guard.sh 测试
 *
 * 三类防护：
 * 1. 凭据泄露：命令行包含真实 token 时拦截
 * 1b. 凭据文件暴露：cp/mv/重定向 ~/.credentials/ 内容时拦截
 * 2. HK 部署：rsync/scp 到 HK IP 时检查 git 状态
 *
 * 性能要求：未命中时 < 5ms
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import { existsSync, mkdtempSync, copyFileSync, readdirSync, mkdirSync, lstatSync, readFileSync, writeFileSync, rmSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";

const ENGINE_ROOT = resolve(__dirname, "../..");
const ORIG_HOOK_PATH = resolve(ENGINE_ROOT, "hooks/bash-guard.sh");

// vitest worker thread 中 stdin pipe 不工作，使用 HOOK_INPUT env var
let HOOK_PATH: string;
let tempDir: string;

/** 递归复制目录 */
function copyDir(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const dstPath = join(dst, entry);
    if (lstatSync(srcPath).isDirectory()) {
      copyDir(srcPath, dstPath);
    } else {
      copyFileSync(srcPath, dstPath);
    }
  }
}

function patchHookStdin(hookPath: string): void {
  let content = readFileSync(hookPath, "utf-8");
  // bash-guard.sh uses: INPUT="$(cat)"
  content = content.replace(
    /^INPUT="\$\(cat\)"$/m,
    'INPUT="${HOOK_INPUT:-$(cat)}"'
  );
  writeFileSync(hookPath, content);
}

function runHook(command: string): { exitCode: number; stderr: string } {
  const input = JSON.stringify({
    tool_name: "Bash",
    tool_input: { command },
  });

  try {
    execSync(`bash "${HOOK_PATH}"`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, HOOK_INPUT: input },
    });
    return { exitCode: 0, stderr: "" };
  } catch (err: any) {
    return { exitCode: err.status, stderr: err.stderr || "" };
  }
}

/**
 * 在隔离目录（无 git 仓库）中运行 hook
 * 用于测试 gh pr create 场景，避免 git diff 受当前仓库 engine 变更影响
 */
function runHookIsolated(command: string): { exitCode: number; stderr: string } {
  const input = JSON.stringify({
    tool_name: "Bash",
    tool_input: { command },
  });

  try {
    execSync(`bash "${HOOK_PATH}"`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      cwd: tmpdir(), // 在 /tmp 中运行，无 git 仓库，git diff 返回空
      env: { ...process.env, HOOK_INPUT: input },
    });
    return { exitCode: 0, stderr: "" };
  } catch (err: any) {
    return { exitCode: err.status, stderr: err.stderr || "" };
  }
}

describe("bash-guard.sh", () => {
  beforeAll(() => {
    expect(existsSync(ORIG_HOOK_PATH)).toBe(true);
    // 在临时目录重建 hooks/ + lib/ 目录结构，以保证 hook 能找到 hook-utils.sh
    tempDir = mkdtempSync(join(tmpdir(), "bash-guard-test-"));
    const hooksDir = join(tempDir, "hooks");
    const libDir = join(tempDir, "lib");
    mkdirSync(hooksDir);
    copyDir(join(ENGINE_ROOT, "lib"), libDir);
    HOOK_PATH = join(hooksDir, "bash-guard.sh");
    copyFileSync(ORIG_HOOK_PATH, HOOK_PATH);
    patchHookStdin(HOOK_PATH);
  });

  afterAll(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should exist and be executable", () => {
    const stat = execSync(`stat -c %a "${ORIG_HOOK_PATH}"`, { encoding: "utf-8" });
    const mode = parseInt(stat.trim(), 8);
    expect(mode & 0o111).toBeGreaterThan(0);
  });

  it("should pass syntax check", () => {
    expect(() => {
      execSync(`bash -n "${ORIG_HOOK_PATH}"`, { encoding: "utf-8" });
    }).not.toThrow();
  });

  // ─── 日常命令放行 ─────────────────────────────────────────
  describe("should allow normal commands", () => {
    const normalCommands = [
      "git checkout -b cp-test-branch",
      "npm test",
      'echo "ok" >> .dev-mode',
      "git log --oneline > /tmp/x.txt",
      "npm run build 2>&1",
      "git status --short",
      "ls -la",
      "ssh hk uptime",
      'ssh hk "docker ps"',
      "cat package.json",
      "cp templates/prd.md .prd.md",
      "rsync file.txt localhost:/tmp/",
      "scp file.txt user@192.168.1.1:/tmp/",
    ];

    for (const cmd of normalCommands) {
      it(`allows: ${cmd}`, () => {
        const result = runHook(cmd);
        expect(result.exitCode).toBe(0);
      });
    }
  });

  // ─── 凭据拦截 ─────────────────────────────────────────────
  describe("should block commands with real tokens", () => {
    it("blocks Notion token", () => {
      const result = runHook(
        'echo "ntn_abcdefghijklmnopqrstuvwx" > config.ts',
      );
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("BASH GUARD");
    });

    it("blocks GitHub PAT", () => {
      const result = runHook(
        'curl -H "Authorization: github_pat_abcdefghijklmnopqrstuvwxyz1234567890"',
      );
      expect(result.exitCode).toBe(2);
    });

    it("blocks OpenAI key", () => {
      const result = runHook(
        'export OPENAI_KEY="sk-proj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
      );
      expect(result.exitCode).toBe(2);
    });

    it("blocks Anthropic key", () => {
      const result = runHook(
        'export ANTHROPIC_KEY="sk-ant-api03-abcdefghijklmnopqrst"',
      );
      expect(result.exitCode).toBe(2);
    });

    it("blocks AWS Access Key ID", () => {
      const result = runHook(
        'echo "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE" > .env',
      );
      expect(result.exitCode).toBe(2);
    });

    it("blocks Slack token", () => {
      const result = runHook(
        'curl -H "Authorization: Bearer xoxb-1234567890-abcdefghij"',
      );
      expect(result.exitCode).toBe(2);
    });

    it("blocks Stripe key", () => {
      // Use test mode key to avoid GitHub Push Protection (live keys are blocked)
      const result = runHook(
        'export STRIPE_KEY="sk_test_51abcdefghijklmnopqrstuvwxyz"',
      );
      expect(result.exitCode).toBe(2);
    });

    it("allows placeholder tokens", () => {
      const result = runHook('echo "ntn_YOUR_NOTION_KEY_HERE_placeholder"');
      expect(result.exitCode).toBe(0);
    });
  });

  // ─── 凭据文件暴露拦截 ──────────────────────────────────────
  describe("should block credential file exposure", () => {
    it("blocks cp from ~/.credentials/", () => {
      const result = runHook("cp ~/.credentials/ibkr.env ./");
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("凭据文件暴露");
    });

    it("blocks mv from ~/.credentials/", () => {
      const result = runHook("mv ~/.credentials/polygon.env /tmp/");
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("凭据文件暴露");
    });

    it("blocks cp -r from ~/.credentials/", () => {
      const result = runHook("cp -r ~/.credentials/ ./backup/");
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("凭据文件暴露");
    });

    it("blocks cat credentials with redirect", () => {
      const result = runHook("cat ~/.credentials/polygon.env > exposed.txt");
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("凭据内容重定向");
    });

    it("blocks cat credentials with append", () => {
      const result = runHook("cat ~/.credentials/ibkr.env >> leaked.txt");
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("凭据内容重定向");
    });

    it("blocks cat credentials piped to tee", () => {
      const result = runHook("cat ~/.credentials/foo.env | tee backup.txt");
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("凭据内容重定向");
    });

    it("blocks grep credentials with redirect", () => {
      const result = runHook(
        "grep KEY ~/.credentials/polygon.env > output.txt",
      );
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("凭据内容重定向");
    });

    it("allows source ~/.credentials/ (safe load)", () => {
      const result = runHook("source ~/.credentials/polygon.env");
      expect(result.exitCode).toBe(0);
    });

    it("allows cat ~/.credentials/ without redirect (view only)", () => {
      const result = runHook("cat ~/.credentials/polygon.env");
      expect(result.exitCode).toBe(0);
    });

    it("allows ls ~/.credentials/", () => {
      const result = runHook("ls ~/.credentials/");
      expect(result.exitCode).toBe(0);
    });

    it("allows test -f ~/.credentials/", () => {
      const result = runHook("test -f ~/.credentials/polygon.env");
      expect(result.exitCode).toBe(0);
    });

    it("allows cat credentials piped to grep (no file output)", () => {
      const result = runHook("cat ~/.credentials/polygon.env | grep KEY");
      expect(result.exitCode).toBe(0);
    });
  });

  // ─── HK 部署拦截 ──────────────────────────────────────────
  describe("should block HK deploy when git is dirty", () => {
    it("blocks rsync to HK public IP", () => {
      const result = runHook("rsync -avz dist/ user@124.156.138.116:/srv/app/");
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("BASH GUARD");
    });

    it("blocks scp to HK Tailscale IP", () => {
      const result = runHook("scp file.tar.gz user@100.86.118.99:/tmp/");
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("BASH GUARD");
    });

    it("does not block ssh to HK (read-only allowed)", () => {
      const result = runHook("ssh user@124.156.138.116 uptime");
      expect(result.exitCode).toBe(0);
    });

    it("does not block rsync to non-HK targets", () => {
      const result = runHook("rsync -avz dist/ user@192.168.1.100:/srv/app/");
      expect(result.exitCode).toBe(0);
    });
  });

  // ─── gh pr create title 格式验证 ─────────────────────────
  // 注意：使用 runHookIsolated（在 /tmp 中运行，无 git 仓库）
  // 避免当前仓库的 engine 变更触发 [CONFIG] 检查，干扰格式验证测试
  describe("gh pr create title validation", () => {
    it("allows valid Conventional Commits title (feat:)", () => {
      const result = runHookIsolated('gh pr create --title "feat: 添加新功能" --body "desc"');
      expect(result.exitCode).toBe(0);
    });

    it("allows valid Conventional Commits title with scope (fix(scope):)", () => {
      const result = runHookIsolated('gh pr create --title "fix(scope): 修复问题" --body "desc"');
      expect(result.exitCode).toBe(0);
    });

    it("allows valid title with [CONFIG] prefix", () => {
      const result = runHookIsolated('gh pr create --title "[CONFIG] feat(engine): 新增功能" --body "desc"');
      expect(result.exitCode).toBe(0);
    });

    it("allows breaking change title (feat!:)", () => {
      const result = runHookIsolated('gh pr create --title "feat!: 破坏性变更" --body "desc"');
      expect(result.exitCode).toBe(0);
    });

    it("blocks invalid title (no Conventional Commits prefix)", () => {
      const result = runHookIsolated('gh pr create --title "random text without prefix" --body "desc"');
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("BASH GUARD");
      expect(result.stderr).toContain("Conventional Commits");
    });

    it("blocks title starting with uppercase without prefix", () => {
      const result = runHookIsolated('gh pr create --title "Add new feature" --body "desc"');
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("BASH GUARD");
    });

    it("allows gh pr create without --title (graceful degradation)", () => {
      const result = runHookIsolated('gh pr create --body "desc" --fill');
      expect(result.exitCode).toBe(0);
    });

    it("allows gh commands other than pr create", () => {
      const result = runHookIsolated("gh pr list");
      expect(result.exitCode).toBe(0);
    });

    it("allows gh pr merge", () => {
      const result = runHookIsolated("gh pr merge --squash");
      expect(result.exitCode).toBe(0);
    });
  });

  // ─── 空/无效输入 ──────────────────────────────────────────
  describe("should handle edge cases", () => {
    it("allows empty command", () => {
      const input = JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "" },
      });
      try {
        execSync(`bash "${HOOK_PATH}"`, {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, HOOK_INPUT: input },
        });
      } catch {
        // empty command might exit 0 or non-zero, just shouldn't crash
      }
    });

    it("handles invalid JSON gracefully", () => {
      try {
        execSync(`bash "${HOOK_PATH}"`, {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, HOOK_INPUT: "not json" },
        });
        // Should exit 0 (graceful pass-through)
      } catch {
        // Also acceptable
      }
    });
  });
});
