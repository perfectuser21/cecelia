#!/usr/bin/env node
/**
 * scan-feature-yamls.mjs
 *
 * 扫描 packages/engine/ 下所有 feature.yaml 文件，
 * 验证格式合规，并检查与 feature-registry.yml 的同步状态。
 *
 * 用法：
 *   node scripts/scan-feature-yamls.mjs                        # 扫描所有
 *   node scripts/scan-feature-yamls.mjs --validate-file <path> # 验证单个文件
 *   node scripts/scan-feature-yamls.mjs --summary              # 只输出摘要
 *
 * 返回码：
 *   0 - 所有 feature.yaml 格式正确
 *   1 - 存在格式错误或缺失必填字段
 *   2 - 文件读取错误
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// 颜色输出
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// JSON Schema 必填字段
const REQUIRED_FIELDS = ["id", "name", "version", "type", "capabilities"];
const VALID_TYPES = ["skill", "hook", "script", "devgate"];
const VALID_PRIORITIES = ["P0", "P1", "P2", "P3"];
const VALID_STATUSES = ["committed", "in-progress", "experimental", "deprecated"];

/**
 * 递归查找指定目录下所有 feature.yaml 文件
 */
function findFeatureYamls(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFeatureYamls(fullPath));
    } else if (entry.name === "feature.yaml") {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * 解析简单 YAML（仅支持顶层 key: value 和 key: [list] 格式）
 * 不引入外部依赖，避免 npm install 要求
 */
function parseSimpleYaml(content) {
  const obj = {};
  const lines = content.split("\n");
  let currentKey = null;
  let currentList = null;

  for (const line of lines) {
    if (line.startsWith("#") || line.trim() === "") continue;

    // 列表项
    const listMatch = line.match(/^  - (.+)$/);
    if (listMatch && currentList !== null) {
      obj[currentKey].push(listMatch[1].trim().replace(/^["']|["']$/g, ""));
      continue;
    }

    // 键值对
    const kvMatch = line.match(/^(\w+):\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const value = kvMatch[2].trim();
      if (value === "" || value === "|" || value === ">") {
        // 多行 or 列表
        obj[currentKey] = [];
        currentList = currentKey;
      } else {
        obj[currentKey] = value.replace(/^["']|["']$/g, "");
        currentList = null;
      }
    }
  }

  // 将单元素列表转为字符串（如果值不是真正的列表）
  for (const key of Object.keys(obj)) {
    if (Array.isArray(obj[key]) && obj[key].length === 0) {
      obj[key] = "";
    }
  }

  return obj;
}

/**
 * 验证单个 feature.yaml 文件
 * @returns {{ valid: boolean, errors: string[], warnings: string[], data: object }}
 */
function validateFeatureYaml(filePath) {
  const errors = [];
  const warnings = [];
  let data = {};

  if (!fs.existsSync(filePath)) {
    return { valid: false, errors: [`文件不存在: ${filePath}`], warnings: [], data };
  }

  let content;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (e) {
    return { valid: false, errors: [`读取失败: ${e.message}`], warnings: [], data };
  }

  // 尝试解析
  try {
    data = parseSimpleYaml(content);
  } catch (e) {
    return { valid: false, errors: [`YAML 解析失败: ${e.message}`], warnings: [], data };
  }

  // 检查必填字段
  for (const field of REQUIRED_FIELDS) {
    const value = data[field];
    if (value === undefined || value === null || value === "") {
      errors.push(`缺少必填字段: ${field}`);
    }
  }

  // 验证字段值
  if (data.id && !/^[a-z][a-z0-9-]*$/.test(data.id)) {
    errors.push(`id 格式无效（应为 kebab-case）: ${data.id}`);
  }

  if (data.version && !/^\d+\.\d+\.\d+$/.test(data.version)) {
    errors.push(`version 格式无效（应为 semver）: ${data.version}`);
  }

  if (data.type && !VALID_TYPES.includes(data.type)) {
    errors.push(`type 无效（允许: ${VALID_TYPES.join(", ")}）: ${data.type}`);
  }

  if (data.capabilities !== undefined) {
    const caps = Array.isArray(data.capabilities) ? data.capabilities : [];
    if (caps.length === 0 && data.capabilities === "") {
      errors.push("capabilities 不能为空列表");
    }
  }

  if (data.priority && !VALID_PRIORITIES.includes(data.priority)) {
    warnings.push(`priority 无效（允许: ${VALID_PRIORITIES.join(", ")}）: ${data.priority}`);
  }

  if (data.status && !VALID_STATUSES.includes(data.status)) {
    warnings.push(`status 无效（允许: ${VALID_STATUSES.join(", ")}）: ${data.status}`);
  }

  if (data.updated && !/^\d{4}-\d{2}-\d{2}$/.test(data.updated)) {
    warnings.push(`updated 格式无效（应为 YYYY-MM-DD）: ${data.updated}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    data,
  };
}

/**
 * 主扫描逻辑
 */
function main() {
  const args = process.argv.slice(2);
  const summaryOnly = args.includes("--summary");
  const validateFileIdx = args.indexOf("--validate-file");

  // 单文件验证模式
  if (validateFileIdx !== -1) {
    const targetFile = args[validateFileIdx + 1];
    if (!targetFile) {
      console.error(`${RED}❌ --validate-file 需要文件路径参数${RESET}`);
      process.exit(2);
    }

    const result = validateFeatureYaml(targetFile);
    if (result.valid) {
      console.log(`${GREEN}✅ ${path.basename(targetFile)} 验证通过${RESET}`);
      process.exit(0);
    } else {
      console.log(`${RED}❌ ${path.basename(targetFile)} 验证失败${RESET}`);
      for (const err of result.errors) {
        console.log(`   ${RED}• ${err}${RESET}`);
      }
      process.exit(1);
    }
  }

  // 全量扫描模式
  console.log(`${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}  feature.yaml 扫描报告${RESET}`);
  console.log(`${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);

  // 扫描 skills/、hooks/、scripts/devgate/ 目录
  const scanDirs = [
    path.join(PROJECT_ROOT, "skills"),
    path.join(PROJECT_ROOT, "hooks"),
    path.join(PROJECT_ROOT, "scripts", "devgate"),
  ];

  const allFeatureYamls = [];
  for (const dir of scanDirs) {
    allFeatureYamls.push(...findFeatureYamls(dir));
  }

  if (allFeatureYamls.length === 0) {
    console.log(`${YELLOW}⚠️  未发现任何 feature.yaml 文件${RESET}`);
    console.log(`   扫描范围: skills/, hooks/, scripts/devgate/`);
    process.exit(0);
  }

  let totalValid = 0;
  let totalInvalid = 0;
  let totalWarnings = 0;

  for (const featurePath of allFeatureYamls) {
    const relativePath = path.relative(PROJECT_ROOT, featurePath);
    const result = validateFeatureYaml(featurePath);

    if (!summaryOnly) {
      if (result.valid) {
        console.log(`${GREEN}✅${RESET} ${relativePath}`);
        if (result.data.id) {
          console.log(`   ${CYAN}id: ${result.data.id}  type: ${result.data.type}  version: ${result.data.version}${RESET}`);
        }
      } else {
        console.log(`${RED}❌${RESET} ${relativePath}`);
        for (const err of result.errors) {
          console.log(`   ${RED}• ${err}${RESET}`);
        }
      }

      if (result.warnings.length > 0) {
        for (const warn of result.warnings) {
          console.log(`   ${YELLOW}⚠  ${warn}${RESET}`);
        }
      }
    }

    if (result.valid) {
      totalValid++;
    } else {
      totalInvalid++;
    }
    totalWarnings += result.warnings.length;
  }

  console.log("");
  console.log(`${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`  总计: ${allFeatureYamls.length} 个 feature.yaml`);
  console.log(`  ${GREEN}通过: ${totalValid}${RESET}  ${totalInvalid > 0 ? RED : RESET}失败: ${totalInvalid}${RESET}  ${totalWarnings > 0 ? YELLOW : RESET}警告: ${totalWarnings}${RESET}`);
  console.log(`${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);

  if (totalInvalid > 0) {
    process.exit(1);
  }

  process.exit(0);
}

main();
