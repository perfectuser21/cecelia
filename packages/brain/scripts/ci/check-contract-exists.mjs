#!/usr/bin/env node
/**
 * check-contract-exists.mjs
 *
 * 检查 harness PR 的文件变更清单中是否包含 contract-draft.md。
 * 堵死已知漏洞：PR 可不带 contract-draft.md 合并（PR #3367 实证）。
 *
 * 用法：git diff --name-only origin/main...HEAD | node check-contract-exists.mjs
 *   stdin 每行一个文件路径
 *   含 contract-draft.md → 退出码 0
 *   缺 contract-draft.md → stderr 指明缺失 + 退出码 1
 *
 * 注意：本脚本只检查文件存在性，不检查内容（内容合法性由 harness-contract-lint job 负责）。
 */

import { createInterface } from 'readline';

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
const lines = [];

rl.on('line', line => {
  const trimmed = line.trim();
  if (trimmed) lines.push(trimmed);
});

rl.on('close', () => {
  const hasContract = lines.some(line => line.includes('contract-draft.md'));

  if (hasContract) {
    process.exit(0);
  } else {
    process.stderr.write(
      'Error: PR diff does not include contract-draft.md\n' +
      '  harness PR 必须包含 sprint 合同文件（sprints/*/contract-draft.md）\n' +
      '  否则 evaluator 无法读取合同执行 E2E 验收。\n'
    );
    process.exit(1);
  }
});
