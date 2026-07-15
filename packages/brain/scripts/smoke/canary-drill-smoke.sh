#!/usr/bin/env bash
# smoke: canary-death-drill.mjs 端口守卫与导出验证
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRILL_SCRIPT="${SCRIPT_DIR}/../../../scripts/canary-death-drill.mjs"

echo "[canary-drill-smoke] 验证守卫函数导出..."

node -e "
import('${DRILL_SCRIPT}').then(m => {
  console.assert(typeof m.validateStagingUrl === 'function', 'validateStagingUrl 未导出');
  console.assert(typeof m.sendBark === 'function', 'sendBark 未导出');
  console.assert(typeof m.archiveDrillResult === 'function', 'archiveDrillResult 未导出');
  console.assert(typeof m.runOomDrill === 'function', 'runOomDrill 未导出');
  console.assert(typeof m.notifyDrillFailure === 'function', 'notifyDrillFailure 未导出');

  // 验证端口守卫拒绝 5221
  try {
    m.validateStagingUrl('http://localhost:5221');
    console.error('FAIL: 应拒绝 :5221 但未抛出');
    process.exit(1);
  } catch (e) {
    console.assert(e.message.includes(':5221'), '错误消息应含 :5221');
  }

  // 验证 5222 正常通过
  try {
    m.validateStagingUrl('http://localhost:5222');
  } catch (e) {
    console.error('FAIL: :5222 应通过守卫');
    process.exit(1);
  }

  console.log('OK: 所有导出验证通过');
}).catch(e => { console.error(e); process.exit(1); })
" 2>&1

echo "canary-drill smoke PASS"
