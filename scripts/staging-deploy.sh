#!/usr/bin/env bash
# 独立 staging 入口，与生产发布持有相同锁；无 Docker/镜像/验证均失败关闭。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/lib/brain-staging.sh"
[[ "${1:-}" != --dry-run ]] || { echo 'dry-run 不构成 staging 验收'; exit 1; }
command -v docker >/dev/null
brain_release_lock
if [[ "${1:-}" == --cleanup ]]; then
    stage_remove_container cecelia-admission-brain
    stage_remove_container cecelia-admission-db
    stage_remove_network
    rm -f "$ROOT_DIR/logs/brain-staging-receipt.json"
    exit 0
fi
EXPECTED_SHA="${EXPECTED_SHA:-$(git -C "$ROOT_DIR" rev-parse HEAD)}"
[[ "$EXPECTED_SHA" =~ ^[a-f0-9]{40}$ ]] || exit 1
VERSION=$(git -C "$ROOT_DIR" show "$EXPECTED_SHA:packages/brain/package.json" | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).version)')
export EXPECTED_SHA
bash "$SCRIPT_DIR/brain-build.sh"
image=$(docker image inspect --format '{{.Id}}' "cecelia-brain:$VERSION")
stage_candidate "$EXPECTED_SHA" "$image" "$VERSION"
