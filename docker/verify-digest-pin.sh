#!/usr/bin/env bash
# docker/verify-digest-pin.sh — 校验 runner 镜像实际 digest 与 canonical pin 一致
#
# 用法: bash docker/verify-digest-pin.sh [<image-ref>]   # 默认 cecelia/runner:latest
# 退出码: 0=一致 / 3=漂移(必须 repin) / 1=环境错误
#
# 背景: 2026-08-08 #4720 绕过 build.sh 重建镜像未同步 pin，fleet 三机准入静默全挂。
# 本守卫由 build.sh 末尾强制调用：rebuild 后 pin 未同步就见红，漂移无法再静默。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_REF="${1:-cecelia/runner:latest}"
DOCKER="${VERIFY_PIN_DOCKER:-docker}"
NODE_PROFILE="${VERIFY_PIN_NODE_PROFILE:-$REPO_ROOT/packages/brain/src/orchestrator/fleet-node/node-profile.js}"

PIN_FILES='packages/brain/src/orchestrator/fleet-node/node-profile.js
packages/brain/src/orchestrator/fleet-node/node-profile.test.js
packages/brain/config/fleet-node-profiles.json
packages/brain/scripts/fleet-worker/fleet-rollout.sh
packages/brain/scripts/fleet-worker/fleet-rollout.test.sh
packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.sh
packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.test.sh
packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh
packages/brain/scripts/smoke/provider-neutral-phase4a-node-smoke.sh
DEFINITION.md'

[[ -f "$NODE_PROFILE" ]] || { echo "[verify-digest-pin] node-profile.js 不存在: $NODE_PROFILE" >&2; exit 1; }

pinned="$(sed -nE "s/.*runner_image_digest: '([^']+)'.*/\1/p" "$NODE_PROFILE" | head -1)"
[[ "$pinned" =~ ^sha256:[0-9a-f]{64}$ ]] \
  || { echo "[verify-digest-pin] 无法从 node-profile.js 解析 pin digest" >&2; exit 1; }

actual="$("$DOCKER" image inspect --format '{{.Id}}' "$IMAGE_REF" 2>/dev/null)" \
  || { echo "[verify-digest-pin] docker inspect 失败（docker 不可用或镜像不存在: $IMAGE_REF）" >&2; exit 1; }
[[ "$actual" =~ ^sha256:[0-9a-f]{64}$ ]] \
  || { echo "[verify-digest-pin] docker inspect 输出异常: $actual" >&2; exit 1; }

if [[ "$actual" == "$pinned" ]]; then
  echo "[verify-digest-pin] OK: $IMAGE_REF digest 与 canonical pin 一致 ($pinned)"
  exit 0
fi

{
  echo "[verify-digest-pin] ❌ 镜像 digest 与 canonical pin 漂移"
  echo "  实际: $actual"
  echo "  pin:  $pinned"
  echo "  这不是可忽略的警告——fleet 三机准入按 pin 校验，漂移=准入静默全挂。"
  echo "  正解（禁只改一处）：把以下全部文件中的旧 digest 一次性替换为新 digest，"
  echo "  并同步 bump worker 版本 pin（node-profile.js / fleet-node-profiles.json / node-probe.cjs），"
  echo "  走 PR 合并后用 fleet-rollout.sh 分发三机："
  printf '%s\n' "$PIN_FILES" | sed 's/^/    - /'
} >&2
exit 3
