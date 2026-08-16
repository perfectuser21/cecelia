#!/usr/bin/env bash
# 回归：冻结 Evaluator 依赖清单（#4890）不得把测试工具自己写进 node_modules 根下的缓存目录
# 当成"安装依赖被篡改"——vitest 默认把结果缓存写到 <pkg>/node_modules/.vite/vitest/results.json，
# 导致每个跑过 vitest 的 read-write Evaluator 事后必死于
# "[entrypoint] frozen evaluator installed dependencies drifted"（2026-08-16 生产 run 48d57838
# Evaluator f802ded5 隔离区取证：唯一漂移文件就是这一个）。
# 豁免只限 node_modules 目录直属的工具缓存目录名（.vite/.vitest/.cache/.vite-temp）；
# 其余（含 .bin、普通依赖包内容、伪装到包内部的同名目录）仍必须全量比对。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENTRYPOINT="$SCRIPT_DIR/../entrypoint.sh"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

guard_block="$(
  sed -n \
    '/^# frozen-baseline-guard:start$/,/^# frozen-baseline-guard:end$/p' \
    "$ENTRYPOINT"
)"
[[ -n "$guard_block" ]] || {
  echo "missing frozen baseline guard implementation" >&2
  exit 1
}
eval "$guard_block"

WORKSPACE="$TEST_ROOT/workspace"
mkdir -p "$WORKSPACE/packages/app/node_modules/dependency" \
  "$WORKSPACE/packages/app/node_modules/.bin"
printf '%s\n' 'exact installed dependency' \
  > "$WORKSPACE/packages/app/node_modules/dependency/runtime.js"
printf '%s\n' '#!/bin/sh' 'exit 0' > "$WORKSPACE/packages/app/node_modules/.bin/tool"
chmod 0755 "$WORKSPACE/packages/app/node_modules/.bin/tool"
export WORKTREE_PATH="$WORKSPACE"

capture() {
  write_frozen_evaluator_dependency_manifest "$1"
}

capture "$TEST_ROOT/baseline.manifest"

# 1) vitest / vite 结果缓存写进 node_modules 根直属工具缓存目录 → 不算漂移
mkdir -p "$WORKSPACE/packages/app/node_modules/.vite/vitest"
printf '%s\n' '{"results":{}}' \
  > "$WORKSPACE/packages/app/node_modules/.vite/vitest/results.json"
mkdir -p "$WORKSPACE/packages/app/node_modules/.vitest" \
  "$WORKSPACE/packages/app/node_modules/.cache/some-tool" \
  "$WORKSPACE/packages/app/node_modules/.vite-temp"
printf '%s\n' 'cache' > "$WORKSPACE/packages/app/node_modules/.cache/some-tool/entry"
capture "$TEST_ROOT/toolcache.manifest"
if ! cmp -s "$TEST_ROOT/baseline.manifest" "$TEST_ROOT/toolcache.manifest"; then
  echo "dependency manifest treated vitest/vite tool cache under node_modules as installed dependency drift" >&2
  exit 1
fi
rm -rf "$WORKSPACE/packages/app/node_modules/.vite" \
  "$WORKSPACE/packages/app/node_modules/.vitest" \
  "$WORKSPACE/packages/app/node_modules/.cache" \
  "$WORKSPACE/packages/app/node_modules/.vite-temp"

# 2) 真依赖内容被改 → 仍必须漂移
printf '%s\n' 'forged installed dependency' \
  > "$WORKSPACE/packages/app/node_modules/dependency/runtime.js"
capture "$TEST_ROOT/forged-dep.manifest"
if cmp -s "$TEST_ROOT/baseline.manifest" "$TEST_ROOT/forged-dep.manifest"; then
  echo "dependency manifest accepted a modified installed dependency" >&2
  exit 1
fi
printf '%s\n' 'exact installed dependency' \
  > "$WORKSPACE/packages/app/node_modules/dependency/runtime.js"

# 3) .bin 不是工具缓存，被改仍必须漂移
printf '%s\n' '#!/bin/sh' 'exit 1' > "$WORKSPACE/packages/app/node_modules/.bin/tool"
capture "$TEST_ROOT/forged-bin.manifest"
if cmp -s "$TEST_ROOT/baseline.manifest" "$TEST_ROOT/forged-bin.manifest"; then
  echo "dependency manifest accepted a modified node_modules/.bin entry" >&2
  exit 1
fi
printf '%s\n' '#!/bin/sh' 'exit 0' > "$WORKSPACE/packages/app/node_modules/.bin/tool"

# 4) 伪装到依赖包内部的同名缓存目录（不是 node_modules 直属）→ 仍必须漂移
mkdir -p "$WORKSPACE/packages/app/node_modules/dependency/.vite"
printf '%s\n' 'payload' > "$WORKSPACE/packages/app/node_modules/dependency/.vite/hook.js"
capture "$TEST_ROOT/nested-cache.manifest"
if cmp -s "$TEST_ROOT/baseline.manifest" "$TEST_ROOT/nested-cache.manifest"; then
  echo "dependency manifest exempted a .vite directory nested inside a dependency package" >&2
  exit 1
fi
rm -rf "$WORKSPACE/packages/app/node_modules/dependency/.vite"

# 5) 回到基线 → 一致
capture "$TEST_ROOT/restored.manifest"
cmp -s "$TEST_ROOT/baseline.manifest" "$TEST_ROOT/restored.manifest" || {
  echo "dependency manifest is not deterministic after restoring the baseline tree" >&2
  exit 1
}

echo "entrypoint-evaluator-deps-toolcache-exempt: PASS"
