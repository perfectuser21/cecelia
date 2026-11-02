#!/usr/bin/env bash
# Brain 当前行为回归；固定 Skill 正文由独立的 pinned-source 合同负责。
set -euo pipefail
BRAIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPO_ROOT="$(cd "$BRAIN_ROOT/../.." && pwd)"
exec node "$REPO_ROOT/node_modules/vitest/vitest.mjs" run \
  --root "$BRAIN_ROOT" --config "$BRAIN_ROOT/vitest.config.js" \
  "src/__tests__/conversation-ttl-archiver.test.js" --maxWorkers=1 --minWorkers=1 --reporter=dot
