/**
 * supervisor-parse-behavior.test.mjs
 * 行为测试 — scripts/lib/supervisor-parse.mjs（codex/grok supervisor 三态解析）
 *
 * 【真实 CLI 输出 fixture，非手搓】
 * __fixtures__/codex-exec-real-complete.jsonl：2026-07-23 `codex exec --json` 实跑原文逐字。
 *   决策 JSON 嵌在 item.completed 事件的 item.text 字符串里；thread_id 在 thread.started 顶层。
 * __fixtures__/grok-p-real-complete.json：2026-07-23 `grok -p ... --output-format json`（grok 0.2.106）
 *   实跑原文逐字。单个多行 pretty JSON 对象（非 JSONL）；决策嵌在 .text；session 字段是驼峰 sessionId。
 *
 * 本文件取代静态 grep 断言的行为盲区：直接 import 解析纯函数、喂真实 stdout、断言语义结果。
 * 血统：task ab41227c —— 旧实现对真实输出永远 fallback 'continue'，grok session 永远 null
 * （--resume 从不生效，每轮开新会话，违背 INV-5）。
 *
 * 运行方式（仓库根）：node tests/regression/codex-grok-launcher-supervisor/supervisor-parse-behavior.test.mjs
 * CI 接线：regression-contract.yaml golden_paths[] id=HARN-SUPERVISOR-PARSE-01（core-regression PR tier）
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  parseCodexDecision,
  extractCodexSessionId,
  parseGrokDecision,
  extractGrokSessionId,
} from '../../../scripts/lib/supervisor-parse.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, '__fixtures__');

const codexReal = readFileSync(join(FIXTURES, 'codex-exec-real-complete.jsonl'), 'utf8');
const grokReal = readFileSync(join(FIXTURES, 'grok-p-real-complete.json'), 'utf8');

let PASS = 0;
let FAIL = 0;

function assertEq(name, actual, expected) {
  if (actual === expected) {
    console.log(`  PASS: ${name}`);
    PASS++;
  } else {
    console.error(`  FAIL: ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    FAIL++;
  }
}

console.log('\n[supervisor-parse-behavior.test] 真实 CLI 输出行为断言\n');

// ─── codex ────────────────────────────────────────────────────────────────────

// 1. 真实 complete 输出：决策嵌在 item.completed 的 item.text
assertEq('codex 真实输出 {"decision":"complete"} 嵌套 item.text → complete',
  parseCodexDecision(codexReal), 'complete');

// 2. 真实输出 session：thread.started 顶层 thread_id（现状可用路径，锁死防退化）
assertEq('codex 真实输出 thread_id 提取',
  extractCodexSessionId(codexReal), '019f8c99-884d-7461-9443-8630d361f34d');

// 3. 派生 blocked 变体（同真实事件结构，仅换 text 内容）
const codexBlocked = codexReal.replace(
  '{\\"decision\\":\\"complete\\"}',
  '{\\"decision\\":\\"blocked\\"}'
);
assertEq('codex 派生 blocked 变体 → blocked',
  parseCodexDecision(codexBlocked), 'blocked');

// 4. agent_message 无决策 JSON → 保守 fallback continue
const codexPlain = codexReal.replace(
  '{\\"decision\\":\\"complete\\"}',
  'I finished reviewing the code, all good.'
);
assertEq('codex agent_message 无决策 JSON → continue（保守 fallback）',
  parseCodexDecision(codexPlain), 'continue');

// ─── grok ─────────────────────────────────────────────────────────────────────

// 5. 真实 complete 输出：整块 pretty JSON，决策嵌在 .text
assertEq('grok 真实输出（多行 pretty JSON）{"decision":"complete"} 嵌套 .text → complete',
  parseGrokDecision(grokReal), 'complete');

// 6. 真实输出 session：驼峰 sessionId（INV-5 --resume 依赖它）
assertEq('grok 真实输出驼峰 sessionId 提取',
  extractGrokSessionId(grokReal), '019f8c99-b66d-72e2-b4b7-e41cbf65bace');

// 7. 派生 blocked 变体
const grokBlocked = grokReal.replace(
  '{\\"decision\\":\\"complete\\"}',
  '{\\"decision\\":\\"blocked\\"}'
);
assertEq('grok 派生 blocked 变体 → blocked',
  parseGrokDecision(grokBlocked), 'blocked');

// 8. 非 JSON stdout：不抛异常，保守 fallback
assertEq('grok 非 JSON stdout → continue（不抛异常）',
  parseGrokDecision('grok: something went wrong\nplain text output'), 'continue');
assertEq('grok 非 JSON stdout session → null（不抛异常）',
  extractGrokSessionId('grok: something went wrong\nplain text output'), null);

// ─── 结果 ─────────────────────────────────────────────────────────────────────

console.log(`\n结果: ${PASS} PASS, ${FAIL} FAIL\n`);
process.exit(FAIL > 0 ? 1 : 0);
