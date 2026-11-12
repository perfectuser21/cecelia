#!/usr/bin/env bash
# 执行 entrypoint 真实配置复制段：凭据单链、配置隔离及会话目录排除。
# 回归合同：issue 2bf0f8ea（OAuth 刷新副本互踢）、d4e0ec91（会话并发复制卡死）。
set -euo pipefail
fail() { echo "FAIL: $*" >&2; exit 1; }
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENTRYPOINT="$REPO_ROOT/docker/cecelia-runner/entrypoint.sh"
FIXTURE=$(mktemp -d)
trap 'rm -rf "$FIXTURE"' EXIT
HOST_CFG="$FIXTURE/host"
LOCAL_CFG="$FIXTURE/local"
mkdir -p "$HOST_CFG/skills" "$LOCAL_CFG"
printf '{"accessToken":"host-v1"}\n' > "$HOST_CFG/.credentials.json"
printf '{"some":"config"}\n' > "$HOST_CFG/.claude.json"
printf '# fake skill\n' > "$HOST_CFG/skills/SKILL.md"
for dir in projects sessions file-history telemetry shell-snapshots paste-cache cache; do
  mkdir -p "$HOST_CFG/$dir"
  printf 'session data\n' > "$HOST_CFG/$dir/state.json"
done

copy_block=$(sed -n '/^# config-copy:start$/,/^# config-copy:end$/p' "$ENTRYPOINT")
[[ -n "$copy_block" ]] || { echo 'FAIL: 缺配置复制段' >&2; exit 1; }
# 直接执行真实实现，宿主和容器目录均为 fixture。
eval "$copy_block"
[[ -L "$LOCAL_CFG/.credentials.json" && "$(readlink "$LOCAL_CFG/.credentials.json")" == "$HOST_CFG/.credentials.json" ]] || fail '凭据软链失效'
echo 'PASS: 凭据软链指向宿主唯一原件'
printf '{"accessToken":"container-v2"}\n' > "$LOCAL_CFG/.credentials.json"
grep -q container-v2 "$HOST_CFG/.credentials.json" || fail '容器刷新未写回宿主'
echo 'PASS: 容器刷新写回宿主原件'
printf '{"accessToken":"host-v3"}\n' > "$HOST_CFG/.credentials.json"
grep -q host-v3 "$LOCAL_CFG/.credentials.json" || fail '宿主刷新不可见'
echo 'PASS: 宿主刷新对容器立即可见'
[[ -f "$LOCAL_CFG/.claude.json" && ! -L "$LOCAL_CFG/.claude.json" ]] || fail '普通配置未独立复制'
printf '{"some":"container-change"}\n' > "$LOCAL_CFG/.claude.json"
if grep -q container-change "$HOST_CFG/.claude.json"; then fail '普通配置写入穿透宿主'; fi
[[ -f "$LOCAL_CFG/skills/SKILL.md" ]] || fail 'skills 未复制'
echo 'PASS: 普通配置独立可写，skills 可见'
for dir in projects sessions file-history telemetry shell-snapshots paste-cache cache; do
  [[ ! -e "$LOCAL_CFG/$dir" ]] || fail "会话目录被复制： $dir"
done
echo 'PASS: 高频会话目录均未复制'
[[ -d "$LOCAL_CFG/session-env" ]] || fail 'session-env 未创建'
echo 'PASS: session-env 可写目录仍创建'
grep -Eq 'chown -R(h| -h).*"\$LOCAL_CFG"' "$ENTRYPOINT" || fail 'chown 缺少 -h'
echo 'PASS: evaluator chown 不穿透凭据软链'
