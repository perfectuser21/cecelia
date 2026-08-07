#!/usr/bin/env bash
# Smoke: orphan-run-revival — 孤儿 run 复活 + spawn-guard 死锁解（task f4f28298 防复发）
# Sprint: sprints/archive/08072145-orphan-run-revival
#
# 2026-08-07 事故：W1/W2/W3 三条 harness_initiative 全灭。
#   死锁：orphan-guard 把 task 打回 queued 却不动 initiative_runs，
#         spawn-guard 按"还有活跃 run"一路拒到 requeue 超限终态 failed。
#   复活缺失：唯一的开机复活路径 scanOrphanedRelayTasks 引用了 initiative_runs 上
#         不存在的三列，每次启动必抛、被 catch 咽掉，自诞生起 100% 空转。
#
# 本 smoke 守结构不变量（活 schema 由 orphan-run-revival.integration.test.js 打真库守）：
#   1. spawn 侧与收割侧共用同一把活性判据（防判据再次分叉 = 死锁重现）
#   2. 收割 requeue 前先终态化 run，且顺序不可颠倒
#   3. startup-sync 不再引用 initiative_runs 上不存在的列
#   4. 复活闸只认 infra 死因签名 + 带封顶，且已接线进 server.js
#   5. forensic 落盘已接进 callback 路由（容器退出前唯一能拿到 docker logs 的时刻）
#   6. 集成测试已登记 POSTGRES_INTEGRATION_TESTS（永久入 CI）
set -euo pipefail

ok()   { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; exit 1; }

echo "[orphan-run-revival-smoke] 1. spawn 侧与收割侧共用同一把活性判据"
node -e "
const fs = require('fs');
const guard = 'packages/brain/src/lib/harness-run-guard.js';
if (!fs.existsSync(guard)) { console.error('FAIL: 判据 SSOT 模块 ' + guard + ' 不存在'); process.exit(1); }
const relay = fs.readFileSync('packages/brain/src/harness-skill-relay.js', 'utf8');
const orphan = fs.readFileSync('packages/brain/src/lib/harness-orphan-guard.js', 'utf8');
if (!relay.includes('findActiveRunBlockingSpawn')) {
  console.error('FAIL: harness-skill-relay.js 没走 findActiveRunBlockingSpawn —— 判据又分叉了');
  process.exit(1);
}
// spawn 侧不得再自己手搓 initiative_runs 活性查询
if (/SELECT id FROM initiative_runs/.test(relay)) {
  console.error('FAIL: harness-skill-relay.js 里又出现内联的 initiative_runs 活性查询');
  process.exit(1);
}
if (!orphan.includes('terminalizeRunsForTask')) {
  console.error('FAIL: harness-orphan-guard.js 没调 terminalizeRunsForTask —— 死锁会重现');
  process.exit(1);
}
"
ok "spawn-guard / orphan-guard 判据同源"

echo "[orphan-run-revival-smoke] 2. 收割 requeue 前先终态化 run（顺序不可颠倒）"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/lib/harness-orphan-guard.js', 'utf8');
const fn = src.slice(src.indexOf('export async function requeueOrphanTask'));
const body = fn.slice(0, fn.indexOf('\n}'));
const t = body.indexOf('terminalizeRunsForTask');
const u = body.indexOf('UPDATE tasks');
if (t < 0) { console.error('FAIL: requeueOrphanTask 内没有终态化 run'); process.exit(1); }
if (u >= 0 && t > u) {
  console.error('FAIL: 终态化 run 排在 UPDATE tasks 之后 —— 中间会留下\"已 queued 但重派必被拒\"的窗口');
  process.exit(1);
}
"
ok "run 先终态化，task 后回 queued"

echo "[orphan-run-revival-smoke] 3. startup-sync 不再引用 initiative_runs 上不存在的列"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/startup-sync.js', 'utf8');
// 这三列 initiative_runs 上从来没有过；exit code 真正落在 tasks.payload
const ghosts = ['r.tmux_session', 'r.last_container_exit_code', 'r.stdout_tail'];
const sql = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const hit = ghosts.filter((g) => sql.includes(g));
if (hit.length) {
  console.error('FAIL: startup-sync.js 又引用了不存在的列: ' + hit.join(', '));
  process.exit(1);
}
if (!src.includes(\"payload?.last_container_exit_code\")) {
  console.error('FAIL: startup-sync.js 没从 tasks.payload 取 exit code');
  process.exit(1);
}
"
ok "SELECT 只取真实存在的列，exit code 取自 tasks.payload"

echo "[orphan-run-revival-smoke] 4. 复活闸：只认 infra 死因 + 封顶 + 已接线"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/startup-sync.js', 'utf8');
const checks = [
  ['REVIVAL_ERROR_SIGNATURE', 'infra 死因签名常量'],
  ['harness_revival_count', '复活次数封顶字段'],
  ['revived_from', '复活留痕字段'],
  [\"'orphan_requeue_count', 0\", 'requeue 计数重置'],
  ['terminalizeRunsForTask', '复活前清残留 run'],
  ['findLiveRelayContainers', '复活前判活（防双跑）'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length) {
  console.error('FAIL: startup-sync.js 复活闸缺少:');
  missing.forEach(([, d]) => console.error('  - ' + d));
  process.exit(1);
}
const server = fs.readFileSync('packages/brain/server.js', 'utf8');
if (!server.includes('reviveOrphanedHarnessTasks')) {
  console.error('FAIL: reviveOrphanedHarnessTasks 未接线进 server.js —— 写了等于没写');
  process.exit(1);
}
"
ok "复活闸三道闸齐全且已接线"

echo "[orphan-run-revival-smoke] 5. forensic 落盘已接进 callback 路由"
node -e "
const fs = require('fs');
const cb = fs.readFileSync('packages/brain/src/routes/harness-callback.js', 'utf8');
if (!cb.includes('captureRelayContainerLogs')) {
  console.error('FAIL: callback 路由没接 forensic 落盘 —— 容器一被 janitor prune 死因就没了');
  process.exit(1);
}
const forensics = fs.readFileSync('packages/brain/src/lib/relay-forensics.js', 'utf8');
// containerId 来自 HTTP 路由参数并进 shell，字符集必须卡死
if (!forensics.includes('isSafeContainerName')) {
  console.error('FAIL: relay-forensics.js 缺容器名字符集校验（命令注入面）');
  process.exit(1);
}
"
ok "回调时刻落盘 + 容器名字符集已卡死"

echo "[orphan-run-revival-smoke] 6. 集成测试已登记 POSTGRES_INTEGRATION_TESTS"
node -e "
const fs = require('fs');
const cfg = fs.readFileSync('packages/brain/vitest.config.js', 'utf8');
const i = cfg.indexOf('POSTGRES_INTEGRATION_TESTS');
const j = cfg.indexOf('];', i);
if (!cfg.slice(i, j).includes('orphan-run-revival.integration.test.js')) {
  console.error('FAIL: 集成测试未登记 POSTGRES_INTEGRATION_TESTS，非永久入 CI');
  process.exit(1);
}
"
ok "集成测试永久入 CI"

echo "[orphan-run-revival-smoke] ALL PASS"
