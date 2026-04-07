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
  // 检测真实的🔴严重问题标记
  // 排除误报场景：
  //   "严重问题（🔴）" — section heading，🔴 在括号内，不代表有实际问题
  //   "- **无**" — bullet 形式的无问题声明
  // 触发场景（表示有真实问题）：
  //   "🔴 **issue**" — 行内标记的实际问题
  //   "- 🔴" — bullet 列表里的问题标记

  // 检查正文是否声明了无严重问题
  // 支持全角括号（🔴）和半角括号 (🔴)，及标题与括号间的空格
  // 也支持 DeepSeek 的 "🔴 **严重问题**\n- 未发现" 格式（emoji 在 bold 标题前）
  const noIssuesDeclared = /[（(]🔴[)）][\s\S]*?[-*]\s*\*\*无\*\*/.test(input)
    || /严重问题\s*[（(]🔴[)）][\s\S]{0,200}无严重问题/.test(input)
    || /严重问题\s*[（(]🔴[)）][\s\S]{0,100}\*\*无\*\*/.test(input)
    || /严重问题\s*[（(]🔴[)）][\s\S]{0,100}-\s*\*\*无\*\*/.test(input)
    || /🔴\s*\*\*严重问题\*\*[\s\S]{0,200}未发现/.test(input)
    || /🔴\s*严重问题[：:]\s*未发现/.test(input)
    || /🔴\s*严重问题[：:][\s\S]{0,100}-\s*未发现/.test(input)
    || /严重问题[：:]\s*未发现/.test(input)
    || /严重问题[：:][\s\S]{0,100}-\s*未发现/.test(input)
    // 支持 "没有发现严重问题（🔴）" 正文格式（DeepSeek 有时在结尾总结中使用此格式）
    || /没有发现严重问题[（(]🔴[)）]/.test(input)
    || /未发现严重问题[（(]🔴[)）]/.test(input);

  // 排除标题里的 🔴（兼容全角/半角括号及 bold 标题格式），检测正文中的实际问题标记
  const textWithoutHeadings = input
    .replace(/#+\s*[^🔴\n]*[（(]🔴[)）][^\n]*/g, '')       // ## 标题（🔴）格式
    .replace(/🔴\s*\*\*[^*\n]+\*\*[^\n]*/g, '');           // 🔴 **标题** 格式
  const hasActualRedFlag = /🔴/.test(textWithoutHeadings) && !noIssuesDeclared;

  if (hasActualRedFlag) {
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
