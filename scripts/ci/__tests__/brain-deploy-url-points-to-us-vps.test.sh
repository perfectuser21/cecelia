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
# 现役 workflow 的 Brain API 不得指向旧执行机；不要求退役部署入口继续存在。
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORKFLOWS_DIR="$REPO_ROOT/.github/workflows"
OLD_IP="100.71.151.105"
NEW_IP="100.79.41.61"
BRAIN_PORT="5221"      # Brain HTTP API
FAIL=0

echo "== 全部 workflow 的 Brain 相关默认地址必须指向 us-vps =="

# 禁止现役Brain API回到旧本机地址
STALE=$(grep -rl "${OLD_IP}:${BRAIN_PORT}" "$WORKFLOWS_DIR"/*.yml 2>/dev/null || true)
if [ -n "$STALE" ]; then
  echo "  ❌ 以下 workflow 的 Brain 地址仍指向旧本机 (${OLD_IP}:${BRAIN_PORT})："
  echo "$STALE" | sed 's/^/       /'
  echo "     Brain HTTP API 必须指 us-vps($NEW_IP)"
  FAIL=1
else
  echo "  ✅ 没有 workflow 把 Brain API 指回旧本机 (${OLD_IP}:${BRAIN_PORT})"
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "✅ 全部通过"
  exit 0
else
  echo "❌ 存在失败项"
  exit 1
fi
