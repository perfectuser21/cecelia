#!/usr/bin/env node
/**
 * scan-mock-health.mjs
 * 扫描 Brain 测试文件中的 Mock 健康问题
 *
 * 检测两类风险：
 * 1. mockImplementation + includes 条件顺序陷阱（更具体的条件应在前）
 * 2. vi.clearAllMocks() 在 beforeEach 中（只清 call history，不清 implementation）
 *
 * 用法：
 *   node packages/brain/scripts/scan-mock-health.mjs          # 人类可读摘要
 *   node packages/brain/scripts/scan-mock-health.mjs --json   # JSON 格式
 *   node packages/brain/scripts/scan-mock-health.mjs --verbose # 详细输出
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const TESTS_DIR = path.join(ROOT, 'packages/brain/src/__tests__');

const args = process.argv.slice(2);
const JSON_MODE = args.includes('--json');
const VERBOSE = args.includes('--verbose');

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────

function getAllTestFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllTestFiles(fullPath));
    } else if (entry.isFile() && /\.(test|spec)\.[jt]s$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

// ──────────────────────────────────────────────
// 检测1：mockImplementation + includes 条件顺序陷阱
// ──────────────────────────────────────────────

/**
 * 检测一个文件中所有 mockImplementation 块内的 .includes() 条件
 * 返回：[{ blockStart, conditions: [{ line, text, specificity }] }]
 */
function scanMockImplBlocks(content, filePath) {
  const lines = content.split('\n');
  const issues = [];

  // 找到所有 mockImplementation(... => { 的开始行
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('mockImplementation')) continue;

    // 收集该 block 内的 .includes() 条件（到下一个 mockImplementation 或文件末尾）
    const conditions = [];
    let depth = 0;
    let blockStarted = false;

    for (let j = i; j < lines.length && j < i + 200; j++) {
      const l = lines[j];

      // 统计花括号深度判断 block 范围
      for (const ch of l) {
        if (ch === '{') { depth++; blockStarted = true; }
        if (ch === '}') depth--;
      }

      // 检测 .includes() 调用
      const includesMatch = l.match(/\.includes\(\s*['"`]([^'"`]+)['"`]\s*\)/g);
      if (includesMatch) {
        for (const m of includesMatch) {
          const textMatch = m.match(/\.includes\(\s*['"`]([^'"`]+)['"`]\s*\)/);
          if (textMatch) {
            conditions.push({
              line: j + 1,
              text: textMatch[1],
              specificity: textMatch[1].length, // 越长越具体
            });
          }
        }
      }

      // block 结束（深度回到初始）
      if (blockStarted && depth <= 0) break;

      // 遇到下一个 mockImplementation（不同 block），停止
      if (j > i && l.includes('mockImplementation')) break;
    }

    if (conditions.length >= 2) {
      // 检测条件顺序是否合理：更短（更宽泛）的条件应该在后面，更长（更具体）的在前
      const orderIssues = [];
      for (let k = 0; k < conditions.length - 1; k++) {
        const curr = conditions[k];
        const next = conditions[k + 1];
        // 如果当前条件是 next 条件的子串（更宽泛），说明顺序可能有问题
        if (next.text.includes(curr.text) && curr.text !== next.text) {
          orderIssues.push({
            widerCondition: { line: curr.line, text: curr.text },
            narrowerCondition: { line: next.line, text: next.text },
            risk: 'wider_before_narrower',
          });
        }
      }

      issues.push({
        blockLine: i + 1,
        conditionCount: conditions.length,
        conditions: conditions.map(c => ({ line: c.line, text: c.text })),
        orderIssues,
        hasOrderRisk: orderIssues.length > 0,
      });
    }
  }

  return issues;
}

// ──────────────────────────────────────────────
// 检测2：vi.clearAllMocks() 在 beforeEach 中
// ──────────────────────────────────────────────

/**
 * 检测文件中 beforeEach 块内是否使用了 clearAllMocks（而非 resetAllMocks）
 */
function scanClearAllMocksInBeforeEach(content, filePath) {
  const lines = content.split('\n');
  const issues = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('beforeEach')) continue;

    // 收集 beforeEach block 内容
    let depth = 0;
    let blockStarted = false;
    const blockLines = [];

    for (let j = i; j < lines.length && j < i + 100; j++) {
      const l = lines[j];
      for (const ch of l) {
        if (ch === '{') { depth++; blockStarted = true; }
        if (ch === '}') depth--;
      }
      blockLines.push({ line: j + 1, text: l });
      if (blockStarted && depth <= 0) break;
    }

    // 在 block 内搜索 clearAllMocks
    for (const { line: lineNum, text } of blockLines) {
      if (text.includes('clearAllMocks()')) {
        issues.push({
          beforeEachLine: i + 1,
          clearAllMocksLine: lineNum,
          risk: 'clearAllMocks_leaks_implementation',
          suggestion: '替换为 vi.resetAllMocks() 可同时清除 implementation',
        });
        break; // 每个 beforeEach 只报一次
      }
    }
  }

  return issues;
}

// ──────────────────────────────────────────────
// 主扫描逻辑
// ──────────────────────────────────────────────

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relPath = path.relative(ROOT, filePath);

  const mockImplIssues = scanMockImplBlocks(content, filePath);
  const clearAllMocksIssues = scanClearAllMocksInBeforeEach(content, filePath);

  return {
    file: relPath,
    mockImplIssues,
    clearAllMocksIssues,
    hasMockImplRisk: mockImplIssues.some(b => b.conditionCount >= 2),
    hasOrderRisk: mockImplIssues.some(b => b.hasOrderRisk),
    hasClearAllMocksRisk: clearAllMocksIssues.length > 0,
  };
}

function main() {
  const allFiles = getAllTestFiles(TESTS_DIR);
  const totalFiles = allFiles.length;

  const results = allFiles.map(f => scanFile(f));

  // 统计
  const mockImplFiles = results.filter(r => r.hasMockImplRisk);
  const orderRiskFiles = results.filter(r => r.hasOrderRisk);
  const clearAllMocksFiles = results.filter(r => r.hasClearAllMocksRisk);

  const totalMockImplBlocks = results.reduce(
    (sum, r) => sum + r.mockImplIssues.filter(b => b.conditionCount >= 2).length,
    0
  );
  const totalClearAllMocksOccurrences = results.reduce(
    (sum, r) => sum + r.clearAllMocksIssues.length,
    0
  );

  if (JSON_MODE) {
    const output = {
      scannedAt: new Date().toISOString(),
      totalFiles,
      summary: {
        mockImplFiles: mockImplFiles.length,
        orderRiskFiles: orderRiskFiles.length,
        clearAllMocksFiles: clearAllMocksFiles.length,
        totalMockImplBlocks,
        totalClearAllMocksOccurrences,
      },
      mockImplRisks: mockImplFiles.map(r => ({
        file: r.file,
        blocks: r.mockImplIssues.filter(b => b.conditionCount >= 2).map(b => ({
          blockLine: b.blockLine,
          conditionCount: b.conditionCount,
          conditions: b.conditions,
          orderIssues: b.orderIssues,
          hasOrderRisk: b.hasOrderRisk,
        })),
      })),
      clearAllMocksRisks: clearAllMocksFiles.map(r => ({
        file: r.file,
        occurrences: r.clearAllMocksIssues,
      })),
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // 人类可读输出
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║       Brain 测试 Mock 健康扫描报告               ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
  console.log(`📂 扫描目录: packages/brain/src/__tests__/`);
  console.log(`📋 总文件数: ${totalFiles}`);
  console.log('');

  // ── 风险摘要 ──
  console.log('┌──────────────────────────────────────────────────┐');
  console.log('│ 风险摘要                                          │');
  console.log('└──────────────────────────────────────────────────┘');
  console.log(`  🔴 mockImplementation+includes 风险文件: ${mockImplFiles.length} 个（共 ${totalMockImplBlocks} 个 block）`);
  console.log(`  🟡 条件顺序陷阱（更宽泛条件在前）: ${orderRiskFiles.length} 个文件`);
  console.log(`  🟠 clearAllMocks-in-beforeEach 风险文件: ${clearAllMocksFiles.length} 个（共 ${totalClearAllMocksOccurrences} 处）`);
  console.log('');

  // ── mockImplementation 详情 ──
  console.log('┌──────────────────────────────────────────────────┐');
  console.log('│ 1. mockImplementation + includes 风险详情         │');
  console.log('└──────────────────────────────────────────────────┘');

  if (mockImplFiles.length === 0) {
    console.log('  ✅ 未发现风险');
  } else {
    for (const r of mockImplFiles) {
      const blocks = r.mockImplIssues.filter(b => b.conditionCount >= 2);
      const riskBadge = r.hasOrderRisk ? '🔴' : '🟡';
      console.log(`\n  ${riskBadge} ${r.file}`);
      for (const block of blocks) {
        console.log(`     └─ 第 ${block.blockLine} 行 mockImplementation（${block.conditionCount} 个条件）`);
        if (VERBOSE) {
          for (const c of block.conditions) {
            console.log(`        ├─ 第 ${c.line} 行: .includes("${c.text}")`);
          }
        }
        if (block.orderIssues.length > 0) {
          for (const issue of block.orderIssues) {
            console.log(`        ⚠️  顺序陷阱: 第 ${issue.widerCondition.line} 行宽泛条件 "${issue.widerCondition.text}" 在 第 ${issue.narrowerCondition.line} 行具体条件 "${issue.narrowerCondition.text}" 之前`);
          }
        }
      }
    }
  }

  // ── clearAllMocks 详情 ──
  console.log('');
  console.log('┌──────────────────────────────────────────────────┐');
  console.log('│ 2. vi.clearAllMocks() in beforeEach 风险详情      │');
  console.log('└──────────────────────────────────────────────────┘');

  if (clearAllMocksFiles.length === 0) {
    console.log('  ✅ 未发现风险');
  } else {
    for (const r of clearAllMocksFiles) {
      console.log(`\n  🟠 ${r.file}`);
      for (const issue of r.clearAllMocksIssues) {
        console.log(`     └─ beforeEach（第 ${issue.beforeEachLine} 行）内第 ${issue.clearAllMocksLine} 行使用 clearAllMocks()`);
        console.log(`        💡 ${issue.suggestion}`);
      }
    }
  }

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log(`✅ 扫描完成 | 风险文件总数: ${new Set([...mockImplFiles, ...clearAllMocksFiles].map(r => r.file)).size}`);
  console.log('══════════════════════════════════════════════════');
}

main();
