/* global process, console */
/**
 * 代码质量扫描模块
 * 扫描 packages/brain/src/ 下的代码，识别改进机会
 *
 * 扫描类型：
 * 1. missing_tests - 未测试模块发现
 * 2. high_complexity - 高复杂度函数（基于圈复杂度估算）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Brain src 目录（当前文件所在目录）
const BRAIN_SRC_DIR = __dirname;
// 测试目录
const TESTS_DIR = path.join(BRAIN_SRC_DIR, '__tests__');
// 复杂度阈值
const COMPLEXITY_THRESHOLD = 10;

// 排除不需要独立测试的特殊文件
const EXCLUDED_FROM_TEST_SCAN = new Set([
  'server.js',
  'db.js',
  'db-config.js',
  'code-scanner.js',
]);

/**
 * 获取目录下所有顶层 .js 文件（不递归）
 * @param {string} dir - 扫描目录
 * @returns {string[]} 文件路径列表
 */
function getJsFilesShallow(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter(e => e.isFile() && e.name.endsWith('.js'))
    .map(e => path.join(dir, e.name));
}

/**
 * 获取测试目录中已覆盖的模块名（去掉 .test.js 后缀）
 * @returns {Set<string>} 已有测试的模块名集合
 */
function getTestedModules() {
  if (!fs.existsSync(TESTS_DIR)) return new Set();
  return new Set(
    fs.readdirSync(TESTS_DIR)
      .filter(f => f.endsWith('.test.js'))
      .map(f => f.replace('.test.js', ''))
  );
}

/**
 * 扫描缺失测试的模块
 * @returns {Array<{scanType: string, filePath: string, issueDescription: string, suggestedTaskTitle: string}>}
 */
export function scanForMissingTests() {
  const srcFiles = getJsFilesShallow(BRAIN_SRC_DIR);
  const testedModules = getTestedModules();
  const results = [];

  for (const filePath of srcFiles) {
    const baseName = path.basename(filePath);
    const moduleName = path.basename(filePath, '.js');

    if (EXCLUDED_FROM_TEST_SCAN.has(baseName)) continue;
    if (moduleName.endsWith('.test')) continue;

    if (!testedModules.has(moduleName)) {
      const relativePath = path.relative(
        path.join(BRAIN_SRC_DIR, '..'),
        filePath
      );
      results.push({
        scanType: 'missing_tests',
        filePath: relativePath,
        issueDescription: `模块 ${moduleName}.js 缺少对应的单元测试文件`,
        suggestedTaskTitle: `为 ${moduleName} 模块添加单元测试`,
      });
    }
  }

  return results;
}

/**
 * 使用控制流语句计数估算函数圈复杂度
 * @param {string} funcBody - 函数体字符串
 * @returns {number} 估算的复杂度（基础值 1 + 每个分支点 +1）
 */
export function estimateComplexity(funcBody) {
  const patterns = [
    /\bif\b/g,
    /\belse\s+if\b/g,
    /\bfor\b/g,
    /\bwhile\b/g,
    /\bdo\b/g,
    /\bcase\b/g,
    /\bcatch\b/g,
    /\?\s*[^:?]/g,
    /&&/g,
    /\|\|/g,
  ];

  let complexity = 1;
  for (const pattern of patterns) {
    const matches = funcBody.match(pattern);
    if (matches) complexity += matches.length;
  }
  return complexity;
}

/**
 * 从给定位置提取括号括起的代码块内容
 * @param {string} content - 文件内容
 * @param {number} startIndex - '{' 的位置
 * @returns {string|null} 块内容（不包含外层括号）
 */
export function extractBracedBlock(content, startIndex) {
  if (content[startIndex] !== '{') return null;

  let depth = 0;
  let i = startIndex;
  const maxLength = 8000;

  while (i < content.length && i - startIndex < maxLength) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) {
        return content.substring(startIndex + 1, i);
      }
    }
    i++;
  }

  return null;
}

/**
 * 从文件内容中提取高复杂度函数
 * @param {string} content - 文件内容
 * @returns {Array<{name: string, complexity: number}>}
 */
export function findHighComplexityFunctions(content) {
  const results = [];
  const seen = new Set();

  const patterns = [
    /(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{/g,
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>\s*\{/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const funcName = match[1];
      if (!funcName || seen.has(funcName)) continue;
      if (['if', 'for', 'while', 'switch', 'catch'].includes(funcName)) continue;

      const braceIndex = content.indexOf('{', match.index + match[0].length - 2);
      if (braceIndex === -1) continue;

      const funcBody = extractBracedBlock(content, braceIndex);
      if (!funcBody) continue;

      const complexity = estimateComplexity(funcBody);
      if (complexity > COMPLEXITY_THRESHOLD) {
        seen.add(funcName);
        results.push({ name: funcName, complexity });
      }
    }
  }

  return results;
}

/**
 * 扫描高复杂度函数
 * @returns {Array<{scanType: string, filePath: string, issueDescription: string, suggestedTaskTitle: string}>}
 */
export function scanForComplexity() {
  const srcFiles = getJsFilesShallow(BRAIN_SRC_DIR);
  const routesDir = path.join(BRAIN_SRC_DIR, 'routes');
  const routesFiles = getJsFilesShallow(routesDir);
  const allFiles = [...srcFiles, ...routesFiles];

  const results = [];

  for (const filePath of allFiles) {
    if (filePath.includes('__tests__')) continue;
    if (filePath.endsWith('code-scanner.js')) continue;

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      console.error(`[code-scanner] 读取文件失败: ${filePath}`, err.message);
      continue;
    }

    const complexFunctions = findHighComplexityFunctions(content);

    for (const { name, complexity } of complexFunctions) {
      const relativePath = path.relative(
        path.join(BRAIN_SRC_DIR, '..'),
        filePath
      );
      results.push({
        scanType: 'high_complexity',
        filePath: relativePath,
        issueDescription: `函数 ${name}() 的圈复杂度约为 ${complexity}（阈值 ${COMPLEXITY_THRESHOLD}）`,
        suggestedTaskTitle: `重构 ${path.basename(filePath, '.js')}.${name}() 以降低复杂度`,
      });
    }
  }

  return results;
}

/**
 * 执行完整扫描（所有类型）
 * @returns {Array<{scanType: string, filePath: string, issueDescription: string, suggestedTaskTitle: string}>}
 */
export function runFullScan() {
  const missingTests = scanForMissingTests();
  const complexFunctions = scanForComplexity();
  return [...missingTests, ...complexFunctions];
}

export default {
  scanForMissingTests,
  scanForComplexity,
  runFullScan,
};
