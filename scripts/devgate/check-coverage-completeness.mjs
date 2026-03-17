#!/usr/bin/env node
/**
 * check-coverage-completeness.mjs
 *
 * 动态覆盖完整性检查：源文件存在 → 对应测试文件必须存在。
 *
 * 规则（每类文件有对应测试目录）：
 *   packages/engine/hooks/*.sh       → packages/engine/tests/hooks/<name>.test.ts
 *   packages/engine/lib/*.sh         → packages/engine/tests/lib/<name>.test.ts
 *   packages/engine/scripts/devgate/*.{sh,cjs,mjs} → packages/engine/tests/devgate/<name>.test.{ts,js}
 *
 * 用法：
 *   node scripts/devgate/check-coverage-completeness.mjs
 *   node scripts/devgate/check-coverage-completeness.mjs --dry-run   # 只报告，不失败
 *   node scripts/devgate/check-coverage-completeness.mjs --changed-only  # 只检查 PR 改动的文件
 *
 * 退出码：
 *   0 - 通过（所有源文件都有测试，或只有已知豁免）
 *   1 - 失败（有源文件缺测试且非豁免）
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { join, basename, dirname } from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const ENGINE_ROOT = join(ROOT, "packages/engine");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

// ─── 参数解析 ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const CHANGED_ONLY = args.includes("--changed-only");

// ─── 豁免列表（已知无需测试的文件）──────────────────────────────────────────
// 格式：相对 packages/engine 的路径
// 必须有理由说明，否则不允许添加
const EXEMPTIONS = new Set([
  "hooks/stop.sh",                    // 纯路由器（64行），逻辑在 stop-dev.sh
  "hooks/stop.sh.before-refactor",    // 历史存档文件
  "hooks/VERSION",                    // 版本文件，非代码
  "hooks/credential-guard.sh",        // 简单凭据检查，无分支逻辑
  "hooks/stop-architect.sh",          // architect skill 专用
  "hooks/stop-decomp.sh",             // decomp skill 专用
]);

// ─── 规则定义（source → test 目录映射）──────────────────────────────────────
const RULES = [
  {
    name: "hooks",
    sourceDir: join(ENGINE_ROOT, "hooks"),
    sourceExts: [".sh"],
    testDir: join(ENGINE_ROOT, "tests/hooks"),
    testExts: [".test.ts", ".test.js", ".test.sh"],
    relativeSrcPrefix: "hooks/",
  },
  {
    name: "lib",
    sourceDir: join(ENGINE_ROOT, "lib"),
    sourceExts: [".sh"],
    testDir: join(ENGINE_ROOT, "tests/lib"),
    testExts: [".test.ts", ".test.js", ".test.sh"],
    relativeSrcPrefix: "lib/",
  },
  {
    name: "devgate",
    sourceDir: join(ENGINE_ROOT, "scripts/devgate"),
    sourceExts: [".sh", ".cjs", ".mjs"],
    testDir: join(ENGINE_ROOT, "tests/devgate"),
    testExts: [".test.ts", ".test.js", ".test.sh"],
    relativeSrcPrefix: "scripts/devgate/",
  },
];

// ─── 获取 PR 变更文件（--changed-only 模式）──────────────────────────────────
function getChangedFiles() {
  try {
    const baseRef = process.env.BASE_REF || "origin/main";
    const diff = execSync(`git diff --name-only ${baseRef}`, {
      encoding: "utf-8",
      cwd: ROOT,
    });
    return new Set(diff.trim().split("\n").filter(Boolean));
  } catch {
    return null; // 获取失败时检查所有文件
  }
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────────────
function run() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Coverage Completeness Check");
  console.log(`  模式: ${DRY_RUN ? "dry-run" : "strict"}${CHANGED_ONLY ? " + changed-only" : ""}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log();

  const changedFiles = CHANGED_ONLY ? getChangedFiles() : null;

  let totalChecked = 0;
  let missing = [];
  let exempted = 0;
  let passed = 0;

  for (const rule of RULES) {
    if (!existsSync(rule.sourceDir)) continue;

    const sourceFiles = readdirSync(rule.sourceDir).filter((f) =>
      rule.sourceExts.some((ext) => f.endsWith(ext))
    );

    for (const srcFile of sourceFiles) {
      const relPath = rule.relativeSrcPrefix + srcFile;
      const absPath = join(rule.sourceDir, srcFile);

      // changed-only 模式：只检查 PR 里改动的文件
      if (changedFiles) {
        const engineRelPath = "packages/engine/" + relPath;
        if (!changedFiles.has(engineRelPath)) continue;
      }

      totalChecked++;

      // 豁免检查
      if (EXEMPTIONS.has(relPath)) {
        console.log(`${YELLOW}EXEMPT    ${relPath}${RESET}`);
        exempted++;
        continue;
      }

      // 检查测试文件是否存在
      const baseName = basename(srcFile, srcFile.includes(".") ? "." + srcFile.split(".").pop() : "");
      // 去掉所有扩展名得到 stem
      const stem = srcFile.replace(/\.(sh|cjs|mjs|js|ts)$/, "");

      const testExists = rule.testExts.some((ext) =>
        existsSync(join(rule.testDir, stem + ext))
      );

      if (testExists) {
        console.log(`${GREEN}PASS      ${relPath}${RESET}`);
        passed++;
      } else {
        const expectedPath = `packages/engine/tests/${rule.name}/${stem}.test.ts`;
        console.log(`${RED}MISSING   ${relPath}${RESET}`);
        console.log(`          期望测试文件: ${expectedPath}`);
        missing.push({ src: relPath, expected: expectedPath });
      }
    }
  }

  console.log();
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  已检查: ${totalChecked} | 通过: ${passed} | 豁免: ${exempted} | 缺失: ${missing.length}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  if (missing.length > 0) {
    console.log();
    console.log(`${RED}  Coverage Completeness Check FAILED${RESET}`);
    console.log();
    console.log("  缺失测试文件列表：");
    for (const { src, expected } of missing) {
      console.log(`    ${src} → ${expected}`);
    }
    console.log();
    console.log("  修复方式：");
    console.log("    1. 为上述文件创建对应测试");
    console.log("    2. 或将文件加入 EXEMPTIONS（需注明理由）");
    console.log();

    if (!DRY_RUN) {
      process.exit(1);
    } else {
      console.log(`  ${YELLOW}（dry-run 模式：仅报告，不失败）${RESET}`);
    }
  } else {
    console.log();
    console.log(`${GREEN}  Coverage Completeness Check PASSED${RESET}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  }
}

run();
