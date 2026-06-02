#!/usr/bin/env bash
# Smoke: GAN proposer 连续没 push 中止逻辑存在
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"
node --input-type=module -e "
import { readFileSync } from 'fs';
const src = readFileSync('./packages/brain/src/workflows/harness-gan.graph.js','utf8');
if (!src.includes('MAX_NO_PUSH_STREAK')) { console.error('FAIL: 无 MAX_NO_PUSH_STREAK'); process.exit(1); }
if (!src.includes('proposerNoPushStreak')) { console.error('FAIL: 无 streak 计数'); process.exit(1); }
if (!src.includes('proposerRouter')) { console.error('FAIL: 无 proposer 中止路由'); process.exit(1); }
// 确认不再无条件吞 verifyProposer 错误（必须有 pushOk 判断）
if (!src.includes('pushOk')) { console.error('FAIL: 仍吞 verifyProposer 错误'); process.exit(1); }
console.log('OK: gan-no-push-abort smoke passed');
"
