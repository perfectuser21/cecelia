#!/bin/bash
set -e
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
node -e "
const fs = require('fs');
const src = fs.readFileSync('${SCRIPT_DIR}/../brain-deploy.sh', 'utf8');
if (src.includes('--filter \"status=exited\"')) {
  console.log('FAIL: 仍有 status=exited filter');
  process.exit(1);
}
if (!src.includes('^/cecelia-node-brain\$')) {
  console.log('FAIL: 未找到精确 name filter');
  process.exit(1);
}
console.log('PASS: brain-deploy.sh 使用精确容器名清理');
"
