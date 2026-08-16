#!/usr/bin/env bash
# 回归：routing action gate（#4872）会往工作区根写 runner 自有的 .dev-lock.<branch>；
# 冻结候选树断言（#4890）不得把它当成"产品被污染"的 untracked 文件——否则每个
# read-write Evaluator 起容器即死（frozen_baseline_guard_unavailable，2026-08-16 生产
# 4 条 run 实证：17ed9f07 / 0bce0b07 / 987b6822 / 56a1e68d）。
# 同时其它 untracked 产品文件仍必须被拒绝（防篡改语义不放松）。

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

make_workspace() {
  local ws="$1"
  mkdir -p "$ws"
  git init -q -b main "$ws"
  git -C "$ws" config user.name 'Evaluator DevLock Test'
  git -C "$ws" config user.email 'evaluator-devlock@example.invalid'
  printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$ws/candidate-test.sh"
  chmod +x "$ws/candidate-test.sh"
  git -C "$ws" add candidate-test.sh
  git -C "$ws" -c core.hooksPath=/dev/null commit -qm 'test: frozen candidate'
}

run_guard() {
  local ws="$1" guard_dir="$2"
  mkdir -p "$guard_dir" "$TEST_ROOT/attempt-evidence"
  (
    export HARNESS_NODE=evaluator
    export HARNESS_FROZEN_BASELINE=true
    export HARNESS_WORKSPACE_START_SHA="$(git -C "$ws" rev-parse HEAD)"
    export WORKTREE_PATH="$ws"
    export FROZEN_BASELINE_GUARD_DIR="$guard_dir"
    export BRAIN_RESULT_FILE="$TEST_ROOT/attempt-evidence/brain-result.json"
    export HARNESS_READ_ONLY=false
    install_frozen_baseline_guard
  )
}

# 1) runner 自有的 .dev-lock.<branch>（routing action gate 产物）必须被豁免
WS_LOCK="$TEST_ROOT/ws-devlock"
make_workspace "$WS_LOCK"
printf '%s\n' '{"task_id":"t","routing_receipt_id":"r","run_id":"u","repo":"cecelia","branch":"cp-route-api-test","base_sha":"0000000000000000000000000000000000000000"}' \
  > "$WS_LOCK/.dev-lock.cp-route-api-test"
chmod 0444 "$WS_LOCK/.dev-lock.cp-route-api-test"
if ! run_guard "$WS_LOCK" "$TEST_ROOT/guard-devlock" >"$TEST_ROOT/devlock.out" 2>&1; then
  echo "frozen evaluator guard rejected the runner-owned .dev-lock receipt file:" >&2
  cat "$TEST_ROOT/devlock.out" >&2
  exit 1
fi
grep -Fq 'frozen baseline guard armed at' "$TEST_ROOT/devlock.out" || {
  echo "guard did not report armed with a .dev-lock present" >&2
  cat "$TEST_ROOT/devlock.out" >&2
  exit 1
}

# 2) 其它 untracked 产品文件仍必须被拒绝（豁免不能扩大）
WS_PRODUCT="$TEST_ROOT/ws-product"
make_workspace "$WS_PRODUCT"
printf '%s\n' 'forged product' > "$WS_PRODUCT/forged-product.js"
if run_guard "$WS_PRODUCT" "$TEST_ROOT/guard-product" >"$TEST_ROOT/product.out" 2>&1; then
  echo "frozen evaluator guard accepted an untracked product file" >&2
  cat "$TEST_ROOT/product.out" >&2
  exit 1
fi
grep -Fq 'untracked product file: forged-product.js' "$TEST_ROOT/product.out" || {
  echo "guard rejected for an unexpected reason:" >&2
  cat "$TEST_ROOT/product.out" >&2
  exit 1
}

# 3) 伪装成 .dev-lock 的目录 / 子目录里的同名文件不得被豁免
WS_FAKE="$TEST_ROOT/ws-fake"
make_workspace "$WS_FAKE"
mkdir -p "$WS_FAKE/.dev-lock.fake-dir"
printf '%s\n' 'payload' > "$WS_FAKE/.dev-lock.fake-dir/payload.js"
if run_guard "$WS_FAKE" "$TEST_ROOT/guard-fake" >"$TEST_ROOT/fake.out" 2>&1; then
  echo "frozen evaluator guard accepted a directory masquerading as .dev-lock" >&2
  cat "$TEST_ROOT/fake.out" >&2
  exit 1
fi
WS_NESTED="$TEST_ROOT/ws-nested"
make_workspace "$WS_NESTED"
mkdir -p "$WS_NESTED/packages/app"
printf '%s\n' 'payload' > "$WS_NESTED/packages/app/.dev-lock.nested"
if run_guard "$WS_NESTED" "$TEST_ROOT/guard-nested" >"$TEST_ROOT/nested.out" 2>&1; then
  echo "frozen evaluator guard accepted a nested .dev-lock outside the workspace root" >&2
  cat "$TEST_ROOT/nested.out" >&2
  exit 1
fi

echo "entrypoint-evaluator-devlock-exempt: PASS"
