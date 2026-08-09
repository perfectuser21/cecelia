#!/usr/bin/env node
/**
 * lint-failure-class-writes.mjs —— 机械闸：拦截「把 harness 任务打成 terminal 状态
 * 却不写 failure_class」的代码路径（决策 e8f6134f 交付物2 · 范围③）。
 *
 * 纯文档约定不算数：本闸静态扫描 terminal 写入点文件，发现「UPDATE tasks SET status
 * = 'failed'/'blocked'/'cancelled'」的语句既不带 failure_class、又不经统一落库助手
 * persistTerminalFailure 收敛 → 报违规 exit 1。
 *
 * 判定粒度（与 tests/lint-failure-class-writes.test.ts 契约一致）：
 *   - 同一 UPDATE 语句的 SET 子句里内联了 failure_class → 合规
 *   - 或该文件整体引用了 persistTerminalFailure（收敛到单一落库助手）→ 合规
 *   - 两者都无的裸 terminal status 写入 → 违规
 *
 * 用法：
 *   node scripts/lint-failure-class-writes.mjs                 # 扫描默认写入点清单
 *   node scripts/lint-failure-class-writes.mjs --extra-scan f  # 追加扫描 f（自测/回归 fixture）
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const TERMINAL_STATUS_RE = /status\s*=\s*['"`](failed|blocked|cancelled)['"`]/i;

/**
 * 扫描单份源码内容，返回违规描述数组（空数组 = 合规）。
 * @param {string} content
 * @param {string} [filename]
 * @returns {string[]}
 */
export function scanTerminalWrites(content, filename = '<input>') {
  const violations = [];
  if (typeof content !== 'string' || content.length === 0) return violations;

  // 文件级收敛逃生舱：整份文件引用统一落库助手 persistTerminalFailure → 视为已收敛。
  const routesThroughHelper = /\bpersistTerminalFailure\b/.test(content);

  // 逐个 `UPDATE tasks SET ... [WHERE]` 语句：取 SET 与下一个 WHERE（或结尾）之间的子句。
  const updateRe = /UPDATE\s+tasks\s+SET\b([\s\S]*?)(\bWHERE\b|$)/gi;
  let m;
  while ((m = updateRe.exec(content)) !== null) {
    const setClause = m[1] || '';
    // 该 SET 子句是否把 status 置为 terminal 值（只看 SET 子句，避免误伤 WHERE status IN ...）。
    if (!TERMINAL_STATUS_RE.test(setClause)) continue;
    const hasInlineFailureClass = /failure_class/i.test(setClause);
    if (hasInlineFailureClass || routesThroughHelper) continue;
    const line = content.slice(0, m.index).split('\n').length;
    violations.push(
      `${filename}:${line} terminal write sets status without failure_class `
      + `(route it through persistTerminalFailure or inline failure_class)`,
    );
  }
  return violations;
}

// ── 默认扫描清单：全量 terminal 写入点文件（决策 e8f6134f 收敛清单）──
const DEFAULT_SCAN_FILES = [
  'packages/brain/src/executor.js',
  'packages/brain/src/dispatcher.js',
  'packages/brain/src/harness-relay-watchdog.js',
  'packages/brain/src/harness-death-handlers.js',
  'packages/brain/src/orchestrator/loop.js',
];

function repoRoot() {
  // scripts/ 位于仓库根下一层。
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

function main(argv) {
  const extras = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--extra-scan' && argv[i + 1]) {
      extras.push(argv[i + 1]);
      i += 1;
    }
  }

  const root = repoRoot();
  const files = [
    ...DEFAULT_SCAN_FILES.map((f) => resolve(root, f)),
    ...extras.map((f) => resolve(process.cwd(), f)),
  ];

  const allViolations = [];
  for (const file of files) {
    if (!existsSync(file)) {
      // 默认清单缺文件是仓库结构漂移，报错；extra fixture 缺失静默忽略。
      if (DEFAULT_SCAN_FILES.some((f) => resolve(root, f) === file)) {
        console.error(`[lint-failure-class] scan target missing: ${file}`);
        process.exitCode = 1;
      }
      continue;
    }
    const content = readFileSync(file, 'utf8');
    allViolations.push(...scanTerminalWrites(content, file));
  }

  if (allViolations.length > 0) {
    console.error('❌ terminal 写入缺 failure_class（机械闸拦截）：');
    for (const v of allViolations) console.error(`  ${v}`);
    process.exit(1);
  }
  console.log(`✅ lint-failure-class: ${files.length} 个写入点文件均已收敛（无裸 terminal 写入）`);
  process.exit(0);
}

// 仅在被直接执行（非 import）时跑 CLI。
const invokedDirectly = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2));
}
