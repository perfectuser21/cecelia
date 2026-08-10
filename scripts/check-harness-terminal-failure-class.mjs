#!/usr/bin/env node
/**
 * check-harness-terminal-failure-class.mjs — harness terminal 失败可观测机械闸。
 *
 * 法源: 决策 e8f6134f-4131-4145-a893-79eb098011d9（交付物2）
 * 合同: sprints/08101830-harness-failure-observability/contract-draft.md
 *
 * 扫描白名单文件里对 `tasks` 表的 terminal 写入（UPDATE tasks SET ... status =
 * 'failed'|'blocked'|'cancelled'）。命中而【同一 SQL 语句不写 result 的 failure_class】
 * 且无显式豁免注解 → 打印 offending file:line 并 exit 1（拦截「写 terminal 但不带
 * failure_class」的裸写回归）。真树扫描必须 exit 0。
 *
 * 豁免注解：对确属本 sprint 范围外的通用 terminal 写入（非 harness_initiative/
 * golden_path_proposal），在 SQL 块内或紧邻前置源码加注解 `failure-class-lint-ignore:
 * <原因>`。这是机械可读的显式豁免（同 eslint-disable），不是纯文档约定——新增裸写若
 * 不主动加注解一律被拦。
 *
 * 用法：
 *   node scripts/check-harness-terminal-failure-class.mjs            # 扫默认白名单（真树）
 *   node scripts/check-harness-terminal-failure-class.mjs <f1> <f2>  # 扫指定文件（自测注入 fixture）
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 全量 terminal 写入点所在文件（合同「全量 terminal 写入点清单」枚举）。
const DEFAULT_WHITELIST = [
  'packages/brain/src/executor.js',
  'packages/brain/src/dispatcher.js',
  'packages/brain/src/orchestrator/loop.js',
  'packages/brain/src/harness-relay-watchdog.js',
  'packages/brain/src/orchestrator/kernel-run-store.js',
];

const IGNORE_MARKER = 'failure-class-lint-ignore';
// 只匹配「literal terminal 写入」——status = 'failed'|'blocked'|'cancelled'（含无空格写法）。
const TERMINAL_RE = /status\s*=\s*'(failed|blocked|cancelled)'/;

function lineOf(src, idx) {
  return src.slice(0, idx).split('\n').length;
}

function scanFile(absPath, relPath) {
  let src;
  try {
    src = readFileSync(absPath, 'utf8');
  } catch {
    // 白名单文件不存在（被移动/重命名）→ 跳过，不算违规（真树里应始终存在）。
    return [];
  }
  const violations = [];
  // 匹配以 `UPDATE tasks` 开头的模板字面量 SQL 块（SQL 内无反引号，非贪婪停在下一个反引号）。
  const re = /`\s*(UPDATE tasks[\s\S]*?)`/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const sql = m[1];
    if (!TERMINAL_RE.test(sql)) continue;        // 非 terminal 写入
    const blockStart = m.index;
    // 前置源码窗口：既用于识别 SSOT helper 构造的 result 补丁（failure_class 走 SQL 参数、
    // 不在 SQL 文本里），也用于识别显式豁免注解。
    const preWindow = src.slice(Math.max(0, blockStart - 500), blockStart);
    const context = preWindow + sql;
    // 合规判定（合同：非经 SSOT helper buildTerminalFailureResult/markInitiativeTerminalFailed 的裸写 = 违约）：
    //   ① 同语句内联写 failure_class（jsonb_build_object / jsonb_set '{failure_class}'），或
    //   ② 同语句写 result 且紧邻代码经 SSOT helper 构造补丁（buildTerminalFailureResult），或
    //   ③ 通过 markInitiativeTerminalFailed helper 写入
    const inlineClass = /failure_class/.test(sql);
    const writesResult = /result\s*=/.test(sql);
    const helperNearby = context.includes('buildTerminalFailureResult')
      || context.includes('markInitiativeTerminalFailed');
    if (inlineClass) continue;
    if (writesResult && helperNearby) continue;
    // 豁免：SQL 块内或紧邻前置源码含 ignore marker（机械可读显式豁免）。
    if (context.includes(IGNORE_MARKER)) continue;
    violations.push({ file: relPath, line: lineOf(src, blockStart) });
  }
  return violations;
}

const argv = process.argv.slice(2);
const files = argv.length > 0
  ? argv.map((t) => ({ abs: resolve(process.cwd(), t), rel: t }))
  : DEFAULT_WHITELIST.map((f) => ({ abs: resolve(REPO_ROOT, f), rel: f }));

let violations = [];
for (const { abs, rel } of files) {
  violations = violations.concat(scanFile(abs, rel));
}

if (violations.length > 0) {
  console.error('❌ harness terminal 写入点缺 result.failure_class（裸写 terminal 状态）：');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} — UPDATE tasks 置 terminal 状态但同语句未写 result.failure_class`);
  }
  console.error(
    `\n修复：经 SSOT helper buildTerminalFailureResult 写 result.failure_class + failure_detail，` +
    `\n或对确属范围外的通用写入加注解「${IGNORE_MARKER}: <原因>」（机械可读显式豁免）。`,
  );
  process.exit(1);
}

console.log(`✅ harness terminal 写入点机械闸通过（扫描 ${files.length} 文件，无裸写 terminal 状态）`);
process.exit(0);
