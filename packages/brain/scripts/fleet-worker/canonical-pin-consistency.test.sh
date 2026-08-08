#!/usr/bin/env bash
# canonical-pin-consistency — 全部 runner digest / worker 版本 pin 点互锁一致性守卫
#
# 2026-08-08 kernel 战役教训：#4720 重建镜像只动了本地 tag，pin 十处没同步，
# fleet 三机准入静默全挂。本测试让"漏改任何一处"在 CI 每 PR 直接见红。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
fail() { echo "FAIL: $*" >&2; exit 1; }

NODE_PROFILE="$REPO_ROOT/packages/brain/src/orchestrator/fleet-node/node-profile.js"
baseline_digest="$(sed -nE "s/.*runner_image_digest: '([^']+)'.*/\1/p" "$NODE_PROFILE" | head -1)"
[[ "$baseline_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "cannot parse baseline digest from node-profile.js"
hex="${baseline_digest#sha256:}"

# 全部 pin 文件必须含 baseline digest（互锁：漏改任何一处即红）
PIN_FILES='src/orchestrator/fleet-node/node-profile.test.js
config/fleet-node-profiles.json
scripts/fleet-worker/fleet-rollout.sh
scripts/fleet-worker/fleet-rollout.test.sh
scripts/fleet-worker/reconcile-fleet-node-baseline.sh
scripts/fleet-worker/reconcile-fleet-node-baseline.test.sh
scripts/fleet-worker/install-fleet-worker.test.sh
scripts/smoke/provider-neutral-phase4a-node-smoke.sh'
while IFS= read -r rel; do
  grep -q "$hex" "$REPO_ROOT/packages/brain/$rel" \
    || fail "pin file missing baseline digest: packages/brain/$rel"
done <<< "$PIN_FILES"
grep -q "$hex" "$REPO_ROOT/DEFINITION.md" || fail "DEFINITION.md missing baseline digest"

# pin 语境行不允许残留任何其它 digest（防新旧并存）
stray="$(grep -rn "runner_image_digest\|RUNNER_DIGEST=" "$REPO_ROOT/packages/brain" \
  --include='*.js' --include='*.json' --include='*.sh' \
  | grep -oE 'sha256:[0-9a-f]{64}' | sort -u | grep -v "^$baseline_digest\$" || true)"
[[ -z "$stray" ]] || fail "stray runner digest pin found: $stray"

# worker 版本三组一致（admission 严格比对 worker.version === version_policy.worker）
policy_worker="$(sed -nE "s/.*worker: '([0-9.]+)'.*/\1/p" "$NODE_PROFILE" | head -1)"
[[ -n "$policy_worker" ]] || fail "cannot parse version_policy.worker from node-profile.js"
probe_worker="$(sed -nE "s/.*DEFAULT_WORKER_VERSION = '([0-9.]+)'.*/\1/p" \
  "$REPO_ROOT/packages/brain/scripts/fleet-worker/node-probe.cjs" | head -1)"
[[ "$probe_worker" == "$policy_worker" ]] \
  || fail "node-probe DEFAULT_WORKER_VERSION ($probe_worker) != version_policy.worker ($policy_worker)"
profiles_worker_count="$(grep -c "\"worker\": \"$policy_worker\"" \
  "$REPO_ROOT/packages/brain/config/fleet-node-profiles.json")"
[[ "$profiles_worker_count" -eq 3 ]] \
  || fail "fleet-node-profiles.json should pin worker=$policy_worker on 3 machines, got $profiles_worker_count"

echo "PASS: canonical-pin-consistency.test.sh"
