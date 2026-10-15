#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
npm test -w apps/api -- features/planning/pages/capability-system
node --test apps/dashboard/e2e/invocation-preview-server.test.mjs
