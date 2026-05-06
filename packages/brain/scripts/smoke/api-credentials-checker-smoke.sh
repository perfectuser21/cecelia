#!/usr/bin/env bash
# Smoke test: api-credentials-checker 模块可加载 + 三个 export 可调用
# 不实际打 API（CI 没凭据），只验证 module 完整性。
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

node --input-type=module -e "
import { checkAnthropicApi, checkOpenAI, checkAllApiCredentials } from './packages/brain/src/api-credentials-checker.js';
const exports = { checkAnthropicApi, checkOpenAI, checkAllApiCredentials };
for (const [name, fn] of Object.entries(exports)) {
  if (typeof fn !== 'function') {
    console.error('FAIL: ' + name + ' is not a function');
    process.exit(1);
  }
}
// 调用一次 with mock fetch，验证签名工作
const fakeFetch = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' });
const r = await checkAnthropicApi({ fetchFn: fakeFetch, apiKey: 'sk-test' });
if (r.healthy !== false || r.errorType !== 'unauthorized') {
  console.error('FAIL: checkAnthropicApi unexpected result', r);
  process.exit(1);
}
console.log('OK: api-credentials-checker smoke passed');
"
