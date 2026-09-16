#!/usr/bin/env bash
# 回归测试：全部 workflow 里 Brain 相关默认地址必须指向 us-vps，不能指回本机
#
# 守护 bug（2026-09-11 实证）：Cecelia Brain 迁移到 us-vps(100.79.41.61) 后，
# 发现不止 brain-ci-deploy.yml，还有另外 14 个 workflow（含全量发布 deploy.yml）
# 的 BRAIN_URL / DEFAULT_PROBE_URL 默认值仍写死本机 mmv 的 Tailscale IP
# (100.71.151.105)。叠加本机旧容器抢占 5221 端口的问题，导致部署/探测流量
# 长期打在本机孤岛 Brain 上，us-vps 现役大脑收不到任何更新、健康探测也不可信。
#
# 例外1：scripts/codex-request.sh 里同一个 IP 是 SSH 直连 mac-mini-m4-us 本机
# 用的（无头 codex 账号穿透包），跟 Brain HTTP API 无关，不在本测试断言范围。
#
# 例外2（2026-09-17）：预览环境代理 100.71.151.105:5231 是**有意**指向执行机的。
# 起预览环境 = 起 Brain 实例 + 克隆数据库 = 执行活，按零执行铁律（决策 96054a8b）
# 必须下放执行机；且整套预览功能本就是 Mac 专用（启动脚本硬编码 /Users/administrator
# 路径、磁盘门槛 38.5G 按 Mac 盘设计，us-vps 根分区 24G 数学上不可能过）——
# 09-09 搬去 us-vps 后 preview_environments 从 842 次历史记录直接归零。
#
# 端口正好能区分两种语义，据此精化断言而不是整体豁免：
#   :5221 = Brain HTTP API      → 必须指 us-vps（本测试的原意，继续严守）
#   :5231 = 预览执行代理         → 必须指执行机（scripts/preview-agent.mjs）
# 只禁带 5221 端口的旧本机地址，既保住原有保护力，也不再逼着执行活搬回 us-vps。
#
# DoD：.github/workflows/*.yml 里不能再出现旧 IP，且 brain-ci-deploy.yml 的
# 两处 BRAIN_URL 默认值必须明确指向 us-vps IP。
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORKFLOWS_DIR="$REPO_ROOT/.github/workflows"
GATE3="$WORKFLOWS_DIR/brain-ci-deploy.yml"
OLD_IP="100.71.151.105"
NEW_IP="100.79.41.61"
BRAIN_PORT="5221"      # Brain HTTP API
AGENT_PORT="5231"      # 预览执行代理（scripts/preview-agent.mjs）
FAIL=0

echo "== 全部 workflow 的 Brain 相关默认地址必须指向 us-vps =="

# 只拦"本机 IP + Brain API 端口"——指向执行代理端口(5231)的是下放，不是漏改
STALE=$(grep -rl "${OLD_IP}:${BRAIN_PORT}" "$WORKFLOWS_DIR"/*.yml 2>/dev/null || true)
if [ -n "$STALE" ]; then
  echo "  ❌ 以下 workflow 的 Brain 地址仍指向旧本机 (${OLD_IP}:${BRAIN_PORT})："
  echo "$STALE" | sed 's/^/       /'
  echo "     Brain HTTP API 必须指 us-vps($NEW_IP)；若本意是下放执行，请用执行代理端口 ${AGENT_PORT}"
  FAIL=1
else
  echo "  ✅ 没有 workflow 把 Brain API 指回旧本机 (${OLD_IP}:${BRAIN_PORT})"
fi

# 反向守卫：预览执行必须留在执行机，不许被"统一指 us-vps"顺手搬回去
PREVIEW_WFS=$(ls "$WORKFLOWS_DIR"/preview-*.yml 2>/dev/null || true)
if [ -n "$PREVIEW_WFS" ]; then
  BAD=$(grep -l "$NEW_IP" $PREVIEW_WFS 2>/dev/null || true)
  if [ -n "$BAD" ]; then
    echo "  ❌ 预览 workflow 指向了 us-vps($NEW_IP)，违反零执行铁律 96054a8b："
    echo "$BAD" | sed 's/^/       /'
    echo "     起预览=起 Brain 实例+克隆库=执行活，必须在执行机；且 us-vps 根分区 24G 过不了 38.5G 门槛"
    FAIL=1
  else
    echo "  ✅ 预览 workflow 仍指向执行机（执行没有被搬回 us-vps）"
  fi
fi

BRAIN_URL_LINES=$(grep -c "BRAIN_URL:.*$NEW_IP" "$GATE3" || true)
if [ "$BRAIN_URL_LINES" -ge 2 ]; then
  echo "  ✅ brain-ci-deploy.yml 找到 $BRAIN_URL_LINES 处 BRAIN_URL 默认值指向 us-vps ($NEW_IP)（期望 ≥2：deploy + on_deploy_failure）"
else
  echo "  ❌ brain-ci-deploy.yml 只找到 $BRAIN_URL_LINES 处 BRAIN_URL 默认值指向 us-vps（期望 ≥2）"
  FAIL=1
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "✅ 全部通过"
  exit 0
else
  echo "❌ 存在失败项"
  exit 1
fi
