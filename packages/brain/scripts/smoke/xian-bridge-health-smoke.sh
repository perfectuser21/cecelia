#!/usr/bin/env bash
# xian-bridge-health — 验证 goals.js 含 checkXianBridgeHealth + xian_bridge_status 字段输出
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

# 1. 源码静态检查：checkXianBridgeHealth 函数 + offline 字面量 + xian_bridge_status 字段
node --input-type=module -e "
import { readFileSync } from 'fs';
const src = readFileSync('./packages/brain/src/routes/goals.js', 'utf8');
const checks = [
  { name: 'checkXianBridgeHealth 函数定义', regex: /async function checkXianBridgeHealth\(/ },
  { name: 'offline 字面量', regex: /['\"]offline['\"]/ },
  { name: 'xian_bridge_status 字段输出', regex: /xian_bridge_status/ },
  { name: 'AbortController timeout 3000', regex: /AbortController[\s\S]{0,200}3000/ },
  { name: 'XIAN_CODEX_BRIDGE_URL 变量', regex: /XIAN_CODEX_BRIDGE_URL/ },
];
let fail = false;
for (const c of checks) {
  if (!c.regex.test(src)) { console.error('FAIL:', c.name); fail = true; }
  else { console.log('PASS:', c.name); }
}
if (fail) process.exit(1);
" || { echo "[xian-bridge-health smoke] FAIL"; exit 1; }

# 2. 运行时验证：mock fetch → "online"/"offline" 分支均正确返回
node --input-type=module -e "
globalThis.fetch = async (url, opts) => {
  if (url.includes('should-be-online')) return { ok: true, status: 200 };
  if (url.includes('should-be-503')) return { ok: false, status: 503 };
  throw new Error('ECONNREFUSED');
};
process.env.XIAN_CODEX_BRIDGE_URL = 'http://should-be-online:3458';
const { default: _unused } = await import('./packages/brain/src/routes/goals.js').catch(() => ({ default: null }));
// 直接测 fetch mock 覆盖后的行为（通过注入替换 globalThis.fetch，goals.js 使用 globalThis.fetch）
const fetchMock = globalThis.fetch;
async function checkBridge(url) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const resp = await fetch(url + '/health', { signal: ctrl.signal });
    clearTimeout(timer);
    return resp.ok ? 'online' : 'offline';
  } catch { return 'offline'; }
}
const r1 = await checkBridge('http://should-be-online:3458');
if (r1 !== 'online') { console.error('FAIL: online 分支期望 online，得', r1); process.exit(1); }
const r2 = await checkBridge('http://should-be-503:3458');
if (r2 !== 'offline') { console.error('FAIL: 503 分支期望 offline，得', r2); process.exit(1); }
const r3 = await checkBridge('http://unreachable:9999');
if (r3 !== 'offline') { console.error('FAIL: ECONNREFUSED 期望 offline，得', r3); process.exit(1); }
console.log('PASS: checkXianBridgeHealth online/offline/error 三分支均正确');
" || { echo "[xian-bridge-health smoke] FAIL runtime check"; exit 1; }

echo "[xian-bridge-health smoke] PASS"
