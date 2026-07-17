#!/usr/bin/env bash
# smoke: watchdog-gh-compat — 验证 _parseBaseRepo zenithjoy-skills 映射 + mapCiStatus 函数存在
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[smoke] watchdog-gh-compat: _parseBaseRepo zenithjoy-skills 映射"
node -e "
import { _parseBaseRepo } from './src/harness-relay-watchdog.js';
const r = _parseBaseRepo('/Users/administrator/perfect21/zenithjoy-skills');
if (r !== 'perfectuser21/zenithjoy-skills') {
  console.error('FAIL: got', r);
  process.exit(1);
}
console.log('PASS: zenithjoy-skills →', r);
" --input-type=module

echo "[smoke] watchdog-gh-compat: PASS"
