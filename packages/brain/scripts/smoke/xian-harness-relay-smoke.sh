#!/usr/bin/env bash
# xian-harness-relay-smoke — 验证 harness-skill-relay.js 含 xian 分支关键字面量
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

node --input-type=module -e "
import { readFileSync } from 'fs';
const relay = readFileSync('./packages/brain/src/harness-skill-relay.js', 'utf8');
const router = readFileSync('./packages/brain/src/task-router.js', 'utf8');
const dispatcher = readFileSync('./packages/brain/src/dispatcher.js', 'utf8');
const checks = [
  { name: '_spawnXianBridgeSession 函数定义', src: relay, regex: /_spawnXianBridgeSession/ },
  { name: 'skill-relay-xian orchestrator_host', src: relay, regex: /skill-relay-xian/ },
  { name: 'allow_xian 白名单门禁', src: relay, regex: /allow_xian/ },
  { name: 'getTaskLocation 对象入参支持', src: router, regex: /typeof.*task.*===.*object|task\.location/ },
  { name: 'dispatcher xianBypass location xian 判断', src: dispatcher, regex: /xianBypass|location.*===.*['\"]xian['\"]|['\"]xian['\"].*location/ },
];
let fail = false;
for (const c of checks) {
  const matched = c.regex.test(c.src);
  const pass = c.invert ? !matched : matched;
  if (!pass) { console.error('FAIL:', c.name); fail = true; } else { console.log('OK:', c.name); }
}
if (fail) process.exit(1);
console.log('[xian-harness-relay smoke] PASS');
" || { echo '[xian-harness-relay smoke] FAIL'; exit 1; }

echo '[xian-harness-relay smoke] PASS'
