#!/usr/bin/env node
// ============================================================================
// detect-review-issues.js — AI 审查结果严重问题检测器
// ============================================================================
// 从 stdin 读取 AI 代码审查结果文本，检测是否包含🔴严重问题标记。
//
// 使用方式：
//   echo "审查结果" | node scripts/devgate/detect-review-issues.js
//
// 退出码：
//   0 — 未检测到严重问题，PR 可以合并
//   1 — 检测到🔴严重问题，阻塞合并
// ============================================================================

'use strict';

let input = '';

process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  input += chunk;
});

process.stdin.on('end', () => {
  // 检测🔴严重问题标记（兼容 Unicode 代理对和直接字面量）
  const hasRedFlag = input.includes('\uD83D\uDD34') || input.includes('🔴');

  if (hasRedFlag) {
    process.stderr.write('[detect-review-issues] 检测到🔴严重问题，阻塞 PR 合并\n');
    process.exit(1);
  } else {
    process.stderr.write('[detect-review-issues] 未检测到严重问题，审查通过\n');
    process.exit(0);
  }
});

process.stdin.on('error', (err) => {
  process.stderr.write(`[detect-review-issues] stdin 读取错误: ${err.message}\n`);
  process.exit(1);
});
