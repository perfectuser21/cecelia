#!/bin/bash
# deploy-local-npm-cache-smoke.sh
# 回归守卫：deploy-local.sh 里所有 npm ci/npm install 调用必须显式指定 --cache
# 指向项目本地目录（如 $MAIN_ROOT/.npm-cache），不能用默认缓存路径。
#
# 根因（2026-07-20 实锤）：cecelia-node-brain 容器里 $HOME=/Users/administrator，
# 但该目录本身是只读挂载点，只有个别子目录（.claude/.codex-team1/.credentials等）
# 被单独挂成可写——npm 默认缓存路径 $HOME/.npm 从未被挂载，容器内 mkdir 直接
# Read-only file system。生产部署连续多次原地失败（PR#4135/#4138 均卡住），
# 根因排查耗时数小时，才发现"宿主机依赖同步"那一步的 npm ci 唯独漏了 --cache
# （紧邻 40 行之后的 Dashboard npm install 早就正确带了 --cache，只是没人把
# 同一个坑对齐到 Brain 依赖同步这一步）。
set -e
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
node -e "
const fs = require('fs');
const src = fs.readFileSync('${SCRIPT_DIR}/../deploy-local.sh', 'utf8');
const lines = src.split('\n');
const bad = [];
lines.forEach((line, i) => {
  const trimmed = line.trim();
  if (trimmed.startsWith('#') || trimmed.startsWith('echo ')) return;
  const isNpmInstallLike = /\bnpm (ci|install)\b/.test(line);
  if (isNpmInstallLike && !line.includes('--cache')) {
    bad.push(\`line \${i + 1}: \${trimmed}\`);
  }
});
if (bad.length > 0) {
  console.log('FAIL: 以下 npm ci/install 调用缺少 --cache（默认缓存路径在容器内是只读的，会导致部署静默失败）:');
  bad.forEach((l) => console.log('  - ' + l));
  process.exit(1);
}
console.log('PASS: deploy-local.sh 所有 npm ci/install 调用均带 --cache');
"
