#!/usr/bin/env bash
# 903e9956：执行真实消费者的永久回归；不采收、不写生产或Notion。
set -euo pipefail
cd "$(dirname "$0")/../.."
npx vitest run src/routes/__tests__/journeys.test.js src/__tests__/notion-probe-projection.test.js src/lib/__tests__/activity-flow-metrics.test.js
