#!/usr/bin/env bash
# smoke: fleet ssh 探针身份修复——buildSshCommand 选项 + selfcheck 守卫接线(静态断言,CI 兼容)
set -euo pipefail
cd "$(dirname "$0")/../.."
node -e "
const fs = require('fs');
const infra = fs.readFileSync('src/routes/infra-status.js', 'utf8');
if (!/export function buildSshCommand/.test(infra)) { console.error('缺 buildSshCommand 导出'); process.exit(1); }
if (!infra.includes('UserKnownHostsFile=/dev/null')) { console.error('缺 known_hosts=/dev/null 选项'); process.exit(1); }
if (!infra.includes('CECELIA_SSH_IDENTITY')) { console.error('缺 identity env 覆写'); process.exit(1); }
const sc = fs.readFileSync('src/selfcheck.js', 'utf8');
if (!/export async function checkComputeSshReachability/.test(sc)) { console.error('缺 selfcheck 守卫导出'); process.exit(1); }
if (!sc.includes('sshReachability')) { console.error('缺 runSelfCheck 注入点(测试隔离会回归)'); process.exit(1); }
console.log('✅ compute-ssh-reachability smoke PASS');
"
