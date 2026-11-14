#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
ENTRYPOINT="$ROOT_DIR/docker/cecelia-runner/entrypoint.sh"
BRIDGE="$(sed -n '/evaluator-evidence-bridge:start/,/evaluator-evidence-bridge:end/p' "$ENTRYPOINT")"

[[ -n "$BRIDGE" ]] || { echo 'FAIL: evaluator evidence bridge missing' >&2; exit 1; }
eval "$BRIDGE"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/evaluator-evidence-bridge.XXXXXX")"
trap '[[ -n "${TMP_DIR:-}" ]] && rm -r "$TMP_DIR"' EXIT

printf '%s\n' \
  '{"status":"completed","checks":["claimed pass"],"decision":{"outcome":"PASS","reason":"verified"}}' \
  > "$TMP_DIR/result.json"
HARNESS_NODE=evaluator HARNESS_ATTEMPT_ID=evidence-smoke-attempt CECELIA_TASK_ID=evidence-smoke \
  WORKTREE_PATH="$TMP_DIR" prepare_evaluator_evidence
printf '%s\n' \
  '{"verdict":"PASS","task_id":"evidence-smoke","attempt_id":"evidence-smoke-attempt","behavior_tests":[{"command":"npm test","exit_code":0,"log_tail":"12 tests passed"}]}' \
  > "$TMP_DIR/.brain-result.json"

HARNESS_NODE=evaluator HARNESS_ATTEMPT_ID=evidence-smoke-attempt CECELIA_TASK_ID=evidence-smoke \
  WORKTREE_PATH="$TMP_DIR" merge_evaluator_evidence "$TMP_DIR/result.json"
jq -e '.checks[0].exit_code == 0 and .checks[0].log_tail == "12 tests passed"' \
  "$TMP_DIR/result.json" >/dev/null

echo 'PASS: evaluator evidence bridge serializes command results'
