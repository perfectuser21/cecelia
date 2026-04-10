#!/usr/bin/env node
/**
 * harness-contract-lint.mjs
 * CI 校验脚本：检查 DoD.md / contract-dod-ws*.md 文件中的 [BEHAVIOR] 条目
 *
 * 规则：
 * 1. 所有 DoD 条目必须已勾选 [x]（不允许 [ ]）
 * 2. 每个 [BEHAVIOR] 条目的 Test 字段不能为空
 * 3. 每个 [BEHAVIOR] 条目的 Test 字段只允许白名单工具：node/npm/curl/bash/psql
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const BANNED_TOOLS = ['grep', 'ls', 'cat', 'sed', 'echo', 'awk', 'find', 'tail', 'head', 'wc'];
const ALLOWED_TOOLS_STR = 'node/npm/curl/bash/psql';

const filePath = process.argv[2];
if (!filePath) {
  console.error('用法: node scripts/harness-contract-lint.mjs <dod-file>');
  process.exit(1);
}

const absolutePath = resolve(filePath);
let content;
try {
  content = readFileSync(absolutePath, 'utf8');
} catch (err) {
  console.error(`无法读取文件: ${absolutePath}`);
  console.error(err.message);
  process.exit(1);
}

const violations = [];

// 第一遍：收集所有条目及其 Test 字段
// 格式：
//   - [ ] [BEHAVIOR] 描述
//     Test: <command>
//   - [x] [ARTIFACT] 描述
//     Test: <command>
const lines = content.split('\n');
const entries = []; // { lineNum, checkState, type, testLineNum, testValue }

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const m = line.match(/^- (\[[ x]\]) \[(BEHAVIOR|ARTIFACT)\]/);
  if (!m) continue;

  const checkState = m[1]; // '[ ]' or '[x]'
  const entryType = m[2];  // 'BEHAVIOR' or 'ARTIFACT'
  let testLineNum = null;
  let testValue = null;

  // 向后查找 Test 字段（连续缩进行）
  for (let j = i + 1; j < lines.length; j++) {
    const nextLine = lines[j];
    // 遇到新的条目行，停止
    if (nextLine.match(/^- (\[[ x]\]) \[(BEHAVIOR|ARTIFACT)\]/)) break;
    // 遇到 Test: 行
    const testMatch = nextLine.match(/^\s+Test:\s*(.*)/);
    if (testMatch) {
      testLineNum = j + 1;
      testValue = testMatch[1].trim();
      break;
    }
  }

  entries.push({ lineNum: i + 1, checkState, entryType, testLineNum, testValue, raw: line.trim() });
}

// 第二遍：按规则检查
for (const entry of entries) {
  const { lineNum, checkState, entryType, testLineNum, testValue, raw } = entry;

  // 规则 1: 未勾选
  if (checkState === '[ ]') {
    violations.push({
      line: lineNum,
      type: 'UNCHECKED',
      message: 'DoD 条目未勾选（push 前必须改为 [x]）',
      entry: raw,
    });
  }

  // 规则 2 & 3: 只针对 [BEHAVIOR]
  if (entryType === 'BEHAVIOR') {
    if (testValue === null) {
      violations.push({
        line: lineNum,
        type: 'MISSING_TEST',
        message: '[BEHAVIOR] 条目缺少 Test 字段',
        entry: raw,
      });
    } else if (testValue === '') {
      violations.push({
        line: testLineNum || lineNum,
        type: 'EMPTY_TEST',
        message: '[BEHAVIOR] 条目的 Test 字段为空',
        entry: raw,
      });
    } else {
      // 规则 3: 白名单检查
      // 分割管道/分号命令段，检查每段首词
      const segments = testValue.split(/[|;]/).map(s => s.trim()).filter(Boolean);
      for (const segment of segments) {
        const firstWord = segment.split(/\s+/)[0].toLowerCase().replace(/^!/, '');
        if (BANNED_TOOLS.includes(firstWord)) {
          violations.push({
            line: testLineNum || lineNum,
            type: 'BANNED_TOOL',
            message: `Test 字段使用了非白名单工具 "${firstWord}"（只允许：${ALLOWED_TOOLS_STR}）`,
            entry: raw,
            command: testValue,
          });
          break;
        }
      }
    }
  }
}

// 输出结果
if (violations.length === 0) {
  console.log(`✅ harness-contract-lint: ${filePath} 合规，无违规条目`);
  process.exit(0);
} else {
  console.error(`❌ harness-contract-lint: 发现 ${violations.length} 个违规条目`);
  console.error('');
  for (const v of violations) {
    console.error(`  行 ${v.line} [${v.type}] ${v.message}`);
    if (v.entry) console.error(`    条目: ${v.entry}`);
    if (v.command) console.error(`    命令: ${v.command}`);
    console.error('');
  }
  process.exit(1);
}
