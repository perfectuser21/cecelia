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
//
// 检测策略：
//   DeepSeek 使用两种输出格式：
//   格式A：section 标题格式 — "#### 🔴 严重问题\n- <内容>" 或 "🔴 严重问题：\n- <内容>"
//   格式B：行内标记格式 — "- 🔴 **问题描述**"
//
//   对于格式A：
//     - 找到"严重问题"section，检查其内容是否为"未发现"（无问题）
//     - 如果内容是真实问题描述，触发 exit(1)
//   对于格式B：
//     - 直接检测 bullet list 里的 🔴 标记
// ============================================================================

'use strict';

let input = '';

process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  input += chunk;
});

process.stdin.on('end', () => {
  // 策略一：检测"严重问题"section（格式A）
  // 判断是否有 "🔴 严重问题" section，并检查该 section 是否声明"未发现"
  const hasRedSection = /🔴\s*严重问题|严重问题[^#\n]*🔴/.test(input);

  if (hasRedSection) {
    // 有"严重问题"section — 检查内容是否为"未发现"
    // 在 "严重问题" 出现后的 400 字符内，查找"未发现"
    const sectionSaysNoIssues = /严重问题[\s\S]{0,400}未发现/.test(input)
      || /严重问题[\s\S]{0,200}[-*]\s*\*\*无\*\*/.test(input)
      || /严重问题[\s\S]{0,200}[-*]\s*无\b/.test(input);

    if (sectionSaysNoIssues) {
      process.stderr.write('[detect-review-issues] 未检测到严重问题，审查通过\n');
      process.exit(0);
    } else {
      process.stderr.write('[detect-review-issues] 检测到🔴严重问题，阻塞 PR 合并\n');
      process.exit(1);
    }
  }

  // 策略二：无"严重问题"section — 检测行内 🔴 标记（格式B）
  // 任何出现 🔴 且未声明"无问题"即为真实问题
  const noIssuesDeclared = /没有发现严重问题|未发现严重问题/.test(input);
  const hasInlineRedFlag = /🔴/.test(input) && !noIssuesDeclared;

  if (hasInlineRedFlag) {
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
