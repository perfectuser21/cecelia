#!/bin/bash
# deploy-local-npm-cache-smoke.sh
# 回归守卫：deploy-local.sh 里所有 npm ci/npm install 调用必须显式指定 --cache
# 和 --logs-dir，都指向项目本地目录（如 $MAIN_ROOT/.npm-cache），不能用默认路径。
#
# 根因（2026-07-20 实锤，分两层）：cecelia-node-brain 容器里 $HOME=/Users/administrator，
# 但该目录本身是只读挂载点，只有个别子目录（.claude/.codex-team1/.credentials等）
# 被单独挂成可写。①npm 默认缓存路径 $HOME/.npm 从未被挂载，容器内 mkdir 直接
# Read-only file system——加 --cache 后表面修好，但②npm 无论 --cache 指哪都会
# 单独尝试把运行日志写到 $HOME/.npm/_logs（--cache 管的是包缓存，不管日志），
# 同一个 mkdir 失败又原地复发一次——必须同时加 --logs-dir 才彻底解决。
# 生产部署连续多次原地失败（PR#4135/#4138 均卡住），根因排查耗时数小时。
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
    bad.push(\`line \${i + 1} (缺 --cache): \${trimmed}\`);
  }
  if (isNpmInstallLike && !line.includes('--logs-dir')) {
    bad.push(\`line \${i + 1} (缺 --logs-dir): \${trimmed}\`);
  }
});
if (bad.length > 0) {
  console.log('FAIL: 以下 npm ci/install 调用缺少 --cache 或 --logs-dir（默认路径在容器内是只读的，会导致部署静默失败）:');
  bad.forEach((l) => console.log('  - ' + l));
  process.exit(1);
}
console.log('PASS: deploy-local.sh 所有 npm ci/install 调用均带 --cache 和 --logs-dir');
"
