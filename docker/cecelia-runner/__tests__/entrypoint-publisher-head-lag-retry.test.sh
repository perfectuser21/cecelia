#!/usr/bin/env bash
# GP 锚：factory/F1 造完真验 — step3（publisher 回执可信性）
# 回归：r40 hop171 + r41 hop52 同因——publisher git push 成功且 ls-remote 确认后
# 立刻 `gh pr view`，GitHub API 的 headRefOid 读滞后返回旧头 → "PR head mismatch"
# → publisher_authority_invalid，而实际发布已完成（fix-后-publish 场景 2/2 复现）。
# 修法：URL 合法但 head 不一致时有界重读（PUBLISHER_PR_VIEW_RETRIES 次），仍不一致才失败。
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
SOURCE="$ROOT/docker/cecelia-runner/entrypoint.sh"
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

unset HARNESS_ATTEMPT_ID PR_HEAD_SHA

detectors="$(sed -n '/^is_evaluator_task_bundle()/,/^prepare_evaluator_evidence_capsule()/p' "$SOURCE" | sed '$d')"
eval "$detectors"
publisher_block="$(sed -n '/^publish_approved_generator_candidate()/,/^}/p' "$SOURCE")"
[[ -n "$publisher_block" ]] || { echo 'missing trusted publisher block' >&2; exit 1; }
eval "$publisher_block"
type publish_approved_generator_candidate >/dev/null

git init --bare "$TEST_ROOT/remote.git" >/dev/null
git init -b main "$TEST_ROOT/workspace" >/dev/null
git -C "$TEST_ROOT/workspace" config user.name 'Head Lag Test'
git -C "$TEST_ROOT/workspace" config user.email lag@example.invalid
git -C "$TEST_ROOT/workspace" config core.hooksPath /dev/null
printf 'base\n' > "$TEST_ROOT/workspace/base.txt"
git -C "$TEST_ROOT/workspace" add base.txt
git -C "$TEST_ROOT/workspace" commit -m base >/dev/null
BASE_SHA=$(git -C "$TEST_ROOT/workspace" rev-parse HEAD)
git -C "$TEST_ROOT/workspace" checkout -b cp-head-lag >/dev/null
printf 'old\n' > "$TEST_ROOT/workspace/old.txt"
git -C "$TEST_ROOT/workspace" add old.txt
git -C "$TEST_ROOT/workspace" commit -m 'feat: old head' >/dev/null
OLD_SHA=$(git -C "$TEST_ROOT/workspace" rev-parse HEAD)
printf 'new\n' > "$TEST_ROOT/workspace/new.txt"
git -C "$TEST_ROOT/workspace" add new.txt
git -C "$TEST_ROOT/workspace" commit -m 'feat: fix head' >/dev/null
HEAD_SHA=$(git -C "$TEST_ROOT/workspace" rev-parse HEAD)

mkdir -p "$TEST_ROOT/trusted-gh"
printf 'credential\n' > "$TEST_ROOT/trusted-gh/hosts.yml"
TRUSTED_GITHUB_CONFIG_DIR="$TEST_ROOT/trusted-gh"
TRUSTED_PUBLISH_REMOTE_URL="$TEST_ROOT/remote.git"
export WORKTREE_PATH="$TEST_ROOT/workspace"
export CECELIA_TASK_ID='33333333-3333-4333-8333-333333333333'

cat > "$TEST_ROOT/publisher.json" <<JSON
{"task_bundle":{"role":"publisher","run_id":"11111111-1111-4111-8111-111111111111","attempt_id":"44444444-4444-4444-8444-444444444444","inputs":{"task_id":"33333333-3333-4333-8333-333333333333","candidate":{"source_attempt_id":"22222222-2222-4222-8222-222222222222","repo":"perfectuser21/cecelia","branch":"cp-head-lag","base_sha":"$BASE_SHA","head_sha":"$HEAD_SHA"},"judge_verdict":{"verdict":"PASS","pr_head_sha":"$HEAD_SHA"},"merge_fence":{"allowed":true,"head_sha":"$HEAD_SHA"},"workspace_spec":{"repo":"perfectuser21/cecelia","branch":"cp-head-lag","base_sha":"$HEAD_SHA","expected_head_sha":"$HEAD_SHA"}}}}
JSON
export HARNESS_TASK_BUNDLE_FILE="$TEST_ROOT/publisher.json"

# 读滞后模拟：前 2 次 pr view 返回旧头（API 复制滞后），第 3 次追上。
# sleep stub 掉，避免真实等待。
sleep() { :; }
VIEW_COUNT_FILE="$TEST_ROOT/view-count"
printf '0' > "$VIEW_COUNT_FILE"
gh() {
  if [[ "$1 $2" == 'auth setup-git' ]]; then return 0; fi
  if [[ "$1 $2" == 'pr view' ]]; then
    local n
    n=$(cat "$VIEW_COUNT_FILE")
    n=$((n + 1))
    printf '%s' "$n" > "$VIEW_COUNT_FILE"
    if (( n <= 2 )); then
      printf 'https://github.com/perfectuser21/cecelia/pull/999|%s\n' "$OLD_SHA"
    else
      printf 'https://github.com/perfectuser21/cecelia/pull/999|%s\n' "$HEAD_SHA"
    fi
    return 0
  fi
  return 1
}

printf '%s\n' '{"status":"completed","summary":"published","artifacts":[],"checks":[],"decision":null,"error":null,"case_file":null}' > "$TEST_ROOT/result.json"
if ! publish_approved_generator_candidate "$TEST_ROOT/result.json"; then
  echo 'FAIL: publisher rejected a completed publish because of headRefOid read-lag' >&2
  exit 1
fi
test "$(git --git-dir "$TEST_ROOT/remote.git" rev-parse refs/heads/cp-head-lag)" = "$HEAD_SHA"
jq -e --arg sha "$HEAD_SHA" '
  [.artifacts[] | select(.type == "pull_request" and .verification_status == "verified"
    and .head_sha == $sha)] | length == 1
' "$TEST_ROOT/result.json" >/dev/null
echo 'OK: read-lag retried and verified'

# 负向：head 永远不一致（真实身份错位）仍必须失败——重试不放松信任边界。
printf '0' > "$VIEW_COUNT_FILE"
gh() {
  if [[ "$1 $2" == 'auth setup-git' ]]; then return 0; fi
  if [[ "$1 $2" == 'pr view' ]]; then
    printf 'https://github.com/perfectuser21/cecelia/pull/999|%s\n' "$OLD_SHA"
    return 0
  fi
  return 1
}
printf '%s\n' '{"status":"completed","summary":"published","artifacts":[],"checks":[],"decision":null,"error":null,"case_file":null}' > "$TEST_ROOT/result2.json"
if publish_approved_generator_candidate "$TEST_ROOT/result2.json"; then
  echo 'FAIL: persistent head mismatch was accepted' >&2
  exit 1
fi
echo 'OK: persistent mismatch still rejected'
echo 'PASS entrypoint-publisher-head-lag-retry'
