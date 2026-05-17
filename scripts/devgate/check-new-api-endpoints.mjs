#!/usr/bin/env node
/**
 * check-new-api-endpoints.mjs
 *
 * 检查 PR 中新增的 Brain API 路由端点是否在 regression-contract.yaml 中有对应契约条目。
 *
 * 规则：
 *   - 仅检查 packages/brain/src/routes* 中新增的 router.get/post/patch/delete/put 调用
 *   - 若新增路由在 regression-contract.yaml 中无任何匹配 → 报错
 *   - 若无新路由 → 直接通过
 *
 * 用法：
 *   node scripts/devgate/check-new-api-endpoints.mjs
 *   BASE_REF=origin/develop node scripts/devgate/check-new-api-endpoints.mjs
 *
 * 返回码：
 *   0 - 通过（无新路由，或所有新路由均有契约）
 *   1 - 失败（新路由缺少 RCI 契约条目）
 */

import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

function getProjectRoot() {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
  } catch {
    return process.cwd();
  }
}

function getBaseRef() {
  return process.env.BASE_REF || "origin/main";
}

/**
 * 从 git diff 中提取新增的路由端点
 * @param {string} projectRoot
 * @param {string} baseRef
 * @returns {Array<{method: string, path: string, file: string, line: string}>}
 */
function extractNewRoutes(projectRoot, baseRef) {
  let diff;
  try {
    diff = execSync(
      `git diff ${baseRef} -- "packages/brain/src/routes.js" "packages/brain/src/routes/*.js"`,
      { encoding: "utf-8", cwd: projectRoot }
    );
  } catch {
    return [];
  }

  const newRoutes = [];
  const lines = diff.split("\n");

  // 跟踪当前文件名
  let currentFile = "";
  const routePattern = /^\+(?!\+\+)\s*router\.(get|post|patch|delete|put)\s*\(\s*['"`]([^'"`]+)['"`]/;
  const filePattern = /^\+\+\+ b\/(.+)$/;

  for (const line of lines) {
    const fileMatch = line.match(filePattern);
    if (fileMatch) {
      currentFile = fileMatch[1];
      continue;
    }

    const routeMatch = line.match(routePattern);
    if (routeMatch) {
      newRoutes.push({
        method: routeMatch[1].toUpperCase(),
        path: routeMatch[2],
        file: currentFile,
        line: line.trim(),
      });
    }
  }

  return newRoutes;
}

/**
 * 从 regression-contract.yaml 提取所有条目的 path 信息
 * @param {string} contractPath
 * @returns {Set<string>}
 */
function extractContractPaths(contractPath) {
  const paths = new Set();

  if (!existsSync(contractPath)) {
    return paths;
  }

  const content = readFileSync(contractPath, "utf-8");

  // 提取所有 path: 字段（不依赖 js-yaml，简单 regex 扫描）
  const pathPattern = /^\s*path:\s*['"]?([^'"\n]+)['"]?\s*$/gm;
  let match;
  while ((match = pathPattern.exec(content)) !== null) {
    paths.add(match[1].trim());
  }

  // 也提取 endpoint: 字段
  const endpointPattern = /^\s*endpoint:\s*['"]?([^'"\n]+)['"]?\s*$/gm;
  while ((match = endpointPattern.exec(content)) !== null) {
    paths.add(match[1].trim());
  }

  return paths;
}

/**
 * 检查路由是否在契约路径集合中有匹配（支持前缀匹配）
 * @param {string} routePath - e.g., "/api/brain/tasks"
 * @param {Set<string>} contractPaths
 * @returns {boolean}
 */
function hasContractCoverage(routePath, contractPaths) {
  for (const contractPath of contractPaths) {
    // 完全匹配
    if (contractPath === routePath) return true;
    // 前缀匹配（契约中有 /api/brain/tasks 时，/api/brain/tasks/:id 也视为覆盖）
    if (routePath.startsWith(contractPath.replace(/\/$/, ""))) return true;
    // 反向：路由是契约的前缀
    if (contractPath.startsWith(routePath.replace(/\/$/, ""))) return true;
  }
  return false;
}

function main() {
  const projectRoot = getProjectRoot();
  const baseRef = getBaseRef();
  const contractPath = join(projectRoot, "regression-contract.yaml");

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  新 Brain API Endpoint → RCI 契约检查");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Base: ${baseRef}`);
  console.log("");

  const newRoutes = extractNewRoutes(projectRoot, baseRef);

  if (newRoutes.length === 0) {
    console.log(`  ${GREEN}✅ 无新增 Brain API 路由，跳过检查${RESET}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    process.exit(0);
  }

  console.log(`  检测到 ${newRoutes.length} 个新增路由端点：`);
  for (const r of newRoutes) {
    console.log(`    ${r.method} ${r.path}  (${r.file})`);
  }
  console.log("");

  const contractPaths = extractContractPaths(contractPath);
  console.log(`  regression-contract.yaml 中有 ${contractPaths.size} 个路径条目`);
  console.log("");

  const missing = [];
  for (const route of newRoutes) {
    if (!hasContractCoverage(route.path, contractPaths)) {
      missing.push(route);
    }
  }

  if (missing.length === 0) {
    console.log(`  ${GREEN}✅ 所有新路由均有 RCI 契约覆盖${RESET}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    process.exit(0);
  }

  console.log(`  ${RED}❌ 以下新增路由缺少 RCI 回归契约条目：${RESET}`);
  console.log("");
  for (const route of missing) {
    console.log(`    ${RED}✗${RESET} ${route.method} ${route.path}`);
    console.log(`      来源: ${route.file}`);
  }
  console.log("");
  console.log("  请在 regression-contract.yaml 中为每个新路由添加契约条目：");
  console.log("");
  console.log("  ci:");
  for (const route of missing) {
    const idSlug = route.path.replace(/\//g, "-").replace(/[^a-z0-9-]/g, "").replace(/^-/, "");
    console.log(`    - id: brain-api-${idSlug}`);
    console.log(`      description: "${route.method} ${route.path} 基础功能回归"`);
    console.log(`      endpoint: "${route.path}"`);
    console.log(`      method: "${route.method}"`);
    console.log(`      trigger: [PR, Release]`);
  }
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  process.exit(1);
}

main();
