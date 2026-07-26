#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPRINT_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
TASK_ID="58b733b8-ff1f-4120-a394-5bf8e38d4049"
UUID_RE='[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}'
REGRESSION_TEST="tests/regression/engine-tests-session-id-hotfix-599471cf/cecelia-run-session-id.test.ts"

if [[ ! -f "$SPRINT_ROOT/$REGRESSION_TEST" ]]; then
  REGRESSION_TEST="sprints/0726-engine-tests-session-id-hotfix-599471cf/tests/cecelia-run-session-id.test.ts"
fi

cd "$SPRINT_ROOT"

DRY_RUN_OUTPUT="$(bash packages/brain/scripts/cecelia-run.sh --dry-run "$TASK_ID")"
printf '%s\n' "$DRY_RUN_OUTPUT"

ENV_SESSION_ID="$(printf '%s\n' "$DRY_RUN_OUTPUT" | grep -oE "CLAUDE_SESSION_ID=${UUID_RE}" | cut -d= -f2)"
mapfile -t CLI_SESSION_IDS < <(
  printf '%s\n' "$DRY_RUN_OUTPUT" |
    grep -oE -- "--session-id[[:space:]]+${UUID_RE}" |
    awk '{print $2}'
)

if [[ ! "$ENV_SESSION_ID" =~ ^${UUID_RE}$ ]]; then
  echo "FAIL: CLAUDE_SESSION_ID 不是合法 UUID" >&2
  exit 1
fi

if [[ "${#CLI_SESSION_IDS[@]}" -ne 1 ]]; then
  echo "FAIL: launcher CLI 中 --session-id 必须恰出现一次" >&2
  exit 1
fi

if [[ "${CLI_SESSION_IDS[0]}" != "$ENV_SESSION_ID" ]]; then
  echo "FAIL: 环境变量与 launcher CLI 的 session id 不一致" >&2
  exit 1
fi

npx vitest run \
  "$REGRESSION_TEST" \
  --reporter=verbose

(
  cd packages/engine
  npx vitest run tests/launcher/launcher-dry-run.test.ts --reporter=verbose
)
