#!/usr/bin/env bash
# Smoke: ZenithJoy 蓝绿部署护栏 — staging :5201 健康检查 + :5200 阻断
#
# 验证 staging-e2e-runner.js 的 ZenithJoy customer line 护栏实现：
#   - ZJ_STAGING_PORT=5201 已导出
#   - deployStaging(customer) 走健康检查路径（不跑 staging-deploy.sh）
#   - runStagingCommand(port=5201) 把合同里 :5200 重写到 :5201
#
# L1 (静态): 静态代码断言，无需网络
# L2 (gate): Brain 健康（不可达则 SKIP）
set -euo pipefail

RUNNER_FILE="packages/brain/src/staging-e2e-runner.js"
BRAIN="${BRAIN_URL:-http://localhost:5221}"

# ── L1 静态断言 ──────────────────────────────────────────────────────────
echo "[smoke] L1: ZenithJoy 蓝绿护栏静态断言"

test -f "$RUNNER_FILE" || { echo "[smoke] L1 FAIL: $RUNNER_FILE 不存在"; exit 1; }

node -e "
const fs = require('fs');
const runner = fs.readFileSync('$RUNNER_FILE', 'utf8');

// ZJ_STAGING_PORT=5201 已导出
if (!/export const ZJ_STAGING_PORT\s*=\s*5201/.test(runner)) {
  console.error('L1 FAIL: ZJ_STAGING_PORT=5201 未导出');
  process.exit(1);
}

// customer line 走健康检查（curl /health），不跑 staging-deploy.sh
if (!/customer[\s\S]{0,200}curl[\s\S]{0,100}ZJ_STAGING_PORT/.test(runner) &&
    !/ZJ_STAGING_PORT[\s\S]{0,300}curl/.test(runner)) {
  console.error('L1 FAIL: deployStaging customer 分支未见 curl 健康检查');
  process.exit(1);
}

// 健康检查失败 → reason=zj_staging_unhealthy
if (!/zj_staging_unhealthy/.test(runner)) {
  console.error('L1 FAIL: reason zj_staging_unhealthy 未出现（护栏未设 reason）');
  process.exit(1);
}

// runStagingCommand 有 ZJ_STAGING_PORT 端口重写分支（5200→5201）
if (!/ZJ_STAGING_PORT[\s\S]{0,100}localhost:5200/.test(runner) &&
    !/5200[\s\S]{0,200}ZJ_STAGING_PORT/.test(runner)) {
  console.error('L1 FAIL: runStagingCommand 缺 ZJ_STAGING_PORT port 重写分支（5200→5201）');
  process.exit(1);
}

// 默认重试参数：maxAttempts >= 5 且 retryDelayMs >= 30000（总窗口 >= 4.5 分钟，覆盖 ZJ CI 部署时间）
if (!/maxAttempts\s*\?\?\s*5/.test(runner)) {
  console.error('L1 FAIL: 默认 maxAttempts 未升级到 5（当前不够覆盖 ZJ CI 2-3 分钟部署窗口）');
  process.exit(1);
}
if (!/retryDelayMs\s*\?\?\s*30_000/.test(runner)) {
  console.error('L1 FAIL: 默认 retryDelayMs 未升级到 30_000（当前 20s 间隔不足）');
  process.exit(1);
}

// 失败 output 包含尝试次数说明
if (!/尝试.*次均失败/.test(runner)) {
  console.error('L1 FAIL: 重试耗尽 output 缺少诊断信息（尝试 N 次均失败）');
  process.exit(1);
}

// 成功时提取 stagingSha（健康检查 JSON 中的 build.sha，护栏通知和审计用）
if (!/stagingSha/.test(runner)) {
  console.error('L1 FAIL: deployStaging 缺少 stagingSha 返回字段（候选 SHA 可见性）');
  process.exit(1);
}

// 护栏 FAIL 通知含最后已知 SHA 诊断
if (!/最后已知 staging SHA/.test(runner)) {
  console.error('L1 FAIL: handlePromote FAIL 通知缺少最后已知 staging SHA 诊断行');
  process.exit(1);
}

console.log('[smoke] L1 PASS: ZJ_STAGING_PORT + 健康检查路径 + zj_staging_unhealthy + 端口重写 + 5次重试参数 + 诊断输出 + stagingSha + SHA诊断通知');
" || exit 1

# ZJ_STAGING_HOST 必须在 docker-compose.yml 中配置（容器内 localhost 无法访问宿主 :5201）
COMPOSE_FILE="docker-compose.yml"
if ! grep -q "ZJ_STAGING_HOST" "$COMPOSE_FILE" 2>/dev/null; then
  echo "[smoke] L1 FAIL: ZJ_STAGING_HOST 未在 $COMPOSE_FILE 中配置（Brain 容器内 localhost 不通宿主 :5201）"
  exit 1
fi
echo "[smoke] L1 PASS: ZJ_STAGING_HOST 已在 docker-compose.yml 配置"

# ── L2 Brain health gate ─────────────────────────────────────────────────
if ! curl -sf "$BRAIN/api/brain/health" >/dev/null 2>&1; then
  echo "[smoke] L2 SKIP: Brain 不可达（$BRAIN）— L1 静态已 PASS"
  exit 0
fi
echo "[smoke] L2 PASS: Brain healthy"

echo "[smoke] zj-staging-guardrail OK (L1+L2)"
exit 0
