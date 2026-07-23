#!/usr/bin/env bash
# kernel-bounded-run-smoke.sh
# 验收：Kernel wiring 永久回归池在干净 checkout 中可执行。
# Sprint 07231527-relay-50170af2（task 50170af2）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR/packages/brain"

echo "── Kernel bounded-run permanent regression pool ──"
npx --no-install vitest run \
  ../../tests/regression/relay-50170af2/*.test.js \
  --reporter=dot

echo "✅ kernel-bounded-run-smoke: permanent regression pool passed"
