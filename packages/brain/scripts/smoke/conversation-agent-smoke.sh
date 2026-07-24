#!/usr/bin/env bash
# conversation-agent-smoke.sh
# Task 1a03fbdf — PR2 claude spawn/resume 调用层 冒烟测试
#
# 不依赖真实 claude CLI / Brain 进程 / DB（CI 环境无这些前提）：
# 只验证模块可正常加载 + 导出的纯函数（parseAgentOutput/parseTurnMarker）
# 在已知输入下产出正确结果。invokeAgent 的真实 spawn 行为由单测 mock 覆盖。

set -e
cd "$(dirname "$0")/../../../.."

node --input-type=module -e "
import { parseAgentOutput, parseTurnMarker, invokeAgent } from './packages/brain/src/lib/conversation-agent.js';

if (typeof invokeAgent !== 'function') {
  console.error('[FAIL] invokeAgent 未导出为函数');
  process.exit(1);
}
console.log('[PASS] invokeAgent 已正确导出');

const out = parseAgentOutput(JSON.stringify({ type: 'result', result: '回复文本 [TURN: chat]', session_id: 'sid-1' }) + '\n');
if (out.reply !== '回复文本 [TURN: chat]' || out.sessionId !== 'sid-1') {
  console.error('[FAIL] parseAgentOutput 解析结果不符:', JSON.stringify(out));
  process.exit(1);
}
console.log('[PASS] parseAgentOutput 正确提取 reply + sessionId');

const marker = parseTurnMarker('已存 [TURN: decision_saved=abc-123]');
if (marker !== 'decision_saved=abc-123') {
  console.error('[FAIL] parseTurnMarker 解析不符:', marker);
  process.exit(1);
}
console.log('[PASS] parseTurnMarker 正确解析协议标记');

const noMarker = parseTurnMarker('没有标记的普通文本');
if (noMarker !== null) {
  console.error('[FAIL] 无标记时应返回 null，得到:', noMarker);
  process.exit(1);
}
console.log('[PASS] 无协议标记时返回 null');
"

echo "[OK] conversation-agent-smoke 全部通过（4/4 纯函数校验，无需真实 claude CLI/DB）"
