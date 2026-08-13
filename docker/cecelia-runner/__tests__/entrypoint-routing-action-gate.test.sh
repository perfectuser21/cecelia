#!/usr/bin/env bash
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
ENTRYPOINT="$ROOT/docker/cecelia-runner/entrypoint.sh"
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

block=$(sed -n '/^# routing-action-gate:start$/,/^# routing-action-gate:end$/p' "$ENTRYPOINT")
[[ -n "$block" ]] || { echo 'missing routing action gate' >&2; exit 1; }
eval "$block"
type install_routing_action_gate >/dev/null

git init -b cp-action-gate "$TEST_ROOT/workspace" >/dev/null
git -C "$TEST_ROOT/workspace" config user.name 'Routing Gate Test'
git -C "$TEST_ROOT/workspace" config user.email routing@example.invalid
printf 'base\n' > "$TEST_ROOT/workspace/base.txt"
git -C "$TEST_ROOT/workspace" add base.txt
git -C "$TEST_ROOT/workspace" commit -m base >/dev/null
BASE_SHA=$(git -C "$TEST_ROOT/workspace" rev-parse HEAD)

export WORKTREE_PATH="$TEST_ROOT/workspace"
export CECELIA_TASK_ID=11111111-1111-4111-8111-111111111111
export CECELIA_ROUTING_RECEIPT_ID=22222222-2222-4222-8222-222222222222
export CECELIA_RUN_ID=33333333-3333-4333-8333-333333333333
export CECELIA_REPO=cecelia
export CECELIA_BRANCH=cp-action-gate
export CECELIA_BASE_SHA="$BASE_SHA"

install_routing_action_gate
LOCK="$TEST_ROOT/workspace/.dev-lock.cp-action-gate"
jq -e --arg base "$BASE_SHA" '
  .task_id == "11111111-1111-4111-8111-111111111111"
  and .routing_receipt_id == "22222222-2222-4222-8222-222222222222"
  and .run_id == "33333333-3333-4333-8333-333333333333"
  and .repo == "cecelia" and .branch == "cp-action-gate" and .base_sha == $base
' "$LOCK" >/dev/null

rm "$LOCK"
CECELIA_RUN_ID='' ! install_routing_action_gate >/dev/null 2>&1
test ! -e "$LOCK"

CECELIA_BRANCH=cp-wrong ! install_routing_action_gate >/dev/null 2>&1
test ! -e "$LOCK"

echo 'entrypoint routing action gate PASS'
