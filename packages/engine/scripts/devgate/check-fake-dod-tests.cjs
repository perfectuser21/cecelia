#!/usr/bin/env node
/**
 * check-fake-dod-tests.cjs
 *
 * 检测 Task Card 中的假 DoD Test 命令（无真实断言的伪测试）。
 * 被 verify-step.sh 和 CI L1 fake-dod-test-check job 共同调用。
 *
 * 使用方式：
 *   node packages/engine/scripts/devgate/check-fake-dod-tests.cjs <task-card-path>
 *
 * 退出码：
 *   0 — 没有假测试，通过
 *   1 — 发现假测试，blocked
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ============================================================================
// 假测试模式定义
// ============================================================================

/**
 * 假测试命令模式（正则，匹配 Test: 行中的命令部分）
 *
 * 原则：这些命令只"输出"或"检查存在"，没有真实断言失败路径。
 *
 * 允许的真实测试：
 *   manual:node -e "...if(!c.includes('X'))process.exit(1)"
 *   manual:bash -c "..."（需包含 exit 1 或 assert）
 *   tests/path/to/test.ts
 *   contract:behavior-id
 */
const FAKE_PATTERNS = [
  // echo 系：直接输出字符串，无断言
  { pattern: /Test:\s*(manual:)?\s*echo\s/, desc: 'echo（无断言，只输出）' },
  { pattern: /Test:\s*(manual:)?\s*printf\s/, desc: 'printf（无断言，只输出）' },

  // ls/cat：列文件或读文件内容，不验证
  { pattern: /Test:\s*(manual:)?\s*ls(\s|$)/, desc: 'ls（只列目录，不验证内容）' },
  { pattern: /Test:\s*(manual:)?\s*cat\s/, desc: 'cat（只读文件，无断言）' },

  // 布尔假值：永远成功
  { pattern: /Test:\s*(manual:)?\s*true\s*$/, desc: 'true（永远成功，无意义）' },
  { pattern: /Test:\s*(manual:)?\s*exit\s+0\s*$/, desc: 'exit 0（永远成功，无意义）' },
  { pattern: /Test:\s*(manual:)?\s*test\s+-f\s/, desc: 'test -f（只检查文件存在，不验证内容）' },

  // grep | wc 系：计数而不断言
  { pattern: /Test:.*grep[^|]*\|[^|]*wc/, desc: 'grep | wc（计数不断言，应用 grep -c 或 process.exit）' },
  { pattern: /Test:.*\|\s*wc\s+-l/, desc: '| wc -l（计数不断言，需要明确比较）' },

  // 单纯 wc：无断言
  { pattern: /Test:\s*(manual:)?\s*wc\s/, desc: 'wc（计数无断言）' },
];

// ============================================================================
// 主逻辑
// ============================================================================

function checkFakeDodTests(taskCardPath) {
  if (!taskCardPath) {
    console.error('用法: node check-fake-dod-tests.cjs <task-card-path>');
    process.exit(1);
  }

  const absPath = path.resolve(process.cwd(), taskCardPath);

  if (!fs.existsSync(absPath)) {
    console.error(`❌ Task Card 文件不存在: ${absPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(absPath, 'utf8');
  const lines = content.split('\n');

  const violations = [];

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    for (const { pattern, desc } of FAKE_PATTERNS) {
      if (pattern.test(line)) {
        violations.push({ lineNum, line: line.trim(), desc });
        break; // 一行只报一次
      }
    }
  });

  if (violations.length === 0) {
    console.log(`✅ 假 DoD Test 检测通过 — 未发现假测试模式（${taskCardPath}）`);
    process.exit(0);
  }

  console.error(`❌ 发现 ${violations.length} 条假 DoD Test（无真实断言）：`);
  console.error('');
  violations.forEach(({ lineNum, line, desc }) => {
    console.error(`  第 ${lineNum} 行: ${desc}`);
    console.error(`    ${line}`);
  });
  console.error('');
  console.error('禁止的假测试模式：');
  console.error('  echo / printf / ls / cat — 只输出，无断言');
  console.error('  true / exit 0 — 永远成功');
  console.error('  grep | wc / wc -l — 计数但不断言结果');
  console.error('');
  console.error('正确示例：');
  console.error('  Test: manual:node -e "const c=require(\'fs\').readFileSync(\'file\',\'utf8\');if(!c.includes(\'X\'))process.exit(1)"');
  console.error('  Test: tests/my.test.ts');
  console.error('  Test: contract:my-behavior');
  process.exit(1);
}

// 从命令行参数读取 task card 路径
const taskCardArg = process.argv[2];
checkFakeDodTests(taskCardArg);
