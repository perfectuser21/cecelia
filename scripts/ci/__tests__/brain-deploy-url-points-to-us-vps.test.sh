#!/usr/bin/env bash
# 回归测试：brain-ci-deploy.yml 的 BRAIN_URL 默认值必须指向 us-vps，不能指回本机
#
# 守护 bug（2026-09-11 实证）：Cecelia Brain 迁移到 us-vps(100.79.41.61) 后，
# Gate3 部署 job 的 BRAIN_URL 默认值仍写死本机 mmv 的 Tailscale IP(100.71.151.105)。
# 叠加本机旧容器抢占 5221 端口的问题，导致部署 webhook 长期打在本机孤岛 Brain 上，
# us-vps 现役大脑收不到任何更新。
#
# DoD：workflow 文件里不能再出现旧 IP，且两处 BRAIN_URL 默认值都必须是 us-vps IP。
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORKFLOW="$REPO_ROOT/.github/workflows/brain-ci-deploy.yml"
OLD_IP="100.71.151.105"
NEW_IP="100.79.41.61"
FAIL=0

echo "== brain-ci-deploy.yml BRAIN_URL 必须指向 us-vps =="

if grep -q "$OLD_IP" "$WORKFLOW"; then
  echo "  ❌ workflow 文件里仍出现旧本机 IP ($OLD_IP)"
  FAIL=1
else
  echo "  ✅ 不再出现旧本机 IP ($OLD_IP)"
fi

BRAIN_URL_LINES=$(grep -c "BRAIN_URL:.*$NEW_IP" "$WORKFLOW" || true)
if [ "$BRAIN_URL_LINES" -ge 2 ]; then
  echo "  ✅ 找到 $BRAIN_URL_LINES 处 BRAIN_URL 默认值指向 us-vps ($NEW_IP)（期望 ≥2：deploy + on_deploy_failure）"
else
  echo "  ❌ 只找到 $BRAIN_URL_LINES 处 BRAIN_URL 默认值指向 us-vps（期望 ≥2）"
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
