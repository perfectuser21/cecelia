#!/usr/bin/env node
/**
 * harness-terminal-failure-class-gate.mjs — 机械闸（防回归）
 *
 * 扫描 curated harness terminal 写入点文件集：任一把 tasks 打成 terminal 状态
 * (status='failed'|'blocked'|'cancelled') 的 SQL 语句，若同语句既不含 failure_class
 * 又无 `lint-allow-terminal:` 标记 → 命中 → exit 1；否则 exit 0。
 *
 * 目的：harness terminal 失败必须写 result.failure_class（决策 e8f6134f 交付物2）。
 * 新增「写 terminal 状态但不带 failure_class」的 harness 路径会被本闸拦下，纯文档约定
 * 不算数。非 harness / 通用 terminal 写用 `// lint-allow-terminal: <理由>` 标记豁免。
 *
 * 用法：
 *   node harness-terminal-failure-class-gate.mjs                     # 扫真实树 curated 文件
 *   node harness-terminal-failure-class-gate.mjs --fixture-files=a,b # 扫指定 fixture（自测）
 *
 * 退出码：0 = 无绕过；1 = 命中裸写。
 */
import { readFileSync, existsSync } from 'node:fs';

// curated harness terminal 写入点文件集（判定点：作用域限定，避免误拦 credential/content 等
// 非 harness 写；未来新增 harness terminal 写入点若落在这些文件里即被扫到）。
const CURATED_FILES = [
  'packages/brain/src/executor.js',
  'packages/brain/src/dispatcher.js',
  'packages/brain/src/orchestrator/kernel-run-store.js',
  'packages/brain/src/harness-relay-watchdog.js',
  'packages/brain/src/harness-death-handlers.js',
  'packages/brain/src/golden-path-contracts.js',
  'packages/brain/src/triage-officer-15min.js',
];

const ALLOW_MARKER = 'lint-allow-terminal';
// 命中「terminal 状态字面量写入」——status 被设为 failed/blocked/cancelled 字符串字面量。
// 参数化写入（status=$2::varchar 等）不在本闸射程（无字面 terminal 值可静态断定）。
const TERMINAL_STATUS_RE = /status\s*=\s*'(failed|blocked|cancelled)'/i;

const fixtureArg = process.argv.find((a) => a.startsWith('--fixture-files='));
const targetFiles = fixtureArg
  ? fixtureArg.slice('--fixture-files='.length).split(',').map((s) => s.trim()).filter(Boolean)
  : CURATED_FILES;

const offenders = [];

for (const file of targetFiles) {
  if (!existsSync(file)) continue;
  const src = readFileSync(file, 'utf8');
  // SQL 多行/单行语句在本仓一律用反引号模板串（内含单引号 'failed'），逐块提取。
  const blocks = src.match(/`[^`]*`/g) || [];
  for (const block of blocks) {
    if (!/UPDATE\s+tasks/i.test(block)) continue;
    if (!TERMINAL_STATUS_RE.test(block)) continue;
    if (/failure_class/.test(block)) continue; // 同语句已写 failure_class → 合规
    // lint-allow 标记：block 内 SQL 注释，或包裹该 block 的 query 调用上文（~240 字符窗口）。
    const idx = src.indexOf(block);
    const ctx = src.slice(Math.max(0, idx - 240), idx + block.length);
    if (block.includes(ALLOW_MARKER) || ctx.includes(ALLOW_MARKER)) continue;
    offenders.push({ file, snippet: block.replace(/\s+/g, ' ').slice(0, 140) });
  }
}

if (offenders.length > 0) {
  console.error(
    '[harness-terminal-failure-class-gate] 命中绕过 helper 的 harness terminal 裸写（缺 failure_class 且无 lint-allow-terminal 标记）：',
  );
  for (const o of offenders) console.error(`  ✗ ${o.file}: ${o.snippet}`);
  console.error(
    '\n修法：harness terminal 写请经 markHarnessTerminal 写 result.failure_class，或对非 harness 写加 `// lint-allow-terminal: <理由>` 标记。',
  );
  process.exit(1);
}

console.log(
  `[harness-terminal-failure-class-gate] OK — 扫描 ${targetFiles.length} 文件，无绕过 helper 的 terminal 裸写`,
);
process.exit(0);
