#!/usr/bin/env bash
# relay-codex-executor-smoke.sh
# 验证 harness relay executor=codex 兼容层的关键实现真实存在（静态断言，CI 可跑，不依赖 docker/DB）：
#   - task-tasks.js: executor 白名单 + orchestrator 组合校验
#   - harness-skill-relay.js: executor 分支 + total-four reservation/Docker/DB 守门 + 额度软闸
#   - harness-relay-watchdog.js: attempts 上限按 orchestrator_host 分支 + codex 逾期收尸
#   - entrypoint.sh: CECELIA_EXECUTOR=codex 分支
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRAIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPO_ROOT="$(cd "$BRAIN_DIR/../.." && pwd)"

echo "[relay-codex-executor smoke] 校验目标文件真实存在"
node -e "
const fs = require('fs');
const path = require('path');

const files = {
  taskTasks: path.join('${BRAIN_DIR}', 'src/routes/task-tasks.js'),
  skillRelay: path.join('${BRAIN_DIR}', 'src/harness-skill-relay.js'),
  watchdog: path.join('${BRAIN_DIR}', 'src/harness-relay-watchdog.js'),
  entrypoint: path.join('${REPO_ROOT}', 'docker/cecelia-runner/entrypoint.sh'),
};

for (const [name, p] of Object.entries(files)) {
  if (!fs.existsSync(p)) {
    console.error('[FAIL] 文件不存在:', name, p);
    process.exit(1);
  }
}

const taskTasksSrc = fs.readFileSync(files.taskTasks, 'utf8');
const skillRelaySrc = fs.readFileSync(files.skillRelay, 'utf8');
const watchdogSrc = fs.readFileSync(files.watchdog, 'utf8');
const entrypointSrc = fs.readFileSync(files.entrypoint, 'utf8');

const checks = [
  { name: 'task-tasks.js: executor 白名单校验', src: taskTasksSrc, regex: /executor/i },
  { name: 'harness-skill-relay.js: executor=codex 分支', src: skillRelaySrc, regex: /executor\s*===?\s*['\"]codex['\"]/ },
  { name: 'harness-skill-relay.js: Codex 总并发硬上限为 4', src: skillRelaySrc, regex: /const\s+MAX_CODEX_RELAYS\s*=\s*4\s*;/ },
  { name: 'harness-skill-relay.js: 点火前获取 reservation', src: skillRelaySrc, regex: /_codexLaunchReservations\s*>=\s*MAX_CODEX_RELAYS[\s\S]*_codexLaunchReservations\+\+/ },
  { name: 'harness-skill-relay.js: Docker live + reservation 联合守门', src: skillRelaySrc, regex: /liveCount\s*\+\s*_codexLaunchReservations\s*>\s*MAX_CODEX_RELAYS/ },
  { name: 'harness-skill-relay.js: Docker 查询失败 fail-closed', src: skillRelaySrc, regex: /codex Docker 守门查询失败（保守阻断）/ },
  { name: 'harness-skill-relay.js: DB active + reservation 联合守门', src: skillRelaySrc, regex: /count\s*\+\s*_codexLaunchReservations\s*>\s*MAX_CODEX_RELAYS/ },
  { name: 'harness-skill-relay.js: 点火结束释放 reservation', src: skillRelaySrc, regex: /Math\.max\(0,\s*_codexLaunchReservations\s*-\s*1\)/ },
  { name: 'harness-skill-relay.js: skill-relay-codex orchestrator_host', src: skillRelaySrc, regex: /skill-relay-codex/ },
  { name: 'harness-relay-watchdog.js: codex attempts 上限', src: watchdogSrc, regex: /MAX_CODEX_RELAY_ATTEMPTS|skill-relay-codex/ },
  { name: 'harness-relay-watchdog.js: relay_deadline_exceeded 收尸', src: watchdogSrc, regex: /relay_deadline_exceeded/ },
  { name: 'entrypoint.sh: CECELIA_EXECUTOR=codex 分支', src: entrypointSrc, regex: /CECELIA_EXECUTOR.*codex/ },
  { name: 'entrypoint.sh: codex exec 命令', src: entrypointSrc, regex: /codex\s+exec/ },
];

let fail = false;
for (const c of checks) {
  if (!c.regex.test(c.src)) {
    console.error('[FAIL]', c.name);
    fail = true;
  } else {
    console.log('[PASS]', c.name);
  }
}

if (fail) process.exit(1);
console.log('[relay-codex-executor smoke] 全部通过');
"
